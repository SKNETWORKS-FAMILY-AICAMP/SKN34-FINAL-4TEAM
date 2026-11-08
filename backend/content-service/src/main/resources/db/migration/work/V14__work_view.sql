CREATE TABLE work_view (
    work_id varchar(36) NOT NULL REFERENCES work(id),
    episode_number integer NOT NULL CHECK (episode_number > 0),
    member_id varchar(200) NOT NULL,
    view_date date NOT NULL,
    viewed_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (work_id, episode_number, member_id, view_date)
);
CREATE INDEX work_view_viewed_at ON work_view (viewed_at);
