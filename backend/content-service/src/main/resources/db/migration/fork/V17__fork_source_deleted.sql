-- 원작이 삭제된 Fork를 "삭제된 원작" 상태로 유지하기 위해 원작 참조 컬럼을 비울 수 있게 한다.
ALTER TABLE fork
    ALTER COLUMN source_work_id DROP NOT NULL,
    ALTER COLUMN source_checkpoint_id DROP NOT NULL,
    ADD COLUMN source_deleted_at timestamptz,
    ADD COLUMN basis_episode integer,
    ADD COLUMN basis_version integer,
    ADD CONSTRAINT fork_source_deleted_state CHECK (
        (source_deleted_at IS NULL AND source_work_id IS NOT NULL AND source_checkpoint_id IS NOT NULL)
        OR (source_deleted_at IS NOT NULL AND source_work_id IS NULL AND source_checkpoint_id IS NULL
            AND basis_episode IS NOT NULL AND basis_version IS NOT NULL));
ALTER TABLE fork_world_reference
    ALTER COLUMN source_world_id DROP NOT NULL,
    ADD CONSTRAINT fork_world_reference_source_required CHECK (source_world_id IS NOT NULL OR reference_status = 'independent');
