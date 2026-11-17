use axum::{
    body::Body,
    http::{Request, StatusCode},
};
use serde_json::{Value, json};
use sqlx::PgPool;
use tower::ServiceExt;

use super::*;

fn baseline() -> Value {
    json!({"color_hex":"#3774AC","mental_balance":5,"body_presence_pct":50,"breaks_per_day":1,"duration":"one_two"})
}

fn payload() -> Value {
    json!({
        "schema_version":1,"catalog_version":1,"goal":"focus","now":baseline(),"target":baseline(),
        "comfort":"balanced","activities":[{"activity":{"lane":"movement","activity_id":"walk"},"tag":"now_often"}],
        "plan":{"weekdays":[1,1,1,1,1,0,0],"windows":["midday"],"overrides":{"2026-11-13":{"count":0,"windows":[]}}},
        "buddy":{"tone":"calm","nudge":"one_and_done","support":"minimal"},"optional":{}
    })
}

fn first_break() -> Value {
    json!({
        "id":Uuid::new_v4(),"completed_at":chrono::Utc::now(),"time_zone":"America/Phoenix",
        "activity":{"lane":"movement","activity_id":"walk"},"duration_seconds":90,
        "time_bucket":"one_two","vibe_words":["calm"],"mind_before":5,"mind_after":6,"presence_pct":65,"source":"onboarding"
    })
}

#[test]
fn validates_swift_wire_format_and_defaults() {
    let mut blueprint: model::Blueprint = serde_json::from_value(payload()).unwrap();
    blueprint.validate().unwrap();
    blueprint.apply_card_defaults();
    let encoded = serde_json::to_value(blueprint).unwrap();
    assert_eq!(encoded["optional"]["cards"]["focus_mode"], "highlight");
    assert_eq!(encoded["optional"]["cards"]["energy_reset"], "highlight");
    let mut invalid = payload();
    invalid["now"]["mental_balance"] = json!(0);
    assert!(
        serde_json::from_value::<model::Blueprint>(invalid)
            .unwrap()
            .validate()
            .is_err()
    );
    let mut invalid = first_break();
    invalid["vibe_words"] = json!([]);
    assert!(
        serde_json::from_value::<model::CompletedBreak>(invalid)
            .unwrap()
            .validate()
            .is_err()
    );
}

#[tokio::test]
async fn rejects_unsigned_api_access() {
    let app = routes(App {
        pool: PgPoolOptions::new()
            .connect_lazy("postgres://postgres:postgres@localhost/test")
            .unwrap(),
        http: reqwest::Client::new(),
        config: Arc::new(auth::Config::from_env().unwrap()),
        signing_keys: Default::default(),
        #[cfg(feature = "local-demo")]
        demo: false,
    });
    let response = app
        .oneshot(
            Request::builder()
                .uri("/v1/me")
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::UNAUTHORIZED);
}

#[tokio::test]
async fn postgres_transaction_and_approval_contract() {
    let Ok(url) = std::env::var("ONBOARDING_TEST_DATABASE_URL") else {
        return;
    };
    let pool = PgPool::connect(&url).await.unwrap();
    sqlx::migrate!().run(&pool).await.unwrap();

    let one = Uuid::new_v4();
    let two = Uuid::new_v4();
    for user in [one, two] {
        sqlx::query("INSERT INTO onboarding.accounts (id, eligibility_method, policy_version) VALUES ($1, 'apple_age_range', 1)")
            .bind(user).execute(&pool).await.unwrap();
    }
    let mut invalid_first = first_break();
    invalid_first["presence_pct"] = json!(101);
    let invalid =
        json!({"request_id":Uuid::new_v4(),"blueprint":payload(),"first_break":invalid_first});
    assert!(
        store::save(&pool, one, serde_json::from_value(invalid).unwrap())
            .await
            .is_err()
    );
    assert!(!store::me(&pool, one).await.unwrap().setup_complete);

    let first = first_break();
    let request = json!({"request_id":Uuid::new_v4(),"blueprint":payload(),"first_break":first});
    let result = store::save(&pool, one, serde_json::from_value(request.clone()).unwrap())
        .await
        .unwrap();
    let retry = store::save(&pool, one, serde_json::from_value(request).unwrap())
        .await
        .unwrap();
    assert_eq!(result, retry);
    let record: model::CompletedBreak = serde_json::from_value(first).unwrap();
    assert_eq!(
        store::save_break(&pool, one, &record).await.unwrap(),
        record.id
    );
    assert_eq!(store::me(&pool, one).await.unwrap().recent_breaks.len(), 1);
    assert!(
        store::me(&pool, two)
            .await
            .unwrap()
            .recent_breaks
            .is_empty()
    );
    assert!(!store::me(&pool, two).await.unwrap().setup_complete);

    let edit = || {
        serde_json::from_value(
            json!({"request_id":Uuid::new_v4(),"expected_revision":1,"blueprint":payload()}),
        )
        .unwrap()
    };
    let (a, b) = tokio::join!(
        store::save(&pool, one, edit()),
        store::save(&pool, one, edit())
    );
    assert_eq!(usize::from(a.is_ok()) + usize::from(b.is_ok()), 1);
    assert_eq!(a.err().or(b.err()).unwrap().status, StatusCode::CONFLICT);

    let approval = Uuid::new_v4();
    let email = format!("{approval}@example.test");
    sqlx::query("INSERT INTO onboarding.signup_approvals VALUES ($1, 'email', $2, 'self_declared', 1, now() + interval '1 minute')")
        .bind(approval).bind(&email).execute(&pool).await.unwrap();
    let check = |address: String| json!({"user":{"email":address,"app_metadata":{"provider":"email"},"user_metadata":{"signup_approval":approval}}});
    let allowed: Value = sqlx::query_scalar("SELECT onboarding.before_user_created($1)")
        .bind(check(email))
        .fetch_one(&pool)
        .await
        .unwrap();
    assert_eq!(allowed, json!({}));
    let denied: Value = sqlx::query_scalar("SELECT onboarding.before_user_created($1)")
        .bind(check("other@example.test".to_string()))
        .fetch_one(&pool)
        .await
        .unwrap();
    assert_eq!(denied["error"]["http_code"], 403);

    let apple_approval = Uuid::new_v4();
    let subject = apple_approval.to_string();
    sqlx::query("INSERT INTO onboarding.signup_approvals VALUES ($1, 'apple', $2, 'apple_age_range', 1, now() + interval '1 minute')")
        .bind(apple_approval).bind(&subject).execute(&pool).await.unwrap();
    let apple =
        json!({"user":{"app_metadata":{"provider":"apple"},"user_metadata":{"sub":subject}}});
    let allowed: Value = sqlx::query_scalar("SELECT onboarding.before_user_created($1)")
        .bind(&apple)
        .fetch_one(&pool)
        .await
        .unwrap();
    assert_eq!(allowed, json!({}));
    sqlx::query("UPDATE onboarding.signup_approvals SET expires_at = now() WHERE id = $1")
        .bind(apple_approval)
        .execute(&pool)
        .await
        .unwrap();
    let expired: Value = sqlx::query_scalar("SELECT onboarding.before_user_created($1)")
        .bind(apple)
        .fetch_one(&pool)
        .await
        .unwrap();
    assert_eq!(expired["error"]["http_code"], 403);

    let session_id = Uuid::new_v4();
    sqlx::query("INSERT INTO onboarding.approved_sessions VALUES ($1, $2, 'apple_age_range', 1)")
        .bind(session_id)
        .bind(one)
        .execute(&pool)
        .await
        .unwrap();
    let claims = auth::Claims {
        sub: one,
        session_id,
    };
    assert!(store::check_session(&pool, claims, 1, false).await.is_ok());
    assert!(store::check_session(&pool, claims, 2, false).await.is_err());
    assert!(
        store::check_session(
            &pool,
            auth::Claims {
                sub: two,
                session_id
            },
            1,
            false
        )
        .await
        .is_err()
    );
    let app = App {
        pool: pool.clone(),
        http: reqwest::Client::new(),
        config: Arc::new(auth::Config::from_env().unwrap()),
        signing_keys: Default::default(),
        #[cfg(feature = "local-demo")]
        demo: false,
    };
    assert_eq!(
        auth::delete(State(app), User(one)).await.unwrap(),
        StatusCode::ACCEPTED
    );
    assert!(store::check_session(&pool, claims, 1, false).await.is_err());
    let queued: bool =
        sqlx::query_scalar("SELECT EXISTS (SELECT 1 FROM onboarding.deletions WHERE user_id = $1)")
            .bind(one)
            .fetch_one(&pool)
            .await
            .unwrap();
    assert!(queued);
    let breaks: i64 =
        sqlx::query_scalar("SELECT count(*) FROM onboarding.breaks WHERE user_id = $1")
            .bind(one)
            .fetch_one(&pool)
            .await
            .unwrap();
    assert_eq!(breaks, 0);
    sqlx::query("DELETE FROM onboarding.signup_approvals WHERE id = $1")
        .bind(apple_approval)
        .execute(&pool)
        .await
        .unwrap();
    sqlx::query("DELETE FROM onboarding.signup_approvals WHERE id = $1")
        .bind(approval)
        .execute(&pool)
        .await
        .unwrap();
    sqlx::query("DELETE FROM onboarding.accounts WHERE id = ANY($1)")
        .bind(&[one, two][..])
        .execute(&pool)
        .await
        .unwrap();
}
