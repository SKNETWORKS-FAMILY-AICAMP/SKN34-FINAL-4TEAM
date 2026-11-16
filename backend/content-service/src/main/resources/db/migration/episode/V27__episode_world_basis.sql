ALTER TABLE episode
    ADD COLUMN basis_world_id uuid,
    ADD COLUMN basis_world_revision_id uuid,
    ADD COLUMN basis_revision integer NOT NULL DEFAULT 0 CHECK (basis_revision >= 0),
    ADD CONSTRAINT episode_world_basis_pair CHECK ((basis_world_id IS NULL) = (basis_world_revision_id IS NULL));
