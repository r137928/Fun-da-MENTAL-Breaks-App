# FUNdaMental Supabase backend

Express and TypeScript with models, controllers, routes, and Supabase Auth. This backend follows User Schema (8).

## Run

Use Node 22 or newer. Run npm ci, copy .env.example to .env, and set the project URL, publishable key, frontend origin, and port. Run npm run dev, or npm run build followed by npm start.

## Apply the schema update

Existing test project with the original tables already created

1. Open Supabase SQL Editor.
2. Run supabase/migrations/202611190002_schema_v8.sql once.
3. Restart the backend if it is running without the development watcher.

Fresh project

Run 202611190001_initial.sql, then 202611190002_schema_v8.sql, in that order.

The update runs inside a transaction. It keeps existing accounts, activity identifiers, and logs. Original activity duration values remain in the legacy duration column and also populate duration_bucket. Existing profile scores and free-form preferences are retained. Newly submitted preferences must use the allowed choices. Existing gender/preferences can remain unchanged when editing other fields.

Duration conversion for existing numeric minutes uses <=5, <=10, <=15, <=20, then 20+. Users select one bucket for new activities, with flexible boundaries. These buckets do not determine logged actual time.

## Authentication and profile data

The frontend signs in through Supabase Auth and sends Authorization: Bearer ACCESS_TOKEN on API requests. Each request verifies the token and uses the signed-in user's database context.

Supabase Auth owns email, passwords, identities, and sessions. Profile responses include the verified account email as email. Email and password changes use Supabase Auth. They are not profile-edit fields.

Profiles require name, age, and gender on creation. Gender options are female, male, non-binary, and prefer not to say. Phone is optional text. The age range validates a number; age eligibility and guardian flows remain product decisions.

break_pref accepts multiple unique choices from stillness, movement, balanced, and depends. goals remains an optional string array pending the sponsor decision. Empty preferences/goals are stored as empty arrays. color_palette is an optional object with now and goal hex colors.

mind_score and presence_score are nullable, read-only profile fields. New profiles start with empty scores. Existing original baseline values are retained for review. A calculation formula has not been selected, so this update does not recalculate profile scores. Roles default to user and can be changed through trusted database administration. Authenticated clients cannot change roles or calculated scores, including through direct Data API requests.

Example POST /api/users/me

    {
      "name": "Alex",
      "gender": "prefer not to say",
      "age": 21,
      "break_pref": ["stillness", "movement"],
      "goals": ["calm"],
      "color_palette": {"now": "#3388CC", "goal": "#44AA66"}
    }

## Reusable activities

GET /api/breaks returns app-provided activities (created_by is null) and the caller's own activities. Users create, edit, and delete their own activities. Shared activities are maintained through trusted database administration. Other users' custom activities stay private.

Use break_id as the identifier and created_by as the optional creator reference. The original id and user_id response aliases remain available. The old numeric duration input is still accepted and converted to a bucket; new clients should send duration_bucket.

Example POST /api/breaks

    {"title": "Quiet walk", "break_type": "movement", "duration_bucket": "5_to_10"}

Allowed duration buckets are 1_to_5, 5_to_10, 10_to_15, 15_to_20, and 20+. break_type is stillness or movement.

## Break logs

Logs store snapshots of title/type so history survives changes to a saved activity. break_id is optional for one-off activities. It can reference only a shared activity or one owned by the caller. Deleting a reusable activity clears its reference on logs while preserving the recorded history.

Example POST /api/break-logs for a manual break

    {
      "title": "Quiet walk",
      "break_type": "movement",
      "source": "manual",
      "occurred_at": "2026-11-19T09:00:00-07:00",
      "actual_duration_secs": 420,
      "mind_score_before": 4,
      "mind_score_after": 7,
      "break_presence_score": 65
    }

source is timer or manual. Omitted status defaults to completed for manual logs and in_progress for timer logs. To finish a timer, PATCH the log with status completed, measured actual_duration_secs, and any completion timestamp/scores. Only completed logs count toward completed-break totals. The optional status query parameter filters the log list.

occurred_at records when the break happened. created_at records when it was saved. Exact started_at and completed_at are optional. Timestamps include a timezone offset or Z. Completion cannot precede the start, and an in-progress log cannot have completed_at. Positive actual_duration_secs can be entered manually or measured. Null duration means unknown time. Scores are optional, with mind scores 1-10 and presence 0-100.

The break_log_totals view provides completed_breaks, breaks_with_duration, and total_duration_secs under the same user access rules. Missing duration adds no time. Calculated profile scores and local-day streak calculations remain pending product definitions.

The optional icon on a log is a snapshot. Creating a log does not automatically create a saved activity; create the activity through /api/breaks first when the user chooses to save it.

## Endpoints

- GET /health
- GET, POST, PATCH /api/users/me
- GET, POST /api/breaks
- PATCH, DELETE /api/breaks/:id
- GET, POST /api/break-logs
- GET, PATCH, DELETE /api/break-logs/:id

List endpoints accept offset (default 0) and limit (default 20, maximum 100). The log list also accepts status. POST returns 201, successful DELETE returns 204, and absent/inaccessible records return 404. Validation errors return 400. Duplicate profile creation returns 409. Ownership, IDs, roles, creation times, and profile summaries cannot be supplied as editable request fields.

## Verification

Run npm run check and npm run build. The schema update was exercised locally on PostgreSQL through PGlite with Supabase-like Auth roles. Tests covered migration of original data, authenticated access rules, shared activity ownership, cross-user isolation, source/status defaults, completed-only totals, timestamps, and deletion behavior. API routing and validation were also checked locally.

The migration has not been applied to your hosted Supabase project. Hosted authentication, project-specific privileges, and dashboard configuration still need verification after applying it.

## Official references

- https://supabase.com/docs/reference/javascript/auth-getuser
- https://supabase.com/docs/guides/database/postgres/row-level-security
- https://supabase.com/docs/guides/auth/managing-user-data
