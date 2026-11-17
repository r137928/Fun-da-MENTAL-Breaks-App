-- Run with psql as the migration role after creating a LOGIN role named onboarding_runtime.
GRANT USAGE ON SCHEMA onboarding TO onboarding_runtime;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA onboarding TO onboarding_runtime;
