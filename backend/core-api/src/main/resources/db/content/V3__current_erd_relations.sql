-- V2 is a staging schema only. Legacy import runs after normalization (V5).
DO $$ BEGIN
    IF EXISTS (SELECT 1 FROM work) THEN
        RAISE EXCEPTION 'Unexpected staging rows: preserve and migrate them before continuing';
    END IF;
END $$;
CREATE TABLE work_world_history (
    id varchar(36) PRIMARY KEY, work_id varchar(36) NOT NULL REFERENCES work(id),
    world_id varchar(36) NOT NULL REFERENCES world(id), revision_no integer NOT NULL,
    changed_at timestamptz NOT NULL DEFAULT now(), UNIQUE(work_id,revision_no), UNIQUE(id,work_id)
);
CREATE TABLE work_publication_history (
    id varchar(36) PRIMARY KEY, work_id varchar(36) NOT NULL REFERENCES work(id),
    revision_no integer NOT NULL, visibility text NOT NULL CHECK(visibility IN ('private','public')),
    changed_at timestamptz NOT NULL DEFAULT now(), UNIQUE(work_id,revision_no)
);
ALTER TABLE work RENAME COLUMN work_type TO origin_kind;
DROP INDEX work_public;
ALTER TABLE work DROP COLUMN world_id, DROP COLUMN genre, DROP COLUMN visibility_status,
    DROP COLUMN allow_fork_creation, DROP COLUMN allow_fork_publication;
ALTER TABLE work ADD COLUMN audience_rating text;
CREATE TABLE genre (id varchar(36) PRIMARY KEY, code text NOT NULL UNIQUE, name text NOT NULL);
CREATE TABLE work_genre (
    work_id varchar(36) REFERENCES work(id), genre_id varchar(36) REFERENCES genre(id),
    PRIMARY KEY(work_id,genre_id)
);
CREATE TABLE work_rights_declaration (
    id varchar(36) PRIMARY KEY, work_id varchar(36) NOT NULL REFERENCES work(id),
    member_id varchar(200) NOT NULL REFERENCES member(id), notice_version text NOT NULL,
    response text NOT NULL, confirmed_at timestamptz NOT NULL
);
ALTER TABLE episode DROP CONSTRAINT episode_published_version_owner;
ALTER TABLE episode DROP COLUMN title, DROP COLUMN publication_status, DROP COLUMN published_version_id, DROP COLUMN inherited;
ALTER TABLE episode_draft RENAME COLUMN revision_no TO edit_revision;
ALTER TABLE episode_version RENAME COLUMN title_snapshot TO title;
ALTER TABLE episode_version ADD COLUMN work_world_history_id varchar(36) REFERENCES work_world_history(id);
ALTER TABLE episode_version ADD COLUMN restored_from_id varchar(36) REFERENCES episode_version(id);
DROP TABLE episode_publication;
CREATE TABLE publication_event (
    id varchar(36) PRIMARY KEY, episode_version_id varchar(36) NOT NULL REFERENCES episode_version(id),
    actor_id varchar(200) REFERENCES member(id), action text NOT NULL, outcome text NOT NULL,
    occurred_at timestamptz NOT NULL, trigger_kind text NOT NULL
);
CREATE INDEX publication_event_version ON publication_event(episode_version_id,occurred_at);
ALTER TABLE setting_category ADD COLUMN code text;
UPDATE setting_category SET code=id;
ALTER TABLE setting_category ALTER COLUMN code SET NOT NULL;
ALTER TABLE setting_category ADD UNIQUE(code);
ALTER TABLE setting_document DROP COLUMN category_id, DROP COLUMN source_setting_document_id,
    DROP COLUMN name, DROP COLUMN visibility_status;
ALTER TABLE setting_document ADD COLUMN created_at timestamptz NOT NULL DEFAULT now();
ALTER TABLE setting_version RENAME COLUMN name_snapshot TO name;
ALTER TABLE setting_version ADD COLUMN restored_from_id varchar(36) REFERENCES setting_version(id);
ALTER TABLE setting_version ADD COLUMN lifecycle text NOT NULL DEFAULT 'active';
CREATE TABLE setting_origin (
    setting_document_id varchar(36) PRIMARY KEY REFERENCES setting_document(id),
    source_setting_version_id varchar(36) NOT NULL REFERENCES setting_version(id),
    copied_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE setting_draft ADD COLUMN edit_revision integer NOT NULL DEFAULT 0;
ALTER TABLE setting_document_tag RENAME COLUMN tag_id TO setting_tag_id;
DROP TABLE setting_visibility_history;
CREATE TABLE setting_visibility_history (
    id varchar(36) PRIMARY KEY, setting_document_id varchar(36) NOT NULL REFERENCES setting_document(id),
    revision_no integer NOT NULL, default_visibility text NOT NULL CHECK(default_visibility IN ('private','public')),
    changed_at timestamptz NOT NULL DEFAULT now(), UNIQUE(setting_document_id,revision_no)
);
CREATE TABLE setting_visibility_range (
    id varchar(36) PRIMARY KEY, visibility_history_id varchar(36) NOT NULL REFERENCES setting_visibility_history(id),
    start_episode_id varchar(36) NOT NULL REFERENCES episode(id), end_episode_id varchar(36) REFERENCES episode(id),
    visibility text NOT NULL CHECK(visibility IN ('private','public'))
);
-- A version records which visibility policy applied when it was saved.
ALTER TABLE setting_version ADD COLUMN visibility_history_id varchar(36) REFERENCES setting_visibility_history(id);
ALTER TABLE setting_version DROP COLUMN from_episode, DROP COLUMN to_episode, DROP COLUMN visibility_status,
    DROP COLUMN known_by, DROP COLUMN tags;
CREATE TABLE setting_version_tag (
    setting_version_id varchar(36) REFERENCES setting_version(id), setting_tag_id varchar(36) REFERENCES setting_tag(id),
    PRIMARY KEY(setting_version_id,setting_tag_id)
);
-- Legacy name-based scope is retained losslessly; it is not a graph or inferred character fact.
CREATE TABLE setting_knowledge_scope (
    setting_version_id varchar(36) REFERENCES setting_version(id), character_name text NOT NULL,
    PRIMARY KEY(setting_version_id,character_name)
);
ALTER TABLE fork_policy_history RENAME COLUMN history_order TO revision_no;
ALTER TABLE fork_policy_history RENAME COLUMN allow_fork_creation TO allow_creation;
ALTER TABLE fork_policy_history RENAME COLUMN allow_fork_publication TO allow_publication;
ALTER TABLE fork_policy_episode RENAME COLUMN fork_policy_history_id TO policy_history_id;
ALTER TABLE checkpoint RENAME COLUMN source_work_id TO work_id;
ALTER TABLE checkpoint RENAME COLUMN episode_version_id TO basis_episode_version_id;
ALTER TABLE checkpoint DROP CONSTRAINT checkpoint_episode_id_source_work_id_fkey;
ALTER TABLE checkpoint_episode DROP CONSTRAINT checkpoint_episode_checkpoint_id_source_work_id_fkey;
ALTER TABLE checkpoint_episode ADD FOREIGN KEY(checkpoint_id) REFERENCES checkpoint(id);
CREATE TABLE fork_world_reference (
    fork_work_id varchar(36) PRIMARY KEY REFERENCES fork(work_id), source_world_id varchar(36) NOT NULL REFERENCES world(id),
    reference_status text NOT NULL CHECK(reference_status IN ('following','independent')),
    last_followed_checkpoint_id varchar(36) REFERENCES checkpoint(id), detached_at timestamptz
);
ALTER TABLE fork DROP COLUMN world_mode, DROP COLUMN independent_world_id;
ALTER TABLE fork_source_change DROP COLUMN decision_status, DROP COLUMN notified_at, DROP COLUMN decided_at;
ALTER TABLE fork_source_change ADD COLUMN before_checkpoint_id varchar(36) REFERENCES checkpoint(id);
ALTER TABLE fork_source_change ADD COLUMN after_checkpoint_id varchar(36) REFERENCES checkpoint(id);
ALTER TABLE fork_source_change ADD COLUMN detected_at timestamptz NOT NULL DEFAULT now();
CREATE TABLE fork_change_decision (
    id varchar(36) PRIMARY KEY, source_change_id varchar(36) NOT NULL REFERENCES fork_source_change(id),
    actor_id varchar(200) NOT NULL REFERENCES member(id), decision text NOT NULL CHECK(decision IN ('apply','reject')),
    decided_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE fork_change_application (
    id varchar(36) PRIMARY KEY, decision_id varchar(36) NOT NULL REFERENCES fork_change_decision(id),
    result_checkpoint_id varchar(36) REFERENCES checkpoint(id), outcome text NOT NULL,
    reason text, applied_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE ai_job DROP COLUMN model, DROP COLUMN input_tokens, DROP COLUMN output_tokens;
ALTER TABLE ai_job RENAME COLUMN failure_code TO failure_reason;
ALTER TABLE ai_job ADD COLUMN request_text text NOT NULL DEFAULT '';
ALTER TABLE ai_job ADD COLUMN started_at timestamptz;
CREATE TABLE ai_model_call (
    id varchar(36) PRIMARY KEY, job_id varchar(36) NOT NULL REFERENCES ai_job(id), sequence integer NOT NULL,
    role text NOT NULL, provider text NOT NULL, model text, trace_ref text, status text NOT NULL,
    usage_status text NOT NULL, input_tokens integer, output_tokens integer, provider_cost decimal,
    started_at timestamptz, finished_at timestamptz, failure_code text, UNIQUE(job_id,sequence)
);
CREATE TABLE ai_input_snapshot (
    id varchar(36) PRIMARY KEY, job_id varchar(36) NOT NULL REFERENCES ai_job(id),
    episode_id varchar(36) REFERENCES episode(id), episode_version_id varchar(36) REFERENCES episode_version(id),
    setting_version_id varchar(36) REFERENCES setting_version(id), source_kind text NOT NULL,
    position text, content_snapshot text NOT NULL, draft_revision integer, captured_at timestamptz NOT NULL,
    CHECK(num_nonnulls(episode_id,episode_version_id,setting_version_id)<=1)
);
ALTER TABLE ai_proposal DROP COLUMN evidence, DROP COLUMN selection_status, DROP COLUMN application_status,
    DROP COLUMN base_episode_version_id, DROP COLUMN applied_episode_version_id, DROP COLUMN base_revision,
    DROP COLUMN base_draft_content, DROP COLUMN prompt, DROP COLUMN provider_response_id;
ALTER TABLE ai_proposal ADD COLUMN input_snapshot_id varchar(36) REFERENCES ai_input_snapshot(id);
ALTER TABLE ai_proposal ADD COLUMN sequence integer NOT NULL DEFAULT 1;
CREATE TABLE ai_evidence (
    id varchar(36) PRIMARY KEY, episode_version_id varchar(36) REFERENCES episode_version(id),
    setting_version_id varchar(36) REFERENCES setting_version(id), kind text NOT NULL, position text,
    excerpt_snapshot text NOT NULL, captured_at timestamptz NOT NULL,
    CHECK(num_nonnulls(episode_version_id,setting_version_id)<=1)
);
CREATE TABLE proposal_evidence (
    proposal_id varchar(36) REFERENCES ai_proposal(id), evidence_id varchar(36) REFERENCES ai_evidence(id),
    PRIMARY KEY(proposal_id,evidence_id)
);
CREATE TABLE proposal_decision (
    id varchar(36) PRIMARY KEY, proposal_id varchar(36) NOT NULL REFERENCES ai_proposal(id),
    sequence integer NOT NULL, actor_id varchar(200) REFERENCES member(id),
    decision text NOT NULL, selected_range text, approved_content text NOT NULL, decided_at timestamptz NOT NULL,
    UNIQUE(proposal_id,sequence)
);
CREATE TABLE proposal_application (
    id varchar(36) PRIMARY KEY, decision_id varchar(36) NOT NULL REFERENCES proposal_decision(id),
    attempt_no integer NOT NULL, outcome text NOT NULL, failure_reason text, attempted_at timestamptz NOT NULL,
    UNIQUE(decision_id,attempt_no)
);
CREATE TABLE proposal_episode_change (
    id varchar(36) PRIMARY KEY, application_id varchar(36) NOT NULL REFERENCES proposal_application(id),
    episode_id varchar(36) NOT NULL REFERENCES episode(id), result_version_id varchar(36),
    position text, before_content text NOT NULL, after_content text NOT NULL,
    base_draft_revision integer NOT NULL, result_draft_revision integer NOT NULL,
    FOREIGN KEY(episode_id,result_version_id) REFERENCES episode_version(episode_id,id)
);
-- Read projections have no independent mutable current values.
CREATE VIEW work_current AS
SELECT w.*,wh.world_id,COALESCE(ph.visibility,'private') visibility_status,
       COALESCE(fp.allow_creation,false) allow_fork_creation,COALESCE(fp.allow_publication,false) allow_fork_publication,
       ''::text genre
FROM work w
LEFT JOIN LATERAL (SELECT world_id FROM work_world_history WHERE work_id=w.id ORDER BY revision_no DESC LIMIT 1) wh ON true
LEFT JOIN LATERAL (SELECT visibility FROM work_publication_history WHERE work_id=w.id ORDER BY revision_no DESC LIMIT 1) ph ON true
LEFT JOIN LATERAL (SELECT allow_creation,allow_publication FROM fork_policy_history WHERE work_id=w.id ORDER BY revision_no DESC LIMIT 1) fp ON true;
CREATE VIEW episode_current AS
SELECT e.*,COALESCE(p.episode_version_id,iv.id) published_version_id,(iv.id IS NOT NULL) inherited
FROM episode e
LEFT JOIN LATERAL (
    SELECT pe.episode_version_id,pe.action FROM publication_event pe JOIN episode_version v ON v.id=pe.episode_version_id
    WHERE v.episode_id=e.id AND pe.outcome='applied' ORDER BY pe.occurred_at DESC,pe.id DESC LIMIT 1
) p ON p.action IN ('publish','republish','replace')
LEFT JOIN fork f ON f.work_id=e.work_id
LEFT JOIN LATERAL (
    SELECT local.id FROM checkpoint_episode ce JOIN episode se ON se.id=ce.episode_id
    JOIN episode_version sv ON sv.id=ce.episode_version_id
    JOIN episode_version local ON local.episode_id=e.id AND local.content_version_id=sv.content_version_id
    WHERE ce.checkpoint_id=f.source_checkpoint_id AND se.sequence=e.sequence
) iv ON true;
CREATE VIEW setting_version_read AS
SELECT v.*,v.name name_snapshot,d.logical_id,
       COALESCE(se.sequence,1) from_episode,ee.sequence to_episode,COALESCE(vr.visibility,vh.default_visibility) visibility_status,
       COALESCE((SELECT array_agg(character_name ORDER BY character_name) FROM setting_knowledge_scope WHERE setting_version_id=v.id),ARRAY[]::text[]) known_by,
       COALESCE((SELECT array_agg(t.name ORDER BY t.name) FROM setting_version_tag vt JOIN setting_tag t ON t.id=vt.setting_tag_id WHERE vt.setting_version_id=v.id),ARRAY[]::text[]) tags
FROM setting_version v JOIN setting_document d ON d.id=v.setting_document_id
JOIN setting_visibility_history vh ON vh.id=v.visibility_history_id
LEFT JOIN setting_visibility_range vr ON vr.visibility_history_id=vh.id
LEFT JOIN episode se ON se.id=vr.start_episode_id LEFT JOIN episode ee ON ee.id=vr.end_episode_id;
