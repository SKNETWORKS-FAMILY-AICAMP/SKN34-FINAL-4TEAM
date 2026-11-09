-- 플랫폼 제공 콘텐츠(장르 템플릿 세계관) 소유 관리자 계정. 로그인 불가(비밀번호 해시 아님).
INSERT INTO auth_member (id, email, password_hash, nickname, operator)
VALUES ('b09cdf87-6901-50df-9c76-881c81f4f034', 'storyfork@storyfork.invalid', '!platform-login-disabled', 'STORYFORK', true)
ON CONFLICT (id) DO NOTHING;
