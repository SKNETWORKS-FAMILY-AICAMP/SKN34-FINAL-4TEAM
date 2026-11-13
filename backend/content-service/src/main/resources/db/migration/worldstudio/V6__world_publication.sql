-- World-level publication (DEC-45). Existing worlds stay private; no other data changes.
-- published_at is the time the world last became public and is NULL exactly while private.
ALTER TABLE worldstudio.world
    ADD COLUMN visibility text NOT NULL DEFAULT 'private' CHECK (visibility IN ('private','public')),
    ADD COLUMN genre text CHECK (genre IN ('fantasy','sf','wuxia','romance','modern','classic','mystery')),
    ADD COLUMN published_at timestamptz,
    ADD CONSTRAINT world_published_at_matches_visibility CHECK ((visibility = 'public') = (published_at IS NOT NULL));
