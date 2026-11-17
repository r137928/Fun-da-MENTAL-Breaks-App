mod auth;
#[cfg(feature = "local-demo")]
mod demo;
mod model;
mod store;
#[cfg(test)]
mod tests;

use std::{env, sync::Arc, time::Duration};

use axum::{
    Json, Router,
    extract::{DefaultBodyLimit, FromRequestParts, State},
    http::{StatusCode, header, request::Parts},
    response::{IntoResponse, Response},
    routing::{get, post, put},
};
use serde::Serialize;
use sqlx::{PgPool, postgres::PgPoolOptions};
use uuid::Uuid;

#[derive(Clone)]
struct App {
    pool: PgPool,
    http: reqwest::Client,
    config: Arc<auth::Config>,
    signing_keys: Arc<auth::SigningKeys>,
    #[cfg(feature = "local-demo")]
    demo: bool,
}

#[derive(Debug)]
struct ApiError {
    status: StatusCode,
    code: &'static str,
}

impl ApiError {
    fn new(status: StatusCode, code: &'static str) -> Self {
        Self { status, code }
    }
    fn invalid(code: &'static str) -> Self {
        Self::new(StatusCode::UNPROCESSABLE_ENTITY, code)
    }
    fn unauthorized() -> Self {
        Self::new(StatusCode::UNAUTHORIZED, "sign_in_required")
    }
    fn conflict(code: &'static str) -> Self {
        Self::new(StatusCode::CONFLICT, code)
    }
    fn upstream() -> Self {
        Self::new(StatusCode::SERVICE_UNAVAILABLE, "provider_unavailable")
    }
}

impl From<sqlx::Error> for ApiError {
    fn from(error: sqlx::Error) -> Self {
        let category = match error {
            sqlx::Error::PoolTimedOut => "pool_timeout",
            sqlx::Error::Database(_) => "database",
            _ => "connection_or_decode",
        };
        tracing::error!(category, "storage operation failed");
        Self::new(StatusCode::INTERNAL_SERVER_ERROR, "storage_error")
    }
}

impl IntoResponse for ApiError {
    fn into_response(self) -> Response {
        (self.status, Json(serde_json::json!({ "code": self.code }))).into_response()
    }
}

struct User(Uuid);

impl FromRequestParts<App> for User {
    type Rejection = ApiError;

    async fn from_request_parts(parts: &mut Parts, app: &App) -> Result<Self, ApiError> {
        let token = parts
            .headers
            .get(header::AUTHORIZATION)
            .and_then(|v| v.to_str().ok())
            .and_then(|v| v.strip_prefix("Bearer "))
            .ok_or_else(ApiError::unauthorized)?;
        #[cfg(feature = "local-demo")]
        if app.demo {
            return demo::authenticate(&app.pool, token).await.map(Self);
        }
        let claims = auth::session_claims(app, token).await?;
        auth::check_session(app, claims).await?;
        Ok(Self(claims.sub))
    }
}

#[derive(Serialize)]
struct BreakId {
    break_id: Uuid,
}

async fn me(State(app): State<App>, User(user): User) -> Result<Json<model::Me>, ApiError> {
    Ok(Json(store::me(&app.pool, user).await?))
}

async fn save(
    State(app): State<App>,
    User(user): User,
    Json(body): Json<model::SaveBlueprint>,
) -> Result<Json<model::Saved>, ApiError> {
    Ok(Json(store::save(&app.pool, user, body).await?))
}

async fn save_break(
    State(app): State<App>,
    User(user): User,
    Json(body): Json<model::CompletedBreak>,
) -> Result<Json<BreakId>, ApiError> {
    Ok(Json(BreakId {
        break_id: store::save_break(&app.pool, user, &body).await?,
    }))
}

async fn ready(State(app): State<App>) -> Result<StatusCode, ApiError> {
    sqlx::query("SELECT 1 FROM onboarding.accounts LIMIT 0")
        .execute(&app.pool)
        .await?;
    Ok(StatusCode::NO_CONTENT)
}

fn routes(app: App) -> Router {
    Router::new()
        .route("/health", get(|| async { StatusCode::NO_CONTENT }))
        .route("/ready", get(ready))
        .route("/v1/auth/apple", post(auth::apple))
        .route("/v1/auth/email/start", post(auth::email_start))
        .route("/v1/auth/email/verify", post(auth::email_verify))
        .route("/v1/auth/refresh", post(auth::refresh))
        .route("/v1/auth/signout", post(auth::signout))
        .route("/v1/me", get(me).delete(auth::delete))
        .route("/v1/me/blueprint", put(save))
        .route("/v1/me/breaks", post(save_break))
        .route("/internal/maintenance", post(auth::maintenance))
        .layer(DefaultBodyLimit::max(128 * 1024))
        .with_state(app)
}

#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error>> {
    tracing_subscriber::fmt().with_target(false).init();
    if env::args().nth(1).as_deref() == Some("migrate") {
        let pool = PgPoolOptions::new()
            .max_connections(1)
            .connect(&env::var("MIGRATION_DATABASE_URL")?)
            .await?;
        sqlx::migrate!().run(&pool).await?;
        return Ok(());
    }
    let config = Arc::new(auth::Config::from_env()?);
    let pool = PgPoolOptions::new()
        .max_connections(5)
        .acquire_timeout(Duration::from_secs(5))
        .connect(&env::var("DATABASE_URL")?)
        .await?;
    let http = reqwest::Client::builder()
        .timeout(Duration::from_secs(8))
        .redirect(reqwest::redirect::Policy::none())
        .build()?;
    let port = env::var("PORT")
        .unwrap_or_else(|_| "8080".to_owned())
        .parse::<u16>()?;
    let listener = tokio::net::TcpListener::bind((std::net::Ipv4Addr::UNSPECIFIED, port)).await?;
    let app = App {
        pool,
        http,
        config,
        signing_keys: Default::default(),
        #[cfg(feature = "local-demo")]
        demo: env::args().nth(1).as_deref() == Some("demo"),
    };
    #[cfg(feature = "local-demo")]
    let router = if app.demo {
        demo::initialize(&app.pool).await?;
        demo::routes(app)
    } else {
        routes(app)
    };
    #[cfg(not(feature = "local-demo"))]
    let router = routes(app);
    axum::serve(listener, router)
        .with_graceful_shutdown(shutdown())
        .await?;
    Ok(())
}

async fn shutdown() {
    #[cfg(unix)]
    {
        use tokio::signal::unix::{SignalKind, signal};
        if let Ok(mut term) = signal(SignalKind::terminate()) {
            tokio::select! { _ = term.recv() => {}, _ = tokio::signal::ctrl_c() => {} }
            return;
        }
    }
    let _ = tokio::signal::ctrl_c().await;
}
