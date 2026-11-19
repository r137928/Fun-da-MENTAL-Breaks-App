# Onboarding API

All bodies use JSON and snake case. Timestamps use RFC 3339 in UTC. Dates in plan overrides use YYYY-MM-DD. Protected requests require an approved access token in the Authorization Bearer header. The account ID comes from the verified token.

| Method and path | Input | Result |
|---|---|---|
| POST /v1/auth/apple | identity_token, authorization_code, nonce, eligibility | access_token, refresh_token, expires_in |
| POST /v1/auth/email/start | email, eligibility | attempt_id |
| POST /v1/auth/email/verify | attempt_id, code | access_token, refresh_token, expires_in |
| POST /v1/auth/refresh | refresh_token | Rotated access_token and refresh_token |
| POST /v1/auth/signout | Bearer token | 204, revokes this application session |
| GET /v1/me | Bearer token | user_id, user, setup_complete, blueprint, revision, recent_breaks |
| PUT /v1/me/profile | User profile fields | Public User object |
| PUT /v1/me/blueprint | request_id, expected_revision, blueprint, first_break | revision, break_id |
| POST /v1/me/break-suggestions | Current check-in | Best Fit, alternatives by lane, and rule/catalog/Blueprint versions |
| POST /v1/me/breaks | Completed break | break_id, break |
| DELETE /v1/me | Bearer token | 202, revokes access and queues provider cleanup |

Eligibility has `eligible`, `method` (`apple_age_range` or `self_declared`), and `policy_version`. Swift sends only the decision and never sends the date of birth or the Apple range. The Apple nonce in the body is the original random string. Set the nonce on the native Apple request to its SHA-256 hex digest.

The Blueprint is versioned with `schema_version: 1` and `catalog_version: 1`. It includes `goal`, `now`, `target`, `comfort`, `activities`, `plan`, `buddy`, `optional`, and an optional `nickname`. An activity preference contains `activity` and `tag`. An activity has `lane` and exactly one of `activity_id` from the catalog or `custom_name`. The plan uses seven counts from Monday to Sunday, selected windows, and an object of date overrides. The override replaces the count and windows for its date. See `backend/src/model.ts` for the validators.

On first save, omit `expected_revision` and send the completed onboarding break if available. For an edit, send the current revision and omit `first_break`. Retry an uncertain save with the same request ID and same payload. A 409 means the revision changed or a key was reused with a different payload. Fetch the saved Blueprint before asking the user how to resolve a revision conflict. Import a guest break into an existing account only after the user chooses to import it. Retry a break upload with the original break UUID and payload.

A completed break includes `id`, `completed_at`, `time_zone`, `activity`, `duration_seconds`, `time_bucket`, `vibe_words`, `mind_before`, `mind_after`, `presence_pct`, and `source`. A manual log may omit the before score and use an empty vibe list. The server returns up to 30 recent completed breaks with the account snapshot.

### Personalized breaks

The Break Blueprint stores the user's goal, Stillness or Movement preference (`comfort`), tagged activities, preferred NOW and GOAL lengths, and reminder plan. The latest approved Blueprint supplies the saved preferences for `POST /v1/me/break-suggestions`. The JSON body can include `mind_before` (1–10), `vibe_words` (up to three distinct catalog values), `time_bucket`, `available_seconds` (1–86,400), `setting` (`seated`, `indoors`, or `outdoors`), and an explicit `lane`. A valid request can omit any of these fields, including before the first Blueprint save. When both time inputs are present, the smaller limit applies.

`best_fit` is a suggestion or `null`. `alternatives` holds arrays keyed by `stillness` and `movement`. Each suggestion contains `activity_id`, `lane`, `duration_seconds`, and a `reason_code` for display. The rule filters activities using the available time, confirmed setting, and `not_for_me` tags before ranking them. An explicit lane is required for Best Fit when provided. The other lane remains available as a deliberate choice. The response contains `rule_version`, `catalog_version`, and `blueprint_revision` (`null` before setup).

The recommendation route only reads the caller's Blueprint and returns `Cache-Control: no-store`. The client can use the same catalog and rules for a guest preview. Save the activity the user completes and its actual duration through the existing break endpoints. Keep the usual preferred length, the time available at check-in, and actual completed seconds as distinct values. The weekly plan applies its date override before the usual weekday count and windows. Users can start or log a break at any time.

### User and Break objects

The [User Schema](https://docs.google.com/document/d/1W294kDQ5RSltTW1QumJs5eJJ1f-nlyjD52DefzR3m58/edit?tab=t.0) defines the canonical objects. In the API, `user.user_id` is the numeric account ID. The top-level `user_id` remains the existing authentication UUID for client compatibility. Use `PUT /v1/me/profile` to supply `name`, `gender`, `age`, `mind_score`, and `presence_score`, with optional `email`, `phone`, `nickname`, `break_pref`, `goals`, and `color_palette`. The palette uses `[["now", "#3774AC"], ["goal", "#4C8549"]]`. The server sets `user_id`, `created_at`, and `role`. Existing passwordless sign-in continues through the identity provider. The internal credential field is omitted from all responses. Existing accounts can use their Blueprint and break history while `user` is null until the profile fields are supplied.

The canonical `break` has `title`, `break_type`, `duration` in whole seconds, and an optional `icon`. You can provide it within a completed-break request. Its type and duration must match the activity lane and `duration_seconds`. The server derives a Break for compatible requests and returns it inside each entry in `recent_breaks`.

Application errors return a stable `code` and an HTTP status. Refresh once after a 401. Leave queued changes on the device when the network or provider is unavailable.
