# AI Service 구현 지침

`backend/ai-service/**`에 적용한다. [루트 공통 지침](../../AGENTS.md)을 함께 따른다.
현재 내부 Health와 이어쓰기 제안 API가 있다. 콘텐츠 정본·인가·발행은 Content, 크레딧·알림은 Core가 판단한다.
현재 호출 흐름과 Spring 서비스 비교는 [AI Service 구현 경계](docs/agent-structure.md)를 본다.

## 구조

- `app/main.py`에서 기능별 Router를 조립한다. Router는 내부 호출 인증, HTTP 입출력 검증, 실행 함수 호출, 오류의 HTTP 변환을 맡는다. 모듈·엔드포인트에 한국어 docstring을 단다.
- 요청·응답은 Pydantic DTO(`Request`·`Payload`·`Response`·`Result`)로 정의한다. 임의 `dict`·외부 SDK 응답을 계약으로 노출하지 않는다.
- 기능별 패키지에 DTO와 실행 로직을 둔다. 단일 모델 호출은 구체 함수로 시작하고, 프롬프트 구성·검색·결과 검증·모델 호출의 조율이 복잡해지면 해당 기능의 `service.py`에 둔다. 모델 호출이 필요한 단계의 로직은 책임이 커질 때 `agent.py` 등으로 분리한다.
- 그래프는 반복 상태 갱신·조건 분기·중단 및 재개가 실제로 필요한 기능에서 [집필 AI 설계](../../docs/writing-ai-architecture/02-ai-architecture.md)에 따라 검토한다. 단순 호출과 조회는 직접 실행한다.
- 구체 클래스와 직접 함수 호출을 기본으로 한다. production 구현체가 둘 이상이거나 사용자가 요청하지 않으면
  `Protocol`·ABC·provider·registry·factory 추상화를 만들지 않는다. 테스트 편의를 위해 production 추상화를 추가하지 않는다.
- 모델·제공사·에이전트 프레임워크는 미정이다(DEC-28). 의존성·lockfile을 미리 바꾸지 않는다.
- 장애는 명시적 오류로 반환하고 fallback으로 숨기지 않는다. 역할·인물마다 서버나 클래스를 만들지 않는다.

## 생성 경계

- 허용 문맥과 작업 범위로만 조회하고 정본 수정·권한·승인·과금을 확정하지 않는다. 결과는 제안으로 반환한다.
- 콘텐츠 생성의 기준 버전·조회 범위·제안 저장과 채택은 Content가 소유한다. 조회 도구가 필요하면 합의된 읽기 전용 계약을 사용하고, 모델이 제시한 식별자는 인가 근거로 사용하지 않는다.
- 실행용 상태·색인은 해당 기능의 설계 계약을 따른다. 실행 완료·제안 채택·원고 반영·과금 확정은 각각 소유 서비스가 검증한다.
- 캐릭터별 허용 기억·관찰 정보를 분리하고 다른 인물의 비밀이나 미래 사건을 누출하지 않는다.
- 피드백 유형은 독자가 고르며 AI로 분류하지 않는다(BR-15). 오류 수정도 수정안까지만 생성한다.

## 변경 범위와 검증

- 로컬: `backend/ai-service`에서 `uv run --locked --extra dev python -m pytest -m 'not integration' <대상 파일> -k '<대상>'`로 단위만 실행한다.
  제공사는 monkeypatch 대역을 쓰고 FastAPI TestClient는 통합(`integration` marker)으로 분류해 CI에서 실행한다.
- 기본 단위 테스트와 CI는 모델 대역을 사용한다. 집필 AI 기능별 수용은 사용자가 요청한 개발 방식에 따라 개발용 데이터·키·호출 상한을 정하고 실제 OpenAI API로 별도 검증한다. 키·원고를 로그나 저장소에 남기지 않는다. 상세는 [집필 AI 로드맵](../../docs/writing-ai-architecture/05-implementation-roadmap.md)을 본다.
