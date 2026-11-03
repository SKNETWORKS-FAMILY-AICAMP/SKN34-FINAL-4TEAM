-- Keep episode ranges inside one work. Existing history is validated, never rewritten.
DO $$ BEGIN
    IF EXISTS (
        SELECT 1 FROM setting_visibility_range r
        JOIN episode s ON s.id=r.start_episode_id JOIN episode e ON e.id=r.end_episode_id
        WHERE s.work_id<>e.work_id OR e.sequence<s.sequence
    ) THEN RAISE EXCEPTION 'Invalid existing setting visibility range'; END IF;
END $$;

CREATE FUNCTION validate_setting_visibility_range() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
    first_episode episode%ROWTYPE;
    last_episode episode%ROWTYPE;
BEGIN
    SELECT * INTO STRICT first_episode FROM episode WHERE id=NEW.start_episode_id;
    IF NEW.end_episode_id IS NOT NULL THEN
        SELECT * INTO STRICT last_episode FROM episode WHERE id=NEW.end_episode_id;
        IF first_episode.work_id<>last_episode.work_id OR last_episode.sequence<first_episode.sequence THEN
            RAISE EXCEPTION 'Invalid episode range' USING ERRCODE='23514';
        END IF;
    END IF;
    RETURN NEW;
END;
$$;
CREATE TRIGGER setting_visibility_range_valid BEFORE INSERT OR UPDATE ON setting_visibility_range
    FOR EACH ROW EXECUTE FUNCTION validate_setting_visibility_range();
