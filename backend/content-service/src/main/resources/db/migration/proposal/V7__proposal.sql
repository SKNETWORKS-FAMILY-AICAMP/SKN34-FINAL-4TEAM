CREATE TABLE ai_job (
    id varchar(36) PRIMARY KEY, requester_id varchar(200) NOT NULL REFERENCES member(id),
    work_id varchar(36) NOT NULL REFERENCES work(id), kind text NOT NULL,
    status text NOT NULL CHECK(status IN ('running','completed','failed')),
    failure_reason text, request_text text NOT NULL DEFAULT '', started_at timestamptz,
    created_at timestamptz NOT NULL DEFAULT now(), finished_at timestamptz
);
CREATE TABLE ai_model_call (
    id varchar(36) PRIMARY KEY, job_id varchar(36) NOT NULL REFERENCES ai_job(id), sequence integer NOT NULL,
    role text NOT NULL, provider text NOT NULL, model text, trace_ref text, status text NOT NULL,
    usage_status text NOT NULL, input_tokens integer, output_tokens integer, provider_cost decimal,
    started_at timestamptz, finished_at timestamptz, failure_code text, UNIQUE(job_id,sequence)
);
CREATE TABLE ai_input_snapshot (
    id varchar(36) PRIMARY KEY, job_id varchar(36) NOT NULL REFERENCES ai_job(id),
    episode_id varchar(36) REFERENCES episode(id), episode_version_id varchar(36) REFERENCES episode_version(id),
    setting_version_id varchar(36) REFERENCES setting_version(id), source_kind text NOT NULL,
    position text, content_snapshot text NOT NULL, draft_revision integer, captured_at timestamptz NOT NULL,
    CHECK(num_nonnulls(episode_id,episode_version_id,setting_version_id)<=1)
);
CREATE TABLE ai_proposal (
    id varchar(36) PRIMARY KEY, job_id varchar(36) NOT NULL REFERENCES ai_job(id),
    kind text NOT NULL, content text NOT NULL, created_at timestamptz NOT NULL,
    input_snapshot_id varchar(36) REFERENCES ai_input_snapshot(id), sequence integer NOT NULL DEFAULT 1
);
CREATE TABLE ai_evidence (
    id varchar(36) PRIMARY KEY, episode_version_id varchar(36) REFERENCES episode_version(id),
    setting_version_id varchar(36) REFERENCES setting_version(id), kind text NOT NULL, position text,
    excerpt_snapshot text NOT NULL, captured_at timestamptz NOT NULL,
    CHECK(num_nonnulls(episode_version_id,setting_version_id)<=1)
);
CREATE TABLE proposal_evidence (
    proposal_id varchar(36) REFERENCES ai_proposal(id), evidence_id varchar(36) REFERENCES ai_evidence(id),
    PRIMARY KEY(proposal_id,evidence_id)
);
CREATE TABLE proposal_decision (
    id varchar(36) PRIMARY KEY, proposal_id varchar(36) NOT NULL REFERENCES ai_proposal(id),
    sequence integer NOT NULL, actor_id varchar(200) REFERENCES member(id), decision text NOT NULL,
    selected_range text, approved_content text NOT NULL, decided_at timestamptz NOT NULL, UNIQUE(proposal_id,sequence)
);
CREATE TABLE proposal_application (
    id varchar(36) PRIMARY KEY, decision_id varchar(36) NOT NULL REFERENCES proposal_decision(id),
    attempt_no integer NOT NULL, outcome text NOT NULL, failure_reason text, attempted_at timestamptz NOT NULL,
    UNIQUE(decision_id,attempt_no)
);
CREATE TABLE proposal_episode_change (
    id varchar(36) PRIMARY KEY, application_id varchar(36) NOT NULL REFERENCES proposal_application(id),
    episode_id varchar(36) NOT NULL REFERENCES episode(id), result_version_id varchar(36),
    position text, before_content text NOT NULL, after_content text NOT NULL,
    base_draft_revision integer NOT NULL, result_draft_revision integer NOT NULL,
    FOREIGN KEY(episode_id,result_version_id) REFERENCES episode_version(episode_id,id)
);
CREATE TRIGGER proposal_decision_immutable BEFORE UPDATE OR DELETE ON proposal_decision
    FOR EACH ROW EXECUTE FUNCTION reject_content_history_mutation();
