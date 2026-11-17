# Onboarding API

All bodies use JSON and snake case. Timestamps use RFC 3339 in UTC. Dates in plan overrides use YYYY-MM-DD. Protected requests require an approved access token in the Authorization Bearer header. The account ID comes from the verified token.

| Method and path | Input | Result |
|---|---|---|
| POST /v1/auth/apple | identity_token, authorization_code, nonce, eligibility | access_token, refresh_token, expires_in |
| POST /v1/auth/email/start | email, eligibility | attempt_id |
| POST /v1/auth/email/verify | attempt_id, code | access_token, refresh_token, expires_in |
| POST /v1/auth/refresh | refresh_token | Rotated access_token and refresh_token |
| POST /v1/auth/signout | Bearer token | 204, revokes this application session |
| GET /v1/me | Bearer token | user_id, setup_complete, blueprint, revision, recent_breaks |
| PUT /v1/me/blueprint | request_id, expected_revision, blueprint, first_break | revision, break_id |
| POST /v1/me/breaks | Completed break | break_id |
| DELETE /v1/me | Bearer token | 202, revokes access and queues provider cleanup |

Eligibility has `eligible`, `method` (`apple_age_range` or `self_declared`), and `policy_version`. Swift sends only the decision and never sends the date of birth or the Apple range. The Apple nonce in the body is the original random string. Set the nonce on the native Apple request to its SHA-256 hex digest.

The Blueprint is versioned with `schema_version: 1` and `catalog_version: 1`. It includes `goal`, `now`, `target`, `comfort`, `activities`, `plan`, `buddy`, `optional`, and an optional `nickname`. An activity preference contains `activity` and `tag`. An activity has `lane` and exactly one of `activity_id` from the catalog or `custom_name`. The plan uses seven counts from Monday to Sunday, selected windows, and an object of date overrides. The override replaces the count and windows for its date. Refer to the matching types in Swift and Rust for the complete fields and enum values.

On first save, omit `expected_revision` and send the completed onboarding break if available. For an edit, send the current revision and omit `first_break`. Retry an uncertain save with the same request ID and same payload. A 409 means the revision changed or a key was reused with a different payload. Fetch the saved Blueprint before asking the user how to resolve a revision conflict. Import a guest break into an existing account only after the user chooses to import it. Retry a break upload with the original break UUID and payload.

A completed break includes `id`, `completed_at`, `time_zone`, `activity`, `duration_seconds`, `time_bucket`, `vibe_words`, `mind_before`, `mind_after`, `presence_pct`, and `source`. A manual log may omit the before score and use an empty vibe list. The server returns up to 30 recent completed breaks with the account snapshot.

Application errors return a stable `code` and an HTTP status. Refresh once after a 401. Leave queued changes on the device when the network or provider is unavailable.
