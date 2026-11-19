-- LLMOps (DEC-55): alert rules and alerts, one setting and the leak sample results.
-- Langfuse owns traces, prompts, models and evaluations, so none of them is stored here. No FK to Core or Content ids (they own members and works).
CREATE TABLE operations.alert_rule (
    key VARCHAR(40) PRIMARY KEY,
    metric VARCHAR(40) NOT NULL,
    threshold NUMERIC,
    window_minutes INTEGER NOT NULL,
    enabled BOOLEAN NOT NULL DEFAULT FALSE,
    updated_at TIMESTAMPTZ NOT NULL,
    CONSTRAINT alert_rule_window_valid CHECK (window_minutes BETWEEN 1 AND 10080),
    CONSTRAINT alert_rule_threshold_valid CHECK (threshold IS NULL OR threshold >= 0)
);

-- Seeded off and without a value: an admin sets the threshold on the operations screen and then turns the rule on.
INSERT INTO operations.alert_rule (key, metric, window_minutes, updated_at) VALUES
    ('ai_failure_rate', 'failure_rate', 60, now()),
    ('ai_timeout_rate', 'timeout_rate', 60, now()),
    ('ai_daily_cost_usd', 'cost_usd', 1440, now()),
    ('ai_p95_latency_ms', 'p95_latency_ms', 60, now()),
    ('job_failed', 'failed_jobs', 1440, now()),
    ('leak_suspected', 'leak_suspected', 1440, now());

CREATE TABLE operations.operation_alert (
    id UUID PRIMARY KEY,
    rule_key VARCHAR(40) NOT NULL,
    status VARCHAR(20) NOT NULL,
    message VARCHAR(500) NOT NULL,
    value NUMERIC,
    target_ref VARCHAR(100),
    created_at TIMESTAMPTZ NOT NULL,
    acted_by UUID,
    acted_at TIMESTAMPTZ,
    note VARCHAR(500),
    CONSTRAINT operation_alert_status_valid CHECK (status IN ('open', 'acknowledged', 'resolved')),
    CONSTRAINT fk_operation_alert_rule FOREIGN KEY (rule_key) REFERENCES operations.alert_rule (key) ON DELETE RESTRICT
);

-- A rule has one unresolved (open or acknowledged) alert at a time; resolving it lets the next breach raise a new one.
CREATE UNIQUE INDEX operation_alert_one_unresolved_idx ON operations.operation_alert (rule_key) WHERE status IN ('open', 'acknowledged');
CREATE INDEX operation_alert_created_idx ON operations.operation_alert (created_at DESC, id DESC);
CREATE INDEX operation_alert_status_created_idx ON operations.operation_alert (status, created_at DESC, id DESC);

CREATE TABLE operations.llmops_setting (
    key VARCHAR(40) PRIMARY KEY,
    value VARCHAR(100) NOT NULL
);

INSERT INTO operations.llmops_setting (key, value) VALUES ('leak_sample_rate', '0.1');

CREATE TABLE operations.leak_check_result (
    id UUID PRIMARY KEY,
    trace_id VARCHAR(100) NOT NULL,
    work_id VARCHAR(100) NOT NULL,
    matched JSONB NOT NULL DEFAULT '[]',
    suspected BOOLEAN NOT NULL,
    reason TEXT,
    checked_at TIMESTAMPTZ NOT NULL,
    CONSTRAINT leak_check_result_matched_array CHECK (jsonb_typeof(matched) = 'array')
);

-- One result per sampled trace, so re-running a window never checks (or alerts on) the same trace twice.
CREATE UNIQUE INDEX leak_check_result_trace_idx ON operations.leak_check_result (trace_id);
CREATE INDEX leak_check_result_checked_idx ON operations.leak_check_result (checked_at DESC, id DESC);
