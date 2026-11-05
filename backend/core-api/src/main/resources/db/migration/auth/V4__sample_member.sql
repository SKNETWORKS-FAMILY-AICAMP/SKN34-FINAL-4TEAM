-- 공개된 비밀번호를 사용하는 일반 샘플 회원. 기본 프로필을 포함한 모든 환경에 적용된다.
-- 로그인: writer@example.test / StoryforkDev123!
-- 기존 회원의 비밀번호·프로필·권한은 변경하지 않는다.
INSERT INTO auth_member (id, email, password_hash, nickname, operator)
VALUES (
    'b832d965-0352-4eb1-b896-7a307ba09a68',
    'writer@example.test',
    '$2y$10$ECldyjigcQcca390f4Z9F.3zg0fEPB3kyDxJJ1tsqaVas2Q.bjZ3.',
    '개발 작가', false
)
ON CONFLICT (email) DO NOTHING;
