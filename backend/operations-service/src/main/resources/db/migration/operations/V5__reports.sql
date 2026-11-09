CREATE TABLE operations.report (
    id UUID PRIMARY KEY,
    kind VARCHAR(20) NOT NULL,
    work_id UUID NOT NULL,
    work_title TEXT NOT NULL,
    work_owner_id UUID NOT NULL,
    reporter_id UUID NOT NULL,
    reason TEXT NOT NULL,
    evidence TEXT NOT NULL,
    status VARCHAR(20) NOT NULL,
    content_restricted BOOLEAN NOT NULL DEFAULT FALSE,
    created_at TIMESTAMPTZ NOT NULL,
    updated_at TIMESTAMPTZ NOT NULL,
    version BIGINT NOT NULL DEFAULT 0,
    CONSTRAINT report_kind_valid CHECK (kind IN ('RIGHTS', 'HARMFUL')),
    CONSTRAINT report_status_valid CHECK (status IN ('RECEIVED', 'ACCEPTED', 'REJECTED')),
    CONSTRAINT report_reason_valid CHECK (char_length(reason) BETWEEN 1 AND 2000 AND reason ~ '[^[:space:]]'),
    CONSTRAINT report_evidence_valid CHECK (char_length(evidence) <= 5000)
);

CREATE INDEX report_created_at_id_idx ON operations.report (created_at DESC, id DESC);
CREATE INDEX report_reporter_idx ON operations.report (reporter_id);
CREATE INDEX report_work_owner_idx ON operations.report (work_owner_id);

-- Append-only action history; never cascade-delete operator records.
CREATE TABLE operations.report_history (
    id UUID PRIMARY KEY,
    report_id UUID NOT NULL,
    type VARCHAR(30) NOT NULL,
    actor_id UUID NOT NULL,
    body TEXT,
    created_at TIMESTAMPTZ NOT NULL,
    CONSTRAINT report_history_type_valid CHECK (type IN ('EVIDENCE', 'EXPLANATION', 'REVIEW', 'RESTRICT', 'UNRESTRICT', 'EVIDENCE_REQUEST')),
    CONSTRAINT fk_report_history_report FOREIGN KEY (report_id) REFERENCES operations.report (id) ON DELETE RESTRICT
);

CREATE INDEX report_history_report_created_at_id_idx ON operations.report_history (report_id, created_at ASC, id ASC);
