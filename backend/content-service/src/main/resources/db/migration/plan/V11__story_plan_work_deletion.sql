-- 작품의 실제 삭제에만 종속한다. 계획 API의 논리 삭제와 부모-장면 제약은 유지한다.
ALTER TABLE story_plan
    DROP CONSTRAINT story_plan_work_id_fkey,
    ADD CONSTRAINT story_plan_work_id_fkey FOREIGN KEY (work_id) REFERENCES work(id) ON DELETE CASCADE;

ALTER TABLE story_plan_character
    DROP CONSTRAINT story_plan_character_plan_id_fkey,
    ADD CONSTRAINT story_plan_character_plan_id_fkey FOREIGN KEY (plan_id) REFERENCES story_plan(id) ON DELETE CASCADE;

ALTER TABLE story_plan_place
    DROP CONSTRAINT story_plan_place_plan_id_fkey,
    ADD CONSTRAINT story_plan_place_plan_id_fkey FOREIGN KEY (plan_id) REFERENCES story_plan(id) ON DELETE CASCADE;

-- 기존 active 인덱스에서 제외되는 논리 삭제 계획도 작품 삭제 시 찾아야 한다.
CREATE INDEX story_plan_work ON story_plan(work_id);
