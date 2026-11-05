-- 알림함·수신 설정 (#89 1단계). 사건/Outbox/전달 시도 테이블은 RabbitMQ 단계에서 별도 migration으로 추가한다.
CREATE TABLE notification (
    id uuid PRIMARY KEY,
    recipient_id uuid NOT NULL REFERENCES auth_member(id) ON DELETE CASCADE,
    kind varchar(40) NOT NULL,
    summary varchar(300) NOT NULL,
    target_type varchar(40),
    target_id varchar(100),
    created_at timestamptz NOT NULL,
    read_at timestamptz,
    deleted_at timestamptz
);
CREATE INDEX notification_recipient_created_idx ON notification(recipient_id, created_at DESC, id DESC);
CREATE INDEX notification_recipient_unread_idx ON notification(recipient_id) WHERE read_at IS NULL AND deleted_at IS NULL;

CREATE TABLE notification_preference (
    member_id uuid NOT NULL REFERENCES auth_member(id) ON DELETE CASCADE,
    kind varchar(40) NOT NULL,
    enabled boolean NOT NULL,
    PRIMARY KEY (member_id, kind)
);
