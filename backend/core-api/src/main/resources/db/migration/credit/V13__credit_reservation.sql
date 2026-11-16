-- 크레딧 예약(F-CRD-01 v7). 실행 전에 동의한 상한만큼 지급분에서 미리 잡아 두고, 정산 때 실제 사용량만 차감하고 나머지를 푼다.
-- 예약 중인 양은 credit_reservation_line에만 있고, 정산·해제 때 지운다. 잔액 = 지급량 - 장부(사용·소멸) - 예약 중인 양이다.
CREATE TABLE credit_reservation (
    id uuid PRIMARY KEY,
    member_id uuid NOT NULL REFERENCES auth_member(id) ON DELETE CASCADE,
    -- 같은 작업의 중복 예약을 막고 정산 때 장부의 operation_key로도 쓴다.
    operation_key varchar(100) NOT NULL UNIQUE,
    amount numeric(19, 4) NOT NULL CHECK (amount > 0),
    status varchar(20) NOT NULL CHECK (status IN ('RESERVED', 'SETTLED', 'RELEASED')),
    settled_amount numeric(19, 4) CHECK (settled_amount >= 0),
    reserved_at timestamptz NOT NULL,
    resolved_at timestamptz,
    CHECK (settled_amount IS NULL OR settled_amount <= amount),
    CHECK ((status = 'RESERVED' AND resolved_at IS NULL AND settled_amount IS NULL)
        OR (status = 'SETTLED' AND resolved_at IS NOT NULL AND settled_amount IS NOT NULL)
        OR (status = 'RELEASED' AND resolved_at IS NOT NULL AND settled_amount IS NULL))
);
CREATE INDEX credit_reservation_member_idx ON credit_reservation(member_id);

CREATE TABLE credit_reservation_line (
    id uuid PRIMARY KEY,
    reservation_id uuid NOT NULL REFERENCES credit_reservation(id) ON DELETE CASCADE,
    grant_id uuid NOT NULL REFERENCES credit_grant(id) ON DELETE CASCADE,
    amount numeric(19, 4) NOT NULL CHECK (amount > 0),
    UNIQUE (reservation_id, grant_id)
);
CREATE INDEX credit_reservation_line_grant_idx ON credit_reservation_line(grant_id);
