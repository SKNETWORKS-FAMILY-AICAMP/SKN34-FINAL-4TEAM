-- 순서 목록을 갱신하는 중간 중복만 허용하고, 커밋 시 최종 중복은 계속 거부한다.
ALTER TABLE story_plan_character
    DROP CONSTRAINT story_plan_character_plan_id_setting_id_key,
    ADD CONSTRAINT story_plan_character_plan_id_setting_id_key
        UNIQUE (plan_id, setting_id) DEFERRABLE INITIALLY DEFERRED;

ALTER TABLE story_plan_place
    DROP CONSTRAINT story_plan_place_plan_id_setting_id_key,
    ADD CONSTRAINT story_plan_place_plan_id_setting_id_key
        UNIQUE (plan_id, setting_id) DEFERRABLE INITIALLY DEFERRED;
