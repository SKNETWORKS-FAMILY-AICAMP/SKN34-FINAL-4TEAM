# 운영 고객지원 문의 계약

기능표 운영 관리 서비스 **67 문의 접수·답변**의 MVP 계약이다. [서비스 경계](service-boundaries.md)대로 플랫폼 고객지원 문의·답변은
운영 서비스가 소유한다. 인증·관리자 권한은 [운영 회원·관리자·신고 계약](operations-member-report-contract.md)의 회원 Bearer·
`admin_permission`을 그대로 쓴다. 작품 오류·질문·작가 검토 피드백(Content)과 섞지 않는다.

## 결정

- **접수 대상**: 로그인 회원만 접수한다. 비로그인 사용자는 "문의하기" 화면에서 로그인 안내만 본다.
- **소유자**: 기존 `operations.inquiry`에 `member_id UUID NULL` 컬럼을 추가한다(Flyway `V6__inquiry_member.sql`).
  회원 API로 접수한 문의만 `member_id`가 있고, 기존 서비스 토큰 레코드는 `NULL`로 남는다. 회원·관리자 공개 API는
  `member_id IS NOT NULL`인 문의만 다룬다.
- **처리 상태**: 컬럼을 추가하지 않고 답변 유무로 계산한다. 답변이 1개 이상이면 `ANSWERED`(답변 완료), 없으면 `WAITING`(답변 대기).
- **관리자 권한**: Core `operator=true`이면서 운영 `admin_permission`의 `feedback`(제보·문의 대응) 권한이 있어야 한다.
- **답변**: 한 문의에 여러 답변을 등록 순서대로 둔다. 관리자는 답변 등록·수정·삭제를 할 수 있다. 회원은 답변을 읽기만 한다.
  문의 본문 수정·삭제는 회원·관리자 모두 범위 밖이다.
- **알림**: 답변 등록 시 Core 회원 알림을 보내지 않는다. 회원은 내 문의 화면에서 상태와 답변을 확인한다.
- **기존 서비스 토큰 API**: `/api/v1/operations/inquiries/**`(서비스 자격 CRUD)는 그대로 두고 공개 진입점에 노출하지 않는다.
- **화면**: 관리자 "제보·문의" 탭의 운영 문의 레코드 CRUD 메모리 데모와 기존 회원 문의 단일 답변 데모를 제거하고 실제 API 화면으로 바꾼다.
  회원 "문의하기"의 메모리 데모도 실제 API로 바꾼다.

## 운영 공개 API (브라우저, 회원 Bearer)

기본 경로 `/api/v1/operations/support/inquiries`. 오류는 기존 `{ code, message }`이며 401(인증 없음)·403(권한 없음)·
404(없음·남의 문의·서비스 토큰 레코드)·400(입력 오류)이다. 시각은 UTC ISO-8601이다. 목록은 끝 슬래시 없이 호출한다
(`/support/inquiries?status=`). 길이 검증은 기존 `InquiryService` 규칙대로 trim 이전 문자열에 적용한다. POST 201은 `Location` 없이 본문만 반환한다.

| 메서드·경로 | 권한 | 동작 |
|---|---|---|
| `POST /` | 로그인 회원 | `{ category(1~50), title(1~200), body(1~20000) }` 접수. 앞뒤 공백 제거한 category·title 저장, 공백만·U+0000 거절(400). 201 `SupportInquiry` |
| `GET /mine` | 로그인 회원 | 내 문의 최신순 최대 100개 `{ items: SupportInquiry[] }` |
| `GET /{id}` | 문의 작성자·관리자 `feedback` | `SupportInquiry`. 남의 문의는 404 |
| `GET /?status=WAITING\|ANSWERED` | 관리자 `feedback` | 회원 문의 최신순 최대 100개(선택 상태 필터) `{ items: SupportInquiry[] }` |
| `POST /{id}/replies` | 관리자 `feedback` | `{ body(1~20000) }` 답변 등록, 201 `SupportInquiry`(갱신된 전체) |
| `PUT /{id}/replies/{replyId}` | 관리자 `feedback` | `{ body }` 답변 전체 수정, `SupportInquiry` |
| `DELETE /{id}/replies/{replyId}` | 관리자 `feedback` | 답변 삭제, `SupportInquiry`. 다른 문의의 답변 id는 404 |

```text
SupportInquiry = { id, memberId, category, title, body, status: "WAITING"|"ANSWERED",
                   createdAt, updatedAt, replies: SupportReply[] }   // replies: 등록 오래된 순
SupportReply   = { id, body, createdAt, updatedAt }
```

## 실행 연결

- 운영 서비스 `MemberSecurityConfig`의 회원 Bearer 경로 목록에 `support`를 추가한다(`/api/v1/operations/support`, `/support/**`).
- nginx(`frontend/nginx.conf`, `infrastructure/nginx.dev.conf`)·Vite 프록시에 `/api/v1/operations/support` 하위 경로만 운영 서비스로 추가한다.
  `/api/v1/operations/inquiries`는 열지 않는다.
- 프런트: `data/api/operationsApi.ts`에 Http 저장소를 추가하고 `registerAppServices`에서 기존 `InMemoryInquiryRepository` 연결을 대체한다.

## ponytail 한계

- 관리자 목록은 최신 100개까지만 보인다(개요 대기 수는 100개 이상이면 `100+`). 페이지 이동은 문의가 늘면 추가한다.
- 관리자 화면에 작성자 닉네임 대신 회원 ID 앞부분만 보인다. 닉네임이 필요하면 Core 회원 조회를 붙인다.
- 상태는 답변 유무만 반영한다. "처리 중" 같은 중간 상태가 필요하면 status 컬럼을 추가한다.
