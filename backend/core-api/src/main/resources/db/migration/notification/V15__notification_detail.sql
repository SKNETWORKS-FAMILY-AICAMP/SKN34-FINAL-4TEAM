-- 알림 문구 구체화(#941). 회차 단위 사건의 회차 번호(알림을 누르면 그 회차로 이동)와 ai-tool 묶음에 합쳐진 사건 수("외 n건")를 둔다.
ALTER TABLE notification ADD COLUMN target_episode integer;
ALTER TABLE notification ADD COLUMN bundled_count integer NOT NULL DEFAULT 0;
