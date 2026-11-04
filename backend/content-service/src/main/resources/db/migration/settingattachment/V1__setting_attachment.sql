CREATE TABLE setting_attachment (
    id varchar(36) PRIMARY KEY,
    setting_document_id varchar(36) NOT NULL REFERENCES setting_document(id),
    object_key varchar(200) NOT NULL UNIQUE,
    filename varchar(120) NOT NULL,
    media_type varchar(100) NOT NULL,
    kind varchar(10) NOT NULL CHECK (kind IN ('IMAGE','FILE')),
    byte_size bigint NOT NULL CHECK (byte_size BETWEEN 1 AND 10485760),
    created_at timestamptz NOT NULL
);
CREATE INDEX setting_attachment_document ON setting_attachment(setting_document_id, created_at, id);
