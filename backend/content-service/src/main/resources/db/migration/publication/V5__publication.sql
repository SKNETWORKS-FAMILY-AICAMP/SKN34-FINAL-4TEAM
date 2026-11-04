CREATE TABLE work_publication_history (
    id varchar(36) PRIMARY KEY, work_id varchar(36) NOT NULL REFERENCES work(id),
    revision_no integer NOT NULL, visibility text NOT NULL CHECK(visibility IN ('private','public')),
    changed_at timestamptz NOT NULL DEFAULT now(), UNIQUE(work_id,revision_no)
);
CREATE TABLE publication_event (
    id varchar(36) PRIMARY KEY, episode_version_id varchar(36) NOT NULL REFERENCES episode_version(id),
    actor_id varchar(200) REFERENCES member(id), action text NOT NULL, outcome text NOT NULL,
    occurred_at timestamptz NOT NULL, trigger_kind text NOT NULL
);
CREATE INDEX publication_event_version ON publication_event(episode_version_id,occurred_at);
CREATE TRIGGER publication_event_immutable BEFORE UPDATE OR DELETE ON publication_event
    FOR EACH ROW EXECUTE FUNCTION reject_content_history_mutation();
