-- Soft delete of a world by its owner. The row, drafts, revisions, card versions, images and the Neo4j relations all stay; every owner read/write and every public
-- read skips a world whose deleted_at is set. A world that a novel is linked to (work.world_studio_id) cannot be deleted; the service checks that before it sets the column.
ALTER TABLE worldstudio.world ADD COLUMN deleted_at timestamptz;
