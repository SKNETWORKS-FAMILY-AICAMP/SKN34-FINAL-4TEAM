-- 알림 사건 Outbox (#89). 사건은 업무 변경과 같은 트랜잭션에서 이 표에 기록하고, 별도 발행기가 RabbitMQ로 보낸다.
-- id는 계약의 eventId이며 재전송해도 바뀌지 않는다. 소비 쪽(notification.source_event_id)이 같은 값으로 중복을 한 번만 반영한다.
-- sent_at이 비어 있으면 대기 사건이다(Content의 content_event_outbox.published_at과 같은 방식).
CREATE TABLE notification_outbox (
    id uuid PRIMARY KEY,
    event_type varchar(60) NOT NULL,
    recipient_id uuid NOT NULL REFERENCES auth_member(id) ON DELETE CASCADE,
    target_type varchar(40) NOT NULL,
    target_id varchar(100) NOT NULL,
    occurred_at timestamptz NOT NULL,
    sent_at timestamptz
);
CREATE INDEX notification_outbox_pending_idx ON notification_outbox(occurred_at) WHERE sent_at IS NULL;
