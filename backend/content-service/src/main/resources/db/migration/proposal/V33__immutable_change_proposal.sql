-- V7 ai_job 상태·기존 proposal accept 이력은 그대로 둔다.
CREATE TABLE change_proposal_version (
    id varchar(36) PRIMARY KEY,
    proposal_id varchar(36) NOT NULL,
    proposal_version integer NOT NULL CHECK (proposal_version > 0),
    work_id varchar(36) NOT NULL REFERENCES work(id),
    run_id varchar(36) NOT NULL REFERENCES ai_run(id),
    manifest_json text NOT NULL,
    proposal_hash varchar(64) NOT NULL CHECK (proposal_hash ~ '^[0-9a-f]{64}$'),
    key_hash varchar(64) NOT NULL,
    request_hash varchar(64) NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE (proposal_id, proposal_version),
    UNIQUE (proposal_id, proposal_version, work_id),
    UNIQUE (run_id, key_hash)
);
CREATE TABLE change_proposal_receipt (
    id varchar(36) PRIMARY KEY,
    proposal_id varchar(36) NOT NULL,
    proposal_version integer NOT NULL,
    work_id varchar(36) NOT NULL REFERENCES work(id),
    actor_id varchar(200) NOT NULL REFERENCES member(id),
    decision text NOT NULL CHECK (decision IN ('approved','rejected','revision_requested','cancelled')),
    key_hash varchar(64) NOT NULL,
    request_hash varchar(64) NOT NULL,
    receipt_json text NOT NULL,
    FOREIGN KEY (proposal_id, proposal_version, work_id)
        REFERENCES change_proposal_version(proposal_id, proposal_version, work_id),
    UNIQUE (proposal_id, proposal_version),
    UNIQUE (work_id, actor_id, key_hash)
);
CREATE TRIGGER change_proposal_version_immutable BEFORE UPDATE OR DELETE ON change_proposal_version
    FOR EACH ROW EXECUTE FUNCTION reject_content_history_mutation();
CREATE TRIGGER change_proposal_receipt_immutable BEFORE UPDATE OR DELETE ON change_proposal_receipt
    FOR EACH ROW EXECUTE FUNCTION reject_content_history_mutation();

CREATE TABLE change_decision_attempt (
    id varchar(36) PRIMARY KEY,
    work_id varchar(36) NOT NULL REFERENCES work(id),
    actor_id varchar(200) NOT NULL REFERENCES member(id),
    key_hash varchar(64) NOT NULL,
    request_hash varchar(64) NOT NULL,
    status text NOT NULL CHECK (status IN ('pending','succeeded','failed')),
    failure_status integer,
    failure_reason text,
    UNIQUE (work_id, actor_id, key_hash),
    CHECK ((status = 'failed') = (failure_status IS NOT NULL AND failure_reason IS NOT NULL))
);
