# AI Service 구현 경계

## 현재

현재 실행 코드는 Health, 단일 OpenAI 호출을 사용하는 이어쓰기 제안 생성, 초기 세계관 후보 추출입니다.

- `app/main.py → health/router.py → HealthResponse`: 내부 상태를 반환합니다. Health에서 OpenAI 키를 요구하거나 모델 클라이언트를 생성하지 않습니다.
- `app/main.py → generation/router.py → generate → OpenAI.responses.create`: `POST /internal/v1/proposals`에서 `X-Internal-Token`을 검증하고 전달받은 문맥·요청으로 이어쓰기 제안을 생성합니다. 키·모델은 생성 요청 시 읽고 클라이언트는 요청 후 닫습니다. 미설정·제공사 실패는 503이며 모델·응답 ID·사용량을 결과에 포함합니다.
- `app/main.py → initial_world/router.py → extract`: `POST /internal/v1/initial-world/extractions`에서 Content가 고정한 입력으로 후보만 생성하고 원문 근거·기존 ID를 검증합니다. 저장·승인은 하지 않습니다.
- 생성은 Content의 [`ProposalService`](../../content-service/src/main/kotlin/ai/storyfork/content/proposal/service/ProposalService.kt)가 [`GenerationClient`](../../content-service/src/main/kotlin/ai/storyfork/content/proposal/client/GenerationClient.kt)를 통해 요청합니다. Content는 권한·기준 버전·문맥을 확인하고 DB 트랜잭션 밖에서 생성 API를 호출합니다. 응답을 받으면 기준을 다시 확인해 제안을 저장하며, 채택과 원고 반영은 별도 요청으로 처리합니다. Core의 AI 호출은 Health 확인 경로입니다.

[최신 설계](../../../docs/design/design.md)의 최종 모델·제공사·에이전트 프레임워크는 미정입니다. 현재 `openai` SDK 구현과 남아 있는 `openai-agents` 의존성을 전체 기술 선정 완료로 해석하지 않습니다.

## 기능 패키지 구조

AI 기능은 `app/<기능>/` 수직 슬라이스로 둡니다. 파일은 그 책임이 실제로 있을 때만 만들며, 모든 기능이 아래 파일을 전부 가질 필요는 없습니다.

```text
app/<기능>/
├── router.py   # 내부 인증, HTTP 입출력 검증, 실행 함수 호출, 오류의 HTTP 변환
├── models.py   # 요청·응답·structured output DTO와 그 불변식
├── prompt.py   # 모델 지시문(자료 속 명령을 따르지 않는 안전 지시 포함)
├── agent.py    # 모델 SDK 호출 1회, timeout, 제공사 오류의 기능 오류 변환
├── service.py  # 모델 밖의 실행 흐름: 입력·결과 검증, 근거 대조, 로컬 계산, 후처리
└── errors.py   # 기능 실패 경계(상태 코드·안전한 메시지)
```

- 필수는 `router.py`와 `models.py`입니다. 모델을 호출하면 `prompt.py`·`agent.py`, 결과 검증이나 모델 밖 계산이 있으면 `service.py`, 기능 고유 실패가 있으면 `errors.py`를 둡니다.
- 실행 흐름은 `HTTP → router → service → agent → OpenAI → models 검증 → service 검증 → Response`입니다. `service.py`가 하는 일이 없으면 router가 agent를 직접 호출하고 통과용 service는 만들지 않습니다.
- 임베딩·색인·검색 같은 모델 밖 처리는 service가 직접 수행하며 별도 Agent로 만들지 않습니다.

## 계층 규칙

- `router`는 내부 토큰 검증, HTTP 입출력, 기능 오류의 HTTP 변환만 담당합니다. 업무 판단·프롬프트·SDK 호출을 두지 않습니다.
- `models`는 요청 한도와 structured output의 형식·불변식을 Pydantic으로 검증합니다. 임의 `dict`·SDK 응답을 계약으로 노출하지 않습니다.
- `prompt`는 모델 지시만 담습니다. 점수 범위·식별자·근거 같은 규칙은 프롬프트에만 맡기지 않고 `models`·`service`에서 다시 검증합니다.
- `agent`는 요청 시점에 키·모델을 읽어 OpenAI 클라이언트를 만들고 호출 후 닫습니다. `store=False`, 기능별 timeout, `max_retries=0`을 쓰고 미설정·제공사 실패·불완전 응답을 기능 오류로 바꿉니다. tool·handoff·graph는 기능 계약이 요구할 때만 씁니다.
- `service`는 입력에 없던 식별자·근거·URL을 인용하지 않았는지 대조하고, 통과한 결과만 반환합니다. 잘못된 결과를 보정하거나 임의 결과로 바꾸지 않고 오류로 반환합니다.
- `errors`의 기능 실패는 상태 코드와 고정 메시지만 가집니다. 입력·원고·모델 응답·원문 예외를 오류 메시지나 로그에 넣지 않습니다.
- 시작 시 객체를 조립하는 bootstrap·DI 컨테이너·provider·registry는 두지 않습니다. 기능 사이에 공유할 코드는 둘 이상의 기능이 같은 책임을 가질 때 `app/` 아래 모듈 하나로 둡니다.
- 자동 재시도와 정상 응답을 가장하는 fallback은 추가하지 않습니다.

## 서비스 내부의 기능별 구조

**Kotlin·Spring Boot 업무 서비스**는 기능별로 `Controller → Service → Repository → PostgreSQL`을 따릅니다. Controller는 공개 HTTP 입출력, Service는 업무 규칙·권한·트랜잭션, JPA Repository는 영속성을 맡습니다. Content에서 모델 실행이 필요하면 Service가 전용 HTTP Client(`client/`, 계약 DTO는 `client/dto/`)를 통해 AI Service에 요청합니다. [Spring 계층 지침](../../core-api/AGENTS.md)

**Python·FastAPI AI Service**는 `app/main.py`에서 기능별 Router를 등록하고 위 기능 패키지 구조를 따릅니다. 생성·조회·취소·재시도가 필요한 기능은 기능 계약에서 필요한 상태와 소유자를 정합니다. [AI 구현 지침](../AGENTS.md)

## STORYFORK 서비스 경계 (DEC-41)

[4개 서비스 구조](../../../docs/design/service-boundaries.md)에 따라 Core는 회원·인증·크레딧·회원 알림, Content는 창작·독서 정본·콘텐츠 인가·채택·발행, 운영은 문의·공지·신고 사건·운영 판단·감사·작업 감시, AI는 허용된 모델 실행을 소유합니다. Content와 AI는 내부 HTTP의 요청·응답 DTO로 연결합니다. 실행 체크포인트와 색인을 도입할 경우 각 기능 계약에서 소유·복구 범위를 정하고 회차·세계관의 업무 체크포인트와 구분합니다.

LLMOps는 운영 영역입니다. Langfuse는 MVP 이후 도입 시 별도 제품으로 배포하며 자체 UI와 운영 화면 API 통합 중 방식은 미정입니다. Spring에서 제품 전체를 재구현하지 않으며 AI 계측·버전 적용·평가 실행 위치는 연동 계약에서 정합니다. 현재 Langfuse 연동은 없습니다.

## 새 기능·Agent를 추가하는 기준

파일을 나누기 위해 Agent를 추가하지 않습니다. 독립된 목표·입력·도구·평가 기준이 생길 때 새 수직 슬라이스를 만듭니다.

- [AI 구현 지침](../AGENTS.md)에 따라 기존 생성 구현을 재사용합니다. 기능별 구조화 입출력·timeout·안전한 오류 처리를 두고 요청에 허용된 최소 문맥만 사용합니다.
- 설정 추출·인물 판단·집필·피드백 역할은 실제 입력·출력·책임이 다를 때만 나눕니다. 장르·출처·인물별 Agent처럼 단순 함수나 입력 차이를 Agent로 만들지 않습니다.
- 인물별 문맥을 같은 구현에 주입하며 인물마다 클래스나 서버를 만들지 않습니다.
- 인물의 허용 지식과 다른 인물만 아는 사실·미발행 원고를 혼합하지 않습니다. 세계관 설정의 항목별 공개·비공개와 회차별 공개 범위를 적용합니다(DEC-36).
- 인물 시뮬레이션처럼 상태를 반복 갱신하거나 중단 후 이어서 실행해야 하는 기능은 [집필 AI 실행 설계](../../../docs/writing-ai-architecture/02-ai-architecture.md)에 따라 그래프를 검토합니다. 추가 의존성과 실행 계층은 기능 계약에 근거해 결정합니다.
- 외부 실패를 임의 결과로 숨기지 않습니다. 실제 OpenAI를 호출하지 않은 검증은 구분해 보고합니다.

## 테스트 배치

테스트는 `app/`의 기능 패키지와 같은 이름의 디렉터리에 계층별로 둡니다.

```text
tests/
├── <기능>/
│   ├── __init__.py
│   ├── test_models.py    # 요청 한도·structured output 불변식
│   ├── test_agent.py     # 프롬프트·SDK 호출 인자, 미설정·제공사 실패·불완전 응답 오류
│   ├── test_service.py   # 근거·식별자 대조, 후처리, 로컬 계산
│   ├── test_router.py    # 내부 인증 403, 기능 오류의 상태 코드 변환
│   ├── test_http.py      # FastAPI TestClient 경계(integration marker)
│   └── stubs.py          # 같은 기능 테스트가 상대 import로 공유하는 모델 대역
├── fixtures/<기능>/      # 계약 스키마·고정 입력
├── serve_stub.py         # 시스템 검증용 대역 서버
└── test_health.py
```

- 계층 파일은 해당 계층 파일이 있을 때만 만듭니다. 같은 파일명이 기능마다 반복되므로 각 기능 디렉터리에 `__init__.py`를 둡니다.
- 여러 계층 테스트가 같은 모델 대역을 쓰면 `stubs.py`에 두고 `from .stubs import ...`로 가져옵니다. 다른 기능의 테스트 모듈을 import하지 않습니다.
- 단위 테스트는 router·service·agent 함수를 직접 호출하고 OpenAI·로컬 모델은 monkeypatch 대역으로 바꿉니다. 실제 네트워크·키를 사용하지 않습니다.
- FastAPI TestClient·HTTP 경계는 `test_http.py`에 `pytestmark = pytest.mark.integration`으로 두고 CI에서 실행합니다.
- 고정 모델 응답과 벡터는 동작·계약 검증용입니다. 실제 생성 품질·검색 정확도 측정 결과로 보고하지 않습니다.

세부 정책과 금액·실행 한도·자동 발행 조건은 [루트 기획 목표](../../../README.md)에 남아 있습니다.
