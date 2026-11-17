use axum::{
    Json, Router,
    extract::{DefaultBodyLimit, State},
    http::{StatusCode, header},
    response::Html,
    routing::{get, post, put},
};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use sqlx::PgPool;
use uuid::Uuid;

use crate::{ApiError, App, User, model::Me, ready, save, save_break, store};

pub async fn initialize(pool: &PgPool) -> Result<(), sqlx::Error> {
    sqlx::query(
        "CREATE TABLE IF NOT EXISTS onboarding.demo_contacts (
            user_id uuid PRIMARY KEY REFERENCES onboarding.accounts ON DELETE CASCADE,
            method text NOT NULL CHECK (method IN ('email', 'phone')),
            value text NOT NULL
        )",
    )
    .execute(pool)
    .await?;
    Ok(())
}

pub fn routes(app: App) -> Router {
    Router::new()
        .route("/", get(|| async { Html(include_str!("../../demo/index.html")) }))
        .route("/demo.js", get(|| async {
            ([(header::CONTENT_TYPE, "text/javascript; charset=utf-8")], include_str!("../../demo/demo.js"))
        }))
        .route("/demo.css", get(|| async {
            ([(header::CONTENT_TYPE, "text/css; charset=utf-8")], include_str!("../../demo/demo.css"))
        }))
        .route("/brain-buddy.js", get(|| async {
            ([(header::CONTENT_TYPE, "text/javascript; charset=utf-8")], include_str!("../../demo/brain-buddy.js"))
        }))
        .route("/brain-buddy-actions-v1.webp", get(|| async {
            ([(header::CONTENT_TYPE, "image/webp")], &include_bytes!("../../demo/brain-buddy-actions-v1.webp")[..])
        }))
        .route("/brain-buddy.png", get(|| async {
            ([(header::CONTENT_TYPE, "image/png")], &include_bytes!("../../demo/brain-buddy.png")[..])
        }))
        .route("/brain-buddy-refined.webp", get(|| async {
            ([(header::CONTENT_TYPE, "image/webp")], &include_bytes!("../../demo/brain-buddy-refined.webp")[..])
        }))
        .route("/brain-buddy-refined-poster.webp", get(|| async {
            ([(header::CONTENT_TYPE, "image/webp")], &include_bytes!("../../demo/brain-buddy-refined-poster.webp")[..])
        }))
        .route("/catalog.json", get(|| async {
            ([(header::CONTENT_TYPE, "application/json")], include_str!("../../catalog/v1.json"))
        }))
        .route("/ready", get(ready))
        .route("/demo/session", post(create_session))
        .route("/v1/me", get(demo_me))
        .route("/v1/me/blueprint", put(save))
        .route("/v1/me/breaks", post(save_break))
        .layer(DefaultBodyLimit::max(128 * 1024))
        .with_state(app)
}

#[derive(Deserialize)]
#[serde(rename_all = "snake_case")]
enum Sample { Adult, Teen, Under13 }

#[derive(Deserialize)]
struct Start {
    sample: Sample,
    contact: Option<ContactChoice>,
}

#[derive(Deserialize)]
#[serde(rename_all = "snake_case")]
enum ContactMethod { Email, Phone }

#[derive(Deserialize)]
#[serde(rename_all = "snake_case")]
enum ContactPreset { Alex, Sam, Jamie }

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct ContactChoice {
    method: ContactMethod,
    preset: ContactPreset,
}

#[derive(Serialize, sqlx::FromRow)]
struct Contact {
    method: String,
    value: String,
}

impl ContactChoice {
    fn sample_value(&self) -> (&'static str, &'static str) {
        match (&self.method, &self.preset) {
            (ContactMethod::Email, ContactPreset::Alex) => ("email", "alex@example.test"),
            (ContactMethod::Email, ContactPreset::Sam) => ("email", "sam@example.test"),
            (ContactMethod::Email, ContactPreset::Jamie) => ("email", "jamie@example.test"),
            (ContactMethod::Phone, ContactPreset::Alex) => ("phone", "+1 202-555-0101"),
            (ContactMethod::Phone, ContactPreset::Sam) => ("phone", "+1 202-555-0112"),
            (ContactMethod::Phone, ContactPreset::Jamie) => ("phone", "+1 202-555-0123"),
        }
    }
}

#[derive(Serialize)]
struct DemoAccount {
    #[serde(flatten)]
    account: Me,
    contact: Option<Contact>,
}

async fn demo_me(
    State(app): State<App>,
    User(user): User,
) -> Result<Json<DemoAccount>, ApiError> {
    let account = store::me(&app.pool, user).await?;
    let contact = sqlx::query_as::<_, Contact>(
        "SELECT method, value FROM onboarding.demo_contacts WHERE user_id = $1",
    )
    .bind(user)
    .fetch_optional(&app.pool)
    .await?;
    Ok(Json(DemoAccount { account, contact }))
}

#[derive(Serialize)]
struct Session { token: String }

fn session_key(token: &str) -> Uuid {
    let hash = Sha256::digest(token.as_bytes());
    Uuid::from_bytes(hash[..16].try_into().expect("SHA-256 prefix is 16 bytes"))
}

async fn create_session(
    State(app): State<App>,
    Json(start): Json<Start>,
) -> Result<Json<Session>, ApiError> {
    if matches!(start.sample, Sample::Under13) {
        return Err(ApiError::new(StatusCode::FORBIDDEN, "age_not_eligible"));
    }
    let user = Uuid::new_v4();
    let token = format!("{}.{}", Uuid::new_v4(), Uuid::new_v4());
    let mut tx = app.pool.begin().await?;
    sqlx::query("INSERT INTO onboarding.accounts (id, eligibility_method, policy_version) VALUES ($1, 'self_declared', 1)")
        .bind(user).execute(&mut *tx).await?;
    sqlx::query("INSERT INTO onboarding.approved_sessions VALUES ($1, $2, 'self_declared', 1)")
        .bind(session_key(&token)).bind(user).execute(&mut *tx).await?;
    if let Some(contact) = start.contact {
        let (method, value) = contact.sample_value();
        sqlx::query("INSERT INTO onboarding.demo_contacts (user_id, method, value) VALUES ($1, $2, $3)")
            .bind(user).bind(method).bind(value).execute(&mut *tx).await?;
    }
    tx.commit().await?;
    Ok(Json(Session { token }))
}

pub async fn authenticate(pool: &PgPool, token: &str) -> Result<Uuid, ApiError> {
    sqlx::query_scalar::<_, Uuid>(
        "SELECT a.id FROM onboarding.approved_sessions s JOIN onboarding.accounts a ON a.id = s.user_id
         WHERE s.session_id = $1 AND a.status = 'active' AND a.eligibility_method = 'self_declared'",
    )
    .bind(session_key(token))
    .fetch_optional(pool)
    .await?
    .ok_or_else(ApiError::unauthorized)
}
