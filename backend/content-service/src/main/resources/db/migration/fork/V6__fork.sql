CREATE TABLE checkpoint (
    id varchar(36) PRIMARY KEY, work_id varchar(36) NOT NULL REFERENCES work(id),
    episode_id varchar(36) NOT NULL, basis_episode_version_id varchar(36) NOT NULL,
    graph_state_ref text, status text NOT NULL DEFAULT 'content_only',
    created_at timestamptz NOT NULL DEFAULT now(), UNIQUE(id,work_id),
    FOREIGN KEY(episode_id,basis_episode_version_id) REFERENCES episode_version(episode_id,id)
);
CREATE TABLE checkpoint_episode (
    checkpoint_id varchar(36) NOT NULL REFERENCES checkpoint(id), source_work_id varchar(36) NOT NULL,
    episode_id varchar(36) NOT NULL, episode_version_id varchar(36) NOT NULL,
    PRIMARY KEY(checkpoint_id,episode_id),
    FOREIGN KEY(episode_id,source_work_id) REFERENCES episode(id,work_id),
    FOREIGN KEY(episode_id,episode_version_id) REFERENCES episode_version(episode_id,id)
);
CREATE TABLE checkpoint_setting (
    checkpoint_id varchar(36) NOT NULL REFERENCES checkpoint(id), setting_document_id varchar(36) NOT NULL,
    setting_version_id varchar(36) NOT NULL, PRIMARY KEY(checkpoint_id,setting_document_id),
    FOREIGN KEY(setting_document_id,setting_version_id) REFERENCES setting_version(setting_document_id,id)
);

CREATE TABLE fork_policy_history (
    id varchar(36) PRIMARY KEY, work_id varchar(36) NOT NULL REFERENCES work(id),
    allow_creation boolean NOT NULL, allow_publication boolean NOT NULL,
    episode_scope text NOT NULL DEFAULT 'all', start_episode_id varchar(36),
    changed_at timestamptz NOT NULL, revision_no integer NOT NULL,
    CHECK(episode_scope IN ('all','from','selected')),
    FOREIGN KEY(start_episode_id,work_id) REFERENCES episode(id,work_id), UNIQUE(work_id,id)
);
CREATE TABLE fork_policy_episode (
    policy_history_id varchar(36) NOT NULL, work_id varchar(36) NOT NULL, episode_id varchar(36) NOT NULL,
    PRIMARY KEY(policy_history_id,episode_id),
    FOREIGN KEY(work_id,policy_history_id) REFERENCES fork_policy_history(work_id,id),
    FOREIGN KEY(episode_id,work_id) REFERENCES episode(id,work_id)
);
CREATE TABLE fork (
    work_id varchar(36) PRIMARY KEY REFERENCES work(id), source_work_id varchar(36) NOT NULL REFERENCES work(id),
    owner_id varchar(200) NOT NULL REFERENCES member(id), source_checkpoint_id varchar(36) NOT NULL,
    confirmed_policy_history_id varchar(36), conditions_confirmed_at timestamptz,
    source_title text NOT NULL, direction text NOT NULL, world_revision integer NOT NULL DEFAULT 0,
    created_at timestamptz NOT NULL DEFAULT now(), UNIQUE(owner_id,source_work_id),
    FOREIGN KEY(source_checkpoint_id,source_work_id) REFERENCES checkpoint(id,work_id),
    FOREIGN KEY(source_work_id,confirmed_policy_history_id) REFERENCES fork_policy_history(work_id,id)
);
CREATE TABLE fork_world_reference (
    fork_work_id varchar(36) PRIMARY KEY REFERENCES fork(work_id), source_world_id varchar(36) NOT NULL REFERENCES world(id),
    reference_status text NOT NULL CHECK(reference_status IN ('following','independent')),
    last_followed_checkpoint_id varchar(36) REFERENCES checkpoint(id), detached_at timestamptz
);
CREATE TABLE fork_source_setting (
    fork_work_id varchar(36) NOT NULL REFERENCES fork(work_id), setting_document_id varchar(36) NOT NULL,
    setting_version_id varchar(36) NOT NULL, PRIMARY KEY(fork_work_id,setting_document_id),
    FOREIGN KEY(setting_document_id,setting_version_id) REFERENCES setting_version(setting_document_id,id)
);
CREATE TABLE fork_source_change (
    id varchar(36) PRIMARY KEY, fork_work_id varchar(36) NOT NULL REFERENCES fork(work_id), source_change_ref text NOT NULL,
    before_checkpoint_id varchar(36) REFERENCES checkpoint(id), after_checkpoint_id varchar(36) REFERENCES checkpoint(id),
    detected_at timestamptz NOT NULL DEFAULT now(), UNIQUE(fork_work_id,source_change_ref)
);
CREATE TABLE fork_change_decision (
    id varchar(36) PRIMARY KEY, source_change_id varchar(36) NOT NULL REFERENCES fork_source_change(id),
    actor_id varchar(200) NOT NULL REFERENCES member(id), decision text NOT NULL CHECK(decision IN ('apply','reject')),
    decided_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE fork_change_application (
    id varchar(36) PRIMARY KEY, decision_id varchar(36) NOT NULL REFERENCES fork_change_decision(id),
    result_checkpoint_id varchar(36) REFERENCES checkpoint(id), outcome text NOT NULL,
    reason text, applied_at timestamptz NOT NULL DEFAULT now()
);
CREATE TRIGGER fork_decision_immutable BEFORE UPDATE OR DELETE ON fork_change_decision
    FOR EACH ROW EXECUTE FUNCTION reject_content_history_mutation();
