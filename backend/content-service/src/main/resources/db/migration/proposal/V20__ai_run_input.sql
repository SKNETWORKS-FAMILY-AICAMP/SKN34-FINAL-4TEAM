-- 사용자 요청은 Content만 보존한다. SSE/checkpoint/log에 본문을 추가하지 않는다.
ALTER TABLE ai_run ADD COLUMN input_json text;
