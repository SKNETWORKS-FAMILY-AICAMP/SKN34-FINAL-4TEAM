# STORYFORK Core Service (현재 모듈: `core-api`)

Spring Boot·Kotlin 공개 API 개발 기반입니다. Health와 시연용 이메일 가입·인증 및 로그인·세션 API를 제공합니다. 계정 복구·프로필 및 실제 약관·동의는 아직 구현되지 않았으므로 운영 가입용이 아닙니다. 작품·버전·Fork·권한·승인·발행·크레딧의 목표 책임은 Core Service에 있습니다.

## 공개 계약

| 경로 | 성공 JSON |
|---|---|
| `GET /api/v1/health` | `{"status":"up","service":"storyfork-core-api"}` |
| `GET /api/v1/health/ai-service` | `{"status":"up","service":"storyfork-ai-service"}` |

자체 Health는 AI 장애와 무관합니다. AI Health는 내부 `/internal/v1/health`의 상태와 서비스명을
정확히 검증합니다. OpenAI 인증이나 모델 호출을 검증하지 않습니다.

`GET /api/v1/auth/csrf`에서 토큰과 쿠키를 받은 뒤 `X-CSRF-TOKEN`을 보내 모든 변경 요청을 호출합니다. 인증 링크는 URL fragment로 토큰을 전달합니다. 가입 후보는 PostgreSQL에 해시만 저장하며 이메일 인증 전 회원을 생성하지 않습니다. 링크는 24시간 유효하고 한 번만 사용할 수 있습니다. 재발송은 일반화된 202를 반환하지만 메일 전송 장애 시 기존 후보 여부에 따라 응답이 달라질 수 있어 열거 방지의 한계가 있습니다. 메일과 데이터베이스는 로컬 검증용이며 운영 SMTP·TLS 정책은 미정입니다.

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
| `AI_SERVICE_READ_TIMEOUT` | `12s` |
| `APP_CORS_ALLOWED_ORIGIN` | `http://localhost:5173` |
| `CORE_DATABASE_URL`, `CORE_DATABASE_USER`, `CORE_DATABASE_PASSWORD` | 필수 |
| `CORE_SMTP_HOST`, `CORE_SMTP_PORT` | 필수 |
| `AUTH_PUBLIC_ORIGIN`, `AUTH_MAIL_FROM` | 필수 |
| `AUTH_JWT_SECRET` | 필수, 32바이트 이상의 무작위 키를 Base64 인코딩 |
| `AUTH_COOKIE_SECURE` | `true`; 로컬 HTTP 검증에서만 `false` |

AI 주소는 origin만 허용하고 양수 timeout을 검증하며 redirect를 따라가지 않습니다.
위 실행기는 루트 `.env`의 Core 허용 설정만 로드합니다. Core에 OpenAI 키를 주입하지 않습니다.
`./gradlew bootRun` 직접 실행은 `.env`를 로드하지 않습니다.
Compose는 내부 DNS `http://ai-service:8000`을 고정 사용하고 CORS를 web 포트에 맞춥니다.
실행 설정은 [인프라 안내](../../infrastructure/README.md)를 참고하세요.
