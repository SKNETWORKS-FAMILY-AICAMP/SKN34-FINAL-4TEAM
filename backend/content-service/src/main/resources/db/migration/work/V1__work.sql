-- Fresh development schema only. Auth owns credentials in its separate tables/history.
-- member is a credential-free local content reference, never an authentication source.
CREATE TABLE member (
    id varchar(200) PRIMARY KEY, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE work (
    id varchar(36) PRIMARY KEY, owner_id varchar(200) NOT NULL REFERENCES member(id),
    title text NOT NULL, description text NOT NULL,
    origin_kind text NOT NULL CHECK(origin_kind IN ('original','fork')),
    revision integer NOT NULL CHECK(revision >= 0), audience_rating text,
    deleted_episode_revision integer NOT NULL DEFAULT 0 CHECK(deleted_episode_revision >= 0),
    created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX work_owner ON work(owner_id);
CREATE TABLE genre (id varchar(36) PRIMARY KEY, code text NOT NULL UNIQUE, name text NOT NULL);
CREATE TABLE work_genre (
    work_id varchar(36) REFERENCES work(id), genre_id varchar(36) REFERENCES genre(id),
    PRIMARY KEY(work_id,genre_id)
);
CREATE TABLE work_rights_declaration (
    id varchar(36) PRIMARY KEY, work_id varchar(36) NOT NULL REFERENCES work(id),
    member_id varchar(200) NOT NULL REFERENCES member(id), notice_version text NOT NULL,
    response text NOT NULL, confirmed_at timestamptz NOT NULL
);
CREATE FUNCTION reject_content_history_mutation() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    RAISE EXCEPTION 'Immutable content history cannot be overwritten' USING ERRCODE='23514';
END;
$$;
