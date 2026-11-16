CREATE TABLE image_generation_job (
 id UUID PRIMARY KEY, owner_id VARCHAR(255) NOT NULL, request_key UUID NOT NULL,
 input TEXT NOT NULL, input_hash VARCHAR(255) NOT NULL, status VARCHAR(255) NOT NULL, stage VARCHAR(255) NOT NULL,
 created_at TIMESTAMPTZ NOT NULL, updated_at TIMESTAMPTZ NOT NULL,
 UNIQUE(owner_id, request_key)
);
CREATE INDEX image_generation_active ON image_generation_job(status, updated_at);
