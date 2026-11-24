# STORYFORK Operations Service

공지·이벤트·고객지원 문의/답변 **레코드의 독립 백엔드 CRUD**와 회원 Bearer 기반 **신고·회원·관리자·작품·댓글·고객지원 문의 운영 API**입니다. 회원 Bearer API(신고·회원·관리자·작품·댓글·고객지원 문의·크레딧)만 Core(인증 확인·회원·크레딧)를, 신고·작품·댓글만 Content(작품 조회·제한, 댓글 조회·숨김)를 호출합니다. 운영 대시보드·LLMOps·경고 API([계약](../../docs/design/operations-llmops-contract.md), DEC-55)는 여기에 더해 Langfuse(추적·지표·프롬프트·모델·평가)와 AI(회귀 평가 실행·누설 판정)를 호출하고 경고 알림을 RabbitMQ로 발행합니다. `Controller → Service → JpaRepository`를 사용하며 DTO는 각 리소스의 `service/dto`, Entity는 `entity`에 둡니다. 목표 책임과 후속 업무는 [서비스 경계](../../docs/design/service-boundaries.md)를 따릅니다.

> 인증은 네 갈래입니다. 공지·이벤트·문의의 `/notices`·`/events`·`/inquiries` API는 **서비스 자격 인증만** 사용하며 사람의 관리자 권한, 회원 신원·소유권, ‘내 문의’, 공개 게시·이벤트 진행 상태·참여·보상·알림·감사는 구현하지 않습니다. 서비스 토큰을 가진 호출 서버는 이 레코드에 모두 접근할 수 있으므로 브라우저에 직접 연결하면 안 됩니다. 신고·회원·관리자 API(`/reports`·`/members`·`/admins`), 운영 작품 API(`/works`), 운영 댓글 API(`/comments`), 회원 고객지원 문의 API(`/support/inquiries`), 공지·이벤트 관리자 API(`/admin/notices`·`/admin/events`), 관리자 활동 기록 조회(`/admin/activities`, [활동 기록 계약](../../docs/design/operations-admin-activity-contract.md))는 회원 Bearer를 Core로 확인하고 운영자(`operator`)+업무 권한으로 인가합니다([신고·회원·관리자 계약](../../docs/design/operations-member-report-contract.md), [고객지원 문의 계약](../../docs/design/operations-support-inquiry-contract.md)). 공지·이벤트 독자 조회(`/public/notices`·`/public/events`)는 인증 없이 GET만 허용합니다([공지 계약](../../docs/design/operations-notice-contract.md)). 이벤트의 관리자 CRUD와 공개 조회는 [이벤트 관리자·공개 API](#이벤트-관리자공개-api)를 따릅니다. AI 작업 워커가 정기 작업을 실행시키려고 부르는 `/internal/v1/jobs/**`는 Core·Content·AI가 공유하는 내부 토큰(`X-Internal-Token`)만 받는 전용 체인입니다([작업 감시와 정기 작업 실행](#대시보드llmops경고-api)).

## 실행 기반·설정

- 독립 Gradle 프로젝트 `storyfork-operations-service`, group `ai.storyfork`, package `ai.storyfork.operations`
- 진입점 `OperationsServiceApplication` (`Application.kt`), JDK 21·Kotlin 2.4.10·Spring Boot 4.1.0
- 기본 bind **`127.0.0.1:8082`** 유지. 포트 변경은 Spring 표준 `--server.port` 옵션을 사용합니다.
- 기존 Content와 같은 Kotlin JPA/all-open 플러그인 및 Boot-managed WebMVC·JPA·Validation·Security·Flyway PostgreSQL·Jackson Kotlin을 사용합니다. 별도 서버·DB 제품·worker는 추가하지 않습니다.

설정의 정본은 루트 `.env`이고 공유 예시는 루트 [`.env.example`](../../.env.example)뿐입니다. 실제 `.env`를 덮어쓰거나 서비스별 `.env`를 만들지 않으며 루트 전체를 source하지 않습니다. 신뢰하는 서버 프로세스에 필요한 값만 전달합니다.

| 환경변수 | 기본값 / 의미 |
|---|---|
| `DATABASE_URL` | `jdbc:postgresql://127.0.0.1:5432/storyfork` — 기존 PostgreSQL 연결 |
| `DATABASE_USER` | `storyfork` — 운영 schema에 필요한 권한을 가진 DB 사용자 |
| `DATABASE_PASSWORD` | 빈 값 — 실제 실행 환경의 DB 자격을 별도 설정 |
| `OPERATIONS_SERVICE_TOKEN` | 빈 값 — 비어 있거나 공백뿐이면 **보호 접근을 허용하지 않음**. Core·Content 호출 시 같은 값을 `X-Operations-Service-Token`으로 전송 |
| `OPERATIONS_CORE_BASE_URL` | `http://127.0.0.1:8080` — Core(인증 확인·회원 API) |
| `OPERATIONS_CONTENT_BASE_URL` | `http://127.0.0.1:8081` — Content(작품·댓글 조회·조치 API, 운영 통계, 누설 기준) |
| `OPERATIONS_LANGFUSE_BASE_URL` | `http://127.0.0.1:3000` — Langfuse Public API. 관리자는 Langfuse 웹에 들어가지 않고 서비스가 프로젝트 키로만 접근 |
| `LANGFUSE_PUBLIC_KEY`·`LANGFUSE_SECRET_KEY` | 빈 값 — AI와 같은 Langfuse 프로젝트 키(Basic 인증). 비어 있으면 Langfuse 호출이 502라 대시보드 AI 칸은 `unavailable`이다. 서비스 토큰은 Langfuse에 보내지 않는다 |
| `OPERATIONS_AI_BASE_URL` | `http://127.0.0.1:8000` — AI 서비스(회귀 평가 실행·누설 판정·정기 작업 접수). 읽기 제한 30초 |
| `INTERNAL_TOKEN` | 빈 값 — Core·Content·AI가 공유하는 내부 토큰(`X-Internal-Token`). AI를 부를 때 보내고, AI 작업 워커가 운영 `/internal/v1/jobs/**`를 부를 때 받는 쪽 인증으로도 쓴다(비어 있으면 그 경로는 항상 401) |
| `OPERATIONS_RABBITMQ_HOST`·`_PORT`·`_USERNAME`·`_PASSWORD` | `localhost`·`5672`·빈 값·빈 값 — Core와 같은 RabbitMQ(`storyfork.events`). 연결 제한 5초, 발행 실패는 로그만 남긴다 |

DB 자격과 서비스 토큰은 Operations 및 허용된 서버에만 주입합니다. 서비스 토큰은 JWT 서명 키·회원 Bearer·Content 인증 토큰과 재사용하지 말고 충분히 긴 무작위 값(32자 이상 권장)을 생성합니다. 로그·스크린샷·브라우저 번들·`VITE_*`·build ARG·저장소에 넣지 않습니다. 외부 네트워크에서 사용할 때 TLS와 신뢰 서버 경계를 별도 마련해야 하며, loopback 바깥 바인딩이나 배포는 이번 범위가 아닙니다.

아래는 **수동 실행 안내**이며 개발 검증이 앱·DB를 자동 기동하지는 않습니다. 필요한 환경변수만 이미 해당 프로세스 환경에 제공한 뒤 실행합니다.

```bash
JAVA_HOME=$(/usr/libexec/java_home -v 21) ./gradlew bootRun
```

DB 연결과 schema 초기화 권한이 필요합니다. 이전의 ‘DB 없이 실행하는 골격’ 설명은 이 CRUD 구현에 적용되지 않습니다. 실제 공유 DB에 적용하거나 데이터를 폐기할 권한을 부여하지 않습니다.

## 서비스 인증·오류

아래 회원 Bearer API와 공개 공지·이벤트 조회를 제외한 모든 `/api/v1/operations/**` 요청은 단일 `X-Operations-Service-Token` 헤더를 요구합니다. 고정 길이 SHA-256 digest를 `MessageDigest.isEqual`로 비교하며 중복 헤더·빈 값·틀린 값·누락 설정은 401입니다. 입력 토큰을 임의로 trim하지 않습니다. `Authorization: Bearer`, 쿠키, `X-Auth-User` 등은 인증 대체 수단이 아닙니다.

Security는 stateless이며 로그인 폼·Basic·로그아웃·request cache·세션 쿠키 인증을 사용하지 않습니다. 기본 사용자 계정도 만들지 않습니다(`spring.autoconfigure.exclude`로 Boot의 `UserDetailsServiceAutoConfiguration`을 제외하며 `ApplicationPropertiesTest`가 고정합니다). 변경 요청의 권한은 브라우저 CSRF 쿠키가 아니라 서비스 헤더에만 의존합니다. 브라우저 CORS 허용을 추가하지 않으며 토큰 보관·사람별 권한 검사를 프런트엔드에 맡기지 않습니다. 서비스 자격을 갖춰도 운영 API 밖의 경로는 403으로 거절합니다.

안전한 공통 오류 DTO는 `{ "code": "...", "message": "..." }`입니다. 원문 입력·토큰·SQL·예외 reason/stack을 응답에 넣지 않습니다. 예외로 포크 정합성 점검(`GET /works/{id}/fork-integrity`)은 Content가 보낸 400/404/409 안내 문구(Content 공개 실패 계약이라 원문·DB 예외를 담지 않음)를 `message`에 그대로 전하며 코드는 아래 표 그대로입니다. 장르 API(`/genres`)도 Content의 안내 문구를 전하고 Content가 `code`를 보내면 그 코드를 씁니다(아래 장르 항목).

| HTTP | code | 상황 |
|---|---|---|
| 400 | `INVALID_REQUEST` | 잘못된 UUID/JSON·필수 값·길이·U+0000·기간 순서 등 입력 검증 실패 |
| 401 | `UNAUTHORIZED` | 서비스 토큰 없음/오류/중복 또는 서버 토큰 미설정 |
| 403 | `FORBIDDEN` | 서비스 자격으로 허용되지 않은 경로 접근 |
| 404 | `NOT_FOUND` | 레코드 없음, 다른 문의에 속한 답변 접근, 없는 운영 API 경로 |
| 405 등 | `REQUEST_FAILED` | 메서드 불일치 등 MVC HTTP 오류의 상태를 보존하고 상세 reason은 숨김 |
| 409 | `CONFLICT` | 낙관적 동시성 충돌, 답변이 남은 문의 삭제, DB 참조 충돌 |
| 422 | `REQUEST_FAILED` | 이벤트 `linkPath`가 사이트 안 경로 규칙을 어김. Core 크레딧 규칙 위반(금액·사유)은 Core의 `code`·안내 문구를 그대로 전함 |
| 500 | `INTERNAL_ERROR` | 예상하지 못한 실패; 성공 fallback 없음 |
| 502 | `UPSTREAM_FAILED` | Core/Content 호출 실패(아래 회원 Bearer API); 상태·이력 미기록 |

오류 advice에는 `basePackages` 같은 선택자를 두지 않습니다. 선택자가 있으면 컨트롤러가 정해지기 전에 나는 오류(없는 경로 404, 메서드 불일치 405 등)에는 advice가 적용되지 않아 위 DTO로 응답하지 못합니다. Spring `ErrorResponse` 계열 예외(검증 실패·필수 파라미터 누락·`ResponseStatusException`·프레임워크 404/405)는 개별 핸들러 없이 `Exception` 공통 분기가 상태 코드별로 위 표대로 응답합니다.

원인은 응답이 아니라 서버 로그에만 남깁니다. 500은 우리 쪽 결함이므로 `ERROR`로 원인 사슬과 스택을 남깁니다. 502는 Core/Content 장애를 계약대로 처리한 결과이므로 `WARN` 한 줄에 예외 클래스명(원인 사슬)·하위 HTTP 상태(있으면)·요청 경로만 남깁니다. RestClient 5xx 예외 메시지에는 하위 응답 본문이, I/O 원인 메시지에는 URL이 들어갈 수 있어 502는 예외 메시지와 스택을 쓰지 않으며, 그래서 쿼리(회원 검색어 등)와 하위 응답 본문이 로그에 남지 않습니다. 핸들러는 5xx만 기록하며 요청 본문·헤더·토큰·쿼리를 직접 쓰지 않습니다(500은 예외를 그대로 남기므로 예외 메시지에 든 값까지는 걸러지지 않습니다).

## API 계약

기본 경로는 `/api/v1/operations`이며 UUID는 서버가 생성합니다. 각 요청에 서비스 토큰이 필요하고 JSON 생성/전체 수정에는 `Content-Type: application/json`을 지정합니다.

| 리소스 | 목록 경로 | 요청 필드 |
|---|---|---|
| 공지 | `/notices` | `title`(1~200자·공백만 불가), `body`(1~20,000자·공백만 불가) |
| 이벤트 | `/events` | 공지와 같은 `title`, `body`; 선택 `startsAt`, `endsAt`(ISO-8601 Instant), `linkPath`(사이트 안 경로) |
| 문의 | `/inquiries` | `title`(1~200자), `body`(1~20,000자), `category`(1~50자); 공백만 불가 |
| 문의 답변 | `/inquiries/{id}/replies` | `body`(1~20,000자·공백만 불가) |

문의 `category`는 자유 텍스트 분류이며 회원 식별자나 확정된 유형 enum이 아닙니다. 이벤트 기간은 선택이며 둘 다 있으면 `endsAt >= startsAt`이어야 합니다. 이동 경로 `linkPath`도 선택이며(V10 `event.link_path`, DEC-57) `/`로 시작하는 사이트 안 경로만 받습니다: 200자 이하이고 `//`(`//host`·`://` 포함)·백슬래시·공백·제어 문자가 없어야 하며, 위반은 400이 아니라 422 `REQUEST_FAILED`입니다. 자동 진행 상태나 발행 여부는 계산하지 않습니다. 내용은 일반 텍스트 레코드이며 HTML 렌더링 계약이 아닙니다.

아래 동작은 각 목록 경로 `R`에 동일하게 적용합니다. 답변의 `R`에는 문의 UUID가 포함됩니다.

| 메서드·경로 | 성공 | 동작 |
|---|---|---|
| `POST R` | 201 + `Location: R/{생성 UUID}` | 생성 결과 DTO 반환 |
| `GET R?page=0&size=20` | 200 | 크기 제한 목록 DTO 반환 |
| `GET R/{resourceId}` | 200 | 상세 DTO 반환 |
| `PUT R/{resourceId}` | 200 | 전체 필드 교체 후 DTO 반환 |
| `DELETE R/{resourceId}` | 204, 응답 본문 없음 | 명시적 삭제; 없는 ID는 404 |

- PUT은 PATCH가 아닙니다. 이벤트에서 기간·`linkPath`를 생략하거나 null로 보내면 기존 값을 비웁니다.
- 생성/수정 전 필수 값·길이는 요청 DTO의 `@NotBlank`·`@Size`가 컨트롤러의 `@Valid`에서 검증하고, 서비스는 공백·이벤트 기간 순서·모든 문자열의 U+0000 포함 여부를 다시 검증합니다. `@NotBlank`(Hibernate Validator의 `String.isBlank`)는 U+00A0·U+2007·U+202F만 있는 값을 통과시키고 DB `CHECK (~ '[^[:space:]]')`도 이 문자를 통과시키므로 서비스의 `isNotBlank`가 이를 400으로 거절합니다. 길이는 DTO `@Size`만 검사하며 서비스가 되풀이하지 않습니다(서비스 토큰 컨트롤러는 `@Valid`로, `/admin/notices`·`/admin/events`는 권한 확인 뒤 `AdminNoticeService`·`AdminEventService`가 같은 어노테이션을 직접 검증합니다). 공지·이벤트의 제목/본문, 문의의 분류/제목/본문, 답변 본문에 U+0000이 있으면 저장·변경 전에 거절하며 기존 필드와 수정 시각을 보존합니다. 잘못된 생성 요청은 Repository를 호출하지 않습니다.
- 공지/이벤트/문의 응답은 `id`, 요청 필드, `createdAt`, `updatedAt`입니다. 답변에는 `inquiryId`도 있습니다. 모든 시각은 UTC Instant입니다.
- 목록은 `items`, `page`, `size`, `totalElements`, `totalPages`를 갖는 명시적 DTO이며 네 목록이 제네릭 `PageResponse<T>`(`_common/service/dto`) 하나를 공유합니다. JPA Entity나 Spring `Page`를 그대로 노출하지 않습니다.
- Pageable 기본값은 0부터 시작하는 page와 size 20이며 size는 최대 100입니다. 컨트롤러·서비스 코드가 아니라 `spring.data.web.pageable.default-page-size=20`·`max-page-size=100` 설정이 정하며 `ApplicationPropertiesTest`가 값을 고정합니다. 공지·이벤트·문의 목록은 `createdAt DESC, id DESC`, 문의 하위 답변 목록은 대화 순서인 `createdAt ASC, id ASC`로 고정합니다. 클라이언트 sort를 사용하지 않고 같은 시각도 UUID로 순서를 안정화합니다.
- 답변은 URL의 문의에 속해야 합니다. 답변이 남은 문의는 409이며 자동 cascade 삭제하지 않습니다. 먼저 해당 답변을 명시적으로 삭제해야 합니다. 이는 운영 레코드 관계 보호이지 회원 소유권 검사나 전체 제품 삭제 정책이 아닙니다.

요청 본문 예시(실제 자격은 문서나 소스에 기록하지 않습니다):

```json
{ "title": "공지 제목", "body": "공지 내용" }
```

```json
{
  "title": "이벤트 안내",
  "body": "이벤트 설명",
  "startsAt": "2026-11-05T00:00:00Z",
  "endsAt": "2026-11-06T00:00:00Z"
}
```

```json
{ "title": "문의 제목", "body": "문의 내용", "category": "이용" }
```

```json
{ "body": "답변 내용" }
```

## 회원 Bearer API (신고·회원·관리자·공지 관리)

`/api/v1/operations/{reports,members,admins,support,admin/notices,admin/events,admin/activities,works,comments,genres,credits,world-studios,card-categories,feedback-reports,dashboard,llmops,alerts}`와 하위 경로는 별도 SecurityFilterChain입니다. `Authorization: Bearer …`를 Core `POST /internal/v1/auth/verify`(받은 Authorization + 서비스 토큰)로 확인해 `{memberId, operator}`를 principal로 씁니다. Bearer 없음은 401, Core 401/403은 그대로, 그 밖의 확인 실패는 502입니다. stateless·쿠키 없음이므로 CSRF를 쓰지 않으며, 이 경로에서는 서비스 토큰이 인증 수단이 아닙니다.

- 관리자 = Core `operator=true` **이면서** `operations.admin_permission`에 해당 키 보유(`rights`·`users`·`admins`·`feedback`·`notices`·`events`·`works`·`comments`·`credits`). 아니면 403.
- 신고: 접수·`mine`·운영 목록(`?status=`)·상세(+`history`)·`evidence`·`explanations`(POST/GET)·`review`·`restriction`(POST/DELETE)·`evidence-requests`. 접수는 201, 신고 변경 POST/DELETE는 200으로 갱신된 상세(`history` 포함), `GET …/explanations`는 `{ items: History[] }`. 증거 보완·소명·증빙 요청 본문은 1~5000자. 접수 본문의 `targetType`(`work`·`episode`·`world`, 없으면 `work`)이 신고 대상을 정합니다(V11): `work`는 `workId`(Content 운영 작품 목록에서 공개(`visibility` public)이고 미제한인 작품만), `episode`는 `workId`+`episodeNumber`(위 작품 조건에 더해 그 회차가 발행(`publicationStatus` published)됐고 미제한일 때만), `world`는 `worldId`가 필요하고(없으면 400) Content 세계관 목록에서 공개(`visibility` public·`published`·미제한)인 세계관만 받습니다(비공개·제한·저장 버전 없음·발행 안 된·없는 대상은 작품·회차·세계관 모두 같은 404이고 응답에 제목·이름이 실리지 않아 비공개 대상의 존재가 접수자에게 드러나지 않음). 종류가 묻지 않는 id는 무시합니다. 응답 `Report`에는 `targetType`·`episodeNumber`·`worldId`·`worldName`이 더해지고, world 신고의 `workId`·`workTitle`·`workOwnerId`는 null입니다(소유자 칸이 없어 신고자와 `rights` 관리자만 보며 소명 흐름이 없음). `restriction`(POST/DELETE)은 대상에 맞는 Content 내부 API(작품·회차·세계관 제한·해제)를 부릅니다.
- 회원: `GET /members?role=&q=&sort=`, `PUT|DELETE /members/{id}/restriction` — Core에 관리자 Bearer를 그대로 전달.
- 관리자: `GET /admins`(Core `role=ADMIN` + `permissions`), `POST /admins`(알려진 키 1개 이상 검증 → Core 생성 → 권한 저장, 201).
- 작품: `GET /works`는 Content `GET /internal/v1/works`의 전체 목록을 `{ items }`로 그대로 돌려주고, `PUT|DELETE /works/{id}/restriction`은 Content 내부 제한 API를 재사용해 `{ workId, ownerId, title, restricted }`를 돌려줍니다. `works` 권한 확인이 Content 호출보다 먼저이고 서비스 트랜잭션·신고 이력은 없습니다. 없는 작품은 404, 그 밖의 Content 실패는 502입니다. 경로 끝에 슬래시를 붙이지 않습니다([작품 조회 계약](../../docs/design/operations-work-contract.md)).
- 회차(작품 하위, [콘텐츠 운영 관리 확장](../../docs/design/operations-work-contract.md#콘텐츠-운영-관리-확장-회차세계관카드-카테고리-2026-11-23)): `GET /works/{id}/episodes`는 Content 내부 목록(`[{number,title,publicationStatus,restricted,inherited}]`, 본문 없음·번호순)을 **맨 배열**로 그대로 돌려주고, `PUT|DELETE /works/{id}/episodes/{number}/restriction`은 Content 내부 회차 제한·해제의 그 회차 한 원소를 그대로 돌려줍니다. `works` 권한 확인이 Content 호출보다 먼저이고 서비스 트랜잭션이 없으며, Content의 400/404/409/422는 상태를 보존하고 안내 문구와 `code`(Fork가 물려받은 회차는 409 `EPISODE_INHERITED`)를 전하고 그 밖의 실패는 502입니다. 성공하면 활동 기록 `episode.restrict`·`episode.unrestrict`(`episode`·`<작품 ID>:<회차 번호>`·회차 제목)를 남깁니다.
- 댓글: `GET /comments`는 Content `GET /internal/v1/comments`의 전체 댓글(숨김 포함, 원문 `body`)을 `{ items }`로 그대로 돌려주고, `PUT|DELETE /comments/{commentId}/hidden`은 Content 내부 숨김·게시 복구 API를 재사용해 `OperationsComment`를 돌려줍니다(필드는 계약이 정본). `commentId`·`workId`·`authorId`는 모두 String이라(Content id·author_id는 varchar) 비 UUID 값 한 행이 목록 전체를 502로 만들지 않고, 목록에 보인 id는 그대로 조치할 수 있습니다. `comments` 권한 확인이 Content 호출보다 먼저이고 서비스 트랜잭션·신고 이력은 없습니다. 없는 댓글은 404, 그 밖의 Content 실패는 502입니다. 경로 끝에 슬래시를 붙이지 않습니다([댓글 계약](../../docs/design/operations-comment-contract.md)).
- 장르([장르 관리 계약](../../docs/design/genre-management-contract.md), DEC-56): `GET|POST /genres`(추가는 201)·`PATCH /genres/{code}`·`PUT /genres/order`는 Content 내부 장르 API(`/internal/v1/genres`)의 JSON을 그대로 돌려줍니다. `works` 권한 확인이 Content 호출보다 먼저이고 서비스 트랜잭션은 없습니다. Content의 400/404/409/422는 상태를 보존하고 안내 문구와 `code`(`GENRE_NAME_TAKEN`·`GENRE_FEATURED_LIMIT`)를 전하며(`code`가 없으면 상태별 일반 코드, 422는 `REQUEST_FAILED`) 그 밖의 실패는 502입니다. 성공하면 활동 기록 `GENRE_CREATE`·`GENRE_UPDATE`(`GENRE`·장르 코드·이름)·`GENRE_REORDER`(`GENRE`·`order`·새 순서의 코드 목록)를 남깁니다. 경로 끝에 슬래시를 붙이지 않습니다.
- 세계관(DEC-45 공개 세계관의 운영 조회·제한): `GET /world-studios`는 Content 내부 목록(`[{worldId,ownerId,name,visibility,published,restricted,genre,linkedWorkId,createdAt}]`, 지우지 않은 전체·최신순)에 `ownerName`(소유자의 Core 최신 닉네임, 목록에 없으면 null; Core 닉네임 일괄 조회 `POST /internal/v1/members/nicknames`에 운영 서비스 토큰만 보내 200개씩 나눠 조회하며, 200명에서 끊기는 회원 목록과 관리자 Bearer 전달은 쓰지 않음)만 더해 **맨 배열**로 돌려주고, `PUT|DELETE /world-studios/{id}/restriction`은 Content 내부 제한·해제의 그 세계관 한 원소(`ownerName` 없음)를 그대로 돌려줍니다. 제한은 공개 세계관 경로(목록·상세·카드 검색·이미지·가져오기)만 막고 연결된 소설 위키·Fork 이어받기는 건드리지 않습니다. 권한·오류·트랜잭션은 회차와 같고(Core 닉네임 조회가 실패하면 이름을 비운 채 내보내지 않고 502), 활동 기록은 `world.restrict`·`world.unrestrict`(`world`·세계관 ID·세계관 이름)입니다.
- 세계관 카드 카테고리(장르 관리와 같은 패턴): `GET|POST /card-categories`(추가는 201)·`PATCH /card-categories/{code}`·`PUT /card-categories/order`는 Content 내부 API(`/internal/v1/card-categories`)의 JSON을 그대로 돌려줍니다(목록은 **맨 배열**, 숨김 포함·`position` 순, 삭제 없음). 권한·오류·트랜잭션은 장르와 같고(`CARD_CATEGORY_NAME_TAKEN` 409, 입력·순서 오류 422) 활동 기록은 `card_category.create`·`card_category.update`(`card_category`·카테고리 코드·이름)·`card_category.reorder`(`card_category`·`order`·새 순서의 코드 목록)입니다.
- 독자 제보 열람([제보 계약](../../docs/design/feedback-report-suggestion-contract.md#운영자-열람-750-사용자-결정-2026-11-24), #750): `GET /feedback-reports?status&page&size`는 Content 내부 API(`/internal/v1/feedback-reports`)의 JSON(`{items,page,size,totalElements,totalPages}`)을 그대로 돌려줍니다. 운영자는 **읽기만** 하고 처리(확인·답변·상태 변경)는 작가 몫이라 쓰기 경로·활동 기록·저장이 없습니다. `feedback` 권한(같은 탭의 고객지원 문의와 같은 키) 확인이 Content 호출보다 먼저이고 서비스 트랜잭션이 없습니다. 쿼리는 있는 것만 Content에 넘기며 `page`·`size`가 숫자가 아니면 400, Content의 400/404/409/422는 상태와 안내 문구를 전하고 그 밖의 실패는 502입니다. 경로 끝에 슬래시를 붙이지 않습니다.
- 크레딧([크레딧 운영 계약](../../docs/design/operations-funnel-credit-contract.md#2-크레딧-운영-core-정본--운영-중계), DEC-57): `GET /credits/members/{memberId}`(종류별 잔액·내역)와 `POST /credits/members/{memberId}/grants`·`/revocations` `{amount, reason}`(성공은 201과 갱신된 잔액)은 Core 내부 API(`/internal/v1/credits/members/{memberId}`와 그 하위 `/grants`·`/revocations`, 관리자 Bearer 전달)의 JSON을 그대로 돌려줍니다. `credits` 권한 확인이 Core 호출보다 먼저이고 서비스 트랜잭션은 없습니다. 금액(정수 1~100,000)·사유(앞뒤 공백 제거 뒤 1~200자)·잔액 안 회수는 Core가 판단하므로 운영은 검사하지 않고(빠진 값은 null로, 금액은 `1.5`도 그대로 보내 Core가 422로 거절합니다), Core의 404·409 `CREDIT_INSUFFICIENT`·422 `INVALID_CREDIT_REQUEST`는 상태와 안내 문구·`code`를 그대로 전하며 그 밖의 실패는 502입니다. 성공한 뒤에만 활동 기록 `CREDIT_GRANT`·`CREDIT_REVOKE`(`MEMBER`·회원 ID·`<금액> · <사유>`)를 남깁니다. 요청 중복 방지 키가 없어 화면의 버튼 잠금으로만 막습니다. Core가 성공한 뒤 활동 기록 저장이 실패하면 요청은 500이지만 지급·회수는 적용된 상태(분산 트랜잭션 없음)이고, 같은 요청을 다시 보내면 한 번 더 적용됩니다. `POST /credits/balances` `{memberIds:[…]}`(최대 100명은 Core가 판단)는 Core 묶음 잔액 내부 API(`/internal/v1/credits/balances`, 관리자 Bearer 전달)의 **맨 배열** `[{memberId,total}]`을 그대로 돌려줍니다(없는 회원은 빠짐). `credits` 권한 확인이 Core 호출보다 먼저이고 조회라 활동 기록은 남기지 않습니다. 경로 끝에 슬래시를 붙이지 않습니다.
- 고객지원 문의 `/support/inquiries`: 로그인 회원이 접수(`POST`, 201)·내 문의(`GET /mine`)·상세(`GET /{id}`, 작성자 또는 관리자)를 쓰고, `feedback` 관리자가 목록(`GET ?status=WAITING|ANSWERED`, 최신 100개)과 답변 등록·수정·삭제(`/{id}/replies[/{replyId}]`)를 합니다. 모든 응답은 답변을 오래된 순으로 담은 `SupportInquiry`이고 `status`는 답변 유무로 계산합니다. `member_id`(V6)가 있는 문의만 다루므로 서비스 토큰 API로 만든 기존 레코드는 404이며 `/inquiries` 서비스 토큰 API는 그대로입니다. 다른 사람의 문의는 404, 접수 입력 검증은 `/inquiries`와 같은 규칙(category·title 앞뒤 공백 제거)입니다. 경로·응답 형태는 [고객지원 문의 계약](../../docs/design/operations-support-inquiry-contract.md)을 따릅니다.
- 관리자 활동 기록: `GET /admin/activities`(최신 100개, `admins` 권한, 수행자 닉네임은 Core 관리자 목록으로 채움). 회원·작품·회차·세계관·신고 조치, 관리자 생성, 카드 카테고리 추가·수정·순서 변경, 공지·이벤트 등록·수정·삭제, 문의 답변 등록·수정·삭제가 성공하면 수행자·시각·대상·내역을 남깁니다. 신고 검토·증빙 요청, 공지·이벤트, 문의 답변처럼 운영 DB만 바꾸는 조치는 변경과 기록을 한 트랜잭션으로 저장해 기록이 실패하면 변경도 롤백됩니다([활동 기록 계약](../../docs/design/operations-admin-activity-contract.md)).
- 공지 관리: `/admin/notices`의 `GET`(최신 100개)·`GET /{id}`·`POST`(201+`Location`)·`PUT /{id}`·`DELETE /{id}`(204). `notices` 권한 검사가 입력 값 검증·저장소 호출보다 먼저라 JSON 형식이 맞는 한 비관리자는 입력 값과 무관하게 403입니다. `@Valid`는 권한보다 먼저 400을 내므로 컨트롤러에 쓰지 않고, 권한 확인 뒤 `AdminNoticeService`가 `NoticeRequest`의 `@NotBlank`·`@Size`를 직접 검증해 위반은 400입니다. 공백·U+0000 검증·정렬·응답 DTO는 `/notices`와 같은 `NoticeService`를 재사용합니다([공지 계약](../../docs/design/operations-notice-contract.md)).
- 공개 공지 조회: `GET /api/v1/operations/public/notices`(최신 100개)·`/{id}`는 인증 없는 별도 SecurityFilterChain입니다. GET 이외는 서비스 토큰·Bearer가 있어도 403이고, 서비스 토큰 체인은 나머지 경로를 그대로 소유합니다. 이 체인(`PublicSecurityConfig`)은 `public/events`도 함께 맡습니다.
- Core·Content 하위 400/404/409는 상태를 보존하고(응답 문구는 위 표의 일반 문구) 그 외 실패는 502 `UPSTREAM_FAILED`이며 성공·이력으로 숨기지 않습니다. 포크 정합성 점검과 장르·회차·세계관·카드 카테고리 API(크레딧은 위 항목)만 `upstream(keepMessage = true)`로 Content의 안내 문구를 `message`에 전합니다([포크 정합성 점검 계약](../../docs/design/fork-integrity-contract.md)). 고정 timeout(connect 2s, read 5s, AI 호출만 read 30s)·재시도 없음.
- Content 호출(접수의 작품 조회, 제한·해제)은 DB 트랜잭션 밖에서 실행해 커넥션을 점유하지 않습니다. 호출이 성공한 뒤 신고 갱신·이력·관리자 활동 기록만 한 트랜잭션으로 저장하고, 조회 이후 신고가 바뀌었으면 `@Version`이 409로 거절합니다. 제한·해제는 저장이 실패하면 Content 쪽만 이미 바뀐 상태이며(분산 트랜잭션 없음) 같은 요청을 다시 보내면 맞춰집니다(Content PUT/DELETE는 멱등).

## 이벤트 관리자·공개 API

[이벤트 계약](../../docs/design/operations-event-contract.md)대로 기존 `EventService`의 저장·검증을 재사용하며 새 마이그레이션은 선택 이동 경로 `linkPath`(V10 `event.link_path`, [DEC-57 계약](../../docs/design/operations-funnel-credit-contract.md#3-이벤트-이동-기능표-70))뿐입니다. `linkPath`는 관리자 등록·수정·목록과 공개 조회 응답에 모두 실립니다. 서비스 토큰 `/events`는 그대로이고 브라우저에 열지 않습니다.

| 경로 | 인증 | 동작 |
|---|---|---|
| `/api/v1/operations/admin/events` `GET`·`POST`, `/{id}` `GET`·`PUT`·`DELETE` | 회원 Bearer + `operator` + `events` 권한(없으면 401/403) | 목록은 최신 등록순(`createdAt DESC, id DESC`) 최대 100개, 등록 201 + `Location`, 삭제 204, 없는 id 404 |
| `/api/v1/operations/public/events` `GET`, `/{id}` `GET` | 없음 | 같은 목록·상세(종료된 이벤트 포함). 쓰기 경로 없음 |

- 관리자 API는 권한 확인 뒤 `AdminEventService`가 `EventRequest`의 `@NotBlank`·`@Size`를 직접 검증하고 `EventService`가 공백·기간 순서·U+0000을 검증하므로(컨트롤러에 `@Valid` 없음) 권한 없는 요청은 입력 검증 400보다 403을 먼저 받습니다(깨진 JSON은 본문 해석 단계에서 먼저 400). 목록은 page 0·size 100 고정이며 페이지 매개변수를 받지 않습니다.
- `public/events`와 하위 경로는 `public/notices`와 같은 SecurityFilterChain(`PublicSecurityConfig`)이 `GET`만 `permitAll`하고 다른 메서드는 403 `FORBIDDEN`으로 거절합니다. 이 체인에는 인증 필터가 없어 Bearer·서비스 토큰이 있어도 결과가 바뀌지 않습니다.

## 대시보드·LLMOps·경고 API

[계약](../../docs/design/operations-llmops-contract.md)(DEC-55)·[AI 파이프라인 계약](../../docs/design/operations-ai-pipeline-contract.md)(DEC-58)대로 `/api/v1/operations/{dashboard,llmops,alerts}`와 하위 경로는 회원 Bearer 체인에 듭니다(서비스 토큰은 인증 수단이 아닙니다). 서비스가 권한을 입력·Langfuse 호출보다 먼저 확인하고, Langfuse·AI·Core·Content 실패는 502 `UPSTREAM_FAILED`(Langfuse 응답의 시각 형식이 깨진 경우도 같고, 대시보드만 칸별 `unavailable`), Langfuse에 없는 trace·프롬프트·평가는 404이고, v4 읽기 API(Observations·Metrics·Experiments·Scores)가 자체적으로 404를 답하면(그 API를 주지 않는 서버·주소) 없는 기록이 아니라 502입니다. 목록 응답은 `{ items }`이고 trace 목록과 파이프라인 노드 기록만 `{ items, page, size, total }`(쪽은 0부터, 20건 고정)입니다. 지표는 요청마다 Langfuse를 다시 읽습니다(캐시 없음).

| 경로 | 권한 | 동작 |
|---|---|---|
| `GET /dashboard` | 운영자 누구나 | 회원 수(Core)·오늘(한국 날짜)·7일 AI 요청·실패율·비용(Langfuse)·답변 대기 문의·접수 신고(운영 DB)·작가 검토 대기(Content)·미확인 경고 수. 출처가 실패하면(Langfuse 응답을 읽지 못하는 경우 포함) 그 칸만 `null` + `unavailable`(`core`·`langfuse`·`content`)이고 실패를 0으로 바꾸지 않습니다. 서비스 지표 `funnel`은 Content `GET /internal/v1/operations/funnel`(전체 기간 사용자 여정 집계, [DEC-57 계약](../../docs/design/operations-funnel-credit-contract.md))의 JSON을 모양 그대로 싣습니다. 마지막에 읽으므로 이 칸만 실패하면 앞서 읽은 Content 칸은 남고, Content가 이미 실패했으면 다시 부르지 않아 `funnel: null`입니다. 답변 대기 문의·접수 신고는 운영 DB 값이라 `pending`에 항상 채우고, 작가 검토 대기(`pending.authorReviews`)만 Content가 실패하면 `null` + `unavailable:["content"]`입니다. 요청이 0건인 기간의 `failureRate`는 `null`입니다(0%로 보이지 않게). `jobs` 칸 `{running, failedLast24h}`는 운영 정기 작업 실행 기록(`job_run`)과 Content 전처리 작업, Langfuse의 회귀 평가 실행을 더합니다: `running`은 `job_run`의 대기·실행 중 수 + Content 작업의 `queued`·`running`·`loading` 수 + 실행 중인 평가 수, `failedLast24h`는 24시간 안에 끝난 `job_run` 실패 수 + 24시간 안에 끝난 Content 작업 실패 수 + 시작이 24시간 안인 실패한 평가 수입니다(Content 쪽은 최신 100건, 평가는 끝난 시각이 없고 최신 50개만 읽습니다). 운영 기록과 Content는 `JobCountService.counts()`, 평가는 `evaluationCounts()`로 따로 세어 `job_failed` 경고 규칙은 `counts()`만 씁니다(Langfuse가 내려가도 경고 판정이 계속되게). Content를 읽지 못하면 이 칸도 `null`이고 `unavailable`에는 `content`가 한 번만 들어갑니다(`jobs`는 쓰지 않고 Content를 두 번 부르지도 않습니다). 평가 실행을 읽지 못하면(Langfuse) 평가를 뺀 값을 보이지 않고 이 칸이 `null`이며 `unavailable`에 `langfuse`가 한 번만 들어갑니다(평가는 Content 집계가 끝난 뒤에만 읽고, Content나 Langfuse가 이미 실패했으면 다시 읽지 않습니다) |
| `GET /llmops/traces?from&to&feature&status&userId&requestId&page`, `GET /llmops/traces/{id}` | `llm` | trace 목록·상세(Langfuse v4 Observations API v2). 목록은 **끝난 요청**(루트 관측 metadata `status`가 있는 것, 대기·취소 요청은 status가 없어 요청이 아님)을 traceId로 합쳐 한 줄로 보입니다(재개된 turn은 HTTP 요청마다 루트가 있어 가장 최근에 끝난 요청 기준). 기능은 태그 `feature:<키>`(없으면 루트 이름), 상태는 루트 metadata `status`, 지연은 루트 지연입니다. 토큰·비용은 그 trace의 generation 합(Metrics API v2, 쪽마다 한 번)이고 `total`은 Metrics API v2의 루트 수입니다. `status`·`requestId`는 루트 metadata `status`·`request_id` 일치 필터이고, 기간과 모든 필터는 Langfuse `filter` 매개변수 안에 담습니다. 상세는 루트와 모든 하위 관측을 시간순으로 주고, 입력·출력은 루트 값(없으면 가장 이른 입력·마지막 generation 출력)이며 JSON 문자열은 JSON으로 되돌려 줍니다. 단계마다 부모 단계 `parentObservationId`와 `input`·`output`·`metadata`(칸마다 앞 8,000자까지, JSON 글은 JSON으로 주고 넘으면 앞 8,000자만 글로)가 있어 실행 흐름 트리를 그릴 수 있습니다. `metadata`에서는 Langfuse SDK가 붙인 `scope.`·`resourceAttributes.` 키를 뺍니다(남는 키가 없으면 null) |
| `GET /llmops/metrics?from&to&groupBy=day\|feature\|model` | `llm` | 요청·실패율·시간 초과율·p50/p95 지연은 status가 있는 루트만 세고(대기·취소 요청은 요청이 아님; 끝난 요청이 없는 행의 비율·지연은 0이 아니라 `null`이고, p50/p95는 측정된 지연이 없어도 `null`이며, 요청·토큰·비용이 모두 없는 행은 응답에서 뺍니다), 토큰·비용은 모든 루트의 trace generation 합입니다(사용자=루트 metadata `credit_reservation_id`가 있는 trace, 나머지 플랫폼. 끝난 요청이 둘인 trace의 generation은 가장 최근 요청에 한 번만 셉니다). 채택률·승인률은 Content 통계(분모 0이면 `null`), 필터 복원률은 `null`. 기본은 최근 7일·`day`이고 날짜 키는 한국 날짜 |
| `GET /llmops/pipeline?from&to` | `llm` | AI 파이프라인(DEC-58) `{nodes:[{id,label,next,standalone,count,errors,p95LatencyMs,promptNames}]}`. 코드에 고정한 노드 20개(`llmops/service/PipelineNodes.kt`: 요청·Guard·메인·업무 Agent 7과 인물 시뮬레이션의 NovelBrain 기억 회상·도구·승인 반영, 단독 기능 7, 흐름 순서)마다 기간 안 observation 수·level ERROR 수·프롬프트 이름·p95를 줍니다. `next`는 흐름의 선이고 업무 Agent는 결과를 메인에 돌려주므로(Agent마다 `next`에 `main`) 순환이 있으며, 승인 반영이 있는 `writing`·`world`·`character_simulation`만 `apply`로, `apply`는 Content MCP 도구 `mcp`로 이어집니다. 업무 Agent·도구 노드는 태그 `feature:orchestration` 요청의 observation을 **이름 목록**(AI 코드의 실제 이름: `step.story_context`·`step.writing_editing`·`step.world.apply`·`mcp.*` 등)으로 가르고, 단독 노드(`rating_direct`는 `rating` 요청, `writing_editing`은 `writing`으로 시작하는 이름)는 태그 `feature:<키>` 요청 안에서 그 키로 시작하는 이름입니다(`rating.generation`·`world_review*`처럼 이름이 같은 observation도 요청 종류별로 따로 셉니다). Metrics API v2가 이름·level·프롬프트로 묶어 세므로 건수는 정확하고(요청 종류마다 건수·지연 2번씩, 모두 4번 읽음), p95는 노드 이름별 p95 중 가장 큰 값입니다. 기본 기간은 최근 7일이고 비었거나 거꾸로면 400 |
| `GET /llmops/pipeline/{nodeId}/records?from&to&level&page` | `llm` | 노드의 observation을 최신순 20개씩 `{items, page, size, total}`로 줍니다(쪽은 0부터, 최신 1,000개까지만 닿아 쪽 번호 50부터는 400, `total`은 Metrics API v2 건수). 항목은 `{id, traceId, name, type, startTime, latencyMs, level, statusMessage, model, promptName, promptVersion, input, output, metadata}`이고 입력·출력·메타데이터는 칸마다 앞 8,000자까지(JSON 글은 JSON으로, 넘으면 앞 8,000자만 글로)입니다. `latencyMs`는 시작~종료 밀리초이고 Langfuse 시각이 밀리초 단위라 같은 밀리초 안에 끝난 단계는 0이며, 종료 시각이 없으면 null입니다. 메타데이터에서는 Langfuse SDK가 모든 observation에 붙이는 `scope.`·`resourceAttributes.`로 시작하는 키를 뺍니다(8,000자는 남은 키 기준이고, 남는 키가 없으면 null). `level`은 Langfuse level 하나(`DEBUG`·`DEFAULT`·`WARNING`·`ERROR`, 없으면 전체, 그 밖의 값은 400)이며 Guard의 거절은 level이 아니라 출력 `allowed=false`(level DEFAULT)라 이 필터로는 걸러지지 않습니다. 없는 `nodeId`는 404이고 이 검사가 기간·level·쪽 검사보다 먼저입니다 |
| `GET /llmops/prompts`, `GET /llmops/prompts/{name}` | `llm` | 버전(새것부터)·라벨·생성 시각(Langfuse가 주는 경우만)·최신 평가 |
| `POST /llmops/prompts/{name}` | `llm` | 새 버전 등록(201, 라벨 없음). 본문 `{prompt, type?: text\|chat, config?, commitMessage?}` |
| `PUT /llmops/prompts/{name}/production` `{version}` | `llm` | production 라벨 이동. 그 버전의 최신 평가 Run(Experiment)이 통과가 아니면(없거나 실패·진행 중 포함) 409 `EVALUATION_REQUIRED`이고 이전 버전 복원도 같습니다 |
| `GET /llmops/models`, `POST /llmops/models` | `llm` | Langfuse 모델 정의 조회·등록(201). 본문 `{modelName, matchPattern, inputPrice?, outputPrice?}`, 가격은 토큰당 USD |
| `GET /llmops/evaluations`, `GET /llmops/evaluations/{runId}`, `POST /llmops/evaluations` | `llm` | 평가 Run(Experiment) 목록·상세, 회귀 평가 실행 요청(AI에 위임, 202 `{runId, dataset, prompt, version, status}`). 상세만 문항별 결과 `items:[{itemId, scores, failed, error?}]`(Langfuse Experiments items API `GET /api/public/experiment-items`로 항목 점수를 읽음, 본문 없음, 실패 먼저·항목 id 순, 앞 100개까지. 실패 = 항목 오류(생성 실패 level ERROR·점수 없음)·`pov_ok` 0·지표 하나라도 0.5 미만) |
| `POST /llmops/prompts/{name}/optimizations` `{version, maxMetricCalls?}` | `llm` | 프롬프트 자동 개선(GEPA, #823) 실행 요청(AI에 위임, 202 `{accepted, prompt, version, maxMetricCalls}`). `character_simulation.act`·`character_simulation.narrate`의 텍스트 버전만 되고(아니면 422 `OPTIMIZATION_UNSUPPORTED`) `maxMetricCalls`는 1~500·기본 150(밖이면 400), 없는 버전은 404, AI가 같은 프롬프트의 개선이 실행 중이라 409를 주면 409 `OPTIMIZATION_RUNNING`, 그 밖의 AI 실패는 502입니다. 성공하면 활동 기록 `PROMPT_OPTIMIZE`를 남깁니다. 새 버전 저장·평가는 AI 워커가 하고 후보 등록은 사람이 합니다 |
| `GET /llmops/leak-checks` | `llm` | 정보 누설 표본 검사 결과 최신 100개 |
| `GET /llmops/settings`, `PUT /llmops/settings` `{leakSampleRate}` | `llm` | 누설 검사 표본 비율(0~1, 기본 0.1) |
| `GET /alerts?status=open\|acknowledged\|resolved`, `PUT /alerts/{id}` `{status, note}` | `llm` 또는 `jobs` | 경고 목록(최신 100개)·확인(`acknowledged`)·조치 완료(`resolved`). 열림→확인→해결만 되고 해결된 경고나 같은 상태 반복은 409이며, 두 관리자가 동시에 처리하면 늦은 쪽은 낙관적 락(`version`)으로 409 `CONFLICT`입니다 |
| `GET /alerts/rules`, `PUT /alerts/rules/{key}` `{threshold, windowMinutes, enabled}` | `llm` | 경고 기준. 비율 기준은 0~1이고, 값 없이 켤 수 있는 것은 `leak_suspected`뿐입니다 |

- **평가 결과 읽기**(Langfuse v4): AI 서비스가 평가를 시작하면 Run(Experiment)이 `<프롬프트>@v<버전>-<UTC yyyymmddTHHMMSSZ>-<hex6>` 이름과 metadata(문자열) `prompt`·`version`·`dataset`·`tolerance`·`baselineRun`·`baselineVersion`으로 생기고, 끝나면 Experiment에 붙은 Run 수준 점수로 지표 평균(NUMERIC, 점수 metadata `baseline`·`delta`·`tolerance`)과 판정 `passed`(BOOLEAN)를 씁니다. 운영은 `GET /api/public/experiments`(시작 시각 하한 필수라 최근 1년, 이름 필터는 상세에서)로 Run을 읽고, 점수는 `GET /api/public/v3/scores?experimentId=<Experiment id,…>&fields=details,subject`로 목록의 Run을 한 번에 읽어 점수의 `subject`(`kind=experiment`, `id`=Experiment id)로 Run에 맞춥니다(v3의 BOOLEAN 값은 `true`/`false`). Run이 평가인지는 이름 형식으로 알고(프롬프트 이름에 `@v`가 있어도 마지막 `@v<번호>-…`가 기준), 이름이 다르면 metadata의 `prompt`·`version`으로 알며 둘 다 없는 실험은 건너뜁니다. `passed` 점수가 있으면 `completed`(통과 여부는 true/1.0), 없으면 `running`이고 시작 후 2시간이 지나도 없으면 `failed`입니다. production 승격의 409 판정도 그 버전 최신 Run의 `passed`로 합니다. `runId`는 Run 이름(AI가 `POST /internal/v1/evaluations`로 돌려주는 `runName`)입니다. 목록은 최신 Run 50개까지입니다.
- **정기 실행 로직**: `LlmAlertCheckService.run()`(켜진 AI 경고 규칙을 최근 구간 Langfuse 루트·generation 집계와 비교, 같은 구간은 한 번만 읽음, 문구의 1 미만 금액·비율은 유효숫자 2자리로 적어 작은 값이 `$0.00`·`0.0%`로 보이지 않게 함), `LeakSampleCheckService.run(from, to)`(끝난 요청이 있는 `metadata.fork=true` trace를 한 번씩 표본 비율로 뽑아 그 trace의 관측에서 답변(루트 출력, 없으면 마지막 generation 출력)을 읽고 Content의 원작 비공개 카드·미발행 회차 제목과 글자 대조해 하나라도 걸린 것만 사용자 질문(요청 루트 input의 `request`, 없으면 null)과 함께 AI 누설 판정(제목이 질문에 있어도 걸리면 넘기고 되풀이인지는 AI가 판단, 걸린 게 없으면 AI를 부르지 않고 `suspected=false`), 작품별 Content 호출은 실행당 한 번, 결과 저장, 의심이면 `leak_suspected` 경고), `AlertCleanupService.run()`(90일 지난 해결 경고 삭제)은 운영 스케줄러의 `ScheduledJobHandler` 빈이 `kind`별로 연결합니다(`llm_alert_check`·`leak_sample_check`·`regression_eval`·`alert_cleanup`, `jobs/service/LlmopsJobHandlers.kt`). 이 handler는 AI 작업 워커가 부르는 운영 `execute` API 안에서 실행됩니다(아래 '작업 감시와 정기 작업 실행'). 실행 기록의 `done`은 서비스가 알려 준 수(만든 경고·의심으로 판정한 답변·지운 경고)입니다. `leak_sample_check`는 실행 시각 직전 구간(기본 60분, 일정 `params.windowMinutes`로 1~10080분)을 봅니다. `regression_eval`은 일정 `params`의 `dataset`·`prompt`·`version`(셋 다 필수, 하나라도 없거나 형식이 틀리면 AI를 부르지 않고 실행 기록이 실패)으로 AI에 평가를 요청하고 Run 이름을 `targetId`에 남깁니다. 기록의 성공은 AI가 평가를 받았다는 뜻이고 통과 여부는 LLMOps 평가가 Langfuse Run에서 읽습니다. `job_failed` 규칙은 규칙의 `windowMinutes` 안에 끝난 `job_run` 실패 수와 Content 전처리 실패 수의 합(`JobCountService.counts()`, 대시보드 `failedLast24h`에서 회귀 평가 실행을 뺀 집계)이 `threshold` 이상이면 값=건수로 경고를 만듭니다(실패가 0건이면 기준이 0이어도 만들지 않고, 같은 규칙의 미해결 경고가 있으면 다시 만들지 않습니다). Langfuse(AI 규칙)와 Content(`job_failed`)는 따로 읽어 한쪽이 내려가도 다른 쪽 경고는 평가하고, 읽지 못한 쪽이 있으면 둘 다 시도한 뒤 실행 기록이 실패합니다(알림 검사가 Langfuse 장애로 계속 실패하면 그 실패가 `job_failed`에 잡힙니다).
- **작업 감시와 정기 작업 실행**(`/jobs/**`, [계약](../../docs/design/operations-funnel-credit-contract.md#4-작업-실행을-celery로-이관-리팩터링-2026-11-20-사용자-결정)): `GET /jobs/runs`는 운영 정기 작업 기록(`job_run`)·Content 전처리 작업·Langfuse의 회귀 평가 Run(`kind=evaluation`, `source=ai-evaluation`)을 같은 `JobRun` 모양으로 합쳐 새것부터 줍니다. 평가 Run은 `EvaluationService.recent`(권한 검사 없이 최신 50개를 점수와 함께 읽는 내부 읽기)에서 오고, Run 이름이 `id`·`targetId`, 생성 시각이 `startedAt`이며 `completed`는 `succeeded`(통과 여부와 무관), 끝난 시각·진행률은 없고 `trigger`는 `manual`이며 실패에는 고정 사유가 붙고 재실행 대상이 아닙니다. 한 출처를 읽지 못하면(Content·Langfuse) 나머지는 보이고 `unavailable`에 `content-preprocessing`·`ai-evaluation`을 적으며, `kind` 조건이 그 출처의 종류가 아니면 그 출처는 부르지 않습니다. `(page+1)*size`가 1,000을 넘으면 400인 규칙은 그대로입니다. 정기 작업은 스케줄러가 아니라 AI 작업 워커(Celery 큐 `jobs`)가 실행시킵니다: tick(1분)은 도래한 일정마다 `queued` 기록을 만들고 `JobDispatcher`가 AI `POST /internal/v1/jobs {runId, kind}`(`X-Internal-Token`)로 접수시키며(실패하면 그 기록을 failed+'작업을 AI 서비스에 접수하지 못했어요.'로 남김), 수동 재실행(`POST /jobs/runs/{id}/retry`)도 새 queued 기록을 커밋한 뒤 같은 길로 접수시킵니다(AI가 받지 않으면 502, 새 기록은 failed). 워커는 운영 `POST /internal/v1/jobs/runs/{runId}/execute`(본문 없음, `X-Internal-Token`, `InternalSecurityConfig`의 `/internal/v1/jobs/**` 전용 체인이고 그 밖 경로는 기존대로 거절)를 불러 `JobExecutionService`가 기존 handler를 끝까지 동기 실행하게 하고 상태·진행률·대상을 기록합니다. `queued`→`running`은 조건부 UPDATE 한 번(`JobRunRepository.claim`)으로 선점해 병렬 워커·재배달에도 handler는 한 번만 돌고, 선점하지 못하면 실행·변경 없이 409, 없는 `runId`는 404, handler 실패는 failed 기록의 200입니다. tick은 일정을 보기 전에 `queued`가 10분·`running`이 30분을 넘은 기록을 failed+'작업 워커 응답 없음'으로 닫아 그 일정이 막히지 않게 하고(한도는 고정 상수이며 30분을 넘겨 도는 handler는 실패로 기록된 뒤 끝나면 자기 결과로 덮어씁니다). 이 닫기와 AI 접수 실패 처리는 읽은 상태일 때만 바꾸는 조건부 UPDATE(`JobRunRepository.close`)라 그사이 선점·완료된 기록은 덮어쓰지 않고, 접수 응답을 잃었어도 워커가 이미 선점했으면 접수된 것으로 봅니다. 재시작 때는 `running`을 failed로 닫습니다.
- **경고와 알림**: 한 규칙의 미해결(열림·확인) 경고는 하나이고 `AlertRaiser`가 만듭니다(부분 UNIQUE가 경합도 막음). 만든 뒤 `llm` 또는 `jobs` 권한 운영자마다 `operations.alert.raised`를 `storyfork.events`로 발행하며([알림 사건 계약](../../docs/notification-event-contract.md), `target` `{type:"alert", id}`) 발행이 실패해도 경고는 남고 로그만 찍습니다(Outbox 없음). 수신자는 `admin_permission` 기준이라 Core 운영자 자격을 잃은 옛 권한 행도 받을 수 있습니다.
- **관리자 활동 기록**(성공 뒤 `AdminActivityService.record`, DB만 바꾸는 조치는 한 트랜잭션): `PROMPT_CREATE`(`PROMPT`·이름·`v<번호>`)·`PROMPT_PROMOTE`(`PROMPT`·이름·`v<번호>`)·`MODEL_CREATE`(`MODEL`·모델 id·이름)·`EVALUATION_RUN`(`EVALUATION`·Run 이름·`데이터셋 · 프롬프트 v<번호>`)·`ALERT_ACKNOWLEDGE`·`ALERT_RESOLVE`(`ALERT`·경고 id·규칙 키)·`ALERT_RULE_UPDATE`(`ALERT_RULE`·규칙 키·`threshold=… windowMinutes=… enabled=…`)·`LLMOPS_SETTING_UPDATE`(`LLMOPS_SETTING`·`leak_sample_rate`·값).
- **한계(ponytail)**: trace 집계·목록은 기간 안 최신 루트 1,000건까지(목록은 최신 1,000개 trace만 쪽으로 닿아 쪽 번호 50부터는 400)이고, 토큰 합은 Metrics API 1,000행까지입니다(trace id로 묶으려면 행 수 제한과 비용 내림차순 정렬이 필요합니다). 목록의 `total`은 루트 수라 끝난 요청이 둘인 trace는 둘로 세고, 쪽의 토큰·비용은 한 주 전부터 읽어 그보다 오래 기다렸다 재개한 turn은 그 이후분만 보입니다. 평가는 Run을 최근 1년까지 읽어 그보다 오래된 평가는 승격 판정에서 없는 것으로 봅니다. 프롬프트 목록은 버전마다 Langfuse를 한 번씩 읽습니다. 누설 대조는 단순 부분 문자열이라 JSON 답변 안에서 이스케이프되는 제목(따옴표·줄바꿈)은 놓칩니다. 경고 기준(규칙)을 동시에 바꾸면 마지막 저장이 이깁니다(경고 처리는 버전으로 늦은 쪽이 409). 파이프라인은 노드와 observation 이름이 코드에 고정이라 AI에 새 Agent·observation이 생기면 `PipelineNodes.kt`도 고쳐야 하고(목록에 없는 이름은 어느 노드에도 세지 않고, 단독 요청 `manuscript_review`·`web_research`는 노드가 없으며, 이름으로만 가르므로 `retrieval`은 시뮬레이션이 불러도 작품 질문 노드에 셉니다), Metrics API 한 번에 1,000묶음(이름×level×프롬프트)까지 읽고, 노드 p95는 풀링 백분위가 아니라 이름별 p95의 최댓값입니다.

## 저장·동시성

기존 PostgreSQL 아키텍처 안에서 **`operations` schema만** 사용합니다. Flyway location은 `classpath:db/migration/operations`, 기본 schema는 `operations`, 전용 history는 `operations.operations_flyway_schema_history`입니다. V1은 공지, V2는 이벤트, V3은 문의/답변, V4는 관리자 업무 권한(샘플 관리자 12개 권한 시드), V5는 신고/신고 이력, V6은 문의 작성자 `member_id`(회원 접수 문의만 값이 있고 기존 서비스 토큰 레코드는 NULL), V7은 관리자 활동 기록(삽입 전용), V8은 경고 규칙·경고·LLMOps 설정·누설 검사 결과(Langfuse가 정본인 추적·프롬프트·평가는 저장하지 않음), V11은 신고 대상 확장(`target_type`·`episode_number`·`world_id`·`world_name`을 더하고 world 신고를 위해 `work_id`·`work_title`·`work_owner_id`를 NULL 허용, 대상 종류별 id 구성을 CHECK로 지키며 기존 행은 작품 신고)이며 Core/Auth·Content·WorldStudio 이력이나 테이블을 읽고 쓰지 않습니다. 다른 서비스 Entity/Repository 스캔을 추가하지 않습니다.

Hibernate는 `ddl-auto=validate`, `open-in-view=false`, JDBC 시간대 UTC입니다. DDL의 소유자는 운영 Flyway이고 JPA가 schema를 자동 변경하지 않습니다. append-only인 신고 이력·권한·관리자 활동 기록 행을 제외한 Entity의 `@Version`은 겹치는 수정/삭제 트랜잭션의 충돌을 409로 드러냅니다. 공개 DTO에는 version/ETag가 없으므로 **과거 화면의 순차적인 덮어쓰기까지 막는 클라이언트 revision 계약은 아닙니다**. 새 서버 호출·retry·락 관리 프레임워크를 추가하지 않습니다.

### 분리 PR의 Flyway 의존성과 순서

CRUD는 별도 PR로 전달하더라도 **공통 기반 → 공지 V1 → 이벤트 V2 → 문의/답변 V3** 순서로 의존성을 포함하고 병합·적용합니다. 추적 번호는 각각 미등록-120 → 미등록-121 → 미등록-122 → 미등록-123입니다. 이는 업무 서비스 간 호출 의존성이 아니라 **하나의 operations Flyway 이력에서 공유하는 버전 순서**입니다.

- 후속 PR의 검증 head에는 앞선 migration이 모두 있어야 합니다. V2/V3만 먼저 적용한 뒤 누락된 V1/V2를 나중에 끼워 넣는 배포를 하지 않습니다.
- 각 PR의 CI 통합 검증은 실행별 **fresh 임시 PostgreSQL DB**에서 해당 head의 V1부터 포함된 최신 버전까지 순서대로 재생해야 합니다. 전체 변경은 V1 → V2 → V3를 재생하며 기존 job별 격리·정리 계약을 유지합니다.
- `outOfOrder` 활성화, 이력 변경 또는 DB reset으로 순서를 우회하지 않습니다. 이번 변경은 그러한 설정·마이그레이션 변경이나 실제 운영/공유 DB·volume의 초기화를 하지 않으며, 폐기·복구에는 별도 승인이 필요합니다.

## 관리자 UI 메모리 데모

`/admin?tab=notices`는 [독립 운영 패널](../../frontend/src/presentation/features/admin/view/OperationsPanels.tsx) UI로 위 회원 Bearer `/admin/notices` API에 저장하고([공지 계약](../../docs/design/operations-notice-contract.md)), `/admin?tab=events`는 위 [이벤트 관리자·공개 API](#이벤트-관리자공개-api)에([이벤트 계약](../../docs/design/operations-event-contract.md)), `/admin?tab=feedback`의 회원 문의는 위 support 실제 API에([고객지원 문의 계약](../../docs/design/operations-support-inquiry-contract.md)) 저장하는 실제 연결입니다. 별도 `InMemoryOperationsRepository`·`OperationsUseCase`에 남은 공지·이벤트 메모리 메서드는 화면 연결 없이 남아 있으며 이 API·서비스 토큰과 연결하지 않았습니다(정리는 후속 작업). 제보·문의 탭의 작가 검토 제보 표는 실제 모드에서 운영 독자 제보 열람 API(`/feedback-reports`)를 읽기만 하고, `--mode mockup`만 별도 메모리 저장소(브라우저 새로고침 시 데모 기록·초안이 사라짐)입니다.

이벤트 선택 기간은 명시적인 한국시간(KST, UTC+09:00) 입력을 UTC로 변환하고 한국시간으로 표시하며 유효하지 않은 날짜·역전 기간을 거절합니다. UI에는 조회 로딩/실패/빈 목록/재시도·늦은 응답 무시, 요청별 pending/중복 방지, 저장 성공과 후속 목록 재조회 실패 구분, 탭별 초안·선택 유지, 상세/목록 포커스 이동과 줄바꿈 표시가 있습니다. 관리자 공지·이벤트·문의 탭에 있던 기존 회원 화면 호환 데모(공지 게시·이벤트 추가·문의 단일 답변)는 실제 API 패널로 대체해 제거했고, 회원 `/me/inquiry` 데모는 support 실제 API로 바꿨습니다. `/me/notice`는 공개 공지 API를, `/me/event`는 공개 이벤트 API를 읽습니다. [기능표 미등록-124](../../docs/feature-roadmap.md#미등록-124)는 각 UI 동작을 별도 행으로 추적하며, 이 설명은 브라우저 동작 검증 결과가 아닙니다.

## 검증·인계

로컬은 외부 의존성을 격리한 **선택 순수 단위 테스트만** 실행합니다. Gradle의 `unitTest`는 `*IntegrationTest`/`*PostgresTest`를 제외하고 `integrationTest`는 해당 클래스만 포함합니다. 두 task 모두 빈 발견/선택 불일치를 실패로 처리합니다. 필터·오류 handler 테스트는 servlet 대역·직접 호출·`ExceptionHandlerExceptionResolver` 단독 조립이며 Spring Boot context·실제 HTTP·DB가 없습니다. `ReportServiceTest`는 자원 없는 기록용 트랜잭션 매니저와 AOP 프록시로 `@Transactional` 경계(Content 호출 시 트랜잭션 비활성, 신고·이력·관리자 활동 기록 쓰기는 한 트랜잭션)만 확인합니다. `AdminChangeTransactionTest`는 같은 방식(begin·commit·rollback을 순서대로 남기고 열린 트랜잭션에 합류하는 매니저)으로 공지·이벤트 변경과 활동 기록이 한 트랜잭션인지, 기록이 실패하면 변경도 롤백되는지 확인합니다.

공통 기반 선택 예시:

```bash
JAVA_HOME=$(/usr/libexec/java_home -v 21) ./gradlew unitTest \
  --tests ai.storyfork.operations.ApplicationPropertiesTest \
  --tests ai.storyfork.operations.security.OperationsServiceTokenFilterTest \
  --tests ai.storyfork.operations._common.OperationsExceptionHandlerTest \
  --tests ai.storyfork.operations._common.PageResponseTest --no-daemon
```

리소스별 `NoticeServiceTest`/`NoticeControllerTest`(공지 관리·공개는 `AdminNoticeServiceTest`/`AdminNoticeControllerTest`/`PublicNoticeControllerTest`), `EventServiceTest`/`EventControllerTest`(관리자·공개 이벤트는 `AdminEventServiceTest`/`AdminEventControllerTest`/`PublicEventControllerTest`), `InquiryServiceTest`/`InquiryReplyServiceTest`/`InquiryControllerTest`/`SupportInquiryServiceTest`, 신고·회원·관리자·작품·댓글의 `ReportServiceTest`/`MemberServiceTest`/`MemberBearerFilterTest`/`WorkServiceTest`/`WorkControllerTest`/`CommentServiceTest`/`CommentControllerTest`/`OperationsCommentJsonTest`, 관리자 활동 기록의 `AdminActivityServiceTest`/`AdminActivityControllerTest`/`AdminChangeTransactionTest`, Content 안내 문구를 전하는 `upstream()` 변환의 `UpstreamTest`도 정확한 클래스 필터로 선택합니다. in-memory `MockRestServiceServer`를 쓰는 `OperationsClientsIntegrationTest`는 CI 경계 규칙상 통합으로 분류됩니다. 회원 Bearer 체인(관리자 이벤트·작품·댓글 포함)과 공개 이벤트(GET 전용) 체인 조립은 CI 전용 `MemberSecurityIntegrationTest`, 공지 관리자·공개 조회 체인은 `NoticeSecurityIntegrationTest`, 고객지원 문의의 Bearer 체인·PostgreSQL 흐름(`@Query` 상태 필터·V6)은 `SupportInquiryIntegrationTest`가, 관리자 활동 기록의 Bearer·`admins` 권한·V7·최신순 목록·공지 변경 기록 흐름은 `AdminActivityIntegrationTest`가 검증합니다. 전체 앱 테스트/빌드는 로컬 완료 조건으로 실행하지 않습니다.

회차·세계관·카드 카테고리·크레딧 묶음 잔액·신고 대상 확장은 `ContentManagementClientTest`·`CoreCreditClientTest`·`CoreNicknamesClientTest`(메모리 요청 팩토리)와 `WorkServiceTest`·`WorldStudioServiceTest`·`CardCategoryServiceTest`·`CreditServiceTest`·`ReportServiceTest`·`ReportJsonTest`, 각 컨트롤러 테스트로 고르고, 새 경로의 Bearer 체인 조립은 CI 전용 `MemberSecurityIntegrationTest`가 확인합니다. 독자 제보 열람(#750)은 `FeedbackReportServiceTest`·`FeedbackReportContentClientTest`(메모리 요청 팩토리)로 고르고 그 경로의 Bearer 체인·405·400 조립도 같은 `MemberSecurityIntegrationTest`가 확인합니다.

LLMOps(DEC-55) 단위 테스트는 패키지 필터로 고릅니다: `--tests 'ai.storyfork.operations.llmops.*' --tests 'ai.storyfork.operations.alert.*' --tests 'ai.storyfork.operations.dashboard.*' --tests 'ai.storyfork.operations.jobs.*'`와 클라이언트의 `LangfuseClientTest`·`AiClientTest`·`LlmopsClientDtoTest`입니다. 클라이언트 테스트는 실제 RestClient 파이프라인을 메모리 요청 팩토리(`RecordingRequestFactory`)로 돌려 소켓·서버·MockRestServiceServer 없이 URL·인증 헤더·본문·응답 읽기를 확인하고, 서비스 테스트는 Mockito 대역(집계는 실제 코드가 Langfuse 대역 위에서 돕니다)이고 Langfuse 응답 픽스처는 실측 v4 trace(`src/test/resources/langfuse/v4-sample-trace.json`, `LangfuseV4SampleTest`가 픽스처 빌더의 키가 실제와 같은지 확인)와 OpenAPI 모양입니다. `AlertChangeTransactionTest`는 경고 처리·기준 변경과 활동 기록이 한 트랜잭션인지 확인합니다. CI 전용 통합 테스트는 `LlmopsIntegrationTest`(PostgreSQL·V8 시드·부분 UNIQUE·경고 흐름·jsonb 누설 결과·설정·대시보드(작업 칸의 `job_run` 집계 포함)·승격 게이트), `MemberSecurityIntegrationTest`(새 경로의 Bearer 체인·409 코드 변환), `OperationsClientsIntegrationTest`(Core·Content 새 호출)입니다. `JobsIntegrationTest`는 네 정기 작업 종류마다 일정을 만들 수 있는지(handler 등록)도 확인합니다.

이번 U+0000 회귀는 `EventServiceTest`·`InquiryServiceTest`·`InquiryReplyServiceTest`만 선택해 **Red 12건**(예외가 발생하지 않아 assertion 실패) 후 최소 검증식 수정으로 **Green 69건**(각각 34·21·14건)을 확인했습니다. Spring/HTTP/DB 테스트는 실행하지 않았습니다.

UI 작업에서 인계된 결과는 `OperationsUseCase.test.ts`·`adminNavigation.test.ts`·`AdminUseCase.test.ts`의 선택 Domain 단위 **3파일 32건 통과**와 변경 범위 정적 검사 통과입니다. 기존 **Node 22** 환경을 재사용한 결과이며 프로젝트 고정 **Node 24** 검증으로 간주하지 않습니다. React/Hook/App 통합·전체 lint/build는 hosted CI 확인 대기, 브라우저/Aside는 미실행입니다. Domain 통과나 소스 확인을 실제 화면·HTTP·관리자 인증 성공으로 표현하지 않습니다.

루트의 변경 영향 범위 선택·정적 설정 회귀:

```bash
python3 -I -m unittest discover -s infrastructure/ci -p test_ci.py -v
python3 -I -m unittest discover -s infrastructure/ci -p test_spring_service_configuration.py -v
```

CI는 Operations 소스/테스트/SQL/빌드 변경에 Operations 단위·통합을 함께 선택하고 다른 서비스나 HTTP 시스템 시나리오는 추가하지 않습니다. 공유/알 수 없는 설정 변경과 수동 실행은 기존처럼 보수적으로 전체 범위를 선택합니다. `.github/workflows/ci.yml`이 native Gradle `unitTest`/`integrationTest`를 직접 실행합니다.

- 보안 통합은 MVC/Security 조립을 검증합니다. CRUD 통합은 실제 HTTP·PostgreSQL·Flyway·JPA 경로를 검증하도록 작성합니다.
- CI Operations 서비스 job(통합 단계)의 격리된 임시 PostgreSQL에만 `TEST_OPERATIONS_DATABASE_URL/USER/PASSWORD`를 전달합니다. 실행별 job service container는 Actions가 정리하며 운영/공유 DB·실제 `.env`를 쓰지 않습니다.
- CI 실패 보고서에는 운영 토큰·DB 비밀번호도 정제합니다. 실제 DB 적용·서버 배포·실제 메일·유료 AI 호출은 하지 않습니다.
- 로컬 Spring/HTTP/DB/컨테이너/브라우저 E2E/전체 빌드는 **미실행**입니다. HTTP 통합을 브라우저 E2E로 표현하지 않습니다.
- 로컬 `/code-review`는 CodeRabbit API로 diff를 전송하는 스킬이므로 외부 업로드 금지에 따라 실행하지 않습니다. Ponytail review와 로컬 보안·정확성 자체 검토는 별도 수행합니다.
- 소스·선택 단위 검증과 hosted `Required CI` 통과는 다릅니다. 병합과 최신 head의 CI 성공을 실제 확인하기 전까지 [기능표](../../docs/feature-roadmap.md)의 ❌를 유지합니다.
