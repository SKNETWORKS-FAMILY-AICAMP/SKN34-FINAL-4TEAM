-- 운영 회원 조회·이용 제한(docs/design/operations-member-report-contract.md). 기존 회원의 created_at은 마이그레이션 시각이다.
ALTER TABLE auth_member ADD COLUMN created_at timestamptz NOT NULL DEFAULT now();
ALTER TABLE auth_member ADD COLUMN restricted boolean NOT NULL DEFAULT false;

-- 공개된 비밀번호를 사용하는 샘플 관리자. 로그인: admin@example.test / StoryforkDev123! (V4와 같은 해시)
-- 기존 회원의 비밀번호·프로필·권한은 변경하지 않는다.
INSERT INTO auth_member (id, email, password_hash, nickname, operator)
VALUES (
    '5f0c2c7e-8a51-4d6b-9a39-1f4f2b6d0a01',
    'admin@example.test',
    '$2y$10$ECldyjigcQcca390f4Z9F.3zg0fEPB3kyDxJJ1tsqaVas2Q.bjZ3.',
    '운영 관리자', true
)
ON CONFLICT (email) DO NOTHING;
