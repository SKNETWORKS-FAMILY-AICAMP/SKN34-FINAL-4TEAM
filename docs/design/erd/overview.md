# STORYFORK 전체 업무 ERD — 정규화 논리 후보

> **설계 후보 · 업무 DB 미구현.** 요구사항 정의서의 116개 기능 ID, Markdown 추가 3개(합계 **119개**)와 UC-01~28을 대조했습니다. 기존 41개 엔티티에서 **143개 논리 테이블 후보**로 재구성했습니다. 전체 서비스 모델이며 전부 MVP에서 구현한다는 뜻이 아닙니다. 구체 SQL·타입·삭제 동작·인덱스·물리 배치는 확정하지 않았습니다.
>
> [목차](README.md) · [정규화 근거·검증·명세 충돌](normalization.md) · [전체 테이블 설명](tables.md) · [119개 요구사항 추적표](requirements-matrix.md) · [AI Saver 참고](ai-service/postgres-saver.md)

## 기준과 읽는 법

1. 최신 [결정 DEC-26~40](../decisions.md#결정-목록), 갱신된 상세 UC의 현재 본문을 기준으로 삼고, 엑셀/기능 색인의 오래된 문구와 충돌은 별도로 기록합니다. Gitea·pg_git을 재도입하거나 미룬 기능을 MVP로 올리지 않습니다.
2. **Core**는 계정·작품·원문·버전·Fork·사용자 승인·발행·정산 판단의 소유자입니다. **관계 그래프 DB**는 관계 저장·조회 방향이며 정본·시점 모델·동기화는 미정입니다. 그림의 `graph_state_ref`는 외부 참조이지 PostgreSQL FK가 아닙니다.
3. **AI Service**의 Saver/추적 저장소는 별도입니다. 그 내부 테이블을 Core 정본으로 복제하거나 DB 간 FK로 연결하지 않습니다. `saver_thread_ref`·`trace_ref`·`prompt_version_ref`는 외부 식별자 후보입니다.
4. `PK`·`UK`·`FK`는 논리 제약 후보입니다. 선의 이름은 해당 자식 테이블의 FK 컬럼이고 `o|` 부모는 선택 참조입니다. FK 목적지는 [가이드](tables.md)에 명시합니다. 그 밖의 NULL·상태별 필수값과 복합 소속 검증은 구현 전 구체화합니다.
5. TEXT는 원고·설명·필요한 당시 인용 등 문서 값에 사용합니다. 태그/장르/참여자/근거/반영 결과 목록을 쉼표나 JSON 한 칸에 압축하지 않습니다. 동일 행의 단일값까지 무조건 세로로 나누지는 않습니다.

## 범위

| 표기 | 의미 |
|---|---|
| MVP | 현재 핵심 흐름의 논리 후보. 구현 완료나 모든 컬럼 확정이 아님 |
| MVP 이후 | 명세에 있으나 최신 설계에서 시연 이후로 미룬 기능 |
| 전체·범위확인 | 전체 요구사항에 필요하지만 MVP 상세 포함 여부를 별도 확인 |
| 보류·재설계 | 최신 정책과 과거 상세 흐름 충돌 때문에 계약 확정 불가 |
| 테스트 전용 | 운영 기능이 아닌 검증 환경용 |

## 전체 관계

큰 그림은 전체 연결 확인용입니다. 실제 검토에는 10개 [업무 영역별 부분 뷰](README.md#core-업무-영역별-erd)를 사용합니다. 모든 부분 뷰의 엔티티 정의와 관계는 아래 원본과 동일하며, 다른 영역 테이블은 참조일 뿐 중복 생성하지 않습니다.

```mermaid
erDiagram
    MEMBER ||--o{ MEMBER_CONSENT : "member_id"
    TERMS_VERSION ||--o{ MEMBER_CONSENT : "terms_version_id"
    MEMBER ||--o{ AUTH_SESSION : "member_id"
    AUTH_SESSION ||--o{ REFRESH_TOKEN : "session_id"
    REFRESH_TOKEN o|--o{ REFRESH_TOKEN : "previous_token_id"
    MEMBER o|--o{ ACCOUNT_CHALLENGE : "member_id"
    MEMBER ||--o{ ACCOUNT_WITHDRAWAL : "member_id"
    MEMBER ||--o{ WORLD : "owner_id"
    WORLD ||--o{ SETTING_DOCUMENT : "world_id"
    SETTING_DOCUMENT ||--o| SETTING_DRAFT : "setting_document_id"
    SETTING_CATEGORY ||--o{ SETTING_DRAFT : "category_id"
    SETTING_DOCUMENT ||--o{ SETTING_VERSION : "setting_document_id"
    SETTING_CATEGORY ||--o{ SETTING_VERSION : "category_id"
    SETTING_VERSION o|--o{ SETTING_VERSION : "restored_from_id"
    SETTING_DOCUMENT ||--o| SETTING_ORIGIN : "setting_document_id"
    SETTING_VERSION ||--o{ SETTING_ORIGIN : "source_setting_version_id"
    SETTING_DOCUMENT ||--o{ SETTING_IMAGE : "setting_document_id"
    SETTING_DOCUMENT ||--o{ SETTING_REFERENCE : "setting_document_id"
    MEMBER ||--o{ SETTING_TAG : "owner_id"
    SETTING_DOCUMENT ||--o{ SETTING_DOCUMENT_TAG : "setting_document_id"
    SETTING_TAG ||--o{ SETTING_DOCUMENT_TAG : "setting_tag_id"
    SETTING_DOCUMENT ||--o{ SETTING_VISIBILITY_HISTORY : "setting_document_id"
    SETTING_VISIBILITY_HISTORY ||--o{ SETTING_VISIBILITY_RANGE : "visibility_history_id"
    EPISODE ||--o{ SETTING_VISIBILITY_RANGE : "start_episode_id"
    EPISODE o|--o{ SETTING_VISIBILITY_RANGE : "end_episode_id"
    SETTING_DOCUMENT ||--o{ CHARACTER_STATE_VERSION : "character_id"
    EPISODE o|--o{ CHARACTER_STATE_VERSION : "basis_episode_id"
    CHARACTER_STATE_VERSION o|--o{ CHARACTER_STATE_VERSION : "restored_from_id"
    SETTING_DOCUMENT ||--o{ CHARACTER_KNOWLEDGE_VERSION : "character_id"
    SETTING_DOCUMENT ||--o{ CHARACTER_KNOWLEDGE_VERSION : "fact_setting_id"
    EPISODE o|--o{ CHARACTER_KNOWLEDGE_VERSION : "basis_episode_id"
    WORLD ||--o{ WORLD_COMPOSITION_SOURCE : "combined_world_id"
    WORLD ||--o{ WORLD_COMPOSITION_SOURCE : "source_world_id"
    WORLD ||--o{ WORLD_USE_POLICY_HISTORY : "world_id"
    MEMBER ||--o{ WORK : "owner_id"
    WORK ||--o{ WORK_WORLD_HISTORY : "work_id"
    WORLD ||--o{ WORK_WORLD_HISTORY : "world_id"
    WORK ||--o{ WORK_GENRE : "work_id"
    GENRE ||--o{ WORK_GENRE : "genre_id"
    WORK ||--o{ WORK_HASHTAG : "work_id"
    HASHTAG ||--o{ WORK_HASHTAG : "hashtag_id"
    WORK ||--o{ WORK_PUBLICATION_HISTORY : "work_id"
    WORK ||--o{ WORK_RIGHTS_DECLARATION : "work_id"
    MEMBER ||--o{ WORK_RIGHTS_DECLARATION : "member_id"
    WORK ||--o{ WORK_LIKE : "work_id"
    MEMBER ||--o{ WORK_LIKE : "member_id"
    MEMBER ||--o{ WORK_FAVORITE : "member_id"
    WORK ||--o{ WORK_FAVORITE : "work_id"
    MEMBER ||--o{ READING_PROGRESS : "member_id"
    WORK ||--o{ READING_PROGRESS : "work_id"
    EPISODE_VERSION ||--o{ READING_PROGRESS : "episode_version_id"
    EPISODE ||--o{ EPISODE_VIEW_DAY : "episode_id"
    WORK ||--o{ EPISODE : "work_id"
    EPISODE ||--o| EPISODE_DRAFT : "episode_id"
    EPISODE ||--o{ EPISODE_VERSION : "episode_id"
    WORK_WORLD_HISTORY ||--o{ EPISODE_VERSION : "work_world_history_id"
    EPISODE_VERSION o|--o{ EPISODE_VERSION : "restored_from_id"
    MEMBER ||--o{ MANUSCRIPT_ASSET : "owner_id"
    EPISODE_DRAFT ||--o{ EPISODE_DRAFT_IMAGE : "episode_id"
    MANUSCRIPT_ASSET ||--o{ EPISODE_DRAFT_IMAGE : "asset_id"
    EPISODE_VERSION ||--o{ EPISODE_VERSION_IMAGE : "episode_version_id"
    MANUSCRIPT_ASSET ||--o{ EPISODE_VERSION_IMAGE : "asset_id"
    EPISODE_DRAFT ||--o{ EPISODE_DRAFT_MENTION : "episode_id"
    SETTING_DOCUMENT ||--o{ EPISODE_DRAFT_MENTION : "character_id"
    EPISODE_VERSION ||--o{ EPISODE_VERSION_MENTION : "episode_version_id"
    SETTING_DOCUMENT ||--o{ EPISODE_VERSION_MENTION : "character_id"
    EPISODE_VERSION ||--o{ PUBLICATION_EVENT : "episode_version_id"
    MEMBER o|--o{ PUBLICATION_EVENT : "actor_id"
    EPISODE_VERSION ||--o{ PUBLICATION_SCHEDULE : "episode_version_id"
    WORK ||--o{ STORY_PLAN : "work_id"
    EPISODE o|--o{ STORY_PLAN : "episode_id"
    STORY_PLAN o|--o{ STORY_PLAN : "parent_plan_id"
    WORK ||--o{ WRITING_NOTE : "work_id"
    EPISODE o|--o{ WRITING_NOTE : "episode_id"
    WORK ||--o{ MANUSCRIPT_IMPORT : "work_id"
    MANUSCRIPT_IMPORT ||--o{ MANUSCRIPT_IMPORT_ITEM : "import_id"
    EPISODE_VERSION o|--o{ MANUSCRIPT_IMPORT_ITEM : "episode_version_id"
    MANUSCRIPT_IMPORT_ITEM ||--o{ MANUSCRIPT_IMPORT_ISSUE : "import_item_id"
    WORK ||--o{ CHECKPOINT : "work_id"
    EPISODE_VERSION ||--o{ CHECKPOINT : "basis_episode_version_id"
    CHECKPOINT ||--o{ CHECKPOINT_EPISODE : "checkpoint_id"
    EPISODE ||--o{ CHECKPOINT_EPISODE : "episode_id"
    EPISODE_VERSION ||--o{ CHECKPOINT_EPISODE : "episode_version_id"
    CHECKPOINT ||--o{ CHECKPOINT_SETTING : "checkpoint_id"
    SETTING_DOCUMENT ||--o{ CHECKPOINT_SETTING : "setting_document_id"
    SETTING_VERSION ||--o{ CHECKPOINT_SETTING : "setting_version_id"
    CHECKPOINT ||--o{ CHECKPOINT_CHARACTER_STATE : "checkpoint_id"
    SETTING_DOCUMENT ||--o{ CHECKPOINT_CHARACTER_STATE : "character_id"
    CHARACTER_STATE_VERSION ||--o{ CHECKPOINT_CHARACTER_STATE : "state_version_id"
    CHECKPOINT ||--o{ CHECKPOINT_CHARACTER_KNOWLEDGE : "checkpoint_id"
    SETTING_DOCUMENT ||--o{ CHECKPOINT_CHARACTER_KNOWLEDGE : "character_id"
    SETTING_DOCUMENT ||--o{ CHECKPOINT_CHARACTER_KNOWLEDGE : "fact_setting_id"
    CHARACTER_KNOWLEDGE_VERSION ||--o{ CHECKPOINT_CHARACTER_KNOWLEDGE : "knowledge_version_id"
    WORK ||--o{ FORK_POLICY_HISTORY : "work_id"
    EPISODE o|--o{ FORK_POLICY_HISTORY : "start_episode_id"
    FORK_POLICY_HISTORY ||--o{ FORK_POLICY_EPISODE : "policy_history_id"
    EPISODE ||--o{ FORK_POLICY_EPISODE : "episode_id"
    WORK ||--o| FORK : "work_id"
    CHECKPOINT ||--o{ FORK : "source_checkpoint_id"
    FORK_POLICY_HISTORY ||--o{ FORK : "confirmed_policy_history_id"
    FORK ||--o| FORK_WORLD_REFERENCE : "fork_work_id"
    WORLD ||--o{ FORK_WORLD_REFERENCE : "source_world_id"
    CHECKPOINT o|--o{ FORK_WORLD_REFERENCE : "last_followed_checkpoint_id"
    FORK ||--o{ FORK_SOURCE_CHANGE : "fork_work_id"
    CHECKPOINT ||--o{ FORK_SOURCE_CHANGE : "before_checkpoint_id"
    CHECKPOINT ||--o{ FORK_SOURCE_CHANGE : "after_checkpoint_id"
    FORK_SOURCE_CHANGE ||--o{ FORK_CHANGE_DECISION : "source_change_id"
    MEMBER ||--o{ FORK_CHANGE_DECISION : "actor_id"
    FORK_CHANGE_DECISION ||--o{ FORK_CHANGE_APPLICATION : "decision_id"
    CHECKPOINT o|--o{ FORK_CHANGE_APPLICATION : "result_checkpoint_id"
    MEMBER ||--o{ CHAT_SESSION : "owner_id"
    WORK ||--o{ CHAT_SESSION : "context_work_id"
    FORK o|--o{ CHAT_SESSION : "target_fork_work_id"
    CHAT_SESSION ||--o{ CHAT_MESSAGE : "session_id"
    AI_JOB o|--o{ CHAT_MESSAGE : "ai_job_id"
    MEMBER ||--o{ AI_JOB : "requester_id"
    WORK o|--o{ AI_JOB : "work_id"
    CHAT_SESSION o|--o{ AI_JOB : "session_id"
    AI_JOB o|--o{ AI_JOB : "retry_of_job_id"
    CHECKPOINT o|--o{ AI_JOB : "base_checkpoint_id"
    AI_JOB ||--o{ AI_MODEL_CALL : "job_id"
    AI_MODEL_CALL o|--o{ AI_MODEL_CALL : "retry_of_call_id"
    AI_JOB ||--o{ AI_INPUT_SNAPSHOT : "job_id"
    EPISODE o|--o{ AI_INPUT_SNAPSHOT : "episode_id"
    EPISODE_VERSION o|--o{ AI_INPUT_SNAPSHOT : "episode_version_id"
    SETTING_VERSION o|--o{ AI_INPUT_SNAPSHOT : "setting_version_id"
    AI_JOB ||--o{ AI_PROPOSAL : "job_id"
    AI_INPUT_SNAPSHOT o|--o{ AI_PROPOSAL : "input_snapshot_id"
    EPISODE_VERSION o|--o{ AI_EVIDENCE : "episode_version_id"
    SETTING_VERSION o|--o{ AI_EVIDENCE : "setting_version_id"
    AI_PROPOSAL ||--o{ PROPOSAL_EVIDENCE : "proposal_id"
    AI_EVIDENCE ||--o{ PROPOSAL_EVIDENCE : "evidence_id"
    AI_PROPOSAL ||--o{ PROPOSAL_DECISION : "proposal_id"
    MEMBER o|--o{ PROPOSAL_DECISION : "actor_id"
    WORK_AUTOMATION_VERSION o|--o{ PROPOSAL_DECISION : "automation_policy_id"
    PROPOSAL_DECISION ||--o{ PROPOSAL_APPLICATION : "decision_id"
    PROPOSAL_APPLICATION ||--o{ PROPOSAL_EPISODE_CHANGE : "application_id"
    EPISODE ||--o{ PROPOSAL_EPISODE_CHANGE : "episode_id"
    EPISODE_VERSION o|--o{ PROPOSAL_EPISODE_CHANGE : "result_version_id"
    PROPOSAL_APPLICATION ||--o{ PROPOSAL_SETTING_CHANGE : "application_id"
    SETTING_DOCUMENT ||--o{ PROPOSAL_SETTING_CHANGE : "setting_document_id"
    SETTING_VERSION o|--o{ PROPOSAL_SETTING_CHANGE : "result_version_id"
    PROPOSAL_APPLICATION ||--o{ PROPOSAL_GRAPH_CHANGE : "application_id"
    AI_PROPOSAL ||--o{ PROPOSAL_IMAGE : "proposal_id"
    MANUSCRIPT_ASSET ||--o{ PROPOSAL_IMAGE : "asset_id"
    AI_JOB ||--o| SIMULATION_RUN : "job_id"
    SETTING_DOCUMENT o|--o{ SIMULATION_RUN : "location_setting_id"
    SIMULATION_RUN ||--o{ SIMULATION_PARTICIPANT : "run_id"
    SETTING_DOCUMENT ||--o{ SIMULATION_PARTICIPANT : "character_id"
    AI_PROPOSAL ||--o| SIMULATION_CANDIDATE : "proposal_id"
    SIMULATION_RUN ||--o{ SIMULATION_CANDIDATE : "run_id"
    SIMULATION_CANDIDATE ||--o{ SIMULATION_RECORD : "candidate_id"
    SIMULATION_RECORD ||--o{ SIMULATION_RECORD_PARTICIPANT : "record_id"
    SIMULATION_PARTICIPANT ||--o{ SIMULATION_RECORD_PARTICIPANT : "participant_id"
    SIMULATION_RECORD ||--o{ SIMULATION_CAUSAL_LINK : "cause_record_id"
    SIMULATION_RECORD ||--o{ SIMULATION_CAUSAL_LINK : "effect_record_id"
    AI_JOB ||--o| VERIFICATION_RESULT : "job_id"
    VERIFICATION_RESULT ||--o{ VERIFICATION_EVIDENCE : "verification_job_id"
    AI_EVIDENCE ||--o{ VERIFICATION_EVIDENCE : "evidence_id"
    CHAT_SESSION ||--o| CHARACTER_CHAT : "session_id"
    SETTING_DOCUMENT ||--o{ CHARACTER_CHAT : "character_id"
    MEMBER o|--o{ FEEDBACK : "author_id"
    EPISODE_VERSION ||--o{ FEEDBACK : "episode_version_id"
    FEEDBACK ||--o{ FEEDBACK_AMENDMENT : "feedback_id"
    MEMBER o|--o{ FEEDBACK_AMENDMENT : "actor_id"
    FEEDBACK ||--o{ FEEDBACK_STATUS_EVENT : "feedback_id"
    MEMBER o|--o{ FEEDBACK_STATUS_EVENT : "actor_id"
    AI_JOB o|--o{ FEEDBACK_STATUS_EVENT : "ai_job_id"
    FEEDBACK ||--o{ FEEDBACK_AI_JOB : "feedback_id"
    AI_JOB ||--o{ FEEDBACK_AI_JOB : "job_id"
    FEEDBACK ||--o{ FEEDBACK_RESPONSE : "feedback_id"
    AI_JOB o|--o{ FEEDBACK_RESPONSE : "ai_job_id"
    MEMBER o|--o{ FEEDBACK_RESPONSE : "author_id"
    FEEDBACK_RESPONSE ||--o{ FEEDBACK_RESPONSE_EVIDENCE : "response_id"
    AI_EVIDENCE ||--o{ FEEDBACK_RESPONSE_EVIDENCE : "evidence_id"
    FEEDBACK ||--o{ FEEDBACK_COMMENT : "feedback_id"
    MEMBER o|--o{ FEEDBACK_COMMENT : "author_id"
    FEEDBACK o|--o| FEEDBACK_VERIFICATION : "feedback_id"
    FEEDBACK_COMMENT o|--o| FEEDBACK_VERIFICATION : "comment_id"
    AI_JOB o|--o{ FEEDBACK_VERIFICATION : "original_job_id"
    FEEDBACK_VERIFICATION ||--o{ FEEDBACK_VERIFICATION_EVIDENCE : "verification_id"
    EPISODE_VERSION o|--o{ FEEDBACK_VERIFICATION_EVIDENCE : "episode_version_id"
    SETTING_VERSION o|--o{ FEEDBACK_VERIFICATION_EVIDENCE : "setting_version_id"
    FEEDBACK ||--o{ FEEDBACK_REPORT : "feedback_id"
    MEMBER ||--o{ FEEDBACK_REPORT : "reporter_id"
    FEEDBACK ||--o{ FEEDBACK_MODERATION_CHECK : "feedback_id"
    AI_JOB ||--o{ FEEDBACK_MODERATION_CHECK : "job_id"
    FEEDBACK_REPORT o|--o{ FEEDBACK_MODERATION_CHECK : "report_id"
    FEEDBACK ||--o{ FEEDBACK_MODERATION : "feedback_id"
    FEEDBACK_MODERATION_CHECK o|--o{ FEEDBACK_MODERATION : "check_id"
    MEMBER o|--o{ FEEDBACK_MODERATION : "actor_id"
    FEEDBACK ||--o{ FEEDBACK_LIKE : "feedback_id"
    MEMBER ||--o{ FEEDBACK_LIKE : "member_id"
    FEEDBACK ||--o{ FEEDBACK_PROPOSAL : "feedback_id"
    AI_PROPOSAL ||--o{ FEEDBACK_PROPOSAL : "proposal_id"
    FEEDBACK ||--o{ FEEDBACK_REVIEW : "feedback_id"
    MEMBER ||--o{ FEEDBACK_REVIEW : "actor_id"
    PROPOSAL_DECISION o|--o{ FEEDBACK_REVIEW : "proposal_decision_id"
    FEEDBACK ||--o{ FEEDBACK_RESOLUTION : "feedback_id"
    FEEDBACK_REVIEW ||--o{ FEEDBACK_RESOLUTION : "review_id"
    EPISODE_VERSION ||--o{ FEEDBACK_RESOLUTION : "episode_version_id"
    PUBLICATION_EVENT o|--o{ FEEDBACK_RESOLUTION : "publication_event_id"
    PROPOSAL_APPLICATION o|--o{ FEEDBACK_RESOLUTION : "application_id"
    FEEDBACK_RESOLUTION ||--o{ FEEDBACK_REWARD : "resolution_id"
    CREDIT_GRANT ||--o| FEEDBACK_REWARD : "credit_grant_id"
    WORK ||--o{ WORK_AUTOMATION_VERSION : "work_id"
    WORK_AUTOMATION_VERSION ||--o| AUTOSERIAL_CONFIG_VERSION : "automation_version_id"
    AUTOSERIAL_CONFIG_VERSION ||--o{ AUTOSERIAL_SLOT : "config_version_id"
    AUTOSERIAL_CONFIG_VERSION ||--o{ AUTOSERIAL_RUN : "config_version_id"
    SCHEDULED_TASK_ITEM o|--o{ AUTOSERIAL_RUN : "scheduled_task_item_id"
    AI_JOB o|--o{ AUTOSERIAL_RUN : "ai_job_id"
    EPISODE_VERSION o|--o{ AUTOSERIAL_RUN : "generated_version_id"
    PUBLICATION_EVENT o|--o{ AUTOSERIAL_RUN : "publication_event_id"
    MEMBER ||--o{ AI_COST_CONSENT : "member_id"
    AI_JOB o|--o{ AI_COST_CONSENT : "job_id"
    WORK_AUTOMATION_VERSION o|--o{ AI_COST_CONSENT : "automation_version_id"
    MEMBER ||--o{ MEMBER_SUBSCRIPTION : "member_id"
    SUBSCRIPTION_PLAN ||--o{ MEMBER_SUBSCRIPTION : "plan_id"
    MEMBER_SUBSCRIPTION ||--o{ SUBSCRIPTION_PERIOD : "subscription_id"
    MEMBER_SUBSCRIPTION ||--o{ CREDIT_PURCHASE : "subscription_id"
    MEMBER ||--o{ CREDIT_GRANT : "member_id"
    SUBSCRIPTION_PERIOD o|--o{ CREDIT_GRANT : "subscription_period_id"
    CREDIT_PURCHASE o|--o{ CREDIT_GRANT : "purchase_id"
    AI_JOB ||--o| CREDIT_SETTLEMENT : "job_id"
    AI_COST_CONSENT o|--o{ CREDIT_SETTLEMENT : "consent_id"
    MEMBER o|--o{ CREDIT_SETTLEMENT : "payer_member_id"
    CREDIT_SETTLEMENT ||--o{ CREDIT_SETTLEMENT_LINE : "settlement_id"
    AI_MODEL_CALL ||--o| CREDIT_SETTLEMENT_LINE : "call_id"
    CREDIT_GRANT ||--o{ CREDIT_LEDGER_ENTRY : "grant_id"
    CREDIT_SETTLEMENT_LINE o|--o{ CREDIT_LEDGER_ENTRY : "settlement_line_id"
    MEMBER ||--o| STORAGE_QUOTA : "member_id"
    RIGHTS_CASE ||--o{ RIGHTS_REPORT : "case_id"
    MEMBER ||--o{ RIGHTS_REPORT : "reporter_id"
    RIGHTS_CASE ||--o{ RIGHTS_CASE_TARGET : "case_id"
    WORK o|--o{ RIGHTS_CASE_TARGET : "work_id"
    EPISODE o|--o{ RIGHTS_CASE_TARGET : "episode_id"
    WORLD o|--o{ RIGHTS_CASE_TARGET : "world_id"
    SETTING_DOCUMENT o|--o{ RIGHTS_CASE_TARGET : "setting_document_id"
    RIGHTS_REPORT ||--o{ RIGHTS_REPORT_TARGET : "report_id"
    RIGHTS_CASE_TARGET ||--o{ RIGHTS_REPORT_TARGET : "case_target_id"
    RIGHTS_CASE_TARGET ||--o{ RIGHTS_DEFENSE : "case_target_id"
    MEMBER ||--o{ RIGHTS_DEFENSE : "owner_id"
    RIGHTS_REPORT o|--o{ RIGHTS_EVIDENCE : "report_id"
    RIGHTS_DEFENSE o|--o{ RIGHTS_EVIDENCE : "defense_id"
    RIGHTS_CASE ||--o{ RIGHTS_DECISION : "case_id"
    MEMBER ||--o{ RIGHTS_DECISION : "operator_id"
    RIGHTS_CASE_TARGET ||--o{ CONTENT_MODERATION_ASSESSMENT : "target_id"
    AI_JOB ||--o{ CONTENT_MODERATION_ASSESSMENT : "ai_job_id"
    RIGHTS_CASE_TARGET ||--o{ CONTENT_RESTRICTION : "target_id"
    RIGHTS_DECISION o|--o{ CONTENT_RESTRICTION : "decision_id"
    CONTENT_MODERATION_ASSESSMENT o|--o{ CONTENT_RESTRICTION : "assessment_id"
    CONTENT_RESTRICTION ||--o{ RESTRICTION_APPLICATION : "restriction_id"
    RIGHTS_REPORT ||--o| FALSE_REPORT_FINDING : "report_id"
    MEMBER ||--o{ FALSE_REPORT_FINDING : "operator_id"
    MEMBER ||--o{ REPORTING_RESTRICTION : "member_id"
    REPORTING_RESTRICTION ||--o{ REPORTING_RESTRICTION_FINDING : "restriction_id"
    FALSE_REPORT_FINDING ||--o{ REPORTING_RESTRICTION_FINDING : "finding_id"
    SCHEDULED_TASK_RUN o|--o{ SCHEDULED_TASK_RUN : "retry_of_run_id"
    MEMBER o|--o{ SCHEDULED_TASK_RUN : "requested_by"
    SCHEDULED_TASK_RUN ||--o{ SCHEDULED_TASK_ITEM : "run_id"
    SCHEDULED_TASK_ITEM o|--o{ SCHEDULED_TASK_ITEM : "prior_item_id"
    ACCOUNT_WITHDRAWAL o|--o{ SCHEDULED_TASK_ITEM : "withdrawal_id"
    CREDIT_GRANT o|--o{ SCHEDULED_TASK_ITEM : "credit_grant_id"
    RIGHTS_DEFENSE o|--o{ SCHEDULED_TASK_ITEM : "defense_id"
    RIGHTS_CASE o|--o{ SCHEDULED_TASK_ITEM : "case_id"
    REPORTING_RESTRICTION o|--o{ SCHEDULED_TASK_ITEM : "reporting_restriction_id"
    PUBLICATION_SCHEDULE o|--o{ SCHEDULED_TASK_ITEM : "publication_schedule_id"
    FEEDBACK o|--o{ SCHEDULED_TASK_ITEM : "feedback_id"
    AI_JOB o|--o{ SCHEDULED_TASK_ITEM : "ai_job_id"
    AUTOSERIAL_CONFIG_VERSION o|--o{ SCHEDULED_TASK_ITEM : "autoserial_config_id"
    PUBLICATION_EVENT o|--o{ SCHEDULED_TASK_ITEM : "publication_event_id"
    AI_JOB o|--o{ OPERATION_ALERT : "ai_job_id"
    RIGHTS_CASE o|--o{ OPERATION_ALERT : "rights_case_id"
    SCHEDULED_TASK_RUN o|--o{ OPERATION_ALERT : "scheduled_run_id"
    OPERATION_ALERT ||--o{ OPERATION_ACTION : "alert_id"
    MEMBER ||--o{ OPERATION_ACTION : "operator_id"
    AI_JOB o|--o{ TECHNICAL_ERROR_LOG : "ai_job_id"
    SCHEDULED_TASK_RUN o|--o{ TECHNICAL_ERROR_LOG : "scheduled_run_id"
    OPERATION_ALERT o|--o{ TECHNICAL_ERROR_LOG : "alert_id"
    AI_JOB o|--o{ NOTICE_EVENT : "ai_job_id"
    FEEDBACK o|--o{ NOTICE_EVENT : "feedback_id"
    FORK_SOURCE_CHANGE o|--o{ NOTICE_EVENT : "source_change_id"
    PUBLICATION_EVENT o|--o{ NOTICE_EVENT : "publication_event_id"
    RIGHTS_CASE o|--o{ NOTICE_EVENT : "rights_case_id"
    CREDIT_GRANT o|--o{ NOTICE_EVENT : "credit_grant_id"
    ACCOUNT_WITHDRAWAL o|--o{ NOTICE_EVENT : "withdrawal_id"
    AUTH_SESSION o|--o{ NOTICE_EVENT : "auth_session_id"
    OPERATION_ALERT o|--o{ NOTICE_EVENT : "alert_id"
    MEMBER ||--o{ USER_NOTICE : "recipient_id"
    USER_NOTICE ||--o{ USER_NOTICE_EVENT : "notice_id"
    NOTICE_EVENT ||--o{ USER_NOTICE_EVENT : "event_id"
    MEMBER ||--o{ NOTICE_PREFERENCE : "member_id"
    USER_NOTICE ||--o{ NOTICE_DELIVERY_ATTEMPT : "notice_id"
    ACCOUNT_WITHDRAWAL ||--o{ ACCOUNT_WITHDRAWAL_ITEM : "withdrawal_id"
    WORK o|--o{ ACCOUNT_WITHDRAWAL_ITEM : "work_id"
    WORLD o|--o{ ACCOUNT_WITHDRAWAL_ITEM : "world_id"
    FORK o|--o{ ACCOUNT_WITHDRAWAL_ITEM : "fork_work_id"
    WORK ||--o| WORK_EXTERNAL_SOURCE : "work_id"
    EXTERNAL_IP ||--o{ WORK_EXTERNAL_SOURCE : "external_ip_id"
    WORK ||--o| PUBLIC_DOMAIN_SOURCE : "work_id"

    MEMBER {
        id id PK
        string email UK
        string password_hash
        string nickname
        string account_status
        datetime created_at
        string operator_role
    }
    TERMS_VERSION {
        id id PK
        string terms_type
        string version_label
        text content
        datetime effective_at
    }
    MEMBER_CONSENT {
        id id PK
        id member_id FK
        id terms_version_id FK
        string action
        datetime recorded_at
    }
    AUTH_SESSION {
        id id PK
        id member_id FK
        string device_label
        datetime created_at
        datetime revoked_at
    }
    REFRESH_TOKEN {
        id id PK
        id session_id FK
        string token_hash UK
        id previous_token_id FK
        datetime expires_at
        datetime used_at
        datetime revoked_at
    }
    ACCOUNT_CHALLENGE {
        id id PK
        id member_id FK
        string email
        string purpose
        string secret_hash UK
        datetime expires_at
        datetime consumed_at
    }
    ACCOUNT_WITHDRAWAL {
        id id PK
        id member_id FK
        datetime requested_at
        datetime due_at
        datetime restored_at
        datetime completed_at
        text reason
        string status
    }
    WORLD {
        id id PK
        id owner_id FK
        string name
        text description
        datetime created_at
    }
    SETTING_CATEGORY {
        id id PK
        string code UK
        string name
    }
    SETTING_DOCUMENT {
        id id PK
        id world_id FK
        datetime created_at
    }
    SETTING_DRAFT {
        id setting_document_id PK,FK
        string name
        id category_id FK
        text content
        integer edit_revision
        datetime updated_at
    }
    SETTING_VERSION {
        id id PK
        id setting_document_id FK
        integer revision_no
        string name
        id category_id FK
        text content
        id restored_from_id FK
        string lifecycle
        datetime created_at
    }
    SETTING_ORIGIN {
        id setting_document_id PK,FK
        id source_setting_version_id FK
        datetime copied_at
    }
    SETTING_IMAGE {
        id id PK
        id setting_document_id FK
        string object_url
        integer position
    }
    SETTING_REFERENCE {
        id id PK
        id setting_document_id FK
        string external_url
    }
    SETTING_TAG {
        id id PK
        id owner_id FK
        string name
    }
    SETTING_DOCUMENT_TAG {
        id setting_document_id PK,FK
        id setting_tag_id PK,FK
    }
    SETTING_VISIBILITY_HISTORY {
        id id PK
        id setting_document_id FK
        integer revision_no
        string default_visibility
        datetime changed_at
    }
    SETTING_VISIBILITY_RANGE {
        id id PK
        id visibility_history_id FK
        id start_episode_id FK
        id end_episode_id FK
        string visibility
    }
    CHARACTER_STATE_VERSION {
        id id PK
        id character_id FK
        integer revision_no
        id basis_episode_id FK
        text content
        id restored_from_id FK
        datetime created_at
    }
    CHARACTER_KNOWLEDGE_VERSION {
        id id PK
        id character_id FK
        id fact_setting_id FK
        integer revision_no
        boolean known
        id basis_episode_id FK
        datetime created_at
    }
    WORLD_COMPOSITION_SOURCE {
        id combined_world_id PK,FK
        id source_world_id PK,FK
        datetime selected_at
    }
    WORLD_USE_POLICY_HISTORY {
        id id PK
        id world_id FK
        integer revision_no
        string visibility
        boolean allow_use
        boolean allow_world_fork
        datetime changed_at
    }
    WORK {
        id id PK
        id owner_id FK
        string title
        text description
        string origin_kind
        string audience_rating
        datetime created_at
    }
    WORK_WORLD_HISTORY {
        id id PK
        id work_id FK
        id world_id FK
        integer revision_no
        datetime changed_at
    }
    GENRE {
        id id PK
        string code UK
        string name
    }
    WORK_GENRE {
        id work_id PK,FK
        id genre_id PK,FK
    }
    HASHTAG {
        id id PK
        string name UK
    }
    WORK_HASHTAG {
        id work_id PK,FK
        id hashtag_id PK,FK
        string moderation_status
    }
    WORK_PUBLICATION_HISTORY {
        id id PK
        id work_id FK
        integer revision_no
        string visibility
        datetime changed_at
    }
    WORK_RIGHTS_DECLARATION {
        id id PK
        id work_id FK
        id member_id FK
        string notice_version
        string response
        datetime confirmed_at
    }
    WORK_LIKE {
        id work_id PK,FK
        id member_id PK,FK
        datetime created_at
    }
    WORK_FAVORITE {
        id member_id PK,FK
        id work_id PK,FK
        datetime created_at
    }
    READING_PROGRESS {
        id member_id PK,FK
        id work_id PK,FK
        id episode_version_id FK
        string position
        datetime updated_at
    }
    EPISODE_VIEW_DAY {
        id episode_id PK,FK
        string viewer_key PK
        date viewed_date PK
    }
    EPISODE {
        id id PK
        id work_id FK
        integer sequence
    }
    EPISODE_DRAFT {
        id episode_id PK,FK
        string title
        text content
        integer edit_revision
        datetime updated_at
    }
    EPISODE_VERSION {
        id id PK
        id episode_id FK
        id work_world_history_id FK
        integer revision_no
        string title
        text content
        id restored_from_id FK
        datetime created_at
    }
    MANUSCRIPT_ASSET {
        id id PK
        id owner_id FK
        string object_url
        string media_type
        integer byte_size
        datetime created_at
    }
    EPISODE_DRAFT_IMAGE {
        id id PK
        id episode_id FK
        id asset_id FK
        string position
        string alt_text
    }
    EPISODE_VERSION_IMAGE {
        id id PK
        id episode_version_id FK
        id asset_id FK
        string position
        string alt_text
    }
    EPISODE_DRAFT_MENTION {
        id id PK
        id episode_id FK
        id character_id FK
        string position
    }
    EPISODE_VERSION_MENTION {
        id id PK
        id episode_version_id FK
        id character_id FK
        string position
    }
    PUBLICATION_EVENT {
        id id PK
        id episode_version_id FK
        id actor_id FK
        string action
        string outcome
        datetime occurred_at
        string trigger_kind
    }
    PUBLICATION_SCHEDULE {
        id id PK
        id episode_version_id FK
        datetime scheduled_at
        string status
        datetime created_at
    }
    STORY_PLAN {
        id id PK
        id work_id FK
        id episode_id FK
        id parent_plan_id FK
        string kind
        string title
        integer sequence
        text content
    }
    WRITING_NOTE {
        id id PK
        id work_id FK
        id episode_id FK
        text content
        datetime updated_at
    }
    MANUSCRIPT_IMPORT {
        id id PK
        id work_id FK
        string input_kind
        datetime created_at
        string status
    }
    MANUSCRIPT_IMPORT_ITEM {
        id id PK
        id import_id FK
        integer sequence
        id episode_version_id FK
        string status
        string failure_reason
    }
    MANUSCRIPT_IMPORT_ISSUE {
        id id PK
        id import_item_id FK
        string source_position
        string reason
    }
    CHECKPOINT {
        id id PK
        id work_id FK
        id basis_episode_version_id FK
        string graph_state_ref
        string status
        datetime created_at
    }
    CHECKPOINT_EPISODE {
        id checkpoint_id PK,FK
        id episode_id PK,FK
        id episode_version_id FK
    }
    CHECKPOINT_SETTING {
        id checkpoint_id PK,FK
        id setting_document_id PK,FK
        id setting_version_id FK
    }
    CHECKPOINT_CHARACTER_STATE {
        id checkpoint_id PK,FK
        id character_id PK,FK
        id state_version_id FK
    }
    CHECKPOINT_CHARACTER_KNOWLEDGE {
        id checkpoint_id PK,FK
        id character_id PK,FK
        id fact_setting_id PK,FK
        id knowledge_version_id FK
    }
    FORK_POLICY_HISTORY {
        id id PK
        id work_id FK
        integer revision_no
        boolean allow_creation
        boolean allow_publication
        string episode_scope
        id start_episode_id FK
        datetime changed_at
    }
    FORK_POLICY_EPISODE {
        id policy_history_id PK,FK
        id episode_id PK,FK
    }
    FORK {
        id work_id PK,FK
        id source_checkpoint_id FK
        id confirmed_policy_history_id FK
        datetime conditions_confirmed_at
        datetime created_at
    }
    FORK_WORLD_REFERENCE {
        id fork_work_id PK,FK
        id source_world_id FK
        string reference_status
        id last_followed_checkpoint_id FK
        datetime detached_at
    }
    FORK_SOURCE_CHANGE {
        id id PK
        id fork_work_id FK
        id before_checkpoint_id FK
        id after_checkpoint_id FK
        datetime detected_at
    }
    FORK_CHANGE_DECISION {
        id id PK
        id source_change_id FK
        id actor_id FK
        string decision
        datetime decided_at
    }
    FORK_CHANGE_APPLICATION {
        id id PK
        id decision_id FK
        id result_checkpoint_id FK
        string outcome
        string reason
        datetime applied_at
    }
    CHAT_SESSION {
        id id PK
        id owner_id FK
        id context_work_id FK
        id target_fork_work_id FK
        string saver_thread_ref
        datetime created_at
    }
    CHAT_MESSAGE {
        id id PK
        id session_id FK
        integer sequence
        string speaker
        text content
        id ai_job_id FK
        datetime created_at
    }
    AI_JOB {
        id id PK
        id requester_id FK
        id work_id FK
        id session_id FK
        id retry_of_job_id FK
        id base_checkpoint_id FK
        string kind
        text request_text
        string status
        string failure_reason
        datetime created_at
        datetime started_at
        datetime finished_at
    }
    AI_MODEL_CALL {
        id id PK
        id job_id FK
        integer sequence
        id retry_of_call_id FK
        string role
        string provider
        string model
        string prompt_version_ref
        string trace_ref
        string status
        string usage_status
        integer input_tokens
        integer output_tokens
        decimal provider_cost
        datetime started_at
        datetime finished_at
        string failure_code
    }
    AI_INPUT_SNAPSHOT {
        id id PK
        id job_id FK
        id episode_id FK
        id episode_version_id FK
        id setting_version_id FK
        string graph_state_ref
        string source_kind
        string position
        text content_snapshot
        integer draft_revision
        datetime captured_at
    }
    AI_PROPOSAL {
        id id PK
        id job_id FK
        id input_snapshot_id FK
        integer sequence
        string kind
        text content
        datetime created_at
    }
    AI_EVIDENCE {
        id id PK
        id episode_version_id FK
        id setting_version_id FK
        string graph_state_ref
        string kind
        string position
        text excerpt_snapshot
        datetime captured_at
    }
    PROPOSAL_EVIDENCE {
        id proposal_id PK,FK
        id evidence_id PK,FK
    }
    PROPOSAL_DECISION {
        id id PK
        id proposal_id FK
        integer sequence
        id actor_id FK
        id automation_policy_id FK
        string decision
        string selected_range
        text approved_content
        datetime decided_at
    }
    PROPOSAL_APPLICATION {
        id id PK
        id decision_id FK
        integer attempt_no
        string outcome
        string failure_reason
        datetime attempted_at
    }
    PROPOSAL_EPISODE_CHANGE {
        id id PK
        id application_id FK
        id episode_id FK
        id result_version_id FK
        string position
        text before_content
        text after_content
        integer base_draft_revision
        integer result_draft_revision
    }
    PROPOSAL_SETTING_CHANGE {
        id id PK
        id application_id FK
        id setting_document_id FK
        id result_version_id FK
        string outcome
    }
    PROPOSAL_GRAPH_CHANGE {
        id id PK
        id application_id FK
        string before_state_ref
        string after_state_ref
        string outcome
        string failure_reason
    }
    PROPOSAL_IMAGE {
        id proposal_id PK,FK
        id asset_id PK,FK
        integer position
    }
    SIMULATION_RUN {
        id job_id PK,FK
        string purpose
        id location_setting_id FK
        text situation
        text direction
        integer requested_characters
    }
    SIMULATION_PARTICIPANT {
        id id PK
        id run_id FK
        id character_id FK
        text allowed_context_snapshot
    }
    SIMULATION_CANDIDATE {
        id proposal_id PK,FK
        id run_id FK
        integer sequence
    }
    SIMULATION_RECORD {
        id id PK
        id candidate_id FK
        integer sequence
        string kind
        text content
    }
    SIMULATION_RECORD_PARTICIPANT {
        id record_id PK,FK
        id participant_id PK,FK
    }
    SIMULATION_CAUSAL_LINK {
        id cause_record_id PK,FK
        id effect_record_id PK,FK
        text explanation
    }
    VERIFICATION_RESULT {
        id job_id PK,FK
        string verdict
        decimal confidence
        text content
    }
    VERIFICATION_EVIDENCE {
        id verification_job_id PK,FK
        id evidence_id PK,FK
    }
    CHARACTER_CHAT {
        id session_id PK,FK
        id character_id FK
    }
    FEEDBACK {
        id id PK
        id author_id FK
        id episode_version_id FK
        string kind
        text content
        text target_excerpt
        string position
        string visibility
        boolean is_spoiler
        datetime created_at
        datetime delivered_at
        datetime author_checked_at
    }
    FEEDBACK_AMENDMENT {
        id id PK
        id feedback_id FK
        id actor_id FK
        string action
        text content
        datetime created_at
    }
    FEEDBACK_STATUS_EVENT {
        id id PK
        id feedback_id FK
        id actor_id FK
        id ai_job_id FK
        string status
        datetime created_at
    }
    FEEDBACK_AI_JOB {
        id feedback_id PK,FK
        id job_id PK,FK
        string purpose
    }
    FEEDBACK_RESPONSE {
        id id PK
        id feedback_id FK
        id ai_job_id FK
        id author_id FK
        text content
        boolean is_public
        datetime created_at
    }
    FEEDBACK_RESPONSE_EVIDENCE {
        id response_id PK,FK
        id evidence_id PK,FK
    }
    FEEDBACK_COMMENT {
        id id PK
        id feedback_id FK
        id author_id FK
        text content
        datetime created_at
    }
    FEEDBACK_VERIFICATION {
        id id PK
        id feedback_id UK,FK
        id comment_id UK,FK
        id original_job_id FK
        string outcome
        string verdict
        decimal confidence
        text result_snapshot
        datetime submitted_at
    }
    FEEDBACK_VERIFICATION_EVIDENCE {
        id id PK
        id verification_id FK
        integer sequence
        id episode_version_id FK
        id setting_version_id FK
        string graph_state_ref
        string position
        text excerpt_snapshot
    }
    FEEDBACK_REPORT {
        id id PK
        id feedback_id FK
        id reporter_id FK
        text reason
        datetime created_at
    }
    FEEDBACK_MODERATION_CHECK {
        id id PK
        id feedback_id FK
        id job_id FK
        id report_id FK
        string outcome
        string verdict
        text reason
        datetime checked_at
    }
    FEEDBACK_MODERATION {
        id id PK
        id feedback_id FK
        id check_id FK
        id actor_id FK
        string action
        string outcome
        text reason
        datetime created_at
    }
    FEEDBACK_LIKE {
        id feedback_id PK,FK
        id member_id PK,FK
        datetime created_at
    }
    FEEDBACK_PROPOSAL {
        id feedback_id PK,FK
        id proposal_id PK,FK
    }
    FEEDBACK_REVIEW {
        id id PK
        id feedback_id FK
        id actor_id FK
        id proposal_decision_id FK
        string decision
        text reason
        datetime created_at
    }
    FEEDBACK_RESOLUTION {
        id id PK
        id feedback_id FK
        id review_id FK
        id episode_version_id FK
        id publication_event_id FK
        id application_id FK
        datetime linked_at
    }
    FEEDBACK_REWARD {
        id id PK
        id resolution_id FK
        id credit_grant_id UK,FK
        string correction_key UK
        datetime awarded_at
    }
    WORK_AUTOMATION_VERSION {
        id id PK
        id work_id FK
        integer revision_no
        string world_update_mode
        string proofreading_mode
        string autoserial_state
        datetime changed_at
    }
    AUTOSERIAL_CONFIG_VERSION {
        id automation_version_id PK,FK
        integer target_length
        text direction
        boolean use_reader_reactions
        decimal cost_limit
    }
    AUTOSERIAL_SLOT {
        id config_version_id PK,FK
        integer weekday PK
        string local_time
    }
    AUTOSERIAL_RUN {
        id id PK
        id config_version_id FK
        id scheduled_task_item_id FK
        id ai_job_id FK
        id generated_version_id FK
        id publication_event_id FK
        datetime scheduled_at
        string status
        text reason
    }
    AI_COST_CONSENT {
        id id PK
        id member_id FK
        id job_id FK
        id automation_version_id FK
        decimal estimated_credits
        text scope_snapshot
        string decision
        datetime recorded_at
    }
    SUBSCRIPTION_PLAN {
        id id PK
        string name
        decimal monthly_credits
        decimal price
        string currency
        datetime effective_at
    }
    MEMBER_SUBSCRIPTION {
        id id PK
        id member_id FK
        id plan_id FK
        string status
        datetime started_at
        datetime ended_at
    }
    SUBSCRIPTION_PERIOD {
        id id PK
        id subscription_id FK
        datetime period_start
        datetime period_end
    }
    CREDIT_PURCHASE {
        id id PK
        id subscription_id FK
        decimal quantity
        string status
        datetime requested_at
        datetime completed_at
    }
    CREDIT_GRANT {
        id id PK
        id member_id FK
        id subscription_period_id FK
        id purchase_id FK
        string kind
        decimal amount
        datetime granted_at
        datetime expires_at
    }
    CREDIT_SETTLEMENT {
        id id PK
        id job_id UK,FK
        id consent_id FK
        id payer_member_id FK
        string payer_kind
        string status
        datetime settled_at
    }
    CREDIT_SETTLEMENT_LINE {
        id id PK
        id settlement_id FK
        id call_id UK,FK
        decimal input_rate
        decimal output_rate
        decimal charged_credits
    }
    CREDIT_LEDGER_ENTRY {
        id id PK
        id grant_id FK
        id settlement_line_id FK
        string kind
        decimal amount
        string operation_key UK
        datetime occurred_at
    }
    STORAGE_QUOTA {
        id member_id PK,FK
        integer limit_bytes
        datetime updated_at
    }
    RIGHTS_CASE {
        id id PK
        string kind
        string status
        datetime opened_at
        datetime first_reviewed_at
    }
    RIGHTS_REPORT {
        id id PK
        id case_id FK
        id reporter_id FK
        string receipt_no UK
        string contact
        text grounds
        datetime submitted_at
    }
    RIGHTS_CASE_TARGET {
        id id PK
        id case_id FK
        id work_id FK
        id episode_id FK
        id world_id FK
        id setting_document_id FK
        string target_role
    }
    RIGHTS_REPORT_TARGET {
        id report_id PK,FK
        id case_target_id PK,FK
    }
    RIGHTS_DEFENSE {
        id id PK
        id case_target_id FK
        id owner_id FK
        datetime notified_at
        datetime due_at
        datetime extended_at
        datetime submitted_at
        text response
        string status
    }
    RIGHTS_EVIDENCE {
        id id PK
        id report_id FK
        id defense_id FK
        string evidence_url
        text description
        datetime submitted_at
    }
    RIGHTS_DECISION {
        id id PK
        id case_id FK
        id operator_id FK
        string conclusion
        text reason
        datetime decided_at
    }
    CONTENT_MODERATION_ASSESSMENT {
        id id PK
        id target_id FK
        id ai_job_id FK
        string outcome
        string verdict
        datetime assessed_at
    }
    CONTENT_RESTRICTION {
        id id PK
        id target_id FK
        id decision_id FK
        id assessment_id FK
        string restriction_kind
        datetime created_at
        datetime lifted_at
    }
    RESTRICTION_APPLICATION {
        id id PK
        id restriction_id FK
        string action
        string before_state
        string outcome
        string failure_reason
        datetime attempted_at
    }
    FALSE_REPORT_FINDING {
        id report_id PK,FK
        id operator_id FK
        text reason
        datetime decided_at
    }
    REPORTING_RESTRICTION {
        id id PK
        id member_id FK
        datetime starts_at
        datetime ends_at
        text reason
    }
    REPORTING_RESTRICTION_FINDING {
        id restriction_id PK,FK
        id finding_id PK,FK
    }
    SCHEDULED_TASK_RUN {
        id id PK
        id retry_of_run_id FK
        id requested_by FK
        string kind
        datetime scheduled_at
        datetime started_at
        datetime finished_at
        string outcome
    }
    SCHEDULED_TASK_ITEM {
        id id PK
        id run_id FK
        id prior_item_id FK
        id withdrawal_id FK
        id credit_grant_id FK
        id defense_id FK
        id case_id FK
        id reporting_restriction_id FK
        id publication_schedule_id FK
        id feedback_id FK
        id ai_job_id FK
        id autoserial_config_id FK
        datetime window_start
        datetime window_end
        string operation_key
        string outcome
        string failure_reason
        datetime processed_at
        id publication_event_id FK
    }
    OPERATION_ALERT {
        id id PK
        id ai_job_id FK
        id rights_case_id FK
        id scheduled_run_id FK
        string kind
        string status
        datetime created_at
        datetime checked_at
        datetime resolved_at
    }
    OPERATION_ACTION {
        id id PK
        id alert_id FK
        id operator_id FK
        string result
        text summary
        datetime created_at
    }
    TECHNICAL_ERROR_LOG {
        id id PK
        id ai_job_id FK
        id scheduled_run_id FK
        id alert_id FK
        string stage
        string error_code
        text safe_message
        datetime occurred_at
    }
    NOTICE_EVENT {
        id id PK
        id ai_job_id FK
        id feedback_id FK
        id source_change_id FK
        id publication_event_id FK
        id rights_case_id FK
        id credit_grant_id FK
        id withdrawal_id FK
        id auth_session_id FK
        id alert_id FK
        string kind
        text safe_summary
        datetime occurred_at
    }
    USER_NOTICE {
        id id PK
        id recipient_id FK
        datetime created_at
        datetime read_at
    }
    USER_NOTICE_EVENT {
        id notice_id PK,FK
        id event_id PK,FK
    }
    NOTICE_PREFERENCE {
        id member_id PK,FK
        string kind PK
        boolean enabled
    }
    NOTICE_DELIVERY_ATTEMPT {
        id id PK
        id notice_id FK
        datetime attempted_at
        string outcome
        string failure_reason
    }
    ACCOUNT_WITHDRAWAL_ITEM {
        id id PK
        id withdrawal_id FK
        id work_id FK
        id world_id FK
        id fork_work_id FK
        string operation
        string outcome
        string failure_reason
        datetime processed_at
    }
    EXTERNAL_IP {
        id id PK
        string name
        string reference_url
    }
    WORK_EXTERNAL_SOURCE {
        id work_id PK,FK
        id external_ip_id FK
        string source_url
        datetime registered_at
    }
    PUBLIC_DOMAIN_SOURCE {
        id work_id PK,FK
        text bibliographic_info
        text rights_basis
        datetime verified_at
    }
```

## 영역별 읽기

| 영역 | 소유 테이블 수 | 상세 |
|---|---:|---|
| 회원·인증 | 8 | [회원·인증](core/account.md) |
| 세계관·설정·인물 | 16 | [세계관·설정·인물](core/world.md) |
| 작품·독서·집필·발행 | 30 | [작품·독서·집필·발행](core/work-and-writing.md) |
| 체크포인트·Fork | 12 | [체크포인트·Fork](core/fork-and-checkpoint.md) |
| AI 작업·대화·시뮬레이션 | 23 | [AI 작업·대화·시뮬레이션](core/ai-work.md) |
| 독자 피드백 | 17 | [독자 피드백](core/feedback.md) |
| 자동 처리·자율 연재 | 4 | [자동 처리·자율 연재](core/automation.md) |
| 크레딧·구독·저장 한도 | 10 | [크레딧·구독·저장 한도](core/credit.md) |
| 권리 신고·판정·제한 | 13 | [권리 신고·판정·제한](core/rights.md) |
| 운영·알림·정기 작업 | 10 | [운영·알림·정기 작업](core/operations.md) |

## Fork와 권한에서 그림만으로 보장되지 않는 것

- 기준점의 `work_id`는 소유 문맥이고 `basis_episode_version_id`는 이야기 기준입니다. 자기 회차를 아직 저장하지 않은 Fork도 원작 기준 회차를 유지한 채 Fork 소유 세계관 기준점을 만들 수 있으며 최초 Fork 기준 계보를 검증합니다.
- 최초 기준 기록과 현재 원본 추종은 별개입니다. 기준 회차에 공개된 세계관 전체와 인물 상태·지식·관계를 보존하고, 수정 전 허용 변경 추종 → 첫 수정 전체 독립 → 이후 알림·선택 반영을 따릅니다.
- 기준점의 PK/FK는 **항목당 한 버전**을 선택하기 위한 구조이지 누락 없는 전체 스냅샷·권한·독자 공개·그래프와의 일치를 보증하지 않습니다. 기준 회차·버전·항목 소속·허용 본문·관계의 완전성을 별도로 검증합니다.
- 생성 허용 철회는 신규 Fork만 차단합니다. 공개 허용 철회 후 이미 공개한 Fork는 계속 공개·발행하고 미공개 Fork 최초 공개만 제한합니다. 최초 공개 사실은 작품 공개 이력으로 보존하며 현재 상태만으로 판단하지 않습니다.
- 원본 삭제 전 참조 Fork 독립 전환에 실패하면 원본을 먼저 없애지 않습니다. 기존 Fork 기준본을 보호하고 원작 삭제·탈퇴 뒤 분기 전 원고의 독자 노출은 막습니다. 권리 제한은 일반 허용 철회와 별도입니다.
- 비공개 원고·미발행 회차·권한 밖 지식은 본문·이미지·검색·알림·AI 입력/출력 모두에서 제외합니다. ID나 URL을 안다고 접근 권한이 생기지 않습니다.

## 현재 남은 설계 경계

- 관계 그래프의 실제 노드/관계 스키마·정본과 버전 연결, 체크포인트 완전성·cross-store 복구는 **여전히 미설계**입니다. 아래 RDB 후보가 전체 그래프 모델의 검증 완료를 뜻하지 않습니다.
- 인물 상태/인지의 입력·보존 단위, 설정의 내용 유효 시점과 공개 시점 표현, Fork 원본 변화 비교·충돌처리는 논리 후보 단계입니다.
- 과거 태그 이력, 기본 세계관 템플릿의 저장·배포, 성인 세계관 등급과 연령 확인 방식, 공개 세계관 직접 이용 재설계는 보류합니다. 요구사항 추적표에 이 한계를 적었습니다.
- 예약 취소, 자동 추출 유지 여부, 결제사·가격·플랜 변경, 초과잔액·동시차감·미보고/사용자중단 정산, 법적 보관·삭제 등 미정 정책은 새 테이블이 대신 결정하지 않습니다.
- 이 문서는 SQL 실행·성능·애플리케이션 E2E를 검증한 결과가 아닙니다. 이번 변경의 실제 검증은 [정규화 검증 기록](normalization.md#검증)에서 구분합니다.
