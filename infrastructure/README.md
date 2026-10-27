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
python3 infrastructure/scripts/test-run-native.py
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
