CREATE TABLE publication_schedule (
    id text PRIMARY KEY,
    work_id varchar(36) NOT NULL,
    episode_id varchar(36) NOT NULL,
    owner_id varchar(200) NOT NULL REFERENCES member(id),
    version_id varchar(36) NOT NULL,
    scheduled_at timestamptz NOT NULL,
    status text NOT NULL CHECK (status IN ('pending', 'published', 'failed', 'canceled')),
    revision integer NOT NULL CHECK (revision >= 0),
    completed_at timestamptz,
    failure_reason text,
    FOREIGN KEY (episode_id, work_id) REFERENCES episode(id, work_id),
    FOREIGN KEY (episode_id, version_id) REFERENCES episode_version(episode_id, content_version_id)
);
CREATE UNIQUE INDEX publication_schedule_one_pending ON publication_schedule(episode_id) WHERE status = 'pending';
CREATE INDEX publication_schedule_due ON publication_schedule(scheduled_at, id) WHERE status = 'pending';
CREATE INDEX publication_schedule_episode ON publication_schedule(episode_id, scheduled_at DESC, id DESC);
