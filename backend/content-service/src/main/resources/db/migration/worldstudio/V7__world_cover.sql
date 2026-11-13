-- World cover image uploaded by the owner. The bytes live in the attachment object store (MinIO/S3); only the object key and the
-- content type detected from the bytes are kept here. Existing worlds have no cover. The two columns are NULL or set together.
ALTER TABLE worldstudio.world
    ADD COLUMN cover_object_key text,
    ADD COLUMN cover_content_type text CHECK (cover_content_type IN ('image/png','image/jpeg','image/webp')),
    ADD CONSTRAINT world_cover_key_matches_type CHECK ((cover_object_key IS NULL) = (cover_content_type IS NULL));
