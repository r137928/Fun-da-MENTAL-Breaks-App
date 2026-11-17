CREATE SCHEMA onboarding;
REVOKE ALL ON SCHEMA onboarding FROM PUBLIC;

CREATE TABLE onboarding.accounts (
    id uuid PRIMARY KEY,
    eligibility_method text NOT NULL CHECK (eligibility_method IN ('self_declared', 'apple_age_range')),
    policy_version integer NOT NULL CHECK (policy_version > 0),
    eligibility_checked_at timestamptz NOT NULL DEFAULT now(),
    status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'deleting')),
    blueprint_completed_at timestamptz,
    apple_subject text UNIQUE,
    apple_refresh_encrypted bytea
);

CREATE TABLE onboarding.approved_sessions (
    session_id uuid PRIMARY KEY,
    user_id uuid NOT NULL REFERENCES onboarding.accounts ON DELETE CASCADE,
    eligibility_method text NOT NULL CHECK (eligibility_method IN ('self_declared', 'apple_age_range')),
    policy_version integer NOT NULL
);
CREATE INDEX approved_sessions_user ON onboarding.approved_sessions (user_id);

CREATE TABLE onboarding.blueprints (
    user_id uuid PRIMARY KEY REFERENCES onboarding.accounts ON DELETE CASCADE,
    revision bigint NOT NULL CHECK (revision > 0),
    document jsonb NOT NULL
);

CREATE TABLE onboarding.breaks (
    user_id uuid NOT NULL REFERENCES onboarding.accounts ON DELETE CASCADE,
    id uuid NOT NULL,
    completed_at timestamptz NOT NULL,
    document jsonb NOT NULL,
    PRIMARY KEY (user_id, id)
);

CREATE TABLE onboarding.blueprint_requests (
    user_id uuid NOT NULL REFERENCES onboarding.accounts ON DELETE CASCADE,
    request_id uuid NOT NULL,
    payload_hash bytea NOT NULL,
    revision bigint NOT NULL,
    break_id uuid,
    PRIMARY KEY (user_id, request_id)
);

CREATE TABLE onboarding.signup_approvals (
    id uuid PRIMARY KEY,
    provider text NOT NULL CHECK (provider IN ('email', 'apple')),
    subject text NOT NULL,
    eligibility_method text NOT NULL CHECK (eligibility_method IN ('self_declared', 'apple_age_range')),
    policy_version integer NOT NULL,
    expires_at timestamptz NOT NULL
);
CREATE INDEX signup_approval_subject ON onboarding.signup_approvals (provider, subject, expires_at);

CREATE TABLE onboarding.deletions (
    user_id uuid PRIMARY KEY REFERENCES onboarding.accounts ON DELETE CASCADE,
    apple_revoked boolean NOT NULL DEFAULT false,
    requested_at timestamptz NOT NULL DEFAULT now()
);

-- This hook authorizes Auth identity creation. Rust separately approves the
-- resulting session before it can access any application data.
CREATE FUNCTION onboarding.before_user_created(event jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    identity jsonb := event->'user';
    provider_name text := identity->'app_metadata'->>'provider';
BEGIN
    IF EXISTS (
        SELECT 1 FROM onboarding.signup_approvals AS approval
        WHERE approval.expires_at > now()
        AND approval.provider = provider_name
        AND CASE provider_name
            WHEN 'apple' THEN approval.subject = identity->'user_metadata'->>'sub'
            WHEN 'email' THEN approval.subject = lower(identity->>'email')
                 AND approval.id::text = identity->'user_metadata'->>'signup_approval'
            ELSE false
        END
    ) THEN
        RETURN '{}'::jsonb;
    END IF;
    RETURN '{"error":{"http_code":403,"message":"Start signup in the app."}}'::jsonb;
END;
$$;

REVOKE ALL ON FUNCTION onboarding.before_user_created(jsonb) FROM PUBLIC;
DO $$
BEGIN
    IF EXISTS (SELECT FROM pg_catalog.pg_roles WHERE rolname = 'supabase_auth_admin') THEN
        GRANT USAGE ON SCHEMA onboarding TO supabase_auth_admin;
        GRANT EXECUTE ON FUNCTION onboarding.before_user_created(jsonb) TO supabase_auth_admin;
    END IF;
END;
$$;
