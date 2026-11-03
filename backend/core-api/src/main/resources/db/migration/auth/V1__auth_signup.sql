CREATE TABLE auth_member (
    id uuid PRIMARY KEY,
    email varchar(254) NOT NULL UNIQUE,
    password_hash varchar(255) NOT NULL,
    nickname varchar(80) NOT NULL,
    operator boolean NOT NULL DEFAULT false
);

CREATE TABLE auth_signup_challenge (
    email varchar(254) PRIMARY KEY,
    password_hash varchar(255) NOT NULL,
    nickname varchar(80) NOT NULL,
    token_hash char(64) NOT NULL UNIQUE,
    expires_at timestamptz NOT NULL
);
