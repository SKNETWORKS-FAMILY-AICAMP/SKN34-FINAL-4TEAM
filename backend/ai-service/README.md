# STORYFORK AI Service

FastAPI 기반 내부 서비스입니다. Health와 내부 인증이 필요한 `POST /internal/v1/proposals` 생성 API를 제공합니다. 실행·검증 상태는 [콘텐츠 통합 안내](../../docs/content-integration.md)를 참고하세요.
현재 Core Service의 `core-api` 모듈이 Health와 콘텐츠 생성 API를 호출합니다. Compose에서 AI Service의 호스트 포트는 공개하지 않습니다.

## 목표 서비스 경계 (DEC-41)

[4개 서비스 구조](../../docs/design/service-boundaries.md)는 Core(회원·인증·크레딧·회원 알림), 별도 Kotlin/Spring Boot 콘텐츠 앱(창작·독서 정본·콘텐츠 인가·채택·발행), 별도 Kotlin/Spring Boot 운영 앱(문의·공지·신고 사건·운영 결정·감사·작업 감시), 이 Python AI 앱(모델 실행)으로 나뉩니다. 콘텐츠·운영은 필요한 AI 작업을 요청하며 호출·인증·사용량·정산·알림 계약은 후속 설계합니다. 현재 콘텐츠 호출자는 분리 전 `core-api`이며 별도 콘텐츠·운영 앱은 아직 없습니다. 아래 실행 명령·내부 토큰·Compose 경로는 현행 구성입니다.

## 실행과 검증

Python `>=3.11,<3.15`와 uv를 사용합니다.

```bash
uv sync --locked --extra dev
uv run --locked uvicorn app.main:create_app --factory --reload --port 8000
```

로컬 개발 검증은 변경·직접 영향 범위의 **단위 테스트만** 선택합니다. TestClient·HTTP는 통합 계층이며 로컬에서 통합/시스템·전체 suite·컨테이너를 실행하지 않습니다.

```bash
uv run --locked --extra dev python -m pytest -m 'not integration' tests/generation/test_agent.py -k missing_key
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

[최신 MVP 설계](../../docs/design/design.md)의 최종 모델·제공사·에이전트 프레임워크는 미정입니다. **현재 생성 구현은 `openai` SDK의 Responses API를 사용**하며, 이는 전체 역할·다중 에이전트 구성을 확정한 것이 아닙니다. 집필 AI 복합 실행은 사용자 요청으로 LangGraph를, 인물 시뮬레이션의 장면 에이전트는 사용자 결정(2026-11-14, #362)으로 LangChain `create_agent` + 미들웨어를 쓰며(연출 결정은 `langchain-typesafe`로 OpenAI Decisions 호출), 그 밖의 에이전트 구성은 확정하지 않았습니다. `openai-agents` 의존성은 남아 있지만 현재 실행 코드에서 Agent를 구성하지 않습니다.
Health는 키 없이 시작하고 OpenAI 클라이언트를 만들거나 호출하지 않습니다.
루트 `.env`의 `OPENAI_API_KEY`와 `OPENAI_MODEL`은 생성 요청 시 AI 런타임에서만 읽습니다.
Core와 동일한 `INTERNAL_TOKEN`이 필요합니다. Responses API의 실제 모델·응답 ID·사용량을 반환하고 정본은 변경하지 않습니다. Health 성공은 모델 접근 성공을 뜻하지 않습니다.
직접 실행은 루트 `.env`를 자동으로 읽지 않습니다. AI에 필요한 `OPENAI_API_KEY`, `OPENAI_MODEL`, `INTERNAL_TOKEN`만 해당 터미널에 설정합니다. 자동 설정 전달은 공통 `docker-compose.yaml`과 prod/dev 조합을 사용합니다([인프라 안내](../../infrastructure/README.md)).
prod는 소스 빌드 이미지, dev는 CI가 게시한 `:develop` 이미지를 사용하며 둘 다 키·모델은 AI에만, 내부 토큰은 Core·AI에만 전달합니다. 공통/prod의 모델 기본값은 비어 있고 dev의 기존 `gpt-5.6-luna` 기본값은 유지합니다. 실제 모델 접근 검증을 뜻하지 않습니다.

콘텐츠 정본·콘텐츠 인가·채택·발행은 목표 콘텐츠 서비스, 회원·인증·크레딧·회원 알림은 Core, 운영 판단은 운영 서비스가 소유하며 AI가 직접 확정하지 않습니다. 현재 허용 문맥 구성·생성 작업 기록·제안 채택은 `core-api`의 콘텐츠 코드가 담당합니다. 향후에도 문서·원고와 그래프 관계는 같은 기준 버전·허용 범위를 따라야 하며 조회 경로는 후속 설계합니다. 장애를 정상 결과로 숨기는 fallback이나 Agent별 서버는 추가하지 않습니다.

LLMOps는 운영 영역이고 Langfuse는 MVP 이후 도입 시 별도 제품으로 배포합니다. 자체 UI와 운영 화면 API 통합은 미정이며 Spring Boot로 전체 기능을 재구현하지 않습니다. AI 런타임의 계측·버전 적용과 평가 실행 위치·연동 계약도 후속 설계이며 현재 Langfuse 연동은 없습니다.
구현 기준은 [AGENTS.md](AGENTS.md), [Agent 구현 경계](docs/agent-structure.md)를 따릅니다.

## 초기 세계관 추출 (5-B)

`POST /internal/v1/initial-world/extractions`는 기존 내부 토큰·OpenAI 설정으로 #219 Input을 받아 검증된 후보 Output만 반환합니다. 실제 모델 호출 경로는 구현했지만 유료 호출·추출 품질은 미검증입니다. 저장·승인·Content 실행 연결은 제외하며 [호출/실패 계약과 검증 한계](../../docs/design/initial-world-ai-extraction.md)를 따릅니다. 기존 이어쓰기 API는 유지합니다.
