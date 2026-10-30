# STORYFORK AI Service

FastAPI 기반 내부 서비스 개발 기반입니다. 현재는 **Health만** 제공하며 Agent나 생성 API는 없습니다.
Core API만 호출하고 Compose에서 호스트 포트를 공개하지 않습니다.

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
`app/main.py`는 FastAPI와 Health router만 조립합니다. 모델·네트워크 자원을 생성하지 않으므로
설정 객체·컨테이너·종료용 lifespan은 필요하지 않습니다.

## OpenAI와 향후 경계

AI 스택은 LangChain·LangGraph로 정했습니다(Langfuse 추적은 MVP 이후). 현재 `openai-agents` 의존성은 첫 AI 기능 구현 시 교체하며, 그 전에는 의존성·버전 범위를 바꾸지 않습니다.
Health는 키 없이 시작하고 OpenAI 클라이언트를 만들거나 호출하지 않습니다.
루트 `.env.example`의 `OPENAI_API_KEY`와 `OPENAI_MODEL`은 향후 AI 런타임용 예약 설정일 뿐
현재 코드에서 읽지 않습니다. 키를 채워도 생성 기능이 동작하지 않으며 모델 접근을 검증하지 않습니다.
위 실행기는 루트 `.env`의 AI 허용 설정만 로드합니다. uvicorn 직접 실행은 `.env`를 로드하지 않습니다.

향후 AI 기능은 허용된 최소 문맥에서 제안을 반환합니다. 정본·권한·승인·발행·크레딧은 Core 소유이며
AI가 직접 확정하지 않습니다. 다른 provider wrapper, fallback, Agent별 서버를 추가하지 않습니다.
구현 기준은 [AGENTS.md](AGENTS.md), [Agent 구현 경계](docs/agent-structure.md)를 따릅니다.
