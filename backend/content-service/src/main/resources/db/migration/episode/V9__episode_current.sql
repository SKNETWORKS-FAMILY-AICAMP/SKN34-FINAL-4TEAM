CREATE VIEW episode_current AS
SELECT e.*,COALESCE(p.episode_version_id,iv.id) published_version_id,(iv.id IS NOT NULL) inherited
FROM episode e
LEFT JOIN LATERAL (
    SELECT pe.episode_version_id,pe.action FROM publication_event pe JOIN episode_version v ON v.id=pe.episode_version_id
    WHERE v.episode_id=e.id AND pe.outcome='applied' ORDER BY pe.occurred_at DESC,pe.id DESC LIMIT 1
) p ON p.action IN ('publish','republish','replace')
LEFT JOIN fork f ON f.work_id=e.work_id
LEFT JOIN LATERAL (
    SELECT local.id FROM checkpoint_episode ce JOIN episode se ON se.id=ce.episode_id
    JOIN episode_version sv ON sv.id=ce.episode_version_id
    JOIN episode_version local ON local.episode_id=e.id AND local.content_version_id=sv.content_version_id
    WHERE ce.checkpoint_id=f.source_checkpoint_id AND se.sequence=e.sequence
) iv ON true;
