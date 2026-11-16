-- Preserve the existing creation order within each work/episode before enabling moves.
ALTER TABLE story_plan ADD COLUMN position integer NOT NULL DEFAULT 0 CHECK (position >= 0);
WITH ordered AS (
    SELECT id, (row_number() OVER (PARTITION BY work_id, episode_number ORDER BY created_at, id) - 1)::integer AS position
    FROM story_plan WHERE kind = 'scene' AND deleted_at IS NULL
)
UPDATE story_plan AS plan SET position = ordered.position FROM ordered WHERE plan.id = ordered.id;
