-- Insert-only record of admin change actions. No FK: Core owns the actor member, like report.reporter_id.
CREATE TABLE operations.admin_activity (
    id UUID PRIMARY KEY,
    actor_id UUID NOT NULL,
    action VARCHAR(40) NOT NULL,
    target_type VARCHAR(20) NOT NULL,
    target_id VARCHAR(100) NOT NULL,
    detail VARCHAR(500),
    created_at TIMESTAMPTZ NOT NULL
);

CREATE INDEX admin_activity_created_idx ON operations.admin_activity (created_at DESC, id DESC);
