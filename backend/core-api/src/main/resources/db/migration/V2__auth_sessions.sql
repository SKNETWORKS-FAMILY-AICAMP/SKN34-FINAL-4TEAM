CREATE TABLE auth_session (
    id uuid PRIMARY KEY,
    member_id uuid NOT NULL REFERENCES auth_member(id),
    device_label varchar(200) NOT NULL,
    created_at timestamptz NOT NULL,
    expires_at timestamptz NOT NULL,
    revoked boolean NOT NULL DEFAULT false
);
CREATE INDEX auth_session_member_idx ON auth_session(member_id);
CREATE TABLE auth_refresh_token (
    token_hash char(64) PRIMARY KEY,
    session_id uuid NOT NULL REFERENCES auth_session(id),
    used boolean NOT NULL DEFAULT false
);
