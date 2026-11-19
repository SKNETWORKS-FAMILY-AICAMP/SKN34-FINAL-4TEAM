-- Operations scheduler (DEC-55): schedules and the run records of operations jobs.
-- V8 (alert and LLMOps tables) is merged first; Flyway accepts the version gap on a fresh database.
CREATE TABLE operations.scheduled_job (
    id UUID PRIMARY KEY,
    kind VARCHAR(40) NOT NULL,
    cron VARCHAR(100) NOT NULL,
    enabled BOOLEAN NOT NULL DEFAULT TRUE,
    params JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL,
    updated_at TIMESTAMPTZ NOT NULL,
    version BIGINT NOT NULL DEFAULT 0,
    CONSTRAINT scheduled_job_params_object CHECK (jsonb_typeof(params) = 'object')
);

-- One execution of a schedule. Not source independent yet: schedule_id is required until a source other than
-- operations-scheduler (Airflow) writes rows here; external_ref is for that source and is not mapped by the entity.
-- No version column: only the scheduler thread updates a run, and a retry only inserts one.
-- retry_of: a manual re-run records the failed run it re-ran, so that run stays refused (409) whatever its re-run did;
-- the re-run is a record of its own and can be re-run if it failed.
CREATE TABLE operations.job_run (
    id UUID PRIMARY KEY,
    schedule_id UUID NOT NULL,
    kind VARCHAR(40) NOT NULL,
    source VARCHAR(40) NOT NULL,
    status VARCHAR(20) NOT NULL,
    trigger VARCHAR(20) NOT NULL,
    done INTEGER,
    total INTEGER,
    created_at TIMESTAMPTZ NOT NULL,
    started_at TIMESTAMPTZ,
    finished_at TIMESTAMPTZ,
    error VARCHAR(500),
    target_id VARCHAR(100),
    external_ref VARCHAR(200),
    retry_of UUID,
    CONSTRAINT job_run_status_valid CHECK (status IN ('QUEUED', 'RUNNING', 'SUCCEEDED', 'FAILED', 'CANCELLED')),
    CONSTRAINT job_run_trigger_valid CHECK (trigger IN ('SCHEDULE', 'MANUAL')),
    -- Schedules are cancelled with enabled = false and never deleted, so their runs are never orphaned.
    CONSTRAINT fk_job_run_schedule FOREIGN KEY (schedule_id) REFERENCES operations.scheduled_job (id) ON DELETE RESTRICT,
    CONSTRAINT fk_job_run_retry_of FOREIGN KEY (retry_of) REFERENCES operations.job_run (id)
);

CREATE INDEX job_run_created_idx ON operations.job_run (created_at DESC, id DESC);
CREATE INDEX job_run_schedule_created_idx ON operations.job_run (schedule_id, created_at DESC, id DESC);
