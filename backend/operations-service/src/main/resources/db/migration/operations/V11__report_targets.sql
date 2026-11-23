-- Operator content management: a report can also be about one episode of a work or about a world (a world studio), not only about a work.
-- A world has no work: work_id, work_title and work_owner_id become nullable, and the world keeps its id and name. Existing rows are work reports.
ALTER TABLE operations.report ADD COLUMN target_type VARCHAR(20) NOT NULL DEFAULT 'WORK';
ALTER TABLE operations.report ADD COLUMN episode_number INTEGER;
ALTER TABLE operations.report ADD COLUMN world_id UUID;
ALTER TABLE operations.report ADD COLUMN world_name TEXT;

ALTER TABLE operations.report ALTER COLUMN work_id DROP NOT NULL;
ALTER TABLE operations.report ALTER COLUMN work_title DROP NOT NULL;
ALTER TABLE operations.report ALTER COLUMN work_owner_id DROP NOT NULL;

-- Which ids a report carries follows its type (and the type is one of the three): a work report has a work, an episode report a work and a number, a world report only a world.
ALTER TABLE operations.report ADD CONSTRAINT report_target_valid CHECK (
    (target_type = 'WORK' AND work_id IS NOT NULL AND episode_number IS NULL AND world_id IS NULL)
    OR (target_type = 'EPISODE' AND work_id IS NOT NULL AND episode_number IS NOT NULL AND world_id IS NULL)
    OR (target_type = 'WORLD' AND work_id IS NULL AND episode_number IS NULL AND world_id IS NOT NULL)
);
