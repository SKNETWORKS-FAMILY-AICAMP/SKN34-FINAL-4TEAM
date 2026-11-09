CREATE TABLE operations.event (
    id UUID PRIMARY KEY,
    title VARCHAR(200) NOT NULL,
    body TEXT NOT NULL,
    starts_at TIMESTAMP(6) WITH TIME ZONE,
    ends_at TIMESTAMP(6) WITH TIME ZONE,
    created_at TIMESTAMP(6) WITH TIME ZONE NOT NULL,
    updated_at TIMESTAMP(6) WITH TIME ZONE NOT NULL,
    version BIGINT NOT NULL DEFAULT 0,
    CONSTRAINT event_title_not_blank CHECK (title !~ '^[[:space:]]*$'),
    CONSTRAINT event_body_valid CHECK (char_length(body) <= 20000 AND body !~ '^[[:space:]]*$'),
    CONSTRAINT event_period_ordered CHECK (starts_at IS NULL OR ends_at IS NULL OR ends_at >= starts_at)
);

CREATE INDEX event_created_at_id_idx ON operations.event (created_at DESC, id DESC);
