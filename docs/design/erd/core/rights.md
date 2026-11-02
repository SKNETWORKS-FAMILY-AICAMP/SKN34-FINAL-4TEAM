# Core 업무 ERD — 권리 신고·판정·제한

> **전체 서비스 논리 후보 · 미구현.** [목차](../README.md) · [전체 ERD](../overview.md) · [정규화 검증](../normalization.md) · [요구사항 추적](../requirements-matrix.md). 영역은 서비스 배포 단위가 아닙니다.

근거: [UC-20](../../../usecase-spec/UC-20.md), [UC-23](../../../usecase-spec/UC-23.md). 최신 결정과 충돌하는 과거 상세는 적용하지 않습니다.

소유 후보 **13개**, 다른 영역 참조 **6개**입니다. 이 영역 소유 테이블의 FK 관계만 표시하며 참조 테이블에서 다른 영역으로 나가는 선은 의도적으로 생략합니다.

```mermaid
erDiagram
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
    MEMBER {
        id id PK
        string email UK
        string password_hash
        string nickname
        string account_status
        datetime created_at
        string operator_role
    }
    WORLD {
        id id PK
        id owner_id FK
        string name
        text description
        datetime created_at
    }
    SETTING_DOCUMENT {
        id id PK
        id world_id FK
        datetime created_at
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
    EPISODE {
        id id PK
        id work_id FK
        integer sequence
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
```

## 이 그림의 테이블

| 소유/참조 | 테이블 | 범위 |
|---|---|---|
| 소유 | [`RIGHTS_CASE`](../tables.md#rights-case) | 전체·범위확인 |
| 소유 | [`RIGHTS_REPORT`](../tables.md#rights-report) | 전체·범위확인 |
| 소유 | [`RIGHTS_CASE_TARGET`](../tables.md#rights-case-target) | 전체·범위확인 |
| 소유 | [`RIGHTS_REPORT_TARGET`](../tables.md#rights-report-target) | 전체·범위확인 |
| 소유 | [`RIGHTS_DEFENSE`](../tables.md#rights-defense) | 전체·범위확인 |
| 소유 | [`RIGHTS_EVIDENCE`](../tables.md#rights-evidence) | 전체·범위확인 |
| 소유 | [`RIGHTS_DECISION`](../tables.md#rights-decision) | 전체·범위확인 |
| 소유 | [`CONTENT_MODERATION_ASSESSMENT`](../tables.md#content-moderation-assessment) | 전체·범위확인 |
| 소유 | [`CONTENT_RESTRICTION`](../tables.md#content-restriction) | 전체·범위확인 |
| 소유 | [`RESTRICTION_APPLICATION`](../tables.md#restriction-application) | 전체·범위확인 |
| 소유 | [`FALSE_REPORT_FINDING`](../tables.md#false-report-finding) | 전체·범위확인 |
| 소유 | [`REPORTING_RESTRICTION`](../tables.md#reporting-restriction) | 전체·범위확인 |
| 소유 | [`REPORTING_RESTRICTION_FINDING`](../tables.md#reporting-restriction-finding) | 전체·범위확인 |
| 다른 영역 참조 | [`MEMBER`](../tables.md#member) | MVP |
| 다른 영역 참조 | [`WORLD`](../tables.md#world) | MVP |
| 다른 영역 참조 | [`SETTING_DOCUMENT`](../tables.md#setting-document) | MVP |
| 다른 영역 참조 | [`WORK`](../tables.md#work) | MVP |
| 다른 영역 참조 | [`EPISODE`](../tables.md#episode) | MVP |
| 다른 영역 참조 | [`AI_JOB`](../tables.md#ai-job) | MVP |

## 데이터 역할과 무결성

- AI 묶음 검토 건, 개별 신고, 원신고 대상, 여러 증빙, 소명, 운영 판단, 실제 제한·적용 시도를 분리했습니다. 묶여도 개별 신고자·접수·근거·대상은 남습니다.
- 저작권 신고 접수나 권리자 확인만으로 자동비공개하지 않습니다. 공개 상태에서 검토하고 침해판정 후 조치합니다. 24시간은 1차 검토 목표입니다. 미소명은 침해 자동확정이 아니며 운영자에게 알립니다.
- 유해 모델 판정시 자동숨김 방향을 반영하되 성인등급만으로 유해하다고 판정하지 않습니다. 모델 실패·오판·허용금지 경계는 미정입니다. 성인 연령확인 방식·법적 기준을 임의 테이블로 확정하지 않았습니다.
- 한 제한의 해제는 다른 활성 제한을 지우지 않습니다. 각 대상의 적용 전 상태·성공/실패를 보존하고 하위 Fork도 개별 기록합니다. 세계관/항목 신고의 파급범위는 미정입니다.
- 단순 기각과 명시적 허위판정은 다릅니다. 허위3회·30일 신고제한은 판단 근거들을 연결하되 집계기간·정정처리는 미정입니다.
- 신고 연락처·증빙은 제한된 권한만 조회합니다. 기록을 1년이 지났다는 이유만으로 자동삭제하지 않으며 법률·개인정보 보존/삭제 의무는 별도 검토합니다. 운영 경고의 잠정1년과 혼동하지 않습니다.

각 테이블의 PK·FK·고유키·조건부 필수값과 예시는 [전체 테이블 가이드](../tables.md)에 있습니다. 그림만으로 권한·동시성·삭제 안전성이 보장되지 않습니다.
