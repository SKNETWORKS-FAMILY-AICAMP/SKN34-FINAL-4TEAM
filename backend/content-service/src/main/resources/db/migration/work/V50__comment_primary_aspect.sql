-- Legacy binary rows retain NULL aspect_version. Explicit feedback reports and multilabel data live separately.
ALTER TABLE episode_comment_feedback ADD COLUMN primary_aspect text,
    ADD COLUMN aspect_version text,
    ADD CHECK (primary_aspect IS NULL OR primary_aspect IN
       ('plot','logic','character','style','typo','schedule','overall_work','other')),
    ADD CHECK ((aspect_version IS NULL AND primary_aspect IS NULL) OR
       (aspect_version IS NOT NULL AND status='COMPLETED' AND feedback=(primary_aspect IS NOT NULL)));

CREATE TABLE comment_feedback_version_history (
    comment_id varchar(36) NOT NULL REFERENCES episode_comment(id) ON DELETE CASCADE,
    revision bigint NOT NULL, body_sha256 char(64) NOT NULL, model_version text NOT NULL,
    threshold double precision NOT NULL, aspect_version text NOT NULL, feedback boolean NOT NULL,
    probability double precision NOT NULL, primary_aspect text,
    PRIMARY KEY(comment_id,revision,body_sha256,model_version,threshold,aspect_version)
);

CREATE FUNCTION preserve_comment_feedback_version() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    IF OLD.status='COMPLETED' THEN
        INSERT INTO comment_feedback_version_history VALUES
            (OLD.comment_id,OLD.revision,OLD.body_sha256,OLD.model_version,OLD.threshold,
             coalesce(OLD.aspect_version,'binary-only'),OLD.feedback,OLD.probability,OLD.primary_aspect)
        ON CONFLICT DO NOTHING;
    END IF;
    IF NEW.status <> 'COMPLETED' THEN
        NEW.primary_aspect := NULL;
        NEW.aspect_version := NULL;
    END IF;
    RETURN NEW;
END;
$$;
CREATE TRIGGER preserve_comment_feedback BEFORE UPDATE ON episode_comment_feedback
    FOR EACH ROW EXECUTE FUNCTION preserve_comment_feedback_version();
