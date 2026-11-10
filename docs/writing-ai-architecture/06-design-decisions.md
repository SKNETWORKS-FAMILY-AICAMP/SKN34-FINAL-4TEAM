# 결정 기록과 구현 전 확인 사항

이 기록은 집필 AI의 **추천 설계**다. 제품에서 이미 확정된 경계는 Core 인증, Content의 작품 인가·정본 반영, Neo4j의 현재 관계 단일 정본, 승인 전 원고 보존이다. 2026-11-09 사용자 요청으로 모델 제공사는 OpenAI API, TASK 05 분류는 Decisions(`gpt-6-luna`)로 결정했다. 아래 JEV 비교는 이전 검토 기록이다. LangGraph·검색 인프라·운영 예산은 별도 결정이 필요하다. [프로젝트 결정](../design/decisions.md) · [현재 관계 계약](../design/worldstudio-independent-schema.md)

TASK 05는 기존 SDK의 `OpenAI.post('/decisions', ...)`로 공식 HTTP 계약을 구현했다. 키는 서버 `OPENAI_API_KEY`만 사용하고 공식 OpenAI base URL·15초 timeout·재시도 0회로 제한한다. 사용자 요청에 따라 실제 공급자 어댑터 구현까지 허용하되 유료 호출·실사용자 원고 전송은 검증하지 않았다. 모델의 확신 점수 임계값을 임의 정책으로 정하지 않고 `clarify` 선택지와 결정적 enum·허용 작업 검사를 사용한다. 한국어 정확도·지연·계정 접근 검증은 대기다. [TASK 05 인수 기록](task05-handoff.md).

## 실행과 모델

2026-11-10 TASK 15는 의미 해석과 확정 사실을 분리하고, 조건부 Simulation을 독립 예산 Task로 소비하는 합성 구현이다. 모델에 임의 확정·쓰기 명령을 받지 않고 해석 종류와 근거 ref만 받는다. Simulation 필요성은 합성 호출자의 명시 입력이며 실제 자동 분류·유료 모델 선택·공개 Run 정책은 확정하지 않았다. [DTO·제약·검증](task15-handoff.md).

2026-11-10 TASK 14는 결정 9·10의 개별 행동 기준과 인물별 투영을 합성 자료에서 적용했다. 자유문 누출 검증은 허용 원문 조합만 통과시키는 제한 구현이다. 새로운 유료 모델·생성 정책·Content 상태 전송 계약을 확정하지 않았으며 실 문맥에서는 아직 사용할 수 없다. [구현·검증·남은 결정](task14-handoff.md).

2026-11-09 TASK 08 요청으로 Main 실행 조립에 LangGraph StateGraph를 채택하고 `langgraph==1.2.12`를 의존성에 추가했다. OpenAI 전용 모델 결정은 유지하며 이 단계에서 모델을 호출하지 않는다. InMemorySaver는 참조 전용 상태의 개발 대역이고 실제 Saver·운영 재개 결정은 후속이다. [TASK 08 계약과 검증](task08-handoff.md).

| 문제·현재 근거 | 선택지 A / 비용과 영향 | 선택지 B / 비용과 영향 | 추천·결정 시점·미결 영향 |
|---|---|---|---|
| 1. JEV vs Decisions. Python 이어쓰기는 이미 OpenAI Responses를 사용 | JEV 통합 분류는 선택지·확률을 한 번에 반환. 새 제공사와 원고 전송 정책·인증 검토 필요 | OpenAI Decisions는 기존 제공사 경계 안에서 정형 평가. 계정·모델 지원과 한국어 정확도 검증 필요. Responses는 복합 schema 생성 가능하나 생성량 변동 | MVP 전 RuleBasedRouter를 기준선으로 동일 라벨 세트의 비용·p95·복합 의도 누락을 비교. 모호하면 질문. 미선정이어도 명시 UI 경로 구현 가능. [공식 JEV](https://docs.typesafe.ai/api/system-one) · [공식 Decisions](https://developers.openai.com/api/reference/resources/decisions/methods/create) |
| 2. DAG와 Supervisor. 기존 이어쓰기는 단일 호출 | 등록 규칙만 사용하면 재현 가능, 낯선 복합 요청 누락 | 동적 Supervisor는 분기 폭이 크지만 재계획·비용·회복 어려움 | MVP는 고정 DAG와 등록 후속 조건, 제한 planner는 비교 평가 후. 미합의 시 알 수 없는 조합에 명확화 |
| 3. Retrieval Tool vs Subgraph. ContextService는 제한된 발췌를 동기 조립 | 공통 async 함수 한 곳에서 pre/post filter 적용. 저장 비용 낮음 | 검색 자체가 긴 반복/중단을 가지면 서브그래프로 독립 재개 가능. 상태·복구 비용 증가 | MVP는 공통 도구. 실제 재검색 전략에 중간 checkpoint가 필요할 때만 분리 |
| 9. Simulation 예산. 다중 인물 루프 구현 전 | 두 인물·세 개별 행동, 기본 최대 6회 시도. 비용·반응 폭 제한 | 라운드당 전원 행동은 긴 상호작용에 적합, 인원×라운드만큼 호출 증가 | 기능 전 개별 행동 기준 채택, 비교 최대 12회 시도·절대 한도 14. 실측 후 조정. 미결이면 긴 장면은 부분 종료 |
| 10. Agent 공유 상태. 인물별 knownBy와 공개 제약 존재 | 상태 전체 전달은 단순하나 비밀 유출 및 checkpoint 팽창 | immutable evidence 참조와 역할별 projection은 변환·재검증 비용, 노출 범위 작음 | 기능 전 B. 공유 자료는 scope 내에서만 재사용. actor끼리 미공개 메모리는 전달 금지 |

## 검색과 버전

| 문제·현재 근거 | 선택지 A / 비용과 영향 | 선택지 B / 비용과 영향 | 추천·결정 시점·미결 영향 |
|---|---|---|---|
| 4. 관계 Graph와 Wiki 물리 분리. 관계 내용은 현재 Neo4j에만 보존 | 한 인스턴스 안 별도 DB·권한은 운영비 절감, 삭제·권한 오구성 영향 공유 | 별도 물리 배치는 격리·복구 독립, 인프라 비용 상승 | 논리 모델·권한·writer는 처음부터 분리. Wiki 구축 전 부하·운영 요구로 물리 배치 결정. AI가 관계 graph에 Wiki 기록 금지 |
| 5. Graph/Vector 제품 선정. 현재 관계용 드라이버 존재 | 기존 Neo4j 관계를 Content로 읽고 나머지 backend를 fixture로 정의, 제품 확정 지연 가능 | Wiki 및 두 Vector를 일찍 선정하면 운영 검증 빠르나 검색 품질 측정 전 종속 | 현재 관계의 제품은 이미 확정. 신규 Wiki·Vector 제품은 실제 권한 필터·삭제·한국어 회수율 벤치마크 후. 템플릿과 원고의 인덱스/권한은 분리 |
| 6. Wiki 생성·동기화. 버전·공개/삭제 상태가 Content에 있음 | 읽을 때마다 추출하면 초기 구축 작음, 호출·지연 및 재현성 문제 | 확정 판본의 변경 이벤트로 증분 추출하고 검토 provenance 유지. 중복·순서·재색인 설계 필요 | 실제 색인 전 B 검증. 이벤트 키는 대상+revision, 삭제 우선 차단, 처리 역전 시 최신 manifest 대조. 그전에는 fixture로 시점 계약 검증 |
| 7. 전체 coverage. 기존 Context는 최근 3화까지 발췌 | top-k만으로 답하면 빠르나 빠진 회차 식별 불가 | 예상 manifest 전체 상태 검증 뒤 필요한 원문만 모델에 전달. 메타 조회 비용 | MVP B. verified/expected와 critical gap 별도. 공백이 있으면 전체 검수 확정 보류 |
| 8. Fork·revision snapshot. checkpoint_episode/setting과 following/independent 존재 | 매번 원작 최신을 읽으면 빠르나 Fork 독립·미래 지식 위반 | Content가 허용한 버전 manifest와 출처 checkpoint, 변경 동의로 고정. 읽기 시 검증 필요 | 기능 전 B. 전체 역사 관계 snapshot 예외를 보존. 과거 주장은 당시 서술 근거로만 답변. 매핑·권한 불명은 unavailable |

## 서비스와 저장

TASK 21은 사용자 요청으로 선행 TASK 20의 실제 적용 미완료와 독립 진행했다. AsyncPostgresSaver 3.2.0과
psycopg 3.3.2를 고정하고 분리 schema를 기본 비활성 개발 후보로 구현했다. runtime DDL 없이 최소 권한과
migration 0~9를 검사한다. 호출 전 예약과 완료 결과를 같은 Saver의 별도 namespace에 남기고,
결과 저장 전 중단된 active 작업은 불명 실패로 보존하며 재호출하지 않는다(기존 불명 호출 무재시도 원칙).
공유 DB PUBLIC 권한 조율·runtime 인증/암호화·TTL/백업 삭제·Content 자동 복구/결과 resolver는 미결이다.
[실제 수용·한계](task21-handoff.md) · [관리 경로](../../backend/ai-service/docs/checkpoints.md).

TASK 10에서 사용자가 실제 grant·AI 전송 연결을 승인했다. Content 전용 HMAC 키와 5분 위임, 기존 내부 토큰의 서버 간 인증, 좁은 HTTP 검증 경로로 현재 인가를 재확인한다. 이 결정은 실제 MCP 원문 읽기·모델·승인·자동 복구를 확정하지 않는다. [확정한 계약과 한계](task10-api-contract.md).

TASK 09 당시 내부 HTTP 경계는 FixtureContent에 명시 주입한 작업별 합성 grant만 복원했다. TASK 10이 실제 Content 위임과 공개 최소 API를 추가했으며 MCP 원문 읽기·원고 저장·영속 재개는 계속 미연결이다. [TASK 09의 합성 계약과 단일 프로세스 한계](04-infrastructure-integration.md#task-09-합성-내부-run-http-계약).

| 문제·현재 근거 | 선택지 A / 비용과 영향 | 선택지 B / 비용과 영향 | 추천·결정 시점·미결 영향 |
|---|---|---|---|
| 11. Python 분리. 내부 FastAPI 앱과 GenerationClient 존재 | 기존 Python 앱 확장 시 LangGraph 생태계·테스트 재사용, 네트워크 장애 표면 추가 | Kotlin에 통합 시 트랜잭션 인접, Python SDK 통합·서비스 결합 비용 큼 | MVP A. 에이전트별 배포 없음. 도입할 LangGraph/Saver 의존성은 구현 전 공유 |
| 12. Core 재사용. CoreAuthClient와 Content ProposalService가 현재 코드 | Core에 콘텐츠 승인 이중 구현 시 writer·migration 경계 충돌 | Core 인증과 Content의 정본 검증·저장 경유. 기존 API 재사용, 작업별 위임 필요 | DEC-41에 따라 B. 내부 읽기 transport만 #163에서 결정. 미결일 때 grant 없는 실제 읽기 차단 |
| 13. Saver schema. 기존 SQL에는 saver 운영 테이블 없음 | 같은 PG의 별도 schema·계정·전용 pool이면 인프라 절약, 부하·백업 공유 | 별도 DB면 보존·복구 독립, 장애 대응·운영비 증가 | 운영 전 보존량·삭제 SLA로 결정. 개발 후보는 별도 schema. 고정 배포본 setup과 업무 Flyway 분리. schema/권한 확인 전 운영 재개 불가 |
| 14. 다중 문서 원자성. 현재 accept는 원고 한 건에 결과 이력 | 같은 Content PG transaction은 명확한 전부 성공·실패. cross-store 제한 | saga는 여러 저장소 처리 가능하나 중간 상태·보상·추가 승인 계약 필요 | 기능 전 A. graph와 PG 일괄 원자 적용 거부. 서로 독립 가능한 제안만 사용자에게 분리 제시 |
| 15. Mock 검증 한계. Wiki·원고/템플릿 벡터 실 검색 계약 없음 | fixture는 충돌·누락·격리와 재시도 재현, 실제 랭킹·성능 불명 | 실 adapter와 승인된 소규모 corpus는 질적 평가 가능, 구축·운영 필요 | 설계/MVP 계약은 A, 운영 전 B로 shadow 평가. 실 장애에 Mock 전환하거나 Mock 판본을 실제 원고에 적용하지 않음 |

## 구현 승인이 필요한 경계

| 결정 주체·시점 | 확인할 내용 | 확인 전 동작 |
|---|---|---|
| Content·AI 담당, 기능 착수 전 | work↔독립 Studio world 연결, 회차·행 단위 공개/knownBy, 서비스 위임 만료/철회, 정확한 인물 ID | 관계를 결합하지 않고 미지원 표시. 검증된 Content 설정·원문만 사용 |
| 제품·작가 도구 담당, 변경 기능 전 | 다중 문서 적용 대상/부분 선택, 충돌 화면, 승인 세션 만료·취소 경쟁 | 전체 diff를 확인한 단일 PG 변경 집합만 승인 |
| 운영·데이터 담당, 실제 저장 전 | Saver 전용 계정·보관·삭제·복구, schema 관리, 모델 제공사 보존 설정·사용 권리·호출 비용 한도 | 민감 production 원고·실제 DB·유료 호출 없이 합성 평가 |
| 콘텐츠 담당, 검색 구축 전 | 소설/템플릿 이용권·공개 범위, 임베딩·제품/인덱스 선택, 동기화·삭제 지연 목표 | 시점 확인 불가능한 근거를 정본으로 제공하지 않음 |

[현행 소스 분석](01-current-system-analysis.md) · [실행 계획](02-ai-architecture.md) · [기능 설계](03-rag-simulation-design.md) · [인프라 계약](04-infrastructure-integration.md) · [구현 및 평가](05-implementation-roadmap.md) · [검색 계약](07-retrieval-contract-and-mocks.md)
