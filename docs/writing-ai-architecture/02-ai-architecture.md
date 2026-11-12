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

단일 기능은 명시적 operation으로 시작한다. 복합 DAG 실행은 둘 이상의 실제 기능이 검증되고 조합 요구가 생긴 뒤에 추가한다. LangGraph는 **Character Simulation의 반복 상태 갱신**과 실제 중단·재개가 필요한 복합 실행에 사용한다. 단순 조회를 억지로 그래프에 넣지 않는다.

### Intent Router와 입력 가드레일 (#55)

`ai-service`의 `app/intent/service.py`의 `route`가 실행 전 가드레일과 분류만 한다(2026-11-11 사용자 요청으로 선행 구현). 실행·검색·정본 수정·HTTP 연결은 아직 없다.

- 모델은 OpenAI Decisions(`POST /v1/decisions`, 지원 모델 `gpt-6-luna`)의 choice 질문만 쓴다(2026-11-11 사용자 결정). 모델은 보낸 선택지 중 하나만 고르고, 작가에게 보이는 거절·확인 문구는 서버 고정 문구다. 설치된 SDK에 decisions 리소스가 없어 `OpenAI.post`로 호출하고 응답을 다시 검증한다.
- 가드레일(`guard` 질문): `greeting`(인사·감사), `out_of_scope`(창작과 무관. 작품 고증용 현실 사실 확인은 제외), `inappropriate_edit`(승인 없는 저장·발행·삭제, 다른 작가·권한 밖 작품 수정), `prompt_injection`(지시·권한 검사 무시, 권한 밖 자료 열람, 도구·명령 실행, 시스템 지시 공개), `sensitive_data`(회원 개인정보, 키·토큰·비밀번호·내부 설정)는 `rejected`와 고정 안내 문구를 반환하고 아무 기능도 실행하지 않는다. 모델이 guard 질문 자체를 거부(refusal)하면 `unsafe`로 거절한다. 가드레일이 걸린 요청에서 나머지 질문의 refusal은 허용한다.
- UI에서 고른 operation이 있으면 guard 질문만 보내고 통과하면 그 기능 하나로 확정한다. 등록되지 않은 값은 모델 호출 전에 거절한다.
- 자유 입력은 7개 기능마다 "요구 여부와 순서(`none|1|2|2_if_issues|3|3_if_issues`)"를 독립 질문으로 묻는다. Decisions는 질문마다 따로 답하므로 "두 번째 작업" 같은 연쇄 질문을 쓰지 않는다. 고른 순서의 상대 순서로 steps(최대 3개)를 만들고, `clarity=ambiguous`·고른 기능 없음·한 순서에 두 기능·첫 작업 조건부는 `clarify`와 고정 확인 질문이다. 조건부 단계 `if_issues_found`는 Review·웹 조사·World & Plot 뒤에만 온다. 예: "검수하고 문제가 있으면 고쳐줘" → Review → 조건부 Writing & Editing.
- 요청과 검색·원고 자료(`materials`)는 `input_json` 데이터로만 보내며 자료 안 지시는 분류에 반영하지 않는다.
- 권한·작품/Fork/회차 범위는 Router가 다시 검사하지 않는다. Content가 `QaScopeService` 등으로 먼저 확정한 범위를 그대로 쓰며, Router 결과에는 범위·대상·도구 필드가 없어 입력 문장이 그 범위를 넓힐 수 없다.
- 선택지 밖 값·답 누락/중복·guard 통과 뒤 refusal·조건 규칙 위반·모델 오류·키 미설정은 `ProviderFailure`이며 정상 분류로 표시하지 않는다.
- 실모델 수용(2026-11-11, 개발용 합성 문장 27건 × 3회, 리뷰 반영 뒤 1회 추가 27/27): 7개 기능 대표 요청, 모호 요청 2건, 복합 3건, 인사 2건, 범위 밖 2건, 부적절한 수정 2건, 인젝션 3건, 개인정보·기밀 2건, 자료 속 인젝션 2건, UI 선택+인젝션 1건이 81/81 기대대로 분류됐다. `rm -rf` 실행 요청은 모델 refusal로 `unsafe` 거절됐다. 확신 점수 임계값은 쓰지 않는다.

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
