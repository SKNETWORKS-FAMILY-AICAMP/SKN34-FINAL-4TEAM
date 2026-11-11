# AI Service 구현 경계

## 현재

현재 실행 코드는 Health와 단일 OpenAI 호출을 사용하는 이어쓰기 제안 생성입니다.

- `app/main.py → health/router.py → HealthResponse`: 내부 상태를 반환합니다. Health에서 OpenAI 키를 요구하거나 모델 클라이언트를 생성하지 않습니다.
- `app/main.py → generation/router.py → generate → OpenAI.responses.create`: `POST /internal/v1/proposals`에서 `X-Internal-Token`을 검증하고 전달받은 문맥·요청으로 이어쓰기 제안을 생성합니다. 키·모델은 생성 요청 시 읽고 클라이언트는 요청 후 닫습니다. 미설정·제공사 실패는 503이며 모델·응답 ID·사용량을 결과에 포함합니다.
- 생성은 Content의 [`ProposalService`](../../content-service/src/main/kotlin/ai/storyfork/content/proposal/service/ProposalService.kt)가 [`GenerationClient`](../../content-service/src/main/kotlin/ai/storyfork/content/proposal/client/GenerationClient.kt)를 통해 요청합니다. Content는 권한·기준 버전·문맥을 확인하고 DB 트랜잭션 밖에서 생성 API를 호출합니다. 응답을 받으면 기준을 다시 확인해 제안을 저장하며, 채택과 원고 반영은 별도 요청으로 처리합니다. Core의 AI 호출은 Health 확인 경로입니다.

[최신 설계](../../../docs/design/design.md)의 최종 모델·제공사·에이전트 프레임워크는 미정입니다. 현재 `openai` SDK 구현과 남아 있는 `openai-agents` 의존성을 전체 기술 선정 완료로 해석하지 않습니다.

## GovBiz의 FastAPI와 Spring Boot 비교

비교 기준은 GovBiz `main`의 [`a07e8d1d`](https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-4th-1Team/commit/a07e8d1d263ce9adb7b6bb41153fa46e7a8a7b53)입니다. 두 런타임 모두 기능 중심으로 코드를 배치합니다. Spring은 업무 규칙과 영속성을 계층으로 나누고, FastAPI는 각 기능의 모델·검색 실행에 필요한 구성 요소를 둡니다. [GovBiz 구현 지침](https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-4th-1Team/blob/a07e8d1d263ce9adb7b6bb41153fa46e7a8a7b53/AGENTS.md)

| 관점 | GovBiz 소스에서 확인한 구조 | STORYFORK 적용 |
|---|---|---|
| Spring 업무 API | `core-service`는 `Controller → Service → Repository → MyBatis → MySQL`로 사용자 업무를 처리하고, `catalog-service`는 공고 수집·원본을 소유합니다. 모델 요청은 Core의 전용 HTTP Client가 전달합니다. [호출 Client](https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-4th-1Team/blob/a07e8d1d263ce9adb7b6bb41153fa46e7a8a7b53/backend/core-service/src/main/kotlin/ai/govbiz/core/assistant/client/AiAssistantClient.kt) · [Catalog Repository](https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-4th-1Team/blob/a07e8d1d263ce9adb7b6bb41153fa46e7a8a7b53/backend/catalog-service/src/main/kotlin/ai/govbiz/catalog/supportprogram/repository/SupportProgramRepository.kt) | Core·Content의 기능별 Spring MVC와 JPA·PostgreSQL을 따릅니다. 콘텐츠 생성은 Content가 내부 AI API를 호출합니다. |
| FastAPI 실행 경로 | `create_app`이 Router와 구체 의존성을 조립하고, 기능 Router는 Pydantic 계약으로 실행 서비스를 호출합니다. 도우미는 LangGraph에서 분류 → 도구 계획·실행 → 답변·검증을 분기하고, 색인은 별도 서비스가 OpenAI 임베딩과 Qdrant를 직접 호출합니다. [앱 조립](https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-4th-1Team/blob/a07e8d1d263ce9adb7b6bb41153fa46e7a8a7b53/backend/ai-service/app/main.py) · [도우미 그래프](https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-4th-1Team/blob/a07e8d1d263ce9adb7b6bb41153fa46e7a8a7b53/backend/ai-service/app/assistant_agent/graph.py) · [색인 서비스](https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-4th-1Team/blob/a07e8d1d263ce9adb7b6bb41153fa46e7a8a7b53/backend/ai-service/app/support_program_index/service.py) | 단일 작업은 `Router → 실행 함수 → 모델 SDK`로 시작합니다. 필요한 기능만 실행 서비스·검색·그래프를 분리합니다. |
| 권한과 비동기 작업 | 도우미가 계정에 묶인 토큰으로 Core의 읽기 전용 도구를 호출합니다. 중복 지원 검토는 Spring Core가 작업을 등록·선점하고 RabbitMQ 소비 경로에서 AI에 분석을 요청한 뒤 상태와 결과를 저장합니다. [도구 Client](https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-4th-1Team/blob/a07e8d1d263ce9adb7b6bb41153fa46e7a8a7b53/backend/ai-service/app/assistant_agent/tools.py) · [검토 실행 서비스](https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-4th-1Team/blob/a07e8d1d263ce9adb7b6bb41153fa46e7a8a7b53/backend/core-service/src/main/kotlin/ai/govbiz/core/combinationreview/service/CombinationReviewRunService.kt) · [큐 소비자](https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-4th-1Team/blob/a07e8d1d263ce9adb7b6bb41153fa46e7a8a7b53/backend/core-service/src/main/kotlin/ai/govbiz/core/combinationreview/service/CombinationReviewRunConsumer.kt) | 공개 인가·정본 반영은 업무 소유 서비스에 둡니다. 생성·조회·취소·재시도는 해당 기능의 계약에서 필요한 상태와 책임을 정합니다. |

## STORYFORK 서비스 경계 (DEC-41)

[4개 서비스 구조](../../../docs/design/service-boundaries.md)에 따라 Core는 회원·인증·크레딧·회원 알림, Content는 창작·독서 정본·콘텐츠 인가·채택·발행, 운영은 문의·공지·신고 사건·운영 판단·감사·작업 감시, AI는 허용된 모델 실행을 소유합니다. Content와 AI는 내부 HTTP의 요청·응답 DTO로 연결합니다. 실행 체크포인트와 색인을 도입할 경우 각 기능 계약에서 소유·복구 범위를 정하고 회차·세계관의 업무 체크포인트와 구분합니다.

LLMOps는 운영 영역입니다. Langfuse는 MVP 이후 도입 시 별도 제품으로 배포하며 자체 UI와 운영 화면 API 통합 중 방식은 미정입니다. Spring에서 제품 전체를 재구현하지 않으며 AI 계측·버전 적용·평가 실행 위치는 연동 계약에서 정합니다. 현재 Langfuse 연동은 없습니다.

## AI 역할을 확장할 때

- [AI 구현 지침](../AGENTS.md)에 따라 기존 생성 구현을 재사용합니다. 기능별 구조화 입출력·timeout·안전한 오류 처리를 두고 요청에 허용된 최소 문맥만 사용합니다.
- 설정 추출·인물 판단·집필·피드백 역할은 실제 입력·출력·책임이 다를 때만 나눕니다.
- 인물별 문맥을 같은 구현에 주입하며 인물마다 클래스나 서버를 만들지 않습니다.
- 인물의 허용 지식과 다른 인물만 아는 사실·미발행 원고를 혼합하지 않습니다. 세계관 설정의 항목별 공개·비공개와 회차별 공개 범위를 적용합니다(DEC-36).
- 에이전트의 반복 상태 갱신·중단 및 재개가 필요한 경우 [집필 AI 실행 설계](../../../docs/writing-ai-architecture/02-ai-architecture.md)를 따릅니다. GovBiz의 그래프·Qdrant·RabbitMQ는 비교 사례이며 STORYFORK의 추가 의존성과 실행 계층은 기능 계약에 근거해 결정합니다.
- 외부 실패를 임의 결과로 숨기지 않습니다. 실제 OpenAI를 호출하지 않은 검증은 구분해 보고합니다.

세부 정책과 금액·실행 한도·자동 발행 조건은 [루트 기획 목표](../../../README.md)에 남아 있습니다.
