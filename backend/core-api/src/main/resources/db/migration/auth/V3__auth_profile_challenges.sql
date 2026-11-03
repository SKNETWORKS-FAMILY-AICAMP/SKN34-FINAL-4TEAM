CREATE TABLE auth_profile_challenge (
    member_id uuid NOT NULL REFERENCES auth_member(id) ON DELETE CASCADE,
    purpose varchar(20) NOT NULL,
    target_email varchar(254),
    token_hash char(64) NOT NULL UNIQUE,
    expires_at timestamptz NOT NULL,
    PRIMARY KEY (member_id, purpose)
);
