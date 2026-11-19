-- A manual re-run records the failed run it re-ran, so that run stays refused (409) whatever its re-run did;
-- the re-run is a record of its own and can be re-run if it failed.
ALTER TABLE operations.job_run ADD COLUMN retry_of UUID;
ALTER TABLE operations.job_run ADD CONSTRAINT fk_job_run_retry_of FOREIGN KEY (retry_of) REFERENCES operations.job_run (id);

-- Manual runs queued before this column re-ran the newest failed run of their schedule that came before them.
UPDATE operations.job_run m SET retry_of = (
    SELECT f.id FROM operations.job_run f
    WHERE f.schedule_id = m.schedule_id AND f.status = 'FAILED' AND (f.created_at, f.id) < (m.created_at, m.id)
    ORDER BY f.created_at DESC, f.id DESC LIMIT 1
) WHERE m.trigger = 'MANUAL';
