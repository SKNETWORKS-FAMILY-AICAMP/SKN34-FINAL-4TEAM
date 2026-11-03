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

콘텐츠는 #84 기준으로 `work`, `episode`, `episode_version`, `publication`, `world`, `fork`, `proposal`, `context`로 책임을 분리합니다. 각 기능의 `controller → service → repository`를 사용하며 공개·내부 서비스 DTO는 `service/dto`, 생성 HTTP 전용 DTO는 `proposal/client/dto`에 둡니다. 같은 계약의 DTO는 Controller와 Service가 재사용하고, Entity·도메인 객체는 HTTP에 직접 노출하지 않습니다.

`episode`는 생성·조회·초안 수정만 담당합니다. 삭제는 보존 정책 미확정으로 API를 추가하지 않았습니다. 버전 저장·복원, 발행, 세계관·Fork·AI 처리는 각 소유 Service가 담당하며 기존 URL·JSON·UUID·revision을 유지합니다. 자세한 대응표와 검증 상태는 [#84 대응](../../docs/issue-84-content-boundaries.md)을 참고하세요.

콘텐츠 영속성은 JPA Entity·Spring Data Repository, 동시 편집은 정렬된 작품 행의 `PESSIMISTIC_WRITE`와 revision 비교를 사용합니다. Auth JDBC와 콘텐츠 JPA는 DataSource·TransactionManager를 구분하며 `CONTENT_ENABLED=false`일 때 콘텐츠 영속성 단위는 초기화하지 않습니다. JPA 추가 의존성은 팀 지침을 따르기 위한 최소 starter와 Kotlin Entity 플러그인입니다.

SQL은 `db/migration/auth`, `db/migration/content`로 배치하고 기존 두 이력 테이블을 유지합니다. 과거 공통 콘텐츠 V1~V8을 새 도메인 이력으로 재실행하지 않습니다. `content/migration`의 V5·JDBC·모델은 과거 이관 재현 전용이며 런타임 저장 경로에서 호출하지 않습니다.

콘텐츠 정본은 최신 ERD에 따른 관계형 테이블에 저장합니다. 기존 JSONB는 읽기 전용 이관 백업으로 남깁니다. [ERD 대응과 마이그레이션](../../docs/content-erd-migration.md)에 테이블별 역할·기존 데이터 보존·남은 범위를 기록했습니다.

Gradle group `ai.storyfork`, 애플리케이션 `storyfork-core-api`, Kotlin namespace `ai.storyfork.core`입니다.
main/test 디렉터리는 각각 `src/{main,test}/kotlin/ai/storyfork/core/`로 package와 일치합니다.

- `_health/controller`: 자체 상태.
- `_health_ai_service/controller → service → client`: 내부 응답 조회와 검증.
- `controller/dto`: 공개 응답, `client/dto`: 신뢰하지 않는 외부 payload, `service/dto`: 검증된 결과.
- `_common/ai_config`: AI 주소·timeout·RestClient 설정.
- `_common/helper`: 기존 HTTP 설정 검증과 통신 실패 분류 경계.
- `_common/exception`: AI 실패 분류와 안전한 ProblemDetail.
- `_common/config`: 단일 origin CORS.

현재 필요한 계층만 유지하며 한 줄 Facade나 미래 도메인 폴더를 추가하지 않습니다.

## 실행과 검증

JDK **21**에서 이 디렉터리를 기준으로 실행합니다.

```bash
# 루트 .env의 Core 설정만 전달합니다 (Python 3 및 uv 필요).
python3 ../../infrastructure/scripts/run-native.py core-api
./gradlew clean test --no-daemon
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

`proposal/config/GenerationClientConfig`는 생성 전용 HTTP 클라이언트를 만들며 Health 클라이언트의 제한시간을 변경하지 않습니다.
AI 주소는 origin만 허용하고 양수 timeout을 검증하며 redirect를 따라가지 않습니다.
위 실행기는 루트 `.env`의 Core 허용 설정만 로드합니다. Core에 OpenAI 키를 주입하지 않습니다.
`./gradlew bootRun` 직접 실행은 `.env`를 로드하지 않습니다.
Compose는 내부 DNS `http://ai-service:8000`을 고정 사용하고 CORS를 web 포트에 맞춥니다.
실행 설정은 [인프라 안내](../../infrastructure/README.md)를 참고하세요.

회차별 초안·수동 버전·복원 API와 저장 실패 경계는 [이슈 #50 대응](../../docs/issue-50-alignment.md)을 참고하세요.
