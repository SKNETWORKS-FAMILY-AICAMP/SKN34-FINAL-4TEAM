-- Additive public presentation metadata. No sample data or credentials auto-imported.
ALTER TABLE work ADD COLUMN slug text UNIQUE;
ALTER TABLE work ADD COLUMN author_name text NOT NULL DEFAULT '작성자';
ALTER TABLE work ADD COLUMN theme text NOT NULL DEFAULT 'star' CHECK(theme IN ('hanji','star','neon'));
ALTER TABLE work ADD COLUMN hook text NOT NULL DEFAULT '';
ALTER TABLE work ADD COLUMN hanja text;
ALTER TABLE work ADD COLUMN hero_line1 text;
ALTER TABLE work ADD COLUMN hero_line2 text;
ALTER TABLE work ADD COLUMN hero_background text;

-- Wiki fields are normalized versioned setting data, never a whole Work/JSON snapshot.
CREATE TABLE setting_reading_detail (
    setting_version_id varchar(36) PRIMARY KEY REFERENCES setting_version(id),
    source_key text NOT NULL, wiki_category text NOT NULL CHECK(wiki_category IN ('char','world','place','org','item','event')),
    color text NOT NULL DEFAULT '#7C8A9E', image text, event_episode integer CHECK(event_episode>0), event_line text,
    source_basis_episode integer CHECK(source_basis_episode>0),
    CHECK((wiki_category='event')=(event_episode IS NOT NULL))
);
CREATE TABLE setting_reading_property (
    setting_version_id varchar(36) REFERENCES setting_reading_detail(setting_version_id), position integer NOT NULL,
    episode integer NOT NULL CHECK(episode>=0), name text NOT NULL, value text NOT NULL,
    public_from_episode integer CHECK(public_from_episode>=0), -- NULL: no source-backed public disclosure.
    PRIMARY KEY(setting_version_id,position), UNIQUE(setting_version_id,episode,name)
);
CREATE TABLE setting_reading_alias (
    setting_version_id varchar(36) REFERENCES setting_reading_detail(setting_version_id), position integer NOT NULL,
    alias text NOT NULL, PRIMARY KEY(setting_version_id,position)
);
CREATE TABLE setting_reading_participant (
    setting_version_id varchar(36) REFERENCES setting_reading_detail(setting_version_id), position integer NOT NULL,
    name text NOT NULL, PRIMARY KEY(setting_version_id,position)
);
CREATE TABLE setting_reading_link (
    setting_version_id varchar(36) REFERENCES setting_reading_detail(setting_version_id), position integer NOT NULL,
    target_logical_id varchar(36) NOT NULL, kind text NOT NULL, PRIMARY KEY(setting_version_id,position)
);
CREATE TABLE setting_reading_knowledge (
    setting_version_id varchar(36) REFERENCES setting_reading_detail(setting_version_id), position integer NOT NULL,
    content text NOT NULL, known_at integer NOT NULL CHECK(known_at>0), public_at integer CHECK(public_at>0),
    PRIMARY KEY(setting_version_id,position)
);
DO $$ DECLARE t text; BEGIN
    FOREACH t IN ARRAY ARRAY['setting_reading_detail','setting_reading_property','setting_reading_alias','setting_reading_participant','setting_reading_link','setting_reading_knowledge'] LOOP
        EXECUTE format('CREATE TRIGGER reading_detail_immutable BEFORE UPDATE OR DELETE ON %I FOR EACH ROW EXECUTE FUNCTION reject_content_history_mutation()',t);
    END LOOP;
END $$;
