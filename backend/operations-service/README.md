# STORYFORK Operations Service

공지·이벤트·고객지원 문의/답변 **레코드의 독립 백엔드 CRUD**입니다. Core·Content·AI 호출, 프런트엔드·공개 proxy·Compose/CD 연결은 없습니다. `Controller → Service → JpaRepository`를 사용하며 DTO는 각 리소스의 `service/dto`, Entity는 `entity`에 둡니다. 목표 책임과 후속 업무는 [서비스 경계](../../docs/design/service-boundaries.md)를 따릅니다.

> 현재는 서비스 자격 인증입니다. 사람의 관리자 권한, 회원 신원·소유권, ‘내 문의’, 공개 게시·이벤트 진행 상태·참여·보상·알림·감사는 구현하지 않습니다. 서비스 토큰을 가진 호출 서버는 이 서비스의 모든 레코드에 접근할 수 있으므로 브라우저에 직접 연결하면 안 됩니다.

## 실행 기반·설정

- 독립 Gradle 프로젝트 `storyfork-operations-service`, group `ai.storyfork`, package `ai.storyfork.operations`
- 진입점 `OperationsServiceApplication` (`Application.kt`), JDK 21·Kotlin 2.4.10·Spring Boot 4.1.0
- 기본 bind **`127.0.0.1:8082`** 유지. 포트 변경은 Spring 표준 `--server.port` 옵션을 사용합니다.
- 기존 Content와 같은 Kotlin JPA/all-open 플러그인 및 Boot-managed WebMVC·JPA·Validation·Security·Flyway PostgreSQL·Jackson Kotlin을 사용합니다. 별도 서버·DB 제품·worker는 추가하지 않습니다.

설정의 정본은 루트 `.env`이고 공유 예시는 루트 [`.env.example`](../../.env.example)뿐입니다. 실제 `.env`를 덮어쓰거나 서비스별 `.env`를 만들지 않으며 루트 전체를 source하지 않습니다. 신뢰하는 서버 프로세스에 필요한 값만 전달합니다.

| 환경변수 | 기본값 / 의미 |
|---|---|
| `OPERATIONS_DATABASE_URL` | `jdbc:postgresql://127.0.0.1:5432/storyfork` — 기존 PostgreSQL 연결 |
| `OPERATIONS_DATABASE_USER` | `storyfork` — 운영 schema에 필요한 권한을 가진 DB 사용자 |
| `OPERATIONS_DATABASE_PASSWORD` | 빈 값 — 실제 실행 환경의 DB 자격을 별도 설정 |
| `OPERATIONS_SERVICE_TOKEN` | 빈 값 — 비어 있거나 공백뿐이면 **보호 접근을 허용하지 않음** |

DB 자격과 서비스 토큰은 Operations 및 허용된 서버에만 주입합니다. 서비스 토큰은 JWT 서명 키·회원 Bearer·Content 인증 토큰과 재사용하지 말고 충분히 긴 무작위 값(32자 이상 권장)을 생성합니다. 로그·스크린샷·브라우저 번들·`VITE_*`·build ARG·저장소에 넣지 않습니다. 외부 네트워크에서 사용할 때 TLS와 신뢰 서버 경계를 별도 마련해야 하며, loopback 바깥 바인딩이나 배포는 이번 범위가 아닙니다.

아래는 **수동 실행 안내**이며 개발 검증이 앱·DB를 자동 기동하지는 않습니다. 필요한 네 환경변수만 이미 해당 프로세스 환경에 제공한 뒤 실행합니다.

```bash
JAVA_HOME=$(/usr/libexec/java_home -v 21) ./gradlew bootRun
```

DB 연결과 schema 초기화 권한이 필요합니다. 이전의 ‘DB 없이 실행하는 골격’ 설명은 이 CRUD 구현에 적용되지 않습니다. 실제 공유 DB에 적용하거나 데이터를 폐기할 권한을 부여하지 않습니다.

## 서비스 인증·오류

모든 `/api/v1/operations/**` 요청은 단일 `X-Operations-Service-Token` 헤더를 요구합니다. 고정 길이 SHA-256 digest를 `MessageDigest.isEqual`로 비교하며 중복 헤더·빈 값·틀린 값·누락 설정은 401입니다. 입력 토큰을 임의로 trim하지 않습니다. `Authorization: Bearer`, 쿠키, `X-Auth-User` 등은 인증 대체 수단이 아닙니다.

Security는 stateless이며 로그인 폼·Basic·로그아웃·request cache·세션 쿠키 인증을 사용하지 않습니다. 기본 사용자 계정도 만들지 않습니다. 변경 요청의 권한은 브라우저 CSRF 쿠키가 아니라 서비스 헤더에만 의존합니다. 브라우저 CORS 허용을 추가하지 않으며 토큰 보관·사람별 권한 검사를 프런트엔드에 맡기지 않습니다. 서비스 자격을 갖춰도 운영 API 밖의 경로는 403으로 거절합니다.

안전한 공통 오류 DTO는 `{ "code": "...", "message": "..." }`입니다. 원문 입력·토큰·SQL·예외 reason/stack을 응답에 넣지 않습니다.

| HTTP | code | 상황 |
|---|---|---|
| 400 | `INVALID_REQUEST` | 잘못된 UUID/JSON·필수 값·길이·U+0000·기간 순서 등 입력 검증 실패 |
| 401 | `UNAUTHORIZED` | 서비스 토큰 없음/오류/중복 또는 서버 토큰 미설정 |
| 403 | `FORBIDDEN` | 서비스 자격으로 허용되지 않은 경로 접근 |
| 404 | `NOT_FOUND` | 레코드 없음, 다른 문의에 속한 답변 접근 |
| 405 등 | `REQUEST_FAILED` | MVC HTTP 오류의 상태를 보존하고 상세 reason은 숨김 |
| 409 | `CONFLICT` | 낙관적 동시성 충돌, 답변이 남은 문의 삭제, DB 참조 충돌 |
| 500 | `INTERNAL_ERROR` | 예상하지 못한 실패; 성공 fallback 없음 |

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
- 생성/수정 전 필수 값·길이·기간과 모든 문자열의 U+0000 포함 여부를 검증합니다. 공지·이벤트의 제목/본문, 문의의 분류/제목/본문, 답변 본문에 U+0000이 있으면 저장·변경 전에 거절하며 기존 필드와 수정 시각을 보존합니다. 잘못된 생성 요청은 Repository를 호출하지 않습니다.
- 공지/이벤트/문의 응답은 `id`, 요청 필드, `createdAt`, `updatedAt`입니다. 답변에는 `inquiryId`도 있습니다. 모든 시각은 UTC Instant입니다.
- 목록은 `items`, `page`, `size`, `totalElements`, `totalPages`를 갖는 명시적 DTO입니다. JPA Entity나 Spring `Page`를 그대로 노출하지 않습니다.
- Pageable 기본값은 0부터 시작하는 page와 size 20이며 size는 최대 100입니다. 공지·이벤트·문의 목록은 `createdAt DESC, id DESC`, 문의 하위 답변 목록은 대화 순서인 `createdAt ASC, id ASC`로 고정합니다. 클라이언트 sort를 사용하지 않고 같은 시각도 UUID로 순서를 안정화합니다.
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

## 저장·동시성

기존 PostgreSQL 아키텍처 안에서 **`operations` schema만** 사용합니다. Flyway location은 `classpath:db/migration/operations`, 기본 schema는 `operations`, 전용 history는 `operations.operations_flyway_schema_history`입니다. V1은 공지, V2는 이벤트, V3은 문의/답변이며 Core/Auth·Content·WorldStudio 이력이나 테이블을 읽고 쓰지 않습니다. 다른 서비스 Entity/Repository 스캔을 추가하지 않습니다.

Hibernate는 `ddl-auto=validate`, `open-in-view=false`, JDBC 시간대 UTC입니다. DDL의 소유자는 운영 Flyway이고 JPA가 schema를 자동 변경하지 않습니다. 모든 Entity의 `@Version`은 겹치는 수정/삭제 트랜잭션의 충돌을 409로 드러냅니다. 공개 DTO에는 version/ETag가 없으므로 **과거 화면의 순차적인 덮어쓰기까지 막는 클라이언트 revision 계약은 아닙니다**. 새 서버 호출·retry·락 관리 프레임워크를 추가하지 않습니다.

### 분리 PR의 Flyway 의존성과 순서

CRUD는 별도 PR로 전달하더라도 **공통 기반 → 공지 V1 → 이벤트 V2 → 문의/답변 V3** 순서로 의존성을 포함하고 병합·적용합니다. 추적 번호는 각각 미등록-120 → 미등록-121 → 미등록-122 → 미등록-123입니다. 이는 업무 서비스 간 호출 의존성이 아니라 **하나의 operations Flyway 이력에서 공유하는 버전 순서**입니다.

- 후속 PR의 검증 head에는 앞선 migration이 모두 있어야 합니다. V2/V3만 먼저 적용한 뒤 누락된 V1/V2를 나중에 끼워 넣는 배포를 하지 않습니다.
- 각 PR의 CI 통합 검증은 실행별 **fresh 임시 PostgreSQL DB**에서 해당 head의 V1부터 포함된 최신 버전까지 순서대로 재생해야 합니다. 전체 변경은 V1 → V2 → V3를 재생하며 기존 job별 격리·정리 계약을 유지합니다.
- `outOfOrder` 활성화, 이력 변경 또는 DB reset으로 순서를 우회하지 않습니다. 이번 변경은 그러한 설정·마이그레이션 변경이나 실제 운영/공유 DB·volume의 초기화를 하지 않으며, 폐기·복구에는 별도 승인이 필요합니다.

## 관리자 UI 메모리 데모

`/admin?tab=notices`, `/admin?tab=events`, `/admin?tab=feedback`의 [독립 운영 패널](../../frontend/src/presentation/features/admin/view/OperationsPanels.tsx)은 별도 `InMemoryOperationsRepository`에 공지·이벤트·문의 및 문의별 여러 답변을 저장합니다. 등록·목록/상세·전체 수정·확인 후 삭제와 답변 우선 삭제 안내를 소스 구현했지만 **이 API·서비스 토큰·실제 관리자 인증·서버 저장·발행·알림·버전 충돌과는 연결하지 않았습니다**. 브라우저 새로고침 시 데모 기록·초안이 사라집니다.

이벤트 선택 기간은 명시적인 한국시간(KST, UTC+09:00) 입력을 UTC로 변환하고 한국시간으로 표시하며 유효하지 않은 날짜·역전 기간을 거절합니다. UI에는 조회 로딩/실패/빈 목록/재시도·늦은 응답 무시, 요청별 pending/중복 방지, 저장 성공과 후속 목록 재조회 실패 구분, 탭별 초안·선택 유지, 상세/목록 포커스 이동과 줄바꿈 표시가 있습니다. 기존 회원용 공지·이벤트·내 문의의 단일 답변 및 작가 제보 데모는 별도 저장소·호환 화면으로 보존합니다. [기능표 미등록-124](../../docs/feature-roadmap.md#미등록-124)는 각 UI 동작을 별도 행으로 추적하며, 이 설명은 브라우저 동작 검증 결과가 아닙니다.

## 검증·인계

로컬은 외부 의존성을 격리한 **선택 순수 단위 테스트만** 실행합니다. Gradle의 `unitTest`는 `*IntegrationTest`/`*PostgresTest`를 제외하고 `integrationTest`는 해당 클래스만 포함합니다. 두 task 모두 빈 발견/선택 불일치를 실패로 처리합니다. 필터·오류 handler 테스트는 servlet 대역/직접 호출이며 Spring context·실제 HTTP·DB가 없습니다.

공통 기반 선택 예시:

```bash
JAVA_HOME=$(/usr/libexec/java_home -v 21) ./gradlew unitTest \
  --tests ai.storyfork.operations.ApplicationPropertiesTest \
  --tests ai.storyfork.operations.security.OperationsServiceTokenFilterTest \
  --tests ai.storyfork.operations._common.OperationsExceptionHandlerTest --no-daemon
```

리소스별 `NoticeServiceTest`/`NoticeControllerTest`, `EventServiceTest`/`EventControllerTest`, `InquiryServiceTest`/`InquiryReplyServiceTest`/`InquiryControllerTest`도 정확한 클래스 필터로 선택합니다. 전체 앱 테스트/빌드는 로컬 완료 조건으로 실행하지 않습니다.

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
