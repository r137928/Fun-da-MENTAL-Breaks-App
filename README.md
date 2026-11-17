# Fun-da-MENTAL-Breaks-App

## Backend demo

This package contains the Rust onboarding API, PostgreSQL migration, and a browser walkthrough for exercising Break Blueprint saves and first-break logging with sample profiles.

### Run locally

Run this from the repository root with Docker running.

```sh
docker compose -f demo/compose.yml up -d
```

Open [the local demo](http://127.0.0.1:8765) after its first build completes. `GET /ready` returns HTTP 204 when the API is ready. The Compose profile uses a local sample database and disables production authentication. See [the demo walkthrough](DEMO.md) and [the API contract](API.md).

### Develop the API

Run `cargo test --locked --features local-demo` from `backend/`. To build the API image without the local demo, run `docker build -f backend/Dockerfile -t fundamental-onboarding .` from this directory. The browser harness and activity catalog sit beside `backend/` because the demo build embeds those files.
