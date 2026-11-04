ALTER TABLE setting_version_tag ADD COLUMN position integer NOT NULL DEFAULT 0;
ALTER TABLE setting_knowledge_scope ADD COLUMN position integer NOT NULL DEFAULT 0;
CREATE OR REPLACE VIEW setting_version_read AS
SELECT v.*,v.name name_snapshot,d.logical_id,
       COALESCE(se.sequence,1) from_episode,ee.sequence to_episode,COALESCE(vr.visibility,vh.default_visibility) visibility_status,
       COALESCE((SELECT array_agg(character_name ORDER BY position,character_name) FROM setting_knowledge_scope WHERE setting_version_id=v.id),ARRAY[]::text[]) known_by,
       COALESCE((SELECT array_agg(t.name ORDER BY vt.position,t.name) FROM setting_version_tag vt JOIN setting_tag t ON t.id=vt.setting_tag_id WHERE vt.setting_version_id=v.id),ARRAY[]::text[]) tags
FROM setting_version v JOIN setting_document d ON d.id=v.setting_document_id
JOIN setting_visibility_history vh ON vh.id=v.visibility_history_id
LEFT JOIN setting_visibility_range vr ON vr.visibility_history_id=vh.id
LEFT JOIN episode se ON se.id=vr.start_episode_id LEFT JOIN episode ee ON ee.id=vr.end_episode_id;
