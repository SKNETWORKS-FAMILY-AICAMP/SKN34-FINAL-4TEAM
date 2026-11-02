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

## GHCR 이미지 게시

`develop` 또는 `main` 푸시에서 Required CI가 성공하면 다음 이미지를 `linux/amd64`로 빌드해 GHCR에 게시합니다. PR·수동 실행에서는 게시하지 않습니다. 서버 배포는 아래 별도 승인·설정이 없는 한 비활성화됩니다.

- `ghcr.io/sknetworks-family-aicamp/storyfork-web`
- `ghcr.io/sknetworks-family-aicamp/storyfork-core-api`
- `ghcr.io/sknetworks-family-aicamp/storyfork-ai-service`

태그는 브랜치 이름과 `sha-<전체 커밋 SHA>`입니다. 비공개 이미지를 pull하려면 해당 패키지에 접근 권한이 있는 GitHub 계정과 패키지 읽기 권한이 있는 인증으로 `docker login ghcr.io`를 먼저 실행합니다.
각 이미지 push 직전 익명 토큰 요청에서 단일 오류 코드가 상태와 일치하는 `401 UNAUTHORIZED` 또는 `403 DENIED`만 허용합니다. `401 UNAUTHORIZED`는 인증이 필요하다는 응답일 뿐 패키지의 비공개를 보장하지 않으며, `403 DENIED`는 비공개와 패키지 부재를 구분하지 못합니다. 최초 패키지는 비공개로 생성된다는 GitHub 정책을 전제합니다. 검사와 게시 사이 공개 설정이 바뀌는 경쟁 가능성도 있으므로 비공개를 보장하는 원자적 검사는 아닙니다. 이미지별 게시가 독립적으로 실패할 수 있어 일부만 게시될 수 있으며 Actions의 각 job 결과를 확인해야 합니다.

각 서비스는 게시 직전 GitHub API에서 현재 브랜치 HEAD를 읽고 이벤트 SHA와 다르거나 조회가 실패하면 해당 서비스의 게시를 중단합니다. 조회와 두 태그 push 사이에도 브랜치가 바뀔 수 있어 이 검사는 원자적이지 않으며 오래된 태그 게시를 완전히 막지 못합니다. matrix 작업은 독립적이므로 실패·취소 또는 브랜치 변경 시 SHA 태그와 브랜치 태그가 서비스별로 서로 다른 상태가 될 수 있습니다.

복구할 때 Actions의 각 서비스 결과와 GHCR의 세 패키지 태그 및 digest를 확인하고, 현재 브랜치 HEAD의 Required CI가 통과한 push 실행을 재실행해 세 이미지를 다시 게시합니다. 재실행 중에도 브랜치가 바뀌거나 일부 작업이 실패할 수 있으므로 완료 후 세 서비스의 브랜치 태그와 해당 SHA 태그 digest를 다시 비교합니다. 과거 실행을 재실행하면 HEAD 검사에서 게시가 중단됩니다.

## develop 이미지 CD — 별도 승인 후 opt-in

이 변경은 워크플로와 배포 산출물만 제공합니다. **서버 접속·배포, 서버 파일/권한 변경, GitHub/Tailscale 설정은 수행하지 않았습니다.** 실제 배포 디렉터리·포트·SSH host key와 서버 실행 환경은 미검증입니다. 기존 workload·데이터·비밀값을 보존하며, 아래 준비를 별도로 승인·완료하기 전에는 활성화하지 않습니다.

### 배포 허용 조건

- 같은 CI 안에서 `Required CI`와 `publish` matrix가 성공한 **develop push만** `Deploy develop images`로 이어집니다. PR·수동 실행·main·`workflow_run`은 배포하지 않습니다. 기존 이미지 게시 이벤트·태그 정책은 유지합니다.
- matrix 집계나 전체 workflow 성공만 믿지 않습니다. GitHub의 **현재 run ID / run attempt 전용 jobs API**에서 `Required CI`, `Publish web image`, `Publish core-api image`, `Publish ai-service image`가 각각 정확히 한 개이고 모두 `completed/success`이며 같은 SHA/run인지 확인합니다. 누락·중복·실패·취소·skipped·불완전 페이지는 거절합니다. 경로 필터로 일부 job이 생략된 실행도 이 증거를 대신할 수 없습니다.
- run의 저장소·원본 저장소·workflow 경로·push 이벤트·develop 브랜치·전체 SHA를 대조하고 현재 develop HEAD도 확인합니다. 다른 이벤트의 코드나 artifact를 받는 별도 privileged workflow는 없습니다.
- develop 실행은 `cancel-in-progress: false`로 진행 중 CI/CD를 새 push 때문에 중간 취소하지 않습니다(PR/main의 기존 취소 정책은 유지). CD job concurrency와 서버의 비차단 파일 잠금으로 중복 배포를 막습니다. 오래된 실행/재실행은 HEAD 검사에서 실패합니다.

### 별도로 준비할 GitHub / Tailscale 설정

| 위치 | 이름 | 필요한 값 / 제약 |
|---|---|---|
| Repository variable | `DEVELOP_CD_ENABLED` | 기본 미설정(배포 안 함). 서버 준비·실제 배포를 별도 승인한 뒤에만 문자열 `true` |
| Environment | `develop-cd` | 사전에 생성하고 develop 브랜치 제한·승인 reviewer 등 팀 보호 정책 설정. 파일 추가가 보호 설정을 대신하지 않음 |
| Environment variable | `CD_DEPLOY_DIR` | 별도 승인한 전용 디렉터리의 절대 실경로. 기본값 없음 |
| Environment variable | `CD_WEB_PORT` | 기존 서비스와 충돌하지 않는 승인된 loopback 포트(1024–65535). 기본값 없음 |
| Environment secret | `CD_SSH_PRIVATE_KEY` | 서버에 **이미 승인된** 전용 OpenSSH 인증키. 이 작업은 키 생성·authorized_keys 수정 안 함 |
| Environment secret | `CD_SSH_KNOWN_HOSTS` | 독립된 신뢰 경로로 검증한 `[100.105.27.82]:5798`의 known_hosts 항목. 관측/ssh-keyscan만으로 신뢰하지 않음 |
| Environment secret | `TS_OAUTH_CLIENT_ID` | Tailscale workload identity federation의 Client ID(이름과 달리 OAuth secret 불필요) |
| Environment secret | `TS_AUDIENCE` | federated identity와 일치하는 audience |

공식 [Tailscale GitHub Action](https://tailscale.com/docs/integrations/github/github-action) v4를 커밋 `064b10558093f38325e838ddea35486bdc6b1d5c`에 고정하고 `id-token: write`, `oauth-client-id`, `audience`, `tag:storyfork-cd`를 사용합니다. federated identity의 Auth Keys Write 권한과 tag를 사전 준비하고, GitHub identity는 이 저장소·`develop-cd` environment·develop ref/CI workflow로 제한합니다. tailnet 접근도 해당 tag → 대상 서버의 TCP 5798만 허용하도록 제한합니다. OAuth secret·장기 auth key·비밀번호를 저장소에 넣지 않습니다. 네트워크는 Tailscale, 인증과 host key 검증은 **표준 OpenSSH**이며 `tailscale ssh`가 아닙니다.

CD job의 `GITHUB_TOKEN`은 `packages: read`만 사용하며 세 private GHCR 패키지가 이 저장소 Actions에 읽기를 허용해야 합니다. `actions: read`는 정확한 실행 증거 조회에만 씁니다. 토큰은 SSH의 암호화된 stdin으로 전달해 서버의 권한 제한 임시 Docker config에만 보관하고 종료 시 삭제합니다. `docker login`/credential helper·서버의 기존 Docker 인증 설정·장기 PAT를 사용하지 않으며 토큰을 인자·로그·Compose 환경에 넣지 않습니다.

### 별도로 준비할 서버 상태

대상은 `tgv99536@100.105.27.82:5798`입니다. 아직 host key의 신뢰·디렉터리·포트·Docker 실행 가능 여부를 검증한 것이 아닙니다. host key secret이 없거나 일치하지 않으면 `StrictHostKeyChecking=yes`로 실패하며 TOFU·비밀번호 fallback은 없습니다.

별도 승인받은 운영자가 **기존 서비스 디렉터리와 다른 전용 경로**를 준비해야 합니다. 현재 확인된 경로·포트는 없으므로 이 문서에는 실제값이나 자동 provisioning 명령을 두지 않습니다.

- Linux, Python 3(표준 `fcntl` 포함), OpenSSH, Docker Engine의 `/var/run/docker.sock` 접근 권한, Docker Compose v2가 필요합니다. Docker 제어 권한은 강한 서버 권한이므로 계정 범위를 별도로 검토합니다. 서버에서 GitHub API/GHCR로 HTTPS 통신도 필요합니다.
- `CD_DEPLOY_DIR`은 symlink가 없는 실경로, SSH 계정 소유 `0700`이어야 합니다. 아래 세 파일은 같은 계정 소유의 symlink 아닌 일반 파일 `0600`으로 **미리 존재해야** 합니다. 배포 코드는 이 파일을 만들거나 덮어쓰지 않습니다.
  - `.env`: 서버가 관리하는 기존 루트 환경설정. 원문은 runner로 가져오지 않습니다. OpenAI 설정은 AI runtime에만 전달합니다. 서비스별 env-file은 추가하지 않습니다.
  - `.storyfork-cd.lock`: 비어 있는 전용 잠금 파일. 같은 프로젝트의 동시 배포는 대기 대신 실패합니다.
  - `.storyfork-cd.json`: 아래 세 필드만 담은 승인 marker. `repository` = `SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM`, `project` = `storyfork-develop-cd`, `web_port` = 승인한 `CD_WEB_PORT`와 같은 **JSON 정수**.
- `storyfork-develop-cd` 프로젝트는 기존 workload와 분리합니다. 같은 프로젝트명에 다른 container/network/volume이 있으면 거절합니다. 재배포는 이 CD의 저장소·디렉터리 ownership label을 가진 세 서비스/default network만 허용하며 volume은 사용하지 않습니다.
- `CD_WEB_PORT`가 이미 사용 중이면 다른 서비스를 중지하지 말고 준비 단계에서 다른 포트를 승인합니다. web은 `127.0.0.1`에만 바인딩하고 Core/AI는 외부 공개하지 않습니다. 인증·TLS·공개 ingress는 제공하지 않아 인터넷 운영 준비가 아닙니다.

### 실행·검증·실패 동작

[`compose.cd.yaml`](compose.cd.yaml)은 `build` 없는 독립 image Compose입니다. 기존 dev/prod Compose를 수정하거나 서버 compose/user 파일을 복사·덮어쓰지 않고 SSH stdin으로 전달합니다. 서버 소유 `.env`를 `--env-file`로 명시하고 프로젝트명은 `storyfork-develop-cd`로 고정합니다.

1. runner에서 push/run-attempt/게시/HEAD와 필수 입력을 검사한 뒤에만 tailnet에 참여합니다.
2. 서버에서 승인 marker·파일 권한·잠금·기존 자원 ownership을 확인합니다. 세 이미지 모두 같은 `sha-<전체 이벤트 SHA>`로 pull하고 OCI revision/source label을 확인합니다. 하나라도 실패하면 컨테이너 변경 전에 멈춥니다.
3. pull된 이미지의 해당 GHCR repository digest를 고정해 Compose에 전달합니다. 잠금 아래에서 현재 push/게시/HEAD를 다시 확인한 뒤 `up --detach --no-build --pull never`만 실행합니다. `down`, volume 삭제, orphan 제거는 없습니다.
4. 최대 180초 동안 실제 세 컨테이너의 running 상태·image ID·SHA label과 loopback의 web index, `/api/v1/health`, `/api/v1/health/ai-service`의 HTTP 200 및 service/status 본문을 확인합니다. runner의 마지막 HEAD 검사까지 성공해야 SHA/project/세 digest 증거를 출력합니다. `up -d`만으로 성공 처리하지 않습니다.

GitHub HEAD 검사와 Docker 갱신은 원자적이지 않습니다. 검사 직후 push·수동 취소·연결 종료·up/health 실패 시 이 **분리된 프로젝트 안에서** 일부 갱신이 남을 수 있습니다. 실패를 성공/fallback으로 숨기지 않고 자동 rollback·기존 스택 정리는 하지 않습니다. 운영자가 상태·권한·원인을 확인한 뒤 현재 develop HEAD의 **전체 job 재실행**을 선택해야 합니다. 실패 job만/배포만 재실행하면 현재 attempt의 세 게시 증거가 없어 배포를 거절합니다. `Required CI`는 배포 전에 끝나므로 그것만 녹색인 것은 CD 성공 증거가 아닙니다.

로컬 회귀(다운로드·daemon·서버 접속 없이):

```bash
python3 -I infrastructure/scripts/test-deploy-develop.py
python3 -I infrastructure/scripts/check-compose-config.py
python3 -I infrastructure/scripts/test-publish-preflight.py
```

CI의 infrastructure 경로 검사에 새 회귀를 포함합니다. 테스트는 비신뢰 이벤트/잘못된 SHA, 누락·skipped·실패·취소된 matrix/이전 attempt, HEAD 조회 실패, 각 pull 실패, 외부 프로젝트 거절, SSH 실패와 strict 옵션, source/health 불일치 및 Compose 비밀값 경계를 검사합니다. 이는 실제 Tailscale/GHCR/SSH·서버 runtime 검증을 대신하지 않습니다. 브라우저 코드/사용자 흐름 변경은 없으며 Aside E2E는 제외하고 실제 서버 smoke는 별도 승인 전까지 미실행입니다. 최신 커밋의 Required CI 및 활성화 후 CD 실제 결과는 별도로 확인해야 합니다.
