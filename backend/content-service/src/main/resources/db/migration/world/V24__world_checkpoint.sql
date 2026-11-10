CREATE TABLE world_checkpoint (
    id text PRIMARY KEY,
    work_id varchar(36) NOT NULL REFERENCES work(id),
    created_at timestamptz NOT NULL,
    snapshot text NOT NULL
);
CREATE INDEX world_checkpoint_work ON world_checkpoint(work_id, created_at DESC, id DESC);
