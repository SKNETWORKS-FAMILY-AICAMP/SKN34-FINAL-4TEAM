-- AI 자율 집필(#659)을 집필 방식 'autonomous'로 통합한다: 집필 방식 CHECK에 값 하나만 더한다. 이력 행과 불변성 규칙은 그대로다.
ALTER TABLE work_automation_version DROP CONSTRAINT work_automation_version_writing_mode_check;
ALTER TABLE work_automation_version ADD CONSTRAINT work_automation_version_writing_mode_check
    CHECK (writing_mode IN ('direct', 'assisted', 'autonomous'));
