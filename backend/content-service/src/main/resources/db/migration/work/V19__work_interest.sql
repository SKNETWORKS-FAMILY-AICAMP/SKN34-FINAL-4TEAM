-- 관심 작품(기능 21-B): 회원 본인만 보는 목록. member_id는 Core 회원 UUID 문자열이라 work_view처럼 member FK를 두지 않는다.
CREATE TABLE work_interest (
    work_id varchar(36) NOT NULL REFERENCES work(id),
    member_id varchar(200) NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (work_id, member_id)
);
CREATE INDEX work_interest_member ON work_interest (member_id, created_at DESC);

-- 알림 사건 Outbox: 업무 변경과 같은 트랜잭션에서 쓰고 스케줄 발행기가 storyfork.events로 보낸 뒤 published_at을 채운다.
-- id는 알림 사건 계약의 eventId이며 재전송 때도 같은 값이다(docs/notification-event-contract.md).
CREATE TABLE content_event_outbox (
    id uuid PRIMARY KEY,
    type text NOT NULL,
    recipient_id varchar(200) NOT NULL,
    target_type text NOT NULL,
    target_id varchar(100) NOT NULL,
    occurred_at timestamptz NOT NULL,
    published_at timestamptz
);
CREATE INDEX content_event_outbox_pending ON content_event_outbox (occurred_at) WHERE published_at IS NULL;
