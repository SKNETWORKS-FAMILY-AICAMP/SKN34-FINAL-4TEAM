CREATE TABLE story_plan (
    id varchar(36) PRIMARY KEY,
    work_id varchar(36) NOT NULL REFERENCES work(id),
    kind varchar(10) NOT NULL CHECK (kind IN ('plot','scene')),
    parent_id varchar(36),
    title text NOT NULL CHECK (length(trim(title)) BETWEEN 1 AND 120),
    content text NOT NULL CHECK (length(content) <= 8000),
    episode_id varchar(36) REFERENCES episode(id) ON DELETE SET NULL,
    episode_number integer CHECK (episode_number > 0),
    revision integer NOT NULL CHECK (revision >= 0),
    created_at timestamptz NOT NULL,
    deleted_at timestamptz,
    UNIQUE (id,work_id),
    FOREIGN KEY (parent_id,work_id) REFERENCES story_plan(id,work_id),
    CHECK ((kind='plot' AND parent_id IS NULL AND episode_number IS NULL) OR (kind='scene' AND parent_id IS NOT NULL))
);
CREATE INDEX story_plan_active ON story_plan(work_id,created_at,id) WHERE deleted_at IS NULL;
CREATE INDEX story_plan_children ON story_plan(work_id,parent_id) WHERE deleted_at IS NULL;
CREATE TABLE story_plan_character (
    plan_id varchar(36) NOT NULL REFERENCES story_plan(id),
    position integer NOT NULL,
    setting_id varchar(200) NOT NULL,
    PRIMARY KEY (plan_id,position), UNIQUE (plan_id,setting_id)
);
CREATE TABLE story_plan_place (
    plan_id varchar(36) NOT NULL REFERENCES story_plan(id),
    position integer NOT NULL,
    setting_id varchar(200) NOT NULL,
    PRIMARY KEY (plan_id,position), UNIQUE (plan_id,setting_id)
);
