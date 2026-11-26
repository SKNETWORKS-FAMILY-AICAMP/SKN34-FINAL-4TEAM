CREATE TABLE notification_push_device (
    installation_id uuid PRIMARY KEY,
    session_id uuid NOT NULL REFERENCES auth_session(id) ON DELETE CASCADE,
    token varchar(4096) NOT NULL,
    endpoint_arn varchar(512)
);
CREATE INDEX notification_push_device_session_idx ON notification_push_device(session_id);
