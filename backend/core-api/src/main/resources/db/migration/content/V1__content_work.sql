CREATE TABLE content_work (
    id varchar(36) PRIMARY KEY,
    owner_id varchar(200) NOT NULL,
    source_id varchar(36) REFERENCES content_work(id),
    visibility varchar(10) NOT NULL CHECK (visibility IN ('private','public')),
    payload jsonb NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE(owner_id, source_id)
);
CREATE INDEX content_work_owner ON content_work(owner_id);
CREATE INDEX content_work_public ON content_work(created_at DESC) WHERE visibility='public';
