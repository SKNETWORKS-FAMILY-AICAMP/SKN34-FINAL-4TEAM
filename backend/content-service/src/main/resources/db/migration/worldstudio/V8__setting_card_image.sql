-- Setting card representative image uploaded by the owner (#401). The bytes live in the attachment object store (MinIO/S3) under world-card-images/<id>;
-- only the object key and the content type detected from the bytes are kept here. An uploaded image never changes: replacing it means uploading a new
-- one and pointing the card (semanticMetadata.imageId) at the new id, so a saved revision that still points at the old id keeps showing it.
CREATE TABLE worldstudio.setting_card_image (
    id uuid PRIMARY KEY,
    world_id uuid NOT NULL REFERENCES worldstudio.world(id),
    object_key text NOT NULL UNIQUE,
    content_type text NOT NULL CHECK (content_type IN ('image/png','image/jpeg','image/webp')),
    created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX setting_card_image_world_idx ON worldstudio.setting_card_image(world_id);
