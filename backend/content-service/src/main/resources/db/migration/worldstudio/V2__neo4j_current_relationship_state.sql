-- Metadata only. Legacy rows and all existing relationship tables/history stay untouched.
-- No backfill: a world without this row requires a separately approved data transition.
CREATE TABLE worldstudio.relationship_state (
    world_id uuid PRIMARY KEY REFERENCES worldstudio.world(id),
    graph_version bigint NOT NULL DEFAULT -1 CHECK (graph_version >= -1),
    creation_hash text NOT NULL,
    request_key text NOT NULL,
    request_hash text NOT NULL,
    expected_draft_revision bigint NOT NULL DEFAULT -1 CHECK (expected_draft_revision >= -1),
    completed boolean NOT NULL DEFAULT false
);
