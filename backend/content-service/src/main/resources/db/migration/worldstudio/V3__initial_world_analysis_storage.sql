-- Initial-world v1 audit/preparation only. No AI execution, draft writes or graph history.
CREATE TABLE worldstudio.initial_analysis (
    id uuid PRIMARY KEY,
    world_id uuid NOT NULL REFERENCES worldstudio.world(id),
    request_key text NOT NULL CHECK (request_key ~ '^[!-~]{1,200}$'),
    request_hash text NOT NULL CHECK (request_hash ~ '^[a-f0-9]{64}$'),
    draft_revision bigint NOT NULL CHECK (draft_revision BETWEEN 0 AND 9007199254740991),
    relationship_version bigint NOT NULL CHECK (relationship_version BETWEEN 0 AND 9007199254740991),
    current_revision_id uuid,
    input_snapshot jsonb NOT NULL CHECK (jsonb_typeof(input_snapshot)='object'),
    execution_token uuid NOT NULL,
    deadline timestamptz NOT NULL,
    execution_status text NOT NULL DEFAULT 'running' CHECK (execution_status IN ('running','completed','failed','unknown')),
    output jsonb CHECK (jsonb_typeof(output)='object'),
    created_at timestamptz NOT NULL DEFAULT now(),
    lock_version bigint NOT NULL DEFAULT 0,
    UNIQUE (world_id,id),
    UNIQUE (world_id,request_key),
    FOREIGN KEY (world_id,current_revision_id) REFERENCES worldstudio.world_revision(world_id,id),
    CHECK (deadline>created_at),
    CHECK ((execution_status='completed')=(output IS NOT NULL))
);
CREATE TABLE worldstudio.initial_candidate (
    id uuid PRIMARY KEY,
    world_id uuid NOT NULL,
    analysis_id uuid NOT NULL,
    local_ref text NOT NULL CHECK (local_ref ~ '^[!-~]{1,200}$'),
    content jsonb NOT NULL CHECK (jsonb_typeof(content)='object'),
    created_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE (world_id,analysis_id,id),
    UNIQUE (analysis_id,local_ref),
    FOREIGN KEY (world_id,analysis_id) REFERENCES worldstudio.initial_analysis(world_id,id),
    CHECK ((content->>'type' IN ('fact','relation','rule','event','conjecture','goal','plan')) IS TRUE),
    CHECK ((content->>'provenance'='ai_extraction') IS TRUE),
    CHECK ((jsonb_typeof(content->'evidence')='array' AND content->'evidence'<>'[]'::jsonb) IS TRUE)
);
CREATE TABLE worldstudio.initial_decision (
    id uuid PRIMARY KEY,
    world_id uuid NOT NULL,
    analysis_id uuid NOT NULL,
    candidate_id uuid NOT NULL,
    sequence bigint NOT NULL CHECK (sequence>0),
    action text NOT NULL CHECK (action IN ('approve','edit','hold','reject')),
    state text NOT NULL,
    actor_id uuid NOT NULL,
    content jsonb NOT NULL CHECK (jsonb_typeof(content)='object'),
    created_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE (candidate_id,sequence),
    UNIQUE (world_id,analysis_id,candidate_id,sequence,state),
    FOREIGN KEY (world_id,analysis_id,candidate_id) REFERENCES worldstudio.initial_candidate(world_id,analysis_id,id),
    CHECK (state=CASE action WHEN 'approve' THEN 'approved' WHEN 'edit' THEN 'pending' WHEN 'hold' THEN 'held' WHEN 'reject' THEN 'rejected' END),
    CHECK ((content->>'provenance' IN ('ai_extraction','author_revision','author_addition')) IS TRUE),
    CHECK ((jsonb_typeof(content->'evidence')='array') IS TRUE),
    CHECK (content->>'provenance'='ai_extraction' OR content->'evidence'='[]'::jsonb),
    CHECK (content->>'provenance'<>'ai_extraction' OR content->'evidence'<>'[]'::jsonb),
    CHECK (action<>'edit' OR content->>'provenance'='author_revision')
);
CREATE TABLE worldstudio.initial_application (
    id uuid PRIMARY KEY,
    world_id uuid NOT NULL,
    analysis_id uuid NOT NULL,
    request_key text NOT NULL CHECK (request_key ~ '^[!-~]{1,200}$'),
    request_hash text NOT NULL CHECK (request_hash ~ '^[a-f0-9]{64}$'),
    base_draft_revision bigint NOT NULL CHECK (base_draft_revision BETWEEN 0 AND 9007199254740990),
    relationship_version bigint NOT NULL CHECK (relationship_version BETWEEN 0 AND 9007199254740991),
    addition_payload jsonb NOT NULL CHECK (jsonb_typeof(addition_payload)='object' AND (addition_payload->'replace'='false'::jsonb) IS TRUE),
    status text NOT NULL DEFAULT 'applying' CHECK (status IN ('applying','applied','failed','unknown')),
    result_draft_revision bigint,
    created_at timestamptz NOT NULL DEFAULT now(),
    lock_version bigint NOT NULL DEFAULT 0,
    UNIQUE (world_id,request_key),
    UNIQUE (world_id,analysis_id,id),
    FOREIGN KEY (world_id,analysis_id) REFERENCES worldstudio.initial_analysis(world_id,id),
    CHECK ((status='applied' AND result_draft_revision IS NOT NULL AND result_draft_revision=base_draft_revision+1)
        OR (status<>'applied' AND result_draft_revision IS NULL))
);
CREATE UNIQUE INDEX initial_application_pending ON worldstudio.initial_application(world_id) WHERE status IN ('applying','unknown');
CREATE TABLE worldstudio.initial_application_item (
    id uuid PRIMARY KEY,
    world_id uuid NOT NULL,
    analysis_id uuid NOT NULL,
    application_id uuid NOT NULL,
    candidate_id uuid NOT NULL,
    decision_sequence bigint NOT NULL,
    decision_state text NOT NULL DEFAULT 'approved' CHECK (decision_state='approved'),
    generated_id uuid NOT NULL UNIQUE,
    generated_kind text NOT NULL CHECK (generated_kind IN ('card','relationship')),
    active boolean NOT NULL DEFAULT true,
    UNIQUE (application_id,candidate_id),
    FOREIGN KEY (world_id,analysis_id,application_id) REFERENCES worldstudio.initial_application(world_id,analysis_id,id),
    FOREIGN KEY (world_id,analysis_id,candidate_id,decision_sequence,decision_state)
        REFERENCES worldstudio.initial_decision(world_id,analysis_id,candidate_id,sequence,state)
);
CREATE UNIQUE INDEX initial_candidate_reserved ON worldstudio.initial_application_item(candidate_id) WHERE active;

CREATE TRIGGER immutable_initial_candidate BEFORE UPDATE OR DELETE ON worldstudio.initial_candidate
FOR EACH ROW EXECUTE FUNCTION worldstudio.reject_snapshot_change();
CREATE TRIGGER immutable_initial_decision BEFORE UPDATE OR DELETE ON worldstudio.initial_decision
FOR EACH ROW EXECUTE FUNCTION worldstudio.reject_snapshot_change();

-- Payloads/IDs survive process death. Only explicit runtime state fields can change.
CREATE FUNCTION worldstudio.guard_initial_record() RETURNS trigger
LANGUAGE plpgsql SET search_path=pg_catalog AS $$
DECLARE mutable_fields text[]; application_status text;
BEGIN
    IF TG_OP='DELETE' THEN
        RAISE EXCEPTION 'Initial analysis audit records cannot be deleted' USING ERRCODE='23514';
    END IF;
    IF TG_TABLE_NAME='initial_analysis' THEN
        mutable_fields:=ARRAY['execution_status','output','lock_version'];
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
CREATE TRIGGER guard_initial_analysis BEFORE UPDATE OR DELETE ON worldstudio.initial_analysis
FOR EACH ROW EXECUTE FUNCTION worldstudio.guard_initial_record();
CREATE TRIGGER guard_initial_application BEFORE UPDATE OR DELETE ON worldstudio.initial_application
FOR EACH ROW EXECUTE FUNCTION worldstudio.guard_initial_record();
CREATE TRIGGER guard_initial_application_item BEFORE UPDATE OR DELETE ON worldstudio.initial_application_item
FOR EACH ROW EXECUTE FUNCTION worldstudio.guard_initial_record();
