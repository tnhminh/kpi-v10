CREATE UNIQUE INDEX users_email_lower_uq ON users (lower(email));

CREATE TABLE auth_login_attempts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  key_hash text NOT NULL UNIQUE,
  failed_count integer NOT NULL DEFAULT 0,
  window_started_at timestamptz NOT NULL DEFAULT now(),
  blocked_until timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT auth_login_attempts_failed_count_nonnegative CHECK (failed_count >= 0)
);

CREATE INDEX auth_login_attempts_blocked_idx ON auth_login_attempts(blocked_until);
