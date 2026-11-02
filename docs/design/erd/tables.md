# STORYFORK 업무 ERD — 143개 테이블 설명

> [목차](README.md) · [전체 ERD](overview.md) · [정규화 근거](normalization.md) · [요구사항 추적](requirements-matrix.md)
>
> **전부 논리 후보이며 DB에 생성되지 않았습니다.** 각 표의 필드는 전체/부분 ERD와 같습니다. PK는 행 식별자, UK는 단일 후보 고유키, FK는 다른 업무 엔티티 참조입니다. 복합 유일성·조건부 필수값은 설명을 함께 확인합니다. 단일 컬럼 FK가 복합 PK를 직접 가리키는 것으로 해석하지 않습니다. 외부 graph/Saver/Langfuse 키는 FK가 아닙니다.

초안↔불변 버전, 개인 기록↔제출 증거, 제안↔사용자가 저장한 원고는 삭제 수명이 다릅니다. 이 가이드의 제약은 **구현할 때 검증해야 할 조건**이지 DB가 이미 보장하는 조건이 아닙니다. 상태 enum·NULL·시간대·URL/위치 인코딩·동시성은 물리 설계에서 구체화합니다. 예시는 실제 데이터가 아닙니다.


### 개인 기록 삭제와 업무 증빙 보존

개인 대화·시뮬레이션·제안·입력 원문/스냅샷의 삭제 선택과, 이미 제출한 증거·확정 원고·정산에 필요한 최소 증빙의 보존은 다른 수명주기입니다. 개인 기록 삭제를 이유로 `CREDIT_SETTLEMENT`·`CREDIT_SETTLEMENT_LINE`·지급 장부·제보 반영 결과·저장/발행 원고를 CASCADE 삭제하지 않습니다. 반대로 정산 FK가 있다는 이유만으로 개인 원문을 무기한 남기는 것도 아닙니다. 필요한 최소 작업 식별/사용량과 반영 계보만 별도 수명으로 유지하는 후보이며, 삭제된 콘텐츠에 재접근할 수 없게 해야 합니다. 물리 분리·비식별화·FK 삭제 동작 및 법적 보관기간은 구현 전에 결정하고, 사용자에게 표시하는 개인 기록 삭제 완료와 실제 업무 증빙 잔존을 구분합니다. 새로운 보관기간을 확정한 것은 아닙니다.

## 회원·인증

[부분 ERD](core/account.md) · 근거: [UC-22](../../usecase-spec/UC-22.md)

<a id="member"></a>
### `MEMBER`

- **역할·범위:** 회원의 식별·기본 프로필. 독자·작가는 별도 계정 종류가 아닙니다. **MVP**.
- **그림의 필드:** `id`(PK), `email`(UK), `password_hash`, `nickname`, `account_status`, `created_at`, `operator_role`.
- **참조:** 다른 업무 테이블의 FK 없음.
- **제약·한계:** 이메일 유일성. 해시만 저장하며 운영 권한은 일반 가입으로 취득하지 않음.
- **연결 예시:** `id=1`처럼 한 관계·사건을 기록합니다(가상 예시; 상태 enum 미확정).

<a id="terms-version"></a>
### `TERMS_VERSION`

- **역할·범위:** 여러 회원이 동의한 약관 원문과 버전 정의를 한 번 저장합니다. **MVP**.
- **그림의 필드:** `id`(PK), `terms_type`, `version_label`, `content`, `effective_at`.
- **참조:** 다른 업무 테이블의 FK 없음.
- **제약·한계:** UNIQUE(terms_type, version_label). 확정 버전 불변. 약관 내용·보존은 미정.
- **연결 예시:** `id=1; content=당시 허용된 내용`처럼 한 관계·사건을 기록합니다(가상 예시; 상태 enum 미확정).

<a id="member-consent"></a>
### `MEMBER_CONSENT`

- **역할·범위:** 약관 정의와 분리한 회원의 동의·철회 사실입니다. **MVP**.
- **그림의 필드:** `id`(PK), `member_id`, `terms_version_id`, `action`, `recorded_at`.
- **참조:** `member_id` → [`MEMBER`](tables.md#member).`id`; `terms_version_id` → [`TERMS_VERSION`](tables.md#terms-version).`id`.
- **제약·한계:** 동의 종류·철회 정책 미정. 현재 동의는 이력에서 계산.
- **연결 예시:** `id=1; member_id=member-1; terms_version_id=terms_version-1; action=종류/상태의 예시값`처럼 한 관계·사건을 기록합니다(가상 예시; 상태 enum 미확정).

<a id="auth-session"></a>
### `AUTH_SESSION`

- **역할·범위:** 회원이 로그인한 기기별 세션과 폐기 상태입니다. **MVP 이후**.
- **그림의 필드:** `id`(PK), `member_id`, `device_label`, `created_at`, `revoked_at`.
- **참조:** `member_id` → [`MEMBER`](tables.md#member).`id`.
- **제약·한계:** 기기 식별의 개인정보 최소화. 기기·전체 로그아웃은 해당 세션 폐기.
- **연결 예시:** `id=1; member_id=member-1`처럼 한 관계·사건을 기록합니다(가상 예시; 상태 enum 미확정).

<a id="refresh-token"></a>
### `REFRESH_TOKEN`

- **역할·범위:** 세션별 갱신 토큰 회전·폐기 이력입니다. **MVP 이후**.
- **그림의 필드:** `id`(PK), `session_id`, `token_hash`(UK), `previous_token_id`, `expires_at`, `used_at`, `revoked_at`.
- **참조:** `session_id` → [`AUTH_SESSION`](tables.md#auth-session).`id`; `previous_token_id` → [`REFRESH_TOKEN`](tables.md#refresh-token).`id` (선택).
- **제약·한계:** 원문 토큰 미저장. 폐기 토큰 재사용은 계정 전체 세션 폐기. 이전 토큰은 같은 세션.
- **연결 예시:** `id=1; session_id=auth_session-1; previous_token_id=refresh_token-1`처럼 한 관계·사건을 기록합니다(가상 예시; 상태 enum 미확정).

<a id="account-challenge"></a>
### `ACCOUNT_CHALLENGE`

- **역할·범위:** 가입 전 이메일 확인과 비밀번호 재설정의 일회용 확인 요청입니다. **MVP 이후**.
- **그림의 필드:** `id`(PK), `member_id`, `email`, `purpose`, `secret_hash`(UK), `expires_at`, `consumed_at`.
- **참조:** `member_id` → [`MEMBER`](tables.md#member).`id` (선택).
- **제약·한계:** 가입 전 회원 FK는 없음. 단일 사용·만료·요청 목적 검증. 이메일은 당시 수신 대상이라 현재 회원 이메일의 단순 복제가 아님.
- **연결 예시:** `id=1; member_id=member-1`처럼 한 관계·사건을 기록합니다(가상 예시; 상태 enum 미확정).

<a id="account-withdrawal"></a>
### `ACCOUNT_WITHDRAWAL`

- **역할·범위:** 탈퇴 요청·유예·복구·실제 처리 결과를 회원 정보와 분리합니다. **MVP 이후**.
- **그림의 필드:** `id`(PK), `member_id`, `requested_at`, `due_at`, `restored_at`, `completed_at`, `reason`, `status`.
- **참조:** `member_id` → [`MEMBER`](tables.md#member).`id`.
- **제약·한계:** 한 회원의 진행 중 요청 최대 하나. 참조 Fork 독립 전환 실패 시 완료 금지.
- **연결 예시:** `id=1; member_id=member-1; status=종류/상태의 예시값`처럼 한 관계·사건을 기록합니다(가상 예시; 상태 enum 미확정).

<a id="account-withdrawal-item"></a>
### `ACCOUNT_WITHDRAWAL_ITEM`

- **역할·범위:** 탈퇴 처리에서 작품·세계관·Fork 독립 전환별 성공·실패를 구분합니다. **MVP 이후**.
- **그림의 필드:** `id`(PK), `withdrawal_id`, `work_id`, `world_id`, `fork_work_id`, `operation`, `outcome`, `failure_reason`, `processed_at`.
- **참조:** `withdrawal_id` → [`ACCOUNT_WITHDRAWAL`](tables.md#account-withdrawal).`id`; `work_id` → [`WORK`](tables.md#work).`id` (선택); `world_id` → [`WORLD`](tables.md#world).`id` (선택); `fork_work_id` → [`FORK`](tables.md#fork).`work_id` (선택).
- **제약·한계:** 대상 정확히 하나. 독립 전환 성공을 확인하기 전 원본 삭제 금지. 실제 삭제 후 참조는 안전한 비식별 처리기록으로 보존하는 방식 미정.
- **연결 예시:** `id=1; withdrawal_id=account_withdrawal-1; work_id=work-1; world_id=world-1`처럼 한 관계·사건을 기록합니다(가상 예시; 상태 enum 미확정).

## 세계관·설정·인물

[부분 ERD](core/world.md) · 근거: [UC-02](../../usecase-spec/UC-02.md), [UC-05](../../usecase-spec/UC-05.md), [UC-06](../../usecase-spec/UC-06.md)

<a id="world"></a>
### `WORLD`

- **역할·범위:** 세계관 소유와 이름을 식별합니다. **MVP**.
- **그림의 필드:** `id`(PK), `owner_id`, `name`, `description`, `created_at`.
- **참조:** `owner_id` → [`MEMBER`](tables.md#member).`id`.
- **제약·한계:** 현재 작품 연결은 WORK_WORLD_HISTORY의 최신 연결에서 판단. 소유와 이용 권한 별도.
- **연결 예시:** `id=1; owner_id=member-1; name=푸른 왕국`처럼 한 관계·사건을 기록합니다(가상 예시; 상태 enum 미확정).

<a id="setting-category"></a>
### `SETTING_CATEGORY`

- **역할·범위:** 플랫폼이 정한 단일 설정 카테고리입니다. **MVP**.
- **그림의 필드:** `id`(PK), `code`(UK), `name`.
- **참조:** 다른 업무 테이블의 FK 없음.
- **제약·한계:** 고정 목록은 미정. 카테고리별 빈 프로필 테이블은 만들지 않음.
- **연결 예시:** `id=1; name=푸른 왕국`처럼 한 관계·사건을 기록합니다(가상 예시; 상태 enum 미확정).

<a id="setting-document"></a>
### `SETTING_DOCUMENT`

- **역할·범위:** 세계관 안의 설정 항목 식별자만 관리합니다. 현재 이름·분류·본문은 확정 버전에서 읽습니다. **MVP**.
- **그림의 필드:** `id`(PK), `world_id`, `created_at`.
- **참조:** `world_id` → [`WORLD`](tables.md#world).`id`.
- **제약·한계:** 현재값과 버전값의 중복 원천을 제거. 새 항목은 확정 버전 없이 초안만 있을 수 있음.
- **연결 예시:** `id=1; world_id=world-1`처럼 한 관계·사건을 기록합니다(가상 예시; 상태 enum 미확정).

<a id="setting-draft"></a>
### `SETTING_DRAFT`

- **역할·범위:** 설정의 이름·카테고리·본문을 자동저장하는 가변 초안입니다. **MVP**.
- **그림의 필드:** `setting_document_id`(PK), `name`, `category_id`, `content`, `edit_revision`, `updated_at`.
- **참조:** `setting_document_id` → [`SETTING_DOCUMENT`](tables.md#setting-document).`id`; `category_id` → [`SETTING_CATEGORY`](tables.md#setting-category).`id`.
- **제약·한계:** 항목당 0..1. edit_revision 비교 후 갱신. 저장 버튼은 새 SETTING_VERSION 생성.
- **연결 예시:** `setting_document_id=setting_document-1; name=푸른 왕국; category_id=setting_category-1; content=당시 허용된 내용`처럼 한 관계·사건을 기록합니다(가상 예시; 상태 enum 미확정).

<a id="setting-version"></a>
### `SETTING_VERSION`

- **역할·범위:** 확정한 설정 이름·분류·본문을 변경 불가 버전으로 보존합니다. **MVP**.
- **그림의 필드:** `id`(PK), `setting_document_id`, `revision_no`, `name`, `category_id`, `content`, `restored_from_id`, `lifecycle`, `created_at`.
- **참조:** `setting_document_id` → [`SETTING_DOCUMENT`](tables.md#setting-document).`id`; `category_id` → [`SETTING_CATEGORY`](tables.md#setting-category).`id`; `restored_from_id` → [`SETTING_VERSION`](tables.md#setting-version).`id` (선택).
- **제약·한계:** UNIQUE(setting_document_id,revision_no). 복원 원본은 같은 항목. 이전 기록 삭제·덮어쓰기 금지. lifecycle로 활성/제거 상태를 구분하는 후보. 최초 생성 되돌리기도 제거 상태의 새 버전으로 남기며, 복원도 새 활성 버전. 빈본문·비공개전환을 제거로 취급하지 않음.
- **연결 예시:** `id=1; setting_document_id=setting_document-1; revision_no=2; name=푸른 왕국`처럼 한 관계·사건을 기록합니다(가상 예시; 상태 enum 미확정).

<a id="setting-origin"></a>
### `SETTING_ORIGIN`

- **역할·범위:** 복사된 항목과 실제 복사한 원본 버전의 출처를 연결합니다. **MVP**.
- **그림의 필드:** `setting_document_id`(PK), `source_setting_version_id`, `copied_at`.
- **참조:** `setting_document_id` → [`SETTING_DOCUMENT`](tables.md#setting-document).`id`; `source_setting_version_id` → [`SETTING_VERSION`](tables.md#setting-version).`id`.
- **제약·한계:** 원본 항목은 버전으로 유도. 원본=대상 또는 출처 순환 금지. 쓰기 격리는 별도 검증.
- **연결 예시:** `setting_document_id=setting_document-1; source_setting_version_id=setting_version-1`처럼 한 관계·사건을 기록합니다(가상 예시; 상태 enum 미확정).

<a id="setting-image"></a>
### `SETTING_IMAGE`

- **역할·범위:** 현재 설정에 붙인 이미지 URL과 표시 순서입니다. 과거 이미지 버전 테이블은 만들지 않습니다. **MVP**.
- **그림의 필드:** `id`(PK), `setting_document_id`, `object_url`, `position`.
- **참조:** `setting_document_id` → [`SETTING_DOCUMENT`](tables.md#setting-document).`id`.
- **제약·한계:** UNIQUE(setting_document_id,position), 항목당 최대 10개. MinIO URL만 저장; 사용 중 참조를 끊는 파일 삭제 금지.
- **연결 예시:** `id=1; setting_document_id=setting_document-1`처럼 한 관계·사건을 기록합니다(가상 예시; 상태 enum 미확정).

<a id="setting-reference"></a>
### `SETTING_REFERENCE`

- **역할·범위:** 설정에 붙인 여러 외부 참고 주소를 행으로 나눕니다. **MVP**.
- **그림의 필드:** `id`(PK), `setting_document_id`, `external_url`.
- **참조:** `setting_document_id` → [`SETTING_DOCUMENT`](tables.md#setting-document).`id`.
- **제약·한계:** URL은 이용 권한이 아니며 조회·외부 요청 시 SSRF 등 별도 검증. 개수 미정.
- **연결 예시:** `id=1; setting_document_id=setting_document-1`처럼 한 관계·사건을 기록합니다(가상 예시; 상태 enum 미확정).

<a id="setting-tag"></a>
### `SETTING_TAG`

- **역할·범위:** 창작자가 재사용하는 자유 태그 이름입니다. **MVP**.
- **그림의 필드:** `id`(PK), `owner_id`, `name`.
- **참조:** `owner_id` → [`MEMBER`](tables.md#member).`id`.
- **제약·한계:** UNIQUE(owner_id,name) 후보; 대소문자·정규화 규칙 미정.
- **연결 예시:** `id=1; owner_id=member-1; name=푸른 왕국`처럼 한 관계·사건을 기록합니다(가상 예시; 상태 enum 미확정).

<a id="setting-document-tag"></a>
### `SETTING_DOCUMENT_TAG`

- **역할·범위:** 설정 항목과 자유 태그의 다대다 연결입니다. **MVP**.
- **그림의 필드:** `setting_document_id`(PK), `setting_tag_id`(PK).
- **참조:** `setting_document_id` → [`SETTING_DOCUMENT`](tables.md#setting-document).`id`; `setting_tag_id` → [`SETTING_TAG`](tables.md#setting-tag).`id`.
- **제약·한계:** 동일 연결 중복 금지. 태그 이력 보존은 아직 미정이므로 과거 태그 복원을 주장하지 않음.
- **연결 예시:** `setting_document_id=setting_document-1; setting_tag_id=setting_tag-1`처럼 한 관계·사건을 기록합니다(가상 예시; 상태 enum 미확정).

<a id="setting-visibility-history"></a>
### `SETTING_VISIBILITY_HISTORY`

- **역할·범위:** 항목 공개 정책의 변경 1회와 그때의 기본 공개 상태입니다. **MVP**.
- **그림의 필드:** `id`(PK), `setting_document_id`, `revision_no`, `default_visibility`, `changed_at`.
- **참조:** `setting_document_id` → [`SETTING_DOCUMENT`](tables.md#setting-document).`id`.
- **제약·한계:** UNIQUE(setting_document_id,revision_no). 기본 비공개. 최신 정책 선택·이전 정책 불변.
- **연결 예시:** `id=1; setting_document_id=setting_document-1; revision_no=2`처럼 한 관계·사건을 기록합니다(가상 예시; 상태 enum 미확정).

<a id="setting-visibility-range"></a>
### `SETTING_VISIBILITY_RANGE`

- **역할·범위:** 공개 정책 하나의 복수 회차 범위를 개별 행으로 분리합니다. **MVP**.
- **그림의 필드:** `id`(PK), `visibility_history_id`, `start_episode_id`, `end_episode_id`, `visibility`.
- **참조:** `visibility_history_id` → [`SETTING_VISIBILITY_HISTORY`](tables.md#setting-visibility-history).`id`; `start_episode_id` → [`EPISODE`](tables.md#episode).`id`; `end_episode_id` → [`EPISODE`](tables.md#episode).`id` (선택).
- **제약·한계:** 같은 작품의 유효 순서 범위. 범위 중첩·경계 처리 미정; 중첩을 임의 허용하지 않음. 공개 시점과 내용 유효 시점은 동일하다고 가정하지 않음.
- **연결 예시:** `id=1; visibility_history_id=setting_visibility_history-1; start_episode_id=episode-1; end_episode_id=episode-1`처럼 한 관계·사건을 기록합니다(가상 예시; 상태 enum 미확정).

<a id="character-state-version"></a>
### `CHARACTER_STATE_VERSION`

- **역할·범위:** 인물의 회차 기준 상태를 인물 기본 문서와 분리한 버전 후보입니다. **MVP**.
- **그림의 필드:** `id`(PK), `character_id`, `revision_no`, `basis_episode_id`, `content`, `restored_from_id`, `created_at`.
- **참조:** `character_id` → [`SETTING_DOCUMENT`](tables.md#setting-document).`id`; `basis_episode_id` → [`EPISODE`](tables.md#episode).`id` (선택); `restored_from_id` → [`CHARACTER_STATE_VERSION`](tables.md#character-state-version).`id` (선택).
- **제약·한계:** UNIQUE(character_id,revision_no). 인물 카테고리·세계관·회차 일치 검증. 상태 필수 입력·세부 시점 모델 미정. 상태 원문은 논리 RDB 후보. 그래프 관계와 같은 저장 방식이라고 확정하지 않습니다.
- **연결 예시:** `id=1; character_id=setting_document-1; revision_no=2; basis_episode_id=episode-1`처럼 한 관계·사건을 기록합니다(가상 예시; 상태 enum 미확정).

<a id="character-knowledge-version"></a>
### `CHARACTER_KNOWLEDGE_VERSION`

- **역할·범위:** 인물과 지식 항목의 다대다 인지 관계에 대한 이력 후보입니다. **MVP**.
- **그림의 필드:** `id`(PK), `character_id`, `fact_setting_id`, `revision_no`, `known`, `basis_episode_id`, `created_at`.
- **참조:** `character_id` → [`SETTING_DOCUMENT`](tables.md#setting-document).`id`; `fact_setting_id` → [`SETTING_DOCUMENT`](tables.md#setting-document).`id`; `basis_episode_id` → [`EPISODE`](tables.md#episode).`id` (선택).
- **제약·한계:** UNIQUE(character_id,fact_setting_id,revision_no). 독자 공개와 인물 인지는 독립. 인지 단위·물리 저장은 팀 논의 필요. knowledge를 text 배열로 합치지 않는 후보이며 최종 그래프/RDB 배치는 미정입니다.
- **연결 예시:** `id=1; character_id=setting_document-1; fact_setting_id=setting_document-1; revision_no=2`처럼 한 관계·사건을 기록합니다(가상 예시; 상태 enum 미확정).

<a id="world-composition-source"></a>
### `WORLD_COMPOSITION_SOURCE`

- **역할·범위:** 조합 세계관이 어떤 원본들을 선택했는지 기록합니다. **MVP 이후**.
- **그림의 필드:** `combined_world_id`(PK), `source_world_id`(PK), `selected_at`.
- **참조:** `combined_world_id` → [`WORLD`](tables.md#world).`id`; `source_world_id` → [`WORLD`](tables.md#world).`id`.
- **제약·한계:** 원본 최대 5개, 자기 참조·Fork 원본 금지. 복사한 항목의 정확한 버전은 SETTING_ORIGIN. 관계·상태 복사 범위 미정.
- **연결 예시:** `combined_world_id=world-1; source_world_id=world-1`처럼 한 관계·사건을 기록합니다(가상 예시; 상태 enum 미확정).

<a id="world-use-policy-history"></a>
### `WORLD_USE_POLICY_HISTORY`

- **역할·범위:** 작품 Fork와 별개인 세계관 직접 이용의 공개·허용 조건 후보입니다. **보류·재설계**.
- **그림의 필드:** `id`(PK), `world_id`, `revision_no`, `visibility`, `allow_use`, `allow_world_fork`, `changed_at`.
- **참조:** `world_id` → [`WORLD`](tables.md#world).`id`.
- **제약·한계:** UNIQUE(world_id,revision_no). UC-05는 과거 기획이므로 현재 MVP에 적용 금지. 유료 공개 정책 미정.
- **연결 예시:** `id=1; world_id=world-1; revision_no=2`처럼 한 관계·사건을 기록합니다(가상 예시; 상태 enum 미확정).

## 작품·독서·집필·발행

[부분 ERD](core/work-and-writing.md) · 근거: [UC-01](../../usecase-spec/UC-01.md), [UC-03](../../usecase-spec/UC-03.md), [UC-10](../../usecase-spec/UC-10.md), [UC-13](../../usecase-spec/UC-13.md), [UC-23](../../usecase-spec/UC-23.md), [UC-24](../../usecase-spec/UC-24.md)

<a id="work"></a>
### `WORK`

- **역할·범위:** 작품의 소유자·기본 정보. Fork 여부는 FORK 행의 존재로 구분합니다. **MVP**.
- **그림의 필드:** `id`(PK), `owner_id`, `title`, `description`, `origin_kind`, `audience_rating`, `created_at`.
- **참조:** `owner_id` → [`MEMBER`](tables.md#member).`id`.
- **제약·한계:** 장르와 Fork 조건은 별도 관계. audience_rating은 성인 지원 후보이며 등급 기준·MVP 포함 미정.
- **연결 예시:** `id=1; owner_id=member-1; title=푸른 왕국`처럼 한 관계·사건을 기록합니다(가상 예시; 상태 enum 미확정).

<a id="work-world-history"></a>
### `WORK_WORLD_HISTORY`

- **역할·범위:** 작품의 세계관 연결을 변경 순서대로 보존합니다. **MVP**.
- **그림의 필드:** `id`(PK), `work_id`, `world_id`, `revision_no`, `changed_at`.
- **참조:** `work_id` → [`WORK`](tables.md#work).`id`; `world_id` → [`WORLD`](tables.md#world).`id`.
- **제약·한계:** UNIQUE(work_id,revision_no). 작품별 최신 연결 정확히 1개, 세계관은 최신 연결 기준 최대 한 작품. 원고 버전이 당시 연결을 고정; 현재 연결 제약 구현은 후속 설계.
- **연결 예시:** `id=1; work_id=work-1; world_id=world-1; revision_no=2`처럼 한 관계·사건을 기록합니다(가상 예시; 상태 enum 미확정).

<a id="genre"></a>
### `GENRE`

- **역할·범위:** 작품과 기본 세계관에 공통으로 쓰는 고정 장르 목록입니다. **MVP**.
- **그림의 필드:** `id`(PK), `code`(UK), `name`.
- **참조:** 다른 업무 테이블의 FK 없음.
- **제약·한계:** 고정 장르 목록 미정.
- **연결 예시:** `id=1; name=푸른 왕국`처럼 한 관계·사건을 기록합니다(가상 예시; 상태 enum 미확정).

<a id="work-genre"></a>
### `WORK_GENRE`

- **역할·범위:** 작품마다 여러 장르를 연결합니다. **MVP**.
- **그림의 필드:** `work_id`(PK), `genre_id`(PK).
- **참조:** `work_id` → [`WORK`](tables.md#work).`id`; `genre_id` → [`GENRE`](tables.md#genre).`id`.
- **제약·한계:** UC-01 작품당 1~2개. 단일 문자열·쉼표 목록 미사용.
- **연결 예시:** `work_id=work-1; genre_id=genre-1`처럼 한 관계·사건을 기록합니다(가상 예시; 상태 enum 미확정).

<a id="hashtag"></a>
### `HASHTAG`

- **역할·범위:** 작품 탐색에 쓰는 재사용 해시태그 이름입니다. **MVP**.
- **그림의 필드:** `id`(PK), `name`(UK).
- **참조:** 다른 업무 테이블의 FK 없음.
- **제약·한계:** 자유 입력. 이름 정규화 방식 미정.
- **연결 예시:** `id=1; name=푸른 왕국`처럼 한 관계·사건을 기록합니다(가상 예시; 상태 enum 미확정).

<a id="work-hashtag"></a>
### `WORK_HASHTAG`

- **역할·범위:** 작품과 해시태그의 다대다 연결 및 등록 판정입니다. **MVP**.
- **그림의 필드:** `work_id`(PK), `hashtag_id`(PK), `moderation_status`.
- **참조:** `work_id` → [`WORK`](tables.md#work).`id`; `hashtag_id` → [`HASHTAG`](tables.md#hashtag).`id`.
- **제약·한계:** 작품당 최대 10개. 필터 통과 전 공개 검색에 노출 금지.
- **연결 예시:** `work_id=work-1; hashtag_id=hashtag-1`처럼 한 관계·사건을 기록합니다(가상 예시; 상태 enum 미확정).

<a id="work-publication-history"></a>
### `WORK_PUBLICATION_HISTORY`

- **역할·범위:** 작품 전체 공개·비공개 변경을 회차 발행과 분리합니다. **MVP**.
- **그림의 필드:** `id`(PK), `work_id`, `revision_no`, `visibility`, `changed_at`.
- **참조:** `work_id` → [`WORK`](tables.md#work).`id`.
- **제약·한계:** UNIQUE(work_id,revision_no). 현재 상태는 최신 이력; 작품 숨김으로 회차 발행 이력을 덮어쓰지 않음.
- **연결 예시:** `id=1; work_id=work-1; revision_no=2`처럼 한 관계·사건을 기록합니다(가상 예시; 상태 enum 미확정).

<a id="work-rights-declaration"></a>
### `WORK_RIGHTS_DECLARATION`

- **역할·범위:** 등록자의 권리 확인 응답과 당시 고지 내용을 보관합니다. **MVP**.
- **그림의 필드:** `id`(PK), `work_id`, `member_id`, `notice_version`, `response`, `confirmed_at`.
- **참조:** `work_id` → [`WORK`](tables.md#work).`id`; `member_id` → [`MEMBER`](tables.md#member).`id`.
- **제약·한계:** 등록자가 당시 한 확인이며 법적 권리 판정이 아님. 문구·저장·공개 조건 연계는 미정.
- **연결 예시:** `id=1; work_id=work-1; member_id=member-1`처럼 한 관계·사건을 기록합니다(가상 예시; 상태 enum 미확정).

<a id="work-like"></a>
### `WORK_LIKE`

- **역할·범위:** 회원이 작품에 누른 좋아요입니다. **MVP**.
- **그림의 필드:** `work_id`(PK), `member_id`(PK), `created_at`.
- **참조:** `work_id` → [`WORK`](tables.md#work).`id`; `member_id` → [`MEMBER`](tables.md#member).`id`.
- **제약·한계:** 수만 공개하고 누른 회원은 비공개. 합계는 파생 조회.
- **연결 예시:** `work_id=work-1; member_id=member-1`처럼 한 관계·사건을 기록합니다(가상 예시; 상태 enum 미확정).

<a id="work-favorite"></a>
### `WORK_FAVORITE`

- **역할·범위:** 본인만 보는 관심 작품과 새 회차 알림 대상입니다. **MVP**.
- **그림의 필드:** `member_id`(PK), `work_id`(PK), `created_at`.
- **참조:** `member_id` → [`MEMBER`](tables.md#member).`id`; `work_id` → [`WORK`](tables.md#work).`id`.
- **제약·한계:** 좋아요와 독립된 선택·생명주기.
- **연결 예시:** `member_id=member-1; work_id=work-1`처럼 한 관계·사건을 기록합니다(가상 예시; 상태 enum 미확정).

<a id="reading-progress"></a>
### `READING_PROGRESS`

- **역할·범위:** 회원별 작품 이어 읽기 위치입니다. **MVP**.
- **그림의 필드:** `member_id`(PK), `work_id`(PK), `episode_version_id`, `position`, `updated_at`.
- **참조:** `member_id` → [`MEMBER`](tables.md#member).`id`; `work_id` → [`WORK`](tables.md#work).`id`; `episode_version_id` → [`EPISODE_VERSION`](tables.md#episode-version).`id`.
- **제약·한계:** 회차 버전은 해당 작품 소속. 본인만 조회·탈퇴 시 삭제. 위치 인코딩 미정.
- **연결 예시:** `member_id=member-1; work_id=work-1; episode_version_id=episode_version-1`처럼 한 관계·사건을 기록합니다(가상 예시; 상태 enum 미확정).

<a id="episode-view-day"></a>
### `EPISODE_VIEW_DAY`

- **역할·범위:** 하루에 같은 독자의 회차 조회를 한 번만 집계하는 논리 후보입니다. **MVP**.
- **그림의 필드:** `episode_id`(PK), `viewer_key`(PK), `viewed_date`(PK).
- **참조:** `episode_id` → [`EPISODE`](tables.md#episode).`id`.
- **제약·한계:** 회원·비회원 모두 대상. viewer_key의 비식별화·비회원 판별·보존 기간 미정. 원시 IP 저장을 확정하지 않음.
- **연결 예시:** `episode_id=episode-1; viewer_key=1; viewed_date=1`처럼 한 관계·사건을 기록합니다(가상 예시; 상태 enum 미확정).

<a id="episode"></a>
### `EPISODE`

- **역할·범위:** 작품에 속하는 회차 식별자와 순서입니다. **MVP**.
- **그림의 필드:** `id`(PK), `work_id`, `sequence`.
- **참조:** `work_id` → [`WORK`](tables.md#work).`id`.
- **제약·한계:** UNIQUE(work_id,sequence). 제목·본문은 초안/버전에 두어 중복 현재값 제거.
- **연결 예시:** `id=1; work_id=work-1; sequence=2`처럼 한 관계·사건을 기록합니다(가상 예시; 상태 enum 미확정).

<a id="episode-draft"></a>
### `EPISODE_DRAFT`

- **역할·범위:** 한 회차의 가변 작업 원고입니다. **MVP**.
- **그림의 필드:** `episode_id`(PK), `title`, `content`, `edit_revision`, `updated_at`.
- **참조:** `episode_id` → [`EPISODE`](tables.md#episode).`id`.
- **제약·한계:** 회차당 최대 1개. 자동저장은 버전 생성 아님. edit_revision 충돌 확인.
- **연결 예시:** `episode_id=episode-1; title=푸른 왕국; content=당시 허용된 내용`처럼 한 관계·사건을 기록합니다(가상 예시; 상태 enum 미확정).

<a id="episode-version"></a>
### `EPISODE_VERSION`

- **역할·범위:** 수동 저장·복원으로 확정한 제목과 원고 버전입니다. **MVP**.
- **그림의 필드:** `id`(PK), `episode_id`, `work_world_history_id`, `revision_no`, `title`, `content`, `restored_from_id`, `created_at`.
- **참조:** `episode_id` → [`EPISODE`](tables.md#episode).`id`; `work_world_history_id` → [`WORK_WORLD_HISTORY`](tables.md#work-world-history).`id`; `restored_from_id` → [`EPISODE_VERSION`](tables.md#episode-version).`id` (선택).
- **제약·한계:** UNIQUE(episode_id,revision_no). 연결 이력과 회차의 작품 일치. 복원은 새 버전, 기존 발행 자동변경 금지.
- **연결 예시:** `id=1; episode_id=episode-1; work_world_history_id=work_world_history-1; revision_no=2`처럼 한 관계·사건을 기록합니다(가상 예시; 상태 enum 미확정).

<a id="manuscript-asset"></a>
### `MANUSCRIPT_ASSET`

- **역할·범위:** 원고·생성 제안이 참조하는 이미지 파일 식별과 메타데이터입니다. **전체·범위확인**.
- **그림의 필드:** `id`(PK), `owner_id`, `object_url`, `media_type`, `byte_size`, `created_at`.
- **참조:** `owner_id` → [`MEMBER`](tables.md#member).`id`.
- **제약·한계:** 파일은 MinIO. 저장 원고 버전이 참조하는 동안 제안 삭제로 파일 삭제 금지. AI에 업로드 이미지 전달 금지.
- **연결 예시:** `id=1; owner_id=member-1`처럼 한 관계·사건을 기록합니다(가상 예시; 상태 enum 미확정).

<a id="episode-draft-image"></a>
### `EPISODE_DRAFT_IMAGE`

- **역할·범위:** 초안에 배치한 이미지별 위치와 대체 텍스트 후보입니다. **전체·범위확인**.
- **그림의 필드:** `id`(PK), `episode_id`, `asset_id`, `position`, `alt_text`.
- **참조:** `episode_id` → [`EPISODE_DRAFT`](tables.md#episode-draft).`episode_id`; `asset_id` → [`MANUSCRIPT_ASSET`](tables.md#manuscript-asset).`id`.
- **제약·한계:** 초안 삭제와 원본 파일 정리를 구분. 위치 및 대체 텍스트 UI 미정.
- **연결 예시:** `id=1; episode_id=episode_draft-1; asset_id=manuscript_asset-1`처럼 한 관계·사건을 기록합니다(가상 예시; 상태 enum 미확정).

<a id="episode-version-image"></a>
### `EPISODE_VERSION_IMAGE`

- **역할·범위:** 저장된 원고 버전에 실제 사용한 이미지와 위치를 보존합니다. **전체·범위확인**.
- **그림의 필드:** `id`(PK), `episode_version_id`, `asset_id`, `position`, `alt_text`.
- **참조:** `episode_version_id` → [`EPISODE_VERSION`](tables.md#episode-version).`id`; `asset_id` → [`MANUSCRIPT_ASSET`](tables.md#manuscript-asset).`id`.
- **제약·한계:** 불변. 버전 복원 시 동일 파일 및 위치 복원; 설정 이미지의 과거 미보존 규칙과 다름.
- **연결 예시:** `id=1; episode_version_id=episode_version-1; asset_id=manuscript_asset-1`처럼 한 관계·사건을 기록합니다(가상 예시; 상태 enum 미확정).

<a id="episode-draft-mention"></a>
### `EPISODE_DRAFT_MENTION`

- **역할·범위:** 초안의 @ 인물 선택과 위치를 개별 행으로 기록합니다. **MVP**.
- **그림의 필드:** `id`(PK), `episode_id`, `character_id`, `position`.
- **참조:** `episode_id` → [`EPISODE_DRAFT`](tables.md#episode-draft).`episode_id`; `character_id` → [`SETTING_DOCUMENT`](tables.md#setting-document).`id`.
- **제약·한계:** 동명이인이어도 선택 식별자로 구분. 해당 작품 세계관의 인물만. 사건·장소로 확대하지 않음.
- **연결 예시:** `id=1; episode_id=episode_draft-1; character_id=setting_document-1`처럼 한 관계·사건을 기록합니다(가상 예시; 상태 enum 미확정).

<a id="episode-version-mention"></a>
### `EPISODE_VERSION_MENTION`

- **역할·범위:** 저장 버전의 @ 인물 연결과 위치를 불변으로 보존합니다. **MVP**.
- **그림의 필드:** `id`(PK), `episode_version_id`, `character_id`, `position`.
- **참조:** `episode_version_id` → [`EPISODE_VERSION`](tables.md#episode-version).`id`; `character_id` → [`SETTING_DOCUMENT`](tables.md#setting-document).`id`.
- **제약·한계:** 인물 연결 복원은 인물 정본 변경·비공개 정보 접근 허용이 아님.
- **연결 예시:** `id=1; episode_version_id=episode_version-1; character_id=setting_document-1`처럼 한 관계·사건을 기록합니다(가상 예시; 상태 enum 미확정).

<a id="publication-event"></a>
### `PUBLICATION_EVENT`

- **역할·범위:** 발행·교체·공개 중단·재공개와 그 실제 성공·실패를 구분한 이력입니다. 저장은 EPISODE_VERSION 생성으로만 표현합니다. **MVP**.
- **그림의 필드:** `id`(PK), `episode_version_id`, `actor_id`, `action`, `outcome`, `occurred_at`, `trigger_kind`.
- **참조:** `episode_version_id` → [`EPISODE_VERSION`](tables.md#episode-version).`id`; `actor_id` → [`MEMBER`](tables.md#member).`id` (선택).
- **제약·한계:** 회차별 직렬화된 성공 발행·교체·중단·재공개 전이만 현재 발행 상태를 변경. 일반 저장은 발행 사건에 넣지 않음. 실패는 이전 발행 상태 유지. 자동 요청은 유효 사전승인 검증; 독자 과거 발행 이력 노출 미정. trigger_kind로 작가/자율연재/피드백수정 구분; 피드백 재발행은 자동 설정추출 제외.
- **연결 예시:** `id=1; episode_version_id=episode_version-1; actor_id=member-1; action=종류/상태의 예시값`처럼 한 관계·사건을 기록합니다(가상 예시; 상태 enum 미확정).

<a id="publication-schedule"></a>
### `PUBLICATION_SCHEDULE`

- **역할·범위:** 지정 저장 버전과 예약 시각을 실제 발행 결과와 분리합니다. **전체·범위확인**.
- **그림의 필드:** `id`(PK), `episode_version_id`, `scheduled_at`, `status`, `created_at`.
- **참조:** `episode_version_id` → [`EPISODE_VERSION`](tables.md#episode-version).`id`.
- **제약·한계:** 실행 시 권한·조건 재확인. 변경·취소·실패 상세 미정. 실행 결과는 SCHEDULED_TASK_ITEM 연결.
- **연결 예시:** `id=1; episode_version_id=episode_version-1; status=종류/상태의 예시값`처럼 한 관계·사건을 기록합니다(가상 예시; 상태 enum 미확정).

<a id="story-plan"></a>
### `STORY_PLAN`

- **역할·범위:** 줄거리·플롯·장면 계획을 공통 속성의 단일 계층으로 보관합니다. **MVP**.
- **그림의 필드:** `id`(PK), `work_id`, `episode_id`, `parent_plan_id`, `kind`, `title`, `sequence`, `content`.
- **참조:** `work_id` → [`WORK`](tables.md#work).`id`; `episode_id` → [`EPISODE`](tables.md#episode).`id` (선택); `parent_plan_id` → [`STORY_PLAN`](tables.md#story-plan).`id` (선택).
- **제약·한계:** 같은 작품의 부모·회차, 순환 금지. 유형마다 같은 테이블 복제 불필요. 예정 사건은 정본 사실 아님.
- **연결 예시:** `id=1; work_id=work-1; episode_id=episode-1; parent_plan_id=story_plan-1`처럼 한 관계·사건을 기록합니다(가상 예시; 상태 enum 미확정).

<a id="writing-note"></a>
### `WRITING_NOTE`

- **역할·범위:** 작품별 비공개 집필 메모입니다. **전체·범위확인**.
- **그림의 필드:** `id`(PK), `work_id`, `episode_id`, `content`, `updated_at`.
- **참조:** `work_id` → [`WORK`](tables.md#work).`id`; `episode_id` → [`EPISODE`](tables.md#episode).`id` (선택).
- **제약·한계:** 원고·설정 정본과 구분. 내보내기에 포함하지 않음. 보드·타임라인은 STORY_PLAN 표시로 재사용.
- **연결 예시:** `id=1; work_id=work-1; episode_id=episode-1; content=당시 허용된 내용`처럼 한 관계·사건을 기록합니다(가상 예시; 상태 enum 미확정).

<a id="manuscript-import"></a>
### `MANUSCRIPT_IMPORT`

- **역할·범위:** 여러 회차를 가져오는 요청의 출처·상태를 보관합니다. **전체·범위확인**.
- **그림의 필드:** `id`(PK), `work_id`, `input_kind`, `created_at`, `status`.
- **참조:** `work_id` → [`WORK`](tables.md#work).`id`.
- **제약·한계:** 붙여넣기와 파일 입력 구분. 등록은 발행·학습·외부 동기화 동의가 아님.
- **연결 예시:** `id=1; work_id=work-1; status=종류/상태의 예시값`처럼 한 관계·사건을 기록합니다(가상 예시; 상태 enum 미확정).

<a id="manuscript-import-item"></a>
### `MANUSCRIPT_IMPORT_ITEM`

- **역할·범위:** 가져오기 요청의 회차별 성공·실패와 저장 결과입니다. **전체·범위확인**.
- **그림의 필드:** `id`(PK), `import_id`, `sequence`, `episode_version_id`, `status`, `failure_reason`.
- **참조:** `import_id` → [`MANUSCRIPT_IMPORT`](tables.md#manuscript-import).`id`; `episode_version_id` → [`EPISODE_VERSION`](tables.md#episode-version).`id` (선택).
- **제약·한계:** UNIQUE(import_id,sequence). 실패 항목을 성공으로 합치지 않음; 재등록은 새 저장 버전.
- **연결 예시:** `id=1; import_id=manuscript_import-1; sequence=2; episode_version_id=episode_version-1`처럼 한 관계·사건을 기록합니다(가상 예시; 상태 enum 미확정).

<a id="manuscript-import-issue"></a>
### `MANUSCRIPT_IMPORT_ISSUE`

- **역할·범위:** 한 회차의 여러 이미지·읽기 문제를 분리합니다. **MVP 이후**.
- **그림의 필드:** `id`(PK), `import_item_id`, `source_position`, `reason`.
- **참조:** `import_item_id` → [`MANUSCRIPT_IMPORT_ITEM`](tables.md#manuscript-import-item).`id`.
- **제약·한계:** 부분 이미지 실패가 있는 회차는 완전 성공으로 표시 금지.
- **연결 예시:** `id=1; import_item_id=manuscript_import_item-1`처럼 한 관계·사건을 기록합니다(가상 예시; 상태 enum 미확정).

<a id="external-ip"></a>
### `EXTERNAL_IP`

- **역할·범위:** 외부 2차 창작물들이 공유하는 원천 IP의 식별 후보입니다. **전체·범위확인**.
- **그림의 필드:** `id`(PK), `name`, `reference_url`.
- **참조:** 다른 업무 테이블의 FK 없음.
- **제약·한계:** 동일 IP 판별·동명이명 처리 미정. 이름/URL만으로 법적 권리를 인정하지 않음.
- **연결 예시:** `id=1; name=푸른 왕국`처럼 한 관계·사건을 기록합니다(가상 예시; 상태 enum 미확정).

<a id="work-external-source"></a>
### `WORK_EXTERNAL_SOURCE`

- **역할·범위:** 외부 2차 창작 작품과 원천 IP·등록 출처의 연결입니다. **전체·범위확인**.
- **그림의 필드:** `work_id`(PK), `external_ip_id`, `source_url`, `registered_at`.
- **참조:** `work_id` → [`WORK`](tables.md#work).`id`; `external_ip_id` → [`EXTERNAL_IP`](tables.md#external-ip).`id`.
- **제약·한계:** 최초 등록 작품을 IP별로 조회하되 플랫폼 기준이지 저작권 소유권 아님. 다중 IP 작품 지원은 미정, 현재 후보는 작품당 하나.
- **연결 예시:** `work_id=work-1; external_ip_id=external_ip-1`처럼 한 관계·사건을 기록합니다(가상 예시; 상태 enum 미확정).

<a id="public-domain-source"></a>
### `PUBLIC_DOMAIN_SOURCE`

- **역할·범위:** 테스트 원작의 서지 정보와 보호기간 만료 근거입니다. **테스트 전용**.
- **그림의 필드:** `work_id`(PK), `bibliographic_info`, `rights_basis`, `verified_at`.
- **참조:** `work_id` → [`WORK`](tables.md#work).`id`.
- **제약·한계:** 테스트 환경 전용. 번역·편집본 권리 별도 확인. 운영 수집 파이프라인/법적 검증 자동화를 추가하지 않음.
- **연결 예시:** `work_id=work-1`처럼 한 관계·사건을 기록합니다(가상 예시; 상태 enum 미확정).

## 체크포인트·Fork

[부분 ERD](core/fork-and-checkpoint.md) · 근거: [UC-07](../../usecase-spec/UC-07.md), [UC-08](../../usecase-spec/UC-08.md)

<a id="checkpoint"></a>
### `CHECKPOINT`

- **역할·범위:** 회차와 당시 허용된 세계관 상태를 묶는 업무 기준점입니다. **MVP**.
- **그림의 필드:** `id`(PK), `work_id`, `basis_episode_version_id`, `graph_state_ref`, `status`, `created_at`.
- **참조:** `work_id` → [`WORK`](tables.md#work).`id`; `basis_episode_version_id` → [`EPISODE_VERSION`](tables.md#episode-version).`id`.
- **제약·한계:** work_id는 기준점 소유 문맥, basis_episode_version_id는 이야기 기준으로 서로 다름. Fork가 자기 원고 없이 설정부터 수정하면 원작 기준 버전을 유지하되 Fork 소유 기준점을 생성. 원작 버전은 FORK.source_checkpoint 계보와 일치해야 함. graph_state_ref는 외부참조이지 FK 아님. 원고·설정·상태·지식·관계의 허용범위·완전성·시점 검증 후 준비 완료.
- **연결 예시:** `id=1; work_id=work-1; basis_episode_version_id=episode_version-1; status=종류/상태의 예시값`처럼 한 관계·사건을 기록합니다(가상 예시; 상태 enum 미확정).

<a id="checkpoint-episode"></a>
### `CHECKPOINT_EPISODE`

- **역할·범위:** 기준점에 포함된 회차별 원고 버전입니다. **MVP**.
- **그림의 필드:** `checkpoint_id`(PK), `episode_id`(PK), `episode_version_id`.
- **참조:** `checkpoint_id` → [`CHECKPOINT`](tables.md#checkpoint).`id`; `episode_id` → [`EPISODE`](tables.md#episode).`id`; `episode_version_id` → [`EPISODE_VERSION`](tables.md#episode-version).`id`.
- **제약·한계:** 한 기준점·회차당 1버전. (episode_id,episode_version_id) 소속 검증; 기준 버전과 일치. 의도적 소속키 중복은 정규화 예외.
- **연결 예시:** `checkpoint_id=checkpoint-1; episode_id=episode-1; episode_version_id=episode_version-1`처럼 한 관계·사건을 기록합니다(가상 예시; 상태 enum 미확정).

<a id="checkpoint-setting"></a>
### `CHECKPOINT_SETTING`

- **역할·범위:** 기준점에 포함된 설정별 확정 버전입니다. **MVP**.
- **그림의 필드:** `checkpoint_id`(PK), `setting_document_id`(PK), `setting_version_id`.
- **참조:** `checkpoint_id` → [`CHECKPOINT`](tables.md#checkpoint).`id`; `setting_document_id` → [`SETTING_DOCUMENT`](tables.md#setting-document).`id`; `setting_version_id` → [`SETTING_VERSION`](tables.md#setting-version).`id`.
- **제약·한계:** 한 기준점·항목당 1버전. (setting_document_id,setting_version_id) 복합 참조 제약 후보. 공개 허용 본문만 포함.
- **연결 예시:** `checkpoint_id=checkpoint-1; setting_document_id=setting_document-1; setting_version_id=setting_version-1`처럼 한 관계·사건을 기록합니다(가상 예시; 상태 enum 미확정).

<a id="checkpoint-character-state"></a>
### `CHECKPOINT_CHARACTER_STATE`

- **역할·범위:** 기준점에서 사용할 인물별 상태 버전입니다. **MVP**.
- **그림의 필드:** `checkpoint_id`(PK), `character_id`(PK), `state_version_id`.
- **참조:** `checkpoint_id` → [`CHECKPOINT`](tables.md#checkpoint).`id`; `character_id` → [`SETTING_DOCUMENT`](tables.md#setting-document).`id`; `state_version_id` → [`CHARACTER_STATE_VERSION`](tables.md#character-state-version).`id`.
- **제약·한계:** 한 인물당 1상태. 버전의 인물 일치, 허용 세계관·회차 검증.
- **연결 예시:** `checkpoint_id=checkpoint-1; character_id=setting_document-1; state_version_id=character_state_version-1`처럼 한 관계·사건을 기록합니다(가상 예시; 상태 enum 미확정).

<a id="checkpoint-character-knowledge"></a>
### `CHECKPOINT_CHARACTER_KNOWLEDGE`

- **역할·범위:** 기준점에서 사용할 인물·지식별 인지 버전입니다. **MVP**.
- **그림의 필드:** `checkpoint_id`(PK), `character_id`(PK), `fact_setting_id`(PK), `knowledge_version_id`.
- **참조:** `checkpoint_id` → [`CHECKPOINT`](tables.md#checkpoint).`id`; `character_id` → [`SETTING_DOCUMENT`](tables.md#setting-document).`id`; `fact_setting_id` → [`SETTING_DOCUMENT`](tables.md#setting-document).`id`; `knowledge_version_id` → [`CHARACTER_KNOWLEDGE_VERSION`](tables.md#character-knowledge-version).`id`.
- **제약·한계:** 한 인물·지식당 1버전. 3개 소속키와 버전 일치. 구성 누락 및 인물 지식 누출은 FK만으로 막을 수 없음.
- **연결 예시:** `checkpoint_id=checkpoint-1; character_id=setting_document-1; fact_setting_id=setting_document-1; knowledge_version_id=character_knowledge_version-1`처럼 한 관계·사건을 기록합니다(가상 예시; 상태 enum 미확정).

<a id="fork-policy-history"></a>
### `FORK_POLICY_HISTORY`

- **역할·범위:** 원작의 Fork 생성·공개 허용과 범위 변경을 보존합니다. **MVP**.
- **그림의 필드:** `id`(PK), `work_id`, `revision_no`, `allow_creation`, `allow_publication`, `episode_scope`, `start_episode_id`, `changed_at`.
- **참조:** `work_id` → [`WORK`](tables.md#work).`id`; `start_episode_id` → [`EPISODE`](tables.md#episode).`id` (선택).
- **제약·한계:** UNIQUE(work_id,revision_no). 전체/특정 회차 이후/개별 회차 조합 검증. 시작 포함 여부 미정. WORK에 현재 허용값을 중복 저장하지 않음.
- **연결 예시:** `id=1; work_id=work-1; revision_no=2; start_episode_id=episode-1`처럼 한 관계·사건을 기록합니다(가상 예시; 상태 enum 미확정).

<a id="fork-policy-episode"></a>
### `FORK_POLICY_EPISODE`

- **역할·범위:** 개별 선택 정책의 허용 회차 집합입니다. **MVP**.
- **그림의 필드:** `policy_history_id`(PK), `episode_id`(PK).
- **참조:** `policy_history_id` → [`FORK_POLICY_HISTORY`](tables.md#fork-policy-history).`id`; `episode_id` → [`EPISODE`](tables.md#episode).`id`.
- **제약·한계:** 회차와 정책 원작 일치. 이력별 목록 불변. 전체 범위는 미래 발행 회차도 포함하므로 미리 펼쳐 저장하지 않음.
- **연결 예시:** `policy_history_id=fork_policy_history-1; episode_id=episode-1`처럼 한 관계·사건을 기록합니다(가상 예시; 상태 enum 미확정).

<a id="fork"></a>
### `FORK`

- **역할·범위:** 독립 작품의 분기 기준과 생성 시 확인한 이용 조건입니다. **MVP**.
- **그림의 필드:** `work_id`(PK), `source_checkpoint_id`, `confirmed_policy_history_id`, `conditions_confirmed_at`, `created_at`.
- **참조:** `work_id` → [`WORK`](tables.md#work).`id`; `source_checkpoint_id` → [`CHECKPOINT`](tables.md#checkpoint).`id`; `confirmed_policy_history_id` → [`FORK_POLICY_HISTORY`](tables.md#fork-policy-history).`id`.
- **제약·한계:** 원작과 정책 작품 일치. 동일 창작자·원작 1회, Fork의 Fork 금지: 파생 관계를 통한 동시성 검증 필요. 확인 기록은 영구 공개 권리 아님.
- **연결 예시:** `work_id=work-1; source_checkpoint_id=checkpoint-1; confirmed_policy_history_id=fork_policy_history-1`처럼 한 관계·사건을 기록합니다(가상 예시; 상태 enum 미확정).

<a id="fork-world-reference"></a>
### `FORK_WORLD_REFERENCE`

- **역할·범위:** Fork의 최초 기준과 구분되는 현재 원본 추종·독립 상태입니다. **MVP**.
- **그림의 필드:** `fork_work_id`(PK), `source_world_id`, `reference_status`, `last_followed_checkpoint_id`, `detached_at`.
- **참조:** `fork_work_id` → [`FORK`](tables.md#fork).`work_id`; `source_world_id` → [`WORLD`](tables.md#world).`id`; `last_followed_checkpoint_id` → [`CHECKPOINT`](tables.md#checkpoint).`id` (선택).
- **제약·한계:** Fork 세계관은 작품의 연결 이력으로 유도하여 중복 FK 제거. 첫 수정에 허용된 전체를 독립 복사. 원작 정본 쓰기 금지.
- **연결 예시:** `fork_work_id=fork-1; source_world_id=world-1; last_followed_checkpoint_id=checkpoint-1`처럼 한 관계·사건을 기록합니다(가상 예시; 상태 enum 미확정).

<a id="fork-source-change"></a>
### `FORK_SOURCE_CHANGE`

- **역할·범위:** 특정 Fork 기준 회차에 영향을 주는 원본 변화와 비교 기준입니다. **MVP**.
- **그림의 필드:** `id`(PK), `fork_work_id`, `before_checkpoint_id`, `after_checkpoint_id`, `detected_at`.
- **참조:** `fork_work_id` → [`FORK`](tables.md#fork).`work_id`; `before_checkpoint_id` → [`CHECKPOINT`](tables.md#checkpoint).`id`; `after_checkpoint_id` → [`CHECKPOINT`](tables.md#checkpoint).`id`.
- **제약·한계:** UNIQUE(fork_work_id,before_checkpoint_id,after_checkpoint_id). 두 기준점은 같은 원작·기준 회차. 그래프 변경도 비교 가능한 기준 참조를 제공해야 함.
- **연결 예시:** `id=1; fork_work_id=fork-1; before_checkpoint_id=checkpoint-1; after_checkpoint_id=checkpoint-1`처럼 한 관계·사건을 기록합니다(가상 예시; 상태 enum 미확정).

<a id="fork-change-decision"></a>
### `FORK_CHANGE_DECISION`

- **역할·범위:** 원본 변경을 거절한 뒤 나중에 재선택하는 결정 이력입니다. **MVP**.
- **그림의 필드:** `id`(PK), `source_change_id`, `actor_id`, `decision`, `decided_at`.
- **참조:** `source_change_id` → [`FORK_SOURCE_CHANGE`](tables.md#fork-source-change).`id`; `actor_id` → [`MEMBER`](tables.md#member).`id`.
- **제약·한계:** 결정은 실제 반영이 아님. 최초 거절 기록을 덮어쓰지 않음.
- **연결 예시:** `id=1; source_change_id=fork_source_change-1; actor_id=member-1; decision=종류/상태의 예시값`처럼 한 관계·사건을 기록합니다(가상 예시; 상태 enum 미확정).

<a id="fork-change-application"></a>
### `FORK_CHANGE_APPLICATION`

- **역할·범위:** 선택된 원본 변경의 실제 반영 시도·실패·완료 결과입니다. **MVP**.
- **그림의 필드:** `id`(PK), `decision_id`, `result_checkpoint_id`, `outcome`, `reason`, `applied_at`.
- **참조:** `decision_id` → [`FORK_CHANGE_DECISION`](tables.md#fork-change-decision).`id`; `result_checkpoint_id` → [`CHECKPOINT`](tables.md#checkpoint).`id` (선택).
- **제약·한계:** 권한·기준 재검증. 저장소 부분 실패를 성공으로 처리하지 않음. 성공 결과는 해당 Fork 소유 기준점.
- **연결 예시:** `id=1; decision_id=fork_change_decision-1; result_checkpoint_id=checkpoint-1; outcome=종류/상태의 예시값`처럼 한 관계·사건을 기록합니다(가상 예시; 상태 enum 미확정).

## AI 작업·대화·시뮬레이션

[부분 ERD](core/ai-work.md) · 근거: [UC-04](../../usecase-spec/UC-04.md), [UC-09](../../usecase-spec/UC-09.md), [UC-11](../../usecase-spec/UC-11.md), [UC-12](../../usecase-spec/UC-12.md), [UC-25](../../usecase-spec/UC-25.md), [UC-26](../../usecase-spec/UC-26.md)

<a id="chat-session"></a>
### `CHAT_SESSION`

- **역할·범위:** 회원 소유 대화와 읽는 원작·쓰는 Fork 문맥의 연결입니다. **MVP**.
- **그림의 필드:** `id`(PK), `owner_id`, `context_work_id`, `target_fork_work_id`, `saver_thread_ref`, `created_at`.
- **참조:** `owner_id` → [`MEMBER`](tables.md#member).`id`; `context_work_id` → [`WORK`](tables.md#work).`id`; `target_fork_work_id` → [`FORK`](tables.md#fork).`work_id` (선택).
- **제약·한계:** Saver 참조는 외부 키이지 Core PK·인증 수단이 아님. 대화별 문맥은 턴/작업 기준으로 제한.
- **연결 예시:** `id=1; owner_id=member-1; context_work_id=work-1; target_fork_work_id=fork-1`처럼 한 관계·사건을 기록합니다(가상 예시; 상태 enum 미확정).

<a id="chat-message"></a>
### `CHAT_MESSAGE`

- **역할·범위:** 세션 안의 개별 사용자·AI 메시지입니다. **MVP**.
- **그림의 필드:** `id`(PK), `session_id`, `sequence`, `speaker`, `content`, `ai_job_id`, `created_at`.
- **참조:** `session_id` → [`CHAT_SESSION`](tables.md#chat-session).`id`; `ai_job_id` → [`AI_JOB`](tables.md#ai-job).`id` (선택).
- **제약·한계:** UNIQUE(session_id,sequence). 사용자 메시지는 AI_JOB 없이 존재 가능. 세션 소유자 외 자동 공개 금지.
- **연결 예시:** `id=1; session_id=chat_session-1; sequence=2; content=당시 허용된 내용`처럼 한 관계·사건을 기록합니다(가상 예시; 상태 enum 미확정).

<a id="ai-job"></a>
### `AI_JOB`

- **역할·범위:** 하나의 사용자 요청 또는 승인된 자동 작업의 결과·실패를 관리합니다. **MVP**.
- **그림의 필드:** `id`(PK), `requester_id`, `work_id`, `session_id`, `retry_of_job_id`, `base_checkpoint_id`, `kind`, `request_text`, `status`, `failure_reason`, `created_at`, `started_at`, `finished_at`.
- **참조:** `requester_id` → [`MEMBER`](tables.md#member).`id`; `work_id` → [`WORK`](tables.md#work).`id` (선택); `session_id` → [`CHAT_SESSION`](tables.md#chat-session).`id` (선택); `retry_of_job_id` → [`AI_JOB`](tables.md#ai-job).`id` (선택); `base_checkpoint_id` → [`CHECKPOINT`](tables.md#checkpoint).`id` (선택).
- **제약·한계:** 사용자 재시도·재생성은 새 작업; 순환 재시도 금지. 실제 시작과 생성 시각 구분. 모델별 토큰은 AI_MODEL_CALL. 원문 포함 기록은 기술 로그가 아님. 집필/시뮬레이션 등 작품 작업은 work_id 필수; 미연결 세계관·설정 신고 모더레이션은 선택이며 CONTENT_MODERATION_ASSESSMENT→RIGHTS_CASE_TARGET에서 실제 대상을 검증. 무관한 작품을 연결하지 않음.
- **연결 예시:** `id=1; requester_id=member-1; work_id=work-1; session_id=chat_session-1`처럼 한 관계·사건을 기록합니다(가상 예시; 상태 enum 미확정).

<a id="ai-model-call"></a>
### `AI_MODEL_CALL`

- **역할·범위:** 한 작업에서 수행한 여러 모델·역할의 호출과 실제 사용량입니다. **MVP**.
- **그림의 필드:** `id`(PK), `job_id`, `sequence`, `retry_of_call_id`, `role`, `provider`, `model`, `prompt_version_ref`, `trace_ref`, `status`, `usage_status`, `input_tokens`, `output_tokens`, `provider_cost`, `started_at`, `finished_at`, `failure_code`.
- **참조:** `job_id` → [`AI_JOB`](tables.md#ai-job).`id`; `retry_of_call_id` → [`AI_MODEL_CALL`](tables.md#ai-model-call).`id` (선택).
- **제약·한계:** UNIQUE(job_id,sequence). 사용량 미보고 NULL과 실제 0 구분, 음수 금지. 외부 프롬프트·trace는 FK 아님. 작업 합계는 파생 조회.
- **연결 예시:** `id=1; job_id=ai_job-1; sequence=2; retry_of_call_id=ai_model_call-1`처럼 한 관계·사건을 기록합니다(가상 예시; 상태 enum 미확정).

<a id="ai-input-snapshot"></a>
### `AI_INPUT_SNAPSHOT`

- **역할·범위:** 요청 당시의 필요한 원고·설정 범위와 내용을 보존합니다. **MVP**.
- **그림의 필드:** `id`(PK), `job_id`, `episode_id`, `episode_version_id`, `setting_version_id`, `graph_state_ref`, `source_kind`, `position`, `content_snapshot`, `draft_revision`, `captured_at`.
- **참조:** `job_id` → [`AI_JOB`](tables.md#ai-job).`id`; `episode_id` → [`EPISODE`](tables.md#episode).`id` (선택); `episode_version_id` → [`EPISODE_VERSION`](tables.md#episode-version).`id` (선택); `setting_version_id` → [`SETTING_VERSION`](tables.md#setting-version).`id` (선택).
- **제약·한계:** 종류별 원고 초안/저장버전/설정/그래프 조합 검증. 버전 소속 회차 일치. 스냅샷은 최소 허용 범위만 보존; 해시나 가변 초안 참조만으로 대체하지 않음.
- **연결 예시:** `id=1; job_id=ai_job-1; episode_id=episode-1; episode_version_id=episode_version-1`처럼 한 관계·사건을 기록합니다(가상 예시; 상태 enum 미확정).

<a id="ai-proposal"></a>
### `AI_PROPOSAL`

- **역할·범위:** 작업이 생성한 원안·발견 사항·후보 한 개입니다. **MVP**.
- **그림의 필드:** `id`(PK), `job_id`, `input_snapshot_id`, `sequence`, `kind`, `content`, `created_at`.
- **참조:** `job_id` → [`AI_JOB`](tables.md#ai-job).`id`; `input_snapshot_id` → [`AI_INPUT_SNAPSHOT`](tables.md#ai-input-snapshot).`id` (선택).
- **제약·한계:** UNIQUE(job_id,sequence). 원안 불변. review_finding도 이 테이블 재사용; 선택 상태와 실제 반영은 이력에서 유도.
- **연결 예시:** `id=1; job_id=ai_job-1; input_snapshot_id=ai_input_snapshot-1; sequence=2`처럼 한 관계·사건을 기록합니다(가상 예시; 상태 enum 미확정).

<a id="ai-evidence"></a>
### `AI_EVIDENCE`

- **역할·범위:** AI 근거 한 개의 당시 인용과 출처입니다. **MVP**.
- **그림의 필드:** `id`(PK), `episode_version_id`, `setting_version_id`, `graph_state_ref`, `kind`, `position`, `excerpt_snapshot`, `captured_at`.
- **참조:** `episode_version_id` → [`EPISODE_VERSION`](tables.md#episode-version).`id` (선택); `setting_version_id` → [`SETTING_VERSION`](tables.md#setting-version).`id` (선택).
- **제약·한계:** 원고/설정/그래프 출처 중 정확히 하나. 그래프 참조는 FK 아님. 인용 ID 존재는 사실성·공개 권한의 증명이 아님.
- **연결 예시:** `id=1; episode_version_id=episode_version-1; setting_version_id=setting_version-1; kind=종류/상태의 예시값`처럼 한 관계·사건을 기록합니다(가상 예시; 상태 enum 미확정).

<a id="proposal-evidence"></a>
### `PROPOSAL_EVIDENCE`

- **역할·범위:** 제안·검토 발견 하나의 여러 근거를 연결합니다. **MVP**.
- **그림의 필드:** `proposal_id`(PK), `evidence_id`(PK).
- **참조:** `proposal_id` → [`AI_PROPOSAL`](tables.md#ai-proposal).`id`; `evidence_id` → [`AI_EVIDENCE`](tables.md#ai-evidence).`id`.
- **제약·한계:** 같은 근거 여러 후보에서 재사용 가능. 요청 기준·권한 검증.
- **연결 예시:** `proposal_id=ai_proposal-1; evidence_id=ai_evidence-1`처럼 한 관계·사건을 기록합니다(가상 예시; 상태 enum 미확정).

<a id="proposal-decision"></a>
### `PROPOSAL_DECISION`

- **역할·범위:** 채택·일부 채택·수정·거절·보류와 개연성 검토 판단의 이력입니다. **MVP**.
- **그림의 필드:** `id`(PK), `proposal_id`, `sequence`, `actor_id`, `automation_policy_id`, `decision`, `selected_range`, `approved_content`, `decided_at`.
- **참조:** `proposal_id` → [`AI_PROPOSAL`](tables.md#ai-proposal).`id`; `actor_id` → [`MEMBER`](tables.md#member).`id` (선택); `automation_policy_id` → [`WORK_AUTOMATION_VERSION`](tables.md#work-automation-version).`id` (선택).
- **제약·한계:** UNIQUE(proposal_id,sequence). 사람 또는 유효 자동 설정의 승인 출처. 원안과 승인내용 별도 보존. 검토 판단은 실제 수정 아님.
- **연결 예시:** `id=1; proposal_id=ai_proposal-1; sequence=2; actor_id=member-1`처럼 한 관계·사건을 기록합니다(가상 예시; 상태 enum 미확정).

<a id="proposal-application"></a>
### `PROPOSAL_APPLICATION`

- **역할·범위:** 선택된 제안의 실제 반영 시도입니다. **MVP**.
- **그림의 필드:** `id`(PK), `decision_id`, `attempt_no`, `outcome`, `failure_reason`, `attempted_at`.
- **참조:** `decision_id` → [`PROPOSAL_DECISION`](tables.md#proposal-decision).`id`.
- **제약·한계:** UNIQUE(decision_id,attempt_no). 승인 범위만, 현재 권한·기준 재검증. 성공·부분 실패·실패를 실제 결과로 구분.
- **연결 예시:** `id=1; decision_id=proposal_decision-1; attempt_no=2; outcome=종류/상태의 예시값`처럼 한 관계·사건을 기록합니다(가상 예시; 상태 enum 미확정).

<a id="proposal-episode-change"></a>
### `PROPOSAL_EPISODE_CHANGE`

- **역할·범위:** 반영 시도에서 바뀐 원고 구절·초안 revision·저장 결과입니다. **MVP**.
- **그림의 필드:** `id`(PK), `application_id`, `episode_id`, `result_version_id`, `position`, `before_content`, `after_content`, `base_draft_revision`, `result_draft_revision`.
- **참조:** `application_id` → [`PROPOSAL_APPLICATION`](tables.md#proposal-application).`id`; `episode_id` → [`EPISODE`](tables.md#episode).`id`; `result_version_id` → [`EPISODE_VERSION`](tables.md#episode-version).`id` (선택).
- **제약·한계:** 결과 버전은 같은 회차. 초안만 변경되면 결과 저장 버전은 NULL. 복수 구절을 한 applied_id에 압축하지 않음. 발행 결과는 PUBLICATION_EVENT.
- **연결 예시:** `id=1; application_id=proposal_application-1; episode_id=episode-1; result_version_id=episode_version-1`처럼 한 관계·사건을 기록합니다(가상 예시; 상태 enum 미확정).

<a id="proposal-setting-change"></a>
### `PROPOSAL_SETTING_CHANGE`

- **역할·범위:** 반영 시도에서 바뀐 설정별 결과입니다. **MVP**.
- **그림의 필드:** `id`(PK), `application_id`, `setting_document_id`, `result_version_id`, `outcome`.
- **참조:** `application_id` → [`PROPOSAL_APPLICATION`](tables.md#proposal-application).`id`; `setting_document_id` → [`SETTING_DOCUMENT`](tables.md#setting-document).`id`; `result_version_id` → [`SETTING_VERSION`](tables.md#setting-version).`id` (선택).
- **제약·한계:** 결과 버전과 항목 소속 일치. 미완료 시 기존 버전 보존. 공개 변경은 별도 공개 이력에 기록.
- **연결 예시:** `id=1; application_id=proposal_application-1; setting_document_id=setting_document-1; result_version_id=setting_version-1`처럼 한 관계·사건을 기록합니다(가상 예시; 상태 enum 미확정).

<a id="proposal-graph-change"></a>
### `PROPOSAL_GRAPH_CHANGE`

- **역할·범위:** 관계 그래프 변경 제안의 적용 결과와 외부 기준 참조입니다. **MVP**.
- **그림의 필드:** `id`(PK), `application_id`, `before_state_ref`, `after_state_ref`, `outcome`, `failure_reason`.
- **참조:** `application_id` → [`PROPOSAL_APPLICATION`](tables.md#proposal-application).`id`.
- **제약·한계:** 외부 참조에 FK 표시 금지. RDB 변경과 그래프 완료를 단일 트랜잭션으로 가정하지 않음; 제품·정합성 미정.
- **연결 예시:** `id=1; application_id=proposal_application-1; outcome=종류/상태의 예시값`처럼 한 관계·사건을 기록합니다(가상 예시; 상태 enum 미확정).

<a id="proposal-image"></a>
### `PROPOSAL_IMAGE`

- **역할·범위:** 생성 제안의 이미지 파일을 원고 사용 참조와 분리합니다. **MVP 이후**.
- **그림의 필드:** `proposal_id`(PK), `asset_id`(PK), `position`.
- **참조:** `proposal_id` → [`AI_PROPOSAL`](tables.md#ai-proposal).`id`; `asset_id` → [`MANUSCRIPT_ASSET`](tables.md#manuscript-asset).`id`.
- **제약·한계:** 제안 기록 삭제로 저장 원고의 이미지 삭제 금지. 생성 안전정책 거부는 실패.
- **연결 예시:** `proposal_id=ai_proposal-1; asset_id=manuscript_asset-1`처럼 한 관계·사건을 기록합니다(가상 예시; 상태 enum 미확정).

<a id="simulation-run"></a>
### `SIMULATION_RUN`

- **역할·범위:** 시뮬레이션 요청의 장소·상황·전개 방향·분량입니다. **MVP**.
- **그림의 필드:** `job_id`(PK), `purpose`, `location_setting_id`, `situation`, `direction`, `requested_characters`.
- **참조:** `job_id` → [`AI_JOB`](tables.md#ai-job).`id`; `location_setting_id` → [`SETTING_DOCUMENT`](tables.md#setting-document).`id` (선택).
- **제약·한계:** 기준 시점은 AI_JOB. 임시 분량 3000~10000 기본5000. 미완료 결과도 보관. 독자 검증은 제보 전 본인만 조회.
- **연결 예시:** `job_id=ai_job-1; location_setting_id=setting_document-1`처럼 한 관계·사건을 기록합니다(가상 예시; 상태 enum 미확정).

<a id="simulation-participant"></a>
### `SIMULATION_PARTICIPANT`

- **역할·범위:** 실행에 참여한 인물별로 허용된 문맥을 분리합니다. **MVP**.
- **그림의 필드:** `id`(PK), `run_id`, `character_id`, `allowed_context_snapshot`.
- **참조:** `run_id` → [`SIMULATION_RUN`](tables.md#simulation-run).`job_id`; `character_id` → [`SETTING_DOCUMENT`](tables.md#setting-document).`id`.
- **제약·한계:** UNIQUE(run_id,character_id). 다른 인물 비밀·미래 사건 제외. 전체 시뮬레이션 문맥을 인물마다 그대로 전달 금지.
- **연결 예시:** `id=1; run_id=simulation_run-1; character_id=setting_document-1`처럼 한 관계·사건을 기록합니다(가상 예시; 상태 enum 미확정).

<a id="simulation-candidate"></a>
### `SIMULATION_CANDIDATE`

- **역할·범위:** 일반 AI 제안에 시뮬레이션 실행과 후보 순서를 연결합니다. **MVP**.
- **그림의 필드:** `proposal_id`(PK), `run_id`, `sequence`.
- **참조:** `proposal_id` → [`AI_PROPOSAL`](tables.md#ai-proposal).`id`; `run_id` → [`SIMULATION_RUN`](tables.md#simulation-run).`job_id`.
- **제약·한계:** UNIQUE(run_id,sequence). 원안·선택은 AI_PROPOSAL/PROPOSAL_DECISION 재사용. 추가 생성은 새 작업 결과로 구분.
- **연결 예시:** `proposal_id=ai_proposal-1; run_id=simulation_run-1; sequence=2`처럼 한 관계·사건을 기록합니다(가상 예시; 상태 enum 미확정).

<a id="simulation-record"></a>
### `SIMULATION_RECORD`

- **역할·범위:** 후보에서 일어난 행동·대화·사건 기록입니다. **MVP**.
- **그림의 필드:** `id`(PK), `candidate_id`, `sequence`, `kind`, `content`.
- **참조:** `candidate_id` → [`SIMULATION_CANDIDATE`](tables.md#simulation-candidate).`proposal_id`.
- **제약·한계:** UNIQUE(candidate_id,sequence). 행동마다 테이블을 만들지 않음. 실패 시 부분 기록을 완료로 표시하지 않음.
- **연결 예시:** `id=1; candidate_id=simulation_candidate-1; sequence=2; kind=종류/상태의 예시값`처럼 한 관계·사건을 기록합니다(가상 예시; 상태 enum 미확정).

<a id="simulation-record-participant"></a>
### `SIMULATION_RECORD_PARTICIPANT`

- **역할·범위:** 진행 기록에 관여한 여러 인물의 연결입니다. **MVP**.
- **그림의 필드:** `record_id`(PK), `participant_id`(PK).
- **참조:** `record_id` → [`SIMULATION_RECORD`](tables.md#simulation-record).`id`; `participant_id` → [`SIMULATION_PARTICIPANT`](tables.md#simulation-participant).`id`.
- **제약·한계:** 기록과 참여 인물은 동일 실행 문맥. 선택하지 않은 인물 ID 혼입 금지.
- **연결 예시:** `record_id=simulation_record-1; participant_id=simulation_participant-1`처럼 한 관계·사건을 기록합니다(가상 예시; 상태 enum 미확정).

<a id="simulation-causal-link"></a>
### `SIMULATION_CAUSAL_LINK`

- **역할·범위:** 후보 안 사건 기록의 원인·결과 연결입니다. **MVP**.
- **그림의 필드:** `cause_record_id`(PK), `effect_record_id`(PK), `explanation`.
- **참조:** `cause_record_id` → [`SIMULATION_RECORD`](tables.md#simulation-record).`id`; `effect_record_id` → [`SIMULATION_RECORD`](tables.md#simulation-record).`id`.
- **제약·한계:** 양끝은 같은 후보, 자기 연결 금지. 정본 관계 그래프가 아니라 가상 실행 결과.
- **연결 예시:** `cause_record_id=simulation_record-1; effect_record_id=simulation_record-1`처럼 한 관계·사건을 기록합니다(가상 예시; 상태 enum 미확정).

<a id="verification-result"></a>
### `VERIFICATION_RESULT`

- **역할·범위:** 독자 오류 검증 실행의 판정·신뢰도 결과입니다. **MVP 이후**.
- **그림의 필드:** `job_id`(PK), `verdict`, `confidence`, `content`.
- **참조:** `job_id` → [`AI_JOB`](tables.md#ai-job).`id`.
- **제약·한계:** 독자 검증 종류에서만 사용. 실패는 판정 없음이며 완전한 결과로 취급하지 않음.
- **연결 예시:** `job_id=ai_job-1; content=당시 허용된 내용`처럼 한 관계·사건을 기록합니다(가상 예시; 상태 enum 미확정).

<a id="verification-evidence"></a>
### `VERIFICATION_EVIDENCE`

- **역할·범위:** 개인 검증 결과에 연결된 복수 근거입니다. **MVP 이후**.
- **그림의 필드:** `verification_job_id`(PK), `evidence_id`(PK).
- **참조:** `verification_job_id` → [`VERIFICATION_RESULT`](tables.md#verification-result).`job_id`; `evidence_id` → [`AI_EVIDENCE`](tables.md#ai-evidence).`id`.
- **제약·한계:** 제보 시 별도 첨부 스냅샷 생성. 개인 삭제가 제출 첨부를 삭제하지 않음.
- **연결 예시:** `verification_job_id=verification_result-1; evidence_id=ai_evidence-1`처럼 한 관계·사건을 기록합니다(가상 예시; 상태 enum 미확정).

<a id="character-chat"></a>
### `CHARACTER_CHAT`

- **역할·범위:** MVP 이후 인물 대화의 선택 인물을 일반 대화와 구분합니다. **MVP 이후**.
- **그림의 필드:** `session_id`(PK), `character_id`.
- **참조:** `session_id` → [`CHAT_SESSION`](tables.md#chat-session).`id`; `character_id` → [`SETTING_DOCUMENT`](tables.md#setting-document).`id`.
- **제약·한계:** 현재/과거 턴 기준은 연결 AI_JOB·입력 스냅샷. 독자 공개와 인물 지식의 교집합 사용. 보관 정책 미정.
- **연결 예시:** `session_id=chat_session-1; character_id=setting_document-1`처럼 한 관계·사건을 기록합니다(가상 예시; 상태 enum 미확정).

## 독자 피드백

[부분 ERD](core/feedback.md) · 근거: [UC-14](../../usecase-spec/UC-14.md), [UC-15](../../usecase-spec/UC-15.md), [UC-16](../../usecase-spec/UC-16.md)

<a id="feedback"></a>
### `FEEDBACK`

- **역할·범위:** 읽은 발행본·구절에 고정한 원래 댓글 또는 제보입니다. **MVP**.
- **그림의 필드:** `id`(PK), `author_id`, `episode_version_id`, `kind`, `content`, `target_excerpt`, `position`, `visibility`, `is_spoiler`, `created_at`, `delivered_at`, `author_checked_at`.
- **참조:** `author_id` → [`MEMBER`](tables.md#member).`id` (선택); `episode_version_id` → [`EPISODE_VERSION`](tables.md#episode-version).`id`.
- **제약·한계:** 유형은 독자가 선택. 댓글 공개, 제보 공개 선택. 작가 전달 전 검증중단은 전달 안 함. 전달한 제보 원문 보존, 탈퇴시 작성자 익명화.
- **연결 예시:** `id=1; author_id=member-1; episode_version_id=episode_version-1; kind=종류/상태의 예시값`처럼 한 관계·사건을 기록합니다(가상 예시; 상태 enum 미확정).

<a id="feedback-amendment"></a>
### `FEEDBACK_AMENDMENT`

- **역할·범위:** 제보 정정 의견·철회를 원래 제보와 분리합니다. **MVP**.
- **그림의 필드:** `id`(PK), `feedback_id`, `actor_id`, `action`, `content`, `created_at`.
- **참조:** `feedback_id` → [`FEEDBACK`](tables.md#feedback).`id`; `actor_id` → [`MEMBER`](tables.md#member).`id` (선택).
- **제약·한계:** 제보 원문 삭제 금지. 철회로 수정안·반영 원고 자동 삭제/revert 금지. 댓글 수정·삭제와 구분.
- **연결 예시:** `id=1; feedback_id=feedback-1; actor_id=member-1; action=종류/상태의 예시값`처럼 한 관계·사건을 기록합니다(가상 예시; 상태 enum 미확정).

<a id="feedback-status-event"></a>
### `FEEDBACK_STATUS_EVENT`

- **역할·범위:** 접수·분석·실패·작가 검토·실제 처리 상태의 변화입니다. **MVP**.
- **그림의 필드:** `id`(PK), `feedback_id`, `actor_id`, `ai_job_id`, `status`, `created_at`.
- **참조:** `feedback_id` → [`FEEDBACK`](tables.md#feedback).`id`; `actor_id` → [`MEMBER`](tables.md#member).`id` (선택); `ai_job_id` → [`AI_JOB`](tables.md#ai-job).`id` (선택).
- **제약·한계:** 검토중·실패를 완료로 표시 금지. 최신 상태는 이력에서 유도.
- **연결 예시:** `id=1; feedback_id=feedback-1; actor_id=member-1; ai_job_id=ai_job-1`처럼 한 관계·사건을 기록합니다(가상 예시; 상태 enum 미확정).

<a id="feedback-ai-job"></a>
### `FEEDBACK_AI_JOB`

- **역할·범위:** 제보마다 수행한 AI 검토·재시도를 연결합니다. **MVP 이후**.
- **그림의 필드:** `feedback_id`(PK), `job_id`(PK), `purpose`.
- **참조:** `feedback_id` → [`FEEDBACK`](tables.md#feedback).`id`; `job_id` → [`AI_JOB`](tables.md#ai-job).`id`.
- **제약·한계:** 작업별 결과 보존. 댓글·제안·스토리 오류를 UC-15에서 임의 AI 분류/응대하지 않음.
- **연결 예시:** `feedback_id=feedback-1; job_id=ai_job-1`처럼 한 관계·사건을 기록합니다(가상 예시; 상태 enum 미확정).

<a id="feedback-response"></a>
### `FEEDBACK_RESPONSE`

- **역할·범위:** AI 또는 작가의 응답과 독립된 공개 선택입니다. **MVP 이후**.
- **그림의 필드:** `id`(PK), `feedback_id`, `ai_job_id`, `author_id`, `content`, `is_public`, `created_at`.
- **참조:** `feedback_id` → [`FEEDBACK`](tables.md#feedback).`id`; `ai_job_id` → [`AI_JOB`](tables.md#ai-job).`id` (선택); `author_id` → [`MEMBER`](tables.md#member).`id` (선택).
- **제약·한계:** AI 작업 또는 작가 중 하나의 출처. 응답 공개가 비공개 제보 원문 공개가 아님.
- **연결 예시:** `id=1; feedback_id=feedback-1; ai_job_id=ai_job-1; author_id=member-1`처럼 한 관계·사건을 기록합니다(가상 예시; 상태 enum 미확정).

<a id="feedback-response-evidence"></a>
### `FEEDBACK_RESPONSE_EVIDENCE`

- **역할·범위:** 응답의 복수 근거와 당시 인용을 연결합니다. **MVP 이후**.
- **그림의 필드:** `response_id`(PK), `evidence_id`(PK).
- **참조:** `response_id` → [`FEEDBACK_RESPONSE`](tables.md#feedback-response).`id`; `evidence_id` → [`AI_EVIDENCE`](tables.md#ai-evidence).`id`.
- **제약·한계:** 응답 당시 근거 보존. 읽은 회차 뒤는 이미 공개됐어도 사용 금지.
- **연결 예시:** `response_id=feedback_response-1; evidence_id=ai_evidence-1`처럼 한 관계·사건을 기록합니다(가상 예시; 상태 enum 미확정).

<a id="feedback-comment"></a>
### `FEEDBACK_COMMENT`

- **역할·범위:** 공개 제보에 대한 다른 독자의 추가 토론 댓글입니다. **전체·범위확인**.
- **그림의 필드:** `id`(PK), `feedback_id`, `author_id`, `content`, `created_at`.
- **참조:** `feedback_id` → [`FEEDBACK`](tables.md#feedback).`id`; `author_id` → [`MEMBER`](tables.md#member).`id` (선택).
- **제약·한계:** 해당 제보 공개·독자 열람권한 필요. 토론 댓글은 별도 작성자·수명주기.
- **연결 예시:** `id=1; feedback_id=feedback-1; author_id=member-1; content=당시 허용된 내용`처럼 한 관계·사건을 기록합니다(가상 예시; 상태 enum 미확정).

<a id="feedback-verification"></a>
### `FEEDBACK_VERIFICATION`

- **역할·범위:** 개인 검증과 삭제 수명이 다른 제출 결과 스냅샷입니다. **MVP 이후**.
- **그림의 필드:** `id`(PK), `feedback_id`(UK), `comment_id`(UK), `original_job_id`, `outcome`, `verdict`, `confidence`, `result_snapshot`, `submitted_at`.
- **참조:** `feedback_id` → [`FEEDBACK`](tables.md#feedback).`id` (선택); `comment_id` → [`FEEDBACK_COMMENT`](tables.md#feedback-comment).`id` (선택); `original_job_id` → [`AI_JOB`](tables.md#ai-job).`id` (선택).
- **제약·한계:** 제보 또는 토론 댓글 중 정확히 하나. non-NULL feedback_id와 comment_id 각각 조건부 UNIQUE로 대상당 최대1 보장. 다중 제출 확대는 미정. original_job_id 삭제 시 NULL 가능, 스냅샷은 보존.
- **연결 예시:** `id=1; feedback_id=feedback-1; comment_id=feedback_comment-1; original_job_id=ai_job-1`처럼 한 관계·사건을 기록합니다(가상 예시; 상태 enum 미확정).

<a id="feedback-verification-evidence"></a>
### `FEEDBACK_VERIFICATION_EVIDENCE`

- **역할·범위:** 제출한 검증의 근거들을 개인 AI 기록과 독립 보존합니다. **MVP 이후**.
- **그림의 필드:** `id`(PK), `verification_id`, `sequence`, `episode_version_id`, `setting_version_id`, `graph_state_ref`, `position`, `excerpt_snapshot`.
- **참조:** `verification_id` → [`FEEDBACK_VERIFICATION`](tables.md#feedback-verification).`id`; `episode_version_id` → [`EPISODE_VERSION`](tables.md#episode-version).`id` (선택); `setting_version_id` → [`SETTING_VERSION`](tables.md#setting-version).`id` (선택).
- **제약·한계:** UNIQUE(verification_id,sequence). 종류별 출처 정확히 하나. 개인 근거 삭제와 연쇄 삭제 금지. 권한별 접근 재확인.
- **연결 예시:** `id=1; verification_id=feedback_verification-1; sequence=2; episode_version_id=episode_version-1`처럼 한 관계·사건을 기록합니다(가상 예시; 상태 enum 미확정).

<a id="feedback-report"></a>
### `FEEDBACK_REPORT`

- **역할·범위:** 댓글 유해 신고의 신고자·사유별 접수입니다. **MVP 이후**.
- **그림의 필드:** `id`(PK), `feedback_id`, `reporter_id`, `reason`, `created_at`.
- **참조:** `feedback_id` → [`FEEDBACK`](tables.md#feedback).`id`; `reporter_id` → [`MEMBER`](tables.md#member).`id`.
- **제약·한계:** 신고 접수와 모델 검사·숨김 결정은 별개. 회차/세계관 권리 신고는 RIGHTS_REPORT.
- **연결 예시:** `id=1; feedback_id=feedback-1; reporter_id=member-1`처럼 한 관계·사건을 기록합니다(가상 예시; 상태 enum 미확정).

<a id="feedback-moderation-check"></a>
### `FEEDBACK_MODERATION_CHECK`

- **역할·범위:** 반복되는 필터·재검사 실행의 판정 결과입니다. **MVP 이후**.
- **그림의 필드:** `id`(PK), `feedback_id`, `job_id`, `report_id`, `outcome`, `verdict`, `reason`, `checked_at`.
- **참조:** `feedback_id` → [`FEEDBACK`](tables.md#feedback).`id`; `job_id` → [`AI_JOB`](tables.md#ai-job).`id`; `report_id` → [`FEEDBACK_REPORT`](tables.md#feedback-report).`id` (선택).
- **제약·한계:** 실패를 통과로 치환 금지. 초기 필터 실패는 비공개 대기 후 재검사.
- **연결 예시:** `id=1; feedback_id=feedback-1; job_id=ai_job-1; report_id=feedback_report-1`처럼 한 관계·사건을 기록합니다(가상 예시; 상태 enum 미확정).

<a id="feedback-moderation"></a>
### `FEEDBACK_MODERATION`

- **역할·범위:** 모델 판정 또는 사람 검토에 따른 숨김·복원의 실제 조치 이력입니다. **MVP 이후**.
- **그림의 필드:** `id`(PK), `feedback_id`, `check_id`, `actor_id`, `action`, `outcome`, `reason`, `created_at`.
- **참조:** `feedback_id` → [`FEEDBACK`](tables.md#feedback).`id`; `check_id` → [`FEEDBACK_MODERATION_CHECK`](tables.md#feedback-moderation-check).`id` (선택); `actor_id` → [`MEMBER`](tables.md#member).`id` (선택).
- **제약·한계:** 검사 또는 권한 있는 작가·운영자 출처. 숨김은 삭제 아님; 같은 피드백 검사인지 검증.
- **연결 예시:** `id=1; feedback_id=feedback-1; check_id=feedback_moderation_check-1; actor_id=member-1`처럼 한 관계·사건을 기록합니다(가상 예시; 상태 enum 미확정).

<a id="feedback-like"></a>
### `FEEDBACK_LIKE`

- **역할·범위:** 피드백 댓글에 누른 회원별 좋아요입니다. **전체·범위확인**.
- **그림의 필드:** `feedback_id`(PK), `member_id`(PK), `created_at`.
- **참조:** `feedback_id` → [`FEEDBACK`](tables.md#feedback).`id`; `member_id` → [`MEMBER`](tables.md#member).`id`.
- **제약·한계:** 댓글에 적용, 회원 목록 비공개·개수만 공개.
- **연결 예시:** `feedback_id=feedback-1; member_id=member-1`처럼 한 관계·사건을 기록합니다(가상 예시; 상태 enum 미확정).

<a id="feedback-proposal"></a>
### `FEEDBACK_PROPOSAL`

- **역할·범위:** 한 수정 제안과 여러 제보의 연결입니다. **MVP 이후**.
- **그림의 필드:** `feedback_id`(PK), `proposal_id`(PK).
- **참조:** `feedback_id` → [`FEEDBACK`](tables.md#feedback).`id`; `proposal_id` → [`AI_PROPOSAL`](tables.md#ai-proposal).`id`.
- **제약·한계:** 같은 원고 대상 및 권한 일치. 제보 중복 자동 차단 금지.
- **연결 예시:** `feedback_id=feedback-1; proposal_id=ai_proposal-1`처럼 한 관계·사건을 기록합니다(가상 예시; 상태 enum 미확정).

<a id="feedback-review"></a>
### `FEEDBACK_REVIEW`

- **역할·범위:** 수정안이 없는 스토리 오류·제안도 포함한 작가 판단 이력입니다. **MVP 이후**.
- **그림의 필드:** `id`(PK), `feedback_id`, `actor_id`, `proposal_decision_id`, `decision`, `reason`, `created_at`.
- **참조:** `feedback_id` → [`FEEDBACK`](tables.md#feedback).`id`; `actor_id` → [`MEMBER`](tables.md#member).`id`; `proposal_decision_id` → [`PROPOSAL_DECISION`](tables.md#proposal-decision).`id` (선택).
- **제약·한계:** 승인 내용은 PROPOSAL_DECISION에만 보관. 동일 내용을 중복하지 않음. 검토 판단과 실제 반영·발행 분리.
- **연결 예시:** `id=1; feedback_id=feedback-1; actor_id=member-1; proposal_decision_id=proposal_decision-1`처럼 한 관계·사건을 기록합니다(가상 예시; 상태 enum 미확정).

<a id="feedback-resolution"></a>
### `FEEDBACK_RESOLUTION`

- **역할·범위:** 제보와 실제로 수정된 저장/발행 결과의 연결입니다. **MVP 이후**.
- **그림의 필드:** `id`(PK), `feedback_id`, `review_id`, `episode_version_id`, `publication_event_id`, `application_id`, `linked_at`.
- **참조:** `feedback_id` → [`FEEDBACK`](tables.md#feedback).`id`; `review_id` → [`FEEDBACK_REVIEW`](tables.md#feedback-review).`id`; `episode_version_id` → [`EPISODE_VERSION`](tables.md#episode-version).`id`; `publication_event_id` → [`PUBLICATION_EVENT`](tables.md#publication-event).`id` (선택); `application_id` → [`PROPOSAL_APPLICATION`](tables.md#proposal-application).`id` (선택).
- **제약·한계:** 모든 연결은 같은 제보·작품의 실제 결과. 작가 직접 수정은 application NULL. 발행 실패를 완료로 표시 금지.
- **연결 예시:** `id=1; feedback_id=feedback-1; review_id=feedback_review-1; episode_version_id=episode_version-1`처럼 한 관계·사건을 기록합니다(가상 예시; 상태 enum 미확정).

<a id="feedback-reward"></a>
### `FEEDBACK_REWARD`

- **역할·범위:** 보상 대상 수정과 제보·실제 지급의 연결입니다. **MVP 이후**.
- **그림의 필드:** `id`(PK), `resolution_id`, `credit_grant_id`(UK), `correction_key`(UK), `awarded_at`.
- **참조:** `resolution_id` → [`FEEDBACK_RESOLUTION`](tables.md#feedback-resolution).`id`; `credit_grant_id` → [`CREDIT_GRANT`](tables.md#credit-grant).`id`.
- **제약·한계:** 같은 수정의 최초 검증 제보 1개, 자기 작품 제외. correction_key 산정·월상한 값 미정. 지급분 참조로 수령자·금액 유도.
- **연결 예시:** `id=1; resolution_id=feedback_resolution-1; credit_grant_id=credit_grant-1`처럼 한 관계·사건을 기록합니다(가상 예시; 상태 enum 미확정).

## 자동 처리·자율 연재

[부분 ERD](core/automation.md) · 근거: [UC-18](../../usecase-spec/UC-18.md), [UC-24](../../usecase-spec/UC-24.md)

<a id="work-automation-version"></a>
### `WORK_AUTOMATION_VERSION`

- **역할·범위:** 작품 자동 처리의 설정과 소유자 승인 기준을 이력으로 보존합니다. **MVP 이후**.
- **그림의 필드:** `id`(PK), `work_id`, `revision_no`, `world_update_mode`, `proofreading_mode`, `autoserial_state`, `changed_at`.
- **참조:** `work_id` → [`WORK`](tables.md#work).`id`.
- **제약·한계:** UNIQUE(work_id,revision_no). 기본 수동·작가검토·끔. Fork는 원작 설정 미상속. 자동 설정 업데이트는 최신 DEC-36과의 재정리 전 활성화 확정 아님.
- **연결 예시:** `id=1; work_id=work-1; revision_no=2`처럼 한 관계·사건을 기록합니다(가상 예시; 상태 enum 미확정).

<a id="autoserial-config-version"></a>
### `AUTOSERIAL_CONFIG_VERSION`

- **역할·범위:** 자율 연재에만 필요한 실행 분량·방향·비용 상한입니다. **MVP 이후**.
- **그림의 필드:** `automation_version_id`(PK), `target_length`, `direction`, `use_reader_reactions`, `cost_limit`.
- **참조:** `automation_version_id` → [`WORK_AUTOMATION_VERSION`](tables.md#work-automation-version).`id`.
- **제약·한계:** 상한의 회당/월간 범위 미정. 일반 채팅·검증 상한으로 확대 금지. 실행은 이 불변 버전 고정.
- **연결 예시:** `automation_version_id=work_automation_version-1`처럼 한 관계·사건을 기록합니다(가상 예시; 상태 enum 미확정).

<a id="autoserial-slot"></a>
### `AUTOSERIAL_SLOT`

- **역할·범위:** 설정 버전의 반복 요일·시각을 개별 행으로 분리합니다. **MVP 이후**.
- **그림의 필드:** `config_version_id`(PK), `weekday`(PK), `local_time`.
- **참조:** `config_version_id` → [`AUTOSERIAL_CONFIG_VERSION`](tables.md#autoserial-config-version).`automation_version_id`.
- **제약·한계:** 요일 0~6, KST, 주1~7회·하루최대1회. 동일 요일 중복 금지.
- **연결 예시:** `config_version_id=autoserial_config_version-1; weekday=1`처럼 한 관계·사건을 기록합니다(가상 예시; 상태 enum 미확정).

<a id="autoserial-run"></a>
### `AUTOSERIAL_RUN`

- **역할·범위:** 예정 실행 한 번의 조건·생성·발행 결과를 연결합니다. **MVP 이후**.
- **그림의 필드:** `id`(PK), `config_version_id`, `scheduled_task_item_id`, `ai_job_id`, `generated_version_id`, `publication_event_id`, `scheduled_at`, `status`, `reason`.
- **참조:** `config_version_id` → [`AUTOSERIAL_CONFIG_VERSION`](tables.md#autoserial-config-version).`automation_version_id`; `scheduled_task_item_id` → [`SCHEDULED_TASK_ITEM`](tables.md#scheduled-task-item).`id` (선택); `ai_job_id` → [`AI_JOB`](tables.md#ai-job).`id` (선택); `generated_version_id` → [`EPISODE_VERSION`](tables.md#episode-version).`id` (선택); `publication_event_id` → [`PUBLICATION_EVENT`](tables.md#publication-event).`id` (선택).
- **제약·한계:** UNIQUE(config_version_id,scheduled_at). 생성과 발행 성공 구분. 1시간 초과 지연은 건너뜀, 연속 실패 미포함. 실행 삭제는 원고 삭제 아님.
- **연결 예시:** `id=1; config_version_id=autoserial_config_version-1; scheduled_task_item_id=scheduled_task_item-1; ai_job_id=ai_job-1`처럼 한 관계·사건을 기록합니다(가상 예시; 상태 enum 미확정).

## 크레딧·구독·저장 한도

[부분 ERD](core/credit.md) · 근거: [UC-17](../../usecase-spec/UC-17.md), [UC-19](../../usecase-spec/UC-19.md)

<a id="ai-cost-consent"></a>
### `AI_COST_CONSENT`

- **역할·범위:** 실행 또는 자동 설정에 대한 예상 비용·부담 주체 안내와 동의입니다. **MVP 이후**.
- **그림의 필드:** `id`(PK), `member_id`, `job_id`, `automation_version_id`, `estimated_credits`, `scope_snapshot`, `decision`, `recorded_at`.
- **참조:** `member_id` → [`MEMBER`](tables.md#member).`id`; `job_id` → [`AI_JOB`](tables.md#ai-job).`id` (선택); `automation_version_id` → [`WORK_AUTOMATION_VERSION`](tables.md#work-automation-version).`id` (선택).
- **제약·한계:** 직접 작업 또는 자동 설정 중 하나. 예상 비용은 실제 차감액·일반 사용자 상한 아님. 예약 테이블 없음.
- **연결 예시:** `id=1; member_id=member-1; job_id=ai_job-1; automation_version_id=work_automation_version-1`처럼 한 관계·사건을 기록합니다(가상 예시; 상태 enum 미확정).

<a id="subscription-plan"></a>
### `SUBSCRIPTION_PLAN`

- **역할·범위:** 구독 상품 식별입니다. **MVP 이후**.
- **그림의 필드:** `id`(PK), `name`, `monthly_credits`, `price`, `currency`, `effective_at`.
- **참조:** 다른 업무 테이블의 FK 없음.
- **제약·한계:** 하나의 행은 계약 시점 상품 조건. 변경 조건은 새 행 후보. 플랜·가격·해지 정책은 미정이며 별도 상품 버전·결제사 인프라를 선제 추가하지 않음.
- **연결 예시:** `id=1; name=푸른 왕국`처럼 한 관계·사건을 기록합니다(가상 예시; 상태 enum 미확정).

<a id="member-subscription"></a>
### `MEMBER_SUBSCRIPTION`

- **역할·범위:** 회원의 구독 계약과 시작·종료 상태입니다. **MVP 이후**.
- **그림의 필드:** `id`(PK), `member_id`, `plan_id`, `status`, `started_at`, `ended_at`.
- **참조:** `member_id` → [`MEMBER`](tables.md#member).`id`; `plan_id` → [`SUBSCRIPTION_PLAN`](tables.md#subscription-plan).`id`.
- **제약·한계:** 변경·해지 정책 미정. 결제 완료와 크레딧 지급을 혼동하지 않음.
- **연결 예시:** `id=1; member_id=member-1; plan_id=subscription_plan-1; status=종류/상태의 예시값`처럼 한 관계·사건을 기록합니다(가상 예시; 상태 enum 미확정).

<a id="subscription-period"></a>
### `SUBSCRIPTION_PERIOD`

- **역할·범위:** 구독별 월 지급 기간을 분리합니다. **MVP 이후**.
- **그림의 필드:** `id`(PK), `subscription_id`, `period_start`, `period_end`.
- **참조:** `subscription_id` → [`MEMBER_SUBSCRIPTION`](tables.md#member-subscription).`id`.
- **제약·한계:** UNIQUE(subscription_id,period_start). 월 지급 중복 금지·KST 월간 초기화. 해지/중도 가입 계산 미정.
- **연결 예시:** `id=1; subscription_id=member_subscription-1`처럼 한 관계·사건을 기록합니다(가상 예시; 상태 enum 미확정).

<a id="credit-purchase"></a>
### `CREDIT_PURCHASE`

- **역할·범위:** 추가 크레딧 구매 요청과 실제 구매 상태입니다. **MVP 이후**.
- **그림의 필드:** `id`(PK), `subscription_id`, `quantity`, `status`, `requested_at`, `completed_at`.
- **참조:** `subscription_id` → [`MEMBER_SUBSCRIPTION`](tables.md#member-subscription).`id`.
- **제약·한계:** 구매자는 구독에서 유도. 당시 구독유효·구독크레딧 소진 확인. 결제사·거래/환불 정책 미정.
- **연결 예시:** `id=1; subscription_id=member_subscription-1; status=종류/상태의 예시값`처럼 한 관계·사건을 기록합니다(가상 예시; 상태 enum 미확정).

<a id="credit-grant"></a>
### `CREDIT_GRANT`

- **역할·범위:** 회원에게 지급한 크레딧을 지급분·종류·소멸일별로 구분합니다. **MVP 이후**.
- **그림의 필드:** `id`(PK), `member_id`, `subscription_period_id`, `purchase_id`, `kind`, `amount`, `granted_at`, `expires_at`.
- **참조:** `member_id` → [`MEMBER`](tables.md#member).`id`; `subscription_period_id` → [`SUBSCRIPTION_PERIOD`](tables.md#subscription-period).`id` (선택); `purchase_id` → [`CREDIT_PURCHASE`](tables.md#credit-purchase).`id` (선택).
- **제약·한계:** 양수, 유료 지급의 원인 관계 일치. 가입 체험 회원당1회, 월 지급·구매당 지급 중복 금지. 잔액은 장부에서 산출.
- **연결 예시:** `id=1; member_id=member-1; subscription_period_id=subscription_period-1; purchase_id=credit_purchase-1`처럼 한 관계·사건을 기록합니다(가상 예시; 상태 enum 미확정).

<a id="credit-settlement"></a>
### `CREDIT_SETTLEMENT`

- **역할·범위:** AI 작업의 청구 대상·동의·정산 결과입니다. **MVP 이후**.
- **그림의 필드:** `id`(PK), `job_id`(UK), `consent_id`, `payer_member_id`, `payer_kind`, `status`, `settled_at`.
- **참조:** `job_id` → [`AI_JOB`](tables.md#ai-job).`id`; `consent_id` → [`AI_COST_CONSENT`](tables.md#ai-cost-consent).`id` (선택); `payer_member_id` → [`MEMBER`](tables.md#member).`id` (선택).
- **제약·한계:** 회원/플랫폼 부담을 구분. 사용자 오류·시간초과 실패 차감0, 공급자 비용은 별도. 미보고는 미정산. 예약 없음. 회원 차감의 consent는 해당 작업 또는 그 실행을 승인한 자동설정과 동일 부담회원에 속해야 함; 플랫폼부담은 회원동의를 다른 회원의 차감근거로 재사용하지 않음.
- **연결 예시:** `id=1; job_id=ai_job-1; consent_id=ai_cost_consent-1; payer_member_id=member-1`처럼 한 관계·사건을 기록합니다(가상 예시; 상태 enum 미확정).

<a id="credit-settlement-line"></a>
### `CREDIT_SETTLEMENT_LINE`

- **역할·범위:** 모델 호출별 실제 사용량에 적용한 환산율과 확정 차감액입니다. **MVP 이후**.
- **그림의 필드:** `id`(PK), `settlement_id`, `call_id`(UK), `input_rate`, `output_rate`, `charged_credits`.
- **참조:** `settlement_id` → [`CREDIT_SETTLEMENT`](tables.md#credit-settlement).`id`; `call_id` → [`AI_MODEL_CALL`](tables.md#ai-model-call).`id`.
- **제약·한계:** 호출은 정산 작업 소속. 환산율 스냅샷 불변·비음수. 정산 합계는 행 합계. 사용자 중단·초과잔액·동시성 정책 미정. 확정 차감액은 연결된 사용종류 장부의 차감 합계와 일치해야 함.
- **연결 예시:** `id=1; settlement_id=credit_settlement-1; call_id=ai_model_call-1`처럼 한 관계·사건을 기록합니다(가상 예시; 상태 enum 미확정).

<a id="credit-ledger-entry"></a>
### `CREDIT_LEDGER_ENTRY`

- **역할·범위:** 지급분별 사용·소멸·조정 내역입니다. 차감 할당을 별도 중복 테이블로 만들지 않습니다. **MVP 이후**.
- **그림의 필드:** `id`(PK), `grant_id`, `settlement_line_id`, `kind`, `amount`, `operation_key`(UK), `occurred_at`.
- **참조:** `grant_id` → [`CREDIT_GRANT`](tables.md#credit-grant).`id`; `settlement_line_id` → [`CREDIT_SETTLEMENT_LINE`](tables.md#credit-settlement-line).`id` (선택).
- **제약·한계:** 부호/종류 일치, 지급분 잔액 음수 방지 정책 구현 전 확정. 차감은 이른 소멸일·동률 무료 우선. 지급량−차감/소멸 합계로 잔액 산출; 실패작업 중복차감 금지. 회원 사용 차감은 grant.member_id=연결 정산의 payer_member_id를 강제하고 동의/작업 일치를 재검증; 다른 회원 지급분 차감 금지.
- **연결 예시:** `id=1; grant_id=credit_grant-1; settlement_line_id=credit_settlement_line-1; kind=종류/상태의 예시값`처럼 한 관계·사건을 기록합니다(가상 예시; 상태 enum 미확정).

<a id="storage-quota"></a>
### `STORAGE_QUOTA`

- **역할·범위:** 회원 저장 한도 후보. 사용량은 소유·참조 콘텐츠에서 조회합니다. **MVP 이후**.
- **그림의 필드:** `member_id`(PK), `limit_bytes`, `updated_at`.
- **참조:** `member_id` → [`MEMBER`](tables.md#member).`id`.
- **제약·한계:** 한도 값·이미지/과거버전 집계·복사시 용량부족 미정. AI 기록 제외. 자동 콘텐츠 삭제 금지.
- **연결 예시:** `member_id=member-1`처럼 한 관계·사건을 기록합니다(가상 예시; 상태 enum 미확정).

## 권리 신고·판정·제한

[부분 ERD](core/rights.md) · 근거: [UC-20](../../usecase-spec/UC-20.md), [UC-23](../../usecase-spec/UC-23.md)

<a id="rights-case"></a>
### `RIGHTS_CASE`

- **역할·범위:** 같은 사안으로 묶은 권리·유해 콘텐츠 검토 건입니다. **전체·범위확인**.
- **그림의 필드:** `id`(PK), `kind`, `status`, `opened_at`, `first_reviewed_at`.
- **참조:** 다른 업무 테이블의 FK 없음.
- **제약·한계:** 저작권 접수/권리자 확인은 침해판정·자동비공개 아님. AI 묶음의 운영자 수정 절차 미정.
- **연결 예시:** `id=1; kind=종류/상태의 예시값; status=종류/상태의 예시값`처럼 한 관계·사건을 기록합니다(가상 예시; 상태 enum 미확정).

<a id="rights-report"></a>
### `RIGHTS_REPORT`

- **역할·범위:** 묶음 안에서도 보존할 개별 신고자·접수·근거 설명입니다. **전체·범위확인**.
- **그림의 필드:** `id`(PK), `case_id`, `reporter_id`, `receipt_no`(UK), `contact`, `grounds`, `submitted_at`.
- **참조:** `case_id` → [`RIGHTS_CASE`](tables.md#rights-case).`id`; `reporter_id` → [`MEMBER`](tables.md#member).`id`.
- **제약·한계:** 연락처는 접수 당시 연락처이며 신고자 외부 노출 금지. 기각과 허위판정 구분.
- **연결 예시:** `id=1; case_id=rights_case-1; reporter_id=member-1`처럼 한 관계·사건을 기록합니다(가상 예시; 상태 enum 미확정).

<a id="rights-case-target"></a>
### `RIGHTS_CASE_TARGET`

- **역할·범위:** 한 검토 건의 원대상·조치되는 파생 대상입니다. **전체·범위확인**.
- **그림의 필드:** `id`(PK), `case_id`, `work_id`, `episode_id`, `world_id`, `setting_document_id`, `target_role`.
- **참조:** `case_id` → [`RIGHTS_CASE`](tables.md#rights-case).`id`; `work_id` → [`WORK`](tables.md#work).`id` (선택); `episode_id` → [`EPISODE`](tables.md#episode).`id` (선택); `world_id` → [`WORLD`](tables.md#world).`id` (선택); `setting_document_id` → [`SETTING_DOCUMENT`](tables.md#setting-document).`id` (선택).
- **제약·한계:** 네 대상 FK 중 정확히 하나. 사건/대상 중복금지. 세계관 신고의 파급 범위 미정. FK는 권한 판정이 아님.
- **연결 예시:** `id=1; case_id=rights_case-1; work_id=work-1; episode_id=episode-1`처럼 한 관계·사건을 기록합니다(가상 예시; 상태 enum 미확정).

<a id="rights-report-target"></a>
### `RIGHTS_REPORT_TARGET`

- **역할·범위:** 각 개별 신고가 지목한 대상들을 묶음 검토 대상과 연결합니다. **전체·범위확인**.
- **그림의 필드:** `report_id`(PK), `case_target_id`(PK).
- **참조:** `report_id` → [`RIGHTS_REPORT`](tables.md#rights-report).`id`; `case_target_id` → [`RIGHTS_CASE_TARGET`](tables.md#rights-case-target).`id`.
- **제약·한계:** 신고와 대상이 같은 검토 건. 묶여도 원래 신고 대상 손실 금지.
- **연결 예시:** `report_id=rights_report-1; case_target_id=rights_case_target-1`처럼 한 관계·사건을 기록합니다(가상 예시; 상태 enum 미확정).

<a id="rights-defense"></a>
### `RIGHTS_DEFENSE`

- **역할·범위:** 대상 소유자의 소명 통지·기한·제출입니다. **전체·범위확인**.
- **그림의 필드:** `id`(PK), `case_target_id`, `owner_id`, `notified_at`, `due_at`, `extended_at`, `submitted_at`, `response`, `status`.
- **참조:** `case_target_id` → [`RIGHTS_CASE_TARGET`](tables.md#rights-case-target).`id`; `owner_id` → [`MEMBER`](tables.md#member).`id`.
- **제약·한계:** 7일·1회7일 연장. 미소명은 침해확정 아님. 여러 소유자를 한 응답 TEXT에 합치지 않음.
- **연결 예시:** `id=1; case_target_id=rights_case_target-1; owner_id=member-1; status=종류/상태의 예시값`처럼 한 관계·사건을 기록합니다(가상 예시; 상태 enum 미확정).

<a id="rights-evidence"></a>
### `RIGHTS_EVIDENCE`

- **역할·범위:** 신고/소명에 제출한 여러 증빙을 각각 보존합니다. **전체·범위확인**.
- **그림의 필드:** `id`(PK), `report_id`, `defense_id`, `evidence_url`, `description`, `submitted_at`.
- **참조:** `report_id` → [`RIGHTS_REPORT`](tables.md#rights-report).`id` (선택); `defense_id` → [`RIGHTS_DEFENSE`](tables.md#rights-defense).`id` (선택).
- **제약·한계:** 신고 또는 소명 중 하나. 접근제한·안전한 URL 처리. 법적 보존/삭제 의무 검토, 기간만으로 자동삭제 금지.
- **연결 예시:** `id=1; report_id=rights_report-1; defense_id=rights_defense-1`처럼 한 관계·사건을 기록합니다(가상 예시; 상태 enum 미확정).

<a id="rights-decision"></a>
### `RIGHTS_DECISION`

- **역할·범위:** 운영자의 침해 여부 및 처리 판단입니다. **전체·범위확인**.
- **그림의 필드:** `id`(PK), `case_id`, `operator_id`, `conclusion`, `reason`, `decided_at`.
- **참조:** `case_id` → [`RIGHTS_CASE`](tables.md#rights-case).`id`; `operator_id` → [`MEMBER`](tables.md#member).`id`.
- **제약·한계:** 실제 운영 권한 확인. 법적 판단을 AI 결과로 대체하지 않음.
- **연결 예시:** `id=1; case_id=rights_case-1; operator_id=member-1`처럼 한 관계·사건을 기록합니다(가상 예시; 상태 enum 미확정).

<a id="content-moderation-assessment"></a>
### `CONTENT_MODERATION_ASSESSMENT`

- **역할·범위:** 신고 대상의 유해 모델 재검사 결과입니다. **전체·범위확인**.
- **그림의 필드:** `id`(PK), `target_id`, `ai_job_id`, `outcome`, `verdict`, `assessed_at`.
- **참조:** `target_id` → [`RIGHTS_CASE_TARGET`](tables.md#rights-case-target).`id`; `ai_job_id` → [`AI_JOB`](tables.md#ai-job).`id`.
- **제약·한계:** 유해 판정시 자동숨김 방향. 성인등급≠금지콘텐츠. 모델실패·오판 공개상태 상세 미정.
- **연결 예시:** `id=1; target_id=rights_case_target-1; ai_job_id=ai_job-1; outcome=종류/상태의 예시값`처럼 한 관계·사건을 기록합니다(가상 예시; 상태 enum 미확정).

<a id="content-restriction"></a>
### `CONTENT_RESTRICTION`

- **역할·범위:** 한 원인으로 한 대상에 적용하는 제한과 해제입니다. **전체·범위확인**.
- **그림의 필드:** `id`(PK), `target_id`, `decision_id`, `assessment_id`, `restriction_kind`, `created_at`, `lifted_at`.
- **참조:** `target_id` → [`RIGHTS_CASE_TARGET`](tables.md#rights-case-target).`id`; `decision_id` → [`RIGHTS_DECISION`](tables.md#rights-decision).`id` (선택); `assessment_id` → [`CONTENT_MODERATION_ASSESSMENT`](tables.md#content-moderation-assessment).`id` (선택).
- **제약·한계:** 운영판정 또는 유해검사 중 하나의 원인. 대상과 사건 일치. 다른 활성제한이 남으면 공개 복원 금지.
- **연결 예시:** `id=1; target_id=rights_case_target-1; decision_id=rights_decision-1; assessment_id=content_moderation_assessment-1`처럼 한 관계·사건을 기록합니다(가상 예시; 상태 enum 미확정).

<a id="restriction-application"></a>
### `RESTRICTION_APPLICATION`

- **역할·범위:** 제한·해제의 실제 적용 시도와 적용 전 상태입니다. **전체·범위확인**.
- **그림의 필드:** `id`(PK), `restriction_id`, `action`, `before_state`, `outcome`, `failure_reason`, `attempted_at`.
- **참조:** `restriction_id` → [`CONTENT_RESTRICTION`](tables.md#content-restriction).`id`.
- **제약·한계:** 판정 완료와 실제 적용 완료 분리. 실패 경고. 하위 Fork도 대상별 적용결과 보존.
- **연결 예시:** `id=1; restriction_id=content_restriction-1; action=종류/상태의 예시값; outcome=종류/상태의 예시값`처럼 한 관계·사건을 기록합니다(가상 예시; 상태 enum 미확정).

<a id="false-report-finding"></a>
### `FALSE_REPORT_FINDING`

- **역할·범위:** 운영자가 명시적으로 허위라고 판단한 신고 기록입니다. **전체·범위확인**.
- **그림의 필드:** `report_id`(PK), `operator_id`, `reason`, `decided_at`.
- **참조:** `report_id` → [`RIGHTS_REPORT`](tables.md#rights-report).`id`; `operator_id` → [`MEMBER`](tables.md#member).`id`.
- **제약·한계:** 단순 기각으로 자동 생성 금지. 누적 기간·정정 규칙 미정.
- **연결 예시:** `report_id=rights_report-1; operator_id=member-1`처럼 한 관계·사건을 기록합니다(가상 예시; 상태 enum 미확정).

<a id="reporting-restriction"></a>
### `REPORTING_RESTRICTION`

- **역할·범위:** 회원 신고 기능의 제한 기간과 원인입니다. **전체·범위확인**.
- **그림의 필드:** `id`(PK), `member_id`, `starts_at`, `ends_at`, `reason`.
- **참조:** `member_id` → [`MEMBER`](tables.md#member).`id`.
- **제약·한계:** 명시적 허위3회시30일. 제보 창작 권한 전체 차단으로 확대 금지.
- **연결 예시:** `id=1; member_id=member-1`처럼 한 관계·사건을 기록합니다(가상 예시; 상태 enum 미확정).

<a id="reporting-restriction-finding"></a>
### `REPORTING_RESTRICTION_FINDING`

- **역할·범위:** 신고 제한을 일으킨 허위 판단들을 연결합니다. **전체·범위확인**.
- **그림의 필드:** `restriction_id`(PK), `finding_id`(PK).
- **참조:** `restriction_id` → [`REPORTING_RESTRICTION`](tables.md#reporting-restriction).`id`; `finding_id` → [`FALSE_REPORT_FINDING`](tables.md#false-report-finding).`report_id`.
- **제약·한계:** 해당 회원이 제출한 신고의 판단만 연결. 단순 누적 숫자만으로 근거 유실 금지.
- **연결 예시:** `restriction_id=reporting_restriction-1; finding_id=false_report_finding-1`처럼 한 관계·사건을 기록합니다(가상 예시; 상태 enum 미확정).

## 운영·알림·정기 작업

[부분 ERD](core/operations.md) · 근거: [UC-21](../../usecase-spec/UC-21.md), [UC-27](../../usecase-spec/UC-27.md), [UC-28](../../usecase-spec/UC-28.md)

<a id="scheduled-task-run"></a>
### `SCHEDULED_TASK_RUN`

- **역할·범위:** 정기 작업 실행 한 번의 예정·시작·종료와 재실행 계보입니다. **전체·범위확인**.
- **그림의 필드:** `id`(PK), `retry_of_run_id`, `requested_by`, `kind`, `scheduled_at`, `started_at`, `finished_at`, `outcome`.
- **참조:** `retry_of_run_id` → [`SCHEDULED_TASK_RUN`](tables.md#scheduled-task-run).`id` (선택); `requested_by` → [`MEMBER`](tables.md#member).`id` (선택).
- **제약·한계:** 원실행·재실행 별도, 0건 성공도 실행행 존재. 집계 건수는 대상행에서 유도. 사용자 AI 자동재실행 금지.
- **연결 예시:** `id=1; retry_of_run_id=scheduled_task_run-1; requested_by=member-1; kind=종류/상태의 예시값`처럼 한 관계·사건을 기록합니다(가상 예시; 상태 enum 미확정).

<a id="scheduled-task-item"></a>
### `SCHEDULED_TASK_ITEM`

- **역할·범위:** 실행별 대상 처리 결과 및 실패 이유입니다. **전체·범위확인**.
- **그림의 필드:** `id`(PK), `run_id`, `prior_item_id`, `withdrawal_id`, `credit_grant_id`, `defense_id`, `case_id`, `reporting_restriction_id`, `publication_schedule_id`, `feedback_id`, `ai_job_id`, `autoserial_config_id`, `window_start`, `window_end`, `operation_key`, `outcome`, `failure_reason`, `processed_at`, `publication_event_id`.
- **참조:** `run_id` → [`SCHEDULED_TASK_RUN`](tables.md#scheduled-task-run).`id`; `prior_item_id` → [`SCHEDULED_TASK_ITEM`](tables.md#scheduled-task-item).`id` (선택); `withdrawal_id` → [`ACCOUNT_WITHDRAWAL`](tables.md#account-withdrawal).`id` (선택); `credit_grant_id` → [`CREDIT_GRANT`](tables.md#credit-grant).`id` (선택); `defense_id` → [`RIGHTS_DEFENSE`](tables.md#rights-defense).`id` (선택); `case_id` → [`RIGHTS_CASE`](tables.md#rights-case).`id` (선택); `reporting_restriction_id` → [`REPORTING_RESTRICTION`](tables.md#reporting-restriction).`id` (선택); `publication_schedule_id` → [`PUBLICATION_SCHEDULE`](tables.md#publication-schedule).`id` (선택); `feedback_id` → [`FEEDBACK`](tables.md#feedback).`id` (선택); `ai_job_id` → [`AI_JOB`](tables.md#ai-job).`id` (선택); `autoserial_config_id` → [`AUTOSERIAL_CONFIG_VERSION`](tables.md#autoserial-config-version).`automation_version_id` (선택); `publication_event_id` → [`PUBLICATION_EVENT`](tables.md#publication-event).`id` (선택).
- **제약·한계:** 대상 FK 정확히 하나 또는 로그정리/집계용 기간 한 쌍. UNIQUE(run_id,operation_key). 재시도 동일 operation_key 유지, 성공 업무효과 최대1회. 실패 재시도 기록을 막는 전역 UNIQUE는 금지. publication_event_id는 예약 대상이 아닌 실제 실행 결과 FK이며 성공/실패와 맞아야 함.
- **연결 예시:** `id=1; run_id=scheduled_task_run-1; prior_item_id=scheduled_task_item-1; withdrawal_id=account_withdrawal-1`처럼 한 관계·사건을 기록합니다(가상 예시; 상태 enum 미확정).

<a id="operation-alert"></a>
### `OPERATION_ALERT`

- **역할·범위:** 기술 장애·권리 검토 지연·정기 작업 실패에 대한 운영 경고입니다. **전체·범위확인**.
- **그림의 필드:** `id`(PK), `ai_job_id`, `rights_case_id`, `scheduled_run_id`, `kind`, `status`, `created_at`, `checked_at`, `resolved_at`.
- **참조:** `ai_job_id` → [`AI_JOB`](tables.md#ai-job).`id` (선택); `rights_case_id` → [`RIGHTS_CASE`](tables.md#rights-case).`id` (선택); `scheduled_run_id` → [`SCHEDULED_TASK_RUN`](tables.md#scheduled-task-run).`id` (선택).
- **제약·한계:** 직접 원인 최대하나; 지표/알림전달 장애는 별도 종류. 확인≠해결. 우선1년보관(법률검토), 권리사건 보존에 전용 금지.
- **연결 예시:** `id=1; ai_job_id=ai_job-1; rights_case_id=rights_case-1; scheduled_run_id=scheduled_task_run-1`처럼 한 관계·사건을 기록합니다(가상 예시; 상태 enum 미확정).

<a id="operation-action"></a>
### `OPERATION_ACTION`

- **역할·범위:** 운영 경고에 대해 사람이 수행한 실제 조치의 이력입니다. **MVP**.
- **그림의 필드:** `id`(PK), `alert_id`, `operator_id`, `result`, `summary`, `created_at`.
- **참조:** `alert_id` → [`OPERATION_ALERT`](tables.md#operation-alert).`id`; `operator_id` → [`MEMBER`](tables.md#member).`id`.
- **제약·한계:** 운영자가 원고·피드백 답변 임의작성 권한을 얻는 것이 아님. 경고별 다중 조치.
- **연결 예시:** `id=1; alert_id=operation_alert-1; operator_id=member-1`처럼 한 관계·사건을 기록합니다(가상 예시; 상태 enum 미확정).

<a id="technical-error-log"></a>
### `TECHNICAL_ERROR_LOG`

- **역할·범위:** 개인 작업 결과와 수명이 다른 기술 진단 기록입니다. **전체·범위확인**.
- **그림의 필드:** `id`(PK), `ai_job_id`, `scheduled_run_id`, `alert_id`, `stage`, `error_code`, `safe_message`, `occurred_at`.
- **참조:** `ai_job_id` → [`AI_JOB`](tables.md#ai-job).`id` (선택); `scheduled_run_id` → [`SCHEDULED_TASK_RUN`](tables.md#scheduled-task-run).`id` (선택); `alert_id` → [`OPERATION_ALERT`](tables.md#operation-alert).`id` (선택).
- **제약·한계:** 90일 보관. 원고전문·개인정보·비밀값 제외. DB 테이블/기존 로그 저장소 선택은 미정.
- **연결 예시:** `id=1; ai_job_id=ai_job-1; scheduled_run_id=scheduled_task_run-1; alert_id=operation_alert-1`처럼 한 관계·사건을 기록합니다(가상 예시; 상태 enum 미확정).

<a id="notice-event"></a>
### `NOTICE_EVENT`

- **역할·범위:** 수신·묶음과 분리한 개별 알림 사건입니다. **전체·범위확인**.
- **그림의 필드:** `id`(PK), `ai_job_id`, `feedback_id`, `source_change_id`, `publication_event_id`, `rights_case_id`, `credit_grant_id`, `withdrawal_id`, `auth_session_id`, `alert_id`, `kind`, `safe_summary`, `occurred_at`.
- **참조:** `ai_job_id` → [`AI_JOB`](tables.md#ai-job).`id` (선택); `feedback_id` → [`FEEDBACK`](tables.md#feedback).`id` (선택); `source_change_id` → [`FORK_SOURCE_CHANGE`](tables.md#fork-source-change).`id` (선택); `publication_event_id` → [`PUBLICATION_EVENT`](tables.md#publication-event).`id` (선택); `rights_case_id` → [`RIGHTS_CASE`](tables.md#rights-case).`id` (선택); `credit_grant_id` → [`CREDIT_GRANT`](tables.md#credit-grant).`id` (선택); `withdrawal_id` → [`ACCOUNT_WITHDRAWAL`](tables.md#account-withdrawal).`id` (선택); `auth_session_id` → [`AUTH_SESSION`](tables.md#auth-session).`id` (선택); `alert_id` → [`OPERATION_ALERT`](tables.md#operation-alert).`id` (선택).
- **제약·한계:** 사건 종류별 원본 FK 하나. 원본 삭제후 참조NULL 가능하되 안전한 사건내용 보존. 생존 원본 없는 알림도 삭제되지 않음.
- **연결 예시:** `id=1; ai_job_id=ai_job-1; feedback_id=feedback-1; source_change_id=fork_source_change-1`처럼 한 관계·사건을 기록합니다(가상 예시; 상태 enum 미확정).

<a id="user-notice"></a>
### `USER_NOTICE`

- **역할·범위:** 회원에게 표시하는 알림 한 묶음과 읽음 상태입니다. **전체·범위확인**.
- **그림의 필드:** `id`(PK), `recipient_id`, `created_at`, `read_at`.
- **참조:** `recipient_id` → [`MEMBER`](tables.md#member).`id`.
- **제약·한계:** 회원 삭제전 보관. 묶음은 같은대상·종류; 시간창 미정. 전달됨/읽음/업무해결 별개.
- **연결 예시:** `id=1; recipient_id=member-1`처럼 한 관계·사건을 기록합니다(가상 예시; 상태 enum 미확정).

<a id="user-notice-event"></a>
### `USER_NOTICE_EVENT`

- **역할·범위:** 묶음 알림의 개별 사건들을 빠짐없이 연결합니다. **전체·범위확인**.
- **그림의 필드:** `notice_id`(PK), `event_id`(PK).
- **참조:** `notice_id` → [`USER_NOTICE`](tables.md#user-notice).`id`; `event_id` → [`NOTICE_EVENT`](tables.md#notice-event).`id`.
- **제약·한계:** 동일 회원·동일 사건 중복 알림 금지. 회원별 권한 필터, 삭제가 원본으로 전파되지 않음.
- **연결 예시:** `notice_id=user_notice-1; event_id=notice_event-1`처럼 한 관계·사건을 기록합니다(가상 예시; 상태 enum 미확정).

<a id="notice-preference"></a>
### `NOTICE_PREFERENCE`

- **역할·범위:** 회원이 끌 수 있는 종류별 알림 설정입니다. **전체·범위확인**.
- **그림의 필드:** `member_id`(PK), `kind`(PK), `enabled`.
- **참조:** `member_id` → [`MEMBER`](tables.md#member).`id`.
- **제약·한계:** 기본 모두켬, 권리·실패·크레딧·보안은 끌수없음. 꺼도 원본 변경제안 보존.
- **연결 예시:** `member_id=member-1; kind=1`처럼 한 관계·사건을 기록합니다(가상 예시; 상태 enum 미확정).

<a id="notice-delivery-attempt"></a>
### `NOTICE_DELIVERY_ATTEMPT`

- **역할·범위:** 알림 전달의 성공·실패·재시도를 읽음과 분리합니다. **전체·범위확인**.
- **그림의 필드:** `id`(PK), `notice_id`, `attempted_at`, `outcome`, `failure_reason`.
- **참조:** `notice_id` → [`USER_NOTICE`](tables.md#user-notice).`id`.
- **제약·한계:** 알림함만 지원. Redis 등 전달수단 미정; 전달 실패가 원래 업무결과를 되돌리지 않음.
- **연결 예시:** `id=1; notice_id=user_notice-1; outcome=종류/상태의 예시값`처럼 한 관계·사건을 기록합니다(가상 예시; 상태 enum 미확정).
