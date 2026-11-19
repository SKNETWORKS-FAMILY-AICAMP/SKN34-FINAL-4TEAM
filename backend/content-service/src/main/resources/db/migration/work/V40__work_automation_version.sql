CREATE TABLE work_automation_version (
    id varchar(36) PRIMARY KEY,
    work_id varchar(36) NOT NULL REFERENCES work(id),
    revision_no integer NOT NULL CHECK (revision_no > 0),
    writing_mode text NOT NULL CHECK (writing_mode IN ('direct', 'assisted')),
    changed_at timestamptz NOT NULL,
    UNIQUE (work_id, revision_no)
);

CREATE TRIGGER work_automation_version_immutable
    BEFORE UPDATE OR DELETE ON work_automation_version
    FOR EACH ROW EXECUTE FUNCTION reject_content_history_mutation();
