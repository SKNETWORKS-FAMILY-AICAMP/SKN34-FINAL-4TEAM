-- Operations-owned moderation flag; restricted works are hidden from public reads only.
ALTER TABLE work ADD COLUMN restricted boolean NOT NULL DEFAULT false;
