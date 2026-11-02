# STORYFORK AI Service

FastAPI 기반 내부 서비스입니다. Health와 내부 인증이 필요한 `POST /internal/v1/proposals` 생성 API를 제공합니다. 실행·검증 상태는 [콘텐츠 통합 안내](../../docs/content-integration.md)를 참고하세요.
현재 Core Service의 `core-api` 모듈이 이 Health를 호출합니다. Compose에서 AI Service의 호스트 포트는 공개하지 않습니다.

## 실행과 검증

Python `>=3.11,<3.15`와 uv를 사용합니다.

```bash
uv sync --locked --extra dev
python3 ../../infrastructure/scripts/run-native.py ai-service
```

```bash
uv lock --check
uv run --locked --extra dev python -m pytest
```

`GET /internal/v1/health`는 `{"status":"up","service":"storyfork-ai-service"}`를 반환합니다.
실제 흐름은 `HTTP → health/router.py → HealthResponse → JSON`입니다.
`app/main.py`는 FastAPI와 Health·generation router를 조립합니다. 시작 시 모델·네트워크 자원을 생성하지 않으므로
설정 객체·컨테이너·종료용 lifespan은 필요하지 않습니다.

## OpenAI와 향후 경계

[최신 MVP 설계](../../docs/design/design.md)의 모델·제공사·프레임워크는 미정입니다. 과거 LangChain·LangGraph 제안은 확정 기술이 아닙니다(Langfuse는 MVP 이후). 현재 `openai-agents` 의존성은 Health에서 사용하지 않으며 선정 전에는 의존성·버전 범위를 바꾸지 않습니다.
Health는 키 없이 시작하고 OpenAI 클라이언트를 만들거나 호출하지 않습니다.
루트 `.env`의 `OPENAI_API_KEY`와 `OPENAI_MODEL`은 생성 요청 시 AI 런타임에서만 읽습니다.
Core와 동일한 `INTERNAL_TOKEN`이 필요합니다. Responses API의 실제 모델·응답 ID·사용량을 반환하고 정본은 변경하지 않습니다. Health 성공은 모델 접근 성공을 뜻하지 않습니다.
위 실행기는 루트 `.env`의 AI 허용 설정만 로드합니다. uvicorn 직접 실행은 `.env`를 로드하지 않습니다.

향후 AI 기능은 허용된 최소 문맥에서 제안을 반환합니다. 정본·권한·승인·발행·크레딧은 Core Service 소유이며
AI가 직접 확정하지 않습니다. 문서·원고와 그래프 관계를 해당 버전에 맞춰 참고하고, 조회 경로·모델은 선정 전까지 확정하지 않습니다. 장애를 정상 결과로 숨기는 fallback이나 Agent별 서버는 추가하지 않습니다.
구현 기준은 [AGENTS.md](AGENTS.md), [Agent 구현 경계](docs/agent-structure.md)를 따릅니다.
