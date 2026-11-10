-- 크레딧 원장 1차(#258). 잔액은 지급분(credit_grant)에서 장부(credit_ledger_entry)의 차감·소멸을 뺀 값으로 산출한다.
-- 구독·추가 구매·예약은 이번 범위가 아니다.
CREATE TABLE credit_grant (
    id uuid PRIMARY KEY,
    member_id uuid NOT NULL REFERENCES auth_member(id) ON DELETE CASCADE,
    kind varchar(30) NOT NULL,
    amount numeric(19, 4) NOT NULL CHECK (amount > 0),
    granted_at timestamptz NOT NULL,
    expires_at timestamptz NOT NULL,
    CHECK (expires_at > granted_at)
);
CREATE INDEX credit_grant_member_expires_idx ON credit_grant(member_id, expires_at);
-- 가입 체험 크레딧은 회원당 1회만 지급한다.
CREATE UNIQUE INDEX credit_grant_signup_trial_once_idx ON credit_grant(member_id) WHERE kind = 'signup-trial';

CREATE TABLE credit_ledger_entry (
    id uuid PRIMARY KEY,
    grant_id uuid NOT NULL REFERENCES credit_grant(id) ON DELETE CASCADE,
    kind varchar(20) NOT NULL CHECK (kind IN ('spend', 'expire')),
    amount numeric(19, 4) NOT NULL CHECK (amount > 0),
    operation_key varchar(100) NOT NULL,
    occurred_at timestamptz NOT NULL,
    -- 같은 작업(operation_key)의 중복 차감·소멸을 막는다.
    UNIQUE (operation_key, grant_id)
);
CREATE INDEX credit_ledger_entry_grant_idx ON credit_ledger_entry(grant_id);
