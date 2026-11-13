-- 작품 소식(공지). 삭제는 행을 지우지 않고 deleted_at만 기록한다(DEC-42). 작성자 표시명은 저장하지 않는다.
CREATE TABLE work_notice (
    id varchar(36) PRIMARY KEY,
    work_id varchar(36) NOT NULL REFERENCES work(id),
    author_id varchar(200) NOT NULL,
    category text NOT NULL CHECK (category IN ('info','hiatus','event')),
    title text NOT NULL,
    body text NOT NULL,
    pinned boolean NOT NULL DEFAULT false,
    created_at timestamptz NOT NULL,
    updated_at timestamptz NOT NULL,
    deleted_at timestamptz
);
CREATE INDEX work_notice_work ON work_notice (work_id) WHERE deleted_at IS NULL;
