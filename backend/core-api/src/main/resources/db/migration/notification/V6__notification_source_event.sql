-- 사건(RabbitMQ) 기반 알림의 멱등 키. 같은 eventId가 다시 도착해도 알림은 한 번만 만들어진다.
-- 삭제는 행을 지우지 않고 deleted_at만 표시하므로 삭제된 알림도 이 키가 남아 재전달로 되살아나지 않는다.
ALTER TABLE notification ADD COLUMN source_event_id uuid;
CREATE UNIQUE INDEX notification_source_event_uidx ON notification(source_event_id) WHERE source_event_id IS NOT NULL;
