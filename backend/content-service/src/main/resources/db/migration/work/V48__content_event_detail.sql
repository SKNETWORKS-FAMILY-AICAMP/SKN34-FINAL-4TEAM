-- 알림 문구 재료(#941). 알림 사건 계약의 선택 필드 detail(title·episodeNumber·subject·reason)이며 Core가 문구를 만들 때 길이를 자른다.
ALTER TABLE content_event_outbox ADD COLUMN detail_title text;
ALTER TABLE content_event_outbox ADD COLUMN detail_episode integer;
ALTER TABLE content_event_outbox ADD COLUMN detail_subject text;
ALTER TABLE content_event_outbox ADD COLUMN detail_reason text;
