# 운영 관리자 활동 기록 계약

기능표 운영 관리 서비스 **72 관리자 활동 기록**의 MVP 계약이다. [서비스 경계](service-boundaries.md)대로 감사 기록은 운영 서비스가
소유한다. 인증·관리자 권한은 [운영 회원·관리자·신고 계약](operations-member-report-contract.md)의 회원 Bearer·`admin_permission`을 쓴다.

## 결정 (2026-11-10 사용자 결정)

- **기록 대상**: 운영 서비스의 모든 관리자 변경 조치(아래 `action` 표). 조회·실패한 요청은 기록하지 않는다.
- **기록 내용**: 수행자(관리자 회원 ID), 시각, 대상(종류·ID), 내역(`action` + 짧은 `detail`). 본문·답변 내용 같은 긴 글은 저장하지 않는다.
- **조회 권한**: Core `operator=true`이면서 기존 `admins` 권한(V4 시드에 있음)이 있어야 한다. 새 권한 키·권한 마이그레이션은 없다.
- **수행자 표시**: 관리자 ID만 저장하고, 조회 때 Core 관리자 목록(`GET /internal/v1/members?role=ADMIN`, 요청 관리자 Bearer 전달)을
  한 번 불러 최신 닉네임을 채운다. 목록에 없으면(관리자 해제·탈퇴) `actorNickname: null`이고 화면은 ID를 보여 준다. Core 실패는 502다.
- **조회 범위**: 최신 100개 고정, `created_at DESC, id DESC`.
- **기록 시점**: 조치가 성공한 뒤 같은 요청 안에서 저장한다. 운영 DB만 바꾸는 조치(신고 검토·자료 요청, 공지·이벤트, 문의 답변)는
  가능하면 같은 트랜잭션에서 저장한다. Core·Content를 호출하는 조치(회원·작품 제한/해제, 관리자 생성, 신고 제한/해제)는 상위 호출이
  성공한 뒤 저장한다. 신고 제한/해제는 Content 호출이 성공한 뒤 신고 갱신·이력과 같은 로컬 트랜잭션에 저장한다.

## 저장 (operations Flyway V7)

```sql
CREATE TABLE operations.admin_activity (
    id UUID PRIMARY KEY,
    actor_id UUID NOT NULL,
    action VARCHAR(40) NOT NULL,
    target_type VARCHAR(20) NOT NULL,
    target_id VARCHAR(100) NOT NULL,
    detail VARCHAR(500),
    created_at TIMESTAMPTZ NOT NULL
);
CREATE INDEX admin_activity_created_idx ON operations.admin_activity (created_at DESC, id DESC);
```

삽입 전용이다(수정·삭제 API 없음). DEC-42의 운영 데이터 소프트 삭제 대상이 아니다(삭제 기능 자체가 없다).

| action | target_type · target_id | detail |
|---|---|---|
| `MEMBER_RESTRICT` · `MEMBER_UNRESTRICT` | `MEMBER` · 회원 ID | 대상 닉네임(Core 응답) |
| `ADMIN_CREATE` | `MEMBER` · 생성된 관리자 ID | `<이메일> · <권한 키,…>` |
| `REPORT_REVIEW` | `REPORT` · 신고 ID | 결정 상태(`decision`) |
| `REPORT_REQUEST_EVIDENCE` | `REPORT` · 신고 ID | — |
| `REPORT_RESTRICT` · `REPORT_UNRESTRICT` | `REPORT` · 신고 ID | — |
| `WORK_RESTRICT` · `WORK_UNRESTRICT` | `WORK` · 작품 ID | 작품 제목(Content 응답) |
| `NOTICE_CREATE` · `NOTICE_UPDATE` | `NOTICE` · 공지 ID | 제목 |
| `NOTICE_DELETE` | `NOTICE` · 공지 ID | — |
| `EVENT_CREATE` · `EVENT_UPDATE` | `EVENT` · 이벤트 ID | 제목 |
| `EVENT_DELETE` | `EVENT` · 이벤트 ID | — |
| `INQUIRY_REPLY_CREATE` · `INQUIRY_REPLY_UPDATE` · `INQUIRY_REPLY_DELETE` | `INQUIRY` · 문의 ID | 답변 ID |
| `COMMENT_HIDE` · `COMMENT_UNHIDE` | `COMMENT` · 댓글 ID | 작품 제목(Content 응답, 댓글 본문은 저장하지 않음) |

`detail`은 500자를 넘으면 잘라 저장한다.

## 운영 공개 API (브라우저)

`/api/v1/operations/admin/activities` (회원 Bearer, `operator` + `admins` 권한, 없으면 401/403). 오류는 기존 `{ code, message }`.
경로 끝에 슬래시를 붙이지 않는다.

```text
AdminActivity = { id, actorId, actorNickname: string|null, action, targetType, targetId, detail: string|null, createdAt }
AdminActivityList = { items: AdminActivity[] }
```

| 메서드·경로 | 동작 |
|---|---|
| `GET /api/v1/operations/admin/activities` | 최신 100개 `AdminActivityList`. 권한 확인 후 DB·Core 조회 |

## 실행 연결

- 운영 `MemberSecurityConfig` 경로 목록에 `admin/activities`를 추가한다.
- `frontend/nginx.conf`·`infrastructure/nginx.dev.conf`에 `/api/v1/operations/admin/activities`(정확 일치·하위)만 운영 서비스로 추가하고,
  Vite 프록시 정규식에 `admin/activities`를 넣는다. 서비스 토큰 경로는 열지 않는다.
- 관리자 `/admin?tab=audit`는 실제 API를 쓰고 `LIVE_TABS`에 `audit`을 넣어 데모 표기를 없앤다. 시각·수행자(닉네임 또는 ID)·
  조치 이름(한국어)·대상·내역을 최신순으로 보여 준다. `--mode mockup`은 메모리 구현(데모 조치 기록)을 등록한다.

## ponytail 한계

- Core·Content를 호출하는 조치는 분산 트랜잭션이 없다. 상위 조치가 성공한 뒤 기록 저장이 실패하면 조치는 적용됐지만 요청은 500이고
  기록이 남지 않는다.
- 공지·이벤트 레코드 Service가 자체 트랜잭션으로 저장하면 기록은 별도 트랜잭션이다(같은 한계).
- 페이지·필터·검색이 없다. 기록이 많아지면 `before` 커서·`action` 필터를 추가한다.
- Content·Core가 직접 수행하는 작업(작가의 작품 수정 등)은 관리자 조치가 아니므로 기록하지 않는다.
