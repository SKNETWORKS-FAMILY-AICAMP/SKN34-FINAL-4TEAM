-- First build only. No episode subscription, publication or canonical graph copy.
CREATE TABLE worldstudio.manuscript_build_job (
    id uuid PRIMARY KEY,
    work_id text NOT NULL,
    world_id uuid NOT NULL REFERENCES worldstudio.world(id),
    owner_subject uuid NOT NULL,
    request_key text NOT NULL CHECK (request_key ~ '^[A-Za-z0-9:_-]{1,200}$'),
    request_hash text NOT NULL CHECK (request_hash ~ '^[a-f0-9]{64}$'),
    manifest jsonb NOT NULL CHECK (jsonb_typeof(manifest)='object'
        AND (jsonb_typeof(manifest->'episodes')='array') IS TRUE
        AND jsonb_array_length(manifest->'episodes')>0),
    status text NOT NULL CHECK (status IN ('queued','running','failed','loading','unknown','completed')),
    execution_token uuid,
    deadline timestamptz,
    failure_code text,
    created_at timestamptz NOT NULL DEFAULT now(),
    lock_version bigint NOT NULL DEFAULT 0,
    CHECK ((execution_token IS NULL)=(deadline IS NULL)),
    UNIQUE (work_id,request_key),
    UNIQUE (world_id,id)
);
CREATE UNIQUE INDEX manuscript_build_pending_world ON worldstudio.manuscript_build_job(world_id)
    WHERE status IN ('loading','unknown');

CREATE TABLE worldstudio.manuscript_build_result (
    id uuid PRIMARY KEY,
    job_id uuid NOT NULL REFERENCES worldstudio.manuscript_build_job(id),
    kind text NOT NULL CHECK (kind IN ('extraction','identity','payload')),
    episode integer NOT NULL,
    content jsonb NOT NULL CHECK (jsonb_typeof(content)='object'),
    content_hash text NOT NULL CHECK (content_hash ~ '^[a-f0-9]{64}$'),
    created_at timestamptz NOT NULL DEFAULT now(),
    CHECK ((kind='extraction' AND episode>0) OR (kind IN ('identity','payload') AND episode=0)),
    UNIQUE (job_id,kind,episode)
);

CREATE TABLE worldstudio.manuscript_build_load_step (
    id uuid PRIMARY KEY,
    job_id uuid NOT NULL REFERENCES worldstudio.manuscript_build_job(id),
    sequence integer NOT NULL CHECK (sequence>0),
    request_payload jsonb NOT NULL CHECK (jsonb_typeof(request_payload)='object'
        AND (request_payload->'replace'='false'::jsonb) IS TRUE),
    request_hash text NOT NULL CHECK (request_hash ~ '^[a-f0-9]{64}$'),
    status text NOT NULL CHECK (status IN ('prepared','unknown','applied')),
    receipt jsonb CHECK (jsonb_typeof(receipt)='object'),
    lock_version bigint NOT NULL DEFAULT 0,
    UNIQUE (job_id,sequence),
    CHECK ((status='applied')=(receipt IS NOT NULL))
);

CREATE FUNCTION worldstudio.protect_manuscript_build() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    IF TG_OP='DELETE' THEN
        RAISE EXCEPTION 'Initial build records are preserved' USING ERRCODE='23514';
    END IF;
    IF TG_TABLE_NAME='manuscript_build_job' THEN
        IF (NEW.id,NEW.work_id,NEW.world_id,NEW.owner_subject,NEW.request_key,NEW.request_hash,NEW.manifest,NEW.created_at)
            IS DISTINCT FROM (OLD.id,OLD.work_id,OLD.world_id,OLD.owner_subject,OLD.request_key,OLD.request_hash,OLD.manifest,OLD.created_at)
            OR (OLD.status='completed' AND NEW IS DISTINCT FROM OLD) THEN
            RAISE EXCEPTION 'Initial build input or completed job is immutable' USING ERRCODE='23514';
        END IF;
    ELSE
        IF (NEW.id,NEW.job_id,NEW.sequence,NEW.request_payload,NEW.request_hash)
            IS DISTINCT FROM (OLD.id,OLD.job_id,OLD.sequence,OLD.request_payload,OLD.request_hash)
            OR (OLD.status='applied' AND NEW IS DISTINCT FROM OLD) THEN
            RAISE EXCEPTION 'Reserved load request or receipt is immutable' USING ERRCODE='23514';
        END IF;
    END IF;
    RETURN NEW;
END;
$$;
CREATE TRIGGER immutable_manuscript_build_input BEFORE UPDATE OR DELETE ON worldstudio.manuscript_build_job
FOR EACH ROW EXECUTE FUNCTION worldstudio.protect_manuscript_build();
CREATE TRIGGER immutable_manuscript_build_result BEFORE UPDATE OR DELETE ON worldstudio.manuscript_build_result
FOR EACH ROW EXECUTE FUNCTION worldstudio.reject_snapshot_change();
CREATE TRIGGER immutable_manuscript_build_payload BEFORE UPDATE OR DELETE ON worldstudio.manuscript_build_load_step
FOR EACH ROW EXECUTE FUNCTION worldstudio.protect_manuscript_build();

-- Both persistence units use contentDataSource. Publish progress in the transaction that
-- actually stored the result / receipt. The V41 row is the public job, including monitoring.
CREATE FUNCTION worldstudio.publish_manuscript_build() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
    public_status text;
    saved_count integer;
    missing integer[];
BEGIN
    IF TG_TABLE_NAME='manuscript_build_result' THEN
        IF NEW.kind='extraction' THEN
            UPDATE public.preprocessing_job SET done=done+1
             WHERE id=NEW.job_id::text AND status='running' AND done<total;
            IF NOT FOUND THEN RAISE EXCEPTION 'Invalid job progress' USING ERRCODE='23514'; END IF;
        END IF;
        RETURN NEW;
    END IF;
    public_status := CASE NEW.status WHEN 'unknown' THEN 'loading' ELSE NEW.status END;
    SELECT count(*) INTO saved_count FROM worldstudio.manuscript_build_result
      WHERE job_id=NEW.id AND kind='extraction';
    IF NEW.status='completed' AND (
        saved_count<>jsonb_array_length(NEW.manifest->'episodes')
        OR NOT EXISTS (SELECT 1 FROM worldstudio.manuscript_build_load_step WHERE job_id=NEW.id)
        OR EXISTS (SELECT 1 FROM worldstudio.manuscript_build_load_step WHERE job_id=NEW.id AND (status<>'applied' OR receipt IS NULL))
    ) THEN RAISE EXCEPTION 'Missing build receipt or extraction' USING ERRCODE='23514'; END IF;
    SELECT COALESCE(array_agg(CAST(ep->>'number' AS integer) ORDER BY CAST(ep->>'number' AS integer)),ARRAY[]::integer[])
      INTO missing FROM jsonb_array_elements(NEW.manifest->'episodes') ep
      WHERE NOT EXISTS (SELECT 1 FROM worldstudio.manuscript_build_result r WHERE r.job_id=NEW.id
           AND r.kind='extraction' AND r.episode=CAST(ep->>'number' AS integer));
    UPDATE public.preprocessing_job SET status=public_status,done=saved_count,
        failed_episodes=CASE WHEN NEW.status='failed' THEN missing ELSE ARRAY[]::integer[] END,
        failed_reason=NEW.failure_code,
        started_at=CASE WHEN public_status='queued' THEN NULL ELSE COALESCE(started_at,now()) END,
        finished_at=CASE WHEN public_status IN ('completed','failed') THEN now() ELSE NULL END
      WHERE id=NEW.id::text AND work_id=NEW.work_id AND member_id=NEW.owner_subject::text
        AND world_id=NEW.world_id AND total=jsonb_array_length(NEW.manifest->'episodes');
    IF NOT FOUND THEN RAISE EXCEPTION 'Missing canonical preprocessing job' USING ERRCODE='23514'; END IF;
    RETURN NEW;
END;
$$;
CREATE TRIGGER publish_manuscript_job AFTER INSERT OR UPDATE OF status ON worldstudio.manuscript_build_job
FOR EACH ROW EXECUTE FUNCTION worldstudio.publish_manuscript_build();
CREATE TRIGGER publish_manuscript_result AFTER INSERT ON worldstudio.manuscript_build_result
FOR EACH ROW EXECUTE FUNCTION worldstudio.publish_manuscript_build();
