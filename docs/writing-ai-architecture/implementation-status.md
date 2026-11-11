# 집필 AI 구현 현황과 남은 개발 보고서

기준: 2026-11-11, `feat/frontend-ai-runs`. 기존 TASK 01~24 인수보고와 현재 소스·호출 경로를 대조했다. 코드·설정은 [실연동 인수보고](live-rag-handoff.md), 이번 변경은 스택 최상단 PR #282에서 확인한다.

**현재 상태는 “제한된 작가용 집필 흐름의 실제 클라이언트 연결 완료”다. 전체 다중 에이전트 서비스의 운영 수용 완료는 아니다.** 모델·검색·그래프를 대역으로 바꿔 검사한 단위 테스트와 실제 제공사·데이터·배포 검증을 구분한다.

## 요청 항목 판정

| 요청 | 이번 결과 | 남은 조건 |
|---|---|---|
| LLM을 GPT-6 Luna로 통일 | `generation.MODEL` 한 곳에 `gpt-6-luna` 고정. 기존 이어쓰기 Responses 및 Decisions 분류기가 같은 상수를 쓴다. 신규 실제 Run도 Responses를 호출한다. Compose의 구형 모델 설정 제거. | 실제 키의 모델 접근·비용·한국어 결과 품질 측정. 기존 전문 Agent 모델 대역이 모두 실제 모델로 교체된 것은 아니다. |
| Langfuse RAG 추적 | Content 조회·ES 적재·검색·생성을 OTLP trace와 자식 span으로 전송한다. 원문·프롬프트·생성문·키·예외 전문은 제외. Run ID로 재현 가능한 trace ID를 만든다. 전송 실패는 경고를 남기며 재생성하지 않는다. | 배포 URL/자격, 실제 수신 확인, 운영 대시보드·평가·보관 정책. 자체 Langfuse 인프라를 설치하지 않았다. |
| 세계관 관리 Neo4j 실제 연결 | AI가 Content 내부 읽기를 호출하고, Content는 회차가 선택한 WorldStudio의 기존 소유권·카드·현재 관계 CAS 검사를 재사용한다. 위임에 선택 세계관·판을 바인딩하고 모델 전후 digest를 재확인한다. | 실제 연결 DB에서 테스트. 현재 관계만 지원하며 과거 관계 복원과 인물 지식 추론은 하지 않는다. |
| Elasticsearch 원문 적재·RAG | 공개 발행본 자동 순회·증분 색인, 작가 요청 시 허용 발췌 보충, E5 임베딩·`semantic_text` 검색. 현재 허용 ID로 검색을 제한하고 본문·인용은 Content 자료로 복원한다. | ES ML/E5 라이선스·모델 준비·자격, 검색 품질, 저장 데이터 보존·삭제. 자동 수집은 공개 발행본이며 비공개 전체 원고의 상시 수집은 아니다. |
| 템플릿 RAG 제거·위키 목업 유지 | 템플릿을 RAG enum·Evidence·Port·Coordinator·Vector 경로에서 제거했다. 기존 추천 대역은 `agents/template_catalog.py`의 별도 DTO/카탈로그다. Wiki fixture는 유지하고 실제 Run에 대체 데이터로 넣지 않는다. | 독립 템플릿 추천의 실제 상품·라이선스 데이터는 별도 기능이다. 이번 요청은 RAG 제외이며 추천 상품 시스템을 새로 만들라는 요청이 아니다. |

## 실제 사용자 실행 경로

| 기능 | 실제 연결 여부 | 사용 가능한 범위 |
|---|---|---|
| 기존 이어쓰기 제안 API | 연결 | 기존 Content 문맥·저장/승인 흐름과 GPT-6 Luna. |
| 집필실 “자료에 질문” | 연결 | 현재 허용 원문·설정·작가용 현재 관계에 대해 1회 생성. 인용은 검색에 사용한 원문 근거이며 문장별 논증 검증과 같지 않다. |
| 집필실 “설정·원고 검수” | 부분 연결 | 동일 범위를 LLM으로 검토하고 `partial` 반환. 전체 회차·전체 설정에서 오류가 없다고 보증하지 않는다. |
| 집필실 “선택 구간 수정” | 연결 | 현재 작성 원고의 선택 UTF-16 구간. Content가 선택 hash·draft 편집 판·본문 hash로 후보를 만들며 승인 전 저장하지 않는다. |
| 집필실 “다음 회차 초안” | 연결 | 기준 회차 다음의 새 회차 후보. 근거 없거나 다음 회차가 이미 있으면 실제 적용 후보를 만들지 않는다. 제목은 Content가 기본 회차 제목으로 정한다. |
| 전개 아이디어·콘티 확장 | 내부 Run 연결 | 각각 읽기 전용 아이디어와 새 회차 후보. 현재 UI 작업 선택에는 별도 항목이 없다. |
| 자유문 자동 의도 분류 | 부분 연결 | 실제 Run은 규칙 분류를 사용하고 모호하면 clarification. GPT-6 Luna Decisions adapter 자체는 구현되어 있으나 공개 Run의 자동 분류 fallback으로 호출하지 않는다. |
| 인물 시뮬레이션·세계관/플롯 변경·템플릿 추천 | 실제 Run 미지원 | 의도를 등록한 사실과 실제 실행 가능 여부는 다르다. `run_live.TASKS`에 없으므로 의존 미준비 오류로 끝난다. 합성 성공으로 바꾸지 않는다. |

실제 Run은 현재 UI가 동의받는 최대 1회 호출을 지키는 제한된 실행 경로다. 기존 MainGraph를 새 이름으로 감싸거나 합성 Agent를 실데이터로 가장하지 않았다. **기존 복합 DAG를 실제로 조립하는 작업은 아래의 미완료 항목이다.**

## TASK별 소스 판정

### TASK 01~05: 자료와 라우팅

| TASK | 구현된 것 | 실제로 남은 것 |
|---|---|---|
| 01 정본 읽기 | Scope/SourceVersion/정확 인용 계약. 이번 Content `/retrieval`은 실제 위임과 현재 원문을 읽는다. | 범용 RemoteContentReadPort의 manifest/read 전체 구현은 없다. 기존 CanonicalAdapter 전문 Agent 호출자까지 바뀐 것은 아니다. |
| 02 검색 계약 | 작품용 관계·Wiki·원고 DTO와 검증. 템플릿 DTO는 별도 카탈로그로 분리. | 실제 adapter 모두가 기존 RetrievalPort에 끼워지는 구조는 아니다. 실 Run은 검증된 좁은 실연동 경로를 쓴다. |
| 03 검색 구현 | 실제 ES 자동 색인·검색, Content 경유 Neo4j 현재 관계. Wiki mock 유지. | 위키 추출·저장·인물별 지식·시간선 DB. |
| 04 문맥 조립 | 실 Run의 허용 ID 검색·UTF-16 인용·digest 재검증. 합성 Coordinator의 Coverage·충돌 처리는 기존대로 유지. | 실데이터 전체 manifest coverage와 충돌 근거를 포함한 ContextPacket 조립. |
| 05 의도/슬롯 | 규칙 Router, Decisions adapter, 허용 후보 Slot Resolver. | 자동 분류와 실제 Slot Resolver 조립. 분류+생성은 최소 2회이므로 1회 동의에서 임의로 켜지 않는다. |

### TASK 06~10: 실행 기반

| TASK | 구현된 것 | 실제로 남은 것 |
|---|---|---|
| 06 Registry/DAG | 고정 capability·입출력 DTO·DAG 검증. | 실제 Content 자료로 전문 DTO와 handler를 만드는 plan_factory. |
| 07 Task 실행 | 합성 TaskRunner의 예산 예약·동시 상한·취소·조건 skip·결과 reducer. | 실제 전문 모델 호출을 모든 Task 예약·사용량과 연결. 단일 실 Run은 별도 한도 검증이며 영속 호출 예약이 아니다. |
| 08 MainGraph | LangGraph 상태 전이·합성 handler·참조 상태. | RemoteGrant에서 실제 MainRequest·Task/handler·문맥을 조립하는 전체 경로. |
| 09 내부 Run API | 실제 서비스 인증·접수·상태·취소 및 이번 실 Run dispatch. | 프로세스 재시작 후 미완료 Run 재구성. |
| 10 Content 공개 Run | 소유권·동의·서명 위임·멱등 접수·결과 resolver, 이번 `/retrieval`. | 자동 재전달과 영속 본문 resolver. 결과를 5분 위임 만료 후 읽는 정책도 확장 필요. |

### TASK 11~15: 조회·검수·시뮬레이션

| TASK | 구현된 것 | 실제로 남은 것 |
|---|---|---|
| 11 Q&A | 실 Run 질문 답변·검색 근거 인용. 기존 story_context의 정형 claim/ref 검증은 합성 자료로 구현. | 실 질문 결과의 주장별 ref·반대 근거·정형 신뢰 판정까지 기존 Agent에 연결. |
| 12 기계 검수 | 명칭·수치·중복·제한 맞춤법 검사 함수와 fixture 검사. | MockContentReadPort 강제 경계를 실제 canonical DTO로 교체하고 공개 review Task에 연결. 현재 LLM 부분 검수와 구분. |
| 13 템플릿 | 독립 합성 카탈로그 추천·라이선스/태그 검사. RAG에서 완전히 제외. | 실제 카탈로그·권리·구매/적용. 이번 범위에 새로 포함하지 않는다. |
| 14 시뮬레이션 | 인물별 합성 knownBy·가상 상태·중단/예산 검증. | 실제 character ID·지식 disclosure와 모델의 구조화 응답 adapter. |
| 15 의미 검수 | 공개 Run의 부분 LLM 검수. 기존 Findings/suspected/confirmed·조건부 editing은 합성 검증. | 실제 Wiki·Coverage·기계 Findings를 입력한 정형 검수 및 검수 후 조건부 편집 복합 작업. |

### TASK 16~20: 집필·변경 제안

| TASK | 구현된 것 | 실제로 남은 것 |
|---|---|---|
| 16 전개 계획 | 단일 실 Run의 전개 아이디어. BeatPlan DTO·계획 검증 함수는 합성 모델. | 실제 BeatPlan 구조화 출력과 시뮬레이션 결과 반영. |
| 17 승인·적용 | Content의 불변 제안·승인/거절·원고 저장·영수증. 이번 생성 본문을 Content가 검증된 편집/새 회차 연산으로 변환. | 설정/플롯/Neo4j를 포함한 다중 저장소 원자 적용은 지원하지 않는다. |
| 18 집필/편집 | 선택 구간 편집·새 회차 후보의 단일 실 모델 경로. | 기존 WritingHandler의 structured DTO·예약 대상·TaskRunner 경로를 실데이터로 연결. |
| 19 복합 집필 | 합성 Coverage→Simulation→Development→Writing→연속성 검사 DAG. 단일 실제 초안 생성은 별도 동작. | 실제 Wiki/Coverage와 여러 모델 호출에 대한 동의·예산, 구조화 계획, 결과 resolver. |
| 20 세계관/플롯 | 합성 영향 분석·근거 역참조·후보 생성, `can_apply=false`. 현재 Neo4j 읽기는 연결. | Wiki 역참조 정본, setting/plot writer, PG·Neo4j의 저장/충돌/부분 실패 계약. |

### TASK 21~24: 복구·승인 중단·화면

| TASK | 구현된 것 | 실제로 남은 것 |
|---|---|---|
| 21 체크포인트 | 선택적 AsyncPostgresSaver·serializer·합성 복원·호출 예약 journal. | 실 Run의 lease·생성 본문 영속 저장·재시작 재구성. MainGraph checkpoint 존재만으로 실제 실행 복구가 되지 않는다. |
| 22 HITL | 합성 interrupt/resume 계약. 실제 경로는 Content 후보·결정·영수증을 사용한다. | 실제 MainGraph의 interrupt와 committed receipt 재개 조립. 재수정은 결정 기록까지이며 자동 재생성은 없다. |
| 23 진행 | Content 영속 이벤트·SSE 재연결·취소. 실제 Run은 pending/running/terminal 상태를 전달. | 실제 단계별 task 진행·usage 이벤트 연결, 프로세스 장애 후 진행 복구. Langfuse span과 사용자 SSE는 별개다. |
| 24 집필 UI | 인증 Run 요청·동의·결과·인용·선택 diff·승인/거절·취소. | 실제 인증/ES/Neo4j/OpenAI를 함께 사용하는 브라우저 수용 검증. 전체 기능 완료 표시는 이 검증 뒤 갱신한다. |

## 미구현 항목의 근거와 구현 방법

### 실제 전문 Agent·복합 DAG

**근거:** `agents/story_context.py`, `review.py`, `semantic_review.py`, `development.py`, `writing.py`, `world_plot.py`는 실제로 `MockContentReadPort` 타입을 확인한다. `simulation.py`도 Content fixture 행의 knownBy를 사용한다. 그 조건만 지우면 fixture에서 승인된 정보를 실제 권한 정보로 오인한다.

**구현:** Content에 grant-bound manifest/read의 원문·설정·대상 회차 예약 DTO를 만든다. `CanonicalAdapter`가 받는 실제 ContentReadPort와 기존 specialist 요청 DTO의 변환을 구현한다. `MainGraph`에 실제 plan_factory와 run별 handler를 주입한다. 각 전문 역할은 GPT-6 Luna Responses 구조화 출력으로 자신의 기존 DTO를 반환하고 Pydantic 검증을 통과해야 한다. 완료/실패/usage는 TaskRunner의 예약과 결과 참조를 거친다.

**완료 기준:** real RemoteGrant가 기존 DAG를 실행하고, 위임 철회·오래된 판·모델 비정상 DTO·중간 Task 실패·예산 소진에서 후속 모델/적용이 차단되는 계약 테스트와 실제 시나리오가 통과한다. 여러 모델을 쓰는 작업은 UI 동의 `maxCalls`와 예산을 함께 늘려야 한다.

### 위키·인물 지식·전체 Coverage

**근거:** 사용자가 위키 그래프를 목업으로 유지하도록 명시했다. WorldStudio의 현재 관계는 과거 회차 사건이나 인물의 당시 지식이 아니다. 따라서 현재 관계를 사용해 Wiki/knownBy를 만들거나 전체 검수를 “완료”로 승격하지 않는다.

**구현:** Content의 회차별 불변 판 manifest에서 추출 작업을 시작하고 사건·장면·설정 근거의 source revision/span/hash를 유지한다. Neo4j에는 현재 관계와 분리된 위키 스키마 및 위임 필터를 둔다. 인물별 지식은 Content가 허용한 disclosure만 사용한다. 수정/삭제 사건에 따라 파생 노드를 stale로 전환하고 재추출 뒤 새 세대를 공개한다. 예상 전체 회차와 검증된 회차를 분리 집계한다.

**완료 기준:** 100화 중 1개 누락·미래 사건·다른 Fork·공개 철회 사례에서 complete가 false이고 인물에게 비밀이 전달되지 않는다. 이 기준 전에는 시뮬레이션·전체 연속성 검사·세계관 변경 영향 분석을 실제 성공으로 제공하지 않는다.

### 실제 원문 검색 범위와 색인 운영

**근거:** 기존 Content는 최대 최근 3회차의 제한 발췌만 위임하고 결과 resolver도 그 발췌만 검증한다. 공개 원문을 전체 적재했다고 해서 AI에 전체 읽기 권한이 생기지 않는다. ES의 저장 데이터 삭제/보존 기간은 정해지지 않았다.

**구현:** 범위를 확대할 때 Content가 전체 허용 회차/판 manifest와 exact-span read API를 먼저 제공한다. ES는 버전/작품/Fork/회차/공개 범위를 prefilter하고 검색 hit를 Content exact read로 다시 확인한다. 자동 수집은 현재 공개 목록 기반의 단일 프로세스 주기 작업이다. 데이터가 늘면 발행 outbox 또는 수정 시각/keyset feed와 영속 cursor를 사용하고 여러 worker의 중복 수행을 제한한다. 인덱스 삭제는 정본이 아닌 파생 자료에만 적용하며 보존 기간·권한을 확정한 뒤 수행한다.

**완료 기준:** 초기 전체 적재, 발행 판 교체, 공개 중단, 원작 삭제 후 Fork 열람 제한, 재시작 및 부분 bulk 실패를 실제 ES에서 검증한다. 한국어 질문 corpus에서 recall·인용 정확도·지연을 측정한다. 기존 인덱스를 삭제하거나 공유 DB를 초기화하지 않는다.

### 실제 Run의 영속 복구·재수정

**근거:** `RunService.records`와 실제 생성 본문은 프로세스 메모리다. 기존 Saver는 주로 참조를 저장하고 전문 본문 resolver가 없다. 위임은 5분이며 Content dispatch는 자동 재전송하지 않는다. 응답 유실을 무조건 재호출하면 모델 비용을 중복 소비한다.

**구현:** Content가 실행 lease와 idempotency key를 영속 관리하고, 모델 호출 예약/완료/사용량 미확인 상태를 저장한다. 생성 결과의 접근 통제 저장소와 참조 resolver를 준비한다. 재시작 시 현재 권한·판본·위임을 갱신해 새 worker가 결과를 복구한다. 사용량 미확인 호출은 자동 재호출하지 않는다. 재수정은 기존 영수증을 부모로 하는 새 Run과 새 동의/예산으로 생성한다.

**완료 기준:** 호출 직전/직후, 후보 준비 commit 전후, 승인 직후 강제 종료 시 모델 중복 호출·원고 중복 적용이 없고 정확한 영수증과 본문을 복원한다.

### 세계관/플롯 적용과 운영 수용

**근거:** `ChangeProposalService`는 draft에 대한 PG 연산을 검증한다. 세계관은 별도 PG 상태와 Neo4j CAS이므로 draft writer에 연산을 추가하는 것만으로 원자성이 확보되지 않는다. 외부 서비스의 접속 자격·라이선스·운영 데이터 품질은 코드만으로 검증할 수 없다.

**구현:** Content 소유 setting/plot 변경 후보 DTO·판·권한 검사를 추가한다. 기존 WorldStudio prepare→Neo4j CAS→PG finalize 패턴으로 별도 적용을 설계하고 원고와의 혼합 변경은 지원/거절/부분 실패 정책을 확정한다. 실제 운영 수용은 ES E5, Langfuse, Neo4j, OpenAI, 인증 UI 순으로 격리 환경에서 검증한다.

**완료 기준:** 낡은 카드/관계 판, CAS 충돌, 부분 쓰기 후 재시도, 취소와 승인 경쟁에서 정본·영수증이 일치한다. 브라우저에서 생성→diff→승인→원고 재조회까지 확인한 뒤 서비스 사용 가능 판정을 내린다.

## 이번 검증과 확인하지 않은 것

검증 결과는 [실연동 인수보고](live-rag-handoff.md)의 최종 검증 절을 따른다. 로컬에서는 변경 범위의 단위 테스트만 실행한다. 기존 인수보고의 통합 테스트·브라우저 검증은 과거 실행 결과이며 이번 변경을 검증한 결과가 아니다.

실제 모델 과금 호출, 사용자의 원고 전송, 운영/공유 DB 변경, ES/Langfuse 설치·실수신, PR 병합·배포는 수행하지 않는다. 필요한 자격은 루트 환경설정으로만 받고 저장소에 넣지 않는다.
