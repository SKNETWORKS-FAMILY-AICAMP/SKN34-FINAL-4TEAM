CREATE TABLE world (
    id varchar(36) PRIMARY KEY, owner_id varchar(200) NOT NULL REFERENCES member(id),
    name text NOT NULL, description text NOT NULL DEFAULT '',
    revision integer NOT NULL DEFAULT 0 CHECK(revision >= 0), created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE work_world_history (
    id varchar(36) PRIMARY KEY, work_id varchar(36) NOT NULL REFERENCES work(id),
    world_id varchar(36) NOT NULL REFERENCES world(id), revision_no integer NOT NULL,
    changed_at timestamptz NOT NULL DEFAULT now(), UNIQUE(work_id,revision_no), UNIQUE(id,work_id)
);
CREATE TABLE setting_category (id text PRIMARY KEY, name text NOT NULL UNIQUE, code text NOT NULL UNIQUE);
INSERT INTO setting_category VALUES ('규칙','규칙','규칙'),('인물','인물','인물'),('장소','장소','장소'),('광물','광물','광물'),('상태','상태','상태'),('지식','지식','지식'),('관계','관계','관계');
CREATE TABLE setting_document (
    id varchar(36) PRIMARY KEY, world_id varchar(36) NOT NULL REFERENCES world(id),
    logical_id varchar(36) NOT NULL, created_at timestamptz NOT NULL DEFAULT now(), UNIQUE(world_id,logical_id)
);
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
CREATE TABLE setting_version (
    id varchar(36) PRIMARY KEY, setting_document_id varchar(36) NOT NULL REFERENCES setting_document(id),
    content_version_id varchar(36) NOT NULL, revision_no integer NOT NULL,
    name text NOT NULL, category_id text NOT NULL REFERENCES setting_category(id), content text NOT NULL,
    evidence text NOT NULL, created_at timestamptz NOT NULL DEFAULT now(),
    restored_from_id varchar(36) REFERENCES setting_version(id), lifecycle text NOT NULL DEFAULT 'active',
    visibility_history_id varchar(36) REFERENCES setting_visibility_history(id),
    UNIQUE(setting_document_id,content_version_id), UNIQUE(setting_document_id,id)
);
CREATE TABLE setting_draft (
    setting_document_id varchar(36) PRIMARY KEY REFERENCES setting_document(id),
    name text NOT NULL, category_id text NOT NULL REFERENCES setting_category(id), content text NOT NULL,
    from_episode integer NOT NULL CHECK(from_episode > 0), to_episode integer,
    visibility_status text NOT NULL CHECK(visibility_status IN ('private','public')),
    known_by text[] NOT NULL, tags text[] NOT NULL, evidence text NOT NULL,
    edit_order integer NOT NULL, updated_at timestamptz NOT NULL DEFAULT now(), edit_revision integer NOT NULL DEFAULT 0,
    CHECK(to_episode IS NULL OR to_episode >= from_episode)
);
CREATE TABLE setting_tag (
    id varchar(36) PRIMARY KEY, owner_id varchar(200) NOT NULL REFERENCES member(id), name text NOT NULL, UNIQUE(owner_id,name)
);
CREATE TABLE setting_document_tag (
    setting_document_id varchar(36) NOT NULL REFERENCES setting_document(id),
    setting_tag_id varchar(36) NOT NULL REFERENCES setting_tag(id), PRIMARY KEY(setting_document_id,setting_tag_id)
);
CREATE TABLE setting_version_tag (
    setting_version_id varchar(36) REFERENCES setting_version(id), setting_tag_id varchar(36) REFERENCES setting_tag(id),
    position integer NOT NULL DEFAULT 0, PRIMARY KEY(setting_version_id,setting_tag_id)
);
CREATE TABLE setting_knowledge_scope (
    setting_version_id varchar(36) REFERENCES setting_version(id), character_name text NOT NULL,
    position integer NOT NULL DEFAULT 0, PRIMARY KEY(setting_version_id,character_name)
);
CREATE TABLE setting_origin (
    setting_document_id varchar(36) PRIMARY KEY REFERENCES setting_document(id),
    source_setting_version_id varchar(36) NOT NULL REFERENCES setting_version(id), copied_at timestamptz NOT NULL DEFAULT now()
);
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
CREATE TRIGGER setting_version_immutable BEFORE UPDATE OR DELETE ON setting_version
    FOR EACH ROW EXECUTE FUNCTION reject_content_history_mutation();
CREATE VIEW setting_version_read AS
SELECT v.*,v.name name_snapshot,d.logical_id,
       COALESCE(se.sequence,1) from_episode,ee.sequence to_episode,COALESCE(vr.visibility,vh.default_visibility) visibility_status,
       COALESCE((SELECT array_agg(character_name ORDER BY position,character_name) FROM setting_knowledge_scope WHERE setting_version_id=v.id),ARRAY[]::text[]) known_by,
       COALESCE((SELECT array_agg(t.name ORDER BY vt.position,t.name) FROM setting_version_tag vt JOIN setting_tag t ON t.id=vt.setting_tag_id WHERE vt.setting_version_id=v.id),ARRAY[]::text[]) tags
FROM setting_version v JOIN setting_document d ON d.id=v.setting_document_id
JOIN setting_visibility_history vh ON vh.id=v.visibility_history_id
LEFT JOIN setting_visibility_range vr ON vr.visibility_history_id=vh.id
LEFT JOIN episode se ON se.id=vr.start_episode_id LEFT JOIN episode ee ON ee.id=vr.end_episode_id;
