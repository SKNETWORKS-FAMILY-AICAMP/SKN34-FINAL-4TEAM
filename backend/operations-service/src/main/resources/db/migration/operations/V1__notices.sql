CREATE TABLE operations.notice (
    id UUID PRIMARY KEY,
    title VARCHAR(200) NOT NULL,
    body TEXT NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL,
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL,
    version BIGINT NOT NULL DEFAULT 0,
    CONSTRAINT notice_title_not_blank CHECK (title ~ '[^[:space:]]'),
    CONSTRAINT notice_body_valid CHECK (char_length(body) BETWEEN 1 AND 20000 AND body ~ '[^[:space:]]')
);

CREATE INDEX notice_created_at_id_idx ON operations.notice (created_at DESC, id DESC);
