# STORYFORK Docker 실행 기반

화면 데모와 Core·AI Health, 이메일 가입·인증, 로그인·세션, 비밀번호 복구·프로필 API를 제공합니다. `compose.content.yaml` overlay는 기본 Auth PostgreSQL과 같은 DB·자격증명·volume을 재사용해 콘텐츠 저장을 활성화합니다. [콘텐츠 실행·인증 안내](../docs/content-integration.md)를 참고하세요. 실제 약관·동의와 회원 탈퇴는 미구현이며 운영 가입용이 아닙니다.

| 항목 | `compose.yaml` | `compose.prod.yaml` |
|---|---|---|
| 프로젝트 | `storyfork-dev` | `storyfork-prod-validation` |
| web | Vite hot reload, 소스·node_modules volume | pnpm locked build → nginx 정적 runtime |
| 브라우저 진입점 | nginx `127.0.0.1:${DEV_WEB_PORT:-5173}` | nginx `127.0.0.1:${WEB_PORT:-8088}` |
| Core 공개 | `127.0.0.1:${CORE_API_PORT:-8080}` | 없음 |
| AI 공개 | 없음 | 없음 |

서비스는 `web`, `core-api`, `ai-service`, PostgreSQL, 로컬 메일 확인용 Mailpit이며 dev에는 nginx가 추가됩니다. Vite는 외부에 직접 공개하지 않습니다. 두 Compose는 상속 없이 각각 실행하며 각각 독립 DB volume을 사용합니다.
인증·TLS가 없는 loopback **로컬 검증용**이며 인터넷 운영용 배포가 아닙니다.

```text
Browser → nginx → dev Vite (HMR 포함) / prod 정적 파일
                → core-api:8080 → ai-service:8000
```

브라우저는 공개 Core API만 사용하고 AI 내부 DNS를 직접 호출하지 않습니다.
API 404는 SPA HTML로 바꾸지 않으며 알 수 없는 UI deep link만 홈 화면으로 이동합니다.

## 시작과 설정

루트 `.env`에 개발용 `CORE_DATABASE_USER`, `CORE_DATABASE_PASSWORD`와 32바이트 이상 무작위 값의 Base64 인코딩인 `AUTH_JWT_SECRET`을 직접 설정하고, `AUTH_PUBLIC_ORIGIN`을 실제 web origin으로 지정합니다. JWT 키는 Core에만 전달하며 저장소에 커밋하지 않습니다. 로컬 HTTP 검증에서만 `AUTH_COOKIE_SECURE=false`로 설정하고 HTTPS 운영에서는 `true`를 사용합니다. 기존 `.env`는 덮어쓰지 않습니다. Mailpit 화면은 기본 `http://127.0.0.1:8025`이며 인증 메일을 포함하므로 로컬에서만 사용합니다.

SMTP는 가입 인증·비밀번호 복구·이메일 변경 메일에 사용합니다. 가입 인증 링크는 24시간, 비밀번호 재설정·이메일 변경 링크는 1시간 유효합니다. 가입 인증은 토큰과 가입 시 정한 비밀번호를 함께 요구하고, 이메일 변경 확인은 토큰만 사용합니다. 프로필 조회·닉네임 변경·이메일 변경 요청 및 복구 API의 실제 경로는 [Core API 계약](../backend/core-api/README.md#공개-계약)을 참고합니다.

```bash
docker compose --env-file .env --file infrastructure/compose.yaml up --build
# http://127.0.0.1:5173
docker compose --env-file .env --file infrastructure/compose.yaml down

# 독립적인 배포 이미지 로컬 검증
docker compose --env-file .env --file infrastructure/compose.prod.yaml up --build -d
# http://127.0.0.1:8088
docker compose --env-file .env --file infrastructure/compose.prod.yaml down
```

개인 설정은 `cp -n .env.example .env` 후 `--env-file .env`로 사용하고 기존 파일을 덮어쓰지 않습니다.
개발 종료 시 의존성 volume은 보존됩니다.

| 변수 | 기본값 | 소비 경계 |
|---|---|---|
| `OPENAI_API_KEY` | 빈 값 | AI 런타임만, 생성 요청에 필요 |
| `OPENAI_MODEL` | 빈 값 | AI 런타임만, 생성 시 명시 필요 |
| `AI_SERVICE_CONNECT_TIMEOUT` | `1s` | Core → AI 연결 |
| `AI_SERVICE_READ_TIMEOUT` | `12s` | Core → AI Health 읽기 |
| `AI_GENERATION_READ_TIMEOUT` | `75s` | Core → AI 생성 읽기 |
| `DEV_WEB_PORT` / `CORE_API_PORT` | `5173` / `8080` | dev loopback 포트 |
| `WEB_PORT` | `8088` | prod loopback 포트 |
| `APP_CORS_ALLOWED_ORIGIN` | 빈 값이면 해당 web 포트로 계산 | Core의 단일 허용 origin |

Health는 OpenAI 인증·모델 접근을 검사하지 않으며 클라이언트를 만들지 않습니다.
콘텐츠 기능과 내부 인증을 구성하고 키·모델을 명시하면 생성 API를 사용할 수 있습니다. 모델 또는 키 누락 시 503으로 실패합니다. 키는 Frontend·Core·build ARG에 전달하지 않습니다.

루트 `.env` 한 곳에서 설정을 관리합니다. Compose에는 `--env-file .env`를 명시하고 전체 파일을 서비스에 주입하지 않습니다.
네이티브 기본 웹 주소는 `http://localhost:5173`입니다. `VITE_DEV_SERVER_HOST`를 변경하면 `APP_CORS_ALLOWED_ORIGIN`도 실제 웹 origin에 맞추세요. 생성 timeout을 늘릴 때는 브라우저 요청 한도(80초)와 Nginx 프록시 읽기 한도(90초)도 함께 검토하세요.

네이티브는 루트에서 `python3 infrastructure/scripts/run-native.py web|core-api|ai-service`로 실행합니다.
Python 3·uv가 필요하며 실행기는 서비스별 허용 변수만 전달합니다. 직접 pnpm/Gradle/uvicorn 실행은 루트 파일을 로드하지 않습니다.
네이티브 Core의 AI 기본 주소는 `http://127.0.0.1:8000`, Compose는 `http://ai-service:8000`을 고정 사용합니다.
Frontend의 공개 설정도 루트 `.env.example`에 있으며 Compose는 `/`와 내부 프록시를 지정합니다.

## 검증

설정 회귀는 Docker Compose plugin과 Python 표준 라이브러리만 사용합니다.
이미지 빌드·스택 실행·실제 키·외부 API 호출이 필요 없습니다.

```bash
python3 -I infrastructure/scripts/check-compose-config.py
python3 -I infrastructure/scripts/check-nginx-routing.py
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

두 모드 모두 실제 Core·AI Health, 미구현 API 접근 거부, AI 중지 시 Core 생존과 안전한 503/504,
AI 재시작 후 복구를 검사합니다. prod는 정적 index·JS asset·deep link·누락 asset 404도 확인합니다.
일회용 JWT 테스트 키만 사용하며 OpenAI 키나 모델 호출은 사용하지 않습니다. 이미지·의존성 다운로드에는 네트워크가 필요합니다.

`--env-file /dev/null`로 개인 `.env`를 읽지 않고 실행마다 별도 `storyfork-verify-<mode>-<pid>`를 사용합니다.
같은 이름의 container/network/volume이 있으면 cleanup 설치 전에 거절합니다.
검증 종료 시 자신이 만든 프로젝트와 volume만 정리합니다. 기본 포트는 dev `15173`/`18080`, prod `18088`입니다.
`VERIFY_COMPOSE_PROJECT_NAME`, `VERIFY_COMPOSE_TIMEOUT_SECONDS`(120초),
`VERIFY_COMPOSE_KEEP_RUNNING=true`(진단용 보존)를 지원합니다. 실패 시 비밀값이나 서비스 원문 로그를 덤프하지 않습니다.

## CI → Images → Deploy

세 단계는 Actions에서 각각 보이는 독립 워크플로입니다. 자동으로 순서대로 이어지며, 앞 단계를 반복하지 않고 각 단계를 수동 재시도할 수 있습니다. 서버 배포는 별도 opt-in·승인·설정 전에는 비활성화됩니다.

1. [CI](../.github/workflows/ci.yml)는 `develop`·`main` 푸시와 PR에서 변경 경로별 테스트·lint·애플리케이션 빌드 및 `Required CI`를 수행합니다. 게시·배포 job은 없습니다. 수동 `Run workflow`는 선택한 ref를 checkout하고 변경 경로가 없어도 네 검증 job을 모두 실행합니다. 세 워크플로 경로 모두 경로 필터에 포함합니다.
2. [Images](../.github/workflows/publish-images.yml)는 `develop`·`main`의 CI가 완료된 다음, 같은 저장소의 `push` 또는 `workflow_dispatch` CI가 성공한 경우에만 자동으로 이어집니다. PR·fork·실패·취소된 CI는 게시하지 않습니다. API 증거 확인 → 이미지 빌드 → 익명 접근 검사 → 현재 HEAD 확인 → 태그 push 순서이며 세 이미지의 matrix job은 병렬입니다. CI 경로 필터로 일부 서비스가 skipped여도 `Required CI`가 성공했다면 별도 Images 실행은 그 skip을 상속하지 않습니다.
3. [Deploy](../.github/workflows/deploy-develop.yml)는 성공한 Images 이후 원본 CI와 세 게시 job의 증거를 검증하고 **develop 이미지에만** 이어집니다. main 이미지·PR·fork·실패·취소·불완전 게시 증거는 배포하지 않습니다. 테스트나 이미지를 다시 빌드하지 않습니다.

`Images`의 수동 `Run workflow`에서 `develop` 또는 `main`을 선택하면 해당 HEAD의 기존 성공 CI를 찾아 게시만 재시도합니다. 별도 SHA 입력은 받지 않습니다. 증거가 없으면 먼저 `CI`를 해당 브랜치에서 수동 실행합니다. 성공한 수동 CI도 Images를 자동 시작합니다.

`Deploy`의 수동 `Run workflow`는 **main에서** 실행하고 `images_run_id`에 현재 develop HEAD를 게시한 완료·성공 Images 실행 ID를 입력합니다. 그 실행의 최신 attempt 전체를 검증하여 기존 이미지만 재배포하며, CI·Images를 재실행하지 않습니다. 자동 배포와 같은 opt-in·환경 보호·concurrency·HEAD 검사를 적용합니다.

**활성화 전제:** `workflow_run`과 수동 실행 버튼은 워크플로가 기본 브랜치 `main`에 있어야 동작합니다. 세 워크플로와 신뢰하는 `check-publish-ci.py`, `deploy-develop.py`, `compose.cd.yaml`을 모두 main에 통합해야 합니다. 이 변경만으로 main 통합·활성화가 완료되었다고 볼 수 없습니다. 실제 호스팅 CI·GHCR 게시·서버 배포는 각각 별도 승인과 원격 검증이 필요합니다.

## GHCR 이미지 게시

두 Images 실행 경로 모두 읽기 전용 gate에서 기본 브랜치의 신뢰하는 스크립트를 먼저 실행합니다. GitHub Actions API로 정확한 CI workflow 경로·ID·실행 ID·attempt·완료/성공 상태·원래 이벤트·저장소·브랜치·SHA와 해당 attempt의 `Required CI` job 성공을 확인합니다. 전체 workflow 성공만으로 허용하지 않으며 API/네트워크 실패·잘못된 응답·증거 부재·HEAD 불일치는 게시를 중단합니다. PR/fork artifact나 cache는 가져오지 않습니다.

`workflow_run`의 `GITHUB_SHA`·`GITHUB_REF`는 대상 CI가 아니라 기본 브랜치를 가리킵니다. gate가 검증한 SHA·브랜치 출력만 대상 checkout, revision label, 태그와 HEAD 검사에 사용합니다. `packages: write`는 gate 이후 게시 job에만 부여합니다. 자동·수동 Images는 같은 `images-<대상 브랜치>` concurrency group으로 직렬화하고 진행 중 실행은 취소하지 않습니다. GitHub concurrency는 FIFO 대기열이 아니며 새 실행이 기존 pending 실행을 대체할 수 있습니다.

게시 대상은 다음 세 이미지이며 `linux/amd64`로 빌드합니다.

- `ghcr.io/sknetworks-family-aicamp/storyfork-web`
- `ghcr.io/sknetworks-family-aicamp/storyfork-core-api`
- `ghcr.io/sknetworks-family-aicamp/storyfork-ai-service`

태그는 검증한 브랜치 이름(`develop`·`main`)과 `sha-<전체 커밋 SHA>`입니다. 비공개 이미지를 pull하려면 해당 패키지에 접근 권한이 있는 GitHub 계정과 패키지 읽기 권한이 있는 인증으로 `docker login ghcr.io`를 먼저 실행합니다.
각 이미지 push 직전 익명 토큰 요청에서 단일 오류 코드가 상태와 일치하는 `401 UNAUTHORIZED` 또는 `403 DENIED`만 허용합니다. `401 UNAUTHORIZED`는 인증이 필요하다는 응답일 뿐 패키지의 비공개를 보장하지 않으며, `403 DENIED`는 비공개와 패키지 부재를 구분하지 못합니다. 최초 패키지는 비공개로 생성된다는 GitHub 정책을 전제합니다. 검사와 게시 사이 공개 설정이 바뀌는 경쟁 가능성도 있으므로 비공개를 보장하는 원자적 검사는 아닙니다. 이미지별 게시가 독립적으로 실패할 수 있어 일부만 게시될 수 있으며 Actions의 각 job 결과를 확인해야 합니다.

각 서비스는 게시 직전 GitHub API에서 현재 대상 브랜치 HEAD를 다시 읽고 검증한 SHA와 다르거나 조회가 실패하면 게시를 중단합니다. 조회와 두 태그 push 사이에도 브랜치가 바뀔 수 있어 이 검사는 원자적이지 않으며 오래된 태그 게시를 완전히 막지 못합니다. matrix 작업은 독립적이므로 실패·취소 또는 브랜치 변경 시 SHA 태그와 브랜치 태그가 서비스별로 서로 다른 상태가 될 수 있습니다.

복구할 때 Actions의 각 서비스 결과와 GHCR의 세 패키지 태그 및 digest를 확인하고, 현재 HEAD에 성공 CI 증거가 있으면 `Images`만 수동 실행하거나 같은 HEAD의 기존 Images에서 **Re-run all jobs**를 선택합니다. 실패 job만 재실행하면 현재 attempt의 gate/세 게시/메타데이터 증거가 없어 Deploy는 거절합니다. 과거 실행의 SHA가 현재 HEAD와 다르면 gate 또는 push 직전 검사에서 중단됩니다. 완료 후에도 세 서비스의 브랜치 태그와 해당 SHA 태그 digest를 다시 비교합니다.

## develop 이미지 CD — 별도 승인 후 opt-in

이 변경은 워크플로와 배포 산출물만 제공합니다. **서버 접속·배포, 서버 파일/권한 변경, GitHub/Tailscale 설정은 수행하지 않았습니다.** 실제 배포 디렉터리·포트·SSH host key와 서버 실행 환경은 미검증입니다. 기존 workload·데이터·비밀값을 보존하며, 아래 준비를 별도로 승인·완료하기 전에는 활성화하지 않습니다.

### 배포 허용 조건과 source handoff

- Images의 `workflow_run` 자체는 main SHA/브랜치를 가리킬 수 있으므로 Deploy에 Images 브랜치 필터를 걸거나 그 `head_sha`를 배포 대상으로 쓰지 않습니다. 게시 job의 `head_sha`도 게시 대상 SHA가 아닌 **해당 Images 실행 SHA**와 대조합니다.
- Images의 신뢰하는 gate가 `publication-source-<Images run ID>-<attempt>` artifact 하나에 `publication-source.json`을 기록합니다. JSON은 저장소, 대상 branch/SHA, 원본 CI run ID/attempt, Images run ID/attempt만 담고 보존 기간은 7일입니다. 업로드 action은 공식 full commit SHA에 고정합니다.
- Deploy는 같은 저장소의 활성 Images workflow 경로·ID·실행 ID·최신 attempt·완료/성공 상태·허용 이벤트와 정확한 attempt API를 검증합니다. 그 실행의 위 이름 artifact만 받고 API 목록에 기록된 artifact 크기와 실제 ZIP은 16 KiB, 단일 JSON은 4 KiB로 제한합니다. 누락·중복·만료·다른 실행·잘못된 JSON/중복 키는 거절하며 파일을 추출하거나 실행하지 않습니다. PR/fork artifact나 cache는 사용하지 않습니다. artifact가 만료되면 Images 전체를 다시 실행해야 합니다.
- 해당 Images attempt의 `Verify successful CI`, `Publish web image`, `Publish core-api image`, `Publish ai-service image`가 각각 정확히 하나이고 모두 `completed/success`여야 합니다. 누락·중복·실패·취소·skipped·불완전 페이지·부분 재실행은 거절합니다. 원본 CI의 같은 develop SHA/run/attempt와 `Required CI` 성공은 기존 공용 gate로 다시 검증합니다. 전체 workflow 성공만 믿지 않습니다.
- 배포 helper·Compose도 main의 신뢰하는 checkout을 사용합니다. 자동·수동 Deploy는 `storyfork-develop-cd` concurrency group에서 직렬화하고 진행 중 rollout을 취소하지 않습니다. 서버의 비차단 파일 잠금도 중복 배포를 막습니다. CI 자체 취소 정책은 배포와 분리됩니다. 오래된 실행/재실행은 현재 develop HEAD 검사에서 실패합니다.

### 별도로 준비할 GitHub / Tailscale 설정

| 위치 | 이름 | 필요한 값 / 제약 |
|---|---|---|
| Repository variable | `DEVELOP_CD_ENABLED` | 기본 미설정(배포 안 함). 서버 준비·실제 배포를 별도 승인한 뒤에만 문자열 `true` |
| Environment | `develop-cd` | 사전에 생성하고 신뢰하는 **main의 Deploy workflow ref**와 승인 reviewer 등 팀 보호 정책 설정. 배포 대상 develop 제한은 gate가 강제하며 파일 추가가 보호 설정을 대신하지 않음 |
| Environment variable | `CD_DEPLOY_DIR` | 별도 승인한 전용 디렉터리의 절대 실경로. 기본값 없음 |
| Environment variable | `CD_WEB_PORT` | 기존 서비스와 충돌하지 않는 승인된 loopback 포트(1024–65535). 기본값 없음 |
| Environment secret | `CD_SSH_PRIVATE_KEY` | 서버에 **이미 승인된** 전용 OpenSSH 인증키. 이 작업은 키 생성·authorized_keys 수정 안 함 |
| Environment secret | `CD_SSH_KNOWN_HOSTS` | 독립된 신뢰 경로로 검증한 `[100.105.27.82]:5798`의 known_hosts 항목. 관측/ssh-keyscan만으로 신뢰하지 않음 |
| Environment secret | `TS_OAUTH_CLIENT_ID` | Tailscale workload identity federation의 Client ID(이름과 달리 OAuth secret 불필요) |
| Environment secret | `TS_AUDIENCE` | federated identity와 일치하는 audience |

공식 [Tailscale GitHub Action](https://tailscale.com/docs/integrations/github/github-action) v4를 커밋 `064b10558093f38325e838ddea35486bdc6b1d5c`에 고정하고 `id-token: write`, `oauth-client-id`, `audience`, `tag:storyfork-cd`를 사용합니다. federated identity의 Auth Keys Write 권한과 tag를 사전 준비하고, GitHub identity는 이 저장소·`develop-cd` environment·main ref의 `deploy-develop.yml`로 제한합니다. tailnet 접근도 해당 tag → 대상 서버의 TCP 5798만 허용하도록 제한합니다. OAuth secret·장기 auth key·비밀번호를 저장소에 넣지 않습니다. 네트워크는 Tailscale, 인증과 host key 검증은 **표준 OpenSSH**이며 `tailscale ssh`가 아닙니다.

CD job의 `GITHUB_TOKEN`은 `packages: read`만 사용하며 세 private GHCR 패키지가 이 저장소 Actions에 읽기를 허용해야 합니다. `actions: read`는 정확한 실행/메타데이터 증거 조회에만 씁니다. 토큰은 SSH의 암호화된 stdin으로 전달해 서버의 권한 제한 임시 Docker config에만 보관하고 종료 시 삭제합니다. `docker login`/credential helper·서버의 기존 Docker 인증 설정·장기 PAT를 사용하지 않으며 토큰을 인자·로그·Compose 환경에 넣지 않습니다.

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

CD는 위 세 서비스만 실행하며 PostgreSQL·SMTP·volume을 추가하지 않습니다. 운영자가 Core 컨테이너에서 접근 가능한 외부 PostgreSQL과 SMTP를 사전 구성하고, 서버 소유 루트 `.env`에 `CORE_DATABASE_URL`, `CORE_DATABASE_USER`, `CORE_DATABASE_PASSWORD`, `CORE_SMTP_HOST`, `CORE_SMTP_PORT`, `AUTH_PUBLIC_ORIGIN`, `AUTH_MAIL_FROM`, `AUTH_JWT_SECRET`을 설정해야 합니다. 기존 dev/prod Compose의 `postgres`·`mailpit` DNS는 이 CD에서 제공하지 않습니다. 필수값 누락·빈 값은 Compose 검증에서 실패하며, 이 값들과 `AUTH_COOKIE_SECURE`는 Core에만 전달합니다. JWT 키는 위와 같은 32바이트 이상 무작위 값의 Base64 인코딩을 사용합니다. `AUTH_PUBLIC_ORIGIN`은 실제 접근 origin에 맞추고, `AUTH_COOKIE_SECURE` 기본값은 `true`이며 승인된 로컬 HTTP 검증에서만 `false`로 설정합니다. 이 설정 연결은 외부 DB·메일 연결 검증이나 인터넷 운영 준비 완료를 뜻하지 않습니다.

### 실행·검증·실패 동작

[`compose.cd.yaml`](compose.cd.yaml)은 `build` 없는 독립 image Compose입니다. 기존 dev/prod Compose를 수정하거나 서버 compose/user 파일을 복사·덮어쓰지 않고 SSH stdin으로 전달합니다. 서버 소유 `.env`를 `--env-file`로 명시하고 프로젝트명은 `storyfork-develop-cd`로 고정합니다.

1. runner에서 Images source handoff·원본 CI/게시 attempt·현재 develop HEAD와 필수 입력을 검사한 뒤에만 tailnet에 참여합니다.
2. 서버에서 승인 marker·파일 권한·잠금·기존 자원 ownership을 확인합니다. 세 이미지 모두 **검증된 대상 SHA**의 `sha-<전체 SHA>`로 pull하고 OCI revision/source label을 확인합니다. 하나라도 실패하면 컨테이너 변경 전에 멈춥니다.
3. pull된 이미지의 해당 GHCR repository digest를 고정해 Compose에 전달합니다. 잠금 아래에서 원본 CI/게시 attempt/HEAD를 다시 확인한 뒤 `up --detach --no-build --pull never`만 실행합니다. 공용 CI gate 코드도 신뢰하는 checkout에서 SSH 명령으로 전달하며 artifact에서 실행 코드를 받지 않습니다. `down`, volume 삭제, orphan 제거는 없습니다.
4. 최대 180초 동안 실제 세 컨테이너의 running 상태·image ID·SHA label과 loopback의 web index, `/api/v1/health`, `/api/v1/health/ai-service`의 HTTP 200 및 service/status 본문을 확인합니다. runner의 마지막 HEAD 검사까지 성공해야 SHA/project/세 digest 증거를 출력합니다. `up -d`만으로 성공 처리하지 않습니다.

GitHub HEAD 검사와 Docker 갱신은 원자적이지 않습니다. 검사 직후 push·수동 취소·연결 종료·up/health 실패 시 이 **분리된 프로젝트 안에서** 일부 갱신이 남을 수 있습니다. 실패를 성공/fallback으로 숨기지 않고 자동 rollback·기존 스택 정리는 하지 않습니다. 운영자가 상태·권한·원인을 확인한 뒤 같은 현재 develop SHA의 성공 Images run ID로 Deploy만 재시도할 수 있습니다. Images 자체가 불완전하면 먼저 Images 전체를 다시 실행합니다. `Required CI`는 게시·배포 전에 끝나므로 그것만 녹색인 것은 CD 성공 증거가 아닙니다.

로컬 회귀(다운로드·daemon·서버 접속 없이):

```bash
python3 -I infrastructure/scripts/test-publish-preflight.py
python3 -I infrastructure/scripts/test-deploy-develop.py
```

CI의 infrastructure 경로 검사에 두 회귀를 포함합니다. 게시 회귀는 loopback HTTP 서버만 사용하며 실제 GitHub/GHCR에 접근하지 않습니다. 배포 회귀는 main 문맥의 자동 Images → develop 대상, 명시적 수동 run 재사용, 경로 필터 일부 생략, 비신뢰 이벤트/원본/잘못된 SHA, 누락·skipped·실패·취소된 게시/이전 attempt, 비정상 artifact·API 실패, 각 pull 실패, 외부 프로젝트 거절, SSH 실패와 strict 옵션, source/health 불일치 및 Compose 비밀값 경계를 검사합니다. 소스 wiring 검사는 실제 호스팅 성공 증거가 아니며 Tailscale/GHCR/SSH·서버 runtime 검증을 대신하지 않습니다. 브라우저 사용자 흐름 변경은 없어 Aside E2E를 제외하고 서버 smoke는 별도 승인 전까지 미실행입니다. 최신 커밋의 Required CI 및 활성화 후 Images/Deploy 실제 결과는 별도로 확인해야 합니다.
