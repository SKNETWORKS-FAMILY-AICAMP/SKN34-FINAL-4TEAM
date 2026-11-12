# AI Service 구현 지침

`backend/ai-service/**`에 적용한다. [루트 공통 지침](../../AGENTS.md)을 함께 따른다.
현재 내부 Health, 이어쓰기 제안, 초기 세계관 후보 추출, 원고 임베딩·Q&A(`app/manuscript/`), 웹 조사(`app/research/`, OpenAI `web_search`), 새 원고·부분 수정(`app/writing/`) API와 HTTP 연결 전의 Intent Router(`app/intent/`, OpenAI Decisions `gpt-6-luna`)가 있다. 콘텐츠 정본·인가·발행은 Content, 크레딧·알림은 Core가 판단한다.
현재 호출 흐름과 기능별 코드 구조는 [AI Service 구현 경계](docs/agent-structure.md)를 본다.

## 구조

- 기능마다 `app/<기능>/` 패키지를 두고 `app/main.py`에서 기능별 Router를 조립한다. 모듈·엔드포인트에 한국어 docstring을 단다.
- 패키지 파일은 `router.py`(내부 인증·HTTP 입출력·오류의 HTTP 변환), `models.py`(DTO와 불변식), `prompt.py`(모델 지시),
  `agent.py`(모델 SDK 호출·timeout·제공사 오류 변환), `service.py`(입력·결과 검증, 근거 대조, 모델 밖 계산), `errors.py`(기능 실패)로 나눈다.
  `router.py`·`models.py`만 필수이며 나머지는 그 책임이 있을 때만 만든다. 통과만 하는 service·빈 파일을 만들지 않는다. 계층 규칙은 [구현 경계](docs/agent-structure.md#계층-규칙)를 따른다.
- 요청·응답은 Pydantic DTO(`Request`·`Payload`·`Response`·`Result`)로 정의한다. 임의 `dict`·외부 SDK 응답을 계약으로 노출하지 않는다.
- 프롬프트에 맡긴 규칙(식별자·근거·URL·점수 범위)은 `models`·`service`에서 다시 검증하고, 어긋난 결과는 보정하지 않고 오류로 반환한다.
- 임베딩·색인·검색 같은 모델 밖 처리는 service가 직접 수행한다. 파일을 나누려고 Agent를 만들지 않는다.
- 그래프는 반복 상태 갱신·조건 분기·중단 및 재개가 실제로 필요한 기능에서 [집필 AI 설계](../../docs/writing-ai-architecture/02-ai-architecture.md)에 따라 검토한다. 단순 호출과 조회는 직접 실행한다.
- 구체 클래스와 직접 함수 호출을 기본으로 한다. production 구현체가 둘 이상이거나 사용자가 요청하지 않으면
  `Protocol`·ABC·provider·registry·factory·bootstrap 추상화를 만들지 않는다. 테스트 편의를 위해 production 추상화를 추가하지 않는다.
- 모델·제공사·에이전트 프레임워크는 미정이다(DEC-28). 단, Intent Router는 사용자 결정으로 OpenAI Decisions(`gpt-6-luna`)를 쓴다. 의존성·lockfile을 미리 바꾸지 않는다.
- 장애는 명시적 오류로 반환하고 fallback·자동 재시도로 숨기지 않는다. 입력·원고·모델 응답을 오류 메시지나 로그에 넣지 않는다. 역할·인물마다 서버나 클래스를 만들지 않는다.

## 생성 경계

- 허용 문맥과 작업 범위로만 조회하고 정본 수정·권한·승인·과금을 확정하지 않는다. 결과는 제안으로 반환한다.
- 콘텐츠 생성의 기준 버전·조회 범위·제안 저장과 채택은 Content가 소유한다. 조회 도구가 필요하면 합의된 읽기 전용 계약을 사용하고, 모델이 제시한 식별자는 인가 근거로 사용하지 않는다.
- 실행용 상태·색인은 해당 기능의 설계 계약을 따른다. 실행 완료·제안 채택·원고 반영·과금 확정은 각각 소유 서비스가 검증한다.
- 캐릭터별 허용 기억·관찰 정보를 분리하고 다른 인물의 비밀이나 미래 사건을 누출하지 않는다.
- 피드백 유형은 독자가 고르며 AI로 분류하지 않는다(BR-15). 오류 수정도 수정안까지만 생성한다.

## 변경 범위와 검증

- 테스트는 `tests/<기능>/`에 계층별 `test_models.py`·`test_agent.py`·`test_service.py`·`test_router.py`로 두고 각 디렉터리에 `__init__.py`를 둔다.
  TestClient 경계는 같은 디렉터리의 `test_http.py`(integration marker)에 둔다. [테스트 배치](docs/agent-structure.md#테스트-배치)
- 로컬: `backend/ai-service`에서 `uv run --locked --extra dev python -m pytest -m 'not integration' <대상 파일> -k '<대상>'`로 단위만 실행한다.
  제공사는 monkeypatch 대역을 쓰고 FastAPI TestClient는 통합(`integration` marker)으로 분류해 CI에서 실행한다.
- 기본 단위 테스트와 CI는 모델 대역을 사용한다. 집필 AI 기능별 수용은 사용자가 요청한 개발 방식에 따라 개발용 데이터·키·호출 상한을 정하고 실제 OpenAI API로 별도 검증한다. 키·원고를 로그나 저장소에 남기지 않는다. 상세는 [집필 AI 로드맵](../../docs/writing-ai-architecture/05-implementation-roadmap.md)을 본다.
