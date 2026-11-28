-- 신규 본문만 분석한다. 기존 댓글을 일괄 적재하지 않는다.
CREATE TABLE episode_comment_feedback (
    comment_id varchar(36) PRIMARY KEY REFERENCES episode_comment(id) ON DELETE CASCADE,
    body_sha256 char(64) NOT NULL,
    revision bigint NOT NULL DEFAULT 1,
    status text NOT NULL CHECK (status IN ('PENDING','RUNNING','FAILED','COMPLETED')),
    attempts integer NOT NULL DEFAULT 0,
    due_at timestamptz NOT NULL DEFAULT now(),
    claim_id uuid,
    feedback boolean,
    probability double precision CHECK (probability BETWEEN 0 AND 1),
    model_version text,
    threshold double precision CHECK (threshold BETWEEN 0 AND 1),
    failure text,
    CHECK ((claim_id IS NOT NULL) = (status = 'RUNNING')),
    CHECK (CASE WHEN status = 'COMPLETED' THEN feedback IS NOT NULL AND probability IS NOT NULL
        AND model_version IS NOT NULL AND threshold IS NOT NULL AND feedback = (probability > threshold)
        ELSE feedback IS NULL AND probability IS NULL AND model_version IS NULL AND threshold IS NULL END)
);
CREATE INDEX comment_feedback_due ON episode_comment_feedback(due_at, comment_id)
    WHERE status IN ('PENDING','RUNNING');

CREATE FUNCTION queue_comment_feedback() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    IF NEW.deleted_at IS NOT NULL OR NEW.hidden THEN
        DELETE FROM episode_comment_feedback WHERE comment_id = NEW.id;
    ELSIF TG_OP = 'INSERT' OR NEW.body IS DISTINCT FROM OLD.body OR NEW.hidden IS DISTINCT FROM OLD.hidden THEN
        INSERT INTO episode_comment_feedback(comment_id,body_sha256,status) VALUES (NEW.id,encode(sha256(convert_to(NEW.body,'UTF8')),'hex'),'PENDING')
        ON CONFLICT (comment_id) DO UPDATE SET body_sha256 = EXCLUDED.body_sha256, revision = episode_comment_feedback.revision + 1,
            status = 'PENDING', attempts = 0, due_at = now(), claim_id = NULL,
            feedback = NULL, probability = NULL, model_version = NULL, threshold = NULL, failure = NULL;
    END IF;
    RETURN NULL;
END;
$$;
CREATE TRIGGER episode_comment_feedback_change AFTER INSERT OR UPDATE OF body, deleted_at, hidden
    ON episode_comment FOR EACH ROW EXECUTE FUNCTION queue_comment_feedback();
