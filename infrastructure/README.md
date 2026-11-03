# STORYFORK Docker 실행 기반

화면 데모와 Core·AI Health, 이메일 가입·인증, 로그인·세션, 비밀번호 복구·프로필 API를 제공합니다. 공통 구성의 `CONTENT_ENABLED`는 기본 `false`이며, 명시적으로 켜면 Auth와 같은 PostgreSQL·자격증명을 사용해 콘텐츠 저장을 활성화합니다. 별도 콘텐츠 overlay는 없습니다. [콘텐츠 실행·인증 안내](../docs/content-integration.md)를 참고하세요. 실제 약관·동의와 회원 탈퇴는 미구현이며 운영 가입용이 아닙니다.

[`docker-compose.yaml`](docker-compose.yaml)은 세 앱의 공통 환경·내부 포트만 정의하는 base입니다. 이미지·빌드 선택이 없으므로 **단독 실행하지 않고** 아래 파일 중 하나와 순서대로 병합합니다.

| 항목 | base + [`docker-compose.prod.yaml`](docker-compose.prod.yaml) | base + [`docker-compose.dev.yaml`](docker-compose.dev.yaml) |
|---|---|---|
| 용도 | 소스에서 빌드한 배포 이미지 로컬 검증 | 현재 개발 배포 서버의 CI 게시 이미지 실행 |
| 프로젝트 | `storyfork-prod-validation` | `storyfork-develop-cd` |
| 앱 | web·Core·AI 소스 build, web은 nginx 정적 runtime | 세 앱의 `:develop` 이미지 pull, `linux/amd64`, build·소스 mount 없음 |
| DB·SMTP | 기존 `core-postgres` volume의 PostgreSQL + Mailpit | 기존 외부 PostgreSQL·SMTP, 새 DB·volume 생성 없음 |
| 브라우저 진입점 | `127.0.0.1:${WEB_PORT:-8088}` | `127.0.0.1:${CD_WEB_PORT}` |
| Core·AI 호스트 공개 | 없음 | 없음 |

이름이 `prod`여도 인터넷 운영 준비를 뜻하지 않습니다. 두 조합 모두 loopback 검증용이며 운영 TLS·ingress는 별도입니다.
기존 소스/HMR용 Compose 경로는 제거했습니다. hot reload는 아래 네이티브 개발 명령을 사용합니다.

```text
Browser → web nginx (정적 파일)
        → /api → core-api:8080 → ai-service:8000
```

브라우저는 공개 Core API만 사용하고 AI 내부 DNS를 직접 호출하지 않습니다.
API 404는 SPA HTML로 바꾸지 않으며 알 수 없는 UI deep link만 홈 화면으로 이동합니다.

## 시작과 설정

루트 `.env`에 개발용 `CORE_DATABASE_USER`, `CORE_DATABASE_PASSWORD`와 32바이트 이상 무작위 값의 Base64 인코딩인 `AUTH_JWT_SECRET`을 직접 설정하고, `AUTH_PUBLIC_ORIGIN`을 실제 web origin으로 지정합니다(prod 기본 `http://127.0.0.1:8088`, dev는 지정한 `CD_WEB_PORT`). JWT 키는 Core에만 전달하며 저장소에 커밋하지 않습니다. 로컬 HTTP 검증에서만 `AUTH_COOKIE_SECURE=false`로 설정하고 HTTPS 운영에서는 `true`를 사용합니다. 기존 `.env`는 덮어쓰지 않습니다. prod의 Mailpit 화면은 기본 `http://127.0.0.1:8025`이며 인증 메일을 포함하므로 로컬에서만 사용합니다. dev는 외부 SMTP를 사용합니다.

SMTP는 가입 인증·비밀번호 복구·이메일 변경 메일에 사용합니다. 가입 인증 링크는 24시간, 비밀번호 재설정·이메일 변경 링크는 1시간 유효합니다. 가입 인증은 토큰과 가입 시 정한 비밀번호를 함께 요구하고, 이메일 변경 확인은 토큰만 사용합니다. 프로필 조회·닉네임 변경·이메일 변경 요청 및 복구 API의 실제 경로는 [Core API 계약](../backend/core-api/README.md#공개-계약)을 참고합니다.

저장소 루트에서 배포 이미지 로컬 검증:

```bash
docker compose --env-file .env --file infrastructure/docker-compose.yaml --file infrastructure/docker-compose.prod.yaml up --build -d
# http://127.0.0.1:8088
docker compose --env-file .env --file infrastructure/docker-compose.yaml --file infrastructure/docker-compose.prod.yaml down
```

개발 배포는 아래 단일 CD 워크플로의 deploy job을 사용합니다. 수동으로 같은 구성을 사용할 때도 기존 배포 디렉터리·외부 DB·SMTP를 그대로 사용합니다. `CD_DIRECTORY`·`CD_WEB_PORT`는 승인된 서버 값으로 export하고, 저장소 루트에서 두 파일을 지정합니다.

```bash
docker compose --project-directory "$CD_DIRECTORY" --env-file "$CD_DIRECTORY/.env" --file infrastructure/docker-compose.yaml --file infrastructure/docker-compose.dev.yaml pull
docker compose --project-directory "$CD_DIRECTORY" --env-file "$CD_DIRECTORY/.env" --file infrastructure/docker-compose.yaml --file infrastructure/docker-compose.dev.yaml up -d --no-build --pull never --wait
```

세 이미지 revision 일치·프로젝트 경계 검사는 CD의 deploy job이 수행합니다. 위 수동 명령 자체가 그 검사를 대신하지는 않습니다.

개인 설정은 `cp -n .env.example .env` 후 `--env-file .env`로 사용하고 기존 파일을 덮어쓰지 않습니다.
개발 종료 시 의존성 volume은 보존됩니다.

| 변수 | 기본값 | 소비 경계 |
|---|---|---|
| `OPENAI_API_KEY` | 빈 값 | AI 런타임만, 생성 요청에 필요 |
| `OPENAI_MODEL` | prod 빈 값 / dev `gpt-5.6-luna`(기존 CD 기본값 유지) | AI 런타임만, 팀 모델 선정·접근 검증을 뜻하지 않음 |
| `AI_SERVICE_CONNECT_TIMEOUT` | `1s` | Core → AI 연결 |
| `AI_SERVICE_READ_TIMEOUT` | `12s` | Core → AI Health 읽기 |
| `AI_GENERATION_READ_TIMEOUT` | `75s` | Core → AI 생성 읽기 |
| `WEB_PORT` | `8088` | prod loopback 포트 |
| `CD_DIRECTORY` / `CD_WEB_PORT` | 필수 | dev 기존 배포 디렉터리 label / loopback 포트 |
| `CONTENT_ENABLED` | `false` | Core 콘텐츠 opt-in |
| `CONTENT_DATABASE_*` | Compose에서는 Auth DB·자격증명과 동일하게 전달 | Core만, 별도 DB로 분리하지 않음 |
| `INTERNAL_TOKEN` | 빈 값 | Core·AI만; 콘텐츠 활성화 시 동일한 실제 토큰 설정 필수 |
| `APP_CORS_ALLOWED_ORIGIN` | 빈 값이면 해당 web 포트로 계산 | Core의 단일 허용 origin |

Health는 OpenAI 인증·모델 접근을 검사하지 않으며 클라이언트를 만들지 않습니다.
콘텐츠 기능과 내부 인증을 구성하고 키·모델을 명시하면 생성 API를 사용할 수 있습니다. 모델 또는 키 누락 시 503으로 실패합니다. 키는 Frontend·Core·build ARG에 전달하지 않습니다.

루트 `.env` 한 곳에서 설정을 관리합니다. Compose에는 `--env-file .env`를 명시하고 전체 파일을 서비스에 주입하지 않습니다.
네이티브 기본 웹 주소는 `http://localhost:5173`입니다. `VITE_DEV_SERVER_HOST`를 변경하면 `APP_CORS_ALLOWED_ORIGIN`도 실제 웹 origin에 맞추세요. 생성 timeout을 늘릴 때는 브라우저 요청 한도(80초)와 Nginx 프록시 읽기 한도(90초)도 함께 검토하세요.

네이티브 개발은 각 서비스의 `pnpm dev`, `./gradlew bootRun`, `uv run --locked uvicorn app.main:create_app --factory --reload --port 8000`을 직접 사용합니다. 루트 `.env`는 자동으로 읽지 않으므로 필요한 변수만 해당 서비스 터미널에 설정합니다. 루트 `.env` 전체를 source하지 않습니다. 자동 설정 전달은 Compose를 사용합니다.
네이티브 Core의 AI 기본 주소는 `http://127.0.0.1:8000`, Compose는 `http://ai-service:8000`을 사용합니다.

## CI → CD (publish → deploy)

[CI](../.github/workflows/ci.yml)와 [CD](../.github/workflows/publish-images.yml) 두 워크플로를 사용합니다.
`publish-images.yml` 경로는 유지하고 표시 이름을 **CD**로 바꿨으며 별도 `deploy-develop.yml`은 제거했습니다.

- **CI:** 작은 변경 선택기로 범위를 정하고 Vitest·Gradle·pytest를 직접 호출해 단위 → 통합 → HTTP 시스템 검증 후 `Required CI`를 집계합니다.
- **CD 자동:** 같은 저장소 develop의 push 또는 수동 CI가 성공했을 때만 `publish`를 실행합니다.
  PR·fork·main의 CI·실패·취소 CI는 이미지 게시/배포 권한을 받지 않습니다.
- **CD 수동:** Actions의 **CD → Run workflow → develop**을 선택합니다. 입력은 없으며 CI 재실행/과거 증거 조회 없이
  해당 develop 커밋의 세 이미지를 빌드·게시한 뒤 배포로 이어집니다. main·다른 ref에서 수동 실행하면 publish/deploy를 생략합니다.
- **배포:** `deploy`는 `needs: publish`로 게시 성공에 종속되고 repository variable `DEVELOP_CD_ENABLED=true`일 때만 실행합니다.
  같은 `develop-cd` environment 승인과 Tailscale·SSH host key 검증을 거쳐 최신 `:develop` 이미지를 pull·실행합니다.
  배포 job은 CI·이미지 빌드·git pull을 다시 하지 않으며 게시 실패/취소 시 배포하지 않습니다.
- publish는 packages write만, deploy는 packages read·id-token write만 job별로 부여합니다.
  전체 CD 흐름은 `storyfork-develop-cd` concurrency로 직렬화하고 실행 중 취소하지 않습니다.

두 워크플로의 정의가 기본 브랜치 main에 있어야 자동 연결됩니다. `workflow_run` CD의 환경 ref는 기본 브랜치(main),
수동 CD의 ref는 develop입니다. **`develop-cd` environment의 allowed deployment branches에 main과 develop을 모두 허용**하고
필요한 승인 정책을 유지해야 두 경로가 동작합니다. main-only 정책을 그대로 두면 develop 수동 배포는 차단됩니다.
배포의 기존 main-only if를 제거한 대신 신뢰된 publish 성공/enable guard/environment로 제한합니다.
로컬 파일 변경만으로 GitHub 설정·환경 정책 변경이나 실제 게시·배포가 완료되지는 않습니다.

### 이미지

`linux/amd64`로 다음 세 이미지를 게시합니다.

- `ghcr.io/sknetworks-family-aicamp/storyfork-web`
- `ghcr.io/sknetworks-family-aicamp/storyfork-core-api`
- `ghcr.io/sknetworks-family-aicamp/storyfork-ai-service`

모든 `sha-<전체 SHA>` 이미지를 push한 뒤 `develop` 태그를 갱신합니다. 태그 갱신 중 실패하면 세 버전이 달라질 수 있으므로 deploy는 공통 revision만 확인하고 혼합 버전이면 중단합니다. CD를 다시 실행해 게시와 배포를 이어서 완료합니다. 같은 CD run의 배포만 실패했다면 그 실패 job을 재실행할 수도 있습니다. 별도 run ID·artifact·현재 소스 HEAD 일치 검사는 없습니다.

### 배포 설정

| 위치 | 이름 | 값 |
|---|---|---|
| Repository variable | `DEVELOP_CD_ENABLED` | 배포 허용 시 `true` |
| Environment | `develop-cd` | 자동 workflow_run의 main ref와 수동 develop ref 허용, 필요한 승인 정책 |
| Environment variable | `CD_DEPLOY_DIR` | 서버의 기존 전용 배포 디렉터리 절대 실경로 |
| Environment variable | `CD_WEB_PORT` | 충돌하지 않는 loopback 포트(1024–65535) |
| Environment secret | `CD_SSH_PRIVATE_KEY` | 서버에 승인된 전용 SSH 키 |
| Environment secret | `CD_SSH_KNOWN_HOSTS` | 신뢰 경로로 검증한 `[100.90.8.124]:5798` host key |
| Environment secret | `TS_OAUTH_CLIENT_ID` | Tailscale workload identity federation Client ID |
| Environment secret | `TS_AUDIENCE` | Tailscale federated identity audience |

대상은 `tgv99536@100.90.8.124:5798`입니다. Tailscale의 `tag:storyfork-cd`에서 이 서버 SSH 포트에 접근할 수 있어야 합니다. 서버에는 Bash·Docker·Compose v2(`up --wait` 지원)가 필요하며 Python·git·GitHub API 접근은 필요하지 않습니다. GHCR 패키지는 이 저장소 Actions의 읽기 권한을 허용해야 합니다. 패키지 공개 여부는 GHCR에서 관리합니다.

서버의 기존 `.env`와 배포 디렉터리를 미리 준비합니다. base + `docker-compose.dev.yaml`은 세 애플리케이션 이미지만 실행하므로 Core에서 접근 가능한 PostgreSQL·SMTP가 별도로 필요합니다. `.env`에는 `CORE_DATABASE_URL`, `CORE_DATABASE_USER`, `CORE_DATABASE_PASSWORD`, `CORE_SMTP_HOST`, `CORE_SMTP_PORT`, `AUTH_PUBLIC_ORIGIN`, `AUTH_MAIL_FROM`, `AUTH_JWT_SECRET`을 설정합니다. 콘텐츠를 켤 때는 `CONTENT_ENABLED=true`와 실제 `INTERNAL_TOKEN`도 설정합니다. 콘텐츠 DB는 같은 외부 Auth DB를 사용하며 개발 Principal은 주입하지 않습니다. OpenAI 설정은 AI에만 전달합니다. 별도 승인 marker·lock 파일은 필요하지 않습니다.

프로젝트명은 `storyfork-develop-cd`로 고정합니다. 다른 디렉터리가 사용하는 동명 프로젝트는 건드리지 않습니다. SSH host key를 검증하고 base와 dev 두 파일을 각각 SSH stdin으로 전달해 서버 임시 경로에 저장합니다. 서버에서 두 파일을 병합하며 기존 `.env`와 `--project-directory`를 명시합니다(runner에서 실제 설정을 미리 병합하지 않음). 인증 정보와 전달한 파일은 사용 후 정리하고 서버 `.env`·기존 데이터·Docker 전역 인증 설정은 덮어쓰지 않습니다.

login·pull 실패 시 `up`을 실행하지 않습니다. 실패는 원래 명령의 오류 그대로 표시하며 재시도·자동 rollback·`down`·prune·volume 삭제를 하지 않습니다. `up --wait`는 컨테이너 running/healthcheck 상태 확인이지 HTTP 사용자 흐름이나 외부 DB·SMTP 연결의 종합 검증은 아닙니다. 배포 후 문제가 있으면 해당 서비스 로그를 직접 확인합니다. web은 loopback에만 열며 인터넷 운영용 TLS·ingress는 별도 구성입니다.

## 설정 확인

```bash
docker compose --env-file .env --file infrastructure/docker-compose.yaml --file infrastructure/docker-compose.prod.yaml config --quiet
docker compose --env-file .env --file infrastructure/docker-compose.yaml --file infrastructure/docker-compose.dev.yaml config --quiet
```

위 명령은 구문 검사만 하고 컨테이너를 실행하지 않습니다. CI의 configuration job은 예시 설정과 CI dummy 값으로
base+prod·base+dev의 콘텐츠 false/true와 CI overlay를 검사합니다. 실제 HTTP/DB/SMTP는 별도 CI 통합·시스템 계층에서 확인하며 모델은 유료 호출하지 않습니다.

## 표준 테스트 프레임워크 직접 실행

로컬 개발 자동 검증은 변경·영향 범위의 **선택 단위 테스트만**입니다. 통합/시스템·전체 suite·빌드·앱/DB/컨테이너 기동은 로컬 완료 조건으로 실행하지 않습니다.
워크플로가 Vitest·Gradle·pytest를 직접 호출하고 최소 환경 기동·HTTP readiness·항상 정리를 소유합니다.
별도 `unit.sh`·`integration.sh`·`system.sh`나 공통 runner는 없습니다. JUnit/Vitest/pytest 단위·통합 테스트는 서비스 디렉터리에 유지합니다.

| 경로 | 역할 |
|---|---|
| [`ci/ci.py`](ci/ci.py) | `plan`: PR merge-base/push before/수동 전체 선택 및 diff 검사. `reports`/`required`: 정제/집계만 수행 |
| [`ci/test_ci.py`](ci/test_ci.py) | 선택·비교 기준·분류·직접 실행 계약·CD 보안 경계의 작은 stdlib 단위 회귀 |
| [`system/test_http.py`](system/test_http.py) | 기존 pytest fixture·httpx2로 실행된 CI Compose의 선택 HTTP 흐름과 DB 결과 검증 |
| [`ci/compose.test.yaml`](ci/compose.test.yaml) | base+prod 뒤에 병합하는 CI 전용 tmpfs DB/임의 loopback 포트/빈 AI key overlay |

```bash
# 저장소 루트: 로컬에서 허용하는 선택기 단위 테스트
python3 -m unittest discover -s infrastructure/ci -p 'test_*.py' -v
# 아래는 GitHub CI 호출 형식이며 로컬 개발 자동 실행 목록이 아닙니다.
# Core 서비스 디렉터리에서:
./gradlew integrationTest --no-daemon --tests 'ai.storyfork.core.auth.*'
# 루트에서, CI가 Compose와 HTTP_BASE_URL·MAILPIT_API_URL을 준비한 뒤:
uv run --locked --extra dev --project backend/ai-service python -m pytest infrastructure/system -k 'health or auth or content or ai'
```

CI는 Vitest 파일 필터, Gradle 기능 패키지 `--tests`, pytest marker/`-k`를 직접 지정하고 실패·빈 선택 종료 코드를 유지합니다.
web/AI는 보수적인 서비스 단위, Core는 auth/content/health 단위이며 공통·설정·미등록 runtime 경로는 전체로 확장합니다.
Core 공개 계약·Core-AI 변경은 소비 서비스와 시스템 시나리오도 선택합니다. 정확한 소스 의존 그래프는 아니며,
삭제·이름 변경도 이전 경로를 포함합니다. 문서만 변경하면 runtime 테스트를 생략합니다.

Core 통합 job은 격리 PostgreSQL `content_test`/빈 비밀번호(trust)와 Mailpit을 사용하고 기존 Flyway/Auth/Content 조건부 테스트를 활성화합니다.
시스템 job은 실행별 `storyfork-ci-<run>-<attempt>` 프로젝트에 base+prod+CI overlay로 앱을 소스 빌드·기동합니다.
HTTP 시나리오는 nginx/Core/AI Health, CSRF·가입 메일·확인·로그인·회원 저장, 작품·회차 저장·stale 409·미인증 401,
AI의 빈 제공사 설정 503·실패 job 저장·원고 불변을 확인합니다. auth/content 준비 흐름은 선택된 후속 시나리오 간 한 번만 실행합니다.
AI 성공/과금·브라우저 E2E는 이 범위가 아닙니다.

시스템 pytest fixture는 소유된 `storyfork-ci-숫자-숫자` 프로젝트와 loopback HTTP 주소만 허용합니다. CI는 성공/실패와 무관하게 그 프로젝트만 `down --volumes`하며
배포 프로젝트·기존 volume·실제 `.env`는 보존합니다. 실패 report/log는 이메일·JWT·토큰 등을 정제한 뒤 7일 artifact로 보관합니다.
로컬 단위 통과와 hosted 실행을 구분하며 최신 `Required CI`, CD 게시·배포 성공은 각각 실제 Actions 결과로만 확인합니다.
