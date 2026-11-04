# STORYFORK

> 원본 자료 안내: 이 문서가 참조하는 기획 PDF·요구사항/WBS 엑셀 중 일부는 현재 checkout에 없습니다. 파일명·과거 근거는 보존하되 링크를 현재 열 수 있다고 보장하지 않습니다. 읽을 수 있는 최신 기능·서비스 기준은 Markdown 요구사항 색인·유스케이스·DEC-41을 따릅니다.

**원작을 나만의 이야기로.**

다중 AI 에이전트 기반 **독자 참여형 스토리 창작 및 피드백 자동화 플랫폼**입니다.
작가는 세계관과 등장인물을 관리하며 AI와 함께 집필하고, 독자는 이용이 허용된 원작의 특정
회차에서 이야기를 분기(Fork)하여 독립적인 전개와 결말을 창작하는 것을 목표로 합니다.
AI는 창작 방향을 대신 확정하는 주체가 아니라, 사용자의 선택·집필·검토를 돕는 도구입니다.

기획 기준은 **「SKN34 4Team 프로젝트 기획서」 v1.4**이며, 최신 MVP 결정은 [결정 기록 DEC-26~40](docs/design/decisions.md#결정-목록)을 따릅니다. 충돌하는 과거 유스케이스 세부 정책은 현행 계약이 아닙니다.
[MVP 설계](docs/design/design.md): Frontend는 작가·독자 전체 화면, 목표 백엔드는 Core·콘텐츠·운영·AI의 4개 서비스입니다([DEC-41 구조](docs/design/service-boundaries.md)). 현재 실행 앱의 물리 분리는 미적용입니다. PostgreSQL은 설정·원고 원문 및 버전·체크포인트·Fork를, 그래프 DB는 관계 저장·조회를 담당합니다. 설정은 항목별 공개·비공개를 두고, 설정 이미지는 MinIO에 보관합니다. `pg_git`은 MVP에서 제외합니다. 그래프 DB 제품·동기화 및 AI 조회 경로는 미정입니다.

> **현재 개인 브랜치 구현:** 개발 기반에 `/content` 집필 작업실과 선택적 PostgreSQL 저장·AI 제안을 추가했습니다. 작품·원고·설정집·발행·Fork 범위와 인증 계약은 [콘텐츠 통합 안내](docs/content-integration.md)를 참고하세요.
> 나머지 아래 기능은 기획 목표입니다. 실제 로그인은 구현되어 있고 그래프 DB·크레딧·운영 업무는 미구현이며 검증 이력과 남은 범위는 [이슈 #50 대응](docs/issue-50-alignment.md)을 참고하며, Required CI는 최신 PR 커밋의 결과로 판단합니다.

## 사용자와 핵심 가치

| 사용자 | 지원하려는 경험 |
|---|---|
| 창작 의향이 있는 독자 | 허용된 원작에서 다른 선택과 사건을 탐색하고 독립 작품으로 완성 |
| 신입 작가 | 세계관·인물·줄거리 구상을 장면과 회차로 구체화 |
| 연재 작가 | 다른 플랫폼에서 연재한 기존 원고를 가져와 설정을 정리하고, 맥락을 유지하며 후속 회차 집필 및 피드백 검토 |

초기에는 창작 의향이 있는 독자와 신입 작가의 **짧은 장면·회차 집필 경험**을 중심으로
유용성을 검증합니다. 장편 연재 지원은 설정의 정확성과 검토 부담을 함께 확인하며 확장합니다.

## 핵심 기능 — 기획 목표

아래 기획서 범위에는 MVP 이후 기능과 최신 설계에서 바뀐 공개·저장 정책도 포함됩니다. [MVP 범위](docs/design/design.md#포함과-제외)를 우선하며, AI 실행은 모든 집필의 필수 절차가 아닙니다.

| 기능 | 기획 내용 |
|---|---|
| 작품·세계관 관리 | 세계관을 먼저 만들고 작품에 1~5개 연결, 기존 원고(.txt·.epub·에디터 입력, 이미지 포함)에서 설정 추출, 장소·시대·규칙·사건 관리. 공유 세계관과 작품별 변화는 구분 |
| 캐릭터·관계 관리 | 성격·목표·기억·능력·관계·감정과 특정 시점에 알고 있는 사실 관리 |
| 다중 인물 시뮬레이션 | 캐릭터별 AI가 허용된 기억·정보에 따라 행동하고, 스토리 계획 역할이 사건·환경을 조정하여 전개 탐색 |
| Fork 기반 독립 창작 | 허용된 회차 종료 시점의 공개 설정에서 분기하고, 이후 사건과 인물 상태를 원작과 분리 |
| 집필·편집 지원 | 직접 집필, AI 협업 집필(일러스트 생성 포함), AI 자율 연재의 세 가지 방식. `.txt`·`.epub` 내보내기 |
| 독자 피드백 분석·응대 | 독자가 유형(댓글·단순 오류·스토리 오류·질문·제안)을 고르고, 단순 오류·질문은 AI가 공개 근거로 수정안·답변, 스토리 오류·제안은 작가 검토로 연결. 등록 전 유해 콘텐츠 1차 필터 |
| 알림·운영 | 사이트 안 알림함, 정기 작업(크레딧 초기화·탈퇴 처리 등) 실행 감시, LLMOps(Langfuse 추적·평가, MVP 이후) |

**AI 자율 연재**는 작품 소유자(원작·Fork 모두)가 켜면 정한 조건과 독자 반응을 바탕으로 다음 회차를 생성하고
발행 확인을 거쳐 자동 발행하는 것으로 정했습니다. 크레딧은 작품 소유자가 부담합니다. 소유자가 정한 요일·시각에 콘텐츠 서비스의 업무 실행 경계에서 실행하고 Core가 정산·알림을 담당하는 목표이며, 아직 구현되지 않았습니다.

### 주요 사용자 흐름

1. **독자의 Fork 창작:** 허용 기준 회차에서 작품 Fork → 기준까지 공개된 세계관을 참조하며 직접 집필 또는 선택적 AI 대화. 설정을 처음 수정하면 전체 세계관을 자기 소유로 Fork하고, 이후 원본 변경 알림에서 반영 여부를 선택합니다(DEC-29·32~34). 발행은 별도입니다.
2. **작가의 회차 집필:** 기존 세계관·회차 확인 → 장면·사건 설정 → 직접 원고 작성 또는 선택적 시뮬레이션·AI 제안 → 사용자 검토·발행. 별도의 설정 충돌·개연성 검토는 MVP 이후입니다.
3. **피드백 응대:** 독자가 유형을 골라 무료로 등록 → 1차 필터 → 단순 오류·질문은 공개 근거로 수정안·답변
   (단순 오류는 작품 설정에 따라 자동 승인·발행), 스토리 오류(선택적으로 독자 크레딧으로 검증 시뮬레이션)·제안은 작가 검토
   → 실제 처리 상태 안내. 검증한 스토리 오류가 반영되면 독자에게 보상 크레딧.

### 지켜야 할 제품 경계

- **원작과 Fork 분리:** 기준 회차·버전을 보존합니다. 세계관은 수정 전 허용된 원본 변경을 따르고 최초 수정 시 독립됩니다. 독립 후 원본 변경은 알림과 사용자 선택으로만 반영하며 원작은 수정하지 않습니다.
- **공개 범위와 인물 지식 분리:** 작가 비공개 정보, 독자에게 공개된 정보, 각 캐릭터가 아는 사실은 서로 다릅니다.
- **생성과 확정 분리:** 시뮬레이션·AI 초안은 확정 원고가 아닙니다. 선택·승인 없이 정본이나 인물 상태를 덮어쓰지 않습니다.
- **수정안과 작가 승인 분리:** 오타·맞춤법·명백한 수치 오류는 근거와 함께 수정안을 제시하고 작가 승인 후 반영합니다.
  작가가 작품 설정에서 자동 승인·발행을 켠 경우만 예외이며, 피드백·수정안은 세계관을 바꾸지 않습니다.
  여기서 PR은 작품 내 변경 제안이며 GitHub 연동을 전제하지 않습니다.
- **단순 오류와 스토리 오류 구분:** 독자가 고른 유형으로 처리하며 AI가 유형을 분류하지 않습니다. 단순 오류만 수정안·자동 승인 경로를 타고,
  스토리 오류는 언제나 작가가 판단합니다. 전개 선호(제안)를 오류로 단정하지 않으며 허용된 Fork를 선택적으로 안내합니다.

## 이용 권한·비용·데이터 — 기획 방향

- 허용된 작품의 **Fork 생성·직접 집필·피드백 등록은 무료**입니다. AI 기능은 실행 전에 예상 상한을 안내하고,
  실행 후 실제 토큰 사용량을 크레딧으로 환산해 차감합니다. 실패한 작업은 차감하지 않습니다.
- 크레딧은 무료(가입 체험·보상·이벤트)와 유료(월 구독·추가 구매)로 나눕니다. 요청 속도는 토큰 버킷으로 제한합니다.
  플랜·가격·환산 비율·수익 배분은 후속 확정 대상이며, MVP에서는 실결제 없이 가입 체험·보상·이벤트 크레딧만 씁니다.
  추가 저장 공간은 유료 확장 방안을 검토하며, 한도 초과를 이유로 기존 작품을 자동 삭제하지 않습니다.
- 작품 등록이나 Fork 허용 설정만으로 외부 IP의 이용 권한이 생기지 않습니다. Fork·공개·유료 공개 허용을 구분하며,
  AI 이용은 별도 허용 항목 없이 Fork·세계관 이용 허용 범위에 포함됩니다. 권리 침해·유해 콘텐츠 신고는 24시간 내 1차 조치하고 소명 절차를 엽니다(UC-20).
- 공개 데이터셋과 저작권 만료 작품은 **조사·검증 후보**입니다. 라이선스와 관련 권리를 확인하기 전에는
  수집·학습·상업적 이용을 승인된 것으로 간주하지 않습니다.

## 아키텍처와 현재 기술 기반

기존 **서비스 책임을 분리한 MSA 구조**를 발전시킵니다. Frontend는 TypeScript로 **Clean Architecture·MVVM**을,
백엔드는 **기능 중심 레이어드 구조**를 따릅니다. 기능별 서버 복제는 전제하지 않습니다.

```text
Frontend (React)
  → 공개 HTTP API → Core Service (현 실행 모듈: core-api, Spring Boot / Kotlin)
                     → 내부 HTTP API → AI Service (FastAPI)
                                         (Health 및 선택적 생성 제안)
```

| 구성 | 현재 기술 | STORYFORK 목표 책임 — 구현 범위는 콘텐츠 통합 안내 참고 |
|---|---|---|
| Frontend | React·TypeScript·Vite, Redux Toolkit·Awilix·Zod·Tailwind CSS | 독자·작가 전체 화면(작가 도구는 하위 기능). 목표는 단일 진입점의 Core·콘텐츠·운영 공개 API 사용; 현재는 기존 core-api 호출 |
| Core Service (`core-api` 모듈) | Kotlin·Spring Boot, JDK 21 | 현재 인증·콘텐츠·첨부를 함께 실행. 분리 후 회원·인증·크레딧·알림 소유 |
| AI Service | 현재 Python·FastAPI; MVP 모델·프레임워크 미정 | 선택적 설정 추출·인물 시뮬레이션·집필 제안. 정본 직접 변경 금지 |
| 실행 환경 | Docker Compose, Vite 개발 서버, nginx 정적 배포 이미지 | 로컬 개발 및 서비스 연결·배포 이미지 검증 |

Core는 기능별 `Controller → Service → Repository` 또는
`Controller → Service → (필요한 경우 Facade) → Client` 흐름을 사용합니다.
콘텐츠 기능은 선택적으로 PostgreSQL을 사용합니다. Redis·큐·worker는 도입하지 않았습니다.
합의된 향후 구성요소(미구현)는 [아키텍처 문서](docs/architecture.md#합의된-향후-구성요소-미구현)에 정리했습니다.
구체적인 구현 규칙은 [AGENTS.md](AGENTS.md), 현행 실행 구조는 [아키텍처 문서](docs/architecture.md)를 참고하세요.

### 현재 구현

- `/`: React 홈·검색·독서 등 데모 화면과 실제 인증·일부 콘텐츠·첨부 API 연결이 공존합니다. `/content`와 UUID 집필실의 실제 서버 경계를 구분합니다.
- `GET /api/v1/health`: `{ "status": "up", "service": "storyfork-core-api" }`.
- `GET /api/v1/health/ai-service`: Core가 내부 AI의 `/internal/v1/health`를 검증하여
  `{ "status": "up", "service": "storyfork-ai-service" }` 반환.
- AI 연결 불가·timeout은 안전한 503·504, 잘못된 응답은 502. 자체 Core Health와 분리합니다.

Health는 OpenAI 인증·모델 접근·생성 품질 검증이 아닙니다. 모델 클라이언트를 생성하지 않으며
실제 키 없이 실행됩니다. 이전 문서에서 제안한 LangChain·LangGraph와 현재 남아 있는 `openai-agents` 의존성은 MVP 모델·프레임워크 선정 완료를 뜻하지 않습니다.
선택적 콘텐츠 기능은 작품·회차·설정 저장, 원고 버전·복원·공개, 제한된 Fork와 AI 제안 적용을 제공합니다. 전체 세계관 체크포인트, 일반 수정 제안 승인 체계, 크레딧·Redis·큐·worker는 미구현입니다.

## 목표 서비스 분리 — DEC-41

| 서비스 | 소유 업무 | 현재와의 차이 |
|---|---|---|
| Core | 회원·인증·세션·크레딧·회원 알림 | 기존 core-api 재사용, 현재 남은 콘텐츠는 이전 대상 |
| 콘텐츠 | 작품·세계관·회차·버전·Fork·발행·독서·검색·피드백·첨부 | 별도 Kotlin/Spring Boot 앱 분리 예정 |
| 운영 | 문의·공지·이벤트·신고·소명·운영 판단·감사·작업 감시 | 별도 Kotlin/Spring Boot 앱 분리 예정 |
| AI | 요청된 생성·추출·시뮬레이션·검토 실행 | 기존 FastAPI 재사용 |

LLMOps는 운영 영역이다. Langfuse는 도입 시 별도 제품으로 배포하며 자체 UI와 운영 화면 API 통합 중 선택은 미정이다. 정기 작업은 업무 소유 서비스가 실행하고 운영이 감시한다. 콘텐츠 제한은 콘텐츠, 회원 제한·크레딧은 Core가 적용한다. 기존 실행 명령은 아래처럼 유지하며 새 Start 서버·빈 공통 starter를 추가하지 않는다. 상세 소유권·DB·통신·이전 절차는 [서비스 구조](docs/design/service-boundaries.md)를 따른다.

## 빠른 시작

Docker daemon과 Compose plugin이 필요합니다. `cp -n .env.example .env`로 루트 설정을 준비하고,
DB 자격증명·JWT 키를 설정한 뒤 `AUTH_PUBLIC_ORIGIN`을 실제 web 주소(아래 기본값 `http://127.0.0.1:8088`)에 맞춥니다.
실제 `.env`가 이미 있으면 덮어쓰지 마세요. 예시 파일의 빈 자격증명만으로 기동할 수는 없습니다.

```bash
# 소스에서 배포 이미지를 빌드해 로컬 검증
docker compose --env-file .env --file infrastructure/docker-compose.yaml --file infrastructure/docker-compose.prod.yaml up --build -d
# http://127.0.0.1:8088
docker compose --env-file .env --file infrastructure/docker-compose.yaml --file infrastructure/docker-compose.prod.yaml down
```

`docker-compose.yaml`은 공통 base로 단독 실행하지 않습니다. `docker-compose.prod.yaml`과 병합하면
기존 `storyfork-prod-validation` 프로젝트의 PostgreSQL·Mailpit과 소스 빌드한 세 앱을 실행합니다.
콘텐츠는 기본 비활성이며 `CONTENT_ENABLED=true`와 실제 내부 토큰으로 활성화합니다([콘텐츠 설정](docs/content-integration.md#인증과-실행)).
Health 확인에는 `OPENAI_API_KEY`가 필요하지 않습니다.

| 주소 | 용도 |
|---|---|
| `http://127.0.0.1:8088` | STORYFORK 화면 |
| `http://127.0.0.1:8088/api/v1/health` | nginx를 거친 Core Health |
| `http://127.0.0.1:8088/api/v1/health/ai-service` | Core를 거친 AI Health |
| `http://127.0.0.1:8025` | 로컬 Mailpit 메일 확인 |

web 포트는 `WEB_PORT=8088`로 변경할 수 있습니다. CORS는 web 포트에 맞춰 계산하며
`APP_CORS_ALLOWED_ORIGIN`으로 단일 origin을 지정할 수도 있습니다. Core·AI·DB 포트는 호스트에 공개하지 않습니다.
키는 AI 런타임에만 전달하고 VITE/build ARG에는 넣지 않습니다. nginx 정적 런타임이 SPA와 `/api` 프록시를 제공하며
Vite나 소스 mount는 없습니다. loopback 검증용으로 **인터넷 운영 준비가 된 배포가 아닙니다**.

### 개발 서버 — CI 게시 이미지

base + `infrastructure/docker-compose.dev.yaml`은 `storyfork-develop-cd` 프로젝트에서 CI가 게시한
세 `:develop` 이미지를 pull·실행합니다. 소스 build·hot reload나 DB 신설 없이 기존 외부 PostgreSQL·SMTP를 사용합니다.
두 파일 전달·서버 설정과 실행 명령은 [인프라 안내](infrastructure/README.md)를 따릅니다.
이전 소스/HMR용 Compose는 제거했으며, hot reload 개발은 아래 네이티브 명령을 유지합니다.

### 네이티브 실행

Frontend는 Node 24·pnpm 11.22, Core는 JDK 21, AI는 Python 3.11 이상 3.15 미만과 uv를 사용합니다.
각 서비스 [Frontend](frontend/README.md), [Core](backend/core-api/README.md),
[AI](backend/ai-service/README.md) README의 실행 명령을 따릅니다.
환경설정은 루트 `.env` 한 곳에서 관리합니다. `cp -n .env.example .env`로 준비하고 기존 파일은 덮어쓰지 않습니다.
서비스별 `.env`는 만들지 않습니다. 기본 실행은 위의 Compose를 사용합니다.
네이티브 개발은 각 서비스에 필요한 환경변수만 해당 터미널에 설정한 뒤 기본 명령을 실행합니다.

```bash
(cd frontend && pnpm dev)
(cd backend/core-api && ./gradlew bootRun)
(cd backend/ai-service && uv run --locked uvicorn app.main:create_app --factory --reload --port 8000)
```

이 명령들은 루트 `.env`를 자동으로 읽지 않습니다. 자동 설정 전달이 필요하면 Compose를 사용합니다.
루트 `.env` 전체를 source하지 말고 OpenAI 키는 AI에만, DB·Auth 설정은 Core에만 전달합니다.
기존 서비스별 `.env.local` 등이 있으면 Vite가 별도로 읽을 수 있으므로 필요한 값을 루트로 수동 통합하세요.
네이티브 Core의 AI 기본 주소는 `http://127.0.0.1:8000`, Compose는 `http://ai-service:8000`을 고정 사용합니다.

## 검증

### 로컬 개발: 변경·영향 범위의 단위 테스트만

TDD의 Red → Green → Refactor를 선택 단위 테스트로 진행합니다. DB·API·화면 변경도 관련 순수 단위 회귀를 먼저 작성하며,
통합·시스템·브라우저 E2E·전체 suite·빌드는 로컬 개발 완료 조건으로 실행하지 않습니다. 앱·DB·컨테이너를 검증용으로 띄우지 않습니다.
설정 구문·계약 검사와 `docker compose config --quiet`는 허용하며 문서는 내용·로컬 링크·`git diff --check`를 확인합니다.

```bash
# 루트: CI 선택/실행 계약의 작은 stdlib 단위 회귀 (앱·DB 실행 없음)
python3 -m unittest discover -s infrastructure/ci -p 'test_*.py' -v
# 각 서비스 디렉터리에서 변경한 단위 테스트를 지정하는 예
pnpm exec vitest run src/domain/__tests__/LibraryUseCase.test.ts
./gradlew unitTest --tests 'ai.storyfork.core.auth.AuthSecurityConfigTest' --no-daemon
uv run --locked --extra dev python -m pytest -m 'not integration' tests/test_generation.py -k missing_key
```

자세한 선택 명령은 [Frontend 지침](frontend/AGENTS.md#검증), [Core 지침](backend/core-api/AGENTS.md#검증),
[AI 지침](backend/ai-service/AGENTS.md#변경-범위와-검증)을 따릅니다. 단위 통과가 CI 통합·시스템 검증을 대신하지 않습니다.
Aside는 별도 요청·승인 시에만 사용하며 HTTP 시스템 테스트를 브라우저 E2E로 보고하지 않습니다.

### CI: 선택 → 단위·통합 병렬 → 선택 HTTP 시스템 → Required CI

[`ci.yml`](.github/workflows/ci.yml)이 Vitest·Gradle·pytest를 직접 호출하고 환경 기동·readiness·항상 정리를 소유합니다.
[`infrastructure/ci/ci.py`](infrastructure/ci/ci.py)는 보수적인 변경 선택·결과 집계·로그 정제만 담당하며 공통 runner나 shell wrapper는 없습니다.
JUnit/Vitest/pytest 단위·통합 테스트는 서비스 디렉터리에, pytest 시스템 테스트는 [`infrastructure/system/test_http.py`](infrastructure/system/test_http.py)에 둡니다.
새 테스트 프레임워크·production 의존성은 추가하지 않습니다.

| 계층 | 현재 실행 범위 |
|---|---|
| 선택·정적 검사·단위 | 변경 diff 공백·선택기 회귀, 선택된 web의 lint/build, AI lock 검사. web Domain/Data/HTML 단위, Core `unitTest`, AI `-m 'not integration'` |
| 통합 | 나머지 web React/Hook/App 조립, Core `integrationTest`(Spring context·HTTP·PostgreSQL·Flyway), AI `-m integration`(FastAPI TestClient) |
| 시스템 | CI 전용 Compose 앱·임시 PostgreSQL·Mailpit을 기동한 뒤 `pytest infrastructure/system -k ...`로 선택된 실제 HTTP 시나리오 실행 |
| 집계 | `Required CI`: 실패·취소·필요한 tier의 예상 밖 skip은 실패, 영향 없는 작업의 의도적 skip만 허용 |

변경 선택 후 단위·통합 서비스 행렬과 설정 검사는 서로 독립적으로 병렬 실행합니다. 시스템은 필요한 단위·통합·설정 검사가 성공한 뒤 실행하며, 실패·취소 시 생략합니다. 단위/통합 범위는 서로 제외해 중복 실행하지 않습니다.
Core의 혼합 경계 클래스는 통합에 두며 새 Spring/HTTP/DB 테스트의 분류 누락은 선택기 회귀가 검사합니다.
Core 통합 job은 `AUTH_INTEGRATION_TEST=true`, `AUTH_MAILPIT_API`, `TEST_CONTENT_DATABASE_URL`을 설정해 기존 조건부 테스트를 활성화합니다.
기존 Content 테스트의 `content_test`/빈 비밀번호 계약은 격리 runner의 임시 PostgreSQL trust 인증으로만 맞춥니다.

#### 변경·영향 선택

- PR: base와 실제 head의 **merge-base**부터 비교. push: event의 **before SHA**부터 비교.
  수동 CI 실행·기준선 부재(새 브랜치/기준 커밋 없음)는 명시적으로 전체 서비스·시나리오를 실행합니다.
  이때 공백 검사는 첫 부모와 비교하며, 부모가 없는 최초 커밋만 빈 트리와 비교합니다.
- web·AI는 서비스 수준, Core는 auth/content/health 기능 수준으로 보수적으로 선택합니다. 선택된 범위의 해당 계층 테스트는 모두 실행합니다.
- 공유·설정·의존성·미등록 runtime 경로는 해당 서비스 전체 또는 전체 서비스로 확장합니다.
  Core Auth는 Content/web 소비자를, Core Content·AI 계약 변경은 연결된 Core/AI/web와 시스템 시나리오를 함께 선택합니다.
- 삭제·이름 변경은 `git diff --no-renames`로 이전 경로까지 포함합니다. 정확한 소스별 의존 그래프 분석은 아닙니다.
  테스트만 변경하면 해당 서비스/기능 회귀만 실행하고 시스템은 생략합니다. 문서만 변경하면 runtime job은 생략합니다.
  영향받는 runtime 범위에서 테스트가 하나도 발견되지 않으면 성공으로 숨기지 않습니다.

#### HTTP 시스템 시나리오와 경계

`health`: web 정적 응답과 nginx → Core → AI Health.
`auth`: CSRF 없는 변경 403, 가입 → Mailpit 메일 토큰 → 이메일 확인 → 잘못된 비밀번호 401 → 로그인·프로필·DB 회원 저장.
`content`: auth를 한 번 준비한 뒤 작품 생성 → 회차 저장 → 오래된 revision 409 → 재조회·DB 원고 보존·미인증 접근 401.
`ai`: auth/content를 재사용하고 실제 Core → AI HTTP 호출의 제공사 설정 누락 503, 원고 불변·실패 job 저장·성공 제안 없음.
선택된 시나리오의 준비 흐름은 한 번만 실행합니다. 실제 모델 성공·과금·브라우저 입력/클릭은 검증하지 않습니다.

[`compose.test.yaml`](infrastructure/ci/compose.test.yaml)은 base+prod 뒤에서 CI 포트를 loopback 임의 포트로 제한하고,
DB를 tmpfs로 바꾸며 AI 키·모델은 빈 값으로 고정합니다. 서비스 단위 제공사 테스트는 monkeypatch 대역을 사용하고 시스템은 명시적인 503만 확인하므로 유료 호출이 없습니다.
실행별 `storyfork-ci-<run>-<attempt>` 프로젝트만 항상 정리하며 배포 volume·실제 `.env`·외부 DB·실제 SMTP·서버 배포는 건드리지 않습니다.
실패 시 테스트 결과·컨테이너 로그를 토큰·이메일 등으로부터 정제하여 7일 보관합니다.

로컬 선택 단위 결과와 hosted runtime 결과를 구분합니다. **최신 커밋의 GitHub `Required CI` 실제 성공을 확인하기 전에는 검증 대기**입니다.
CI 이후 단일 CD의 게시 → 배포 흐름은 [인프라 안내](infrastructure/README.md#ci--cd-publish--deploy)를 참고하세요.

## 저장소와 문서

- [공통 구현 지침](AGENTS.md)
- [현재 아키텍처](docs/architecture.md)
- [유스케이스](docs/usecase.md) · [유스케이스 명세](docs/usecase-spec/README.md) · [보조 다이어그램](docs/diagrams/README.md) · [UI 프로토타입 대응](docs/prototype-alignment.md)
- [작가 도구 조사·온보딩](docs/research/writer-tools/README.md): Novelcrafter·Sudowrite·스토라이즈 비교와 시연 안내
- [펜시브 기능 조사](docs/research/pensiv/README.md): 기능·블로그 제공 주장, STORYFORK 적용 제안과 공식 출처
- [요구사항 정의서](docs/SKN34-final-4Team_요구사항정의서.xlsx)([기능 ID 색인](docs/requirements.md)) · [WBS](docs/SKN34-final-4Team_WBS.xlsx)
- [Frontend](frontend/README.md): `storyfork-web`, 시작 화면과 공개 API 연결
- [Core Service](backend/core-api/README.md): 현 실행 모듈 `storyfork-core-api`, 공개 Health·내부 HTTP 오류 경계
- [AI Service](backend/ai-service/README.md): `storyfork-ai-service`, 내부 Health
- [AI Agent 구현 경계](backend/ai-service/docs/agent-structure.md): 현재 Agent 없음, 향후 적용 기준
- [Docker 실행/검증](infrastructure/README.md)

Kotlin namespace는 `ai.storyfork.core`, Gradle group은 `ai.storyfork`입니다.
`backend/core-api/src/{main,test}/kotlin/ai/storyfork/core/`가 package 선언과 일치합니다.
업무 기능은 상세 계약과 권한·정책을 확정한 뒤 필요한 범위만 추가합니다.
