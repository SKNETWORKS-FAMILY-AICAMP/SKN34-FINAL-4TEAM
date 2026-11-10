-- 회원의 독서 기록. 이어 읽기 위치는 회원·작품당 한 행(최근에 연 회차), 연 회차는 회원·작품·회차당 한 행이다.
CREATE TABLE reading_record (
    member_id varchar(200) NOT NULL,
    work_id varchar(36) NOT NULL REFERENCES work(id),
    last_episode integer NOT NULL CHECK (last_episode > 0),
    updated_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (member_id, work_id)
);
CREATE TABLE reading_episode (
    member_id varchar(200) NOT NULL,
    work_id varchar(36) NOT NULL REFERENCES work(id),
    episode_number integer NOT NULL CHECK (episode_number > 0),
    read_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (member_id, work_id, episode_number)
);
