-- 회차 원고 전처리 작업 기록(DEC-50, #343). 실행은 AI 서비스가 하고 이 표는 접수·진행·실패만 기록한다(결과 카드·관계는 두지 않는다).
-- 작업 감시 화면(DEC-55)이 이 표를 읽는다. 작품 삭제는 소프트 삭제(DEC-42)라 행을 지우지 않는다. world_id는 worldstudio 쪽 uuid라 FK가 없다.
CREATE TABLE preprocessing_job (
    id varchar(36) PRIMARY KEY,
    work_id varchar(36) NOT NULL REFERENCES work(id),
    world_id uuid,
    member_id varchar(200) NOT NULL,
    status text NOT NULL CHECK (status IN ('queued','running','loading','completed','failed')),
    done integer NOT NULL DEFAULT 0 CHECK (done >= 0),
    total integer NOT NULL DEFAULT 0 CHECK (total >= 0),
    failed_episodes integer[] NOT NULL DEFAULT '{}',
    failed_reason text,
    created_at timestamptz NOT NULL,
    started_at timestamptz,
    finished_at timestamptz
);
-- 같은 작품의 진행 중·완료 작업은 하나다(동시 접수·옛 작업 재실행의 마지막 방어). 실패한 작업은 여러 개 남을 수 있다.
CREATE UNIQUE INDEX preprocessing_job_one_per_work ON preprocessing_job (work_id) WHERE status IN ('queued','running','loading','completed');
