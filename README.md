# STORYFORK

**원작을 나만의 이야기로.**

다중 AI 에이전트 기반 **독자 참여형 스토리 창작 및 피드백 자동화 플랫폼**입니다.
작가는 세계관과 등장인물을 관리하며 AI와 함께 집필하고, 독자는 이용이 허용된 원작의 특정
회차에서 이야기를 분기(Fork)하여 독립적인 전개와 결말을 창작하는 것을 목표로 합니다.
AI는 창작 방향을 대신 확정하는 주체가 아니라, 사용자의 선택·집필·검토를 돕는 도구입니다.

기획 기준은 **「SKN34 4Team 프로젝트 기획서」 v1.4**이며, 최신 MVP 결정은 [결정 기록 DEC-26~40](docs/design/decisions.md#결정-목록)을 따릅니다. 충돌하는 과거 유스케이스 세부 정책은 현행 계약이 아닙니다.
[MVP 설계](docs/design/design.md): Frontend는 작가·독자 전체 화면, 논리 명칭은 Core Service·AI Service입니다. PostgreSQL은 설정·원고 원문 및 버전·체크포인트·Fork를, 그래프 DB는 관계 저장·조회를 담당합니다. 설정은 항목별 공개·비공개를 두고, 설정 이미지는 MinIO에 보관합니다. `pg_git`은 MVP에서 제외합니다. 그래프 DB 제품·동기화 및 AI 조회 경로는 미정입니다.

> **개인 통합 브랜치: 세계관 작업실 부분 구현**
> 세계관 직접 작성·Core 로컬 저장·선택적 AI 후보 검토·저장된 설정 조회를 포함합니다.
> 작품·회차·Fork 등 나머지 화면은 기존 메모리 데모이며, 이 브랜치는 병합 준비 완료 상태가 아닙니다.
> [Issue #48](https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/issues/48)의 부분 구현이고 #49 작품 생성·관리는 범위 밖입니다.

## 세계관 작업실 실행과 검증

| 영역 | 현재 통합본 | 한계 |
|---|---|---|
| 직접 작성 | 이름/선택 설명, 인물·장소 등 10개 메뉴, 수정/저장/재조회 | 로컬 H2와 체험 actor 사용 |
| 데이터 보호 | 소유자·기준 버전 검사, 이전 저장본 revision, 오류 시 입력/저장본 유지 | 실제 인증·PostgreSQL·항목/회차 공개·revert UI 미구현 |
| AI | 기본 OFF, 동의 후 후보 생성·수정·선택 승인, 실패/중단 처리 | SDK HTTP mock/DTO 스텁으로만 검증, 실제 모델 품질·비용 미검증 |
| 설정집·관계·시간선 | 저장된 settings를 읽는 화면 | 관계는 목록, 그래프 DB/그래프 시각화 미구현. 관계 양성 브라우저 검증 진행 중 |
| 새 소설 연계 | 작업실 진입과 서버 세계관 조회 연결 | 작품 저장은 메모리 데모. 기존 1~5개 선택은 MVP 정책이 아님; #49 범위 밖 |

Node 24·pnpm 11.22·JDK 21·Python/uv가 필요합니다. 루트 `.env.example`을 참고해 **개인 `.env` 한 곳**에서 설정합니다. 실제 `.env`와 DB는 커밋하지 않습니다.

- 직접 작성: `STUDIO_ENABLED=true`, `WORLD_STUDIO_AI_ENABLED=false`, `STUDIO_DB_URL`에 개인 사용자 DB의 H2 파일 URL 지정. AI Service 없이 사용할 수 있습니다.
- QA는 다른 H2 파일 URL과 다른 서버/브라우저 포트를 사용합니다. 사용자 DB에 합성 데이터를 넣거나 리셋하지 않습니다. Core는 loopback 접근과 기존 CORS 설정 Origin만 허용합니다.
- 기존 native launcher: `python infrastructure/scripts/run-native.py core-api`, 별도 터미널에서 `python infrastructure/scripts/run-native.py web`. 기본 화면은 `/worlds`입니다. POSIX launcher 경로이며 Windows 일반 launcher 검증은 남아 있습니다.
- 체험 화면에서 ‘체험 환경 안내 → 작업실 연결’을 사용합니다. 실제 계정 인증이나 운영 접근 권한이 부여되는 기능이 아닙니다.
- AI는 명시적으로 켠 환경만 요청할 수 있습니다. 이 작업의 검증은 스텁/mock만 사용하며 신규 유료 호출은 하지 않았습니다.

[통합 구현·실행 경계](docs/world-studio-integration.md) · [#48 요구사항 대조](docs/world-studio-direct.md) · [4개 PR 분리·검증 상태](docs/world-studio-sharing.md)

**검증 상태:** 기존 기능 회귀/일부 Core·AI mock 검증과 각 PR의 독립 검증을 구분합니다. 독립 PR 2/3 빌드 및 PR 4 관계 양성 E2E는 진행 중입니다. 최신 완료 결과는 공유 문서의 표에 기록하며, 원격 CI는 실제 push 뒤의 실행 결과만 인정합니다.

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
발행 확인을 거쳐 자동 발행하는 것으로 정했습니다. 크레딧은 작품 소유자가 부담합니다. 소유자가 정한 요일·시각에 Core API 내장 스케줄러로 실행하며, 아직 구현되지 않았습니다.

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
                                         (세계관 AI는 선택적·기본 비활성화)
```

| 구성 | 현재 기술 | STORYFORK 목표 책임 — 구현 범위는 위 상태표 참고 |
|---|---|---|
| Frontend | React·TypeScript·Vite, Redux Toolkit·Awilix·Zod·Tailwind CSS | 독자·작가 전체 화면(작가 도구는 하위 기능). 공개 Core Service HTTP API만 호출 |
| Core Service (`core-api` 모듈) | Kotlin·Spring Boot, JDK 21 | 작품·세계관·회차 버전·체크포인트·Fork의 정본, 권한·승인·발행의 최종 판단과 저장 |
| AI Service | 현재 Python·FastAPI; MVP 모델·프레임워크 미정 | 선택적 설정 추출·인물 시뮬레이션·집필 제안. 정본 직접 변경 금지 |
| 실행 환경 | Docker Compose, Vite 개발 서버, nginx 정적 배포 이미지 | 로컬 개발 및 서비스 연결·배포 이미지 검증 |

Core는 기능별 `Controller → Service → Repository` 또는
`Controller → Service → (필요한 경우 Facade) → Client` 흐름을 사용합니다.
현재 DB·큐·worker는 없으며, 저장·장기 실행 요구가 확정될 때 필요한 범위만 도입합니다.
합의된 향후 구성요소(미구현)는 [아키텍처 문서](docs/architecture.md#합의된-향후-구성요소-미구현)에 정리했습니다.
구체적인 구현 규칙은 [AGENTS.md](AGENTS.md), 현행 실행 구조는 [아키텍처 문서](docs/architecture.md)를 참고하세요.

### 현재 구현

- `/`: 현재 `frontend/index.html`은 정적 UI 프로토타입(견본)이며 Core API를 호출하지 않습니다.
  React 진입점(`src/main.tsx`)의 시작 화면·Core·AI 연결 상태 표시는 이 HTML에서 불러오지 않습니다.
  프로토타입과 유스케이스의 차이는 [UI 프로토타입 대응](docs/prototype-alignment.md)을 참고하세요.
- `GET /api/v1/health`: `{ "status": "up", "service": "storyfork-core-api" }`.
- `GET /api/v1/health/ai-service`: Core가 내부 AI의 `/internal/v1/health`를 검증하여
  `{ "status": "up", "service": "storyfork-ai-service" }` 반환.
- AI 연결 불가·timeout은 안전한 503·504, 잘못된 응답은 502. 자체 Core Health와 분리합니다.

Health는 OpenAI 인증·모델 접근·생성 품질 검증이 아닙니다. 모델 클라이언트를 생성하지 않으며
실제 키 없이 실행됩니다. 이전 문서에서 제안한 LangChain·LangGraph와 현재 남아 있는 `openai-agents` 의존성은 MVP 모델·프레임워크 선정 완료를 뜻하지 않습니다.
작품·로그인·저장·Fork·집필·승인·크레딧 기능, DB·Redis·큐·worker는 없습니다.

## 빠른 시작

Docker daemon과 Compose plugin이 필요합니다. 루트에서 예시를 그대로 사용해 실행할 수 있습니다.
실제 `.env`가 이미 있으면 덮어쓰지 마세요.

```bash
docker compose --env-file .env.example --file infrastructure/compose.yaml up --build
# http://127.0.0.1:5173
docker compose --env-file .env.example --file infrastructure/compose.yaml down
```

개인 설정이 필요할 때만 `cp -n .env.example .env` 후 `--env-file .env`를 사용합니다.
`OPENAI_API_KEY`는 비워 두어도 됩니다. 이 설정을 채워도 생성 API가 생기지는 않습니다.

| 주소 | 용도 |
|---|---|
| `http://127.0.0.1:5173` | STORYFORK 시작 화면 |
| `http://127.0.0.1:5173/api/v1/health` | Vite를 거친 Core Health |
| `http://127.0.0.1:5173/api/v1/health/ai-service` | Core를 거친 AI Health |
| `http://127.0.0.1:8080/api/v1/health` | 개발용 Core 직접 디버깅 |

포트는 `DEV_WEB_PORT=5173`, `CORE_API_PORT=8080`으로 변경할 수 있습니다.
CORS는 web 포트에 맞춰 계산하며 `APP_CORS_ALLOWED_ORIGIN`으로 단일 origin을 지정할 수도 있습니다.
AI 포트는 호스트에 공개하지 않습니다. 키는 AI 런타임에만 전달하고 VITE/build ARG에는 넣지 않습니다.

### 배포 이미지 로컬 검증

```bash
docker compose --env-file .env.example --file infrastructure/compose.prod.yaml up --build -d
# http://127.0.0.1:8088 (WEB_PORT로 변경)
docker compose --env-file .env.example --file infrastructure/compose.prod.yaml down
```

별도 프로젝트의 nginx 정적 런타임이 SPA와 `/api` 프록시를 제공합니다. Vite나 소스 mount는 없습니다.
web만 loopback에 공개합니다. 인증·TLS가 없으므로 **인터넷 운영 준비가 된 배포가 아닙니다**.

### 네이티브 실행

Frontend는 Node 24·pnpm 11.22, Core는 JDK 21, AI는 Python 3.11 이상 3.15 미만과 uv를 사용합니다.
각 서비스 [Frontend](frontend/README.md), [Core](backend/core-api/README.md),
[AI](backend/ai-service/README.md) README의 실행 명령을 따릅니다.
환경설정은 루트 `.env` 한 곳에서 관리합니다. `cp -n .env.example .env`로 준비하고 기존 파일은 덮어쓰지 않습니다.
서비스별 `.env`는 만들지 않으며, 루트에서 아래 명령을 각각 실행합니다(Python 3·uv 필요).

```bash
python3 infrastructure/scripts/run-native.py web
python3 infrastructure/scripts/run-native.py core-api
python3 infrastructure/scripts/run-native.py ai-service
```

실행기는 루트 `.env`를 읽어 서비스별 허용 변수만 전달합니다. OpenAI 키는 AI에만 전달하며 브라우저·Core에 전달하지 않습니다.
기존 셸 변수는 uv의 우선순위를 따릅니다. 빈 값은 네이티브 기본값을 사용합니다.
기존 서비스별 `.env.local` 등이 있으면 Vite가 별도로 읽을 수 있으므로 필요한 값을 루트로 수동 통합하세요.
네이티브 Core의 AI 기본 주소는 `http://127.0.0.1:8000`, Compose는 `http://ai-service:8000`을 고정 사용합니다.

## 검증

```bash
# 각 서비스 디렉터리에서
# frontend (Node 24 / pnpm 11.22)
pnpm test
pnpm lint
pnpm build
# backend/core-api (JDK 21)
./gradlew clean test --no-daemon
# backend/ai-service
uv lock --check
uv run --locked --extra dev python -m pytest
```

루트에서 설정/셸 회귀를 확인합니다. 빌드나 컨테이너 시작, 외부 API 호출은 하지 않습니다.

```bash
python3 -I infrastructure/scripts/check-compose-config.py
bash -n infrastructure/scripts/verify-compose.sh
```

별도 통합 검증은 새 일회성 프로젝트를 빌드·실행하고 자기 리소스만 정리합니다.
실제 키 없이 Core·AI Health, 실패·복구, API 404 및 prod 정적 asset/deep link를 확인합니다.
OpenAI를 호출하지 않지만 이미지·의존성 다운로드에는 네트워크가 필요합니다.

```bash
./infrastructure/scripts/verify-compose.sh dev
./infrastructure/scripts/verify-compose.sh prod
```

검증 기본 포트는 dev `15173`/`18080`, prod `18088`입니다.
다른 프로젝트를 중지하지 말고 포트를 변경하세요. 상세는 [인프라 안내](infrastructure/README.md)를 참고하세요.

## 저장소와 문서

- [공통 구현 지침](AGENTS.md)
- [현재 아키텍처](docs/architecture.md)
- [유스케이스](docs/usecase.md) · [유스케이스 명세](docs/usecase-spec/README.md) · [보조 다이어그램](docs/diagrams/README.md) · [UI 프로토타입 대응](docs/prototype-alignment.md)
- [작가 도구 조사·온보딩](docs/research/writer-tools/README.md): Novelcrafter·Sudowrite·스토라이즈 비교와 시연 안내
- [요구사항 정의서](docs/SKN34-final-4Team_요구사항정의서.xlsx)([기능 ID 색인](docs/requirements.md)) · [WBS](docs/SKN34-final-4Team_WBS.xlsx)
- [Frontend](frontend/README.md): `storyfork-web`, 시작 화면과 공개 API 연결
- [Core Service](backend/core-api/README.md): 현 실행 모듈 `storyfork-core-api`, 공개 Health·내부 HTTP 오류 경계
- [AI Service](backend/ai-service/README.md): `storyfork-ai-service`, 내부 Health
- [AI Agent 구현 경계](backend/ai-service/docs/agent-structure.md): 현재 Agent 없음, 향후 적용 기준
- [Docker 실행/검증](infrastructure/README.md)

Kotlin namespace는 `ai.storyfork.core`, Gradle group은 `ai.storyfork`입니다.
`backend/core-api/src/{main,test}/kotlin/ai/storyfork/core/`가 package 선언과 일치합니다.
업무 기능은 상세 계약과 권한·정책을 확정한 뒤 필요한 범위만 추가합니다.
