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

테스트와 이미지 게시를 두 독립 워크플로로 분리합니다. 서버 배포·SSH·원격 인프라는 포함하지 않습니다.

1. [CI](../.github/workflows/ci.yml)는 `develop`·`main` 푸시와 PR에서 변경 경로별 테스트·lint·애플리케이션 빌드 및 `Required CI`를 수행합니다. Docker 이미지를 빌드·게시하지 않습니다. 수동 `Run workflow`는 선택한 ref를 checkout하고 변경 경로가 없어도 네 서비스 검증 job을 모두 실행합니다.
2. [Images](../.github/workflows/publish-images.yml)는 `develop`·`main`의 CI가 **완료된 다음**, 같은 저장소의 `push` 또는 `workflow_dispatch` CI가 성공한 경우에만 자동으로 이어집니다. PR·fork·실패·취소된 CI는 게시하지 않습니다. 테스트를 재실행하지 않고, API 증거 확인 → 이미지 빌드 → 익명 접근 검사 → 현재 HEAD 확인 → 태그 push 순서로 진행합니다. 세 이미지의 matrix job은 병렬입니다.

`Images`의 수동 `Run workflow`에서 `develop` 또는 `main`을 선택하면 해당 HEAD의 기존 성공 CI를 찾아 이미지 게시만 재시도합니다. 별도 SHA 입력은 받지 않습니다. 증거가 없으면 먼저 `CI`를 해당 브랜치에서 수동 실행합니다. 그 CI가 성공하면 Images도 자동으로 시작되므로 일반적으로 Images를 추가로 실행할 필요는 없습니다.

**활성화 전제:** `workflow_run`과 수동 실행 버튼은 워크플로가 기본 브랜치 `main`에 있어야 동작합니다. 이 변경의 기준 상태에서는 Workflow API에 CI만 등록되어 있고 `main`에는 `ci.yml`이 없습니다. 두 워크플로와 gate 스크립트를 `main`에 통합하기 전까지 로컬 분리만으로 활성화됐다고 볼 수 없습니다. 실제 호스팅 CI·GHCR 게시는 별도 승인과 원격 검증이 필요합니다.

두 실행 경로 모두 읽기 전용 gate에서 기본 브랜치의 신뢰하는 스크립트를 먼저 실행합니다. GitHub Actions API로 정확한 CI workflow 경로·ID·실행 ID·attempt·완료/성공 상태·원래 이벤트·저장소·브랜치·SHA와 해당 attempt의 `Required CI` job 성공을 확인합니다. 전체 workflow 성공만으로 허용하지 않으며 API/네트워크 실패·잘못된 응답·증거 부재·HEAD 불일치는 게시를 중단합니다. PR/fork artifact나 cache는 가져오지 않습니다.

`workflow_run`의 `GITHUB_SHA`·`GITHUB_REF`는 대상 CI가 아니라 기본 브랜치를 가리킵니다. 따라서 gate가 검증한 SHA·브랜치 출력만 대상 checkout, revision label, 태그와 HEAD 검사에 사용합니다. `packages: write`는 gate 이후 게시 job에만 부여합니다. 자동·수동 Images는 같은 `images-<대상 브랜치>` concurrency group으로 직렬화하고 진행 중 실행은 취소하지 않습니다. GitHub concurrency는 FIFO 대기열이 아니며 새 실행이 기존 pending 실행을 대체할 수 있습니다.

게시 대상은 다음 세 이미지이며 `linux/amd64`로 빌드합니다.

- `ghcr.io/sknetworks-family-aicamp/storyfork-web`
- `ghcr.io/sknetworks-family-aicamp/storyfork-core-api`
- `ghcr.io/sknetworks-family-aicamp/storyfork-ai-service`

태그는 검증한 브랜치 이름(`develop`·`main`)과 `sha-<전체 커밋 SHA>`입니다. 비공개 이미지를 pull하려면 해당 패키지에 접근 권한이 있는 GitHub 계정과 패키지 읽기 권한이 있는 인증으로 `docker login ghcr.io`를 먼저 실행합니다.
각 이미지 push 직전 익명 토큰 요청에서 단일 오류 코드가 상태와 일치하는 `401 UNAUTHORIZED` 또는 `403 DENIED`만 허용합니다. `401 UNAUTHORIZED`는 인증이 필요하다는 응답일 뿐 패키지의 비공개를 보장하지 않으며, `403 DENIED`는 비공개와 패키지 부재를 구분하지 못합니다. 최초 패키지는 비공개로 생성된다는 GitHub 정책을 전제합니다. 검사와 게시 사이 공개 설정이 바뀌는 경쟁 가능성도 있으므로 비공개를 보장하는 원자적 검사는 아닙니다. 이미지별 게시가 독립적으로 실패할 수 있어 일부만 게시될 수 있으며 Actions의 각 job 결과를 확인해야 합니다.

각 서비스는 게시 직전 GitHub API에서 현재 대상 브랜치 HEAD를 다시 읽고 검증한 SHA와 다르거나 조회가 실패하면 게시를 중단합니다. 조회와 두 태그 push 사이에도 브랜치가 바뀔 수 있어 이 검사는 원자적이지 않으며 오래된 태그 게시를 완전히 막지 못합니다. matrix 작업은 독립적이므로 실패·취소 또는 브랜치 변경 시 SHA 태그와 브랜치 태그가 서비스별로 서로 다른 상태가 될 수 있습니다.

복구할 때 Actions의 각 서비스 결과와 GHCR의 세 패키지 태그 및 digest를 확인하고, 현재 HEAD에 성공 CI 증거가 있으면 `Images`만 수동 실행하거나 같은 HEAD의 기존 Images 실행을 재실행합니다. 과거 실행의 SHA가 현재 HEAD와 다르면 gate 또는 push 직전 검사에서 중단됩니다. 완료 후에도 세 서비스의 브랜치 태그와 해당 SHA 태그 digest를 다시 비교합니다.

로컬 회귀 검사는 Python 표준 라이브러리와 loopback HTTP 서버만 사용하며 실제 GitHub/GHCR에 접근하거나 이미지를 빌드·게시하지 않습니다. CI의 infrastructure job에서도 실행합니다.

```bash
python3 -I infrastructure/scripts/test-publish-preflight.py
```
