ALTER TABLE onboarding.accounts
    ADD COLUMN public_id integer GENERATED ALWAYS AS IDENTITY UNIQUE,
    ADD COLUMN created_at timestamptz;
UPDATE onboarding.accounts SET created_at = eligibility_checked_at;
ALTER TABLE onboarding.accounts
    ALTER COLUMN created_at SET DEFAULT now(),
    ALTER COLUMN created_at SET NOT NULL;

CREATE TABLE onboarding.user_profiles (
    account_id uuid PRIMARY KEY REFERENCES onboarding.accounts ON DELETE CASCADE,
    profile jsonb NOT NULL CHECK (jsonb_typeof(profile) = 'object'),
    password text NOT NULL DEFAULT '!provider-managed' CHECK (password <> ''),
    role text NOT NULL DEFAULT 'user' CHECK (role <> '')
);

DO $$
BEGIN
    IF EXISTS (SELECT FROM pg_catalog.pg_roles WHERE rolname = 'onboarding_runtime') THEN
        GRANT SELECT, INSERT, UPDATE, DELETE ON onboarding.user_profiles TO onboarding_runtime;
        GRANT USAGE, SELECT ON SEQUENCE onboarding.accounts_public_id_seq TO onboarding_runtime;
    END IF;
END;
$$;
