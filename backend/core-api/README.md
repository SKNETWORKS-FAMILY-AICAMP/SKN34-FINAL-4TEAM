# STORYFORK Core Service (현재 모듈: `core-api`)

Spring Boot·Kotlin 공개 API 개발 기반입니다. Health와 이메일 가입·인증, 로그인·세션, 비밀번호 복구·프로필 API를 제공하며 `CONTENT_ENABLED=true`일 때 PostgreSQL 기반 콘텐츠 API를 활성화합니다. 작품·원고·설정집·버전·Fork·발행 구현은 [콘텐츠 통합 안내](../../docs/content-integration.md)를 참고하세요. 콘텐츠 소유자는 인증된 JWT의 회원 UUID를 사용합니다. 실제 약관·동의·회원 탈퇴·그래프 DB·크레딧은 미구현이며 운영 가입용이 아닙니다.

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
| `POST /api/v1/auth/login` | `email`, `password`; `accessToken`·`user` JSON 및 `refresh_token` 쿠키, 200 |
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

콘텐츠 정본은 최신 ERD에 따른 관계형 테이블에 저장합니다. 기존 JSONB는 읽기 전용 이관 백업으로 남깁니다. [ERD 대응과 마이그레이션](../../docs/content-erd-migration.md)에 테이블별 역할·기존 데이터 보존·남은 범위를 기록했습니다.

Gradle group `ai.storyfork`, 애플리케이션 `storyfork-core-api`, Kotlin namespace `ai.storyfork.core`입니다.
main/test 디렉터리는 각각 `src/{main,test}/kotlin/ai/storyfork/core/`로 package와 일치합니다.

- `_health/controller`: 자체 상태.
- `_health_ai_service/controller → service → client`: 내부 응답 조회와 검증.
- Health의 `controller/dto`: 공개 응답, `client/dto`: 신뢰하지 않는 외부 payload, `service/dto`: 검증된 결과.
- `auth/controller → service → repository`: Controller는 필요한 쿠키·헤더와 검증된 JWT만 받고, Service는 업무·트랜잭션, Spring Data `JpaRepository`는 `auth/entity` 영속성을 담당합니다.
- `auth/service/dto`: 클래스별 요청·응답 계약을 Controller와 Service가 공유합니다. `LoginResult`의 내부 refresh token은 Controller에서 HttpOnly 쿠키로만 보내며 공개 `LoginResponse`에는 포함하지 않습니다.
- Auth는 기존 UUID·스키마와 Flyway 파일·`flyway_schema_history`를 유지합니다. Hibernate는 `validate`만 수행하며 Open Session in View는 사용하지 않습니다. 기존 Content JDBC·별도 마이그레이션 경로는 이번 Auth 전환에 포함하지 않습니다.
- 로그인·복구·이메일 변경·refresh 회전·세션 폐기는 회원의 JPA `PESSIMISTIC_WRITE` 잠금으로 직렬화합니다. 토큰 재사용 폐기는 Service가 정상 반환해 커밋한 뒤 Controller에서 401로 변환합니다. 신규 가입 후보의 최초 삽입 충돌만 새 트랜잭션에서 한 번 재시도하며 메일 실패 시 후보 변경을 롤백합니다.
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
| `AI_GENERATION_READ_TIMEOUT` | `75s` (생성) |
| `APP_CORS_ALLOWED_ORIGIN` | `http://localhost:5173` |
| `CORE_DATABASE_URL`, `CORE_DATABASE_USER`, `CORE_DATABASE_PASSWORD` | 필수 |
| `CORE_SMTP_HOST`, `CORE_SMTP_PORT` | 필수 |
| `AUTH_PUBLIC_ORIGIN`, `AUTH_MAIL_FROM` | 필수 |
| `AUTH_JWT_SECRET` | 필수, 32바이트 이상의 무작위 키를 Base64 인코딩 |
| `AUTH_COOKIE_SECURE` | `true`; 로컬 HTTP 검증에서만 `false` |

`ContentConfig`는 생성 전용 HTTP 클라이언트를 만들며 Health 클라이언트의 제한시간을 변경하지 않습니다.
AI 주소는 origin만 허용하고 양수 timeout을 검증하며 redirect를 따라가지 않습니다.
`./gradlew bootRun`은 루트 `.env`를 자동으로 읽지 않습니다. 자동 설정 전달은 Compose를 사용합니다.
루트 `.env` 전체를 source하거나 Core에 OpenAI 키를 주입하지 않습니다.
Compose는 내부 DNS `http://ai-service:8000`을 고정 사용하고 CORS를 web 포트에 맞춥니다.
공통 `docker-compose.yaml` + prod는 기존 PostgreSQL·Mailpit과 소스 빌드 앱을, base + dev는 CI의 `:develop` 앱 이미지와 기존 외부 DB·SMTP를 사용합니다. base 단독 실행이나 dev 서버 소스 build는 하지 않습니다.
콘텐츠는 기본 비활성이며 `CONTENT_ENABLED=true`일 때도 Auth와 같은 DB·자격증명을 사용합니다. 실제 `INTERNAL_TOKEN`은 Core·AI에만 전달하고 개발 Principal은 주입하지 않습니다.
실행 설정은 [인프라 안내](../../infrastructure/README.md)를 참고하세요.

### CI 계층과 선택 실행

로컬 개발에서는 `unitTest --tests ...`만 선택 실행합니다. Spring context·HTTP·DB·전체 suite·빌드는 로컬 개발 검증으로 실행하지 않습니다.
`build.gradle`의 `integrationTestClasses`를 `unitTest`에서 제외하고 `integrationTest`에서만 포함하므로 테스트를 중복 실행하지 않습니다.
`AiServiceClientPropertiesTest`처럼 context가 섞인 클래스도 통합입니다. 새 Spring/HTTP/DB 테스트는 분류 목록을 갱신합니다.

CI가 이 디렉터리에서 `./gradlew unitTest --no-daemon --tests 'ai.storyfork.core.auth.*'`와 `./gradlew integrationTest --no-daemon --tests ...`를 직접 호출합니다. 별도 runner·shell wrapper는 없습니다.
Gradle `--tests`로 auth/content/health 기능 전체를 선택하고 공통·설정·의존성·미등록 기능 변경은 필터 없이 Core 전체로 확장합니다.
통합 job은 임시 PostgreSQL·Mailpit에서 기존 Flyway와 `AUTH_INTEGRATION_TEST=true`, `AUTH_MAILPIT_API`, `TEST_CONTENT_DATABASE_URL` 조건부 테스트를 실행합니다.
Content의 기존 `content_test`/빈 비밀번호는 격리 runner PostgreSQL trust 인증에만 적용하며 운영 설정이 아닙니다.
그 뒤 관련 HTTP 시스템 시나리오가 CI Compose에서 실행됩니다. [공통 검증](../../README.md#검증)을 따르며 실제 hosted `Required CI` 결과 확인 전에는 검증 대기입니다.

회차별 초안·수동 버전·복원 API와 저장 실패 경계는 [이슈 #50 대응](../../docs/issue-50-alignment.md)을 참고하세요.
