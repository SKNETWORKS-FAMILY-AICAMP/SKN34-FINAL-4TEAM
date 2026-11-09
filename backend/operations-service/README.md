# STORYFORK Operations Service

공지·이벤트·고객지원 문의/답변 **레코드의 독립 백엔드 CRUD**와 회원 Bearer 기반 **신고·회원·관리자 운영 API**입니다. 신고·회원·관리자 API만 Core(인증 확인·회원)와 Content(작품 제한)를 호출하며 AI 호출은 없습니다. `Controller → Service → JpaRepository`를 사용하며 DTO는 각 리소스의 `service/dto`, Entity는 `entity`에 둡니다. 목표 책임과 후속 업무는 [서비스 경계](../../docs/design/service-boundaries.md)를 따릅니다.

> 인증은 두 갈래입니다. 공지·이벤트·문의 API는 **서비스 자격 인증만** 사용하며 사람의 관리자 권한, 회원 신원·소유권, ‘내 문의’, 공개 게시·이벤트 진행 상태·참여·보상·알림·감사는 구현하지 않습니다. 서비스 토큰을 가진 호출 서버는 이 레코드에 모두 접근할 수 있으므로 브라우저에 직접 연결하면 안 됩니다. 신고·회원·관리자 API(`/reports`·`/members`·`/admins`)는 회원 Bearer를 Core로 확인하고 운영자(`operator`)+업무 권한으로 인가합니다([계약](../../docs/design/operations-member-report-contract.md)).

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
| `OPERATIONS_CONTENT_BASE_URL` | `http://127.0.0.1:8081` — Content(작품 조회·제한 API) |

DB 자격과 서비스 토큰은 Operations 및 허용된 서버에만 주입합니다. 서비스 토큰은 JWT 서명 키·회원 Bearer·Content 인증 토큰과 재사용하지 말고 충분히 긴 무작위 값(32자 이상 권장)을 생성합니다. 로그·스크린샷·브라우저 번들·`VITE_*`·build ARG·저장소에 넣지 않습니다. 외부 네트워크에서 사용할 때 TLS와 신뢰 서버 경계를 별도 마련해야 하며, loopback 바깥 바인딩이나 배포는 이번 범위가 아닙니다.

아래는 **수동 실행 안내**이며 개발 검증이 앱·DB를 자동 기동하지는 않습니다. 필요한 환경변수만 이미 해당 프로세스 환경에 제공한 뒤 실행합니다.

```bash
JAVA_HOME=$(/usr/libexec/java_home -v 21) ./gradlew bootRun
```

DB 연결과 schema 초기화 권한이 필요합니다. 이전의 ‘DB 없이 실행하는 골격’ 설명은 이 CRUD 구현에 적용되지 않습니다. 실제 공유 DB에 적용하거나 데이터를 폐기할 권한을 부여하지 않습니다.

## 서비스 인증·오류

아래 회원 Bearer API를 제외한 모든 `/api/v1/operations/**` 요청은 단일 `X-Operations-Service-Token` 헤더를 요구합니다. 고정 길이 SHA-256 digest를 `MessageDigest.isEqual`로 비교하며 중복 헤더·빈 값·틀린 값·누락 설정은 401입니다. 입력 토큰을 임의로 trim하지 않습니다. `Authorization: Bearer`, 쿠키, `X-Auth-User` 등은 인증 대체 수단이 아닙니다.

Security는 stateless이며 로그인 폼·Basic·로그아웃·request cache·세션 쿠키 인증을 사용하지 않습니다. 기본 사용자 계정도 만들지 않습니다(`spring.autoconfigure.exclude`로 Boot의 `UserDetailsServiceAutoConfiguration`을 제외하며 `ApplicationPropertiesTest`가 고정합니다). 변경 요청의 권한은 브라우저 CSRF 쿠키가 아니라 서비스 헤더에만 의존합니다. 브라우저 CORS 허용을 추가하지 않으며 토큰 보관·사람별 권한 검사를 프런트엔드에 맡기지 않습니다. 서비스 자격을 갖춰도 운영 API 밖의 경로는 403으로 거절합니다.

안전한 공통 오류 DTO는 `{ "code": "...", "message": "..." }`입니다. 원문 입력·토큰·SQL·예외 reason/stack을 응답에 넣지 않습니다.

| HTTP | code | 상황 |
|---|---|---|
| 400 | `INVALID_REQUEST` | 잘못된 UUID/JSON·필수 값·길이·U+0000·기간 순서 등 입력 검증 실패 |
| 401 | `UNAUTHORIZED` | 서비스 토큰 없음/오류/중복 또는 서버 토큰 미설정 |
| 403 | `FORBIDDEN` | 서비스 자격으로 허용되지 않은 경로 접근 |
| 404 | `NOT_FOUND` | 레코드 없음, 다른 문의에 속한 답변 접근, 없는 운영 API 경로 |
| 405 등 | `REQUEST_FAILED` | 메서드 불일치 등 MVC HTTP 오류의 상태를 보존하고 상세 reason은 숨김 |
| 409 | `CONFLICT` | 낙관적 동시성 충돌, 답변이 남은 문의 삭제, DB 참조 충돌 |
| 500 | `INTERNAL_ERROR` | 예상하지 못한 실패; 성공 fallback 없음 |
| 502 | `UPSTREAM_FAILED` | Core/Content 호출 실패(아래 회원 Bearer API); 상태·이력 미기록 |

오류 advice에는 `basePackages` 같은 선택자를 두지 않습니다. 선택자가 있으면 컨트롤러가 정해지기 전에 나는 오류(없는 경로 404, 메서드 불일치 405 등)에는 advice가 적용되지 않아 위 DTO로 응답하지 못합니다.

원인은 응답이 아니라 서버 로그에만 남깁니다. 500은 우리 쪽 결함이므로 `ERROR`로 원인 사슬과 스택을 남깁니다. 502는 Core/Content 장애를 계약대로 처리한 결과이므로 `WARN` 한 줄에 예외 클래스명(원인 사슬)·하위 HTTP 상태(있으면)·요청 경로만 남깁니다. RestClient 5xx 예외 메시지에는 하위 응답 본문이, I/O 원인 메시지에는 URL이 들어갈 수 있어 502는 예외 메시지와 스택을 쓰지 않으며, 그래서 쿼리(회원 검색어 등)와 하위 응답 본문이 로그에 남지 않습니다. 핸들러는 5xx만 기록하며 요청 본문·헤더·토큰·쿼리를 직접 쓰지 않습니다(500은 예외를 그대로 남기므로 예외 메시지에 든 값까지는 걸러지지 않습니다).

## API 계약

기본 경로는 `/api/v1/operations`이며 UUID는 서버가 생성합니다. 각 요청에 서비스 토큰이 필요하고 JSON 생성/전체 수정에는 `Content-Type: application/json`을 지정합니다.

| 리소스 | 목록 경로 | 요청 필드 |
|---|---|---|
| 공지 | `/notices` | `title`(1~200자·공백만 불가), `body`(1~20,000자·공백만 불가) |
| 이벤트 | `/events` | 공지와 같은 `title`, `body`; 선택 `startsAt`, `endsAt`(ISO-8601 Instant) |
| 문의 | `/inquiries` | `title`(1~200자), `body`(1~20,000자), `category`(1~50자); 공백만 불가 |
| 문의 답변 | `/inquiries/{id}/replies` | `body`(1~20,000자·공백만 불가) |

문의 `category`는 자유 텍스트 분류이며 회원 식별자나 확정된 유형 enum이 아닙니다. 이벤트 기간은 선택이며 둘 다 있으면 `endsAt >= startsAt`이어야 합니다. 자동 진행 상태나 발행 여부는 계산하지 않습니다. 내용은 일반 텍스트 레코드이며 HTML 렌더링 계약이 아닙니다.

아래 동작은 각 목록 경로 `R`에 동일하게 적용합니다. 답변의 `R`에는 문의 UUID가 포함됩니다.

| 메서드·경로 | 성공 | 동작 |
|---|---|---|
| `POST R` | 201 + `Location: R/{생성 UUID}` | 생성 결과 DTO 반환 |
| `GET R?page=0&size=20` | 200 | 크기 제한 목록 DTO 반환 |
| `GET R/{resourceId}` | 200 | 상세 DTO 반환 |
| `PUT R/{resourceId}` | 200 | 전체 필드 교체 후 DTO 반환 |
| `DELETE R/{resourceId}` | 204, 응답 본문 없음 | 명시적 삭제; 없는 ID는 404 |

- PUT은 PATCH가 아닙니다. 이벤트에서 기간을 생략하거나 null로 보내면 기존 기간을 비웁니다.
- 생성/수정 전 필수 값·길이는 요청 DTO의 `@NotBlank`·`@Size`가 컨트롤러의 `@Valid`에서, 이벤트 기간 순서와 모든 문자열의 U+0000 포함 여부는 서비스가 검증합니다. 서비스는 이 DTO 검증을 통과한 요청만 받는 전제이며(현재 서비스를 호출하는 곳은 컨트롤러뿐) 공백·길이 검사를 되풀이하지 않습니다. 공지·이벤트의 제목/본문, 문의의 분류/제목/본문, 답변 본문에 U+0000이 있으면 저장·변경 전에 거절하며 기존 필드와 수정 시각을 보존합니다. 잘못된 생성 요청은 Repository를 호출하지 않습니다.
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

## 회원 Bearer API (신고·회원·관리자)

`/api/v1/operations/{reports,members,admins}`와 하위 경로는 별도 SecurityFilterChain입니다. `Authorization: Bearer …`를 Core `POST /internal/v1/auth/verify`(받은 Authorization + 서비스 토큰)로 확인해 `{memberId, operator}`를 principal로 씁니다. Bearer 없음은 401, Core 401/403은 그대로, 그 밖의 확인 실패는 502입니다. stateless·쿠키 없음이므로 CSRF를 쓰지 않으며, 이 경로에서는 서비스 토큰이 인증 수단이 아닙니다.

- 관리자 = Core `operator=true` **이면서** `operations.admin_permission`에 해당 키 보유(`rights`·`users`·`admins`). 아니면 403.
- 신고: 접수·`mine`·운영 목록(`?status=`)·상세(+`history`)·`evidence`·`explanations`(POST/GET)·`review`·`restriction`(POST/DELETE)·`evidence-requests`. 접수는 201, 신고 변경 POST/DELETE는 200으로 갱신된 상세(`history` 포함), `GET …/explanations`는 `{ items: History[] }`. 증거 보완·소명·증빙 요청 본문은 1~5000자.
- 회원: `GET /members?role=&q=&sort=`, `PUT|DELETE /members/{id}/restriction` — Core에 관리자 Bearer를 그대로 전달.
- 관리자: `GET /admins`(Core `role=ADMIN` + `permissions`), `POST /admins`(알려진 키 1개 이상 검증 → Core 생성 → 권한 저장, 201).
- Core·Content 하위 400/404/409는 보존하고 그 외 실패는 502 `UPSTREAM_FAILED`이며 성공·이력으로 숨기지 않습니다. 고정 timeout(connect 2s, read 5s)·재시도 없음.
- Content 호출(접수의 작품 조회, 제한·해제)은 DB 트랜잭션 밖에서 실행해 커넥션을 점유하지 않습니다. 호출이 성공한 뒤 신고 갱신과 이력만 한 트랜잭션으로 저장하고, 조회 이후 신고가 바뀌었으면 `@Version`이 409로 거절합니다. 제한·해제는 저장이 실패하면 Content 쪽만 이미 바뀐 상태이며(분산 트랜잭션 없음) 같은 요청을 다시 보내면 맞춰집니다(Content PUT/DELETE는 멱등).

## 저장·동시성

기존 PostgreSQL 아키텍처 안에서 **`operations` schema만** 사용합니다. Flyway location은 `classpath:db/migration/operations`, 기본 schema는 `operations`, 전용 history는 `operations.operations_flyway_schema_history`입니다. V1은 공지, V2는 이벤트, V3은 문의/답변, V4는 관리자 업무 권한(샘플 관리자 12개 권한 시드), V5는 신고/신고 이력이며 Core/Auth·Content·WorldStudio 이력이나 테이블을 읽고 쓰지 않습니다. 다른 서비스 Entity/Repository 스캔을 추가하지 않습니다.

Hibernate는 `ddl-auto=validate`, `open-in-view=false`, JDBC 시간대 UTC입니다. DDL의 소유자는 운영 Flyway이고 JPA가 schema를 자동 변경하지 않습니다. append-only인 신고 이력·권한 행을 제외한 Entity의 `@Version`은 겹치는 수정/삭제 트랜잭션의 충돌을 409로 드러냅니다. 공개 DTO에는 version/ETag가 없으므로 **과거 화면의 순차적인 덮어쓰기까지 막는 클라이언트 revision 계약은 아닙니다**. 새 서버 호출·retry·락 관리 프레임워크를 추가하지 않습니다.

### 분리 PR의 Flyway 의존성과 순서

CRUD는 별도 PR로 전달하더라도 **공통 기반 → 공지 V1 → 이벤트 V2 → 문의/답변 V3** 순서로 의존성을 포함하고 병합·적용합니다. 추적 번호는 각각 미등록-120 → 미등록-121 → 미등록-122 → 미등록-123입니다. 이는 업무 서비스 간 호출 의존성이 아니라 **하나의 operations Flyway 이력에서 공유하는 버전 순서**입니다.

- 후속 PR의 검증 head에는 앞선 migration이 모두 있어야 합니다. V2/V3만 먼저 적용한 뒤 누락된 V1/V2를 나중에 끼워 넣는 배포를 하지 않습니다.
- 각 PR의 CI 통합 검증은 실행별 **fresh 임시 PostgreSQL DB**에서 해당 head의 V1부터 포함된 최신 버전까지 순서대로 재생해야 합니다. 전체 변경은 V1 → V2 → V3를 재생하며 기존 job별 격리·정리 계약을 유지합니다.
- `outOfOrder` 활성화, 이력 변경 또는 DB reset으로 순서를 우회하지 않습니다. 이번 변경은 그러한 설정·마이그레이션 변경이나 실제 운영/공유 DB·volume의 초기화를 하지 않으며, 폐기·복구에는 별도 승인이 필요합니다.

## 관리자 UI 메모리 데모

`/admin?tab=notices`, `/admin?tab=events`, `/admin?tab=feedback`의 [독립 운영 패널](../../frontend/src/presentation/features/admin/view/OperationsPanels.tsx)은 별도 `InMemoryOperationsRepository`에 공지·이벤트·문의 및 문의별 여러 답변을 저장합니다. 등록·목록/상세·전체 수정·확인 후 삭제와 답변 우선 삭제 안내를 소스 구현했지만 **이 API·서비스 토큰·실제 관리자 인증·서버 저장·발행·알림·버전 충돌과는 연결하지 않았습니다**. 브라우저 새로고침 시 데모 기록·초안이 사라집니다.

이벤트 선택 기간은 명시적인 한국시간(KST, UTC+09:00) 입력을 UTC로 변환하고 한국시간으로 표시하며 유효하지 않은 날짜·역전 기간을 거절합니다. UI에는 조회 로딩/실패/빈 목록/재시도·늦은 응답 무시, 요청별 pending/중복 방지, 저장 성공과 후속 목록 재조회 실패 구분, 탭별 초안·선택 유지, 상세/목록 포커스 이동과 줄바꿈 표시가 있습니다. 기존 회원용 공지·이벤트·내 문의의 단일 답변 및 작가 제보 데모는 별도 저장소·호환 화면으로 보존합니다. [기능표 미등록-124](../../docs/feature-roadmap.md#미등록-124)는 각 UI 동작을 별도 행으로 추적하며, 이 설명은 브라우저 동작 검증 결과가 아닙니다.

## 검증·인계

로컬은 외부 의존성을 격리한 **선택 순수 단위 테스트만** 실행합니다. Gradle의 `unitTest`는 `*IntegrationTest`/`*PostgresTest`를 제외하고 `integrationTest`는 해당 클래스만 포함합니다. 두 task 모두 빈 발견/선택 불일치를 실패로 처리합니다. 필터·오류 handler 테스트는 servlet 대역·직접 호출·`ExceptionHandlerExceptionResolver` 단독 조립이며 Spring Boot context·실제 HTTP·DB가 없습니다. `ReportServiceTest`는 자원 없는 기록용 트랜잭션 매니저와 AOP 프록시로 `@Transactional` 경계(Content 호출 시 트랜잭션 비활성, 쓰기는 한 트랜잭션)만 확인합니다.

공통 기반 선택 예시:

```bash
JAVA_HOME=$(/usr/libexec/java_home -v 21) ./gradlew unitTest \
  --tests ai.storyfork.operations.ApplicationPropertiesTest \
  --tests ai.storyfork.operations.security.OperationsServiceTokenFilterTest \
  --tests ai.storyfork.operations._common.OperationsExceptionHandlerTest \
  --tests ai.storyfork.operations._common.PageResponseTest --no-daemon
```

리소스별 `NoticeServiceTest`/`NoticeControllerTest`, `EventServiceTest`/`EventControllerTest`, `InquiryServiceTest`/`InquiryReplyServiceTest`/`InquiryControllerTest`, 신고·회원·관리자의 `ReportServiceTest`/`MemberServiceTest`/`MemberBearerFilterTest`도 정확한 클래스 필터로 선택합니다. in-memory `MockRestServiceServer`를 쓰는 `OperationsClientsIntegrationTest`는 CI 경계 규칙상 통합으로 분류됩니다. 회원 Bearer 체인 조립은 CI 전용 `MemberSecurityIntegrationTest`가 검증합니다. 전체 앱 테스트/빌드는 로컬 완료 조건으로 실행하지 않습니다.

이번 U+0000 회귀는 `EventServiceTest`·`InquiryServiceTest`·`InquiryReplyServiceTest`만 선택해 **Red 12건**(예외가 발생하지 않아 assertion 실패) 후 최소 검증식 수정으로 **Green 69건**(각각 34·21·14건)을 확인했습니다. Spring/HTTP/DB 테스트는 실행하지 않았습니다.

UI 작업에서 인계된 결과는 `OperationsUseCase.test.ts`·`adminNavigation.test.ts`·`AdminUseCase.test.ts`의 선택 Domain 단위 **3파일 32건 통과**와 변경 범위 정적 검사 통과입니다. 기존 **Node 22** 환경을 재사용한 결과이며 프로젝트 고정 **Node 24** 검증으로 간주하지 않습니다. React/Hook/App 통합·전체 lint/build는 hosted CI 확인 대기, 브라우저/Aside는 미실행입니다. Domain 통과나 소스 확인을 실제 화면·HTTP·관리자 인증 성공으로 표현하지 않습니다.

루트의 변경 영향 범위 선택·정적 설정 회귀:

```bash
python3 -I -m unittest discover -s infrastructure/ci -p test_ci.py -v
python3 -I -m unittest discover -s infrastructure/ci -p test_spring_service_configuration.py -v
```

CI는 Operations 소스/테스트/SQL/빌드 변경에 Operations 단위·통합을 함께 선택하고 다른 서비스나 HTTP 시스템 시나리오는 추가하지 않습니다. 공유/알 수 없는 설정 변경과 수동 실행은 기존처럼 보수적으로 전체 범위를 선택합니다. `.github/workflows/ci.yml`이 native Gradle `unitTest`/`integrationTest`를 직접 실행합니다.

- 보안 통합은 MVC/Security 조립을 검증합니다. CRUD 통합은 실제 HTTP·PostgreSQL·Flyway·JPA 경로를 검증하도록 작성합니다.
- CI 통합 job의 격리된 임시 PostgreSQL에만 `TEST_OPERATIONS_DATABASE_URL/USER/PASSWORD`를 전달합니다. 실행별 job service container는 Actions가 정리하며 운영/공유 DB·실제 `.env`를 쓰지 않습니다.
- CI 실패 보고서에는 운영 토큰·DB 비밀번호도 정제합니다. 실제 DB 적용·서버 배포·실제 메일·유료 AI 호출은 하지 않습니다.
- 로컬 Spring/HTTP/DB/컨테이너/브라우저 E2E/전체 빌드는 **미실행**입니다. HTTP 통합을 브라우저 E2E로 표현하지 않습니다.
- 로컬 `/code-review`는 CodeRabbit API로 diff를 전송하는 스킬이므로 외부 업로드 금지에 따라 실행하지 않습니다. Ponytail review와 로컬 보안·정확성 자체 검토는 별도 수행합니다.
- 소스·선택 단위 검증과 hosted `Required CI` 통과는 다릅니다. 병합과 최신 head의 CI 성공을 실제 확인하기 전까지 [기능표](../../docs/feature-roadmap.md)의 ❌를 유지합니다.
