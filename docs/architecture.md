# STORYFORK 아키텍처

## 현재 구현

STORYFORK 시작 화면과 실제 Core·AI 연결 확인만 제공하는 세 서비스 개발 기반입니다.
서비스 책임을 분리한 MSA + 기능 중심 레이어드 구조를 유지하며 전면 Clean Architecture 전환은 하지 않습니다.

```text
Browser → React Web → 공개 Core API → 내부 FastAPI AI Service
             /api       /api/v1/health       /internal/v1/health
                        /api/v1/health/ai-service
```

현재 OpenAI 호출은 없습니다. AI 스택은 LangChain·LangGraph·Langfuse로 정했으며(현재 `openai-agents` 의존성은 첫 AI 기능 구현 시 교체), 아직 Agent·모델·그래프를 생성하지 않습니다.
키 없이 시작하며 Health는 OpenAI 인증·모델 접근·생성 검증이 아닙니다.
DB·Redis·큐·worker·로그인·가짜 CRUD·seed 데이터는 없습니다.

## Frontend

`App`은 `/`의 시작 화면과 알 수 없는 UI 경로의 안전한 홈 이동만 담당합니다.
실제 상태 UI는 `CoreApiConnectionStatus → useCoreApiHealth → appContainer 외부 함수 → Fetch·Zod`입니다.
두 공개 API의 상태·서비스명을 검증하며 AI는 항상 Core를 경유합니다.

- Awilix `app/di`가 두 Health 함수를 등록하고 전역 `appContainer`를 재사용합니다.
- Hook이 로딩·성공·실패·재시도, 요청 취소와 늦은 응답 무시를 담당합니다.
- 화면 상태는 Hook 한 곳에만 있으며 Store·Provider·업무 UseCase·Repository는 없습니다.
- Fetch는 Data Layer에만 있고 20초 제한과 안전한 화면 오류를 사용합니다.
- 기존 Tailwind 색상·타이포그래피·연결 상태 스타일을 재사용합니다.

## Core API

Gradle group은 `ai.storyfork`, 애플리케이션은 `storyfork-core-api`, namespace는 `ai.storyfork.core`입니다.
물리 main/test 소스 루트는 `backend/core-api/src/{main,test}/kotlin/ai/storyfork/core/`입니다.

`_health/controller`는 자체 상태를 반환합니다.
`_health_ai_service/controller → service → client`는 내부 AI Health를 호출합니다.
Client의 nullable payload를 Service에서 `up`·`storyfork-ai-service`로 검증한 뒤 내부 Result와
공개 Response로 변환합니다. 경계별 DTO 소유권을 유지하며 필요 없는 Facade는 없습니다.

기존 `_common`에는 HTTP 연결 설정 검증·RestClient·통신 실패 분류·안전한 ProblemDetail·전역 CORS만 남습니다.
연결 불가는 503, timeout은 504, 잘못된 응답과 예상하지 않은 HTTP 상태는 502입니다.
내부 URL·오류 원문은 공개하지 않으며 AI 장애가 Core 자체 Health 성공을 막지 않습니다.

## AI Service

`app/main.py`가 FastAPI와 Health router를 조립하고 `health/models.py`의 고정된 타입 응답을 반환합니다.
외부 모델 자원이 없어 컨테이너·lifespan·설정 조립은 없습니다.
향후 합의된 AI 기능은 필요한 `router → service → agent → OpenAI` 흐름으로 추가합니다.
상세는 [Agent 구현 경계](../backend/ai-service/docs/agent-structure.md)를 따릅니다.

## 실행·보안 경계

정확히 `web`, `core-api`, `ai-service` 세 서비스만 있습니다.
개발 Compose는 Vite hot reload와 소스/node_modules volume, prod는 pnpm locked build와 nginx 정적 runtime입니다.
브라우저는 `/api`를 사용하고 Vite/nginx가 내부 Core DNS로 중계합니다.
API 404는 SPA HTML로 바꾸지 않고 UI deep link만 index.html로 연결합니다.

dev는 web과 디버깅용 Core를 loopback에, prod는 web만 loopback에 공개합니다. AI 포트는 내부 전용입니다.
인증·TLS가 없는 **로컬 검증용**이며 인터넷 운영 준비가 된 배포가 아닙니다.
OpenAI 설정을 사용할 때도 AI 런타임만 받고 Core·Frontend·build ARG에는 키를 넣지 않습니다.
실행과 검증, 환경파일 경계는 [인프라 안내](../infrastructure/README.md)를 따릅니다.

## 제품 목표와 미정 정책 — 미구현

- Core는 작품·세계관·회차 버전·Fork 정본과 권한·승인·발행·크레딧 최종 판단·저장을 소유합니다.
- AI는 Core가 허용한 최소 문맥에서 생성·시뮬레이션·검토 제안만 반환합니다.
- Fork 기준 revision/state를 고정하고 원작 후속 변경을 자동 유입하지 않습니다.
- 작가 비공개 정보, 독자 공개 범위, 캐릭터 지식을 분리합니다.
- 생성·제안과 사용자 승인·정본 반영을 구분합니다.
- 외부 IP 이용 권한·비용·실행 한도·신고·자동 연재 조건은 [README 기획](../README.md)을 참고하며 임의 확정하지 않습니다.

기능마다 서버를 복제하지 않으며 새 빈 업무 계층·인프라는 실제 계약과 요구가 정해질 때만 추가합니다.
