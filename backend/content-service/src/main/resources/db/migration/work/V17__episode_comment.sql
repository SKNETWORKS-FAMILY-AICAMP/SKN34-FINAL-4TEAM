CREATE TABLE episode_comment (
    id varchar(36) PRIMARY KEY,
    work_id varchar(36) NOT NULL REFERENCES work(id),
    episode_number integer NOT NULL CHECK (episode_number > 0),
    published_version_id varchar(36) NOT NULL REFERENCES episode_version(id),
    author_id varchar(200) NOT NULL,
    author_name text NOT NULL,
    body text NOT NULL,
    quote text,
    spoiler boolean NOT NULL DEFAULT false,
    created_at timestamptz NOT NULL,
    updated_at timestamptz NOT NULL,
    deleted_at timestamptz
);
CREATE INDEX episode_comment_episode ON episode_comment (work_id, episode_number, created_at DESC) WHERE deleted_at IS NULL;
CREATE TABLE episode_comment_like (
    comment_id varchar(36) NOT NULL REFERENCES episode_comment(id),
    member_id varchar(200) NOT NULL,
    created_at timestamptz NOT NULL,
    PRIMARY KEY (comment_id, member_id)
);
