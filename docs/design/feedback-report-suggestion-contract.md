# 제보·수정 제안 계약 (기능 23·24)

기능표 23(제보 관리)·24(수정 제안·승인 관리)를 Content 공개 API와 실제 작품 화면에 연결하는 MVP 계약이다.
피드백 정책은 [UC-14](../usecase-spec/UC-14.md)·[UC-16](../usecase-spec/UC-16.md), 책임은 [DEC-41](service-boundaries.md) 기준 Content다.
AI 분석·응대·수정안 생성(기능 29)·유해 필터·보상은 이 계약 밖이며, 나중에 29가 만든 수정안도 24의 같은 저장·승인 경로를 쓴다.

## 결정 (2026-11-10 사용자 결정)

- AI 없이 사람이 등록·판단하는 흐름만 만든다. 23과 24는 서로 독립된 슬라이스로 병렬 구현하고(각각 워크스페이스·PR), 둘을 잇는 연결은 두 PR 병합 뒤 3절로 붙인다.
- 제보 상태: `unchecked`(작가 확인 전) → `checked`(확인함) → `answered`(답변함) → `resolved`(처리 완료) / `closed`(종료).
  정정·철회는 상태를 바꾸지 않고 원래 제보를 보존한 채 표시만 남긴다.
- 수정 제안 상태: `pending`(검토 대기) → `approved` / `rejected` / `held`(보류). 승인 뒤 반영 결과는 `applied`(초안에 반영됨) / `failed`(반영 실패)로 따로 기록한다.
- 승인은 기준 발행본이 그대로인지 확인한 뒤 **새 초안 버전**에 반영하며, 발행은 작가가 기존 발행 절차로 따로 한다(UC-16 6·7단계).
- 자동 표기 교정 범위 검사는 변경 전·후를 비교해 `auto`(자동 처리 가능)/`review`(작가 검토 필요)를 판정해 **표시만** 한다. 자동 승인·발행은 기능 30(작품 운영 설정)과 함께 한다.
- 화면은 기존 데모 화면을 실제 작품(`canonical`)에 연결한다: 회차 열람의 문장 피드백 시트, 내 제보 목록, 작가 피드백함(`InboxPage`). 메모리 데모 작품은 지금처럼 메모리로 동작한다.
- 공통: 쓰기는 로그인 회원만, 대상은 공개 작품(`WorkAccessResult.publiclyVisible()`)의 **발행 회차**(`EpisodeCurrentRepository.findByWorkIdAndSequence(id,n)?.publishedVersionId`)만이며 등록 시 그 발행 버전 ID를 고정 저장한다.
  작품 소유자 판단은 기존 `WorkAccessService`를 재사용한다. 작성자·작가 표시명은 저장하지 않고 응답마다 `CoreNicknameService`로 채운다(없으면 `탈퇴한 회원`, Core 실패는 503/504/502).
- 알림·이력 테이블·페이지네이션은 범위 밖이다(목록은 최대 200개).
- 경로는 기존 Security 규칙(`GET /api/v1/public/works/**` permitAll, `/api/v1/works/**` authenticated) 아래에 두어 Security·nginx·Vite 변경이 없다. 쓰기는 기존 CSRF 계약을 따른다.
  입력 검증(422)을 접근 판정(404/403)보다 먼저 한다. 문자열은 앞뒤 공백을 제거해 저장하고 U+0000을 거절한다.

## 1. 기능 23 제보 관리

### 저장

`backend/content-service/src/main/resources/db/migration/work/V24__feedback_report.sql`

```sql
CREATE TABLE feedback_report (
    id varchar(36) PRIMARY KEY,
    work_id varchar(36) NOT NULL REFERENCES work(id),
    episode_number integer NOT NULL CHECK (episode_number > 0),
    published_version_id varchar(36) NOT NULL REFERENCES episode_version(id),
    reporter_id varchar(200) NOT NULL,
    kind text NOT NULL CHECK (kind IN ('typo','story','question','suggestion')),
    body text NOT NULL,
    quote text,
    visibility text NOT NULL CHECK (visibility IN ('public','private')),
    status text NOT NULL CHECK (status IN ('unchecked','checked','answered','resolved','closed')),
    author_checked_at timestamptz,
    withdrawn_at timestamptz,
    created_at timestamptz NOT NULL,
    updated_at timestamptz NOT NULL
);
CREATE INDEX feedback_report_episode ON feedback_report (work_id, episode_number, created_at DESC);
CREATE INDEX feedback_report_reporter ON feedback_report (reporter_id, created_at DESC);
CREATE TABLE feedback_report_amendment (
    id varchar(36) PRIMARY KEY,
    report_id varchar(36) NOT NULL REFERENCES feedback_report(id),
    action text NOT NULL CHECK (action IN ('correct','withdraw')),
    body text,
    created_at timestamptz NOT NULL
);
CREATE TABLE feedback_report_response (
    id varchar(36) PRIMARY KEY,
    report_id varchar(36) NOT NULL REFERENCES feedback_report(id),
    author_id varchar(200) NOT NULL,
    body text NOT NULL,
    is_public boolean NOT NULL,
    created_at timestamptz NOT NULL
);
```

제보는 삭제하지 않는다(DEC-42 피드백 보존, 철회도 행을 지우지 않음).

### 규칙

- 유형 `kind`: `typo`(단순 오류)·`story`(스토리 오류)·`question`(질문)·`suggestion`(전개 제안). 독자가 고르며 재분류하지 않는다. 댓글은 기능 22 경로다.
- 공개 범위는 제보자가 고르며 기본 `private`. 제보자는 언제든 바꿀 수 있다(철회 후에도).
- 열람 권한: `private` 제보 = 제보자·작품 소유자만(그 외 404). `public` 제보 = 공개 작품 회차를 볼 수 있는 누구나(익명 포함).
- 정정: 제보자만, 철회 전에만(철회 후 409). 원문은 바꾸지 않고 `correct` 정정 기록을 추가한다(본문 1~500자).
- 철회: 제보자만, 한 번만(이미 철회면 409). `withdraw` 기록 + `withdrawn_at`. 상태와 원문은 그대로 두고 작가에게 "철회됨"을 표시한다.
- 작가 확인: 작품 소유자만. `author_checked_at`이 없으면 기록하고 `unchecked`면 `checked`로 바꾼다(멱등).
- 답변: 작품 소유자만. 본문 1~2000자, `isPublic`(기본 false). 답변하면 `unchecked`/`checked`는 `answered`가 된다(이미 `resolved`/`closed`면 그대로).
- 처리 상태 변경: 작품 소유자만, `checked`·`answered`·`resolved`·`closed` 중 아무 값으로나 바꿀 수 있다(`unchecked`로 되돌리기는 422).
- 공개 답변: 비공개 제보의 공개 답변은 공개 목록에 **제보 원문 없이** 답변만 노출한다(UC-14 공개 범위).
- 본문 1~500자(`isNotBlank`), 인용 0~500자. 자기 작품 제보도 허용한다.

### 응답

```json
{ "id": "uuid", "workId": "…", "workTitle": "…", "episodeNumber": 3, "publishedVersionId": "…",
  "kind": "typo", "body": "… 또는 비공개 원문 숨김 시 null", "quote": "… 또는 null", "visibility": "private",
  "status": "unchecked", "reporterName": "닉네임 또는 null(원문 숨김 시)", "mine": false, "owner": false,
  "authorChecked": false, "withdrawn": false,
  "amendments": [{ "action": "correct", "body": "…", "createdAt": "…" }],
  "responses": [{ "id": "…", "authorName": "…", "body": "…", "isPublic": true, "createdAt": "…" }],
  "createdAt": "…", "updatedAt": "…" }
```

`mine`=요청자가 제보자, `owner`=요청자가 작품 소유자. 원문을 볼 권한이 없는 비공개 제보(공개 답변만 노출)는 `body`·`quote`·`reporterName`·`amendments`가 `null`/빈 배열이고 `responses`에는 공개 답변만 담는다.
제보자·소유자는 비공개 답변까지 모두 본다.

### 공개 API

| 메서드·경로 | 인증 | 동작 |
|---|---|---|
| `POST /api/v1/works/{id}/episodes/{number}/feedback-reports` | 회원 | 본문 `{ kind, body, quote?, visibility? }` → 201 + `ReportResponse` |
| `GET /api/v1/public/works/{id}/episodes/{number}/feedback-reports` | 익명 허용(Bearer 선택) | 공개 제보 + 비공개 제보 중 공개 답변이 있는 것(원문 숨김) + Bearer가 있으면 내 비공개 제보·(소유자면) 모든 제보. `{ items }` 최신순 |
| `GET /api/v1/public/works/{id}/episodes/{number}/feedback-reports/{reportId}` | 익명 허용 | 상세. 볼 권한이 없으면 404 |
| `GET /api/v1/works/feedback-reports/mine` | 회원 | 내 제보 전체 `{ items }` 최신순 |
| `GET /api/v1/works/feedback-reports/inbox` | 회원 | 내가 소유한 모든 작품의 제보 `{ items }` 최신순 |
| `PUT /api/v1/works/{id}/feedback-reports/{reportId}/visibility` | 제보자 | `{ visibility }` → 200 |
| `POST /api/v1/works/{id}/feedback-reports/{reportId}/corrections` | 제보자 | `{ body }` → 200 |
| `POST /api/v1/works/{id}/feedback-reports/{reportId}/withdrawal` | 제보자 | 본문 없음 → 200 |
| `POST /api/v1/works/{id}/feedback-reports/{reportId}/check` | 소유자 | 200(멱등) |
| `POST /api/v1/works/{id}/feedback-reports/{reportId}/responses` | 소유자 | `{ body, isPublic? }` → 200 |
| `PUT /api/v1/works/{id}/feedback-reports/{reportId}/status` | 소유자 | `{ status }` → 200 |

쓰기 응답은 모두 갱신된 `ReportResponse`다. 경로의 작품과 제보가 맞지 않으면 404, 권한 없는 쓰기는 403(볼 수도 없는 비공개 제보면 404).
리터럴 경로(`feedback-reports/mine`·`inbox`)는 기존 `/works/interests`처럼 `/works/{id}`보다 먼저 매칭된다.

### 화면

- 실제 작품 회차 열람의 문장 선택 팝업에 `피드백`을 다시 보이고, 기존 데모 피드백 시트(유형 선택·본문·공개 범위)를 위 등록 API에 연결한다. 결과 안내는 실제 응답 상태만 표시한다(AI 응답 문구 없음).
- 회차의 공개 제보 목록(회차 하단 또는 시트 안 기존 자리)과 내 제보 목록(정정·철회·공개 범위 변경)을 실제 API에 연결한다.
- 작가 피드백함(`InboxPage`)의 제보 항목을 inbox API로 채우고 확인·답변(공개 여부)·상태 변경을 연결한다. 정정·철회 표시를 함께 보인다.
- 데모 작품은 기존 메모리 경로를 유지한다. 프런트는 `FeedbackReportRepository` interface + `HttpFeedbackReportRepository`를 새 파일로 만든다.

## 2. 기능 24 수정 제안·승인 관리

### 저장

`backend/content-service/src/main/resources/db/migration/work/V24__edit_suggestion.sql`

```sql
CREATE TABLE edit_suggestion (
    id varchar(36) PRIMARY KEY,
    work_id varchar(36) NOT NULL REFERENCES work(id),
    episode_number integer NOT NULL CHECK (episode_number > 0),
    published_version_id varchar(36) NOT NULL REFERENCES episode_version(id),
    proposer_id varchar(200) NOT NULL,
    source text NOT NULL CHECK (source IN ('reader','ai')),
    report_id varchar(36),
    before_text text NOT NULL,
    after_text text NOT NULL,
    edited_text text,
    reason text,
    status text NOT NULL CHECK (status IN ('pending','approved','rejected','held')),
    decision_reason text,
    apply_result text CHECK (apply_result IN ('applied','failed')),
    apply_failure text,
    applied_version_id varchar(36) REFERENCES episode_version(id),
    decided_at timestamptz,
    created_at timestamptz NOT NULL,
    updated_at timestamptz NOT NULL
);
CREATE INDEX edit_suggestion_work ON edit_suggestion (work_id, created_at DESC);
CREATE INDEX edit_suggestion_proposer ON edit_suggestion (proposer_id, created_at DESC);
```

`report_id`는 3절 연결용 선택 칸이며 이 슬라이스에서는 FK·값 검사 없이 항상 `null`로 저장한다. `source`는 이 슬라이스에서 항상 `reader`다.

### 규칙

- 등록: 로그인 회원(자기 작품 포함). `beforeText`(1~500자)는 고정한 발행 버전 본문에 **그대로 한 번 이상** 있어야 한다(없으면 422 `원문에서 고칠 문장을 찾을 수 없어요.`). `afterText` 1~500자, `beforeText`와 같으면 422. `reason` 0~500자.
- 열람: 제안자·작품 소유자만(그 외 404). 공개 목록은 없다.
- 편집안 저장: 소유자만, `pending`/`held`에서만. `editedText`(1~500자)를 저장하고 원래 `afterText`는 보존한다(UC-16 4단계). 승인 내용 = `editedText ?: afterText`.
- 승인: 소유자만, `pending`/`held`에서만(또는 `approved`+`failed`의 재시도).
  1. 회차의 현재 발행 버전이 제안의 `publishedVersionId`와 다르면 409 `기준 발행본이 바뀌어 다시 검토해야 해요.` — 상태를 바꾸지 않는다(CE-07).
  2. 현재 초안 본문에서 `beforeText`가 정확히 한 번 나오면 승인 내용으로 바꿔 기존 `EpisodeVersionService.save`(현재 초안 revision 사용)로 새 초안 버전을 만든다 → `approved`+`applied`+`appliedVersionId`.
  3. 초안에 없거나 여러 번 나오거나, Fork가 상속한 원작 회차라 초안을 고칠 수 없거나, 저장이 실패하면 → `approved`+`failed`+`applyFailure`(사유 문장). 반영 완료로 표시하지 않는다(UC-16 E2).
- 거절: 소유자만, `pending`/`held`에서만. 선택 사유 0~500자 → `rejected`(종결).
- 보류: 소유자만, `pending`에서만 → `held`. 같은 상태 전이를 반복하거나 종결 상태에서 바꾸면 409.
- 범위 검사(순수 함수 `EditScopePolicy`, 저장하지 않고 응답마다 계산): 승인 내용 기준으로
  공백·문장부호만 다르면 `auto`; 숫자가 바뀌면 `review`; 공백으로 나눈 단어 수가 같고 바뀐 단어마다 글자 편집 거리 1 이하(한 글자 오탈자)면 `auto`; 그 밖(단어 교체·추가·삭제)은 `review`. 판정 사유 문장 목록(`scopeReasons`)을 함께 준다.

### 응답

```json
{ "id": "uuid", "workId": "…", "workTitle": "…", "episodeNumber": 3, "publishedVersionId": "…",
  "source": "reader", "proposerName": "닉네임", "beforeText": "…", "afterText": "…", "editedText": null,
  "reason": null, "status": "pending", "decisionReason": null, "applyResult": null, "applyFailure": null,
  "appliedVersionId": null, "scope": "auto", "scopeReasons": ["띄어쓰기·문장부호만 바뀌어요."],
  "mine": true, "owner": false, "createdAt": "…", "updatedAt": "…" }
```

### 공개 API

| 메서드·경로 | 인증 | 동작 |
|---|---|---|
| `POST /api/v1/works/{id}/episodes/{number}/edit-suggestions` | 회원 | `{ beforeText, afterText, reason? }` → 201 + `SuggestionResponse` |
| `GET /api/v1/works/{id}/edit-suggestions/{suggestionId}` | 제안자·소유자 | 상세 |
| `GET /api/v1/works/edit-suggestions/mine` | 회원 | 내 제안 `{ items }` 최신순 |
| `GET /api/v1/works/edit-suggestions/inbox` | 회원 | 내 작품들의 제안 `{ items }` 최신순 |
| `PUT /api/v1/works/{id}/edit-suggestions/{suggestionId}/edited-text` | 소유자 | `{ editedText }` → 200 |
| `POST /api/v1/works/{id}/edit-suggestions/{suggestionId}/approval` | 소유자 | 200(반영 결과 포함) / 409 기준 변경 |
| `POST /api/v1/works/{id}/edit-suggestions/{suggestionId}/rejection` | 소유자 | `{ reason? }` → 200 |
| `POST /api/v1/works/{id}/edit-suggestions/{suggestionId}/hold` | 소유자 | 200 |

### 화면

- 실제 작품 회차 열람의 문장 선택 팝업에 `수정 제안`을 추가해, 선택 문장을 `beforeText`로 채우고 고친 문장·사유를 입력해 등록한다.
- 작가 피드백함(`InboxPage`)에 수정 제안 항목(변경 전·후 비교, 범위 검사 표시, 편집안 저장, 승인·거절·보류, 반영 결과·실패 사유)을 inbox API로 연결한다. 승인 후 안내는 "초안에 반영됨 — 발행은 집필실에서"처럼 발행과 구분한다.
- 내 제안 목록은 기존 내 제보 화면의 같은 목록 자리에 함께 보인다(상태만 읽기).
- 프런트는 `EditSuggestionRepository` interface + `HttpEditSuggestionRepository`를 새 파일로 만든다. 데모 작품의 기존 데모 수정 제안(메모리) 경로는 유지한다.

## 3. 연결 (23·24 병합 뒤)

- 피드백 시트에서 `단순 오류`를 고르면 `고친 문장`(선택) 칸을 보이고, 값이 있으면 제보 등록 직후 같은 문장으로 수정 제안을 `reportId`와 함께 등록한다.
- 다음 번호 마이그레이션으로 `edit_suggestion.report_id`에 `feedback_report(id)` FK를 건다. 등록 시 `reportId`는 같은 작품·회차의 본인 제보여야 한다(아니면 422).
- 연결된 제안이 `approved`+`applied`가 되면 제보 상태를 `resolved`로 바꾼다. 거절은 제보 상태를 바꾸지 않는다.
- 두 응답에 서로의 ID(`suggestionIds`/`reportId`)를 더해 피드백함에서 오갈 수 있게 한다.

## 공유 파일 소유

| 파일 | 23 | 24 |
|---|---|---|
| Content 새 패키지 | `ai.storyfork.content.feedbackreport` | `ai.storyfork.content.editsuggestion` |
| `ContentPersistenceConfig`·`ContentExceptionHandler` basePackages, 엔티티 패키지 고정 단언 테스트 | 자기 패키지 한 줄 추가 | 자기 패키지 한 줄 추가 |
| 회차 열람 화면·문장 선택 팝업 | `피드백` 항목·시트·제보 목록 | `수정 제안` 항목·시트 |
| `InboxPage`·ViewModel | 제보 항목 | 수정 제안 항목 |
| `registerAppServices` | 자기 Repository 한 줄 | 자기 Repository 한 줄 |

공유 파일은 자기 메서드·필드·항목만 추가하고 상대 슬라이스의 이름을 건드리지 않는다. 충돌은 나중에 병합되는 PR이 양쪽 보존으로 푼다.

## ponytail 한계

- 두 슬라이스의 V24 표기는 계획 번호다. PR #256이 V25로 먼저 병합됐고 #257은 V26으로 재번호했으므로 Content 전역에서 V24는 결번이며(`outOfOrder` 미사용) 채우지 않는다. 이 슬라이스들은 구현 때 그 시점의 다음 번호로 재번호하고 마이그레이션 개수 기대값을 갱신한다.
- 상태 변경 이력 테이블(`FEEDBACK_STATUS_EVENT`)·작가 판단 이력은 두지 않고 현재 상태와 시각만 둔다. 이력이 필요하면 이벤트 테이블을 추가한다.
- 범위 검사는 고유명사를 알지 못한다. 한 글자만 다른 이름 교체는 `auto`로 보일 수 있어 표시 전용으로만 쓴다. 자동 반영(기능 30) 전에 세계관 인물·장소 이름 대조를 더한다.
- 반영은 초안 본문 문자열 일치로 한다. 같은 문장이 여러 번이면 반영 실패로 두고 작가가 직접 고친다.
- 새 제보·제안 알림, 유해 필터, AI 응대, 보상은 없다. 목록은 최대 200개다.
