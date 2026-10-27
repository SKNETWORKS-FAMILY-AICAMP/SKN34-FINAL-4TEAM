# STORYFORK Core API

Spring Boot·Kotlin 공개 API 개발 기반입니다. 현재 두 Health 경로만 제공합니다.
작품·버전·Fork·권한·승인·발행·크레딧의 목표 책임은 Core에 있지만 업무 기능과 저장소는 아직 없습니다.

## 공개 계약

| 경로 | 성공 JSON |
|---|---|
| `GET /api/v1/health` | `{"status":"up","service":"storyfork-core-api"}` |
| `GET /api/v1/health/ai-service` | `{"status":"up","service":"storyfork-ai-service"}` |

자체 Health는 AI 장애와 무관합니다. AI Health는 내부 `/internal/v1/health`의 상태와 서비스명을
정확히 검증합니다. OpenAI 인증이나 모델 호출을 검증하지 않습니다. 업무 API는 없습니다.

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

AI 주소는 origin만 허용하고 양수 timeout을 검증하며 redirect를 따라가지 않습니다.
위 실행기는 루트 `.env`의 Core 허용 설정만 로드합니다. Core에 OpenAI 키를 주입하지 않습니다.
`./gradlew bootRun` 직접 실행은 `.env`를 로드하지 않습니다.
Compose는 내부 DNS `http://ai-service:8000`을 고정 사용하고 CORS를 web 포트에 맞춥니다.
실행 설정은 [인프라 안내](../../infrastructure/README.md)를 참고하세요.
