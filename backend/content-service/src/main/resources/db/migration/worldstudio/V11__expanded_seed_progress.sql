CREATE TABLE worldstudio.expanded_seed_progress (
    world_id uuid PRIMARY KEY REFERENCES worldstudio.world(id),
    input_hash text NOT NULL,
    next_chunk integer NOT NULL DEFAULT 0 CHECK (next_chunk >= 0),
    completed boolean NOT NULL DEFAULT false,
    base_draft_revision bigint NOT NULL DEFAULT 0 CHECK (base_draft_revision >= 0),
    base_graph_version bigint NOT NULL DEFAULT 0 CHECK (base_graph_version >= 0),
    base_revision_id uuid REFERENCES worldstudio.world_revision(id),
    base_visibility text NOT NULL DEFAULT 'private' CHECK (base_visibility IN ('private', 'public'))
);
