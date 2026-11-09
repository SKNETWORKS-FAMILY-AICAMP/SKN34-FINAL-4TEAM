# 운영 회원·관리자·신고 계약

기능표 운영 관리 서비스의 **34 신고·소명·조치 관리**, **71 관리자 계정 등록·권한**, **73 운영 회원 조회·조치**의 MVP 계약이다.
[서비스 경계](service-boundaries.md)대로 회원 정본·실제 회원 제한은 Core, 작품 실제 제한은 Content,
신고 사건·운영 판단·이력·관리자 업무 권한은 운영 서비스가 소유한다. 시연용 MVP이며 보안 하드닝은 범위 밖이다.

## 결정

- **운영자 판별**: Core `auth_member.operator`(기존 컬럼)를 역할로 쓴다. `operator=true`는 `ADMIN`, `false`는 `MEMBER`다.
  별도 role 컬럼을 추가하지 않는다. 샘플 관리자 `admin@example.test / StoryforkDev123!`를 Core Flyway로 시드한다.
- **업무별 권한**: 운영 서비스 `operations.admin_permission(member_id, permission)`에 저장한다. 권한 키는 프런트
  `ADMIN_PERMISSIONS`와 같은 `works, users, comments, characterChats, feedback, rights, events, notices, llm, jobs, credits, admins`다.
  샘플 관리자는 모든 권한을 시드한다. 회원·관리자·신고 운영 API는 `operator=true`이면서 해당 권한(`users`·`admins`·`rights`)이 있어야 한다.
- **인증**: 브라우저는 `/api/v1/operations/{reports,members,admins}`에 기존 회원 Bearer를 보낸다. 운영 서비스는 Content와 같이
  Core `POST /internal/v1/auth/verify`로 확인한다. 기존 공지·이벤트·문의 서비스 토큰 API와 nginx 비노출은 유지한다.
- **서비스 간 자격**: 운영 → Core·Content 호출은 기존 `OPERATIONS_SERVICE_TOKEN` 값을 `X-Operations-Service-Token` 헤더로 보낸다.
  Core·Content는 같은 환경변수(32자 이상)와 상수 시간 비교로 확인한다. 새 비밀 값을 추가하지 않는다.
- **회원 이용 제한**: Core `auth_member.restricted`. 제한 회원은 로그인과 내부 인증 확인(verify)이 거절된다.
  ponytail: 이미 발급된 access token의 Core 공개 API 사용은 만료까지 남는다. 즉시 차단이 필요하면 세션 폐기를 추가한다.
- **콘텐츠 제한**: Content 작품 `restricted`. 제한 작품은 공개 작품 목록·공개 상세·공개 회차 열람에서 제외(404)된다.
  ponytail: 제한 원인이 여러 개여도 단일 플래그이며 Fork 전파·"작가 확인 신고 즉시 비공개"는 후속이다.
- **실패**: 운영 → Core/Content 호출 실패는 성공으로 숨기지 않고 502 `UPSTREAM_FAILED`를 반환하며 이력도 남기지 않는다.
  원인 예외는 응답이 아니라 서버 로그에만 남긴다(500 `ERROR`, 502 `WARN`). 없는 경로·메서드 불일치도 같은 `{ code, message }`로 응답한다.
- **트랜잭션**: Content 호출은 DB 트랜잭션 밖에서 실행하고, 성공한 뒤 신고 갱신과 이력만 한 트랜잭션으로 저장한다.
  ponytail: 제한·해제의 Content 호출이 성공한 뒤 저장이 실패(409 등)하면 Content만 바뀐 상태로 남는다(분산 트랜잭션 없음).
  같은 요청을 다시 보내면 Content PUT/DELETE가 멱등이라 맞춰진다.

## Core 내부 API (운영 전용)

공통: `X-Operations-Service-Token` + 관리자 본인의 `Authorization: Bearer`(운영 서비스가 전달). JWT의 회원이 이용 제한 상태면 401, `operator=true`가 아니면 403.

| 메서드·경로 | 요청 | 응답 |
|---|---|---|
| `POST /internal/v1/auth/verify` | Bearer + `X-Content-Service-Token` 또는 `X-Operations-Service-Token` | `{ memberId, operator }`. 없는 회원·제한 회원 401(403은 서비스 자격 오류) |
| `GET /internal/v1/members?role=ALL\|MEMBER\|ADMIN&q=&sort=newest\|oldest` | `q`: 닉네임·이메일 부분 일치(대소문자 무시) | `{ items: MemberItem[] }` 최대 200개 |
| `PUT /internal/v1/members/{id}/restriction` | — | `MemberItem`. 자기 자신은 400, 없는 회원 404 |
| `DELETE /internal/v1/members/{id}/restriction` | — | `MemberItem` |
| `POST /internal/v1/members/admins` | `{ email, nickname(1~80), password(8~72) }` | 201 `MemberItem`(role ADMIN). 중복 이메일 409 |

`MemberItem = { id, email, nickname, role: "MEMBER"|"ADMIN", restricted, createdAt }` (`createdAt` UTC ISO-8601, 기존 회원은 마이그레이션 시각).

## Content 내부 API (운영 전용)

공통: `X-Operations-Service-Token`만 사용(회원 Bearer 불필요). 틀리거나 미설정이면 403.

| 메서드·경로 | 응답 |
|---|---|
| `GET /internal/v1/works/{workId}` | `{ workId, ownerId, title, restricted }`, 없으면 404 |
| `PUT /internal/v1/works/{workId}/restriction` | 같은 본문(`restricted=true`) |
| `DELETE /internal/v1/works/{workId}/restriction` | 같은 본문(`restricted=false`) |

## 운영 공개 API (브라우저, 회원 Bearer)

기본 경로 `/api/v1/operations`. 오류는 기존 `{ code, message }`이며 401(인증 없음)·403(권한 없음)·404·400·502다.

### 신고

| 메서드·경로 | 권한 | 동작 |
|---|---|---|
| `POST /reports` | 로그인 회원 | `{ kind: "RIGHTS"\|"HARMFUL", workId, reason(1~2000), evidence(0~5000) }` 접수. Content에서 작품 소유자·제목을 조회해 저장. 201 |
| `GET /reports/mine` | 로그인 회원 | 내가 신고했거나 내 작품이 대상인 신고 목록(최신순) |
| `GET /reports?status=` | 관리자 `rights` | 운영 신고 목록(최신순, 선택 상태 필터) |
| `GET /reports/{id}` | 신고자·작품 소유자·관리자 `rights` | 상세 + `history` |
| `POST /reports/{id}/evidence` | 신고자 | `{ body }` 증거 보완 → 이력 `EVIDENCE` |
| `POST /reports/{id}/explanations` | 작품 소유자 | `{ body }` 소명 → 이력 `EXPLANATION` |
| `GET /reports/{id}/explanations` | 신고 상세와 같음 | 소명 이력만 |
| `POST /reports/{id}/review` | 관리자 `rights` | `{ decision: "ACCEPTED"\|"REJECTED", note(1~2000) }` 상태 변경 → 이력 `REVIEW` |
| `POST /reports/{id}/restriction` | 관리자 `rights` | Content 작품 제한 → `contentRestricted=true`, 이력 `RESTRICT` |
| `DELETE /reports/{id}/restriction` | 관리자 `rights` | Content 제한 해제 → `contentRestricted=false`, 이력 `UNRESTRICT` |
| `POST /reports/{id}/evidence-requests` | 관리자 `rights` | `{ body }` 작품 등록자에게 권리 증빙 요청 → 이력 `EVIDENCE_REQUEST`(소유자 상세에 표시) |

`Report = { id, kind, workId, workTitle, workOwnerId, reporterId, reason, evidence, status: "RECEIVED"|"ACCEPTED"|"REJECTED", contentRestricted, createdAt, updatedAt, history? }`
`History = { id, type, actorId, body, createdAt }`, 이력은 오래된순. 목록은 `{ items: Report[] }`(history 제외, 최대 200개).
본문 문자열은 공백만·U+0000이면 400이다. 운영 조치 이력 조회는 상세 `history`로 제공한다.

### 회원·관리자

| 메서드·경로 | 권한 | 동작 |
|---|---|---|
| `GET /members?role=&q=&sort=` | 관리자 `users` | Core 목록 전달 |
| `PUT /members/{id}/restriction` · `DELETE …` | 관리자 `users` | Core 회원 제한·해제 |
| `GET /admins` | 관리자 `admins` | Core `role=ADMIN` 목록 + 각 `permissions: string[]` |
| `POST /admins` | 관리자 `admins` | `{ email, nickname, password, permissions[] }`(알려진 키만, 1개 이상). Core 생성 후 권한 저장. 201 `{ ...MemberItem, permissions }` |

ponytail: Core 생성 성공 후 권한 저장이 실패하면 권한 없는 관리자 계정이 남는다(분산 트랜잭션 없음). 같은 계정의 권한 재부여 API는 후속이다.

## 실행 연결

- `operations-service`를 compose에 추가하고 `--server.address=0.0.0.0`으로 컨테이너 네트워크에서만 노출한다.
- nginx·Vite는 `/api/v1/operations/reports`·`/members`·`/admins`와 하위 경로만 `operations-service:8082`로 보낸다.
- 운영 서비스 설정: `OPERATIONS_CORE_BASE_URL`(기본 `http://127.0.0.1:8080`), `OPERATIONS_CONTENT_BASE_URL`(기본 `http://127.0.0.1:8081`).
