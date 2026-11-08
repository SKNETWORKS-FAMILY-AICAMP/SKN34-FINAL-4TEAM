CREATE TABLE auth_withdrawal (
    id uuid PRIMARY KEY,
    member_id uuid NOT NULL REFERENCES auth_member(id) ON DELETE CASCADE,
    requested_at timestamptz NOT NULL,
    due_at timestamptz NOT NULL,
    restored_at timestamptz,
    completed_at timestamptz,
    reason varchar(300),
    status varchar(20) NOT NULL CHECK (status IN ('PENDING', 'RESTORED', 'COMPLETED'))
);

-- 한 회원의 진행 중(유예) 탈퇴 요청은 최대 하나다.
CREATE UNIQUE INDEX auth_withdrawal_member_pending_idx ON auth_withdrawal(member_id) WHERE status = 'PENDING';
