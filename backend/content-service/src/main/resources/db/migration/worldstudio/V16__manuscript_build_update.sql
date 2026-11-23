-- 발행 회차로 세계관 초안을 업데이트하는 작업(2026-11-22 사용자 결정). 같은 표·결과·적재 단계·V15 트리거를 그대로 쓰고 종류만 더한다(기존 행은 initial).
ALTER TABLE worldstudio.manuscript_build_job ADD COLUMN kind text NOT NULL DEFAULT 'initial' CHECK (kind IN ('initial','update'));
-- update 작업의 기준 초안이다. manifest는 접수 때 고정하는 불변 입력이고 기준 초안은 실행권을 받는 claim 때 정해지므로 따로 둔다(initial은 manifest.basis를 그대로 쓴다).
-- V15 불변 트리거가 비교하는 입력 칼럼(id·work_id·world_id·owner_subject·request_key/hash·manifest·created_at)에 들지 않아 claim 때 쓸 수 있고, completed 행은 전체가 불변이다.
ALTER TABLE worldstudio.manuscript_build_job ADD COLUMN basis jsonb CHECK (basis IS NULL OR jsonb_typeof(basis)='object');
