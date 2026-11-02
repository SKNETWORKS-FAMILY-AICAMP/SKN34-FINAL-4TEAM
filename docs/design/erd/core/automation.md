# Core 업무 ERD — 자동 처리·자율 연재

> **전체 서비스 논리 후보 · 미구현.** [목차](../README.md) · [전체 ERD](../overview.md) · [정규화 검증](../normalization.md) · [요구사항 추적](../requirements-matrix.md). 영역은 서비스 배포 단위가 아닙니다.

근거: [UC-18](../../../usecase-spec/UC-18.md), [UC-24](../../../usecase-spec/UC-24.md). 최신 결정과 충돌하는 과거 상세는 적용하지 않습니다.

소유 후보 **4개**, 다른 영역 참조 **5개**입니다. 이 영역 소유 테이블의 FK 관계만 표시하며 참조 테이블에서 다른 영역으로 나가는 선은 의도적으로 생략합니다.

```mermaid
erDiagram
    WORK ||--o{ WORK_AUTOMATION_VERSION : "work_id"
    WORK_AUTOMATION_VERSION ||--o| AUTOSERIAL_CONFIG_VERSION : "automation_version_id"
    AUTOSERIAL_CONFIG_VERSION ||--o{ AUTOSERIAL_SLOT : "config_version_id"
    AUTOSERIAL_CONFIG_VERSION ||--o{ AUTOSERIAL_RUN : "config_version_id"
    SCHEDULED_TASK_ITEM o|--o{ AUTOSERIAL_RUN : "scheduled_task_item_id"
    AI_JOB o|--o{ AUTOSERIAL_RUN : "ai_job_id"
    EPISODE_VERSION o|--o{ AUTOSERIAL_RUN : "generated_version_id"
    PUBLICATION_EVENT o|--o{ AUTOSERIAL_RUN : "publication_event_id"

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
    WORK {
        id id PK
        id owner_id FK
        string title
        text description
        string origin_kind
        string audience_rating
        datetime created_at
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
    PUBLICATION_EVENT {
        id id PK
        id episode_version_id FK
        id actor_id FK
        string action
        string outcome
        datetime occurred_at
        string trigger_kind
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
```

## 이 그림의 테이블

| 소유/참조 | 테이블 | 범위 |
|---|---|---|
| 소유 | [`WORK_AUTOMATION_VERSION`](../tables.md#work-automation-version) | MVP 이후 |
| 소유 | [`AUTOSERIAL_CONFIG_VERSION`](../tables.md#autoserial-config-version) | MVP 이후 |
| 소유 | [`AUTOSERIAL_SLOT`](../tables.md#autoserial-slot) | MVP 이후 |
| 소유 | [`AUTOSERIAL_RUN`](../tables.md#autoserial-run) | MVP 이후 |
| 다른 영역 참조 | [`WORK`](../tables.md#work) | MVP |
| 다른 영역 참조 | [`EPISODE_VERSION`](../tables.md#episode-version) | MVP |
| 다른 영역 참조 | [`PUBLICATION_EVENT`](../tables.md#publication-event) | MVP |
| 다른 영역 참조 | [`AI_JOB`](../tables.md#ai-job) | MVP |
| 다른 영역 참조 | [`SCHEDULED_TASK_ITEM`](../tables.md#scheduled-task-item) | 전체·범위확인 |

## 데이터 역할과 무결성

- 작품 설정 변경을 불변 버전으로 두고, 자율 연재 상세 조건과 요일별 시각을 분리했습니다. 실행은 당시 설정을 참조하므로 이후 설정 변경으로 과거 조건이 바뀌지 않습니다.
- 비용 안내 동의는 `AI_COST_CONSENT`, 실행별 실제 사용량은 `AI_MODEL_CALL`, 정산은 `CREDIT_SETTLEMENT`입니다. 자율 연재에만 사용자 비용상한이 있으며 상한 범위·초과 방지 방식은 미정입니다. 사전 크레딧 예약은 없습니다.
- 생성 버전과 발행 결과는 별도 연결입니다. 권한·Fork 조건·권리·필터를 통과해야 자동 발행합니다. 소유자가 켠 것을 사전 승인으로 보며 회차별 승인 옵션을 추가하지 않습니다.
- 일시중지는 다음 실행부터 적용하고 진행중 작업은 별도 중단합니다. 1시간 초과 지연은 건너뜀이고 연속 실패에 포함하지 않습니다. 연속3회 실패·발행조건 실패의 상태 전이는 UC-18을 따릅니다.
- 소유자 삭제 전 실행기록을 보관하되 삭제가 발행원고 삭제로 전파되지 않습니다. 일정은 KST, 하루최대1회입니다. worker·큐·분산락 테이블은 선제 추가하지 않습니다.
- 자동 추출은 MVP 이후이며 최신 DEC-36과 옛 UC-04의 무검토 자동반영이 충돌하는 범위는 보류합니다. 피드백 수정안 재발행은 자동추출을 유발하지 않습니다.

각 테이블의 PK·FK·고유키·조건부 필수값과 예시는 [전체 테이블 가이드](../tables.md)에 있습니다. 그림만으로 권한·동시성·삭제 안전성이 보장되지 않습니다.
