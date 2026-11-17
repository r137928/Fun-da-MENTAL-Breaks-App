use axum::http::StatusCode;
use sha2::{Digest, Sha256};
use sqlx::{PgPool, Postgres, Transaction, types::Json};
use uuid::Uuid;

use crate::{
    ApiError,
    auth::Claims,
    model::{Blueprint, BreakSource, CompletedBreak, Me, SaveBlueprint, Saved},
};

pub async fn check_session(
    pool: &PgPool,
    claims: Claims,
    policy_version: i32,
    self_declared: bool,
) -> Result<(), ApiError> {
    let active = sqlx::query_scalar::<_, bool>(
        "SELECT EXISTS (SELECT 1 FROM onboarding.approved_sessions s
          JOIN onboarding.accounts a ON a.id = s.user_id
          WHERE s.session_id = $1 AND a.id = $2 AND a.status = 'active'
          AND s.policy_version = $3 AND ($4 OR s.eligibility_method = 'apple_age_range'))",
    )
    .bind(claims.session_id)
    .bind(claims.sub)
    .bind(policy_version)
    .bind(self_declared)
    .fetch_one(pool)
    .await?;
    if !active {
        return Err(ApiError::unauthorized());
    }
    Ok(())
}

async fn lock_active(tx: &mut Transaction<'_, Postgres>, user: Uuid) -> Result<bool, ApiError> {
    let row = sqlx::query_scalar::<_, bool>(
        "SELECT blueprint_completed_at IS NOT NULL FROM onboarding.accounts
         WHERE id = $1 AND status = 'active' FOR UPDATE",
    )
    .bind(user)
    .fetch_optional(&mut **tx)
    .await?;
    row.ok_or_else(ApiError::unauthorized)
}

pub async fn me(pool: &PgPool, user: Uuid) -> Result<Me, ApiError> {
    let mut tx = pool.begin().await?;
    let setup_complete = lock_active(&mut tx, user).await?;
    let row = sqlx::query_as::<_, (i64, Json<Blueprint>)>(
        "SELECT revision, document FROM onboarding.blueprints WHERE user_id = $1",
    )
    .bind(user)
    .fetch_optional(&mut *tx)
    .await?;
    let (revision, blueprint) = row.map_or((None, None), |(revision, doc)| {
        (Some(revision), Some(doc.0))
    });
    let recent_breaks = sqlx::query_scalar::<_, Json<CompletedBreak>>(
        "SELECT document FROM onboarding.breaks WHERE user_id = $1 ORDER BY completed_at DESC, id LIMIT 30",
    ).bind(user).fetch_all(&mut *tx).await?.into_iter().map(|doc| doc.0).collect();
    tx.commit().await?;
    Ok(Me {
        user_id: user,
        setup_complete,
        revision,
        blueprint,
        recent_breaks,
    })
}

pub async fn save(pool: &PgPool, user: Uuid, mut body: SaveBlueprint) -> Result<Saved, ApiError> {
    if body.request_id.is_nil() || body.expected_revision.is_some_and(|n| n < 1) {
        return Err(ApiError::invalid("save_request"));
    }
    let canonical = serde_json::to_vec(&body).map_err(|_| ApiError::invalid("save_request"))?;
    let hash = Sha256::digest(canonical);
    let mut tx = pool.begin().await?;
    lock_active(&mut tx, user).await?;
    if let Some((stored_hash, revision, break_id)) = sqlx::query_as::<_, (Vec<u8>, i64, Option<Uuid>)>(
        "SELECT payload_hash, revision, break_id FROM onboarding.blueprint_requests WHERE user_id = $1 AND request_id = $2",
    ).bind(user).bind(body.request_id).fetch_optional(&mut *tx).await? {
        if stored_hash.as_slice() != hash.as_slice() { return Err(ApiError::conflict("idempotency_key_reused")); }
        tx.commit().await?;
        return Ok(Saved { revision, break_id });
    }

    let current = sqlx::query_scalar::<_, i64>(
        "SELECT revision FROM onboarding.blueprints WHERE user_id = $1",
    )
    .bind(user)
    .fetch_optional(&mut *tx)
    .await?;
    if current != body.expected_revision {
        return Err(ApiError::conflict("blueprint_changed"));
    }
    body.blueprint.validate()?;
    body.blueprint.apply_card_defaults();
    if let Some(first) = &body.first_break {
        if current.is_some() || first.source != BreakSource::Onboarding {
            return Err(ApiError::invalid("first_break"));
        }
        first.validate()?;
    }
    let revision = current.unwrap_or(0) + 1;
    sqlx::query(
        "INSERT INTO onboarding.blueprints (user_id, revision, document) VALUES ($1, $2, $3)
         ON CONFLICT (user_id) DO UPDATE SET revision = EXCLUDED.revision, document = EXCLUDED.document",
    ).bind(user).bind(revision).bind(Json(&body.blueprint)).execute(&mut *tx).await?;
    let break_id = if let Some(first) = &body.first_break {
        Some(insert_break(&mut tx, user, first).await?)
    } else {
        None
    };
    sqlx::query(
        "UPDATE onboarding.accounts SET blueprint_completed_at = COALESCE(blueprint_completed_at, now()) WHERE id = $1",
    ).bind(user).execute(&mut *tx).await?;
    sqlx::query(
        "INSERT INTO onboarding.blueprint_requests (user_id, request_id, payload_hash, revision, break_id)
         VALUES ($1, $2, $3, $4, $5)",
    ).bind(user).bind(body.request_id).bind(hash.as_slice()).bind(revision).bind(break_id).execute(&mut *tx).await?;
    tx.commit().await?;
    tracing::info!("blueprint save committed");
    Ok(Saved { revision, break_id })
}

pub async fn save_break(
    pool: &PgPool,
    user: Uuid,
    record: &CompletedBreak,
) -> Result<Uuid, ApiError> {
    let mut tx = pool.begin().await?;
    if !lock_active(&mut tx, user).await? {
        return Err(ApiError::new(StatusCode::CONFLICT, "save_blueprint_first"));
    }
    record.validate()?;
    let id = insert_break(&mut tx, user, record).await?;
    tx.commit().await?;
    Ok(id)
}

async fn insert_break(
    tx: &mut Transaction<'_, Postgres>,
    user: Uuid,
    record: &CompletedBreak,
) -> Result<Uuid, ApiError> {
    let inserted = sqlx::query(
        "INSERT INTO onboarding.breaks (user_id, id, completed_at, document) VALUES ($1, $2, $3, $4)
         ON CONFLICT DO NOTHING",
    ).bind(user).bind(record.id).bind(record.completed_at).bind(Json(record)).execute(&mut **tx).await?;
    if inserted.rows_affected() == 0 {
        let matches = sqlx::query_scalar::<_, bool>(
            "SELECT document = $3 FROM onboarding.breaks WHERE user_id = $1 AND id = $2",
        )
        .bind(user)
        .bind(record.id)
        .bind(Json(record))
        .fetch_one(&mut **tx)
        .await?;
        if !matches {
            return Err(ApiError::conflict("break_id_reused"));
        }
    }
    Ok(record.id)
}
