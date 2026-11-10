ALTER TABLE episode_draft ADD COLUMN author_note varchar(2000) NOT NULL DEFAULT '';
ALTER TABLE episode_version ADD COLUMN author_note varchar(2000) NOT NULL DEFAULT '';
