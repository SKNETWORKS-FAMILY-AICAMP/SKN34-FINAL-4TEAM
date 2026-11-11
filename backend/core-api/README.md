# STORYFORK Core Service (현재 모듈: `core-api`)

Spring Boot·Kotlin의 Auth·세션·Health API와 Content 전용 내부 인증 확인을 제공합니다. 기존 콘텐츠·첨부·WorldStudio 코드/테스트는 [Content Service](../content-service/README.md)로 추출했습니다. hosted CI·실제 DB 전환·배포는 대기입니다. 실제 약관·동의·탈퇴 최종 처리(콘텐츠 삭제·익명화)·그래프 DB·크레딧은 미구현이며 운영 가입용이 아닙니다.

## 목표 소유권과 현재 모듈 (DEC-41)

[4개 서비스 경계](../../docs/design/service-boundaries.md)의 Core 정본은 회원·인증·세션·크레딧·정산·회원 알림입니다. 작품·세계관·회차·원고·버전·Fork·발행·독서·검색·작품 피드백·첨부와 콘텐츠 인가는 별도 Kotlin/Spring Boot 콘텐츠 앱으로 이전할 대상입니다. 문의·공지·이벤트·신고 사건·소명·운영 결정·감사·작업 감시는 별도 Kotlin/Spring Boot 운영 앱, 모델 실행은 Python AI 앱의 책임입니다. 운영 결정에 따른 회원 제한은 Core, 콘텐츠 제한은 콘텐츠 서비스가 실제 적용합니다.

Core 8080과 Content 8081은 기존 같은 DB 대상·계정을 쓰되 writer·Entity/Repository·migration을 나눕니다. 운영 8082는 기존 실행 골격 그대로입니다. 기존 works URL은 공개 진입점에서 Content로 보내며 Core는 중계하지 않습니다. 아래 첨부 #87/#92 계약은 기존 문서 링크 호환을 위해 보존하지만 실행 소유자는 Content입니다. 사용자 승인 fresh Content 이력은 과거 checksum과 비호환이며 정확한 대상·보존/복구 승인 전 실제 DB를 폐기하지 않습니다. Auth SQL/이력은 유지합니다.

LLMOps는 운영 영역이며 Langfuse 도입 시 별도 제품으로 배포합니다. 자체 UI 또는 운영 화면 API 통합은 미정이고 Core/Spring에서 제품 전체를 재구현하지 않습니다. 업무별 정기 작업은 소유 서비스가 실행하고 운영은 감시·재실행 요청을 담당합니다.

## 공개 계약

| 경로 | 성공 JSON |
|---|---|
| `GET /api/v1/health` | `{"status":"up","service":"storyfork-core-api"}` |
| `GET /api/v1/health/ai-service` | `{"status":"up","service":"storyfork-ai-service"}` |

자체 Health는 AI 장애와 무관합니다. AI Health는 내부 `/internal/v1/health`의 상태와 서비스명을
정확히 검증합니다. OpenAI 인증이나 모델 호출을 검증하지 않습니다. 콘텐츠 API는 별도로 활성화합니다.

`GET /api/v1/auth/csrf`에서 토큰과 쿠키를 받은 뒤 `X-CSRF-TOKEN`을 보내 모든 변경 요청을 호출합니다. 인증 링크는 URL fragment로 토큰을 전달합니다. 가입 후보의 비밀번호와 토큰은 PostgreSQL에 해시로 저장하며 이메일 인증 전 회원을 생성하지 않습니다. 미인증 이메일로 다시 가입하면 비밀번호·닉네임·토큰과 24시간 유효기간을 새 요청으로 교체하고 이전 링크는 무효화합니다. 이미 가입한 회원의 이메일은 409입니다. 가입 인증은 최신 토큰과 가입 시 정한 비밀번호가 모두 일치해야 하며, 잘못된 비밀번호로는 토큰을 소비하지 않습니다. 인증 성공 후 자동 로그인하지 않습니다. 재발송은 일반화된 202를 반환하지만 메일 전송 장애 시 기존 후보 여부에 따라 응답이 달라질 수 있어 열거 방지의 한계가 있습니다.

| 메서드·경로 | 요청·성공 동작 |
|---|---|
| `GET /api/v1/auth/csrf` | `{"csrfToken":"…"}`와 CSRF 쿠키, 200 |
| `POST /api/v1/auth/signup` | `email`, `password`, `nickname`; 가입 후보 저장·메일 발송, 202 |
| `POST /api/v1/auth/resend-verification` | `email`; 가입 인증 메일 재발송 요청, 202 |
| `POST /api/v1/auth/verify-email` | `token`, 가입 시 정한 `password`; 회원 생성, 204 |
| `POST /api/v1/auth/login` | `email`, `password`; `accessToken`·`user` JSON 및 `refresh_token` 쿠키, 200. 자격 증명 불일치 401. 이용 제한 회원은 올바른 비밀번호일 때만 403 `application/problem+json` 본문에 `code: "ACCOUNT_RESTRICTED"`를 담는다(그 밖의 403·오류는 상태만) |
| `POST /api/v1/auth/refresh` | `refresh_token` 쿠키, 선택적 `X-Auth-User` 회원 UUID; 회전된 쿠키와 `accessToken`·`user` JSON, 200 |
| `POST /api/v1/auth/logout` | `refresh_token` 쿠키, 선택적 `X-Auth-User` 회원 UUID; 세션 폐기·쿠키 삭제, 204 |
| `GET /api/v1/auth/sessions` | Bearer 인증(현재 세션 판별에는 선택적 `refresh_token` 쿠키); `{"sessions":[{"id","deviceLabel","createdAt","current"}]}`, 200 |
| `DELETE /api/v1/auth/sessions/{id}` | Bearer 인증과 세션 UUID; 해당 세션 폐기, 204 |
| `POST /api/v1/auth/logout-all` | Bearer 인증(요청 회원 소유 쿠키가 있으면 삭제); 모든 refresh 세션 폐기, 204 |
| `POST /api/v1/auth/forgot-password` | `email`; 비밀번호 재설정 메일 요청, 일반화된 202 |
| `POST /api/v1/auth/reset-password` | `token`, `newPassword`; 비밀번호 변경·모든 refresh 세션 폐기, 204 |
| `POST /api/v1/auth/verify-email-change` | `token`만으로 이메일 변경 확정, 204 |
| `GET /api/v1/me` | Bearer 인증; 현재 회원 정보, 200 |
| `PATCH /api/v1/me` | Bearer 인증과 `nickname`; 변경한 회원 정보, 200 |
| `POST /api/v1/me/email-change` | Bearer 인증과 새 `email`; 변경 확인 메일 요청, 202 |
| `GET /api/v1/me/notifications` | Bearer 인증, 선택 `cursor`·`limit`(1~50, 기본 20); 본인 알림 최신순 `{"items":[…],"nextCursor"}`, 200 |
| `GET /api/v1/me/notifications/{id}` | Bearer 인증; 알림 하나(읽음 처리는 하지 않음), 타인·삭제된 알림·UUID가 아닌 id는 404 |
| `GET /api/v1/me/notifications/groups` | Bearer 인증, 선택 `limit`(1~50, 기본 20); 같은 종류·대상(`kind`·`targetType`·`targetId`) 알림 묶음 `{"items":[{"kind","targetType","targetId","count","unreadCount","latestAt","latestSummary"}]}`을 최근 도착순으로, 200. 대상이 없는 알림은 묶지 않으며 페이지 넘김은 아직 없음. 묶음 표시 기준 시간은 UC-27에서 미정이라 시간 제한 없이 묶음 |
| `GET /api/v1/me/notifications/groups/items` | Bearer 인증과 `kind`·`targetType`·`targetId`, 선택 `limit`(1~50, 기본 20); 그 묶음의 개별 알림 최신순 `{"items":[…],"nextCursor":null}`, 200. 묶음이 `limit`보다 크면 최신 `limit`개만 반환하고 나머지는 이 API로 볼 수 없음(페이지 넘김은 아직 없음). 누락·잘못된 limit·알 수 없는 `kind`는 400 |
| `GET /api/v1/me/notifications/unread-count` | Bearer 인증; 삭제하지 않은 미읽음 수 `{"count":N}`, 200 |
| `PATCH /api/v1/me/notifications/{id}/read` | Bearer 인증; 읽음 처리(반복 호출도 204), 타인·삭제된 알림 404 |
| `POST /api/v1/me/notifications/read-all` | Bearer 인증과 `upTo`; 그 시각 이전 도착분만 읽음, 204 |
| `DELETE /api/v1/me/notifications/{id}` | Bearer 인증; 삭제 표시(행 보존, 반복 호출도 204), 타인 알림 404 |
| `GET /api/v1/me/notifications/stream` | Bearer 인증; SSE(`text/event-stream`). `ready`(연결·재연결 직후)와 `changed`(새 알림 저장 후)만 보내며 내용은 없음. 받으면 목록·미읽음 수를 다시 조회. 연결은 10분 뒤 끝나고 20초마다 `:ping`을 보냄 |
| `GET /api/v1/me/notification-preferences` | Bearer 인증; 분류별 `{"items":[{"kind","enabled","mutable"}]}`, 200 |
| `PUT /api/v1/me/notification-preferences` | Bearer 인증과 `items`; 읽기(`reading`)·창작(`creation`)만 변경, 그 외 분류 끄기·알 수 없는 분류·중복은 400 |
| `GET /api/v1/me/credits` | Bearer 인증; 사용 가능한 크레딧 합계와 지급분별 남은 양·소멸 예정(소멸이 빠른 순) `{"total","items":[{"kind","remaining","expiresAt"}]}`, 200 |
| `GET /api/v1/me/credits/history` | Bearer 인증; 본인의 지급·사용·소멸 내역 최신순 `{"items":[{"type":"grant"\|"spend"\|"expire","kind","amount","occurredAt"}]}`, 200 |
| `POST /api/v1/me/withdrawal` | Bearer 인증과 현재 `password`, 선택 `reason`(300자 이하); 30일 유예 탈퇴 요청·모든 refresh 세션 폐기, 202. 비밀번호 불일치 403, 이미 진행 중 409 |
| `GET /api/v1/me/withdrawal` | Bearer 인증; 진행 중이면 `{"status":"PENDING","requestedAt","dueAt"}`, 없으면 `{"status":"NONE"}`, 200 |
| `DELETE /api/v1/me/withdrawal` | Bearer 인증; 유예 중인 탈퇴 요청 취소(복구), 204. 진행 중인 요청이 없으면 404, 유예 기한이 지난 요청은 복구할 수 없어 409 |

### 내부 API (Content·운영 서비스 전용, nginx 비노출)

[운영 회원·관리자 계약](../../docs/design/operations-member-report-contract.md)을 따릅니다. 닉네임 조회를 뺀 모두 회원 Bearer가 필요합니다.

| 메서드·경로 | 서비스 자격 | 동작 |
|---|---|---|
| `POST /internal/v1/auth/verify` | `X-Content-Service-Token` 또는 `X-Operations-Service-Token` | `{memberId, operator}`. 없는 회원·이용 제한 회원 401 |
| `POST /internal/v1/members/nicknames` | 〃 (사용자 Bearer 불필요) | `{ids: [uuid…]}`(최대 200개, 중복 무시) → `{nicknames: {<uuid>: 닉네임}}`. Content가 작성자·작가 표시명을 응답 때마다 조회한다. 없는 회원은 빠지고 이용 제한 회원은 포함하며, 잘못된 UUID·200개 초과는 400 |
| `GET /internal/v1/members?role=ALL\|MEMBER\|ADMIN&q=&sort=newest\|oldest` | `X-Operations-Service-Token`만 | `{items: MemberItem[]}` 최대 200개, `q`는 닉네임·이메일 대소문자 무시 부분 일치 |
| `PUT`·`DELETE /internal/v1/members/{id}/restriction` | 〃 | 이용 제한·해제 후 `MemberItem`. 자기 자신 400, 없는 회원 404 |
| `POST /internal/v1/members/admins` | 〃 | `{email, nickname, password}`로 관리자 생성, 201 `MemberItem`. 중복 이메일 409 |

`MemberItem = {id, email, nickname, role: "MEMBER"|"ADMIN", restricted, createdAt}`. 회원 API는 Bearer 회원이 이용 제한 상태면 401, 제한되지 않았지만 `operator=true`가 아니면 403입니다. 이용 제한 회원은 로그인(403, `code: "ACCOUNT_RESTRICTED"`)·refresh(401)·verify(401)가 거절되며, 이미 발급된 access JWT는 만료까지 Core 공개 API에 남습니다. 샘플 관리자는 `admin@example.test / StoryforkDev123!`(V8)입니다. 고전 원작 샘플의 소유 계정(`b1b09f26…`) 닉네임은 운영자처럼 보이지 않게 V10이 `운영팀`일 때만 `고전 아카이브`로 바꿉니다.

탈퇴 요청은 계정 상태와 30일 유예 기한만 기록하며 유예 중에도 로그인해 복구할 수 있습니다. 유예 만료 후 Core 안의 최종 처리(계정을 "탈퇴한 회원"으로 익명화하고 이메일·비밀번호를 쓸 수 없게 바꾸며 세션·확인 요청을 지움, 요청은 `COMPLETED`)는 `app.withdrawal.completion.enabled=true`일 때만 `app.withdrawal.completion.poll-interval`(기본 `PT1H`, 한 번에 `batch-size` 50건)마다 실행하며 기본은 꺼져 있습니다. 탈퇴 사유는 그대로 두고, 이미 발급된 액세스 토큰이 남아 있어도 바로 막히도록 계정을 이용 제한 상태로 바꿉니다. 완료된 요청은 되돌릴 수 없고 Content의 작품은 정리하지 않으므로 Content 연동 전에는 켜지 않습니다. 작품·세계관 숨김·삭제·익명화, 남은 크레딧·결제 내역 처리, 같은 이메일 재가입 정책은 콘텐츠 서비스 계약과 정책이 정해진 뒤 연결하므로 아직 없습니다.

알림 분류는 `reading`·`creation`(끌 수 있음), `result`·`credit`·`rights-security`(항상 수신)입니다. 모든 변경 요청은 CSRF 헤더가 필요하고 알림은 요청한 회원 본인 것만 보입니다. RabbitMQ·모바일 푸시는 아직 없습니다. SSE 연결 목록은 Core 인스턴스 메모리에 있으므로 단일 Core 인스턴스를 전제로 하며, 여러 인스턴스로 늘리면 인스턴스 간 신호 전달을 추가해야 합니다. 전송은 연결별 가상 스레드에서 직렬화하고 대기 신호는 종류별로 병합합니다. 전송이 5초를 넘으면 논리적으로 등록 해제하고 종료 처리를 호출자와 분리합니다. 이 기한은 막힌 Servlet 소켓의 물리적 종료를 보장하지 않으며, 실제 자원 회수에는 컨테이너의 쓰기 타임아웃이 필요합니다.

가입 인증 링크는 24시간, 비밀번호 재설정·이메일 변경 링크는 1시간 유효하며 한 번만 사용할 수 있습니다. 가입 인증 화면은 fragment를 지운 뒤 비밀번호 입력과 명시적 확인을 기다리고, 이메일 변경 확인 화면은 기존처럼 토큰만으로 자동 진행합니다. SMTP는 가입 인증·비밀번호 복구·이메일 변경 메일에 사용합니다. 메일과 데이터베이스는 로컬 검증용이며 운영 SMTP·TLS 정책은 미정입니다.

로그인·갱신은 30분 유효한 access JWT와 회원 정보를 반환합니다. refresh는 host-only `refresh_token` 쿠키(HttpOnly, SameSite=Strict, 경로 `/api/v1/auth`)로 전달하며 세션은 로그인 시점부터 14일 유효합니다. 갱신은 회전하고 폐기된 토큰을 재사용하면 해당 회원의 모든 refresh 세션을 폐기합니다. 세션 목록·개별 폐기·전체 로그아웃은 Bearer 인증이 필요합니다. 발급된 access JWT는 세션 폐기 후에도 만료까지 유효합니다. 토큰 재사용 기록의 정리 및 로그인 속도 제한은 아직 없습니다.

| 실패 | HTTP | 공개 code |
|---|---:|---|
| 연결 불가 또는 AI의 503 | 503 | `AI_SERVICE_UNAVAILABLE` |
| 연결·읽기 시간 초과 | 504 | `AI_SERVICE_TIMEOUT` |
| 잘못된 JSON·빈 body·계약 위반 | 502 | `AI_SERVICE_INVALID_RESPONSE` |
| 예상하지 않은 HTTP 상태 | 502 | `AI_SERVICE_UPSTREAM_ERROR` |

오류는 `application/problem+json`이며 `urn:storyfork:problem:*` 타입을 사용합니다.
내부 URL·응답 원문·예외 메시지를 공개하지 않습니다. 외부 실패를 성공으로 숨기지 않습니다.

## 구조

Core는 `auth`·`notification`·`_health`·`_health_ai_service`와 필요한 `_common`만 실행합니다. #84의 콘텐츠별 Controller/Service/JPA·잠금·revision·공개 DTO 계약은 [Content](../content-service/README.md)에 유지합니다. Content는 fresh 7개 업무 leaf/전역 V1~V9/`content_schema_history`를 소유하고 통합 migration 폴더·legacy JSONB importer를 제거했습니다. 이 재작성은 Auth 이력에 적용하지 않습니다.

WorldStudio는 [Content의 명시 migration 계약](../content-service/src/main/resources/db/migration/worldstudio/README.md)을 따릅니다. 동일 `contentDataSource`와 studio-only EntityManager/TransactionManager로 validate하며 Core Auth 스캔·기본 영속성 단위를 공유하지 않습니다. V1 SQL/독립 history는 보존하고 HTTP/UI는 여전히 미연결입니다.

Gradle group `ai.storyfork`, 애플리케이션 `storyfork-core-api`, Kotlin namespace `ai.storyfork.core`입니다.
main/test 디렉터리는 각각 `src/{main,test}/kotlin/ai/storyfork/core/`로 package와 일치합니다.

- `_health/controller`: 자체 상태.
- `_health_ai_service/controller → service → client`: 내부 응답 조회와 검증.
- Health의 `controller/dto`: 공개 응답, `client/dto`: 신뢰하지 않는 외부 payload, `service/dto`: 검증된 결과.
- `auth/controller → service → repository`: Controller는 필요한 쿠키·헤더와 검증된 JWT만 받고, Service는 업무·트랜잭션, Spring Data `JpaRepository`는 `auth/entity` 영속성을 담당합니다.
- `auth/service/dto`: 클래스별 요청·응답 계약을 Controller와 Service가 공유합니다. `LoginResult`의 내부 refresh token은 Controller에서 HttpOnly 쿠키로만 보내며 공개 `LoginResponse`에는 포함하지 않습니다.
- Auth는 기존 UUID·스키마와 Flyway 파일·`flyway_schema_history`를 유지합니다. Hibernate는 `validate`만 수행하며 Open Session in View는 사용하지 않습니다. Content Entity/Repository·migration은 이 앱에서 등록하지 않습니다.
- 로그인·복구·이메일 변경·refresh 회전·세션 폐기는 회원의 JPA `PESSIMISTIC_WRITE` 잠금으로 직렬화합니다. 토큰 재사용 폐기는 Service가 정상 반환해 커밋한 뒤 Controller에서 401로 변환합니다. 신규 가입 후보의 최초 삽입 충돌만 새 트랜잭션에서 한 번 재시도하며 메일 실패 시 후보 변경을 롤백합니다.
- `notification/controller → NoticeService → repository`: 알림함·수신 설정 API입니다. Entity·Repository는 `notification/entity`·`notification/repository`에 두고 Flyway는 `db/migration/notification`(V5~, Auth와 같은 `flyway_schema_history`)을 사용합니다. 읽음·삭제는 조건부 UPDATE로 처리해 동시 요청이 삭제 표시를 되살리지 않습니다.
- `_common/ai_config`: AI 주소·timeout·RestClient 설정.
- `_common/helper`: 기존 HTTP 설정 검증과 통신 실패 분류 경계.
- `_common/exception`: AI 실패 분류와 안전한 ProblemDetail.
- `_common/config`: 단일 origin CORS.

현재 필요한 계층만 유지하며 한 줄 Facade나 미래 도메인 폴더를 추가하지 않습니다.

## 실행과 검증

JDK **21**에서 이 디렉터리를 기준으로 실행합니다.

```bash
# 아래 Core 환경변수를 해당 터미널에 설정한 뒤 실행합니다.
./gradlew bootRun
# 로컬 개발 검증은 변경·직접 영향 범위의 순수 단위만 지정합니다.
./gradlew unitTest --tests 'ai.storyfork.core.auth.AuthSecurityConfigTest' --no-daemon
```

| 환경변수 | 네이티브 기본값 |
|---|---|
| `AI_SERVICE_BASE_URL` | `http://127.0.0.1:8000` |
| `AI_SERVICE_CONNECT_TIMEOUT` | `1s` |
| `AI_SERVICE_READ_TIMEOUT` | `12s` (Health) |
| `CONTENT_CORE_AUTH_TOKEN` | 기본 빈 값; Content 인증 연결 시 32자 이상·개행 없는 별도 자격 |
| `OPERATIONS_SERVICE_TOKEN` | 기본 빈 값; 운영 서비스 연결 시 32자 이상. 비면 운영 자격은 항상 403 |
| `APP_CORS_ALLOWED_ORIGIN` | `http://localhost:5173` |
| `DATABASE_URL`, `DATABASE_USER`, `DATABASE_PASSWORD` | 필수 |
| `CORE_SMTP_HOST`, `CORE_SMTP_PORT` | 필수 |
| `AUTH_PUBLIC_ORIGIN`, `AUTH_MAIL_FROM` | 필수 |
| `AUTH_JWT_SECRET` | 필수, 32바이트 이상의 무작위 키를 Base64 인코딩 |
| `AUTH_COOKIE_SECURE` | `true`; 로컬 HTTP 검증에서만 `false` |
| `CREDIT_SIGNUP_TRIAL_AMOUNT` | `0`(가입 체험 크레딧을 지급하지 않음, 팀 결정 전); 양수면 가입을 완료한 회원에게 한 번 지급하고 30일 뒤 소멸. Compose는 이 값을 Core에만 전달 |

Core는 AI Health만 호출합니다. 생성 전용 HTTP 클라이언트는 Content에 있습니다. AI 주소는 origin만 허용하고 양수 timeout을 검증하며 redirect를 따라가지 않습니다.
`./gradlew bootRun`은 루트 `.env`를 자동으로 읽지 않습니다. 자동 설정 전달은 Compose를 사용합니다.
루트 `.env` 전체를 source하거나 Core에 OpenAI 키를 주입하지 않습니다.
Compose는 내부 DNS `http://ai-service:8000`을 고정 사용하고 CORS를 web 포트에 맞춥니다.
공통 `docker-compose.yaml` + prod는 기존 PostgreSQL·Mailpit과 소스 빌드 앱을, base + dev는 CI의 `:develop` 앱 이미지와 기존 외부 DB·SMTP를 사용합니다. base 단독 실행이나 dev 서버 소스 build는 하지 않습니다.
Content의 활성화·DB·AI 생성 토큰·S3 설정은 Content에만 전달합니다. Core에는 `CONTENT_CORE_AUTH_TOKEN` 외 Content runtime 설정·JWT 키 공유·개발 Principal을 추가하지 않습니다.
실행 설정은 [인프라 안내](../../infrastructure/README.md)를 참고하세요.

### CI 계층과 선택 실행

로컬 개발에서는 `unitTest --tests ...`만 선택 실행합니다. Spring context·HTTP·DB·전체 suite·빌드는 로컬 개발 검증으로 실행하지 않습니다.
`build.gradle`의 `integrationTestClasses`를 `unitTest`에서 제외하고 `integrationTest`에서만 포함하므로 테스트를 중복 실행하지 않습니다.
`AiServiceClientPropertiesTest`처럼 context가 섞인 클래스도 통합입니다. 새 Spring/HTTP/DB 테스트는 분류 목록을 갱신합니다.

CI가 이 디렉터리에서 `./gradlew unitTest --no-daemon --tests 'ai.storyfork.core.auth.*'`와 `./gradlew integrationTest --no-daemon --tests ...`를 직접 호출합니다. 별도 runner·shell wrapper는 없습니다.
Core의 기능 필터는 auth/health이며 공통·설정·의존성·미등록 경로는 전체로 확장합니다. Auth runtime 변경은 Content/web 소비자와 시스템도 선택합니다. 이전된 콘텐츠 테스트는 Content job에서 실행합니다.
통합은 임시 PostgreSQL·Mailpit의 Auth Flyway/내부 보안을 확인하고 `AUTH_INTEGRATION_TEST=true`·`AUTH_MAILPIT_API`를 설정합니다. Content의 fresh DB/JPA/HTTP 검사는 별도 Content job 책임입니다.
그 뒤 관련 HTTP 시스템 시나리오가 CI Compose에서 실행됩니다. [공통 검증](../../docs/development.md#검증)을 따르며 실제 hosted `Required CI` 결과 확인 전에는 검증 대기입니다.

회차별 초안·수동 버전·복원 API와 저장 실패 경계는 [이슈 #50 대응](../../docs/issue-50-alignment.md)을 참고하세요.

## 설정 이미지·일반 파일 (#87)

첨부는 항상 켜져 있습니다. local·개발 배포는 compose의 MinIO를 쓰고 버킷은 Content 시작 시 만들며, AWS S3는 미리 만든 **비공개** 버킷이 필요합니다.
로컬은 소스 빌드 MinIO, 실제 배포 대상은 AWS S3입니다. 공식 AWS SDK v2만 사용하며 버킷 생성·공개 ACL·presigned URL·외부 URL 다운로드는 하지 않습니다.
`ATTACHMENT_S3_ENDPOINT`를 비우면 일반 AWS S3 endpoint를 사용합니다. `ATTACHMENT_S3_REGION`(기본 `us-east-1`, 없으면 `AWS_REGION`)과
`ATTACHMENT_S3_BUCKET`을 지정하고 SDK 기본 자격증명 체인(환경변수, profile, workload role)을 사용합니다.
로컬 MinIO는 endpoint override와 path-style을 사용합니다. AWS 유료 호출·실제 IAM·TLS·배포는 이번 로컬 검증에 포함하지 않습니다.

기존 `setting_document`의 논리 ID를 `{settingId}`로 사용합니다. 작품과 로컬 세계관의 소유자가 JWT Principal과 일치해야 합니다.
현재 Content가 로컬 세계관 ID를 작품 ID로 만드는 규칙을 조회에 재사용합니다. **following Fork는 원본 첨부를 볼 수 없으며**,
독립 후에도 첨부를 자동 복사하지 않습니다. 설정의 public 표시·작품 발행·이미지 URL 지식은 첨부 접근 권한을 주지 않습니다.
설정 첨부의 공개/회차별 배포·과거 파일 복원·프로필·AI 연계는 구현하지 않았습니다. 표지·원고 이미지는 아래 #92 계약으로 별도 관리합니다.

기준 경로: `/api/v1/works/{workId}/settings/{settingId}/attachments`

| 메서드·하위 경로 | 요청·응답 |
|---|---|
| `POST` | `multipart/form-data`의 `file` 필드(AttachmentUploadRequest); 201 AttachmentResponse |
| `GET` | 200 `{"attachments":[AttachmentResponse,…]}` |
| `GET /{attachmentId}` | 200 AttachmentResponse |
| `GET /{attachmentId}/content` | 200 원본 바이트; 항상 `Content-Disposition: attachment`, `X-Content-Type-Options: nosniff`, `Cache-Control: private, no-store` |
| `PUT /{attachmentId}` | `file`로 교체; ID 유지, 200 AttachmentResponse |
| `DELETE /{attachmentId}` | 파일과 참조 삭제, 204 |

AttachmentResponse는 `id`, `filename`, `mediaType`, `kind`(`IMAGE`/`FILE`), `byteSize`, `createdAt`, `url`만 노출합니다.
`url`은 작품·설정·첨부 ID로 만든 위 인증 API의 상대 content 경로입니다. RDB의 object key·내부 endpoint·bucket·자격증명은 노출하지 않습니다.
이미지와 일반 파일은 동일 첨부 CRUD를 사용하고 확장자와 실제 내용으로 분류합니다. 모든 변경은 기존 CSRF 쿠키와 `X-CSRF-TOKEN`을 요구합니다.
타인·미존재 작품/설정/첨부·다른 설정의 첨부 ID는 동일한 404이며 미인증은 401, CSRF·허용하지 않은 origin은 403입니다.
인증/CSRF 오류는 기존 Security 경계의 응답 형식을 유지합니다.

### 보수적인 기술 제한 (요금·업무 저장 한도 정책이 아님)

- 모든 파일은 비어 있지 않은 **10 MiB 이하**입니다. multipart envelope 한도는 11 MiB입니다.
- 이미지: **PNG, JPEG**만 허용합니다. 확장자·MIME·시그니처/종료·실제 디코딩을 검사합니다.
  디코딩 전에 가로/세로 각각 4,096 이하, 총 16,000,000 pixels 이하를 확인합니다. SVG·GIF·WebP·실행형 형식은 지원하지 않습니다.
- 일반 파일: UTF-8 **TXT/MD/CSV**, header/EOF를 확인한 **PDF**만 허용합니다. 텍스트의 잘못된 UTF-8·NUL/제어문자는 거절합니다.
  PDF 파싱·악성코드 검사·스크립트 제거·OCR는 하지 않으므로 PDF 내부 안전성을 보장하지 않습니다. 일반 파일은 브라우저 inline으로 보내지 않습니다.
- 파일명: 120자 이하의 문자·숫자·공백·`_().-`만 허용하고 경로 구분자·`..`·선행 점·양끝 공백·제어/방향 전환 문자를 거절합니다.
  원래 파일명을 저장소 key로 사용하지 않습니다. MIME은 검증된 형식·`application/octet-stream`·미지정을 받으며 브라우저의 MD `text/x-markdown`, CSV `application/vnd.ms-excel` 별칭과 charset 매개변수를 정규화합니다. 확장자·실제 바이트 검증은 생략하지 않습니다.
- 설정당 이미지 **10개**는 JPA `PESSIMISTIC_WRITE` 설정 행 잠금과 transaction 내 count로 동시 요청에도 지킵니다.
  일반 파일에는 이미지 디코딩·10개 한도를 적용하지 않습니다. `FILE→IMAGE` 교체는 한도를 검사하고 `IMAGE→FILE`은 자리를 반환합니다.
- 같은 설정의 조회/변경은 저장소 I/O까지 잠금을 유지합니다. 초기 트래픽용 단순성 선택이며 고부하 처리 성능 보장은 아닙니다.

첨부 오류 DTO는 `{"code":"ATTACHMENT_…","detail":"고정 안전 문구"}`입니다.
형식/입력 오류 422 `ATTACHMENT_INVALID`, 용량 초과 413 `ATTACHMENT_TOO_LARGE`, 이미지 한도 409 `ATTACHMENT_IMAGE_LIMIT`,
미존재/권한 없음 404 `ATTACHMENT_NOT_FOUND`, 저장소/DB 실패 503 `ATTACHMENT_STORAGE_FAILURE`/`ATTACHMENT_DATABASE_FAILURE`를 반환합니다.
예외·SQL·저장소 원문을 노출하지 않습니다.

### DB·파일 실패 경계

첨부 영속성은 `attachment/controller → AttachmentService → JpaRepository / AttachmentStorageClient`로 분리합니다.
DTO는 `attachment/service/dto`, 저장소 전용 DTO는 `attachment/client/dto`에 둡니다.
Content 내 별도 attachment JPA·bounded pool 경계를 유지하며 직접 SQL 영속성은 추가하지 않습니다. `db/migration/settingattachment`/`setting_attachment_schema_history`와 이미지 leaf/history의 SQL 바이트는 보존합니다.
Compose의 Core Auth Health → Content fresh 업무 migration → 첨부 EntityManager 순서로 시작합니다. 첨부 설정은 Auth를 직접 호출하거나 스캔하지 않습니다. Auth SQL과 `flyway_schema_history`는 Core만 소유합니다.

교체는 새 UUID object에 먼저 업로드하며, 삭제/교체는 기존 바이트를 크기 제한 내 메모리에 보관한 후 DB flush → 기존 object 삭제 → commit 순서입니다.
저장소 삭제가 실패하거나(서버 반영 후 응답 유실 포함) DB commit이 실패하면 transaction을 rollback하고 기존 object를 복원합니다.
일반적인 실패에서는 기존 참조와 다운로드를 유지하며 실패를 성공으로 숨기지 않습니다.
**DB와 S3는 원자적이지 않습니다.** 프로세스 종료·동시 저장소 장애로 복원이 실패하면 503 `ATTACHMENT_RECOVERY_REQUIRED`를 반환하고
운영자 대조/복구가 필요합니다. commit 응답 유실 시 성공 여부를 단정할 수 없으므로 새 object도 지우지 않습니다.
실패 업로드/DB 실패 뒤 미참조 object가 남을 수 있습니다. 자동 정리 worker/outbox/버전 복원은 없으며 운영자가 DB object key와 버킷을 대조해야 합니다.
부팅 시 버킷 연결을 성공으로 가정하지 않으며, 없거나 접근할 수 없는 버킷은 실제 요청 시 503입니다.

### 선택 검증

```bash
# backend/content-service에서 로컬 선택 순수 단위만
./gradlew unitTest --tests 'ai.storyfork.content.attachment.AttachmentServiceTest' --tests 'ai.storyfork.content.attachment.AttachmentUploadHelperTest' --no-daemon
# 아래는 hosted CI 형식이며 로컬 자동 검증 목록이 아닙니다.
./gradlew integrationTest --tests 'ai.storyfork.content.attachment.*' --no-daemon
```

`AttachmentStorageClientTest`의 대역 HTTP와 `AttachmentMigrationLocationTest`의 H2/Flyway도 통합 계층입니다.
`AttachmentConfigTest`는 Spring·실제 DB, `SettingAttachmentHttpTest`는 HTTP·실제 DB·MinIO를 사용하므로 단위 계층에서 실행하지 않습니다.
설정·HTTP 검사는 `TEST_ATTACHMENT_DATABASE_URL`이 있을 때만 활성화합니다. 격리 DB 사용자는 `content_test`/빈 비밀번호이며 공유 DB에는 실행하지 않습니다.
HTTP 검사는 `TEST_ATTACHMENT_S3_ENDPOINT`와 테스트 AWS credentials가 필요하고 전용 `issue87-test` 비공개 버킷을 만듭니다.
실제 DB flush/deferred commit 실패와 저장소 응답 유실의 보상 동작을 검사하며 fault test 외의 HTTP lifecycle은 실제 MinIO를 사용합니다.
CI Content 통합 job이 임시 MinIO(`127.0.0.1:19087`)와 전용 `attachment_test` DB를 띄우고 `TEST_ATTACHMENT_*`를 설정하므로 첨부 설정·실제 HTTP 검사도 실행됩니다.
대역 HTTP·H2/Flyway 검사는 CI 통합 계층에 포함되며 실제 첨부 lifecycle 검증은 별도 승인된 격리 환경의 증거가 필요합니다.
`Required CI`는 최신 커밋의 실제 Actions 결과를 확인하기 전까지 검증 대기입니다.
#92는 화면·브라우저 호출부를 변경하므로 Aside에서 실제 정상·실패 입력/클릭/API/화면 결과 확인이 필요합니다. HTTP·저장소 검증만으로 브라우저 E2E를 통과 처리하지 않습니다.

## WorldStudio 개발 배포 명령

일반 서버 시작과 별도로 **Content 이미지**의 Boot `PropertiesLauncher`에서 `ai.storyfork.content.world.migration.WorldStudioMigration` main을 실행합니다. Auth/Content context 없이 독립 Flyway migrate·validate를 수행합니다. 기존 같은 DB를 `DATABASE_URL/USER/PASSWORD`로 받고 별도 DB·계정·풀은 없습니다. 기본 비활성이며 정확한 대상 allowlist·백업 복원 기록과 Content fresh 전환 승인이 필요합니다. CD는 ingress/구 writer 중지 뒤 명령 성공을 확인하고 새 앱을 시작하며 실패 시 자동 rollback하지 않습니다.
자격증명·운영자 절차는 [WorldStudio 배포 문서](../../docs/deployment/worldstudio-v1-rollout.md)를 참고하세요.

## 작품 표지·원고 이미지 (#92)

> 회차 이미지 목록·대체 텍스트(`content_image.alt_text`, contentimage V2)·공개 대체 텍스트 조회는 [원고 가져오기·내보내기 계약](../../docs/design/manuscript-import-export-contract.md) 5절을 따릅니다.

기존 비공개 S3 client·바이트 검증·인증/CSRF와 bounded attachment connection pool을 재사용합니다. `attachment/controller → AttachmentService → JPA repository / AttachmentStorageClient`가 파일 정본을 소유하고 기존 Content 저장 구조를 전환하지 않습니다. `content_image`의 회차 0은 작품당 표지 하나, 양수는 실제 회차 이미지이며 새 Flyway leaf/history는 `db/migration/contentimage` / `content_image_schema_history`입니다. Auth·설정 첨부·이미지·독립 Studio SQL 바이트/history는 보존합니다. Content 업무 초기 스키마만 사용자 승인 fresh 이력으로 재작성했습니다.

| 메서드·경로 (`/api/v1` 기준) | 요청·응답·권한 |
|---|---|
| `GET /works/{workId}/cover` | 소유자 표지 metadata, 200 AttachmentResponse / 표지 없음 404 |
| `PUT /works/{workId}/cover` | multipart `file`, 생성·교체 200 AttachmentResponse |
| `DELETE /works/{workId}/cover` | 현재 표지 참조 삭제 204 |
| `GET /works/{workId}/cover/content` | 소유자 이미지 bytes |
| `GET /public/works/{workId}/cover/content` | 기존 공개 작품만 익명 bytes |
| `POST /works/{workId}/episodes/{number}/images` | 수정 가능한 소유 회차에 multipart `file`, 201 AttachmentResponse |
| `GET /works/{workId}/episodes/{number}/images/{imageId}/content` | 소유 회차의 이미지 bytes; inherited 회차는 고정된 원고에 포함된 참조만 허용 |
| `GET /public/works/{workId}/episodes/{number}/images/{imageId}/content` | 정확한 공개 회차 원고에 포함된 참조만 익명 bytes |

표지·본문은 PNG/JPEG와 위 10 MiB/픽셀/파일명 검증을 적용합니다. 응답 URL은 기존 공개 상대 경로이고 다운로드는 `private, no-store`, `nosniff`, 검증된 image MIME·inline disposition을 사용합니다. 타인/다른 회차/미존재는 404, 미인증 401, CSRF 403, 파일 검증 422/413, 회차 저장 이미지 10개 초과는 409, 저장소/DB 실패는 안전한 503입니다. 작품 행 잠금으로 표지 변경·회차 이미지 한도를 직렬화합니다.

원고는 `[[image:<UUID>]]`를 본문 문자열의 삽입 위치에 저장합니다. 서버는 동일 작품·회차에 업로드된 참조만 저장하며 `data:image` 본문은 거절합니다. 초안·불변 버전·복원·발행은 기존 계약을 사용합니다. 이미지 bytes는 불변이며 교체/삭제 API를 두지 않습니다. 현재 원고에서 marker를 지워도 과거 버전의 bytes는 보존됩니다. **회차당 10개는 현재 참조 수가 아니라 업로드해 보존하는 원본 총수**이며 marker 삭제로 자리가 반환되지 않습니다. 기존 Fork의 기준 원고 접근만 재사용하며 새로운 설정 첨부 공유·발행 정책은 추가하지 않습니다.

표지 교체는 새 비공개 UUID object 업로드 후 DB 참조를 바꾸고 삭제는 DB 참조만 지웁니다. 실패·모호한 commit으로 기존 파일을 잃지 않도록 이전 표지와 실패 업로드의 미참조 object는 보존할 수 있습니다. 따라서 논리 삭제는 버킷 원본의 즉시 영구 삭제가 아닙니다. 자동 lifecycle/정리 worker는 없으며 운영자가 DB key와 비공개 버킷을 대조·정리해야 합니다. DB/S3 분산 원자성·저장 비용/운영 삭제 정책은 보장하지 않습니다.

프론트 `/content` 작품 생성의 선택 표지, 기존 표지 관리, 실제 설정 첨부 CRUD와 `/studio/{UUID}` 커서 위치 본문 이미지가 이 API를 사용합니다. 생성 후 표지 실패는 생성된 작품을 유지해 중복 생성 없이 재시도합니다. 취소/응답 유실은 서버 미처리를 보장하지 않으므로 새로고침으로 확인합니다. 브라우저는 인증 bytes → Blob URL로 표시하고 교체·이탈 시 해제하며 TXT 내보내기는 이미지·marker 없는 텍스트 전용입니다. EPUB은 추가하지 않습니다.

Content 세계관의 `world.entity`·`world.repository`와 독립 WorldStudio의 `world.studio.entity`·`world.studio.repository`는 별도 JPA 스캔 범위입니다. Content의 `WorldRepository`(String)와 WorldStudio의 `StudioWorldRepository`(UUID)를 구분하며, WorldStudio 비활성 시 Content에 독립 스키마를 요구하지 않습니다. 공존 검증은 현재 WorkService·WorldService와 WorldStudioService로 수행합니다.
