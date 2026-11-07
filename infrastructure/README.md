# STORYFORK Docker 실행 기반

현재는 시작 화면과 Core·AI Health만 제공하는 세 서비스 기반입니다. 업무 기능은 없습니다.

| 항목 | `compose.yaml` | `compose.prod.yaml` |
|---|---|---|
| 프로젝트 | `storyfork-dev` | `storyfork-prod-validation` |
| web | Vite hot reload, 소스·node_modules volume | pnpm locked build → nginx 정적 runtime |
| web 공개 | `127.0.0.1:${DEV_WEB_PORT:-5173}` | `127.0.0.1:${WEB_PORT:-8088}` |
| Core 공개 | `127.0.0.1:${CORE_API_PORT:-8080}` | 없음 |
| AI 공개 | 없음 | 없음 |

서비스는 정확히 `web`, `core-api`, `ai-service`입니다. 두 Compose는 상속 없이 각각 실행합니다.
인증·TLS가 없는 loopback **로컬 검증용**이며 인터넷 운영용 배포가 아닙니다.

```text
Browser → web (dev Vite / prod nginx) → core-api:8080 → ai-service:8000
```

브라우저는 공개 Core API만 사용하고 AI 내부 DNS를 직접 호출하지 않습니다.
API 404는 SPA HTML로 바꾸지 않으며 알 수 없는 UI deep link만 홈 화면으로 이동합니다.

## 시작과 설정

저장소 루트에서 예시를 그대로 사용할 수 있으며 키는 필요하지 않습니다.

```bash
docker compose --env-file .env.example --file infrastructure/compose.yaml up --build
# http://127.0.0.1:5173
docker compose --env-file .env.example --file infrastructure/compose.yaml down

# 독립적인 배포 이미지 로컬 검증
docker compose --env-file .env.example --file infrastructure/compose.prod.yaml up --build -d
# http://127.0.0.1:8088
docker compose --env-file .env.example --file infrastructure/compose.prod.yaml down
```

개인 설정은 `cp -n .env.example .env` 후 `--env-file .env`로 사용하고 기존 파일을 덮어쓰지 않습니다.
개발 종료 시 의존성 volume은 보존됩니다.

| 변수 | 기본값 | 소비 경계 |
|---|---|---|
| `OPENAI_API_KEY` | 빈 값, 선택 | AI 런타임만, 현재 읽거나 사용하지 않음 |
| `OPENAI_MODEL` | `gpt-5.6-luna` | AI 런타임만, 향후 구현용 예약 |
| `AI_SERVICE_CONNECT_TIMEOUT` | `1s` | Core → AI 연결 |
| `AI_SERVICE_READ_TIMEOUT` | `12s` | Core → AI 읽기 |
| `DEV_WEB_PORT` / `CORE_API_PORT` | `5173` / `8080` | dev loopback 포트 |
| `WEB_PORT` | `8088` | prod loopback 포트 |
| `APP_CORS_ALLOWED_ORIGIN` | 빈 값이면 해당 web 포트로 계산 | Core의 단일 허용 origin |

Health는 OpenAI 인증·모델 접근을 검사하지 않으며 클라이언트를 만들지 않습니다.
키를 설정해도 생성 API가 제공되지는 않습니다. 키는 Frontend·Core·build ARG에 전달하지 않습니다.

루트 `.env` 한 곳에서 설정을 관리합니다. Compose에는 `--env-file .env`를 명시하고 전체 파일을 서비스에 주입하지 않습니다.
네이티브는 루트에서 `python3 infrastructure/scripts/run-native.py web|core-api|ai-service`로 실행합니다.
Python 3·uv가 필요하며 실행기는 서비스별 허용 변수만 전달합니다. 직접 pnpm/Gradle/uvicorn 실행은 루트 파일을 로드하지 않습니다.
네이티브 Core의 AI 기본 주소는 `http://127.0.0.1:8000`, Compose는 `http://ai-service:8000`을 고정 사용합니다.
Frontend의 공개 설정도 루트 `.env.example`에 있으며 Compose는 `/`와 내부 프록시를 지정합니다.

## 검증

설정 회귀는 Docker Compose plugin과 Python 표준 라이브러리만 사용합니다.
이미지 빌드·스택 실행·실제 키·외부 API 호출이 필요 없습니다.

```bash
python3 -I infrastructure/scripts/check-compose-config.py
bash -n infrastructure/scripts/verify-compose.sh
```

기본/변경 포트·CORS·빈 키 부팅 설정·비밀 서비스 경계·고정 AI DNS·prod 정적 격리를 확인합니다.
macOS Bash 3.2의 가변 body 패턴과 false-zero 종료 회귀도 검사합니다.

별도 통합 검증자가 실행할 smoke:

```bash
./infrastructure/scripts/verify-compose.sh dev
./infrastructure/scripts/verify-compose.sh prod
# 충돌 시 다른 프로젝트를 중지하지 말고 포트를 변경합니다.
DEV_WEB_PORT=25173 CORE_API_PORT=28080 ./infrastructure/scripts/verify-compose.sh dev
WEB_PORT=28088 ./infrastructure/scripts/verify-compose.sh prod
```

두 모드 모두 실제 Core·AI Health, 업무 API 부재/404, AI 중지 시 Core 생존과 안전한 503/504,
AI 재시작 후 복구를 검사합니다. prod는 정적 index·JS asset·deep link·누락 asset 404도 확인합니다.
실제 키나 합성 키를 사용하지 않고 OpenAI를 호출하지 않습니다. 이미지·의존성 다운로드에는 네트워크가 필요합니다.

`--env-file /dev/null`로 개인 `.env`를 읽지 않고 실행마다 별도 `storyfork-verify-<mode>-<pid>`를 사용합니다.
같은 이름의 container/network/volume이 있으면 cleanup 설치 전에 거절합니다.
검증 종료 시 자신이 만든 프로젝트와 volume만 정리합니다. 기본 포트는 dev `15173`/`18080`, prod `18088`입니다.
`VERIFY_COMPOSE_PROJECT_NAME`, `VERIFY_COMPOSE_TIMEOUT_SECONDS`(120초),
`VERIFY_COMPOSE_KEEP_RUNNING=true`(진단용 보존)를 지원합니다. 실패 시 비밀값이나 서비스 원문 로그를 덤프하지 않습니다.

## CI → CD (publish → deploy)

[CI](../.github/workflows/ci.yml)와 [CD](../.github/workflows/publish-images.yml) 두 workflow를 사용합니다. 별도 deploy workflow는 없습니다.

- CI는 변경 선택 → 단위·통합·설정 병렬 → 선택 HTTP 시스템 → `Required CI`입니다.
- 자동 CD publish는 신뢰된 같은 저장소 develop의 성공한 push/수동 CI만 받습니다. PR·fork·main·실패·취소 CI는 게시/배포 권한이 없습니다.
- 수동 **CD → Run workflow → develop**은 해당 커밋 네 이미지를 게시합니다. 이 수동 경로가 CI 재검증을 대신하지는 않습니다. 다른 ref는 생략합니다.
- deploy는 publish 성공과 repository variables **`DEVELOP_CD_ENABLED=true`·`CONTENT_FRESH_SCHEMA_APPROVED=true`·`DEVELOP_INTERNAL_DB_APPROVED=true` 모두**를 요구합니다. 새 내부 DB 전환은 과거 외부 DB용 승인만으로 자동 시작하지 않습니다. GitHub environment 승인과 Tailscale·SSH host key 검증을 유지합니다.
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
| Repository variable | `DEVELOP_CD_ENABLED` | 배포 허용 시 `true` |
| Repository variable | `CONTENT_FRESH_SCHEMA_APPROVED` | 정확한 개발 DB의 Content fresh 전환 준비/복구 승인 후 `true` |
| Repository variable | `DEVELOP_INTERNAL_DB_APPROVED` | 외부/공유 DB 보존·별도 내부 DB로의 전환/이관 계획을 담당자가 승인한 후만 `true`; 기본 미설정이면 배포 생략 |
| Environment | `develop-cd` | main/develop ref와 필요한 승인 정책 |
| Environment variable | `CD_DEPLOY_DIR` / `CD_WEB_PORT` | 기존 전용 절대 실경로 / 비충돌 loopback 1024–65535 |
| Environment secret | `CD_SSH_PRIVATE_KEY` / `CD_SSH_KNOWN_HOSTS` | 전용 SSH 키 / 검증한 host key |
| Environment secret | `TS_OAUTH_CLIENT_ID` / `TS_AUDIENCE` | Tailscale workload identity |

기존 대상 `tgv99536@100.90.8.124:5798`, `tag:storyfork-cd` 접근·Bash·Docker·Compose v2(`up --wait`) 및 GHCR 읽기 권한이 필요합니다. 실제 주소/개인 설정에 이번 작업은 접속하지 않습니다. 서버 `.env`와 배포 디렉터리는 담당자가 준비하며 내부 DB 전용 자격·JWT·별도 서비스 자격/생성 토큰을 설정합니다. DB URL과 SMTP host/port는 `postgres`/`mailpit` 내부 DNS로 고정합니다. OpenAI는 AI만 받습니다. 새 production DB·계정·pool이나 marker/lock 파일을 만들지 않습니다. **기존 외부/공유 DB를 내부 fresh DB로 전환하거나 데이터를 이관하지 않았습니다.** 새 승인 변수는 대상·Auth/Studio/첨부 보존·백업/복구·별도 데이터 이관 계획 확인 전에는 활성화하지 않습니다.

**fresh 승인 변수는 DB를 초기화하거나 준비 상태를 검증하지 않습니다.** 정확한 개발 대상·보존할 Auth/Studio/첨부·백업/격리 복원·중단 시간·호환 이미지의 복구 방법을 담당자가 확정해야 합니다. 이 확인 없이 기존 Content history에 새 앱을 배포하지 않습니다. 일괄 DROP/volume 삭제·자동 repair/clean을 하지 않습니다.

CD는 기존 전용 디렉터리/project labels를 확인하고 base·dev 및 의존 서비스 참조용 local Compose 파일을 SSH stdin으로 임시 전달하며 서버 `.env`를 덮어쓰지 않습니다. 순서는 **두 DB 승인 확인 → login/pull → 앱 네 이미지만 revision 확인 → web·구 Core·Content writer 중지 → 내부 PostgreSQL·Mailpit `up --wait` → opt-in Studio 명시 migration → 새 앱 `up --wait`**입니다. PostgreSQL/Mailpit 이미지는 앱 revision 비교에서 제외하며 원격 앱 소스 build는 없습니다. Core Health 뒤 Content를 시작합니다. Studio main은 Content 이미지에 있으며 [대상 allowlist/백업/실패 계약](../docs/deployment/worldstudio-v1-rollout.md)을 따릅니다.

중지 전 login/pull/revision 실패는 기존 앱을 건드리지 않습니다. 중지 후 migration/startup 실패는 **ingress를 멈춘 채 실패**하며 자동 rollback/repair/retry·`down`/prune/volume 삭제를 하지 않습니다. 새 이력과 구 binary가 비호환이므로 운영자가 로그/이력과 호환 스냅샷을 확인해 복구를 결정합니다. `up --wait`는 running/healthcheck 확인이지 사용자 HTTP/DB/SMTP 전체 수용 검증이 아닙니다. web의 loopback 외 운영 TLS/ingress는 별도입니다.
