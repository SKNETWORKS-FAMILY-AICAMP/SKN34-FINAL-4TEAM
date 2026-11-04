-- Independent initial model. Never run against an already applied Content-extension history.
-- Flyway owns schema creation and worldstudio.world_studio_schema_history; no baseline/repair.
DO $$
DECLARE history record; applied boolean;
BEGIN
    FOR history IN
        SELECT n.nspname, c.relname FROM pg_catalog.pg_class c
        JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
        WHERE c.relkind IN ('r','p') AND c.relname IN ('world_studio_schema_history','flyway_schema_history')
            AND n.nspname <> 'worldstudio'
    LOOP
        -- Match archived Flyway SQL identities, not another domain's version number or table name.
        EXECUTE format($check$
            SELECT EXISTS (SELECT 1 FROM %I.%I h WHERE to_jsonb(h)->>'success' = 'true'
                AND to_jsonb(h)->>'type' = 'SQL' AND (
                    (to_jsonb(h)->>'version' = '1' AND to_jsonb(h)->>'script' = 'V1__initial_world_schema.sql'
                        AND to_jsonb(h)->>'checksum' = '943880700') OR
                    (to_jsonb(h)->>'version' = '2' AND to_jsonb(h)->>'script' = 'V2__protect_world_revision.sql'
                        AND to_jsonb(h)->>'checksum' = '-391778711')))
            $check$, history.nspname, history.relname) INTO applied;
        IF applied THEN
            RAISE EXCEPTION 'Applied archived WorldStudio migration found; design a separate transition'
                USING ERRCODE = '23514';
        END IF;
    END LOOP;
END;
$$;

CREATE TABLE worldstudio.world (
    id uuid PRIMARY KEY,
    owner_subject uuid NOT NULL,
    current_revision_id uuid,
    created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX world_owner ON worldstudio.world(owner_subject, created_at);

CREATE TABLE worldstudio.world_draft (
    world_id uuid PRIMARY KEY REFERENCES worldstudio.world(id),
    name text NOT NULL DEFAULT '',
    description text NOT NULL DEFAULT '',
    draft_revision bigint NOT NULL DEFAULT 0 CHECK (draft_revision >= 0),
    base_world_revision_id uuid,
    updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE worldstudio.setting_card (
    id uuid PRIMARY KEY,
    world_id uuid NOT NULL REFERENCES worldstudio.world(id),
    created_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE (world_id, id)
);
CREATE TABLE worldstudio.setting_card_draft (
    card_id uuid PRIMARY KEY,
    world_id uuid NOT NULL,
    title text NOT NULL DEFAULT '',
    body text NOT NULL DEFAULT '',
    card_type text NOT NULL DEFAULT 'other' CHECK (card_type IN ('character','location','organization','ability','object','rule','event','other')),
    area_code text NOT NULL DEFAULT 'basic' CHECK (area_code IN ('basic','space','history','society','culture','special','conflict')),
    classification text NOT NULL DEFAULT '',
    aliases text[] NOT NULL DEFAULT '{}',
    tags text[] NOT NULL DEFAULT '{}',
    semantic_metadata jsonb NOT NULL DEFAULT '{}' CHECK (jsonb_typeof(semantic_metadata) = 'object'),
    visibility text NOT NULL DEFAULT 'private' CHECK (visibility IN ('private','public')),
    lifecycle text NOT NULL DEFAULT 'active' CHECK (lifecycle IN ('active','removed')),
    updated_at timestamptz NOT NULL DEFAULT now(),
    FOREIGN KEY (world_id, card_id) REFERENCES worldstudio.setting_card(world_id, id)
);
CREATE TABLE worldstudio.setting_card_version (
    id uuid PRIMARY KEY,
    card_id uuid NOT NULL,
    world_id uuid NOT NULL,
    version_no bigint NOT NULL CHECK (version_no > 0),
    title text NOT NULL CHECK (btrim(title) <> ''),
    body text NOT NULL CHECK (btrim(body) <> ''),
    card_type text NOT NULL CHECK (card_type IN ('character','location','organization','ability','object','rule','event','other')),
    area_code text NOT NULL CHECK (area_code IN ('basic','space','history','society','culture','special','conflict')),
    classification text NOT NULL DEFAULT '',
    aliases text[] NOT NULL DEFAULT '{}',
    tags text[] NOT NULL DEFAULT '{}',
    semantic_metadata jsonb NOT NULL DEFAULT '{}' CHECK (jsonb_typeof(semantic_metadata) = 'object'),
    visibility text NOT NULL DEFAULT 'private' CHECK (visibility IN ('private','public')),
    lifecycle text NOT NULL DEFAULT 'active' CHECK (lifecycle IN ('active','removed')),
    restored_from_version_id uuid,
    created_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE (card_id, version_no),
    UNIQUE (world_id, card_id, id),
    FOREIGN KEY (world_id, card_id) REFERENCES worldstudio.setting_card(world_id, id),
    FOREIGN KEY (world_id, card_id, restored_from_version_id) REFERENCES worldstudio.setting_card_version(world_id, card_id, id),
    CHECK (restored_from_version_id IS DISTINCT FROM id)
);

CREATE TABLE worldstudio.relationship (
    id uuid PRIMARY KEY,
    world_id uuid NOT NULL REFERENCES worldstudio.world(id),
    created_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE (world_id, id)
);
CREATE TABLE worldstudio.relationship_draft (
    relation_id uuid PRIMARY KEY,
    world_id uuid NOT NULL,
    source_card_id uuid,
    target_card_id uuid,
    category text CHECK (category IN ('structural','emotional')),
    label text NOT NULL DEFAULT '',
    body text NOT NULL DEFAULT '',
    direction text CHECK (direction IN ('directed','symmetric')),
    polarity text,
    semantic_metadata jsonb NOT NULL DEFAULT '{}' CHECK (jsonb_typeof(semantic_metadata) = 'object'),
    lifecycle text NOT NULL DEFAULT 'active' CHECK (lifecycle IN ('active','removed')),
    updated_at timestamptz NOT NULL DEFAULT now(),
    FOREIGN KEY (world_id, relation_id) REFERENCES worldstudio.relationship(world_id, id),
    FOREIGN KEY (world_id, source_card_id) REFERENCES worldstudio.setting_card(world_id, id),
    FOREIGN KEY (world_id, target_card_id) REFERENCES worldstudio.setting_card(world_id, id)
);
CREATE TABLE worldstudio.relationship_version (
    id uuid PRIMARY KEY,
    relation_id uuid NOT NULL,
    world_id uuid NOT NULL,
    version_no bigint NOT NULL CHECK (version_no > 0),
    source_card_id uuid NOT NULL,
    target_card_id uuid NOT NULL,
    category text NOT NULL CHECK (category IN ('structural','emotional')),
    label text NOT NULL DEFAULT '',
    body text NOT NULL CHECK (btrim(body) <> ''),
    direction text NOT NULL CHECK (direction IN ('directed','symmetric')),
    polarity text,
    semantic_metadata jsonb NOT NULL DEFAULT '{}' CHECK (jsonb_typeof(semantic_metadata) = 'object'),
    lifecycle text NOT NULL DEFAULT 'active' CHECK (lifecycle IN ('active','removed')),
    restored_from_version_id uuid,
    created_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE (relation_id, version_no),
    UNIQUE (world_id, relation_id, id),
    FOREIGN KEY (world_id, relation_id) REFERENCES worldstudio.relationship(world_id, id),
    FOREIGN KEY (world_id, source_card_id) REFERENCES worldstudio.setting_card(world_id, id),
    FOREIGN KEY (world_id, target_card_id) REFERENCES worldstudio.setting_card(world_id, id),
    FOREIGN KEY (world_id, relation_id, restored_from_version_id) REFERENCES worldstudio.relationship_version(world_id, relation_id, id),
    CHECK (restored_from_version_id IS DISTINCT FROM id)
);

CREATE TABLE worldstudio.world_revision (
    id uuid PRIMARY KEY,
    world_id uuid NOT NULL REFERENCES worldstudio.world(id),
    revision_no bigint NOT NULL CHECK (revision_no > 0),
    name text NOT NULL CHECK (btrim(name) <> ''),
    description text NOT NULL DEFAULT '',
    parent_revision_id uuid,
    restored_from_revision_id uuid,
    sealed boolean NOT NULL DEFAULT false,
    created_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE (world_id, revision_no),
    UNIQUE (world_id, id),
    FOREIGN KEY (world_id, parent_revision_id) REFERENCES worldstudio.world_revision(world_id, id),
    FOREIGN KEY (world_id, restored_from_revision_id) REFERENCES worldstudio.world_revision(world_id, id),
    CHECK (parent_revision_id IS DISTINCT FROM id),
    CHECK (restored_from_revision_id IS DISTINCT FROM id)
);
ALTER TABLE worldstudio.world ADD FOREIGN KEY (id, current_revision_id) REFERENCES worldstudio.world_revision(world_id, id);
ALTER TABLE worldstudio.world_draft ADD FOREIGN KEY (world_id, base_world_revision_id) REFERENCES worldstudio.world_revision(world_id, id);

CREATE TABLE worldstudio.world_revision_card (
    world_id uuid NOT NULL,
    revision_id uuid NOT NULL,
    card_id uuid NOT NULL,
    version_id uuid NOT NULL,
    PRIMARY KEY (revision_id, card_id),
    FOREIGN KEY (world_id, revision_id) REFERENCES worldstudio.world_revision(world_id, id),
    FOREIGN KEY (world_id, card_id, version_id) REFERENCES worldstudio.setting_card_version(world_id, card_id, id)
);
CREATE TABLE worldstudio.world_revision_relationship (
    world_id uuid NOT NULL,
    revision_id uuid NOT NULL,
    relation_id uuid NOT NULL,
    version_id uuid NOT NULL,
    PRIMARY KEY (revision_id, relation_id),
    FOREIGN KEY (world_id, revision_id) REFERENCES worldstudio.world_revision(world_id, id),
    FOREIGN KEY (world_id, relation_id, version_id) REFERENCES worldstudio.relationship_version(world_id, relation_id, id)
);
CREATE TABLE worldstudio.world_save_request (
    world_id uuid NOT NULL,
    request_key text NOT NULL CHECK (btrim(request_key) <> ''),
    request_hash text NOT NULL CHECK (btrim(request_hash) <> ''),
    revision_id uuid NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (world_id, request_key),
    FOREIGN KEY (world_id, revision_id) REFERENCES worldstudio.world_revision(world_id, id)
);

CREATE FUNCTION worldstudio.reject_snapshot_change() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog AS $$
BEGIN
    RAISE EXCEPTION 'WorldStudio snapshot is immutable; create a new version' USING ERRCODE = '23514';
END;
$$;
CREATE TRIGGER immutable_card_version BEFORE UPDATE OR DELETE ON worldstudio.setting_card_version
FOR EACH ROW EXECUTE FUNCTION worldstudio.reject_snapshot_change();
CREATE TRIGGER immutable_relationship_version BEFORE UPDATE OR DELETE ON worldstudio.relationship_version
FOR EACH ROW EXECUTE FUNCTION worldstudio.reject_snapshot_change();
CREATE TRIGGER immutable_save_request BEFORE UPDATE OR DELETE ON worldstudio.world_save_request
FOR EACH ROW EXECUTE FUNCTION worldstudio.reject_snapshot_change();

-- Lock the parent before any manifest edit so sealing and concurrent edits cannot race.
CREATE FUNCTION worldstudio.guard_manifest() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog AS $$
DECLARE target uuid; is_sealed boolean;
BEGIN
    IF TG_OP = 'UPDATE' THEN
        RAISE EXCEPTION 'Replace unsealed manifest rows with delete/insert' USING ERRCODE = '23514';
    END IF;
    IF TG_OP = 'DELETE' THEN target := OLD.revision_id; ELSE target := NEW.revision_id; END IF;
    SELECT sealed INTO is_sealed FROM worldstudio.world_revision WHERE id = target FOR UPDATE;
    IF is_sealed THEN
        RAISE EXCEPTION 'Sealed WorldStudio manifest is immutable' USING ERRCODE = '23514';
    END IF;
    IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
    RETURN NEW;
END;
$$;
CREATE TRIGGER guard_card_manifest BEFORE INSERT OR UPDATE OR DELETE ON worldstudio.world_revision_card
FOR EACH ROW EXECUTE FUNCTION worldstudio.guard_manifest();
CREATE TRIGGER guard_relationship_manifest BEFORE INSERT OR UPDATE OR DELETE ON worldstudio.world_revision_relationship
FOR EACH ROW EXECUTE FUNCTION worldstudio.guard_manifest();

CREATE FUNCTION worldstudio.guard_revision() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog AS $$
BEGIN
    IF TG_OP = 'INSERT' THEN
        IF NEW.sealed THEN
            RAISE EXCEPTION 'Assemble a revision before sealing' USING ERRCODE = '23514';
        END IF;
        RETURN NEW;
    END IF;
    IF OLD.sealed THEN
        RAISE EXCEPTION 'Sealed WorldStudio revision is immutable' USING ERRCODE = '23514';
    END IF;
    IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
    IF NEW.sealed AND EXISTS (
        SELECT 1 FROM worldstudio.world_revision_relationship m
        JOIN worldstudio.relationship_version r ON r.id = m.version_id
        WHERE m.revision_id = NEW.id AND r.lifecycle = 'active' AND (
            NOT EXISTS (
                SELECT 1 FROM worldstudio.world_revision_card c
                JOIN worldstudio.setting_card_version v ON v.id = c.version_id
                WHERE c.revision_id = NEW.id AND c.card_id = r.source_card_id AND v.lifecycle = 'active'
            ) OR NOT EXISTS (
                SELECT 1 FROM worldstudio.world_revision_card c
                JOIN worldstudio.setting_card_version v ON v.id = c.version_id
                WHERE c.revision_id = NEW.id AND c.card_id = r.target_card_id AND v.lifecycle = 'active'
            )
        )
    ) THEN
        RAISE EXCEPTION 'Active relationship endpoints must be active in this revision' USING ERRCODE = '23514';
    END IF;
    RETURN NEW;
END;
$$;
CREATE TRIGGER guard_revision BEFORE INSERT OR UPDATE OR DELETE ON worldstudio.world_revision
FOR EACH ROW EXECUTE FUNCTION worldstudio.guard_revision();

CREATE FUNCTION worldstudio.require_sealed_revision() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog AS $$
BEGIN
    IF EXISTS (SELECT 1 FROM worldstudio.world_revision WHERE id = NEW.id AND NOT sealed) THEN
        RAISE EXCEPTION 'Unsealed WorldStudio revision cannot commit' USING ERRCODE = '23514';
    END IF;
    RETURN NULL;
END;
$$;
CREATE CONSTRAINT TRIGGER require_sealed_revision AFTER INSERT OR UPDATE ON worldstudio.world_revision
DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION worldstudio.require_sealed_revision();
