CREATE TABLE episode (
    id varchar(36) PRIMARY KEY, work_id varchar(36) NOT NULL REFERENCES work(id),
    sequence integer NOT NULL CHECK(sequence > 0),
    draft_revision_floor integer NOT NULL DEFAULT -1 CHECK(draft_revision_floor >= -1),
    UNIQUE(work_id,sequence), UNIQUE(id,work_id)
);
CREATE TABLE episode_draft (
    episode_id varchar(36) PRIMARY KEY REFERENCES episode(id), title text NOT NULL, content text NOT NULL,
    edit_revision integer NOT NULL, updated_at timestamptz NOT NULL DEFAULT now()
);
