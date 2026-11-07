# STORYFORK 개발·실행·검증 안내

[메인 README](../README.md) · [문서 목록](README.md)

> 루트 [README](../README.md)에서 옮긴 실행·배포 설정·검증 상세입니다. 제품 소개·아키텍처 요약은 README를, 구현 규칙은 [AGENTS.md](../AGENTS.md)를 따릅니다.

## 빠른 시작

Docker daemon과 Compose v2.24.4 이상(`include`·CI의 `!override` 지원)이 필요합니다.
`cp -n .env.example .env`로 루트 설정을 준비하고 빈 DB 자격증명·JWT 키를 직접 설정합니다.
`AUTH_PUBLIC_ORIGIN`은 실제 web 주소(기본 `http://127.0.0.1:5173`)와 맞춥니다.
실제 `.env`가 이미 있으면 덮어쓰지 마세요. 예시 파일에는 기본 DB 비밀번호·JWT 서명 키가 없으므로 그대로는 기동할 수 없습니다.

```bash
# 저장소 루트: .env 자동 로드, 로컬 소스에서 runtime 이미지 빌드
docker compose up -d --build
# http://127.0.0.1:5173
# 이 로컬 프로젝트만 종료하며 DB volume은 보존
docker compose down
```

루트 [`compose.yaml`](../compose.yaml)이 공통 base와 [`docker-compose.local.yaml`](../infrastructure/docker-compose.local.yaml)을
native `include`로 재사용합니다. `storyfork-local` 프로젝트의 새 `storyfork-local_core-postgres` volume과 PostgreSQL·Mailpit,
소스 빌드한 네 앱(web·Core·Content·AI)을 선택하며 과거 `storyfork-dev`·배포 DB/volume을 재사용하지 않습니다.
기존 `COMPOSE_FILE`·`COMPOSE_PROJECT_NAME` override가 있으면 먼저 확인해 다른 프로젝트를 가리키지 않게 하세요.
콘텐츠는 기본 비활성이며 `CONTENT_ENABLED=true`, Core/Content의 별도 `CONTENT_CORE_AUTH_TOKEN`, 생성 시 Content/AI의 `INTERNAL_TOKEN`이 필요합니다([콘텐츠 설정](content-integration.md#인증과-실행)). **새 Content 이력은 개발용 fresh 전용**이며 기존 history에 바로 배포하지 않습니다. 정확한 대상·보존/복구 범위 승인 전 실제 DB/volume을 지우지 않습니다.
WorldStudio 현재 관계는 별도 `APP_WORLDSTUDIO_ENABLED=true`와 승인된 SQL 적용·Neo4j 연결이 필요합니다. 소스 빌드 검증 overlay의 선택 `worldstudio` profile과 Content 전용 `NEO4J_*` 설정은 [현재 관계 계약](design/worldstudio-independent-schema.md#현재-관계-mvp-계약--132)을 따릅니다. 기존 관계 자동 변환이나 실제 DB 적용/기동은 이 문서로 승인되지 않습니다.
Health 확인에는 `OPENAI_API_KEY`가 필요하지 않습니다.

| loopback 주소 | 용도 |
|---|---|
| `http://127.0.0.1:5173` | nginx 정적 STORYFORK 화면·동일 origin `/api` |
| `http://127.0.0.1:5173/api/v1/health` | nginx를 거친 Core Health |
| `http://127.0.0.1:5173/api/v1/health/ai-service` | Core를 거친 AI Health |
| `http://127.0.0.1:8080` / `http://127.0.0.1:8081` | 로컬 Core / Content 직접 접근 |
| `127.0.0.1:5432` / `127.0.0.1:1025` | 로컬 PostgreSQL / Mailpit SMTP |
| `http://127.0.0.1:8025` | 로컬 Mailpit 메일 확인 |

포트는 `DEV_WEB_PORT`·`CORE_API_PORT`·`CONTENT_SERVICE_PORT`·`CORE_DATABASE_PORT`·`CORE_MAILPIT_*_PORT`로 변경합니다.
기존 프로세스가 5173/8080 등을 사용 중이면 시작은 실패하므로 **기존 앱을 임의 중지하지 말고** 포트와 `AUTH_PUBLIC_ORIGIN`을 조정하세요.
CORS는 web 포트에서 계산하며 `APP_CORS_ALLOWED_ORIGIN`으로 단일 origin을 지정할 수 있습니다. AI는 내부 전용입니다.
키는 AI 런타임에만 전달하고 VITE/build ARG에는 넣지 않습니다. **소스 빌드는 HMR이 아닙니다.**
web은 nginx 정적 runtime이고 소스 mount가 없어 변경 후 다시 build해야 합니다. hot reload는 아래 네이티브 명령을 사용합니다.

### 개발·운영 배포 서버 — 게시 이미지

- base + `infrastructure/docker-compose.dev.yaml`: 기존 `storyfork-develop-cd` 프로젝트와 네 `:develop` 이미지,
  로컬과 같은 PostgreSQL·Mailpit 내부 컨테이너를 사용하되 프로젝트·DB volume은 로컬과 격리합니다. 앱의 소스 build·hot reload는 없습니다.
- base + `infrastructure/docker-compose.prod.yaml`: 별도 `storyfork-production` 프로젝트와 네 `:main` 이미지,
  사전에 준비한 외부 PostgreSQL·SMTP만 사용합니다. `PROD_*` 필수값이 없으면 설정 검사부터 실패하고,
  로컬 자격증명·DB·Mailpit을 재사용하지 않으며 Secure 쿠키를 강제합니다.

**현재 게시 workflow는 develop 전용이며 `:main` 게시·접근 가능 여부는 미확인입니다.** 이 변경은 main 이미지 게시나 운영 배포 trigger를 추가하지 않습니다.
기본 Auth V4의 공개 비밀번호 샘플 계정은 운영 위험으로 남아 있으며 이 작업에서 migration을 수정하지 않았습니다.
이미지 게시·샘플 계정 조치·DB 이력/복구 승인·HTTPS ingress·운영 수용 검증 전에는 운영 배포 준비 완료가 아닙니다.
dev의 기존 외부 DB에서 내부 fresh DB로의 전환·데이터 이관도 실행하지 않았습니다. 별도 `DEVELOP_INTERNAL_DB_APPROVED` 승인 없이는 기존 CD가 새 내부 DB로 전환되지 않습니다.
서버별 변수의 주석 예시와 전환 경계는 [인프라 안내](../infrastructure/README.md)를 따릅니다.

### 네이티브 실행

Frontend는 Node 24·pnpm 11.22, Core는 JDK 21, AI는 Python 3.11 이상 3.15 미만과 uv를 사용합니다.
각 서비스 [Frontend](../frontend/README.md), [Core](../backend/core-api/README.md),
[Content](../backend/content-service/README.md), [Operations](../backend/operations-service/README.md),
[AI](../backend/ai-service/README.md) README의 실행 명령을 따릅니다.
환경설정은 루트 `.env` 한 곳에서 관리합니다. `cp -n .env.example .env`로 준비하고 기존 파일은 덮어쓰지 않습니다.
서비스별 `.env`는 만들지 않습니다. 기본 실행은 위의 Compose를 사용합니다.
네이티브 개발은 각 서비스에 필요한 환경변수만 해당 터미널에 설정한 뒤 기본 명령을 실행합니다.

```bash
(cd frontend && pnpm dev)
(cd backend/core-api && ./gradlew bootRun)
(cd backend/content-service && ./gradlew bootRun)
(cd backend/operations-service && ./gradlew bootRun)
(cd backend/ai-service && uv run --locked uvicorn app.main:create_app --factory --reload --port 8000)
```

이 명령들은 루트 `.env`를 자동으로 읽지 않습니다. 자동 설정 전달이 필요하면 Compose를 사용하며, Compose 자동 전달은 Operations에는 적용되지 않습니다.
루트 `.env` 전체를 source하지 말고 OpenAI 키는 AI에만, Auth/JWT/SMTP는 Core에만, Content DB·S3/생성은 Content에만 전달합니다. 기존 같은 DB 대상·계정을 사용하며 별도 서비스 자격만 Core/Content가 공유합니다. Operations DB 자격은 Operations에만, 별도 `OPERATIONS_SERVICE_TOKEN`은 Operations와 신뢰하는 호출 서버에만 주입하며 Core/Content 토큰과 재사용하거나 브라우저에 전달하지 않습니다.
기존 서비스별 `.env.local` 등이 있으면 Vite가 별도로 읽을 수 있으므로 필요한 값을 루트로 수동 통합하세요.
네이티브 Core의 AI 기본 주소는 `http://127.0.0.1:8000`, Compose는 `http://ai-service:8000`을 고정 사용합니다.

[Content](../backend/content-service/README.md)는 loopback 8081의 실제 업무 앱이며 콘텐츠/Studio 모두 비활성일 때 DB 없이 시작하도록 구성했습니다. 활성화에는 DB·Core 인증 설정이 필요합니다. [운영](../backend/operations-service/README.md)은 loopback 8082의 독립 CRUD이며 PostgreSQL 연결과 operations schema 초기화 권한이 필요합니다. 기본 빈 서비스 토큰으로는 보호 접근을 허용하지 않으며 Compose·nginx/Vite에 연결하지 않았습니다. Content의 Compose·nginx/Vite·공개 API 연결 소스와 실제 앱/DB/배포 검증은 구분합니다.

## 검증

### 로컬 개발: 변경·영향 범위의 단위 테스트만

TDD의 Red → Green → Refactor를 선택 단위 테스트로 진행합니다. DB·API·화면 변경도 관련 순수 단위 회귀를 먼저 작성하며,
통합·시스템·브라우저 E2E·전체 suite·빌드는 로컬 개발 완료 조건으로 실행하지 않습니다. 앱·DB·컨테이너를 검증용으로 띄우지 않습니다.
설정 구문·계약 검사와 `docker compose config --quiet`는 허용하며 문서는 내용·로컬 링크·`git diff --check`를 확인합니다.

```bash
# 루트: CI 선택/실행 계약의 작은 stdlib 단위 회귀 (앱·DB 실행 없음)
python3 -m unittest infrastructure.ci.test_ci.SelectionTest infrastructure.ci.test_content_extraction.ContentExtractionTest -v
# 각 서비스 디렉터리에서 변경한 단위 테스트를 지정하는 예
pnpm exec vitest run src/domain/__tests__/LibraryUseCase.test.ts
./gradlew unitTest --tests 'ai.storyfork.core.auth.AuthSecurityConfigTest' --no-daemon
uv run --locked --extra dev python -m pytest -m 'not integration' tests/test_generation.py -k missing_key
```

자세한 선택 명령은 [Frontend 지침](../frontend/AGENTS.md#검증), [Core 지침](../backend/core-api/AGENTS.md#검증),
[AI 지침](../backend/ai-service/AGENTS.md#변경-범위와-검증)을 따릅니다. 단위 통과가 CI 통합·시스템 검증을 대신하지 않습니다.
Aside는 별도 요청·승인 시에만 사용하며 HTTP 시스템 테스트를 브라우저 E2E로 보고하지 않습니다.

### CI: 선택 → 단위·통합 병렬 → 선택 HTTP 시스템 → Required CI

[`ci.yml`](../.github/workflows/ci.yml)이 Vitest·Gradle·pytest를 직접 호출하고 환경 기동·readiness·항상 정리를 소유합니다.
[`infrastructure/ci/ci.py`](../infrastructure/ci/ci.py)는 보수적인 변경 선택·결과 집계·로그 정제만 담당하며 공통 runner나 shell wrapper는 없습니다.
JUnit/Vitest/pytest 단위·통합 테스트는 서비스 디렉터리에, pytest 시스템 테스트는 [`infrastructure/system/test_http.py`](../infrastructure/system/test_http.py)에 둡니다.
새 테스트 프레임워크·production 의존성은 추가하지 않습니다.

| 계층 | 현재 실행 범위 |
|---|---|
| 선택·정적 검사·단위 | 변경 diff 공백·선택기 회귀, 선택 web lint/build, AI lock. web Domain/Data/HTML, Core/Content/Operations `unitTest`(Spring·HTTP·DB 제외), AI `-m 'not integration'` |
| 통합 | 나머지 web React/Hook/App, Core/Content/Operations `integrationTest`(Spring·HTTP·PostgreSQL/Flyway), AI `-m integration`(FastAPI TestClient) |
| 시스템 | CI 전용 Compose 앱·임시 PostgreSQL·Mailpit을 기동한 뒤 `pytest infrastructure/system -k ...`로 선택된 실제 HTTP 시나리오 실행 |
| 집계 | `Required CI`: 실패·취소·필요한 tier의 예상 밖 skip은 실패, 영향 없는 작업의 의도적 skip만 허용 |

변경 선택 후 단위·통합 서비스 행렬과 설정 검사는 서로 독립적으로 병렬 실행합니다. 시스템은 필요한 단위·통합·설정 검사가 성공한 뒤 실행하며, 실패·취소 시 생략합니다. 단위/통합 범위는 서로 제외해 중복 실행하지 않습니다.
Core/Content/Operations의 혼합 경계 클래스는 통합에 두며 Kotlin/Java의 Spring/HTTP/DB 분류 누락을 회귀로 검사합니다.
Core 통합은 임시 PostgreSQL·Mailpit의 Auth/내부 보안을, Content 통합은 `TEST_CONTENT_DATABASE_URL`의 fresh 초기화·이력·JPA/Studio·HTTP proxy를 확인합니다. #132는 Content 통합 job에만 격리 Neo4j를 추가해 현재 관계 CRUD·재시도·부분 실패·권한·재조회와 카드 history의 not_recorded를 검증하도록 구성했습니다. Studio HTTP 통합의 Core 인증은 대역이며 실제 Core 로그인/nginx Studio 시스템 시나리오·hosted 실행 결과는 별도 대기입니다. Operations 통합은 job별 임시 PostgreSQL의 `TEST_OPERATIONS_DATABASE_URL/USER/PASSWORD`와 서비스 토큰/독립 CRUD·Flyway·JPA를 확인하도록 구성합니다. `content_test`/빈 비밀번호는 격리 runner trust 인증 전용입니다. 실제 S3 lifecycle은 fixture 부재로 조건부 skip이며 통과로 표현하지 않습니다.

#### 변경·영향 선택

- PR: base와 실제 head의 **merge-base**부터 비교. push: event의 **before SHA**부터 비교.
  수동 CI 실행·기준선 부재(새 브랜치/기준 커밋 없음)는 명시적으로 전체 서비스·시나리오를 실행합니다.
  이때 공백 검사는 첫 부모와 비교하며, 부모가 없는 최초 커밋만 빈 트리와 비교합니다.
- web·Content·Operations·AI는 서비스 수준, Core는 auth/health 또는 보수적 전체로 선택합니다. Operations 변경은 독립 단위·통합을 함께 선택하고 다른 서비스나 HTTP 시스템 시나리오를 추가하지 않습니다. 시스템 `content`는 실제 Core 로그인 뒤 Content API·DB 소유권을 확인합니다.
- 공유·설정·의존성·미등록 runtime은 확대 선택합니다. Core Auth는 Content/web 소비자, Content/AI 계약은 연결된 소비자와 시스템을 선택합니다. 삭제된 구 Core 콘텐츠 경로도 새 소유 서비스 회귀를 선택합니다.
- 삭제·이름 변경은 `git diff --no-renames`로 이전 경로까지 포함합니다. 정확한 소스별 의존 그래프 분석은 아닙니다.
  테스트만 변경하면 해당 서비스/기능 회귀만 실행하고 시스템은 생략합니다. 문서만 변경하면 runtime job은 생략합니다.
  영향받는 runtime 범위에서 테스트가 하나도 발견되지 않으면 성공으로 숨기지 않습니다.

#### HTTP 시스템 시나리오와 경계

`health`: web 정적 응답과 nginx → Core → AI Health.
`auth`: CSRF 없는 변경 403, 가입 → Mailpit 메일 토큰 → 이메일 확인 → 잘못된 비밀번호 401 → 로그인·프로필·DB 회원 저장.
`content`: 실제 로그인 UUID로 Content 작품 생성 → 회차 저장 → stale 409 → DB 원고/소유권·미인증 401, Core 중단 시 Content 503 및 복구. Content jar의 독립 Studio migration도 확인합니다.
`ai`: auth/content를 재사용하고 실제 Content → AI HTTP의 제공사 설정 누락 503, 원고 불변·실패 job·성공 제안 없음.
선택된 시나리오의 준비 흐름은 한 번만 실행합니다. 실제 모델 성공·과금·브라우저 입력/클릭은 검증하지 않습니다.

[`compose.test.yaml`](../infrastructure/ci/compose.test.yaml)은 base+local 소스 빌드 뒤에서 CI 포트를 loopback 임의 포트로 제한하고,
DB를 tmpfs로 바꾸며 AI 키·모델은 빈 값으로 고정합니다. 서비스 단위 제공사 테스트는 monkeypatch 대역을 사용하고 시스템은 명시적인 503만 확인하므로 유료 호출이 없습니다.
실행별 `storyfork-ci-<run>-<attempt>` 프로젝트만 항상 정리하며 배포 volume·실제 `.env`·외부 DB·실제 SMTP·서버 배포는 건드리지 않습니다.
실패 시 테스트 결과·컨테이너 로그를 토큰·이메일 등으로부터 정제하여 7일 보관합니다.

로컬 선택 단위 결과와 hosted runtime 결과를 구분합니다. **최신 커밋의 GitHub `Required CI` 실제 성공을 확인하기 전에는 검증 대기**입니다.
CI 이후 단일 CD의 게시 → 배포 흐름은 [인프라 안내](../infrastructure/README.md#ci--cd-publish--deploy)를 참고하세요.

## 에이전트 훅·스킬

[`.agent-hooks/guard.py`](../.agent-hooks/guard.py) 하나를 Claude Code·Codex·Hermes가 함께 사용합니다(Python 3 stdlib, 의존성 없음).

| 시점 | 동작 |
|---|---|
| 세션 시작 | ponytail 권장과 graphify 사용 안내(graphify·`graphify-out/graph.json`이 있을 때만) 주입 |
| 셸 실행 전 | 브랜치·커밋 형식 위반, 실제 `.env`의 `git add`는 차단. `main`·`develop` 직접 푸시와 `gh pr merge`는 사용자 확인(Codex는 확인 기능이 없어 차단) |
| 첫 검색 | graphify가 준비돼 있으면 세션의 첫 grep·검색을 한 번 막고 `graphify query`를 먼저 쓰게 함 |
| 작업 종료 | 코드 변경마다 한 번 TDD·단위 테스트·아키텍처/docs 점검과 권장 리뷰를 요청하고 `graphify update .`를 백그라운드로 실행 |

- **Claude Code**: [`.claude/settings.json`](../.claude/settings.json)이 자동 적용됩니다. 스킬은 `.claude/skills`(→ `.agents/skills`)입니다.
- **Codex**: [`.codex/hooks.json`](../.codex/hooks.json)은 프로젝트를 신뢰하고 `/hooks`에서 훅을 승인해야 실행됩니다. 스킬은 `.agents/skills`를 읽습니다.
- **Hermes**: 저장소 훅을 자동으로 읽지 않으므로 각자 `~/.hermes/config.yaml`에 등록하고 첫 실행 때 동의합니다.
  훅은 Hermes **프로세스의 시작 디렉터리**로 저장소를 판별하므로 저장소(또는 worktree) 안에서 Hermes를 실행해야 합니다.
  다른 곳에서 시작한 세션·gateway는 터미널 작업 디렉터리만 저장소로 옮겨도 훅이 동작하지 않습니다.

```yaml
hooks:
  pre_llm_call:
    - command: "python3 '/절대경로/SKN34-FINAL-4TEAM/.agent-hooks/guard.py' hermes"
  pre_tool_call:
    - matcher: "terminal|search_files"
      command: "python3 '/절대경로/SKN34-FINAL-4TEAM/.agent-hooks/guard.py' hermes"
  pre_verify:
    - command: "python3 '/절대경로/SKN34-FINAL-4TEAM/.agent-hooks/guard.py' hermes"
skills:
  external_dirs:
    - /절대경로/SKN34-FINAL-4TEAM/.agents/skills
```

저장소 밖에서는 훅이 아무것도 하지 않습니다. 저장소에 포함한 스킬은 `ponytail`·`ponytail-review`(MIT, v4.10.0 사본)뿐이며 자동 갱신되지 않습니다.
훅 회귀 테스트는 `python3 -m unittest discover -s .agent-hooks -v`로 로컬에서 실행하며, 이 경로들은 CI runtime 선택에서 제외됩니다.

## 코드 네임스페이스

Kotlin namespace는 `ai.storyfork.core`, Gradle group은 `ai.storyfork`입니다.
`backend/core-api/src/{main,test}/kotlin/ai/storyfork/core/`가 package 선언과 일치합니다.
업무 기능은 상세 계약과 권한·정책을 확정한 뒤 필요한 범위만 추가합니다.
