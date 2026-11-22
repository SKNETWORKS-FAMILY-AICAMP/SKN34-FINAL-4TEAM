-- AI 자율 연재(UC-18, #659): 소유자 설정, 회차마다 열리는 독자 게시판(AI 4지선다 투표 + 제안 게시판), 선택지, 투표, 제안 글, 추천. 작성자 표시명은 저장하지 않는다(응답 때마다 Core 닉네임을 조회한다).
-- 작품 삭제는 소프트 삭제(DEC-42)라 행을 지우지 않는다. 일정은 KST 기준이며 days는 'MON,WED'처럼 월요일부터의 순서로 저장한다.
-- 투표·제안 개편(2026-11-22 사용자 결정)은 아직 develop에 없는 이 파일을 직접 고친 것이다(독자 의견 대신 AI 선택지 투표와 제안 글·추천).
CREATE TABLE ai_serial (
    work_id varchar(36) PRIMARY KEY REFERENCES work(id),
    enabled boolean NOT NULL DEFAULT false,
    days text NOT NULL DEFAULT '',
    run_time time NOT NULL,
    direction text NOT NULL DEFAULT '',
    last_run_date date,
    updated_at timestamptz NOT NULL
);
CREATE TABLE serial_board (
    id varchar(36) PRIMARY KEY,
    work_id varchar(36) NOT NULL REFERENCES work(id),
    episode_number integer NOT NULL CHECK (episode_number > 0),
    status text NOT NULL CHECK (status IN ('open','queued','running','published','failed')),
    summary text,
    published_episode_number integer,
    failure_reason text,
    opened_at timestamptz NOT NULL,
    closed_at timestamptz,
    choices_tried_at timestamptz
);
-- 작품당 열린(open·queued·running) 게시판은 하나다. 동시에 열려는 요청과 실행 선점의 마지막 방어다.
CREATE UNIQUE INDEX serial_board_one_active ON serial_board (work_id) WHERE status IN ('open', 'queued', 'running');
CREATE INDEX serial_board_work ON serial_board (work_id, opened_at DESC);
-- AI가 게시판마다 만드는 다음 전개 선택지 4개다(번호 1~4).
CREATE TABLE serial_choice (
    id varchar(36) PRIMARY KEY,
    board_id varchar(36) NOT NULL REFERENCES serial_board(id),
    position integer NOT NULL CHECK (position BETWEEN 1 AND 4),
    text text NOT NULL,
    UNIQUE (board_id, position)
);
-- 제안 게시판의 글이다. 작성자당 개수 제한은 없다.
CREATE TABLE serial_proposal (
    id varchar(36) PRIMARY KEY,
    board_id varchar(36) NOT NULL REFERENCES serial_board(id),
    author_id varchar(200) NOT NULL,
    kind text NOT NULL CHECK (kind IN ('general','simulation')),
    title text NOT NULL,
    body text NOT NULL,
    simulation jsonb,
    hidden boolean NOT NULL DEFAULT false,
    created_at timestamptz NOT NULL
);
CREATE INDEX serial_proposal_board ON serial_proposal (board_id, created_at DESC);
CREATE TABLE serial_proposal_like (
    proposal_id varchar(36) NOT NULL REFERENCES serial_proposal(id),
    member_id varchar(200) NOT NULL,
    PRIMARY KEY (proposal_id, member_id)
);
CREATE TABLE serial_vote (
    board_id varchar(36) NOT NULL REFERENCES serial_board(id),
    member_id varchar(200) NOT NULL,
    choice_id varchar(36) NOT NULL REFERENCES serial_choice(id),
    PRIMARY KEY (board_id, member_id)
);
