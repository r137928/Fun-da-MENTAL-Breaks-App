# Fun-da-MENTAL-Breaks-App

## Backend demo

This package contains the TypeScript onboarding API, PostgreSQL migrations, and a browser walkthrough for exercising Break Blueprint saves and first-break logging with sample profiles.

### Run locally

Run this from the repository root with Docker running.

```sh
docker compose -f demo/compose.yml up -d --build
```

Open [the local demo](http://127.0.0.1:8765) after its first build completes. `GET /ready` returns HTTP 204 when the API is ready. The Compose profile uses a local sample database and disables production authentication. See [the demo walkthrough](DEMO.md) and [the API contract](API.md).

### Develop the API

Use Node.js 24. From `backend/`, run `npm ci`, then `npm test`. Set `ONBOARDING_TEST_DATABASE_URL` to an empty disposable PostgreSQL database for `npm run test:integration`.

For a standalone backend, run `npm run build`, `npm run migrate` with the migration database connection, and then `npm start` with the runtime connection. See `backend/.env.example` for the environment variables. From the repository root, `docker build -f backend/Dockerfile -t fundamental-onboarding .` builds the production API image.

Existing databases keep their accounts, Blueprints, break logs, and save receipts. The TypeScript migration runner recognizes the original SQLx migration before applying the profile migration.

### Project knowledge

The [FUN·da·Mental Knowledge Project](https://chatgpt.com/g/g-p-6afb76582e74819192a39a1113acaaa6/project?tab=sources) and the [User Schema](https://docs.google.com/document/d/1W294kDQ5RSltTW1QumJs5eJJ1f-nlyjD52DefzR3m58/edit?tab=t.0) are linked from `AGENTS.md`.
