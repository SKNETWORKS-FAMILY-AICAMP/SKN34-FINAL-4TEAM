# STORYFORK AI Service

FastAPI 기반 내부 서비스입니다. Health와 내부 인증이 필요한 `POST /internal/v1/proposals` 생성 API를 제공합니다. 실행·검증 상태는 [콘텐츠 통합 안내](../../docs/content-integration.md)를 참고하세요.
현재 Core Service의 `core-api` 모듈이 Health와 콘텐츠 생성 API를 호출합니다. Compose에서 AI Service의 호스트 포트는 공개하지 않습니다.

## 목표 서비스 경계 (DEC-41)

[4개 서비스 구조](../../docs/design/service-boundaries.md)는 Core(회원·인증·크레딧·회원 알림), 별도 Kotlin/Spring Boot 콘텐츠 앱(창작·독서 정본·콘텐츠 인가·채택·발행), 별도 Kotlin/Spring Boot 운영 앱(문의·공지·신고 사건·운영 결정·감사·작업 감시), 이 Python AI 앱(모델 실행)으로 나뉩니다. 콘텐츠·운영은 필요한 AI 작업을 요청하며 호출·인증·사용량·정산·알림 계약은 후속 설계합니다. 현재 콘텐츠 호출자는 분리 전 `core-api`이며 별도 콘텐츠·운영 앱은 아직 없습니다. 아래 실행 명령·내부 토큰·Compose 경로는 현행 구성입니다.

## 실행과 검증

TASK 10은 `CONTENT_AI_RUN_BASE_URL`이 설정되면 실제 Content의 작업 위임 검증을 사용합니다. Compose에서는 Content 내부 origin을 전달합니다. AI에는 `INTERNAL_TOKEN`만 주고 Content의 `AI_RUN_GRANT_SECRET`은 전달하지 않습니다. 위임을 재확인한 실제 run은 아직 전문 Agent/실 검색 실행이 없어 `failed / dependency_unavailable`로 종료합니다. Mock 검색으로 대체하거나 유료 모델을 호출하지 않습니다. [실제 위임·HTTP 계약](../../docs/writing-ai-architecture/task10-api-contract.md).

Python `>=3.11,<3.15`와 uv를 사용합니다.

```bash
uv sync --locked --extra dev
uv run --locked uvicorn app.main:create_app --factory --reload --port 8000
```

로컬 개발 검증은 변경·직접 영향 범위의 **단위 테스트만** 선택합니다. TestClient·HTTP는 통합 계층이며 로컬에서 통합/시스템·전체 suite·컨테이너를 실행하지 않습니다.

```bash
uv run --locked --extra dev python -m pytest -m 'not integration' tests/test_generation.py -k missing_key
```

CI는 AI 서비스가 선택되면 lock 검사 후 pytest `-m 'not integration'` → `-m integration`으로 각각 한 번 실행합니다.
워크플로가 이 디렉터리에서 `uv run --locked --extra dev python -m pytest`와 해당 marker를 직접 호출하며 별도 runner·shell wrapper는 없습니다.
제공사 단위 테스트는 monkeypatch 대역이며 AI 계약 변경 시 Core·web 소비자와 실제 HTTP 시스템 회귀도 선택합니다.
시스템의 AI 키/모델은 빈 값으로 고정해 명시적인 503과 DB 실패 상태를 확인하며 유료 모델은 호출하지 않습니다.
자세한 선택/계층 정책은 [공통 검증](../../docs/development.md#검증)을 따릅니다. hosted `Required CI` 성공 확인 전에는 검증 대기입니다.

`GET /internal/v1/health`는 `{"status":"up","service":"storyfork-ai-service"}`를 반환합니다.
실제 흐름은 `HTTP → health/router.py → HealthResponse → JSON`입니다.
`app/main.py`는 FastAPI와 Health·generation router를 조립합니다. 시작 시 모델·네트워크 자원을 생성하지 않으므로
설정 객체·컨테이너·종료용 lifespan은 필요하지 않습니다.

## OpenAI와 향후 경계

TASK 14는 `agents/simulation.py`를 고정 `simulation` Registry에 등록했습니다. 기본 두 인물·3턴을 LangGraph에서 순차 실행하며 인물별 Content knownBy·선택 근거만 전달합니다. 비교 상태는 독립이고 시도 한도는 기본 6·비교 12·절대 14회와 남은 Run 예산 중 작은 값입니다. 무효 행동 1회 재생성, 실제 들은 주장만 기억에 추가, 가상 상태 reducer·부분 종료·인과 분석을 제공합니다. 발화는 허용된 원문 조합만 지원합니다. run별 `SimulationHandler`가 기존 호출 예약을 사용하며, 실제 모델·Content 상태 공급·공개 Run 자동 조립·정본 저장은 미연결입니다. [TASK 14 DTO·단위 결과·한계](../../docs/writing-ai-architecture/task14-handoff.md).

TASK 13은 `agents/template_recommendation.py`를 고정 `template` Registry에 등록했습니다. 검색 입력은 Content 대역에서 확인한 공개 설정의 언어·장르·태그만 사용하고 비공개 원고·자유문 검색 요청을 넘기지 않습니다. 권리·만료·판본을 재검증하며 적용된 ID·버전과 카탈로그의 명시 충돌 태그를 표시합니다. 단순 추천은 모델 0회이고 `customize=true`일 때만 선택적으로 설명 대역을 호출합니다. 실제 구매·권리 확정·설정 적용·Vector DB·공개 Run 자동 연결은 없습니다. [TASK 13 DTO·검증·인수](../../docs/writing-ai-architecture/task13-handoff.md).

TASK 12는 `agents/review.py`의 Mechanical 검사를 고정 Registry에 등록했습니다. Content 대역에서 검증한 원문과 설정 기준을 비교하며, `checkTypes`는 `names / numbers / repetition / spelling`만 허용합니다. 수치는 같은 기준 회차의 선택된 값만 확정 비교하고, 미등록 이름·중복 강조·맞춤법 후보는 의심으로 남깁니다. 맞춤법은 요청에서 제공한 표기 쌍의 단어 경계만 검사합니다. 모델·Simulation·원문 쓰기는 없으며 `MechanicalReviewHandler`를 run별로 명시 주입합니다. [TASK 12 DTO·호출 예·검증과 한계](../../docs/writing-ai-architecture/task12-handoff.md).

TASK 11은 `agents/story_context.py`의 정확 조회·근거 기반 해석을 고정 `qa` Registry에 등록했습니다. 정확 조회는 Content 대역의 선택된 설정 값/인용 span·hash·revision을 검증하며 모델·검색 0회입니다. 해석은 Wiki 인과 ref·원고 구간·coverage를 확인한 후 명시 주입한 모델 대역만 사용합니다. `StoryContextHandler`를 run별로 TaskRunner에 주입하면 예산·usage·취소를 재사용하며 본문은 checkpoint 밖에 둡니다. 실제 Content 원문 transport·실 provider·공개 API의 자동 조립은 추가하지 않았습니다. [TASK 11 입력·출력·사용 계약과 검증](../../docs/writing-ai-architecture/task11-handoff.md).

TASK 08은 `app/runs/state.py`·`graph.py`의 실제 LangGraph StateGraph로 Scope 확인→규칙 Router→고정 계획 검증→TaskRunner→검색/테스트 Agent→출력 검증→조회/합성 제안 종료를 연결합니다. `langgraph==1.2.12`와 전이 의존성을 추가했습니다. MainState와 InMemorySaver에는 참조·실행 상태만 저장하고 원고·요청문·grant는 넣지 않습니다. 실제 승인·쓰기·모델 호출·Saver 재개는 연결하지 않았으며 [TASK 08 계약과 잠금 환경 검증](../../docs/writing-ai-architecture/task08-handoff.md)을 참고하세요.

TASK 09는 `POST /internal/v1/ai/runs`, `GET /internal/v1/ai/runs/{runId}`, `POST /internal/v1/ai/runs/{runId}/cancel`을 등록했습니다. 합성 실행은 `create_app(run_service=RunService(FixtureContent(...)))`로 명시 주입하며 자동 fixture는 없습니다. TASK 10부터는 Content origin이 설정되면 실제 위임 재검증을 사용하고, 양쪽 모두 미설정이면 인증 후 503입니다. 서비스 토큰과 작업별 scope 위임을 함께 확인하고 같은 run 중복 접수는 409입니다. 상태·취소에는 `X-Internal-Token`, `X-Grant-Ref`, `X-Thread-Ref`가 필요합니다. [TASK 09 당시 계약·검증](../../docs/writing-ai-architecture/task09-handoff.md)과 [TASK 10 실제 위임 계약](../../docs/writing-ai-architecture/task10-api-contract.md)을 참고하세요.

2026-11-09 TASK 05 사용자 결정으로 **모델 호출은 모두 OpenAI API**를 사용합니다. `app/runs/routing.py`의 `OpenAIDecisionsRouterAdapter`는 명시 경로를 규칙으로 처리하고 모호한 자유문만 Decisions(`gpt-6-luna`)에 최대 1회 요청합니다. `app/runs/slots.py`는 Content가 허용한 후보로 대상을 확인합니다. 두 모듈은 아직 HTTP 실행 경로에 등록하지 않았으며 기존 이어쓰기 API는 유지합니다. 설정 추가·의존성 변경 없이 기존 `OPENAI_API_KEY`를 사용합니다. [TASK 05 계약과 검증](../../docs/writing-ai-architecture/task05-handoff.md)을 참고하세요. 아래 전체 역할·프레임워크 미정 설명은 이 공급자 결정으로 구체화됩니다.

[최신 MVP 설계](../../docs/design/design.md)의 최종 모델·제공사·에이전트 프레임워크는 미정입니다. **현재 생성 구현은 `openai` SDK의 Responses API를 사용**하며, 이는 전체 역할·다중 에이전트 구성을 확정한 것이 아닙니다. 과거 LangChain·LangGraph 제안은 확정 기술이 아닙니다. `openai-agents` 의존성은 남아 있지만 현재 실행 코드에서 Agent를 구성하지 않습니다.
Health는 키 없이 시작하고 OpenAI 클라이언트를 만들거나 호출하지 않습니다.
루트 `.env`의 `OPENAI_API_KEY`와 `OPENAI_MODEL`은 생성 요청 시 AI 런타임에서만 읽습니다.
Core와 동일한 `INTERNAL_TOKEN`이 필요합니다. Responses API의 실제 모델·응답 ID·사용량을 반환하고 정본은 변경하지 않습니다. Health 성공은 모델 접근 성공을 뜻하지 않습니다.
직접 실행은 루트 `.env`를 자동으로 읽지 않습니다. AI에 필요한 `OPENAI_API_KEY`, `OPENAI_MODEL`, `INTERNAL_TOKEN`만 해당 터미널에 설정합니다. 자동 설정 전달은 공통 `docker-compose.yaml`과 prod/dev 조합을 사용합니다([인프라 안내](../../infrastructure/README.md)).
prod는 소스 빌드 이미지, dev는 CI가 게시한 `:develop` 이미지를 사용하며 둘 다 키·모델은 AI에만, 내부 토큰은 Core·AI에만 전달합니다. 공통/prod의 모델 기본값은 비어 있고 dev의 기존 `gpt-5.6-luna` 기본값은 유지합니다. 실제 모델 접근 검증을 뜻하지 않습니다.

콘텐츠 정본·콘텐츠 인가·채택·발행은 목표 콘텐츠 서비스, 회원·인증·크레딧·회원 알림은 Core, 운영 판단은 운영 서비스가 소유하며 AI가 직접 확정하지 않습니다. 현재 허용 문맥 구성·생성 작업 기록·제안 채택은 `core-api`의 콘텐츠 코드가 담당합니다. 향후에도 문서·원고와 그래프 관계는 같은 기준 버전·허용 범위를 따라야 하며 조회 경로는 후속 설계합니다. 장애를 정상 결과로 숨기는 fallback이나 Agent별 서버는 추가하지 않습니다.

LLMOps는 운영 영역이고 Langfuse는 MVP 이후 도입 시 별도 제품으로 배포합니다. 자체 UI와 운영 화면 API 통합은 미정이며 Spring Boot로 전체 기능을 재구현하지 않습니다. AI 런타임의 계측·버전 적용과 평가 실행 위치·연동 계약도 후속 설계이며 현재 Langfuse 연동은 없습니다.
구현 기준은 [AGENTS.md](AGENTS.md), [Agent 구현 경계](docs/agent-structure.md)를 따릅니다.
