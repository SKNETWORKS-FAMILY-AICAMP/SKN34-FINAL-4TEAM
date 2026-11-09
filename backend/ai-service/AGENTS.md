# AI Service 구현 지침

`backend/ai-service/**`에 적용한다. [루트 공통 지침](../../AGENTS.md)을 함께 따른다.
현재 내부 Health와 이어쓰기 제안 API가 있다. 콘텐츠 정본·인가·발행은 Content, 크레딧·알림은 Core가 판단한다.

## 구조

- FastAPI Router는 입력 검증, 업무 함수 호출, 응답 변환만 한다. 모듈·엔드포인트에 한국어 docstring을 단다.
- 요청·응답은 Pydantic DTO(`Request`·`Payload`·`Response`·`Result`)로 정의한다. 임의 `dict`·외부 SDK 응답을 계약으로 노출하지 않는다.
- 구체 클래스와 직접 함수 호출을 기본으로 한다. production 구현체가 둘 이상이거나 사용자가 요청하지 않으면
  `Protocol`·ABC·provider·registry·factory 추상화를 만들지 않는다. 테스트 편의를 위해 production 추상화를 추가하지 않는다.
- 2026-11-09 사용자 결정: 모델 호출은 OpenAI API, TASK 05 분류는 Decisions(`gpt-6-luna`)를 사용한다.
  TASK 08의 Main 실행 조립은 LangGraph StateGraph를 사용한다. 개별 Agent 구성·운영 연결은 후속 범위다.
  요청된 단계에 필요한 경우 외에는 의존성·lockfile을 미리 바꾸지 않는다.
- 장애는 명시적 오류로 반환하고 fallback으로 숨기지 않는다. 역할·인물마다 서버나 클래스를 만들지 않는다.

## 생성 경계

- 허용 문맥과 작업 범위로만 조회하고 정본 수정·권한·승인·과금을 확정하지 않는다. 결과는 제안으로 반환한다.
- 캐릭터별 허용 기억·관찰 정보를 분리하고 다른 인물의 비밀이나 미래 사건을 누출하지 않는다.
- 피드백 유형은 독자가 고르며 AI로 분류하지 않는다(BR-15). 오류 수정도 수정안까지만 생성한다.

## 변경 범위와 검증

- 로컬: `backend/ai-service`에서 `uv run --locked --extra dev python -m pytest -m 'not integration' <대상 파일> -k '<대상>'`로 단위만 실행한다.
  제공사는 monkeypatch 대역을 쓰고 FastAPI TestClient는 통합(`integration` marker)으로 분류해 CI에서 실행한다.
- 유료 OpenAI 호출은 하지 않는다. 상세는 [AI README](README.md)와 [Agent 구조](docs/agent-structure.md)를 본다.
