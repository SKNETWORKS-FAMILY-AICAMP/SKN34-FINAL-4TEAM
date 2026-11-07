CREATE TABLE operations.inquiry (
    id UUID PRIMARY KEY,
    title VARCHAR(200) NOT NULL,
    body TEXT NOT NULL,
    category VARCHAR(50) NOT NULL,
    created_at TIMESTAMPTZ NOT NULL,
    updated_at TIMESTAMPTZ NOT NULL,
    version BIGINT NOT NULL DEFAULT 0,
    CONSTRAINT inquiry_title_valid CHECK (char_length(title) BETWEEN 1 AND 200 AND title ~ '[^[:space:]]'),
    CONSTRAINT inquiry_body_valid CHECK (char_length(body) BETWEEN 1 AND 20000 AND body ~ '[^[:space:]]'),
    CONSTRAINT inquiry_category_valid CHECK (char_length(category) BETWEEN 1 AND 50 AND category ~ '[^[:space:]]')
);

CREATE INDEX inquiry_created_at_id_idx ON operations.inquiry (created_at DESC, id DESC);

CREATE TABLE operations.inquiry_reply (
    id UUID PRIMARY KEY,
    inquiry_id UUID NOT NULL,
    body TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL,
    updated_at TIMESTAMPTZ NOT NULL,
    version BIGINT NOT NULL DEFAULT 0,
    CONSTRAINT inquiry_reply_body_valid CHECK (char_length(body) BETWEEN 1 AND 20000 AND body ~ '[^[:space:]]'),
    -- Replies must be explicitly deleted first; never cascade operator records.
    CONSTRAINT fk_inquiry_reply_inquiry FOREIGN KEY (inquiry_id) REFERENCES operations.inquiry (id) ON DELETE RESTRICT
);

CREATE INDEX inquiry_reply_parent_created_at_id_idx ON operations.inquiry_reply (inquiry_id, created_at ASC, id ASC);
