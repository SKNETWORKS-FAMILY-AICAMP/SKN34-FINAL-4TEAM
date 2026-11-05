CREATE TABLE episode_version (
    id varchar(36) PRIMARY KEY, episode_id varchar(36) NOT NULL REFERENCES episode(id),
    content_version_id varchar(36) NOT NULL, revision_no integer NOT NULL,
    title text NOT NULL, content text NOT NULL, created_at timestamptz NOT NULL,
    is_saved boolean NOT NULL DEFAULT true,
    work_world_history_id varchar(36) REFERENCES work_world_history(id),
    restored_from_id varchar(36) REFERENCES episode_version(id),
    UNIQUE(episode_id,content_version_id), UNIQUE(episode_id,id)
);
CREATE TRIGGER episode_version_immutable BEFORE UPDATE OR DELETE ON episode_version
    FOR EACH ROW EXECUTE FUNCTION reject_content_history_mutation();
