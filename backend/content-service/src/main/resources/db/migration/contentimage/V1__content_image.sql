CREATE TABLE content_image (
    id varchar(36) PRIMARY KEY,
    work_id varchar(36) NOT NULL REFERENCES work(id),
    episode_no integer NOT NULL CHECK (episode_no >= 0),
    object_key text NOT NULL UNIQUE,
    filename varchar(120) NOT NULL,
    media_type varchar(20) NOT NULL CHECK (media_type IN ('image/png', 'image/jpeg')),
    byte_size bigint NOT NULL CHECK (byte_size > 0 AND byte_size <= 10485760),
    created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX content_image_one_cover ON content_image(work_id) WHERE episode_no = 0;
CREATE INDEX content_image_episode ON content_image(work_id, episode_no);
