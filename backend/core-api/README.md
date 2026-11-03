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

`ContentConfig`는 생성 전용 HTTP 클라이언트를 만들며 Health 클라이언트의 제한시간을 변경하지 않습니다.
AI 주소는 origin만 허용하고 양수 timeout을 검증하며 redirect를 따라가지 않습니다.
위 실행기는 루트 `.env`의 Core 허용 설정만 로드합니다. Core에 OpenAI 키를 주입하지 않습니다.
`./gradlew bootRun` 직접 실행은 `.env`를 로드하지 않습니다.
Compose는 내부 DNS `http://ai-service:8000`을 고정 사용하고 CORS를 web 포트에 맞춥니다.
실행 설정은 [인프라 안내](../../infrastructure/README.md)를 참고하세요.

회차별 초안·수동 버전·복원 API와 저장 실패 경계는 [이슈 #50 대응](../../docs/issue-50-alignment.md)을 참고하세요.

## 설정 이미지·일반 파일 (#87)

`CONTENT_ENABLED=true`, `SETTING_ATTACHMENTS_ENABLED=true`와 미리 만든 **비공개** S3 버킷이 필요합니다.
로컬은 소스 빌드 MinIO, 실제 배포 대상은 AWS S3입니다. 공식 AWS SDK v2만 사용하며 버킷 생성·공개 ACL·presigned URL·외부 URL 다운로드는 하지 않습니다.
`ATTACHMENT_S3_ENDPOINT`를 비우면 일반 AWS S3 endpoint를 사용합니다. `ATTACHMENT_S3_REGION`(기본 `us-east-1`, 없으면 `AWS_REGION`)과
`ATTACHMENT_S3_BUCKET`을 지정하고 SDK 기본 자격증명 체인(환경변수, profile, workload role)을 사용합니다.
로컬 MinIO는 endpoint override와 path-style을 사용합니다. AWS 유료 호출·실제 IAM·TLS·배포는 이번 로컬 검증에 포함하지 않습니다.

기존 `setting_document`의 논리 ID를 `{settingId}`로 사용합니다. 작품과 로컬 세계관의 소유자가 JWT Principal과 일치해야 합니다.
현재 Content가 로컬 세계관 ID를 작품 ID로 만드는 규칙을 조회에 재사용합니다. **following Fork는 원본 첨부를 볼 수 없으며**,
독립 후에도 첨부를 자동 복사하지 않습니다. 설정의 public 표시·작품 발행·이미지 URL 지식은 첨부 접근 권한을 주지 않습니다.
공개/회차별 배포, 과거 파일 버전 복원, 프로필·표지·원고·AI 연계는 구현하지 않았습니다.

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
  원래 파일명을 저장소 key로 사용하지 않습니다. MIME은 검증된 형식 또는 `application/octet-stream`을 받습니다.
- 설정당 이미지 **10개**는 JPA `PESSIMISTIC_WRITE` 설정 행 잠금과 transaction 내 count로 동시 요청에도 지킵니다.
  일반 파일에는 이미지 디코딩·10개 한도를 적용하지 않습니다. `FILE→IMAGE` 교체는 한도를 검사하고 `IMAGE→FILE`은 자리를 반환합니다.
- 같은 설정의 조회/변경은 저장소 I/O까지 잠금을 유지합니다. 초기 트래픽용 단순성 선택이며 고부하 처리 성능 보장은 아닙니다.

첨부 오류 DTO는 `{"code":"ATTACHMENT_…","detail":"고정 안전 문구"}`입니다.
형식/입력 오류 422 `ATTACHMENT_INVALID`, 용량 초과 413 `ATTACHMENT_TOO_LARGE`, 이미지 한도 409 `ATTACHMENT_IMAGE_LIMIT`,
미존재/권한 없음 404 `ATTACHMENT_NOT_FOUND`, 저장소/DB 실패 503 `ATTACHMENT_STORAGE_FAILURE`/`ATTACHMENT_DATABASE_FAILURE`를 반환합니다.
예외·SQL·저장소 원문을 노출하지 않습니다.

### DB·파일 실패 경계

새 영속성은 `settingattachment/controller → service → JpaRepository / AttachmentStorageClient`로 분리합니다.
DTO는 `settingattachment/service/dto`, 저장소 전용 DTO는 `settingattachment/client/dto`에 둡니다.
기존 Auth/Content JDBC는 그대로이며 새 직접 SQL 영속성은 추가하지 않습니다.
새 Flyway는 `db/migration/settingattachment`와 `setting_attachment_schema_history`를 사용합니다.
Auth SQL은 **내용·파일명·버전·기존 `flyway_schema_history`를 유지**하고 `db/migration/auth`로만 이동했습니다.
독립 V1 충돌을 피하도록 Auth location도 그 leaf만 읽습니다. 첨부 EntityManager 초기화는 Auth Flyway → 기존 Content → 첨부 migration 순서를 명시해 빈 DB에서도 Auth 이력이 먼저 생성되게 합니다. 기존 Content의 location/history는 변경하지 않았습니다.

교체는 새 UUID object에 먼저 업로드하며, 삭제/교체는 기존 바이트를 크기 제한 내 메모리에 보관한 후 DB flush → 기존 object 삭제 → commit 순서입니다.
저장소 삭제가 실패하거나(서버 반영 후 응답 유실 포함) DB commit이 실패하면 transaction을 rollback하고 기존 object를 복원합니다.
일반적인 실패에서는 기존 참조와 다운로드를 유지하며 실패를 성공으로 숨기지 않습니다.
**DB와 S3는 원자적이지 않습니다.** 프로세스 종료·동시 저장소 장애로 복원이 실패하면 503 `ATTACHMENT_RECOVERY_REQUIRED`를 반환하고
운영자 대조/복구가 필요합니다. commit 응답 유실 시 성공 여부를 단정할 수 없으므로 새 object도 지우지 않습니다.
실패 업로드/DB 실패 뒤 미참조 object가 남을 수 있습니다. 자동 정리 worker/outbox/버전 복원은 없으며 운영자가 DB object key와 버킷을 대조해야 합니다.
부팅 시 버킷 연결을 성공으로 가정하지 않으며, 없거나 접근할 수 없는 버킷은 실제 요청 시 503입니다.

### 선택 검증

```bash
# CI에서도 실행하는 저장소 불필요 검사
./gradlew test --tests 'ai.storyfork.core.settingattachment.AttachmentUploadHelperTest' --tests 'ai.storyfork.core.settingattachment.AttachmentMigrationLocationTest' --no-daemon
# 실제 MinIO + 일회용 PostgreSQL; DB 사용자는 content_test, password는 로컬 trust 테스트 전용 빈 값
# TEST_ATTACHMENT_DATABASE_URL, TEST_ATTACHMENT_S3_ENDPOINT, AWS_ACCESS_KEY_ID/SECRET_ACCESS_KEY를 격리 환경에 설정
./gradlew test --tests 'ai.storyfork.core.settingattachment.SettingAttachmentHttpTest' --no-daemon
```

HTTP 통합 검사는 `TEST_ATTACHMENT_DATABASE_URL`이 있을 때만 실행하며 테스트 전용 `issue87-test` 비공개 버킷을 만듭니다.
실제 DB flush/deferred commit 실패와 저장소 응답 유실의 보상 동작을 검사합니다. fault test 외의 HTTP lifecycle은 실제 MinIO를 사용합니다.
CI는 DB/MinIO를 실행하지 않으므로 해당 통합 검사는 CI에서 제외되고 별도 로컬 증거가 필요합니다. `Required CI`는 게시 승인 후 최신 커밋에서 확인해야 합니다.
화면/브라우저 호출부 변경이 없어 Aside 브라우저 E2E는 제외하며 실제 HTTP·저장소 검증을 대신 기록합니다.
