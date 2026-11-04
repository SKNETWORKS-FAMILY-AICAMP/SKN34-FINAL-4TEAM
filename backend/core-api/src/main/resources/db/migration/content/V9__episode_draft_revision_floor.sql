-- Keep the concurrency token when the mutable draft is physically removed.
ALTER TABLE episode ADD COLUMN draft_revision_floor integer NOT NULL DEFAULT -1;
ALTER TABLE episode ADD CONSTRAINT episode_draft_revision_floor_valid CHECK (draft_revision_floor >= -1);

ALTER TABLE work ADD COLUMN deleted_episode_revision integer NOT NULL DEFAULT 0 CHECK (deleted_episode_revision >= 0);
