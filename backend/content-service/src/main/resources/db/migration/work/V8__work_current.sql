-- Read projection only; canonical values remain in their owning histories.
CREATE VIEW work_current AS
SELECT w.*,wh.world_id,COALESCE(ph.visibility,'private') visibility_status,
       COALESCE(fp.allow_creation,false) allow_fork_creation,COALESCE(fp.allow_publication,false) allow_fork_publication,
       ''::text genre
FROM work w
LEFT JOIN LATERAL (SELECT world_id FROM work_world_history WHERE work_id=w.id ORDER BY revision_no DESC LIMIT 1) wh ON true
LEFT JOIN LATERAL (SELECT visibility FROM work_publication_history WHERE work_id=w.id ORDER BY revision_no DESC LIMIT 1) ph ON true
LEFT JOIN LATERAL (SELECT allow_creation,allow_publication FROM fork_policy_history WHERE work_id=w.id ORDER BY revision_no DESC LIMIT 1) fp ON true;
