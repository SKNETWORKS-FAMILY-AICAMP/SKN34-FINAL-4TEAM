-- Explicit owner publication/cover choices must be detectable across the graph read.
ALTER TABLE worldstudio.world ADD COLUMN owner_metadata_version bigint NOT NULL DEFAULT 0 CHECK (owner_metadata_version >= 0);

-- One decision per platform template, committed with its creation or publication.
CREATE TABLE worldstudio.template_publication_once (
    world_id uuid PRIMARY KEY REFERENCES worldstudio.world(id)
);
