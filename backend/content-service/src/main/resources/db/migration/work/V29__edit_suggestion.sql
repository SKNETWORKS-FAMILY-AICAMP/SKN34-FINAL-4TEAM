CREATE TABLE edit_suggestion (
    id varchar(36) PRIMARY KEY,
    work_id varchar(36) NOT NULL REFERENCES work(id),
    episode_number integer NOT NULL CHECK (episode_number > 0),
    published_version_id varchar(36) NOT NULL REFERENCES episode_version(id),
    proposer_id varchar(200) NOT NULL,
    source text NOT NULL CHECK (source IN ('reader','ai')),
    report_id varchar(36),
    before_text text NOT NULL,
    after_text text NOT NULL,
    edited_text text,
    reason text,
    status text NOT NULL CHECK (status IN ('pending','approved','rejected','held')),
    decision_reason text,
    apply_result text CHECK (apply_result IN ('applied','failed')),
    apply_failure text,
    applied_version_id varchar(36) REFERENCES episode_version(id),
    decided_at timestamptz,
    created_at timestamptz NOT NULL,
    updated_at timestamptz NOT NULL
);
CREATE INDEX edit_suggestion_work ON edit_suggestion (work_id, created_at DESC);
CREATE INDEX edit_suggestion_proposer ON edit_suggestion (proposer_id, created_at DESC);
