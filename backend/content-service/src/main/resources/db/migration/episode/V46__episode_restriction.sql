-- 운영자의 회차 제한: 독자 열람·조회수 기록·댓글만 막고 작가 집필은 그대로 둔다(사용자 결정 2026-11-23).
-- 원작 회차를 물려받은 Fork 회차는 원작 회차의 제한을 따라야 하므로(상속 회차는 직접 제한하지 못한다) 뷰가 한 곳에서 계산한다.
ALTER TABLE episode ADD COLUMN restricted boolean NOT NULL DEFAULT false;

-- V31과 같은 열에 restricted만 끝에 더한다(CREATE OR REPLACE VIEW는 기존 열의 이름·순서를 바꾸지 못한다).
CREATE OR REPLACE VIEW episode_current AS
SELECT e.id,e.work_id,e.sequence,e.draft_revision_floor,
    COALESCE(CASE WHEN p.action IN ('publish','republish','replace') THEN p.episode_version_id END,iv.id)::varchar(36) published_version_id,
    (iv.id IS NOT NULL) inherited,
    CASE WHEN iv.id IS NOT NULL OR p.action IN ('publish','republish','replace') THEN 'published'
         WHEN p.action='unpublish' THEN 'suspended' ELSE 'draft' END publication_status,
    (e.restricted OR COALESCE(iv.restricted,false)) restricted
FROM episode e
LEFT JOIN LATERAL (
    SELECT pe.episode_version_id,pe.action FROM publication_event pe JOIN episode_version v ON v.id=pe.episode_version_id
    WHERE v.episode_id=e.id AND pe.outcome='applied' ORDER BY pe.occurred_at DESC,pe.id DESC LIMIT 1
) p ON true
LEFT JOIN fork f ON f.work_id=e.work_id
LEFT JOIN LATERAL (
    SELECT local.id,se.restricted FROM checkpoint_episode ce JOIN episode se ON se.id=ce.episode_id
    JOIN episode_version sv ON sv.id=ce.episode_version_id
    JOIN episode_version local ON local.episode_id=e.id AND local.content_version_id=sv.content_version_id
    WHERE ce.checkpoint_id=f.source_checkpoint_id AND se.sequence=e.sequence
) iv ON true
WHERE e.deleted_at IS NULL;
