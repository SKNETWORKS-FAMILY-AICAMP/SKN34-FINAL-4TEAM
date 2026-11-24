# STORYFORK Docker 실행 기반

Core → Content 업무·테스트·인증 확인·공개 라우팅·이미지/CI 연결을 소스에 반영했습니다. **hosted CI·실제 DB 전환·게시·배포는 확인 대기**입니다. 운영 서비스(operations-service)는 신고·회원·관리자 공개 API를 위해 Compose에 추가했으며 호스트 포트 없이 컨테이너 네트워크에서만 노출합니다. develop CD는 publish 워크플로에서 operations-service 이미지도 빌드·게시하고 배포 build-tree 검사에 포함합니다. [서비스 경계](../docs/design/service-boundaries.md)와 [이관 계약](../docs/design/content-service-migration-contract.md)을 따릅니다.

Content의 초기 SQL은 사용자가 승인한 개발용 fresh 이력입니다. 과거 Content history와 호환되지 않으며 실제 대상 DB·보존/복구 범위·중단 시간을 확인하기 전 기존 DB에 바로 배포하지 않습니다. 이 문서는 DB 삭제·volume 초기화·개인 `.env` 변경·배포 승인이 아닙니다. Auth·첨부·독립 WorldStudio의 SQL/이력은 유지합니다.

## 서비스와 진입점

현재 Compose의 앱은 **web·core-api·content-service·operations-service·ai-service 다섯 개**입니다. Core는 회원·인증·세션·Health, Content는 기존 콘텐츠·첨부·WorldStudio, AI는 요청된 모델 실행을 소유합니다. 정산·알림·운영 업무는 목표 책임이며 구현 완료를 뜻하지 않습니다. 로컬·develop·prod는 여기에 **Langfuse(LLMOps, DEC-55)를 같은 프로젝트로 함께 켭니다**([Langfuse 절](#집필-ai-추적용-langfuse-302)). 회차 원고 전처리 Celery 큐의 워커 `ai-worker`(ai-service와 같은 이미지의 별도 컨테이너, 브로커는 알림 사건과 같은 RabbitMQ 컨테이너·자격)만 더하며 그 밖의 새 큐/worker/Start 서버는 추가하지 않습니다.

[`docker-compose.yaml`](docker-compose.yaml)은 공통 환경·내부 포트만 정의하는 base로 **단독 실행하지 않습니다**.

| 항목 | 루트 [`compose.yaml`](../compose.yaml) / base + [`docker-compose.local.yaml`](docker-compose.local.yaml) | base + [`docker-compose.dev.yaml`](docker-compose.dev.yaml) | base + [`docker-compose.prod.yaml`](docker-compose.prod.yaml) |
|---|---|---|---|
| 용도 | 로컬 개발의 소스 빌드 runtime, CI의 소스 빌드 기반 | develop 배포 서버 | 실제 운영 배포 서버용 설정 준비 |
| 프로젝트 | `storyfork-local` | `storyfork-develop-cd` | `storyfork-production` |
| 앱 | 다섯 앱 소스 build, web은 nginx 정적 runtime, HMR 아님 | 다섯 앱의 GHCR `:develop`, `linux/amd64` | 다섯 앱의 GHCR `:main`, `linux/amd64`, 게시 여부 미확인 |
| DB·SMTP | 새 프로젝트 범위 `core-postgres` volume의 PostgreSQL + Mailpit | 로컬과 같은 PostgreSQL·Mailpit 정의 재사용, 별도 프로젝트 DB volume | 별도 승인·준비한 외부 PostgreSQL·SMTP, 내장 DB·Mailpit·volume 없음 |
| web 포트 | `127.0.0.1:${WEB_PORT:-5173}` | `127.0.0.1:${CD_WEB_PORT}` | `127.0.0.1:${WEB_PORT}` |
| Langfuse | 같은 프로젝트에 항상 `include`(웹·worker·ClickHouse·Redis, PostgreSQL·MinIO는 앱 것 공유, [절차](#로컬에서-켜기)) | 같은 프로젝트에 `include`(로컬과 같음) | 같은 프로젝트에 `include`(ClickHouse·Redis, PostgreSQL·S3는 `LANGFUSE_DATABASE_URL`·`LANGFUSE_S3_ENDPOINT`로 외부 것) |
| 추가 호스트 공개 | Core 8080·Content 8081·DB 5432·SMTP 1025·Mailpit 8025, 모두 loopback | 없음 | 없음 |

루트 진입점은 Compose native `include`로 base+local을 재사용하므로 build context는 `infrastructure/` 기준의 `../frontend`·`../backend/*`입니다.
루트 `.env`는 기본 명령에서 자동 로드하며 컨테이너에는 서비스별 allowlist만 전달합니다. dev는 local 파일의 PostgreSQL·Mailpit 서비스만 native `extends`로 재사용하고 호스트 포트는 제거합니다. 원격 CD에서는 `--project-directory`와 임시 설정 위치가 다르므로 `CD_LOCAL_COMPOSE_FILE`(extends)과 `CD_LANGFUSE_COMPOSE_FILE`(include)을 임시 파일의 절대 경로로 고정합니다. dev 렌더링에 앱 build는 없으며 DB volume은 `storyfork-develop-cd_core-postgres`로 격리됩니다. Compose v2.24.4 이상을 사용합니다.

```text
Browser → web nginx
           ├─ /api/v1/works 및 /api/v1/public/works(+하위)·/api/v1/public/genres·/api/v1/public/card-categories → Content:8081 → AI:8000
           │                                                   └→ Core 내부 인증 확인
           ├─ /api/v1/operations/{reports,members,admins,support,works,comments,genres,credits,world-studios,card-categories,admin/notices,public/notices,admin/events,public/events,admin/activities}(+하위) → Operations:8082 → Core·Content 내부 API
           ├─ /api/v1/operations/{dashboard,llmops,alerts,jobs}(+하위) → Operations:8082 → Langfuse Public API·AI·Core·Content 내부 API
           └─ 나머지 /api → Core:8080 → AI Health
```

공개 URL·JSON·쿠키·Bearer·CSRF 계약을 유지합니다. 내부 `/internal/v1/auth/verify`를 공개 proxy에 등록하지 않으며 Core는 콘텐츠 중계 프록시가 아닙니다. API 404는 SPA HTML로 바꾸지 않습니다. UI deep link만 SPA로 연결합니다. 로컬은 loopback 개발용이며 배포 서버의 web도 loopback에만 노출합니다. prod 설정만으로 **인터넷 운영용 TLS·ingress 준비 완료가 아닙니다**.

## 시작과 설정

다음은 담당자의 수동 실행 안내이며 로컬 자동 검증에서 앱/DB/컨테이너를 기동하지 않습니다. `cp -n .env.example .env`로 루트 설정을 준비하되 기존 파일은 덮어쓰지 않습니다. 서비스별 `.env`는 만들지 않습니다. 로컬 Compose는 Langfuse도 함께 켜므로 `LANGFUSE_*` 값도 채워야 합니다([로컬에서 켜기](#로컬에서-켜기)).

로컬 Core에는 직접 준비한 `DATABASE_USER/PASSWORD`, `AUTH_MAIL_FROM`, `AUTH_JWT_SECRET`이 필요합니다. JWT 키는 32바이트 이상 무작위 값의 Base64 인코딩이며 Core에만 전달합니다. 기본 비밀번호나 서명 키는 제공하지 않습니다. `AUTH_PUBLIC_ORIGIN`을 실제 web 주소에 맞추고 HTTP 로컬 검증에서만 `AUTH_COOKIE_SECURE=false`를 사용합니다. 로컬 DB URL·SMTP는 Compose 내부 PostgreSQL·Mailpit으로 고정합니다. Mailpit 화면(기본 8025)은 인증 메일을 포함하므로 로컬 전용입니다. dev도 내부 PostgreSQL·Mailpit을 쓰지만 호스트에 노출하지 않으며, prod만 외부 DB·SMTP를 사용합니다. 가입 인증 24시간, 복구·이메일 변경 1시간 계약과 실제 API는 [Core 문서](../backend/core-api/README.md#공개-계약)를 따릅니다.

Content는 항상 별도 `CONTENT_CORE_AUTH_TOKEN`이 필요합니다. 32자 이상·개행 없는 값을 Core/Content에만 동일하게 설정합니다. 사용자 Bearer·JWT 서명 키·AI의 `INTERNAL_TOKEN`과 다른 자격입니다. 생성은 Content/AI의 동일한 `INTERNAL_TOKEN` 및 AI에만 주입한 키/모델을 사용합니다. 인증 확인에는 캐시·자동 재시도·fallback이 없으며 Core 장애를 사용자 401로 숨기지 않습니다([Content 계약](../backend/content-service/README.md#core-인증-클라이언트--실제-연결)).

각 스택 안에서 Core와 Content는 **같은 DB 대상·계정**을 사용합니다. local/dev/prod 모두 같은 `DATABASE_*` 이름을 쓰고 값만 각 서버의 `.env`가 정합니다. 스택 사이의 DB·자격증명을 공유한다는 뜻이 아니며 DB 복사·추가 WorldStudio pool은 없습니다. Core Auth 초기화/Health 뒤에 Content를 시작하며 각 서비스는 자기 Entity/Repository·migration만 소유합니다. Content의 7개 leaf/전역 V1~V9와 이전 이력의 비호환성은 [fresh migration 안내](../backend/content-service/README.md#같은-db와-fresh-콘텐츠-migration)를 따릅니다.

```bash
# 저장소 루트: 사용자 자격증명을 준비한 뒤 수동 실행, .env 자동 로드
docker compose up -d --build
# http://127.0.0.1:5173
docker compose down
```

`storyfork-local_core-postgres`는 새 프로젝트 범위 volume입니다. 과거 `storyfork-dev`·`storyfork-prod-validation`·CD의 컨테이너/volume을 가져오거나 지우지 않습니다. 기존 `COMPOSE_FILE`·`COMPOSE_PROJECT_NAME` override가 있으면 기본 진입점/격리를 바꿀 수 있으므로 확인합니다. 포트가 이미 점유돼 있으면 시작이 실패합니다. 기존 앱을 중지하지 말고 루트 `.env`의 로컬 포트와 `AUTH_PUBLIC_ORIGIN`을 조정합니다.

`down`에는 volume 삭제를 붙이지 않으며 해당 로컬 프로젝트만 대상으로 합니다. **소스 빌드는 hot reload가 아닙니다.** Vite/소스 mount가 없으므로 변경 후 `docker compose up -d --build`로 다시 빌드하거나 아래 네이티브 명령을 사용합니다. dev 배포는 아래 CD 절차를 사용하며 단순 수동 `pull/up`은 build-tree 일치·구 writer 중지·fresh 대상 승인 검사를 대신하지 못합니다.

| 변수 | 기본값 | 소비 경계 |
|---|---|---|
| `OPENAI_API_KEY` | 빈 값 | AI runtime만 |
| `OPENAI_MODEL` | local·prod 빈 값 / dev `gpt-5.6-luna` | AI runtime만, 팀 모델 선정·접근 검증 아님 |
| `EVALUATION_JUDGE_MODEL` | 빈 값(`OPENAI_MODEL`) | AI의 운영 회귀 평가(`ai-jobs-worker`)·누설 판정의 채점 모델, 예 `gpt-6.2-sol`. 바꾸면 이전 Run과 채점 모델이 달라 첫 기준 비교가 흔들린다 |
| `EVAL_TOLERANCE` | `0.1` | AI 회귀 평가의 통과 허용 오차(지표별 기준 평균 − 이 값 이상이면 통과). 점수는 모두 0~1이다(시뮬레이션 평가 세트의 1~5점은 (점수 − 1)/4로 기록) |
| `AI_SERVICE_CONNECT_TIMEOUT` | `1s` | Core/Content → AI |
| `AI_SERVICE_READ_TIMEOUT` | `12s` | Core → AI Health |
| `AI_GENERATION_READ_TIMEOUT` | `75s` | Content → AI 생성 |
| `SERIAL_SIMULATION_CREDIT_LIMIT` / `SERIAL_CHOICE_CREDIT_LIMIT` / `SERIAL_SUMMARY_CREDIT_LIMIT` / `SERIAL_EPISODE_CREDIT_LIMIT` | `5` / `5` / `5` / `1000` | Content만, AI 자율 연재의 크레딧 예약 상한(시뮬레이션 제안 글은 작성자, 선택지 생성·회차 요약·회차 실행은 작품 소유자 부담). 회차 실행 1000은 인물 시뮬레이션 장면(보통 300~500)과 집필·검수·재작성까지 같은 예약으로 세는 추정 상한이며 실측 전이라 첫 실행 뒤 다시 맞춥니다. 소유자의 사용 가능 잔액이 이 값 이상이어야 실행됩니다(시연 계정은 관리자 크레딧 지급으로 미리 채웁니다). 이전 `.env.example`로 만든 기존 `.env`(`cp -n`은 덮어쓰지 않습니다)나 배포 환경 변수에 `SERIAL_EPISODE_CREDIT_LIMIT=150`·`250`이 남아 있으면 그 값이 기본값보다 우선하므로 1000으로 고치거나 지워야 합니다(그대로 두면 사용량이 그 값을 넘는 회차 실행이 `크레딧 상한을 넘었습니다.`로 실패합니다). 회차 실행의 AI 읽기 한도 35분과 `running` 정체 정리 45분은 환경 변수가 아닌 코드 상수입니다 |
| `CORE_AUTH_BASE_URL` | native `http://127.0.0.1:8080`, Compose 내부 DNS | Content → Core 인증 확인 |
| `CORE_AUTH_CONNECT_TIMEOUT` / `CORE_AUTH_READ_TIMEOUT` | `1s` / `3s` | Content 인증 확인 |
| `CONTENT_CORE_AUTH_TOKEN` | 빈 값 | Core/Content만, 활성화 시 필수 |
| `DATABASE_*` | 빈 계정, `storyfork` DB | Core·Content(Studio 포함)·운영 공용 PostgreSQL(운영은 전용 `operations` schema) |
| `INTERNAL_TOKEN` | 빈 값 | Content·Operations·AI (Content/AI 생성, Operations → AI 작업 접수, AI 작업 워커 → Operations 정기 작업 실행) |
| `AI_CELERY_BROKER_URL` | Compose는 `CORE_RABBITMQ_*`로 `amqp://<user>:<password>@rabbitmq:5672//`를 조립(비밀번호가 URL에 들어가 영문·숫자 권장), 네이티브는 빈 값 | AI(ai-service·ai-worker)만, 전처리 Celery 큐 |
| `OPERATIONS_SERVICE_TOKEN` | 빈 값(운영 호출 거절) | Operations·Core·Content |
| `LANGFUSE_PUBLIC_KEY` / `LANGFUSE_SECRET_KEY` | 빈 값(네이티브는 추적 끔, Compose는 필수) | AI·Operations, Langfuse 서버의 초기 프로젝트 키(세 곳이 같은 값) |
| `CREDIT_SIGNUP_TRIAL_AMOUNT` | `0`(가입 체험 크레딧을 지급하지 않음) | Core만, 양수면 가입한 회원에게 한 번 지급(30일 뒤 소멸) |
| `APP_CORS_ALLOWED_ORIGIN` | 빈 값이면 web 포트에서 계산 | Core/Content의 단일 origin |
| `WEB_PORT` | local `5173` / prod 필수 | web loopback (dev는 CD workflow의 `CD_WEB_PORT`) |
| `CORE_API_PORT` / `CONTENT_SERVICE_PORT` | `8080` / `8081` | local API loopback |
| `DATABASE_PORT` | `5432` | local DB loopback, 컨테이너 내부는 고정 5432 |
| `CORE_MAILPIT_SMTP_PORT` / `CORE_MAILPIT_WEB_PORT` | `1025` / `8025` | local Mailpit loopback |
| `CD_DIRECTORY` / `CD_WEB_PORT` | 필수 | dev 전용 디렉터리 label / loopback |

Health는 OpenAI 인증·모델 접근 검증이 아니며 모델 클라이언트를 만들지 않습니다. 생성 제공사 설정 누락은 503입니다. OpenAI 키를 Frontend·Core·Content·build ARG에 넣지 않습니다. 루트 `.env` 전체를 프로세스에 주입하지 않습니다.

네이티브는 각 서비스의 기본 명령(`pnpm dev`, `./gradlew bootRun`, `uv run --locked uvicorn app.main:create_app --factory --reload --port 8000`)을 사용합니다. Core/Content 기본 포트는 8080/8081입니다. 필요한 변수만 해당 터미널에 전달하며 루트 `.env` 전체를 source하지 않습니다. Vite는 `VITE_DEV_PROXY_TARGET`(Core)·`VITE_CONTENT_DEV_PROXY_TARGET`(Content)·`VITE_OPERATIONS_DEV_PROXY_TARGET`(Operations, 기본 8082)으로 경로를 분기합니다. Operations를 네이티브로 띄울 때는 `OPERATIONS_LANGFUSE_BASE_URL`(`http://127.0.0.1:3000`)·`OPERATIONS_AI_BASE_URL`(`http://127.0.0.1:8000`)·`OPERATIONS_RABBITMQ_*`와 Langfuse 키·`INTERNAL_TOKEN`도 같은 터미널에 설정합니다(Compose는 내부 주소와 Core 값을 씁니다). 기본 web origin은 `http://localhost:5173`이며 CORS도 실제 origin과 맞춥니다. 생성 timeout을 늘릴 때 브라우저 80초/nginx 90초 한도도 함께 검토합니다.

## 운영 서버 설정 준비 — prod

prod는 **게시된 `:main` runtime 이미지 네 개 + 외부 PostgreSQL·SMTP**만 선택합니다. 소스 build·PostgreSQL·Mailpit·로컬 자격증명·앱 DB volume을 포함하지 않습니다. 예외로 Langfuse는 `include`로 함께 켜며 자체 저장소 컨테이너와 volume을 씁니다([Langfuse 절](#집필-ai-추적용-langfuse-302)). 현재 [`publish-images.yml`](../.github/workflows/publish-images.yml)은 **develop만 게시**하므로 `:main`의 존재·접근 가능 여부는 미확인입니다. 이미지 목록에 이름이 있다고 실제 게시된 것은 아닙니다. main 게시/배포 trigger는 추가하지 않았습니다.

변수 이름은 local/dev와 같습니다. 운영 서버 담당자가 서버 전용 `.env`에 다음 값을 준비하며 로컬 `.env`를 복사하지 않습니다. `config` 단계에서 비어 있거나 누락된 필수값은 명시적으로 실패합니다.

| 변수 | 요구사항 |
|---|---|
| `DATABASE_URL` / `DATABASE_USER` / `DATABASE_PASSWORD` | 승인된 외부 PostgreSQL JDBC 대상·전용 자격, Core/Content가 같은 대상 사용 |
| `CORE_SMTP_HOST` / `CORE_SMTP_PORT` | 준비한 외부 SMTP, STARTTLS 사용·필수 |
| `AUTH_PUBLIC_ORIGIN` / `AUTH_MAIL_FROM` | 실제 HTTPS web origin(CORS에도 사용) / 승인된 발신 주소 |
| `AUTH_JWT_SECRET` | 별도로 생성한 32바이트 이상 Base64 키, Core에만 전달 |
| `CONTENT_CORE_AUTH_TOKEN` / `INTERNAL_TOKEN` | 각각 Core↔Content / Content↔AI의 별도 무작위 서비스 자격 |
| `OPERATIONS_SERVICE_TOKEN` | Operations → Core/Content 내부 호출용 별도 무작위 서비스 자격(32자 이상), 세 서비스에 같은 값 전달 |
| `WEB_PORT` | 담당자가 준비한 비충돌 loopback 포트, TLS ingress는 별도 |
| `LANGFUSE_*` | [Langfuse 절](#집필-ai-추적용-langfuse-302)의 값(Langfuse 서버 비밀값·프로젝트 키·초기 관리자). 비어 있으면 `config`가 실패 |

SMTP 인증은 기본 `CORE_SMTP_AUTH=true`이며 제공사가 요구하는 `CORE_SMTP_USERNAME/PASSWORD`를 설정합니다. 인증 없는 신뢰 relay라면 해당 정책을 확인한 뒤 `CORE_SMTP_AUTH=false`로 명시합니다. STARTTLS를 지원하지 않는 제공사와의 호환성은 별도 결정이 필요하며 TLS 연결 성공을 주장하지 않습니다. `OPENAI_API_KEY/MODEL`은 AI에만 전달합니다(local·dev에서 `OPENAI_API_KEY`는 필수). Neo4j·RabbitMQ는 local·개발 배포에서 항상 뜨며 `NEO4J_PASSWORD`·`CORE_RABBITMQ_PASSWORD`가 필요합니다. WorldStudio schema는 Content 시작 시 적용됩니다.

prod의 `AUTH_COOKIE_SECURE`는 **항상 true**이므로 로컬 HTTP용 `AUTH_COOKIE_SECURE=false`가 있어도 약화되지 않습니다. HTTP로 그대로 공개해도 되는 설정이 아니며 HTTPS ingress·DNS·인증/메일·백업 복원·관측·운영 수용 검증은 이 파일이 제공하지 않습니다.

**운영 차단 위험:** 현재 기본 Auth `V4__sample_member.sql`은 공개 비밀번호의 일반 샘플 계정을 모든 프로필에 생성합니다. prod 이미지에 이 migration이 포함되면 같은 위험이 적용됩니다. 이 작업은 V4·인증 코드를 수정하거나 기존 계정을 삭제하지 않았으며, 운영 배포 전 별도 승인된 샘플 계정 처리와 검증이 필요합니다.

```bash
# 설정만 확인하는 수동 예시: 이미지 pull/build/서버 기동은 하지 않음
docker compose --env-file .env -f infrastructure/docker-compose.yaml -f infrastructure/docker-compose.prod.yaml config --quiet
```

## 로컬 설정 첨부 저장소 (#87)

첨부 저장소(MinIO)는 플래그 없이 local·개발 배포 compose에 항상 포함됩니다. Content와 `image-worker`에 `http://minio:9000`, 버킷, S3 자격을 전달합니다. `image-worker`는 안전 검사를 통과한 생성 이미지의 저장에 이 설정을 사용합니다. 이미지는 Dockerfile의 고정 버전 태그(`storyfork-minio:RELEASE…`)로 ghcr에 없을 때만 CD가 한 번 빌드·게시하고, 개발 배포·CI는 그 이미지를 받아 씁니다(local은 받을 수 없으면 처음 한 번 빌드).

MinIO는 승인된 [기존 minio.dockerfile](https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-4th-5Team/blob/HEAD/minio.dockerfile) 방식의 소스 빌드입니다. Go `1.24.8`/MinIO `RELEASE.2025-10-15T17-29-55Z`를 고정하며 다운로드/빌드는 네트워크가 필요합니다.

MinIO Console은 `127.0.0.1:${MINIO_CONSOLE_PORT:-9001}`, API는 `${MINIO_API_PORT:-9000}`입니다. 점유 포트가 있으면 다른 스택을 멈추지 말고 포트를 바꿉니다. 버킷은 endpoint(MinIO)가 지정된 경우 Content가 시작할 때 없으면 private으로 만듭니다. AWS S3 버킷과 공개 정책은 앱이 만들지 않습니다. AWS credentials는 Content와 로컬 MinIO runtime만 받습니다. 예시 credentials는 공개 로컬 전용이므로 실제 루트 `.env`에서 교체합니다. 종료 시 같은 파일 조합의 해당 프로젝트만 `down`하고 volume을 보존합니다.

### 네이티브 Content 첨부 설정

`backend/content-service` 터미널에 공용 `DATABASE_*`, `CONTENT_CORE_AUTH_TOKEN`, Core 인증 origin과 필요 시 생성 `INTERNAL_TOKEN`을 준비합니다. 다음 명령의 S3 설정은 Content 프로세스에만 적용됩니다. Frontend·Core·AI에 AWS 설정을 export하지 않습니다.

```bash
env ATTACHMENT_S3_ENDPOINT=http://127.0.0.1:9000 \
  ATTACHMENT_S3_REGION=us-east-1 ATTACHMENT_S3_BUCKET=storyfork-setting-attachments \
  AWS_ACCESS_KEY_ID='<local-access-key>' AWS_SECRET_ACCESS_KEY='<local-secret-key>' \
  ./gradlew bootRun
```

임시 credentials의 `AWS_SESSION_TOKEN`도 같은 Content 명령에만 추가합니다. region 생략 시 `AWS_REGION`을 사용합니다. 실제 배포 대상은 **AWS S3**이며 endpoint를 비우고 region/bucket을 지정한 뒤 로컬 access/secret/session 값을 제거하고 SDK 기본 role/profile 체인을 사용합니다. native `AWS_PROFILE`도 Content에만 전달합니다. AWS provisioning·유료 호출·실제 IAM·TLS는 미검증입니다.

API·복구 한계는 호환 위치에 보존한 [첨부 계약](../backend/core-api/README.md#설정-이미지일반-파일-87)을 따릅니다. 설정 검사 `infrastructure/tests/test_attachment_environment.py`는 앱/DB/컨테이너를 시작하지 않지만 전체 클래스의 Compose JSON 렌더링은 CI configuration에서 실행합니다. 로컬 자동 검사는 native 문서 계약 같은 순수 메서드와 `config --quiet`만 선택합니다.

## 원고 색인용 Elasticsearch (#56, 항상 켬)

원고 색인(Elasticsearch)은 **끄는 플래그 없이 항상 켜져 있습니다**(2026-11-22 사용자 결정으로 `MANUSCRIPT_INDEX_ENABLED`를 없앴습니다). Content는 시작할 때 인덱스를 확인하므로 Elasticsearch가 없으면 시작하지 않고, 원고 Q&A(Retrieval)와 AI 자율 연재의 관련 장면 검색이 이 색인을 씁니다. 로컬 Compose 스택(`docker compose up`)·개발 서버 배포·CI 시스템 Compose는 `elasticsearch` 서비스를 항상 함께 띄우고 Content가 healthy가 될 때까지 기다립니다. CI 통합 단계도 Content 작업에 같은 이미지를 service로 띄웁니다. 운영(prod) 설정은 내장 서비스·볼륨을 두지 않으므로 외부 Elasticsearch 주소 `MANUSCRIPT_INDEX_URL`이 필수입니다(비우면 `config`가 실패합니다).

### 네이티브 Content용 단독 Elasticsearch

앱 스택 없이 Content만 네이티브로 실행할 때 쓰는 별도 Compose 프로젝트입니다. Docker Desktop을 실행한 뒤 저장소 루트에서 Elasticsearch 단일 노드를 시작합니다. 공식 9.5.6 이미지를 사용하며 메모리 상한은 1GiB입니다. 앱 스택이나 `.env` 설정이 필요하지 않습니다. 로컬 Compose 스택의 `elasticsearch` 서비스와 같은 이미지·설정이고 호스트 포트도 같은 9200이라 **둘을 함께 띄우지 않습니다**.

```powershell
docker compose -f infrastructure/docker-compose.elasticsearch.yaml up -d --wait
curl.exe --fail --silent --show-error 'http://127.0.0.1:9200/_cluster/health?pretty'
```

상태가 `green` 또는 `yellow`이면 요청을 받을 수 있습니다. 로컬 개발 전용 HTTP이며 인증을 끄고 `127.0.0.1`에만 포트를 엽니다. 종료하려면 같은 Compose 파일로 `stop`을 실행합니다. 인덱스 데이터는 `manuscript-index` 볼륨에 남습니다.

Content는 시작할 때 인덱스가 없으면 [v1 매핑](elasticsearch/manuscript-chunks-v1.json)으로 한 번 만듭니다. Content는 같은 내용의 `src/main/resources/manuscript/manuscript-chunks-v1.json`을 쓰고, 두 파일은 단위 테스트로 일치를 확인합니다. 기존 인덱스는 다시 만들거나 지우지 않고 매핑만 검증합니다. 매핑이 다르거나 샤드를 배정하지 못하면 Content가 시작하지 않습니다.

PostgreSQL의 원고·판본이 정본입니다. [원고 검색 계약](../docs/writing-ai-architecture/07-retrieval-contract-and-mocks.md#원고-벡터-인덱스-v1)에서 384차원 모델, 작품·Fork·판본 필터, 검증 결과를 확인할 수 있습니다.

### 네이티브 자동 적재

1. 같은 Content DB에 전용 v1 인덱스 하나를 사용합니다. 여러 개발 DB를 쓴다면 각각 `storyfork-manuscript-v1-<이름>` 인덱스를 만들고 `MANUSCRIPT_INDEX_NAME`에 지정합니다. 대조 작업은 선택한 DB의 공개 판본에 없는 청크를 해당 인덱스에서 제거합니다.
2. 모델 리비전 `614241f622f53c4eeff9890bdc4f31cfecc418b3`의 `onnx/`에서 `tokenizer.json`과 `model_qint8_avx512_vnni.onnx`를 같은 로컬 디렉터리에 받습니다. 이 경로를 `MANUSCRIPT_EMBEDDING_MODEL_DIR`로 지정하고 AI Service를 `uv run --locked --extra manuscript uvicorn app.main:create_app --factory --reload`로 시작합니다. [고정 리비전 모델 파일](https://huggingface.co/intfloat/multilingual-e5-small/tree/614241f622f53c4eeff9890bdc4f31cfecc418b3/onnx)
3. Content 터미널에 해당 DB의 `DATABASE_*`를 설정하고 평소대로 Content를 시작합니다(색인은 늘 켜져 있어 별도 설정이 없습니다). 두 서비스의 `INTERNAL_TOKEN`은 같아야 하며, 네이티브 실행에서는 필요한 값을 루트 `.env`에서 각 터미널에 설정합니다. Elasticsearch 기본 주소는 `http://127.0.0.1:9200`입니다.
4. Content 로그의 `manuscript index reconciled`와 `curl.exe --fail http://127.0.0.1:9200/storyfork-manuscript-v1/_count`로 첫 적재를 확인합니다. 이후 변경은 기본 60초 주기에서 확인할 수 있습니다.

### 로컬 compose 스택 (#475)

로컬 compose(`storyfork-local`)는 원고 색인용 `elasticsearch` 서비스를 항상 함께 띄웁니다(호스트 `127.0.0.1:9200`, 데이터는 `storyfork-local_manuscript-index` 볼륨). Content는 이 서비스가 healthy가 된 뒤 `http://elasticsearch:9200`으로 접속하므로 첫 시작은 이미지를 받고 인덱스를 만드느라 시간이 더 걸립니다. 임베딩 모델은 ai-service 이미지에 이미 들어 있어서 따로 받을 필요가 없습니다.

1. 루트 `.env`에 따로 넣을 설정은 없습니다. 네이티브 Content와 다른 DB를 쓴다면 `MANUSCRIPT_INDEX_NAME`을 `storyfork-manuscript-v1-<이름>`처럼 따로 정합니다(대조 작업이 그 DB에 없는 청크를 지웁니다). `MANUSCRIPT_INDEX_URL`은 네이티브 실행용 값이라 compose에서는 읽지 않습니다.
2. Content 로그의 `manuscript index reconciled`로 첫 적재를 확인한 뒤, 집필실 채팅에서 발행 회차에 대한 작품 질문을 보냅니다.
3. 단독 Elasticsearch(위)를 따로 띄워 두었다면 먼저 `stop`합니다: 호스트 포트 9200이 겹칩니다.

CI의 시스템 Compose(`infrastructure/ci/compose.test.yaml`)는 같은 `elasticsearch` 서비스를 호스트 포트 없이 띄우고 Content가 healthy를 기다립니다. CI의 Content 서비스 job(`.github/workflows/ci.yml`)은 Elasticsearch service(`127.0.0.1:9200`)를 띄우므로 모든 Spring 컨텍스트가 인덱스를 만들 수 있습니다.

### 개발 서버 자동 배포(CD)

develop CI가 성공하면 CD가 [`docker-compose.dev.yaml`](docker-compose.dev.yaml)로 Elasticsearch를 함께 띄웁니다. 별도 수동 작업은 없습니다.

- **Elasticsearch**: 로컬과 같은 공식 이미지 `docker.elastic.co/elasticsearch/elasticsearch:9.5.6`를 단일 노드로 실행하며 보안 기능은 끕니다. 호스트 포트를 열지 않고 Compose 내부 네트워크에서만 접근합니다. 데이터는 `storyfork-develop-cd_manuscript-index` 볼륨에 저장하고 배포할 때마다 그대로 둡니다. CD는 `down -v`를 실행하지 않습니다.
- **Content**: `MANUSCRIPT_INDEX_URL=http://elasticsearch:9200`로 시작합니다(색인은 끄는 플래그 없이 항상 켭니다). 인덱스가 없으면 생성하고, 있으면 매핑을 검증합니다. 실패하면 Content가 healthy가 되지 않아 `up --wait`가 실패합니다.
- **AI 이미지**: `--extra manuscript`(numpy·onnxruntime·tokenizers, `uv.lock` 고정)를 설치합니다. 고정 리비전 `614241f6…`의 `onnx/model_qint8_avx512_vnni.onnx`와 `onnx/tokenizer.json`은 빌드할 때 `ADD --checksum`으로 받으며, SHA-256이 다르면 빌드가 실패합니다. 위치는 `MANUSCRIPT_EMBEDDING_MODEL_DIR=/app/models/multilingual-e5-small`입니다. 서버에는 모델 디렉터리나 `.env` 값을 따로 둘 필요가 없습니다.
- **배포 확인**: 스택이 healthy가 된 뒤 CD가 `ai-service`에서 E5 임베딩을 한 번 실행합니다. 실패하면 이전 이미지를 정리하지 않고 CD를 실패로 끝냅니다.
- **변경된 서비스만 빌드·pull**: 변경 판정은 서비스 빌드 컨텍스트(`frontend`, `backend/<서비스>`)의 git tree 해시입니다(Dockerfile과 `COPY` 대상이 모두 그 안에 있습니다). publish는 `storyfork-<서비스>:tree-<tree>`가 GHCR에 이미 있으면 그 서비스를 빌드하지 않고, 없을 때만 빌드해 `tree-<tree>`·`sha-<SHA>` 태그와 라벨 `io.storyfork.build-tree`를 붙입니다. 모든 tree 이미지를 게시한 뒤에만 `develop` 태그를 서비스마다 그 tree 이미지로 맞춥니다(이미 게시된 tree로 되돌린 커밋도 `develop`이 그 이미지를 가리키게 됩니다). deploy는 서버 앱 이미지의 `build-tree` 라벨이 이번 run의 tree와 같으면 그 이미지를 그대로 쓰고, 다르거나 없는 이미지만 `docker pull <이미지>:develop` 합니다. 전체 `compose pull`은 하지 않으며 `up --pull missing`이 서버에 없는 서드파티 이미지(첫 배포·정리 뒤)만 받습니다(같은 태그는 갱신하지 않습니다).
- **빌드·pull 생략의 한계**: 베이스 이미지(`node`·`nginx`·`eclipse-temurin`·`python`) 태그만 갱신돼도 컨텍스트가 같으면 다시 빌드하지 않습니다(컨텍스트가 바뀌면 반영됩니다). 첫 실행은 tree 태그가 없어 모든 앱 이미지를 빌드·pull합니다. `sha-<SHA>` 태그는 그 커밋에서 새로 빌드한 이미지에만 붙습니다.
- **디스크 확보**: pull 전에 dangling 이미지(`docker image prune --force`)와 빌드 캐시(`docker builder prune --force`)만 지우고 `df -h /`·`docker system df`를 로그에 남깁니다. 태그 있는 이미지·컨테이너·볼륨(공유 DB 포함)은 지우지 않습니다(#770).
- **컨테이너 로그 제한**: [`docker-compose.dev.yaml`](docker-compose.dev.yaml)과 [`docker-compose.langfuse.yaml`](docker-compose.langfuse.yaml)의 모든 서비스(`extends`로 가져오는 서비스 포함)에 `json-file` 로그를 파일당 `10m`·`3`개로 제한합니다(파일마다 YAML 앵커 한 곳에서 정의). 기본 설정에는 제한이 없어 ClickHouse 로그가 디스크를 71GB까지 채운 적이 있습니다. 로그 설정은 컨테이너를 만들 때 정해지므로 이미 떠 있는 컨테이너는 다음 배포의 `up`이 설정 변경을 감지해 다시 만들 때 적용됩니다(볼륨은 유지). Langfuse 파일은 로컬·prod도 `include`하므로 그쪽 Langfuse 서비스에도 같이 적용됩니다. 이 제한은 컨테이너 stdout·stderr 로그만 대상이며 컨테이너가 볼륨에 직접 쓰는 파일(예: `langfuse-clickhouse-logs` 볼륨)은 포함하지 않습니다.
- **원격 스크립트 stdin**: 스크립트를 SSH stdin(`bash -se`)으로 보내므로 stdin을 읽는 명령이 남은 줄을 먹을 수 있습니다. stdin을 넘기는 `docker compose exec`에는 `</dev/null`을 붙여 마지막 `docker image prune --force`가 성공 종료 속에 건너뛰어지지 않게 합니다(#770).

배포 전제조건은 CD가 확인하지 않으므로 서버 관리자가 확인해야 합니다.

| 항목 | 전제 | 확인 방법(서버) |
|---|---|---|
| 메모리 | 기존 스택에 더해 Elasticsearch 최대 1GiB(`mem_limit`, 힙은 자동으로 그 절반)와 AI 모델 로드분 약 0.3GiB의 여유 | `free -h`, 배포 후 `docker stats --no-stream` |
| 디스크 | AI 이미지가 의존성과 모델로 약 0.4GB 커집니다. 디스크 사용률이 Elasticsearch 저수위선(기본 85%)을 넘으면 새 인덱스의 샤드를 배정하지 못해 Content 시작이 실패합니다. | `df -h /var/lib/docker` |
| CPU·ONNX | 메타데이터에 고정된 산출물은 AVX-512 VNNI용으로 양자화한 INT8 모델입니다. 다른 x86-64 CPU에서도 동작하는지는 확인하지 않았습니다. 배포 확인 단계가 실패하면 이 항목부터 확인합니다. 모델을 바꾸려면 새 인덱스 버전이 필요합니다. | `grep -o -m1 -w 'avx512_vnni\|avx2' /proc/cpuinfo`, 배포 로그의 E5 확인 단계 |
| 커널 | 단일 노드 모드라 bootstrap check를 강제하지 않습니다. 공식 권장값은 `vm.max_map_count>=1048576`입니다. | `sysctl vm.max_map_count` |
| 아키텍처 | 모든 이미지를 `linux/amd64`로 실행합니다. | `uname -m` → `x86_64` |
| Langfuse | 웹·worker·PostgreSQL·ClickHouse·Redis·MinIO가 함께 뜹니다. ClickHouse는 최대 3GiB(`mem_limit`)이고 전체로 수 GB의 메모리와 이미지·볼륨 디스크가 더 필요합니다. 서버 `.env`에 Langfuse 값이 없으면 배포가 `config`에서 멈춥니다. 웹 포트(기본 3000)가 비어 있어야 합니다. | `free -h`, `df -h /var/lib/docker`, `ss -ltn 'sport = :3000'`, 배포 뒤 SSH 포워딩으로 Langfuse 웹 로그인 |

배포 후 인덱스 상태는 서버의 배포 디렉터리에서 확인합니다.

```bash
docker exec storyfork-develop-cd-elasticsearch-1 curl -fsS 'http://127.0.0.1:9200/storyfork-manuscript-v1/_count'
docker logs storyfork-develop-cd-content-service-1 2>&1 | grep 'manuscript index'
```

## 집필 AI 추적용 Langfuse (#302)

제목은 첫 도입(#302) 때의 이름입니다(문서 링크 보존). Langfuse(self-host)는 이제 LLMOps 정본입니다([DEC-55](../docs/design/decisions.md), [계약](../docs/design/operations-llmops-contract.md)). AI 서비스가 모든 요청을 trace로 남기고, 운영 서비스가 Langfuse Public API를 읽어 관리자 화면(대시보드·추적·지표·프롬프트·평가)에 통합합니다. 관리자는 Langfuse 웹에 들어가지 않습니다. 두 서비스는 프로젝트 API 키로만 접근하며 별도 로그인 연동이나 화면 링크는 없습니다. 정의는 [`docker-compose.langfuse.yaml`](docker-compose.langfuse.yaml) 한 파일이며 세 곳에서 씁니다.

| 실행 | 방식 |
|---|---|
| 로컬 | 루트 [`compose.yaml`](../compose.yaml)이 앱 파일과 **별도 `include` 항목**으로 앱 스택과 같은 프로젝트(`storyfork-local`)에서 항상 함께 켭니다(정의 복제 없음, [로컬에서 켜기](#로컬에서-켜기)) |
| develop(CD)·prod | `docker-compose.dev.yaml`·`docker-compose.prod.yaml`이 `include`로 앱 스택과 같은 프로젝트에서 함께 켭니다(정의 복제 없음). 앱은 같은 네트워크의 `http://langfuse-web:3000`으로 부르므로 네트워크 연결 작업이 없습니다 |

구성은 웹·worker와 Langfuse 필수 저장소 ClickHouse·Redis입니다(2026-11-23 사용자 결정). PostgreSQL·MinIO는 따로 띄우지 않고 앱 스택의 `postgres`(DB `langfuse`, 앱의 `DATABASE_USER`·`DATABASE_PASSWORD`, 첫 시작 때 Langfuse 마이그레이션이 만듭니다)와 `minio`(첨부 버킷 `ATTACHMENT_S3_BUCKET`의 `langfuse/` 접두어, 앱의 `AWS_*` 키)를 씁니다. `langfuse-web`은 AI·운영이 `http://langfuse-web:3000`으로 부르는 API 서버라 남기지만 **웹 화면은 쓰지 않아** 호스트 포트·로그인 사용자가 없고 가입도 막혀 있습니다. 메모리를 수 GB 쓰며 ClickHouse는 3GiB로 제한합니다.

### develop·prod에서 켜기

별도 켜기 작업은 없습니다. CD와 prod `config`가 Langfuse를 앱과 함께 올립니다. 서버 `.env`에 다음을 준비하며, 빈 필수값은 `config`가 실패시킵니다(CD는 앱을 멈추기 전에 중단합니다). 값 이름과 한 줄 설명은 [`.env.example`](../.env.example)에 있습니다.

| 변수 | 내용 |
|---|---|
| `LANGFUSE_CLICKHOUSE_PASSWORD`·`LANGFUSE_REDIS_PASSWORD`·`LANGFUSE_NEXTAUTH_SECRET`·`LANGFUSE_SALT`·`LANGFUSE_ENCRYPTION_KEY` | Langfuse 서버 전용 비밀값. 각각 `openssl rand -hex 32` |
| `LANGFUSE_PUBLIC_KEY`·`LANGFUSE_SECRET_KEY` | `pk-lf-<임의값>`·`sk-lf-<임의값>`. Langfuse가 첫 시작 때 같은 키로 조직 `storyfork`·프로젝트 `storyfork-writing-ai`를 만들고, AI·운영 서비스가 같은 값을 씁니다 |
| (prod만) `LANGFUSE_DATABASE_URL`·`LANGFUSE_S3_ENDPOINT` | 외부 PostgreSQL의 `langfuse` DB 주소와 S3 endpoint. 로컬·develop은 비워 두면 앱 `postgres`·`minio`를 씁니다 |

배포 전제는 CD가 확인하지 않습니다. 서버 관리자가 확인합니다(아래 'CI → CD' 전제조건 표에도 있습니다).

### 로컬에서 켜기

별도 켜기 작업은 없습니다. 루트 [`compose.yaml`](../compose.yaml)이 `docker-compose.langfuse.yaml`을 앱 파일과 **별도 `include` 항목**으로 불러, `docker compose up`이 앱 스택과 같은 프로젝트(`storyfork-local`)·같은 기본 네트워크에 Langfuse를 항상 함께 올립니다(끄는 옵션·profile은 없습니다). 앱은 내부 주소 `http://langfuse-web:3000`으로 부르므로 네트워크 연결 작업이 없습니다.

1. 루트 `.env`에 위 표와 같은 `LANGFUSE_*` 값을 채웁니다(이름과 설명은 `.env.example`). 이제 로컬 `docker compose up`의 필수값이라 비어 있으면 `config`가 실패합니다. `LANGFUSE_BASE_URL`은 네이티브 ai-service용(`http://localhost:3000`)이며 Compose 컨테이너는 항상 내부 주소를 씁니다.
2. 저장소 루트에서 [시작과 설정](#시작과-설정)의 `docker compose up -d --build`로 시작합니다. 첫 시작은 Langfuse 이미지를 받고 마이그레이션하느라 몇 분 걸립니다.
3. 첫 시작 때 조직 `STORYFORK`, 프로젝트 `writing-ai`와 `.env`의 같은 API 키가 만들어집니다. 추적·지표·프롬프트는 운영 관리자 화면(LLM Ops)에서 봅니다. 응답의 `runId`가 trace id이며 전송은 몇 초 단위로 묶여 늦게 보일 수 있습니다.

**전용 저장소에서 옮기기(한 번):** 예전 `langfuse-postgres`가 있으면 웹·worker를 멈추고 앱 `postgres`에 `CREATE DATABASE langfuse`를 만든 뒤 `pg_dump --no-owner --no-acl`로 옮기고 `docker compose up -d --remove-orphans`로 예전 컨테이너를 지웁니다. 예전 볼륨 `storyfork-local_langfuse-postgres`·`storyfork-local_langfuse-minio`는 남으니 확인 후 직접 지웁니다.

**한 번만 하는 이전:** 예전에 별도 프로젝트로 Langfuse를 켜 뒀다면 새로 시작하기 전에 저장소 루트에서 `docker compose -p storyfork-langfuse down`으로 멈춥니다(웹 포트가 겹칩니다). 예전 볼륨 `storyfork-langfuse_langfuse-*`은 남지만 새 프로젝트는 쓰지 않으므로 이전 로컬 trace는 이어지지 않습니다. AI·운영 컨테이너를 그 네트워크에 연결해 뒀다면 `storyfork-langfuse_default`는 '사용 중'이라 남을 수 있으나 무해합니다.

비밀값을 바꾸면 이미 초기화된 Langfuse 볼륨과 맞지 않습니다. 프로젝트 전체 `down -v`는 앱 DB·Neo4j·첨부 볼륨까지 지우므로 쓰지 말고, Langfuse 컨테이너와 볼륨만 지웁니다(되돌릴 수 없음).

```bash
docker compose rm -sf langfuse-web langfuse-worker langfuse-clickhouse langfuse-redis
docker volume rm $(docker volume ls -q -f name=storyfork-local_langfuse-)
```

## CI → CD (publish → deploy)

[CI](../.github/workflows/ci.yml)와 [CD](../.github/workflows/publish-images.yml) 두 workflow를 사용합니다. CD는 CI 성공 뒤 `workflow_run`으로 시작합니다. 별도 deploy workflow는 없습니다.

- CI는 변경 선택 → 서비스별 job(빌드 → 단위 → 통합)·설정 병렬 → 선택 HTTP 시스템 → `Required CI`입니다. 서비스마다 job 하나(`Service / <서비스>`)가 한 러너에서 순서대로 실행하고, 단위가 실패하면 통합을 돌리지 않습니다.
- 자동 CD publish는 신뢰된 같은 저장소 develop의 성공한 push/수동 CI만 받습니다. PR·fork·main·실패·취소 CI는 게시/배포 권한이 없습니다.
- 수동 **CD → Run workflow → develop**은 해당 커밋의 이미지를 게시합니다(이미 게시된 빌드 tree는 건너뜁니다). 이 수동 경로가 CI 재검증을 대신하지는 않습니다. 다른 ref는 생략합니다.
- deploy는 publish 성공만 요구하며 별도 활성화·승인 변수는 없습니다. GitHub environment 승인과 Tailscale·SSH host key 검증을 유지합니다.
- packages write는 publish, packages read/id-token write는 deploy에만 부여합니다. `storyfork-develop-cd` concurrency로 직렬화하고 실행 중 취소하지 않습니다.

자동 `workflow_run`은 기본 브랜치 main, 수동은 develop ref를 사용하므로 `develop-cd` environment의 allowed deployment branches에 둘을 허용하고 승인 정책을 유지해야 합니다. 소스 파일만으로 실제 GitHub 설정·branch protection·게시·배포가 완료되지 않습니다.

### 이미지

`linux/amd64`로 네 이미지를 게시합니다.

- `ghcr.io/sknetworks-family-aicamp/storyfork-web`
- `ghcr.io/sknetworks-family-aicamp/storyfork-core-api`
- `ghcr.io/sknetworks-family-aicamp/storyfork-content-service`
- `ghcr.io/sknetworks-family-aicamp/storyfork-ai-service`

서비스 빌드 컨텍스트의 git tree가 이미 게시돼 있으면 그 서비스는 다시 빌드하지 않습니다(규칙은 [개발 서버 자동 배포(CD)](#개발-서버-자동-배포cd)). 새로 빌드한 이미지는 `tree-<tree>`·`sha-<전체 SHA>` 태그와 라벨 `io.storyfork.build-tree`로 게시하고, 모든 tree 이미지를 게시한 뒤에만 `develop` 태그를 각 서비스의 tree 이미지로 맞춥니다. publish는 대상 SHA가 현재 develop HEAD가 아니면 게시하지 않습니다. deploy는 앱 `develop` 이미지의 `build-tree` 라벨이 모두 이 run의 서비스별 tree와 같지 않으면(혼합 커밋·더 새 커밋 포함) 앱을 멈추기 전에 중단합니다. 같은 CD run에서 실패한 job만 재실행할 수 있습니다. 별도 run ID/artifact 증거 체계는 추가하지 않습니다.

Langfuse는 공식 이미지(`docker.langfuse.com/langfuse/langfuse`·`langfuse-worker`, ClickHouse·PostgreSQL·Redis)와 이미 게시하는 `storyfork-minio`를 그대로 쓰므로 게시 목록은 바뀌지 않습니다. 배포는 이 이미지들을 서버에 없을 때만 받고(`up --pull missing`) build-tree 비교 대상은 앱 이미지뿐입니다.

### 배포 설정과 전환

| 위치 | 이름 | 역할 |
|---|---|---|
| Environment | `develop-cd` | main/develop ref와 필요한 승인 정책 |
| Environment variable | `CD_DEPLOY_DIR` / `CD_WEB_PORT` | 기존 전용 절대 실경로 / 비충돌 loopback 1024–65535 |
| Environment secret | `CD_SSH_PRIVATE_KEY` / `CD_SSH_KNOWN_HOSTS` | 전용 SSH 키 / 검증한 host key |
| Environment secret | `TS_OAUTH_CLIENT_ID` / `TS_AUDIENCE` | Tailscale workload identity |

기존 대상 `tgv99536@100.90.8.124:5798`, `tag:storyfork-cd` 접근·Bash·Docker·Compose v2(`up --wait`) 및 GHCR 읽기 권한이 필요합니다. 실제 주소/개인 설정에 이번 작업은 접속하지 않습니다. 서버 `.env`와 배포 디렉터리는 담당자가 준비하며 내부 DB 전용 자격·JWT·별도 서비스 자격/생성 토큰을 설정합니다. DB URL과 SMTP host/port는 `postgres`/`mailpit` 내부 DNS로 고정합니다. OpenAI는 AI만 받습니다. 새 production DB·계정·pool이나 marker/lock 파일을 만들지 않습니다. **기존 외부/공유 DB를 내부 fresh DB로 전환하거나 데이터를 이관하지 않았습니다.** 새 승인 변수는 대상·Auth/Studio/첨부 보존·백업/복구·별도 데이터 이관 계획 확인 전에는 활성화하지 않습니다.

**fresh 승인 변수는 DB를 초기화하거나 준비 상태를 검증하지 않습니다.** 정확한 개발 대상·보존할 Auth/Studio/첨부·백업/격리 복원·중단 시간·호환 이미지의 복구 방법을 담당자가 확정해야 합니다. 이 확인 없이 기존 Content history에 새 앱을 배포하지 않습니다. 일괄 DROP/volume 삭제·자동 repair/clean을 하지 않습니다.

CD는 기존 전용 디렉터리/project labels를 확인하고 base·dev와 참조되는 local(extends)·Langfuse(include) Compose 파일을 SSH stdin으로 임시 전달하며 서버 `.env`를 덮어쓰지 않습니다. 순서는 **두 DB 승인 확인 → login → 바뀐 앱 이미지만 pull → 앱 이미지 build-tree 확인 → web·구 Core·Content writer 중지 → 내부 PostgreSQL·Mailpit `up --wait` → opt-in Studio 명시 migration → 새 앱 `up --wait`**입니다. 전체 스택의 `--wait-timeout`은 600초입니다(첫 배포는 Langfuse 저장소·Elasticsearch·앱이 함께 처음 뜨고, PostgreSQL·Mailpit만 먼저 올릴 때는 180초). PostgreSQL/Mailpit 이미지는 앱 build-tree 비교에서 제외하며 원격 앱 소스 build는 없습니다. Core Health 뒤 Content를 시작합니다. Studio main은 Content 이미지에 있으며 [대상 allowlist/백업/실패 계약](../docs/deployment/worldstudio-v1-rollout.md)을 따릅니다.

중지 전 login/pull/build-tree 확인 실패는 기존 앱을 건드리지 않습니다. 중지 후 migration/startup 실패는 **ingress를 멈춘 채 실패**하며 자동 rollback/repair/retry·`down`/prune/volume 삭제를 하지 않습니다. 새 이력과 구 binary가 비호환이므로 운영자가 로그/이력과 호환 스냅샷을 확인해 복구를 결정합니다. `up --wait`는 running/healthcheck 확인이지 사용자 HTTP/DB/SMTP 전체 수용 검증이 아닙니다. web의 loopback 외 운영 TLS/ingress는 별도입니다.

## 설정 확인

```bash
# 수동 예시: 실제 .env를 읽지 않는 자동 검사는 .env.example + synthetic 값 사용
docker compose --env-file .env config --quiet
docker compose --env-file .env -f infrastructure/docker-compose.yaml -f infrastructure/docker-compose.local.yaml config --quiet
docker compose --env-file .env -f infrastructure/docker-compose.yaml -f infrastructure/docker-compose.dev.yaml config --quiet
docker compose --env-file .env -f infrastructure/docker-compose.yaml -f infrastructure/docker-compose.prod.yaml config --quiet
```

구문 검사만 하며 컨테이너를 시작하지 않습니다. CI configuration은 예시/synthetic 값으로 루트 기본 진입점과 local/dev/prod의 content false/true, 소스 빌드 CI overlay, 첨부 환경 격리를 확인합니다. 루트 기본 진입점·dev·prod가 include하는 Langfuse의 필수값은 configuration job 환경의 synthetic 값으로 채웁니다(새 `:?` 필수 변수를 더하면 `.github/workflows/ci.yml`의 같은 job 환경에도 더합니다. 단위 테스트가 빠진 값을 잡습니다). 실제 DB·HTTP·SMTP는 CI 통합/시스템, 모델은 대역 또는 명시적 설정 누락 실패로 검증합니다.

## 표준 테스트 프레임워크 직접 실행

로컬 자동 검증은 **변경·직접 영향 범위의 선택 순수 단위만**입니다. 전체 suite/build·Spring/HTTP/DB·컨테이너·브라우저를 시작하지 않습니다. 별도 runner나 계층별 shell wrapper는 없습니다.

| 경로 | 역할 |
|---|---|
| [`ci/ci.py`](ci/ci.py) | PR merge-base/push before/수동 전체 선택, diff 검사, 정제/집계 |
| [`ci/test_ci.py`](ci/test_ci.py) | 선택·Kotlin/Java 통합 분류·실행/CD 계약의 stdlib 단위 |
| [`ci/test_content_extraction.py`](ci/test_content_extraction.py) | 소유권·API·SQL 바이트/발견·라우팅 계약 |
| [`system/test_http.py`](system/test_http.py) | CI 소유 Compose의 실제 HTTP/DB 결과 |
| [`ci/compose.test.yaml`](ci/compose.test.yaml) | tmpfs DB·임의 loopback 포트·빈 AI key |

```bash
# 루트: 관련 순수 클래스만 선택
python3 -m unittest infrastructure.ci.test_ci.SelectionTest infrastructure.ci.test_content_extraction.ContentExtractionTest -v
# 아래는 hosted CI 호출 예이며 로컬 자동 실행 목록이 아님
# Core 디렉터리: ./gradlew integrationTest --no-daemon
# Content 디렉터리: ./gradlew integrationTest --no-daemon
# CI가 환경을 준비한 루트:
# uv run --locked --extra dev --project backend/ai-service python -m pytest infrastructure/system -k 'health or auth or content or ai'
```

Core는 auth/health 또는 보수적 전체, Content/web/AI는 서비스 단위로 선택합니다. Core Auth 변경은 Content/web 소비자, Content/AI runtime 변경은 연결된 소비자와 시스템을 선택합니다. 삭제된 구 Core 콘텐츠 경로도 새 소유 서비스 회귀를 선택합니다. 테스트만 변경하면 해당 회귀만, 문서만이면 runtime을 생략합니다. 알 수 없는 공통/설정/의존성은 확대 선택하며 정확한 의존 그래프라고 주장하지 않습니다.

Core integration은 임시 PostgreSQL·Mailpit의 Auth/내부 보안, Content integration은 임시 PostgreSQL의 fresh Flyway·JPA/Studio·실제/대역 HTTP proxy를 확인합니다. 테스트용 `content_test`/빈 비밀번호는 격리 runner trust 인증 전용입니다. S3 실제 lifecycle은 별도 fixture가 없어 조건부 skip이며 통과로 표현하지 않습니다.

시스템은 실행별 `storyfork-ci-<run>-<attempt>`만 소유하고 실제 로그인·CSRF → Content UUID 소유권·원고 저장·stale 409·미인증 401, Core 중단 시 Content 503/복구, Content → AI 제공사 누락 503·원고 불변, Content jar의 Studio 명시 main을 검증합니다. 사용자/공유 DB·실제 메일·유료 모델·서버 배포·브라우저 E2E는 범위 밖입니다. 항상 해당 임시 프로젝트만 정리하고 실패 로그/report를 정제해 7일 보관합니다. 최신 `Required CI`·게시·배포 성공은 각각 실제 Actions 결과 확인 전까지 대기입니다.
