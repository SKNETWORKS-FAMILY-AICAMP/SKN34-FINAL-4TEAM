-- 회원이 공개 작품에 남기는 좋아요. 작품당 회원 1회(PK)이며 수는 요청 때 센다(집계 칼럼 없음).
CREATE TABLE work_like (
    work_id varchar(36) NOT NULL REFERENCES work(id),
    member_id varchar(200) NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (work_id, member_id)
);
