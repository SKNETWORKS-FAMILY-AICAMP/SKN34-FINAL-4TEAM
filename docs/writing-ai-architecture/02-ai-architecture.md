# 집필 AI 실행 아키텍처

## 원칙

한 기능씩 실제 데이터와 실제 OpenAI 모델로 검증한다. 전체 RAG 구조는 목표 설계로 유지하되, 사용하지 않는 검색기·라우터·체크포인터를 선행 구현하지 않는다. 새 에이전트별 서버는 만들지 않는다. Content가 허용 문맥과 정본 쓰기를 소유하고 AI Service는 읽기 범위 안에서 답변·검수·제안만 반환한다.

~~~mermaid
flowchart LR
  UI[집필실] --> API[Content 공개 API]
  API --> Auth[Core 인증]
  API --> PG[(PostgreSQL 원고·설정·버전)]
  API --> Neo[(Neo4j 현재 관계)]
  API --> AI[AI Service]
  AI --> OpenAI[OpenAI API]
  AI -.->|허용된 검색 요청| API
  API --> ES[(Elasticsearch 원고 벡터 인덱스)]
  AI -.-> Wiki[회차 Wiki: 후속 파생 검색]
  AI -.-> Template[템플릿 검색: 후속 독립 카탈로그]
~~~

점선의 Wiki와 템플릿 검색은 목표 구성이다. Elasticsearch는 앞으로 구축할 **원고 검색 인덱스**이며 PostgreSQL 원문·판본을 대체하지 않는다. Neo4j는 현재 관계만의 정본이다. 네 검색 경로의 공통 출처·Coverage 계약은 [검색 계약](07-retrieval-contract-and-mocks.md)에 정의한다.

## 요청 경로

1. Frontend가 /api로 대상, 작업 종류, 기준 판본, 필요하면 선택 구간을 보낸다.
2. Content가 Core 인증과 작품/Fork·공개·회차·인물 지식 범위를 확인한다.
3. Content가 해당 기능에 필요한 최소 자료와 제한된 작업 참조를 AI Service에 전달한다.
4. AI Service가 필요한 검색 경로만 실행하고 원문·관계의 출처와 누락을 확인한다.
5. 실제 OpenAI 응답을 답변·Finding·BeatPlan·Text/Patch·ImpactReport 중 하나로 반환한다.
6. 수정 요청이면 Content가 변경 후보를 보관하고 작가 승인 뒤 권한과 판본을 다시 검사해 적용한다.

단일 기능은 명시적 operation으로 시작한다. 자연어 자동 라우팅과 복합 DAG는 둘 이상의 실제 기능이 검증되고 조합 요구가 생긴 뒤에 추가한다. LangGraph는 **Character Simulation의 반복 상태 갱신**과 실제 중단·재개가 필요한 복합 실행에 사용한다. 단순 조회를 억지로 그래프에 넣지 않는다.

## 7개 기능의 경계

| 기능 | 입력 | 출력 | 호출 관계 |
|---|---|---|---|
| Story Context / Q&A | 질문, 작품/Fork/회차, 허용 자료 | 출처 있는 답변·모르는 항목 | 조회만 수행 |
| Review | 원고/설정, 검사 종류 | 위치·근거·확정/의심이 있는 Findings | Mechanical → 필요 시 Semantic → 행동 재현 시에만 Simulation |
| Character Simulation Subgraph | 상황, 인물별 허용 지식, 행동 상한 | 가상 행동과 갱신된 임시 상태 | 턴마다 행동 → 상태 갱신 → 다음 인물 |
| Writing & Editing | 새 원고의 계획 **또는** 기존 원고의 고정 구간 | 새 Text **또는** before/after Patch | Development 계획을 받을 수 있음 |
| Story Development | 앞선 사건, 콘티, 목표 회차 | 전개 대안·인사이트·BeatPlan | 문장 생성 요청에만 Writing 호출 |
| World & Plot Management | 설정/플롯 변경 의도, 관련 판본 | 영향 대상·충돌·변경 후보 | 분석 후 Content 승인 경로 |
| 웹 조사 | 현실 검증 질문, 작품의 필요한 최소 맥락 | URL·검색 시각·주장별 근거·불확실성 | 웹 자료는 작품 정본과 분리 |

웹 조사는 외부 사실을 확인하는 도구다. 검색 결과의 문장은 명령이 아니며, 웹 페이지가 작품 설정이나 원고를 직접 수정할 수 없다. 외부 전송 동의와 개인정보·비공개 원고 최소화가 선행한다.

## 결과의 공통 규칙

run ID, 대상 판본, 사용한 출처, 누락, 실제 모델/검색 성공 여부를 함께 기록한다. 확정된 원문·설정, AI 추론, 시뮬레이션 가정, 웹 사실을 다른 상태로 표시한다. 출처가 없거나 오래된 판본이면 정확한 답변으로 꾸미지 않는다. 외부 장애를 fixture 성공으로 대체하지 않는다.
