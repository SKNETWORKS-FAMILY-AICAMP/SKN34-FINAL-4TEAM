# AI Service 구현 경계

## 현재

현재 실행 코드는 Health와 단일 OpenAI 호출을 사용하는 이어쓰기 제안 생성입니다.

- `app/main.py → health/router.py → HealthResponse`: 내부 상태를 반환합니다. Health에서 OpenAI 키를 요구하거나 모델 클라이언트를 생성하지 않습니다.
- `app/main.py → generation/router.py → generate → OpenAI.responses.create`: `POST /internal/v1/proposals`에서 `X-Internal-Token`을 검증하고 전달받은 문맥·요청으로 이어쓰기 제안을 생성합니다. 키·모델은 생성 요청 시 읽고 클라이언트는 요청 후 닫습니다. 미설정·제공사 실패는 503이며 모델·응답 ID·사용량을 결과에 포함합니다.
- 생성은 Content의 [`ProposalService`](../../content-service/src/main/kotlin/ai/storyfork/content/proposal/service/ProposalService.kt)가 [`GenerationClient`](../../content-service/src/main/kotlin/ai/storyfork/content/proposal/client/GenerationClient.kt)를 통해 요청합니다. Content는 권한·기준 버전·문맥을 확인하고 DB 트랜잭션 밖에서 생성 API를 호출합니다. 응답을 받으면 기준을 다시 확인해 제안을 저장하며, 채택과 원고 반영은 별도 요청으로 처리합니다. Core의 AI 호출은 Health 확인 경로입니다.

[최신 설계](../../../docs/design/design.md)의 최종 모델·제공사·에이전트 프레임워크는 미정입니다. 현재 `openai` SDK 구현과 남아 있는 `openai-agents` 의존성을 전체 기술 선정 완료로 해석하지 않습니다.

## 서비스 내부의 기능별 구조

**Kotlin·Spring Boot 업무 서비스**는 기능별로 `Controller → Service → Repository → PostgreSQL`을 따릅니다. Controller는 공개 HTTP 입출력, Service는 업무 규칙·권한·트랜잭션, JPA Repository는 영속성을 맡습니다. Content에서 모델 실행이 필요하면 Service가 전용 HTTP Client를 통해 AI Service에 요청합니다. [Spring 계층 지침](../../core-api/AGENTS.md)

**Python·FastAPI AI Service**는 `app/main.py`에서 기능별 Router를 등록합니다. Router는 내부 인증과 Pydantic 요청·응답 계약을 맡습니다. 단일 생성은 `Router → 실행 함수 → 모델 SDK`로 구성합니다. 검색·프롬프트·결과 검증을 함께 조율하는 기능은 해당 패키지의 `service.py`에 실행 흐름을 두고, 모델 단계의 책임이 커지면 `agent.py`로 분리합니다. 생성·조회·취소·재시도가 필요한 기능은 기능 계약에서 필요한 상태와 소유자를 정합니다. [AI 구현 지침](../AGENTS.md)

## STORYFORK 서비스 경계 (DEC-41)

[4개 서비스 구조](../../../docs/design/service-boundaries.md)에 따라 Core는 회원·인증·크레딧·회원 알림, Content는 창작·독서 정본·콘텐츠 인가·채택·발행, 운영은 문의·공지·신고 사건·운영 판단·감사·작업 감시, AI는 허용된 모델 실행을 소유합니다. Content와 AI는 내부 HTTP의 요청·응답 DTO로 연결합니다. 실행 체크포인트와 색인을 도입할 경우 각 기능 계약에서 소유·복구 범위를 정하고 회차·세계관의 업무 체크포인트와 구분합니다.

LLMOps는 운영 영역입니다. Langfuse는 MVP 이후 도입 시 별도 제품으로 배포하며 자체 UI와 운영 화면 API 통합 중 방식은 미정입니다. Spring에서 제품 전체를 재구현하지 않으며 AI 계측·버전 적용·평가 실행 위치는 연동 계약에서 정합니다. 현재 Langfuse 연동은 없습니다.

## AI 역할을 확장할 때

- [AI 구현 지침](../AGENTS.md)에 따라 기존 생성 구현을 재사용합니다. 기능별 구조화 입출력·timeout·안전한 오류 처리를 두고 요청에 허용된 최소 문맥만 사용합니다.
- 설정 추출·인물 판단·집필·피드백 역할은 실제 입력·출력·책임이 다를 때만 나눕니다.
- 인물별 문맥을 같은 구현에 주입하며 인물마다 클래스나 서버를 만들지 않습니다.
- 인물의 허용 지식과 다른 인물만 아는 사실·미발행 원고를 혼합하지 않습니다. 세계관 설정의 항목별 공개·비공개와 회차별 공개 범위를 적용합니다(DEC-36).
- 인물 시뮬레이션처럼 상태를 반복 갱신하거나 중단 후 이어서 실행해야 하는 기능은 [집필 AI 실행 설계](../../../docs/writing-ai-architecture/02-ai-architecture.md)에 따라 그래프를 검토합니다. 추가 의존성과 실행 계층은 기능 계약에 근거해 결정합니다.
- 외부 실패를 임의 결과로 숨기지 않습니다. 실제 OpenAI를 호출하지 않은 검증은 구분해 보고합니다.

세부 정책과 금액·실행 한도·자동 발행 조건은 [루트 기획 목표](../../../README.md)에 남아 있습니다.
