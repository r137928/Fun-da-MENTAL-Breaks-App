use std::{env, io};

use aes_gcm::{Aes256Gcm, KeyInit, Nonce, aead::Aead};
use axum::{
    Json,
    extract::State,
    http::{HeaderMap, StatusCode, header},
};
use base64::{Engine, engine::general_purpose::STANDARD};
use chrono::{Duration, Utc};
use jsonwebtoken::{
    Algorithm, DecodingKey, EncodingKey, Header, Validation, decode, decode_header, encode,
    jwk::JwkSet,
};
use rand::RngCore;
use reqwest::{Method as HttpMethod, Response};
use serde::{Deserialize, Serialize, de::DeserializeOwned};
use serde_json::{Value, json};
use sha2::{Digest, Sha256};
use sqlx::{Postgres, Transaction};
use subtle::ConstantTimeEq;
use uuid::Uuid;

use crate::{
    ApiError, App, User,
    model::{Eligibility, Method},
};

pub struct Config {
    url: String,
    publishable: String,
    secret: String,
    apple_client: String,
    apple_team: String,
    apple_key_id: String,
    apple_key: String,
    encryption_key: Option<[u8; 32]>,
    maintenance_token: String,
    auth_enabled: bool,
    self_declared: bool,
    policy_version: i32,
}

impl Config {
    pub fn from_env() -> Result<Self, io::Error> {
        let get = |key| env::var(key).unwrap_or_default();
        let enabled = get("AUTH_ENABLED") == "true";
        let encryption_key = if get("APPLE_TOKEN_ENCRYPTION_KEY").is_empty() {
            None
        } else {
            Some(
                STANDARD
                    .decode(get("APPLE_TOKEN_ENCRYPTION_KEY"))
                    .ok()
                    .and_then(|bytes| bytes.try_into().ok())
                    .ok_or_else(|| {
                        io::Error::other("APPLE_TOKEN_ENCRYPTION_KEY must encode 32 bytes")
                    })?,
            )
        };
        let config = Self {
            url: get("SUPABASE_URL").trim_end_matches('/').to_owned(),
            publishable: get("SUPABASE_PUBLISHABLE_KEY"),
            secret: get("SUPABASE_SECRET_KEY"),
            apple_client: get("APPLE_CLIENT_ID"),
            apple_team: get("APPLE_TEAM_ID"),
            apple_key_id: get("APPLE_KEY_ID"),
            apple_key: get("APPLE_PRIVATE_KEY").replace("\\n", "\n"),
            encryption_key,
            maintenance_token: get("MAINTENANCE_TOKEN"),
            auth_enabled: enabled,
            self_declared: get("ALLOW_SELF_DECLARED") == "true",
            policy_version: get("AGE_POLICY_VERSION").parse().unwrap_or(1),
        };
        if enabled
            && (!config.url.starts_with("https://")
                || config.publishable.is_empty()
                || config.secret.is_empty()
                || config.apple_client.is_empty()
                || config.apple_team.is_empty()
                || config.apple_key_id.is_empty()
                || config.encryption_key.is_none()
                || config.maintenance_token.len() < 32
                || EncodingKey::from_ec_pem(config.apple_key.as_bytes()).is_err()
                || config.policy_version < 1)
        {
            return Err(io::Error::other("Auth settings are incomplete or invalid"));
        }
        Ok(config)
    }

    fn check_eligibility(&self, evidence: Eligibility) -> Result<(), ApiError> {
        if !self.auth_enabled {
            return Err(ApiError::new(
                StatusCode::SERVICE_UNAVAILABLE,
                "signup_unavailable",
            ));
        }
        if evidence.policy_version != self.policy_version {
            return Err(ApiError::conflict("eligibility_check_required"));
        }
        if !evidence.eligible || evidence.method == Method::SelfDeclared && !self.self_declared {
            return Err(ApiError::new(StatusCode::FORBIDDEN, "age_not_eligible"));
        }
        Ok(())
    }
}

#[derive(Clone, Copy, Deserialize)]
pub struct Claims {
    pub sub: Uuid,
    pub session_id: Uuid,
}

pub async fn check_session(app: &App, claims: Claims) -> Result<(), ApiError> {
    crate::store::check_session(
        &app.pool,
        claims,
        app.config.policy_version,
        app.config.self_declared,
    )
    .await
}

pub async fn session_claims(app: &App, token: &str) -> Result<Claims, ApiError> {
    if !app.config.auth_enabled {
        return Err(ApiError::unauthorized());
    }
    let mut validation = Validation::new(Algorithm::ES256);
    validation.algorithms.push(Algorithm::RS256);
    validation.set_issuer(&[format!("{}/auth/v1", app.config.url)]);
    validation.set_audience(&["authenticated"]);
    verify_jwt(
        app,
        &format!("{}/auth/v1/.well-known/jwks.json", app.config.url),
        token,
        &validation,
    )
    .await
}

async fn verify_jwt<T: DeserializeOwned>(
    app: &App,
    url: &str,
    token: &str,
    validation: &Validation,
) -> Result<T, ApiError> {
    let header = decode_header(token).map_err(|_| ApiError::unauthorized())?;
    let kid = header.kid.ok_or_else(ApiError::unauthorized)?;
    let set = app.signing_keys.get(&app.http, url, &kid).await?;
    let key = set.find(&kid).ok_or_else(ApiError::unauthorized)?;
    let key = DecodingKey::from_jwk(key).map_err(|_| ApiError::unauthorized())?;
    Ok(decode::<T>(token, &key, validation)
        .map_err(|_| ApiError::unauthorized())?
        .claims)
}

#[derive(Default)]
pub struct SigningKeys(
    tokio::sync::Mutex<
        std::collections::HashMap<String, (std::time::Instant, std::sync::Arc<JwkSet>)>,
    >,
);

impl SigningKeys {
    async fn get(
        &self,
        client: &reqwest::Client,
        url: &str,
        kid: &str,
    ) -> Result<std::sync::Arc<JwkSet>, ApiError> {
        let mut cache = self.0.lock().await;
        if let Some((loaded, keys)) = cache.get(url) {
            let age = loaded.elapsed().as_secs();
            if age < 30 || age < 600 && keys.find(kid).is_some() {
                return Ok(keys.clone());
            }
        }
        let keys = std::sync::Arc::new(
            client
                .get(url)
                .send()
                .await
                .map_err(provider_error)?
                .error_for_status()
                .map_err(provider_error)?
                .json::<JwkSet>()
                .await
                .map_err(provider_error)?,
        );
        cache.insert(url.to_owned(), (std::time::Instant::now(), keys.clone()));
        Ok(keys)
    }
}

fn provider_error(_: reqwest::Error) -> ApiError {
    tracing::warn!("identity provider request failed");
    ApiError::upstream()
}

async fn auth_request(
    app: &App,
    method: HttpMethod,
    path: &str,
    payload: Value,
) -> Result<Response, ApiError> {
    let response = app
        .http
        .request(method, format!("{}/auth/v1/{path}", app.config.url))
        .header("apikey", &app.config.publishable)
        .json(&payload)
        .send()
        .await
        .map_err(provider_error)?;
    let status = response.status();
    if status.is_success() {
        return Ok(response);
    }
    tracing::warn!(
        status = status.as_u16(),
        "identity provider rejected request"
    );
    if status == StatusCode::TOO_MANY_REQUESTS {
        return Err(ApiError::new(status, "try_again_later"));
    }
    if status.is_client_error() {
        return Err(ApiError::unauthorized());
    }
    Err(ApiError::upstream())
}

#[derive(Deserialize, Serialize)]
pub struct Session {
    access_token: String,
    refresh_token: String,
    expires_in: u32,
}

async fn register_approval(
    app: &App,
    provider: &str,
    subject: &str,
    evidence: Eligibility,
) -> Result<Uuid, ApiError> {
    app.config.check_eligibility(evidence)?;
    let mut tx = app.pool.begin().await?;
    sqlx::query("SELECT pg_advisory_xact_lock(hashtextextended($1, 0))")
        .bind(format!("{provider}:{subject}"))
        .execute(&mut *tx)
        .await?;
    let count: i64 = sqlx::query_scalar(
        "SELECT count(*) FROM onboarding.signup_approvals WHERE provider = $1 AND subject = $2 AND expires_at > now()",
    ).bind(provider).bind(subject).fetch_one(&mut *tx).await?;
    if count >= 5 {
        return Err(ApiError::new(
            StatusCode::TOO_MANY_REQUESTS,
            "try_again_later",
        ));
    }
    let id = Uuid::new_v4();
    sqlx::query(
        "INSERT INTO onboarding.signup_approvals (id, provider, subject, eligibility_method, policy_version, expires_at)
         VALUES ($1, $2, $3, $4, $5, now() + interval '15 minutes')",
    ).bind(id).bind(provider).bind(subject).bind(evidence.method.as_str()).bind(evidence.policy_version)
        .execute(&mut *tx).await?;
    tx.commit().await?;
    Ok(id)
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
pub struct EmailStart {
    email: String,
    eligibility: Eligibility,
}
#[derive(Serialize)]
pub struct EmailAttempt {
    attempt_id: Uuid,
}
#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
pub struct EmailVerify {
    attempt_id: Uuid,
    code: String,
}

fn normalize_email(value: &str) -> Result<String, ApiError> {
    let email = value.trim().to_lowercase();
    let Some((local, domain)) = email.split_once('@') else {
        return Err(ApiError::invalid("email"));
    };
    if email.len() > 254
        || !email.is_ascii()
        || email
            .bytes()
            .any(|b| b.is_ascii_whitespace() || b.is_ascii_control())
        || local.is_empty()
        || domain.contains('@')
        || !domain.contains('.')
        || domain.starts_with('.')
        || domain.ends_with('.')
    {
        return Err(ApiError::invalid("email"));
    }
    Ok(email)
}

pub async fn email_start(
    State(app): State<App>,
    Json(body): Json<EmailStart>,
) -> Result<Json<EmailAttempt>, ApiError> {
    app.config.check_eligibility(body.eligibility)?;
    let email = normalize_email(&body.email)?;
    let attempt_id = register_approval(&app, "email", &email, body.eligibility).await?;
    auth_request(
        &app,
        HttpMethod::POST,
        "otp",
        json!({
            "email": email, "create_user": true, "data": { "signup_approval": attempt_id }
        }),
    )
    .await?;
    Ok(Json(EmailAttempt { attempt_id }))
}

pub async fn email_verify(
    State(app): State<App>,
    Json(body): Json<EmailVerify>,
) -> Result<Json<Session>, ApiError> {
    if !app.config.auth_enabled {
        return Err(ApiError::unauthorized());
    }
    if !(6..=10).contains(&body.code.len()) || !body.code.bytes().all(|b| b.is_ascii_digit()) {
        return Err(ApiError::invalid("code"));
    }
    let row = sqlx::query_as::<_, (String, String, i32)>(
        "SELECT subject, eligibility_method, policy_version FROM onboarding.signup_approvals
         WHERE id = $1 AND provider = 'email' AND expires_at > now()",
    )
    .bind(body.attempt_id)
    .fetch_optional(&app.pool)
    .await?
    .ok_or_else(ApiError::unauthorized)?;
    if row.2 != app.config.policy_version || row.1 == "self_declared" && !app.config.self_declared {
        return Err(ApiError::conflict("eligibility_check_required"));
    }
    let session: Session = auth_request(
        &app,
        HttpMethod::POST,
        "verify",
        json!({
            "email": row.0, "token": body.code, "type": "email"
        }),
    )
    .await?
    .json()
    .await
    .map_err(provider_error)?;
    let claims = session_claims(&app, &session.access_token).await?;
    let mut tx = app.pool.begin().await?;
    let consumed =
        sqlx::query("DELETE FROM onboarding.signup_approvals WHERE id = $1 AND expires_at > now()")
            .bind(body.attempt_id)
            .execute(&mut *tx)
            .await?;
    if consumed.rows_affected() != 1 {
        return Err(ApiError::unauthorized());
    }
    approve_session(&mut tx, claims, &row.1, row.2, None).await?;
    tx.commit().await?;
    Ok(Json(session))
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
pub struct AppleLogin {
    identity_token: String,
    authorization_code: String,
    nonce: String,
    eligibility: Eligibility,
}
#[derive(Deserialize)]
struct AppleClaims {
    sub: String,
    nonce: Option<String>,
}
#[derive(Deserialize)]
struct AppleTokens {
    refresh_token: String,
    id_token: String,
}
#[derive(Serialize)]
struct AppleClientClaims<'a> {
    iss: &'a str,
    sub: &'a str,
    aud: &'static str,
    iat: i64,
    exp: i64,
}

fn apple_client_secret(config: &Config) -> Result<String, ApiError> {
    let now = Utc::now();
    let mut header = Header::new(Algorithm::ES256);
    header.kid = Some(config.apple_key_id.clone());
    let claims = AppleClientClaims {
        iss: &config.apple_team,
        sub: &config.apple_client,
        aud: "https://appleid.apple.com",
        iat: now.timestamp(),
        exp: (now + Duration::minutes(5)).timestamp(),
    };
    let key =
        EncodingKey::from_ec_pem(config.apple_key.as_bytes()).map_err(|_| ApiError::upstream())?;
    encode(&header, &claims, &key).map_err(|_| ApiError::upstream())
}

async fn apple_claims(app: &App, token: &str) -> Result<AppleClaims, ApiError> {
    let mut validation = Validation::new(Algorithm::RS256);
    validation.set_issuer(&["https://appleid.apple.com"]);
    validation.set_audience(&[&app.config.apple_client]);
    verify_jwt(
        app,
        "https://appleid.apple.com/auth/keys",
        token,
        &validation,
    )
    .await
}

fn seal(config: &Config, subject: &str, token: &str) -> Result<Vec<u8>, ApiError> {
    let key = config
        .encryption_key
        .as_ref()
        .ok_or_else(ApiError::upstream)?;
    let cipher = Aes256Gcm::new_from_slice(key).map_err(|_| ApiError::upstream())?;
    let mut nonce = [0_u8; 12];
    rand::rngs::OsRng.fill_bytes(&mut nonce);
    let encrypted = cipher
        .encrypt(
            Nonce::from_slice(&nonce),
            aes_gcm::aead::Payload {
                msg: token.as_bytes(),
                aad: subject.as_bytes(),
            },
        )
        .map_err(|_| ApiError::upstream())?;
    Ok([nonce.as_slice(), &encrypted].concat())
}

fn open_token(config: &Config, subject: &str, encrypted: &[u8]) -> Result<String, ApiError> {
    let key = config
        .encryption_key
        .as_ref()
        .ok_or_else(ApiError::upstream)?;
    let cipher = Aes256Gcm::new_from_slice(key).map_err(|_| ApiError::upstream())?;
    let (nonce, data) = encrypted
        .split_at_checked(12)
        .ok_or_else(ApiError::upstream)?;
    let plain = cipher
        .decrypt(
            Nonce::from_slice(nonce),
            aes_gcm::aead::Payload {
                msg: data,
                aad: subject.as_bytes(),
            },
        )
        .map_err(|_| ApiError::upstream())?;
    String::from_utf8(plain).map_err(|_| ApiError::upstream())
}

pub async fn apple(
    State(app): State<App>,
    Json(body): Json<AppleLogin>,
) -> Result<Json<Session>, ApiError> {
    app.config.check_eligibility(body.eligibility)?;
    if body.nonce.len() < 32 || body.nonce.len() > 128 || body.authorization_code.is_empty() {
        return Err(ApiError::invalid("apple_credentials"));
    }
    let identity = apple_claims(&app, &body.identity_token).await?;
    let hash = hex::encode(Sha256::digest(body.nonce.as_bytes()));
    if identity.nonce.as_deref() != Some(&hash) {
        return Err(ApiError::unauthorized());
    }
    let secret = apple_client_secret(&app.config)?;
    let response = app
        .http
        .post("https://appleid.apple.com/auth/token")
        .form(&[
            ("client_id", app.config.apple_client.as_str()),
            ("client_secret", secret.as_str()),
            ("code", body.authorization_code.as_str()),
            ("grant_type", "authorization_code"),
        ])
        .send()
        .await
        .map_err(provider_error)?;
    if response.status().is_client_error() {
        return Err(ApiError::unauthorized());
    }
    let tokens: AppleTokens = response
        .error_for_status()
        .map_err(provider_error)?
        .json()
        .await
        .map_err(provider_error)?;
    if apple_claims(&app, &tokens.id_token).await?.sub != identity.sub {
        return Err(ApiError::unauthorized());
    }
    let encrypted = seal(&app.config, &identity.sub, &tokens.refresh_token)?;
    let approval = register_approval(&app, "apple", &identity.sub, body.eligibility).await?;
    let session: Session = auth_request(
        &app,
        HttpMethod::POST,
        "token?grant_type=id_token",
        json!({
            "provider": "apple", "id_token": body.identity_token, "nonce": body.nonce
        }),
    )
    .await?
    .json()
    .await
    .map_err(provider_error)?;
    let claims = session_claims(&app, &session.access_token).await?;
    let mut tx = app.pool.begin().await?;
    approve_session(
        &mut tx,
        claims,
        body.eligibility.method.as_str(),
        body.eligibility.policy_version,
        Some((&identity.sub, &encrypted)),
    )
    .await?;
    sqlx::query("DELETE FROM onboarding.signup_approvals WHERE id = $1")
        .bind(approval)
        .execute(&mut *tx)
        .await?;
    tx.commit().await?;
    Ok(Json(session))
}

async fn approve_session(
    tx: &mut Transaction<'_, Postgres>,
    claims: Claims,
    method: &str,
    version: i32,
    apple: Option<(&str, &[u8])>,
) -> Result<(), ApiError> {
    let (subject, token) = apple.map_or((None, None), |(s, t)| (Some(s), Some(t)));
    let changed = sqlx::query(
        "INSERT INTO onboarding.accounts (id, eligibility_method, policy_version, apple_subject, apple_refresh_encrypted)
         VALUES ($1, $2, $3, $4, $5)
         ON CONFLICT (id) DO UPDATE SET eligibility_method = EXCLUDED.eligibility_method,
             policy_version = EXCLUDED.policy_version, eligibility_checked_at = now(),
             apple_subject = COALESCE(EXCLUDED.apple_subject, accounts.apple_subject),
             apple_refresh_encrypted = COALESCE(EXCLUDED.apple_refresh_encrypted, accounts.apple_refresh_encrypted)
         WHERE accounts.status = 'active'
         AND (accounts.apple_subject IS NULL OR EXCLUDED.apple_subject IS NULL OR accounts.apple_subject = EXCLUDED.apple_subject)",
    ).bind(claims.sub).bind(method).bind(version).bind(subject).bind(token).execute(&mut **tx).await?;
    if changed.rows_affected() != 1 {
        return Err(ApiError::unauthorized());
    }
    sqlx::query(
        "INSERT INTO onboarding.approved_sessions (session_id, user_id, eligibility_method, policy_version)
         VALUES ($1, $2, $3, $4) ON CONFLICT DO NOTHING",
    ).bind(claims.session_id).bind(claims.sub).bind(method).bind(version).execute(&mut **tx).await?;
    Ok(())
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Refresh {
    refresh_token: String,
}

pub async fn refresh(
    State(app): State<App>,
    Json(body): Json<Refresh>,
) -> Result<Json<Session>, ApiError> {
    if !app.config.auth_enabled {
        return Err(ApiError::unauthorized());
    }
    let session: Session = auth_request(
        &app,
        HttpMethod::POST,
        "token?grant_type=refresh_token",
        json!({ "refresh_token": body.refresh_token }),
    )
    .await?
    .json()
    .await
    .map_err(provider_error)?;
    let claims = session_claims(&app, &session.access_token).await?;
    check_session(&app, claims).await?;
    Ok(Json(session))
}

pub async fn signout(
    State(app): State<App>,
    headers: HeaderMap,
    User(user): User,
) -> Result<StatusCode, ApiError> {
    let token = headers
        .get(header::AUTHORIZATION)
        .and_then(|v| v.to_str().ok())
        .and_then(|v| v.strip_prefix("Bearer "))
        .ok_or_else(ApiError::unauthorized)?;
    let claims = session_claims(&app, token).await?;
    sqlx::query("DELETE FROM onboarding.approved_sessions WHERE user_id = $1 AND session_id = $2")
        .bind(user)
        .bind(claims.session_id)
        .execute(&app.pool)
        .await?;
    let _ = app
        .http
        .post(format!("{}/auth/v1/logout?scope=local", app.config.url))
        .header("apikey", &app.config.publishable)
        .bearer_auth(token)
        .send()
        .await;
    Ok(StatusCode::NO_CONTENT)
}

pub async fn delete(State(app): State<App>, User(user): User) -> Result<StatusCode, ApiError> {
    let mut tx = app.pool.begin().await?;
    sqlx::query("UPDATE onboarding.accounts SET status = 'deleting', blueprint_completed_at = NULL WHERE id = $1")
        .bind(user).execute(&mut *tx).await?;
    sqlx::query("DELETE FROM onboarding.approved_sessions WHERE user_id = $1")
        .bind(user)
        .execute(&mut *tx)
        .await?;
    sqlx::query("DELETE FROM onboarding.blueprints WHERE user_id = $1")
        .bind(user)
        .execute(&mut *tx)
        .await?;
    sqlx::query("DELETE FROM onboarding.breaks WHERE user_id = $1")
        .bind(user)
        .execute(&mut *tx)
        .await?;
    sqlx::query("DELETE FROM onboarding.blueprint_requests WHERE user_id = $1")
        .bind(user)
        .execute(&mut *tx)
        .await?;
    sqlx::query("INSERT INTO onboarding.deletions (user_id) VALUES ($1) ON CONFLICT DO NOTHING")
        .bind(user)
        .execute(&mut *tx)
        .await?;
    tx.commit().await?;
    Ok(StatusCode::ACCEPTED)
}

pub async fn maintenance(
    State(app): State<App>,
    headers: HeaderMap,
) -> Result<StatusCode, ApiError> {
    let supplied = headers
        .get(header::AUTHORIZATION)
        .and_then(|v| v.to_str().ok())
        .and_then(|v| v.strip_prefix("Bearer "))
        .ok_or_else(ApiError::unauthorized)?;
    if app.config.maintenance_token.is_empty()
        || !bool::from(
            Sha256::digest(supplied).ct_eq(&Sha256::digest(&app.config.maintenance_token)),
        )
    {
        return Err(ApiError::unauthorized());
    }
    sqlx::query("DELETE FROM onboarding.signup_approvals WHERE expires_at <= now()")
        .execute(&app.pool)
        .await?;
    let pending = sqlx::query_scalar::<_, Uuid>(
        "SELECT user_id FROM onboarding.deletions ORDER BY requested_at LIMIT 20",
    )
    .fetch_all(&app.pool)
    .await?;
    let mut failed = false;
    for user in pending {
        if let Err(error) = finish_deletion(&app, user).await {
            tracing::warn!(code = error.code, "account deletion will retry");
            failed = true;
        }
    }
    if failed {
        return Err(ApiError::upstream());
    }
    Ok(StatusCode::NO_CONTENT)
}

async fn finish_deletion(app: &App, user: Uuid) -> Result<(), ApiError> {
    let mut tx = app.pool.begin().await?;
    let Some((revoked, subject, encrypted)) =
        sqlx::query_as::<_, (bool, Option<String>, Option<Vec<u8>>)>(
            "SELECT d.apple_revoked, a.apple_subject, a.apple_refresh_encrypted
         FROM onboarding.deletions d JOIN onboarding.accounts a ON a.id = d.user_id
         WHERE d.user_id = $1 FOR UPDATE OF d SKIP LOCKED",
        )
        .bind(user)
        .fetch_optional(&mut *tx)
        .await?
    else {
        return Ok(());
    };
    if !revoked {
        if let (Some(subject), Some(encrypted)) = (subject, encrypted) {
            let token = open_token(&app.config, &subject, &encrypted)?;
            let secret = apple_client_secret(&app.config)?;
            app.http
                .post("https://appleid.apple.com/auth/revoke")
                .form(&[
                    ("client_id", app.config.apple_client.as_str()),
                    ("client_secret", secret.as_str()),
                    ("token", token.as_str()),
                    ("token_type_hint", "refresh_token"),
                ])
                .send()
                .await
                .map_err(provider_error)?
                .error_for_status()
                .map_err(provider_error)?;
        }
        sqlx::query("UPDATE onboarding.deletions SET apple_revoked = true WHERE user_id = $1")
            .bind(user)
            .execute(&mut *tx)
            .await?;
        sqlx::query("UPDATE onboarding.accounts SET apple_refresh_encrypted = NULL WHERE id = $1")
            .bind(user)
            .execute(&mut *tx)
            .await?;
        tx.commit().await?;
        tx = app.pool.begin().await?;
        let acquired = sqlx::query_scalar::<_, bool>(
            "SELECT apple_revoked FROM onboarding.deletions WHERE user_id = $1 FOR UPDATE SKIP LOCKED"
        ).bind(user).fetch_optional(&mut *tx).await?;
        if acquired != Some(true) {
            return Ok(());
        }
    }
    let response = app
        .http
        .delete(format!("{}/auth/v1/admin/users/{user}", app.config.url))
        .header("apikey", &app.config.secret)
        .send()
        .await
        .map_err(provider_error)?;
    if !response.status().is_success() && response.status() != StatusCode::NOT_FOUND {
        return Err(ApiError::upstream());
    }
    sqlx::query("DELETE FROM onboarding.accounts WHERE id = $1")
        .bind(user)
        .execute(&mut *tx)
        .await?;
    tx.commit().await?;
    tracing::info!("account deletion completed");
    Ok(())
}
