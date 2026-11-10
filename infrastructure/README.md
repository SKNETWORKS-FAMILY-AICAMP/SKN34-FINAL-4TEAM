# STORYFORK Docker 실행 기반

Core → Content 업무·테스트·인증 확인·공개 라우팅·이미지/CI 연결을 소스에 반영했습니다. **hosted CI·실제 DB 전환·게시·배포는 확인 대기**입니다. 운영 서비스(operations-service)는 신고·회원·관리자 공개 API를 위해 Compose에 추가했으며 호스트 포트 없이 컨테이너 네트워크에서만 노출합니다. develop CD는 publish 워크플로에서 operations-service 이미지도 빌드·게시하고 배포 revision 검사에 포함합니다. [서비스 경계](../docs/design/service-boundaries.md)와 [이관 계약](../docs/design/content-service-migration-contract.md)을 따릅니다.

Content의 초기 SQL은 사용자가 승인한 개발용 fresh 이력입니다. 과거 Content history와 호환되지 않으며 실제 대상 DB·보존/복구 범위·중단 시간을 확인하기 전 기존 DB에 바로 배포하지 않습니다. 이 문서는 DB 삭제·volume 초기화·개인 `.env` 변경·배포 승인이 아닙니다. Auth·첨부·독립 WorldStudio의 SQL/이력은 유지합니다.

## 서비스와 진입점

현재 Compose의 앱은 **web·core-api·content-service·operations-service·ai-service 다섯 개**입니다. Core는 회원·인증·세션·Health, Content는 기존 콘텐츠·첨부·WorldStudio, AI는 요청된 모델 실행을 소유합니다. 정산·알림·운영 업무는 목표 책임이며 구현 완료를 뜻하지 않습니다. Langfuse·새 큐/worker/Start 서버는 추가하지 않습니다.

[`docker-compose.yaml`](docker-compose.yaml)은 공통 환경·내부 포트만 정의하는 base로 **단독 실행하지 않습니다**.

| 항목 | 루트 [`compose.yaml`](../compose.yaml) / base + [`docker-compose.local.yaml`](docker-compose.local.yaml) | base + [`docker-compose.dev.yaml`](docker-compose.dev.yaml) | base + [`docker-compose.prod.yaml`](docker-compose.prod.yaml) |
|---|---|---|---|
| 용도 | 로컬 개발의 소스 빌드 runtime, CI의 소스 빌드 기반 | develop 배포 서버 | 실제 운영 배포 서버용 설정 준비 |
| 프로젝트 | `storyfork-local` | `storyfork-develop-cd` | `storyfork-production` |
| 앱 | 다섯 앱 소스 build, web은 nginx 정적 runtime, HMR 아님 | 다섯 앱의 GHCR `:develop`, `linux/amd64` | 다섯 앱의 GHCR `:main`, `linux/amd64`, 게시 여부 미확인 |
| DB·SMTP | 새 프로젝트 범위 `core-postgres` volume의 PostgreSQL + Mailpit | 로컬과 같은 PostgreSQL·Mailpit 정의 재사용, 별도 프로젝트 DB volume | 별도 승인·준비한 외부 PostgreSQL·SMTP, 내장 DB·Mailpit·volume 없음 |
| web 포트 | `127.0.0.1:${WEB_PORT:-5173}` | `127.0.0.1:${CD_WEB_PORT}` | `127.0.0.1:${WEB_PORT}` |
| 추가 호스트 공개 | Core 8080·Content 8081·DB 5432·SMTP 1025·Mailpit 8025, 모두 loopback | 없음 | 없음 |

루트 진입점은 Compose native `include`로 base+local을 재사용하므로 build context는 `infrastructure/` 기준의 `../frontend`·`../backend/*`입니다.
루트 `.env`는 기본 명령에서 자동 로드하며 컨테이너에는 서비스별 allowlist만 전달합니다. dev는 local 파일의 PostgreSQL·Mailpit 서비스만 native `extends`로 재사용하고 호스트 포트는 제거합니다. 원격 CD에서는 `--project-directory`와 임시 설정 위치가 다르므로 `CD_LOCAL_COMPOSE_FILE`을 임시 파일의 절대 경로로 고정합니다. dev 렌더링에 앱 build는 없으며 DB volume은 `storyfork-develop-cd_core-postgres`로 격리됩니다. Compose v2.24.4 이상을 사용합니다.

```text
Browser → web nginx
           ├─ /api/v1/works 및 /api/v1/public/works(+하위) → Content:8081 → AI:8000
           │                                                   └→ Core 내부 인증 확인
           ├─ /api/v1/operations/{reports,members,admins,support,works,comments,admin/notices,public/notices,admin/events,public/events,admin/activities}(+하위) → Operations:8082 → Core·Content 내부 API
           └─ 나머지 /api → Core:8080 → AI Health
```

공개 URL·JSON·쿠키·Bearer·CSRF 계약을 유지합니다. 내부 `/internal/v1/auth/verify`를 공개 proxy에 등록하지 않으며 Core는 콘텐츠 중계 프록시가 아닙니다. API 404는 SPA HTML로 바꾸지 않습니다. UI deep link만 SPA로 연결합니다. 로컬은 loopback 개발용이며 배포 서버의 web도 loopback에만 노출합니다. prod 설정만으로 **인터넷 운영용 TLS·ingress 준비 완료가 아닙니다**.

## 시작과 설정

다음은 담당자의 수동 실행 안내이며 로컬 자동 검증에서 앱/DB/컨테이너를 기동하지 않습니다. `cp -n .env.example .env`로 루트 설정을 준비하되 기존 파일은 덮어쓰지 않습니다. 서비스별 `.env`는 만들지 않습니다.

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

`down`에는 volume 삭제를 붙이지 않으며 해당 로컬 프로젝트만 대상으로 합니다. **소스 빌드는 hot reload가 아닙니다.** Vite/소스 mount가 없으므로 변경 후 `docker compose up -d --build`로 다시 빌드하거나 아래 네이티브 명령을 사용합니다. dev 배포는 아래 CD 절차를 사용하며 단순 수동 `pull/up`은 revision 일치·구 writer 중지·fresh 대상 승인 검사를 대신하지 못합니다.

| 변수 | 기본값 | 소비 경계 |
|---|---|---|
| `OPENAI_API_KEY` | 빈 값 | AI runtime만 |
| `OPENAI_MODEL` | local·prod 빈 값 / dev `gpt-5.6-luna` | AI runtime만, 팀 모델 선정·접근 검증 아님 |
| `AI_SERVICE_CONNECT_TIMEOUT` | `1s` | Core/Content → AI |
| `AI_SERVICE_READ_TIMEOUT` | `12s` | Core → AI Health |
| `AI_GENERATION_READ_TIMEOUT` | `75s` | Content → AI 생성 |
| `CORE_AUTH_BASE_URL` | native `http://127.0.0.1:8080`, Compose 내부 DNS | Content → Core 인증 확인 |
| `CORE_AUTH_CONNECT_TIMEOUT` / `CORE_AUTH_READ_TIMEOUT` | `1s` / `3s` | Content 인증 확인 |
| `CONTENT_CORE_AUTH_TOKEN` | 빈 값 | Core/Content만, 활성화 시 필수 |
| `DATABASE_*` | 빈 계정, `storyfork` DB | Core·Content(Studio 포함)·운영 공용 PostgreSQL(운영은 전용 `operations` schema) |
| `INTERNAL_TOKEN` | 빈 값 | Content/AI 생성만 |
| `OPERATIONS_SERVICE_TOKEN` | 빈 값(운영 호출 거절) | Operations·Core·Content |
| `APP_CORS_ALLOWED_ORIGIN` | 빈 값이면 web 포트에서 계산 | Core/Content의 단일 origin |
| `WEB_PORT` | local `5173` / prod 필수 | web loopback (dev는 CD workflow의 `CD_WEB_PORT`) |
| `CORE_API_PORT` / `CONTENT_SERVICE_PORT` | `8080` / `8081` | local API loopback |
| `DATABASE_PORT` | `5432` | local DB loopback, 컨테이너 내부는 고정 5432 |
| `CORE_MAILPIT_SMTP_PORT` / `CORE_MAILPIT_WEB_PORT` | `1025` / `8025` | local Mailpit loopback |
| `CD_DIRECTORY` / `CD_WEB_PORT` | 필수 | dev 전용 디렉터리 label / loopback |

Health는 OpenAI 인증·모델 접근 검증이 아니며 모델 클라이언트를 만들지 않습니다. 생성 제공사 설정 누락은 503입니다. OpenAI 키를 Frontend·Core·Content·build ARG에 넣지 않습니다. 루트 `.env` 전체를 프로세스에 주입하지 않습니다.

네이티브는 각 서비스의 기본 명령(`pnpm dev`, `./gradlew bootRun`, `uv run --locked uvicorn app.main:create_app --factory --reload --port 8000`)을 사용합니다. Core/Content 기본 포트는 8080/8081입니다. 필요한 변수만 해당 터미널에 전달하며 루트 `.env` 전체를 source하지 않습니다. Vite는 `VITE_DEV_PROXY_TARGET`(Core)·`VITE_CONTENT_DEV_PROXY_TARGET`(Content)·`VITE_OPERATIONS_DEV_PROXY_TARGET`(Operations, 기본 8082)으로 경로를 분기합니다. 기본 web origin은 `http://localhost:5173`이며 CORS도 실제 origin과 맞춥니다. 생성 timeout을 늘릴 때 브라우저 80초/nginx 90초 한도도 함께 검토합니다.

## 운영 서버 설정 준비 — prod

prod는 **게시된 `:main` runtime 이미지 네 개 + 외부 PostgreSQL·SMTP**만 선택합니다. 소스 build·PostgreSQL·Mailpit·로컬 자격증명·DB volume을 포함하지 않습니다. 현재 [`publish-images.yml`](../.github/workflows/publish-images.yml)은 **develop만 게시**하므로 `:main`의 존재·접근 가능 여부는 미확인입니다. 이미지 목록에 이름이 있다고 실제 게시된 것은 아닙니다. main 게시/배포 trigger는 추가하지 않았습니다.

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

SMTP 인증은 기본 `CORE_SMTP_AUTH=true`이며 제공사가 요구하는 `CORE_SMTP_USERNAME/PASSWORD`를 설정합니다. 인증 없는 신뢰 relay라면 해당 정책을 확인한 뒤 `CORE_SMTP_AUTH=false`로 명시합니다. STARTTLS를 지원하지 않는 제공사와의 호환성은 별도 결정이 필요하며 TLS 연결 성공을 주장하지 않습니다. `OPENAI_API_KEY/MODEL`은 AI에만 전달합니다(local·dev에서 `OPENAI_API_KEY`는 필수). Neo4j·RabbitMQ는 local·개발 배포에서 항상 뜨며 `NEO4J_PASSWORD`·`CORE_RABBITMQ_PASSWORD`가 필요합니다. WorldStudio schema는 Content 시작 시 적용됩니다.

prod의 `AUTH_COOKIE_SECURE`는 **항상 true**이므로 로컬 HTTP용 `AUTH_COOKIE_SECURE=false`가 있어도 약화되지 않습니다. HTTP로 그대로 공개해도 되는 설정이 아니며 HTTPS ingress·DNS·인증/메일·백업 복원·관측·운영 수용 검증은 이 파일이 제공하지 않습니다.

**운영 차단 위험:** 현재 기본 Auth `V4__sample_member.sql`은 공개 비밀번호의 일반 샘플 계정을 모든 프로필에 생성합니다. prod 이미지에 이 migration이 포함되면 같은 위험이 적용됩니다. 이 작업은 V4·인증 코드를 수정하거나 기존 계정을 삭제하지 않았으며, 운영 배포 전 별도 승인된 샘플 계정 처리와 검증이 필요합니다.

```bash
# 설정만 확인하는 수동 예시: 이미지 pull/build/서버 기동은 하지 않음
docker compose --env-file .env -f infrastructure/docker-compose.yaml -f infrastructure/docker-compose.prod.yaml config --quiet
```

## 로컬 설정 첨부 저장소 (#87)

첨부 저장소(MinIO)는 플래그 없이 local·개발 배포 compose에 항상 포함됩니다. Content만 `http://minio:9000`과 `AWS_ACCESS_KEY_ID/SECRET_ACCESS_KEY`를 받으며 Core에는 S3 설정을 전달하지 않습니다. 이미지는 Dockerfile의 고정 버전 태그(`storyfork-minio:RELEASE…`)로 ghcr에 없을 때만 CD가 한 번 빌드·게시하고, 개발 배포·CI는 그 이미지를 받아 씁니다(local은 받을 수 없으면 처음 한 번 빌드).

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

## CI → CD (publish → deploy)

[CI](../.github/workflows/ci.yml)와 [CD](../.github/workflows/publish-images.yml) 두 workflow를 사용합니다. 별도 deploy workflow는 없습니다.

- CI는 변경 선택 → 단위·통합·설정 병렬 → 선택 HTTP 시스템 → `Required CI`입니다.
- 자동 CD publish는 신뢰된 같은 저장소 develop의 성공한 push/수동 CI만 받습니다. PR·fork·main·실패·취소 CI는 게시/배포 권한이 없습니다.
- 수동 **CD → Run workflow → develop**은 해당 커밋 네 이미지를 게시합니다. 이 수동 경로가 CI 재검증을 대신하지는 않습니다. 다른 ref는 생략합니다.
- deploy는 publish 성공만 요구하며 별도 활성화·승인 변수는 없습니다. GitHub environment 승인과 Tailscale·SSH host key 검증을 유지합니다.
- packages write는 publish, packages read/id-token write는 deploy에만 부여합니다. `storyfork-develop-cd` concurrency로 직렬화하고 실행 중 취소하지 않습니다.

자동 `workflow_run`은 기본 브랜치 main, 수동은 develop ref를 사용하므로 `develop-cd` environment의 allowed deployment branches에 둘을 허용하고 승인 정책을 유지해야 합니다. 소스 파일만으로 실제 GitHub 설정·branch protection·게시·배포가 완료되지 않습니다.

### 이미지

`linux/amd64`로 네 이미지를 게시합니다.

- `ghcr.io/sknetworks-family-aicamp/storyfork-web`
- `ghcr.io/sknetworks-family-aicamp/storyfork-core-api`
- `ghcr.io/sknetworks-family-aicamp/storyfork-content-service`
- `ghcr.io/sknetworks-family-aicamp/storyfork-ai-service`

모든 `sha-<전체 SHA>`를 게시한 뒤 `develop` 태그를 갱신합니다. publish는 대상 SHA가 현재 develop HEAD가 아니면 게시하지 않습니다. deploy는 pull한 네 `develop` 이미지의 revision이 모두 이 run의 SHA와 같지 않으면(혼합 revision·더 새 커밋 포함) 앱을 멈추기 전에 중단합니다. 같은 CD run에서 실패한 job만 재실행할 수 있습니다. 별도 run ID/artifact 증거 체계는 추가하지 않습니다.

### 배포 설정과 전환

| 위치 | 이름 | 역할 |
|---|---|---|
| Environment | `develop-cd` | main/develop ref와 필요한 승인 정책 |
| Environment variable | `CD_DEPLOY_DIR` / `CD_WEB_PORT` | 기존 전용 절대 실경로 / 비충돌 loopback 1024–65535 |
| Environment secret | `CD_SSH_PRIVATE_KEY` / `CD_SSH_KNOWN_HOSTS` | 전용 SSH 키 / 검증한 host key |
| Environment secret | `TS_OAUTH_CLIENT_ID` / `TS_AUDIENCE` | Tailscale workload identity |

기존 대상 `tgv99536@100.90.8.124:5798`, `tag:storyfork-cd` 접근·Bash·Docker·Compose v2(`up --wait`) 및 GHCR 읽기 권한이 필요합니다. 실제 주소/개인 설정에 이번 작업은 접속하지 않습니다. 서버 `.env`와 배포 디렉터리는 담당자가 준비하며 내부 DB 전용 자격·JWT·별도 서비스 자격/생성 토큰을 설정합니다. DB URL과 SMTP host/port는 `postgres`/`mailpit` 내부 DNS로 고정합니다. OpenAI는 AI만 받습니다. 새 production DB·계정·pool이나 marker/lock 파일을 만들지 않습니다. **기존 외부/공유 DB를 내부 fresh DB로 전환하거나 데이터를 이관하지 않았습니다.** 새 승인 변수는 대상·Auth/Studio/첨부 보존·백업/복구·별도 데이터 이관 계획 확인 전에는 활성화하지 않습니다.

**fresh 승인 변수는 DB를 초기화하거나 준비 상태를 검증하지 않습니다.** 정확한 개발 대상·보존할 Auth/Studio/첨부·백업/격리 복원·중단 시간·호환 이미지의 복구 방법을 담당자가 확정해야 합니다. 이 확인 없이 기존 Content history에 새 앱을 배포하지 않습니다. 일괄 DROP/volume 삭제·자동 repair/clean을 하지 않습니다.

CD는 기존 전용 디렉터리/project labels를 확인하고 base·dev 및 의존 서비스 참조용 local Compose 파일을 SSH stdin으로 임시 전달하며 서버 `.env`를 덮어쓰지 않습니다. 순서는 **두 DB 승인 확인 → login/pull → 앱 네 이미지만 revision 확인 → web·구 Core·Content writer 중지 → 내부 PostgreSQL·Mailpit `up --wait` → opt-in Studio 명시 migration → 새 앱 `up --wait`**입니다. PostgreSQL/Mailpit 이미지는 앱 revision 비교에서 제외하며 원격 앱 소스 build는 없습니다. Core Health 뒤 Content를 시작합니다. Studio main은 Content 이미지에 있으며 [대상 allowlist/백업/실패 계약](../docs/deployment/worldstudio-v1-rollout.md)을 따릅니다.

중지 전 login/pull/revision 실패는 기존 앱을 건드리지 않습니다. 중지 후 migration/startup 실패는 **ingress를 멈춘 채 실패**하며 자동 rollback/repair/retry·`down`/prune/volume 삭제를 하지 않습니다. 새 이력과 구 binary가 비호환이므로 운영자가 로그/이력과 호환 스냅샷을 확인해 복구를 결정합니다. `up --wait`는 running/healthcheck 확인이지 사용자 HTTP/DB/SMTP 전체 수용 검증이 아닙니다. web의 loopback 외 운영 TLS/ingress는 별도입니다.

## 설정 확인

```bash
# 수동 예시: 실제 .env를 읽지 않는 자동 검사는 .env.example + synthetic 값 사용
docker compose --env-file .env config --quiet
docker compose --env-file .env -f infrastructure/docker-compose.yaml -f infrastructure/docker-compose.local.yaml config --quiet
docker compose --env-file .env -f infrastructure/docker-compose.yaml -f infrastructure/docker-compose.dev.yaml config --quiet
docker compose --env-file .env -f infrastructure/docker-compose.yaml -f infrastructure/docker-compose.prod.yaml config --quiet
```

구문 검사만 하며 컨테이너를 시작하지 않습니다. CI configuration은 예시/synthetic 값으로 루트 기본 진입점과 local/dev/prod의 content false/true, 소스 빌드 CI overlay, 첨부 환경 격리를 확인합니다. 실제 DB·HTTP·SMTP는 CI 통합/시스템, 모델은 대역 또는 명시적 설정 누락 실패로 검증합니다.

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
