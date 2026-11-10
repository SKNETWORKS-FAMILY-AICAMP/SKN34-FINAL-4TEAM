CREATE TABLE feedback_report (
    id varchar(36) PRIMARY KEY,
    work_id varchar(36) NOT NULL REFERENCES work(id),
    episode_number integer NOT NULL CHECK (episode_number > 0),
    published_version_id varchar(36) NOT NULL REFERENCES episode_version(id),
    reporter_id varchar(200) NOT NULL,
    kind text NOT NULL CHECK (kind IN ('typo','story','question','suggestion')),
    body text NOT NULL,
    quote text,
    visibility text NOT NULL CHECK (visibility IN ('public','private')),
    status text NOT NULL CHECK (status IN ('unchecked','checked','answered','resolved','closed')),
    author_checked_at timestamptz,
    withdrawn_at timestamptz,
    created_at timestamptz NOT NULL,
    updated_at timestamptz NOT NULL
);
CREATE INDEX feedback_report_episode ON feedback_report (work_id, episode_number, created_at DESC);
CREATE INDEX feedback_report_reporter ON feedback_report (reporter_id, created_at DESC);
CREATE TABLE feedback_report_amendment (
    id varchar(36) PRIMARY KEY,
    report_id varchar(36) NOT NULL REFERENCES feedback_report(id),
    action text NOT NULL CHECK (action IN ('correct','withdraw')),
    body text,
    created_at timestamptz NOT NULL
);
CREATE TABLE feedback_report_response (
    id varchar(36) PRIMARY KEY,
    report_id varchar(36) NOT NULL REFERENCES feedback_report(id),
    author_id varchar(200) NOT NULL,
    body text NOT NULL,
    is_public boolean NOT NULL,
    created_at timestamptz NOT NULL
);
