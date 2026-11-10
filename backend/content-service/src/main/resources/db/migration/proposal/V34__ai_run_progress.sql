-- Content 결과와 진행 기록은 동일 transaction. Saver schema·Core 알림에는 영향 없음.
ALTER TABLE ai_run DROP CONSTRAINT ai_run_status_check;
ALTER TABLE ai_run ADD CONSTRAINT ai_run_status_check CHECK (status IN
    ('pending','running','failed','denied','cancelled','succeeded','partial','clarification','proposal','awaiting_approval','applied','rejected','revision_requested'));
ALTER TABLE ai_run ADD COLUMN last_event_id bigint NOT NULL DEFAULT 0 CHECK (last_event_id >= 0);
ALTER TABLE ai_run ADD COLUMN result_json text;
ALTER TABLE ai_run ADD COLUMN cancel_signalled boolean NOT NULL DEFAULT false;
DROP INDEX ai_run_active_thread;
CREATE UNIQUE INDEX ai_run_active_thread ON ai_run(thread_id) WHERE status IN ('pending','running','awaiting_approval');
CREATE TABLE ai_run_event (
    id varchar(36) PRIMARY KEY,
    run_id varchar(36) NOT NULL REFERENCES ai_run(id),
    seq bigint NOT NULL CHECK (seq > 0),
    task_id varchar(64) NOT NULL CHECK (task_id ~ '^[a-z][a-z0-9_-]{0,63}$'),
    attempt integer NOT NULL CHECK (attempt BETWEEN 1 AND 3),
    phase text NOT NULL CHECK (phase IN ('run','task')),
    step integer NOT NULL CHECK (step > 0),
    code text NOT NULL CHECK (code IN ('ANALYZING','CONTEXT_LOADING','RELATIONS_LOADING','TEXT_LOADING','TEMPLATE_SEARCH',
        'SIMULATING','REVIEWING','DRAFTING','EDITING','PROPOSAL_PENDING','RESULT_READY','APPLIED','PARTIAL','FAILED','CANCELLED')),
    status text NOT NULL CHECK (status IN ('pending','running','succeeded','partial','failed','denied','clarification','cancelled',
        'proposal','awaiting_approval','applied','rejected','revision_requested','skipped')),
    UNIQUE (run_id,seq),
    UNIQUE (run_id,task_id,attempt,phase,step)
);
