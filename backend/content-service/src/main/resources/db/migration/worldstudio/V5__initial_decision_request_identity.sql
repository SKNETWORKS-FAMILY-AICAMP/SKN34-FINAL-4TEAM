-- Preserve historical decisions without inventing request identity or author comments.
ALTER TABLE worldstudio.initial_decision
    ADD COLUMN request_key text,
    ADD COLUMN request_hash text,
    ADD COLUMN comment text;
ALTER TABLE worldstudio.initial_decision ADD CONSTRAINT initial_decision_request_identity CHECK (
    (request_key IS NULL AND request_hash IS NULL AND comment IS NULL)
    OR (request_key IS NOT NULL AND request_hash IS NOT NULL AND comment IS NOT NULL
        AND request_key ~ '^[A-Za-z0-9:_-]{1,200}$' AND request_hash ~ '^[a-f0-9]{64}$' AND char_length(comment)<=3000)
);
CREATE UNIQUE INDEX initial_decision_request_key ON worldstudio.initial_decision(candidate_id,request_key)
    WHERE request_key IS NOT NULL;
