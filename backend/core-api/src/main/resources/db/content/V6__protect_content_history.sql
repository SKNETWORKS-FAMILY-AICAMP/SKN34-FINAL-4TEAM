-- Old application processes must not keep writing the retired aggregate after import.
CREATE FUNCTION reject_content_history_mutation() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    RAISE EXCEPTION 'Immutable content history cannot be overwritten' USING ERRCODE='23514';
END;
$$;
CREATE TRIGGER legacy_content_read_only BEFORE INSERT OR UPDATE OR DELETE ON content_work
    FOR EACH ROW EXECUTE FUNCTION reject_content_history_mutation();
CREATE TRIGGER episode_version_immutable BEFORE UPDATE OR DELETE ON episode_version
    FOR EACH ROW EXECUTE FUNCTION reject_content_history_mutation();
CREATE TRIGGER setting_version_immutable BEFORE UPDATE OR DELETE ON setting_version
    FOR EACH ROW EXECUTE FUNCTION reject_content_history_mutation();
CREATE TRIGGER publication_event_immutable BEFORE UPDATE OR DELETE ON publication_event
    FOR EACH ROW EXECUTE FUNCTION reject_content_history_mutation();
CREATE TRIGGER fork_decision_immutable BEFORE UPDATE OR DELETE ON fork_change_decision
    FOR EACH ROW EXECUTE FUNCTION reject_content_history_mutation();
CREATE TRIGGER proposal_decision_immutable BEFORE UPDATE OR DELETE ON proposal_decision
    FOR EACH ROW EXECUTE FUNCTION reject_content_history_mutation();
