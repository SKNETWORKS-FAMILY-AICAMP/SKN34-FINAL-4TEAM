CREATE TABLE ai_thread (
    id varchar(36) PRIMARY KEY,
    requester_id varchar(200) NOT NULL REFERENCES member(id),
    work_id varchar(36) NOT NULL REFERENCES work(id),
    fork_id varchar(36) REFERENCES fork(work_id),
    created_at timestamptz NOT NULL,
    CHECK (fork_id IS NULL OR fork_id = work_id),
    UNIQUE (id, requester_id, work_id)
);
CREATE TABLE ai_run (
    id varchar(36) PRIMARY KEY REFERENCES ai_job(id),
    thread_id varchar(36) NOT NULL,
    requester_id varchar(200) NOT NULL,
    work_id varchar(36) NOT NULL,
    operation text NOT NULL CHECK (operation IN ('ask','simulate','next_draft','next_insights','review','edit','expand_conti','world_plot_change','recommend_template','auto')),
    key_hash varchar(64) NOT NULL,
    request_hash varchar(64) NOT NULL,
    scope_hash varchar(64) NOT NULL,
    basis_episode integer NOT NULL CHECK (basis_episode > 0),
    base_revision integer NOT NULL CHECK (base_revision >= 0),
    target_refs_json text NOT NULL,
    grant_expires_at timestamptz NOT NULL,
    character_name varchar(80) NOT NULL,
    max_calls integer NOT NULL CHECK (max_calls BETWEEN 1 AND 20),
    notice_version varchar(80) NOT NULL,
    status text NOT NULL CHECK (status IN ('pending','running','failed','denied')),
    dispatch_status text NOT NULL CHECK (dispatch_status IN ('pending','accepted','failed','blocked')),
    error_code text,
    created_at timestamptz NOT NULL,
    FOREIGN KEY (thread_id, requester_id, work_id) REFERENCES ai_thread(id, requester_id, work_id),
    UNIQUE (requester_id, work_id, operation, key_hash)
);
CREATE INDEX ai_run_thread_created ON ai_run(thread_id, created_at, id);
CREATE UNIQUE INDEX ai_run_active_thread ON ai_run(thread_id) WHERE status IN ('pending','running');
