-- 발행 회차로 세계관 초안을 더하는 update 작업(2026-11-22 사용자 결정)은 최초 구축(initial)이 끝난 작품에도 접수된다.
-- 작품당 진행 중·완료 작업 하나(V41)는 initial에만 두고, update는 같은 작품에서 동시에 하나만 진행하게 한다(동시 접수의 마지막 방어).
-- 실패한 작업은 종류와 관계없이 여러 개 남을 수 있다. 종류는 접수 때 정하고 V15 동기화 트리거는 상태·진행만 맞추므로 건드리지 않는다.
ALTER TABLE preprocessing_job ADD COLUMN kind text NOT NULL DEFAULT 'initial' CHECK (kind IN ('initial','update'));
DROP INDEX preprocessing_job_one_per_work;
CREATE UNIQUE INDEX preprocessing_job_one_per_work ON preprocessing_job (work_id) WHERE kind='initial' AND status IN ('queued','running','loading','completed');
CREATE UNIQUE INDEX preprocessing_job_one_open_update_per_work ON preprocessing_job (work_id) WHERE kind='update' AND status IN ('queued','running','loading');
