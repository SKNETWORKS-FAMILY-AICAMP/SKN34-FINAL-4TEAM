# STORYFORK 집필 AI의 출발점

2026-11-08 기준 로컬 `develop`의 `79855bf`를 조사했다. Graphify의 1,762개 노드에서 Fork·회차·제안을 찾은 뒤 아래 마이그레이션과 서비스 본문으로 대조했다. 데이터베이스 관련 사실은 **소스가 정의하는 물리 구조**다. 운영 DB의 적용 버전, 기존 데이터의 완전성, 서비스 배포 여부는 조사 범위 밖이다.

## 지금 이어쓰기를 요청하면

1. 웹이 공개 `POST /api/v1/works/{id}/proposals`로 요청한다. Content는 사용자 Bearer를 Core의 `POST /internal/v1/auth/verify`로 확인하고 반환된 회원 ID로 작품 소유권을 검사한다. [인증 클라이언트](../../backend/content-service/src/main/kotlin/ai/storyfork/content/auth/client/CoreAuthClient.kt)
2. `ProposalService.propose`는 작품 revision과 작성 대상 회차를 검사한다. `ContextService.read`가 기준 회차, 공개 범위, 인물의 knownBy를 적용한다. 일반 요청은 최근 공개 회차 최대 3개의 발췌를 사용한다. 인물 지정 시 일반 발췌와 작성 중 원고를 제외한다. 현재 계약만으로 1~100화 전체 사건을 검토했다고 할 수 없다. [문맥 서비스](../../backend/content-service/src/main/kotlin/ai/storyfork/content/context/service/ContextService.kt)
3. Content는 job과 호출을 기록한 뒤 DB 트랜잭션 밖에서 Python 내부 API를 호출한다. `propose`는 내부 토큰과 문맥 길이를 검사한다. `generate`는 OpenAI Responses를 동기 호출하며 `store=False`, 출력 상한 1,800토큰을 사용한다. 제공사 실패는 503이다. [AI 엔드포인트](../../backend/ai-service/app/generation/router.py)
4. Content가 문맥과 revision을 다시 읽고 입력 스냅샷·제안·근거·호출량을 기록한다. 작가가 별도 `POST /api/v1/works/{id}/proposals/{pid}/accept`를 호출하면 대상과 현재 문맥을 재검증한 뒤 원고에 덧붙이고 버전·결정·적용 결과를 기록한다. 중복 수락은 현재 409다. [제안 서비스](../../backend/content-service/src/main/kotlin/ai/storyfork/content/proposal/service/ProposalService.kt)

## 실행 구조와 확장 위치

| 영역 | 소스에서 확인한 동작 | 설계 연결점 |
|---|---|---|
| Web | React 19, TypeScript, Vite, pnpm, Redux Toolkit·Awilix, MVVM, Vitest. nginx 공개 진입점. `/content` 및 UUID Studio와 메모리 데모의 데이터 경로가 다르다. | 기존 인증 fetch와 취소 처리 재사용. 선택 구간·revision을 새 AI 요청에 전달. [패키지](../../frontend/package.json) · [프록시](../../frontend/nginx.conf) |
| Kotlin 서비스 | JVM 21, Spring Boot 4, MVC, JPA, JDBC, Flyway, Gradle. 기능별 controller/service/repository. Core 인증·회원, Content 업무 인가·저장, Operations 골격. | Content가 공개 작업 API와 소유권 검사 담당. DB 공유 여부와 무관하게 서비스 간 SQL 쓰기 금지. [빌드](../../backend/content-service/build.gradle) · [서비스 경계](../design/service-boundaries.md) |
| AI | Python 3.11 이상 3.15 미만, FastAPI·Pydantic·uvicorn, uv.lock, pytest. openai-agents 의존성이 있지만 이어쓰기 경로는 OpenAI SDK 직접 호출. | 기존 Python 앱에 StateGraph를 추가하는 **제안**. 기존 API를 유지하며 신규 작업만 새 경로로 연결. [의존성](../../backend/ai-service/pyproject.toml) · [앱](../../backend/ai-service/app/main.py) |
| 진행 알림 | Core 회원 알림 SSE와 웹 fetch 스트림의 재연결·세션 교체 처리 존재. 현재 이어쓰기 HTTP는 동기 응답이고 AI 작업 전용 SSE는 신규. | 알림함과 별도 run 이벤트 계약. 알림 클라이언트의 인증·중단 방식을 참고. [웹 구현](../../frontend/src/data/api/notificationStream.ts) |
| 실행·검증 | 루트 .env 기준 서비스별 주입. Compose·네이티브 실행, GitHub Actions가 변경 경로별 단위·통합·HTTP 시스템 검사 선택. | 모델 키는 AI에만 전달. 실제 메일·모델 호출 없이 CI 대역 검증. [개발 안내](../development.md) · [CI 선택기](../../infrastructure/ci/ci.py) |

## 데이터와 소유권

아래에서 `id`는 해당 테이블 PK, 화살표는 FK 또는 명시한 애플리케이션 참조다. Content의 Kotlin 경로는 [기능 패키지 루트](../../backend/content-service/src/main/kotlin/ai/storyfork/content) 아래다. 각 기능의 `entity/`·`repository/`가 저장 구조를, `service/`가 권한·버전 규칙을 담당한다. [Content 실제 SQL](../../backend/content-service/src/main/resources/db/migration) · [Core 인증 SQL](../../backend/core-api/src/main/resources/db/migration/auth)

| 도메인 | 현재 키·관계·관련 코드 | AI에 허용할 읽기 및 제안 / 필요한 확장 |
|---|---|---|
| 사용자·작업공간 | Core `auth_member.id`(UUID), `auth_session`·`auth_refresh_token`. Content `member.id`는 자격증명 없는 로컬 참조. `work.owner_id → member.id`. | 별도 workspace 테이블을 전제하지 않는다. 회원 식별 결과와 소유 작품·대화 범위만 사용. 회원 수정 대상 없음. |
| 작품·권리 | `work(id,revision,origin_kind,creation_type)`, `work_genre`, `work_rights_declaration`. `work/entity/WorkEntity.kt`, `WorkAccessService`. | 장르·제목·허용 revision 조회. 공개 또는 소유가 외부 모델 처리·템플릿 라이선스까지 보장하지 않으므로 용도별 허용 확인. |
| 회차·원고 | `episode(id,work_id,sequence)`는 작품 내 순번 유일. `episode_draft.episode_id`는 PK/FK, `content,edit_revision`. `episode_version(id,episode_id,content_version_id,revision_no,restored_from_id)`는 불변. `publication_event`와 `episode_current`로 공개판 선택. `EpisodeRepository`, `EpisodeVersionService`. | 발행판과 소유자의 작성 중 원고를 구별. 인용은 버전+범위, 수정안은 원본 해시+기준 revision. 기존 저장 기능을 재사용. |
| Fork | 복제 작품 자체가 `fork.work_id`(PK), `source_work_id`와 `source_checkpoint_id`가 출처. `checkpoint_episode`가 회차 버전, `checkpoint_setting`이 설정 버전 고정. `fork_world_reference.reference_status`는 following/independent. `fork/service/ForkService.kt`. | 본 작업의 work는 항상 대상 작품. Fork도 자체 work ID 사용. 기준 회차에 영향을 주는 허용 원본 변경만 추적하고 독립 후에는 사용자 결정으로 반영. 타 Fork 검색 금지. |
| 설정·인물 지식 | `work_world_history`가 work와 world 연결. `setting_document(id,world_id,logical_id)` → `setting_version`, `setting_draft`. `setting_visibility_range`와 `setting_knowledge_scope(setting_version_id,character_name)`. `WorldService`. | 인물·규칙·지식 등은 설정 분류로 표현 가능. 동명이인/개명은 이름으로 임의 결합하지 않는다. 사용자에게 카드 선택 요청. 설정 변경에는 버전 고정. |
| 독립 WorldStudio | `worldstudio.world(id,owner_subject,current_revision_id)`와 `world_draft`, `setting_card`·draft·version 및 `world_revision_card`. `WorldStudioService`. Content의 work에 같은 UUID의 Studio world가 있다고 가정할 수 없다. | 명시적 작품 연결과 권한·시점 계약이 성립할 때만 카드 사용. 인물·설정 버전 복구 규칙 보존. |
| 관계 | Neo4j `StudioRelationshipWorld → HAS_RELATION → StudioRelationship → SOURCE/TARGET → StudioCard`. PG `worldstudio.relationship_state(world_id,graph_version,request_key,request_hash,completed)`. V1 관계 이력 구조는 보존 대상. | Content가 확인한 현재 그래프만 조회. 완료 메타데이터 누락·버전 불일치는 오류. 과거 관계 조회/전체 복원 미지원. [실제 저장소](../../backend/content-service/src/main/kotlin/ai/storyfork/content/world/relationship/Neo4jRelationshipRepository.kt) |
| 플롯·콘티 | `story_plan(id,work_id,kind,parent_id,episode_id,episode_number,revision,deleted_at)`, kind=plot/scene, 인물·장소 연결 `story_plan_character/place`. `plan/entity/StoryPlanEntity.kt`, `StoryPlanRepository`, `StoryPlanService`. | 장면 순서·귀속·revision을 확인하고 살아 있는 계획만 사용. 신규 scene 생성이나 수정은 해당 소유 서비스의 명령으로 제안. 과거 계획 전문 이력은 가정하지 않는다. |
| AI 제안·이력 | `ai_job → ai_model_call`, `ai_input_snapshot`, `ai_proposal`, `proposal_evidence → ai_evidence`. `proposal_decision → proposal_application → proposal_episode_change`. `proposal/entity` 및 `proposal/repository`. | 현재 이어쓰기 전용. 복합 작업의 thread/run 연결, 취소, 버전 고정 제안과 다중 대상 결과를 확장. 기존 응답 pending/accepted 및 V7 제약 보존. |

## 재사용 판단

| 분류 | 대상 | 이유 |
|---|---|---|
| 그대로 재사용 | Core 인증 확인, Content의 소유·공개 검사, 발행판 및 원고 버전 저장 | 새 AI 실행에도 같은 사용자가 같은 원고에 같은 권한을 가진다. |
| 기존 코드 확장 | ContextService, ProposalService, 모델 호출 기록, 인증 fetch | 회차 manifest와 특정 구간 조회, 여러 모델 호출, 고정된 다중 문서 승인에는 추가 계약이 필요하다. |
| Adapter 추가 | Content 정본 읽기, 네 검색 영역, 분류기 | 검색 결과에 같은 권한·시점 검증을 적용하고 Fixture와 실제 조회를 교체한다. |
| 신규 | 작업 DAG, Wiki coverage, Simulation, 진행 스트림과 재개, 변경안 검증 | 기존 단일 이어쓰기에는 없는 사용자 동작이다. |
| 교체 여부 | 기존 API·Flyway·관계 저장소는 유지 | 새 기능을 별도 operation으로 도입해 회귀 검증 후 호출자별 전환. 운영 DB 이관은 별도 결정. |

기존 문서의 논리 ERD 후보와 실제 SQL의 차이는 [물리 스키마 대응표](../content-erd-migration.md)에 기록되어 있다. 설계의 실행 예시는 [전체 아키텍처](02-ai-architecture.md), 구현 순서와 이슈는 [로드맵](05-implementation-roadmap.md)을 따른다.
