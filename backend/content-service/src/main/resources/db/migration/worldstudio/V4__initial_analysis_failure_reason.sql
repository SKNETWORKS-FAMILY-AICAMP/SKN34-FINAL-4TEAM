-- Additive 5-C state diagnostics; V1/V2/V3 checksums remain unchanged.
ALTER TABLE worldstudio.initial_analysis ADD COLUMN failure_code text;
ALTER TABLE worldstudio.initial_analysis ADD CONSTRAINT initial_analysis_failure_state
    CHECK (failure_code IS NULL OR (execution_status IN ('failed','unknown') AND failure_code ~ '^[A-Z_]{1,80}$'));

CREATE OR REPLACE FUNCTION worldstudio.guard_initial_record() RETURNS trigger
LANGUAGE plpgsql SET search_path=pg_catalog AS $$
DECLARE mutable_fields text[]; application_status text;
BEGIN
    IF TG_OP='DELETE' THEN
        RAISE EXCEPTION 'Initial analysis audit records cannot be deleted' USING ERRCODE='23514';
    END IF;
    IF TG_TABLE_NAME='initial_analysis' THEN
        mutable_fields:=ARRAY['execution_status','output','lock_version','failure_code'];
        IF OLD.execution_status<>'running' THEN
            RAISE EXCEPTION 'Terminal analysis is immutable' USING ERRCODE='23514';
        END IF;
    ELSIF TG_TABLE_NAME='initial_application' THEN
        mutable_fields:=ARRAY['status','result_draft_revision','lock_version'];
        IF OLD.status IN ('applied','failed') THEN
            RAISE EXCEPTION 'Terminal receipt is immutable' USING ERRCODE='23514';
        END IF;
    ELSE
        mutable_fields:=ARRAY['active'];
        SELECT status INTO application_status FROM worldstudio.initial_application WHERE id=OLD.application_id FOR UPDATE;
        IF NOT OLD.active OR NEW.active OR application_status<>'failed' THEN
            RAISE EXCEPTION 'Release only after proven non-application; retain IDs and audit' USING ERRCODE='23514';
        END IF;
    END IF;
    IF (to_jsonb(OLD)-mutable_fields) IS DISTINCT FROM (to_jsonb(NEW)-mutable_fields) THEN
        RAISE EXCEPTION 'Input, review and generated identity are immutable' USING ERRCODE='23514';
    END IF;
    RETURN NEW;
END;
$$;
