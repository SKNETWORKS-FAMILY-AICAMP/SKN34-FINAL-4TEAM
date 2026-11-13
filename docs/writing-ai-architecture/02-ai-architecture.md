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

점선의 Wiki와 템플릿 검색은 목표 구성이다. Elasticsearch는 **원고 검색 인덱스**이며 PostgreSQL 원문·판본을 대체하지 않는다. Neo4j는 현재 관계만의 정본이다. 네 검색 경로의 공통 출처·Coverage 계약은 [검색 계약](07-retrieval-contract-and-mocks.md)에 정의한다.

## 요청 경로

1. Frontend는 단일 기능의 명시적 operation 또는 자유 입력을 [각 공개 경로](04-infrastructure-integration.md#단일-기능과-복합-요청)에 보낸다. 대상·기준 판본과 필요한 선택 구간을 함께 전달한다.
2. Content가 Core 인증과 작품/Fork·공개·회차·인물 지식 범위를 확인한다.
3. Content가 해당 기능에 필요한 최소 자료와 제한된 작업 참조를 AI Service에 전달한다.
4. AI Service가 필요한 검색 경로만 실행하고 원문·관계의 출처와 누락을 확인한다.
5. 선택된 Agent의 답변·Finding·BeatPlan·Text/Patch·ImpactReport를 검증한다.
6. 변경 후보가 있으면 Content의 후보 보관 결과를 확인한다. 보관 실패는 그대로 표시하며 승인·적용과 구분한다.
7. Python이 허용된 Agent 원본 결과와 출처·판본·작업 상태, Content가 확인한 후보 상태를 묶어 반환한다. 작가 승인 뒤 Content가 권한과 판본을 다시 검사해 적용한다.

단일 기능은 명시적 operation으로 직접 실행한다. 여섯 업무 Agent(Story Context / Q&A, Review, Writing & Editing, Story Development, World & Plot Management, Web Research)는 각자의 생성·판단에 OpenAI `gpt-6-luna`를 사용하는 목표 설계다(2026-11-12 사용자 결정). 모델은 역할별 지시와 허용 입력을 구분하며 별도 서버나 모델 인스턴스를 뜻하지 않는다. 규칙으로 끝나는 단계나 근거가 없는 요청에서 불필요한 모델 호출을 강제하지 않는다. 기존 구현의 모델 설정과 검증 기록은 실제 상태 그대로 유지한다.

공통 **Retrieval**은 필요한 업무 Agent가 호출할 수 있는 정본 변경 없는 도구다. **다중 인물 Simulation**은 사용자가 명시적으로 시뮬레이션 실행을 요청한 경우에만 실행하는 서브그래프다(2026-11-12 사용자 결정). 검수·기획 중 필요하다고 판단했다는 이유만으로 자동 실행하지 않는다. 단독 요청이나 시뮬레이션을 명시한 복합 요청에서만 실행한다. Writing & Editing은 두 도구를 직접 호출하지 않고 전달받은 허용 입력으로 문장·문체 생성에 집중한다. 필요 시 별도의 Review가 검수한다(2026-11-12 사용자 결정). 도구의 호출 가능 범위와 입력은 Content가 확인한 Scope와 작업 종류로 제한하며, 모델이 선택한 ID나 도구 호출만으로 권한을 부여하지 않는다. Retrieval은 기존 검색 계약의 결과를 조립한다. Simulation은 가상 결과를 반환하며 정본을 수정하지 않는다. 단순 조회는 서브그래프를 억지로 거치지 않고 직접 실행할 수 있다. [도구 계약](03-rag-simulation-design.md#공통-서브그래프-도구)

### 요청별 작업 계획과 실행 검증 (목표)

Router는 사용자 의도에 맞춰 필요한 작업의 **수·순서·조건**을 요청마다 선택한다(2026-11-12 사용자 결정). 특정 실행 순서표나 고정된 Agent 수를 강제하지 않는다. 작업은 여섯 업무 Agent와 명시적으로 요청한 Simulation 중에서 고르며, 사용자 의도가 모호하거나 지원하지 않는 조합이면 확인 질문 또는 명시적 미지원으로 돌려준다. 예를 들어 “검수하고 문제가 있으면 고쳐줘”는 Review → 조건부 Writing으로 계획하고 실제 지적이 있을 때만 수정을 실행한다.

실행 전 Python 로직이 계획을 검증한다. 등록된 기능과 허용된 조건만 사용하고, 작업별 입력이 선행 결과와 호환되는지, 의존 순서·대상·Content가 확정한 Scope와 기준 판본이 맞는지 확인한다. 다른 작품/Fork나 권한 범위를 넓히지 않으며, Writing의 Retrieval·Simulation 직접 호출 금지와 시뮬레이션의 명시적 사용자 요청 조건도 확인한다. 시뮬레이션 요청 여부가 불분명하면 확인하고 실행을 보류한다. 조건을 만족하지 않거나 필수 근거가 부족한 후속 작업은 실행하지 않으며, 실패·부분 결과는 성공으로 꾸미지 않는다.

Router의 분류나 계획은 인가·승인 또는 정본 적용이 아니다. 실행 시 선택된 Agent만 호출하고 Content가 권한과 정본 쓰기를 소유한다. 작업 결과를 보고 계획에 없던 Agent를 추가하는 재계획, 병렬화·반복 실행, 호출 수·시간·비용 한도의 구체 값은 아직 결정하지 않는다. 검증된 계획의 실행은 사용자 요청(2026-11-12)으로 LangGraph Main StateGraph에 올렸다([현재 구현](#현재-구현-langgraph-오케스트레이션)). 별도 LLM 메인 Agent·범용 Registry는 두지 않는다.

MVP는 순차 최대 세 단계·기능당 한 번이다. [확정한 연결](06-design-decisions.md#복합-실행)과 입력이 독립인 순차 작업을 지원한다. [84개 실행 사례](09-execution-scenarios.md)에 MVP 경로와 후속 검토 대상을 표시한다.

변경 후보의 보관·승인·현재 권한과 판본 확인·적용은 Content가 소유한다. MVP는 승인·적용 후 새 요청에서 적용 영수증과 새 판본을 확인한다. 단계 입력 대기의 같은 실행 재개는 사용자 요청(2026-11-12)으로 HITL로 구현했다([현재 구현](#현재-구현-langgraph-오케스트레이션)). 승인·적용 뒤 같은 실행의 재개는 후속 검토한다. Writing 적용 범위는 작성 중 회차 초안이다.

### Python 실행 계약 (목표, 미구현)

Python 실행기는 Router의 `feature`·`when`을 사용자 의도 분류로 받고 등록된 규칙으로 입력을 연결한다. Content는 각 단계의 권한·대상·판본을 확인한다. Python은 실행 전에 필수 입력의 출처(요청, Content 자료, 특정 선행 결과)와 종류를 확인하고 소비 직전에 실제 결과를 검증한다. 독립 단계는 자체 입력으로 실행한다. 둘 이상의 해석이 가능하면 사용자에게 확인한다.

1. **계획 검증:** 전체 계획의 순서·입력 출처·조건과 순차 최대 3단계·기능당 1회 제한을 확인한다. 연결표에 없는 결과 전달과 같은 실행의 사용자 선택·승인 재개는 후속 범위다. 지원할 수 없는 계획을 확인 없이 축소 실행하지 않는다. 모델이 임의 함수·도구·경로·코드를 지정할 수 없다.
2. **범위 확인:** Content가 Core 인증 뒤 확정한 사용자·작품/Fork·대상·기준 회차/판본·허용 목적과 범위를 사용한다. Router나 Agent가 만든 ID·문구는 인가 근거가 아니다. 모든 작업과 선행 결과는 이 범위와 일치해야 하며, 필요한 Content 확인이 실패하거나 대상·판본이 맞지 않으면 해당 작업을 중단한다. 실행 중 권한·판본 변경과 확인 불가의 처리 시점은 기능별 Content 계약에 따르고 미정이면 연결 전에 정한다.
3. **입력 연결:** 아래 작업 간 계약에 따라 실제 선행 작업의 결과 종류·상태·근거·대상·판본을 확인하고 필요한 입력만 전달한다. 선행 결과가 불완전하거나 타입·작품/Fork·회차·판본·범위가 맞지 않으면 의존 작업을 실행하지 않는다. 같은 허용 scope라도 서로 다른 회차가 필요한 작업은 Content가 각각 확인한 대상·판본과 연결 관계를 사용하며 무조건 동일 판본으로 간주하지 않는다.
4. **실행과 조건:** 사용자가 지정한 순서와 검증된 의존 순서를 지킨다. 요청이 요구한 입력은 모두 확인한다. 실행 실패·시간 초과가 발생하면 독립 작업을 포함한 새 단계를 시작하지 않는다. 완료·부분 결과는 각 상태로 남기고 남은 단계의 중단 이유를 표시한다. 조건이 거짓인 건너뜀은 실패와 구분한다.
5. **결과 전달:** 단계별 결과·출처·판본과 상태를 계획 순서로 표시한다. 사용자 확인이 필요하면 필요한 내용과 새 요청 절차를 안내한다. Content가 실제 보관한 후보와 승인·적용 영수증을 표시한다. [기록 보관·요청 키·단계별 시간 제한](04-infrastructure-integration.md#복합-실행-기록과-중복-요청)을 적용한다.

#### 현재 구현: LangGraph 오케스트레이션

`app/orchestration/`(2026-11-12 사용자 요청)이 위 계약 중 **구현된 Agent와 공통 Retrieval 도구만** 연결한다. 대상은 Story Context / Q&A(`manuscript.service.answer`), Writing & Editing(`writing.agent.draft|patch`), Web Research(`research.service.research`)다.

- `POST /internal/v1/orchestrations` `{request, operation?, materials?, inputs}` → `plan` 노드가 Intent Router를 호출하고 계획을 검증한 뒤 기능 노드를 계획 순서로 한 번씩 실행하고 `finish`로 끝낸다. `inputs`는 Content가 권한·판본을 확인해 기능별로 채운 각 내부 API의 요청 DTO다(`story_context`, `writing_editing.draft|patch`, `web_research`).
- Router 결과가 `clarify`·`rejected`면 고정 문구를 그대로 돌려준다. 미구현 기능(Review·Development·World & Plot·Simulation)이나 조건부 단계가 하나라도 있으면 `unsupported`이며 아무 Agent도 실행하지 않는다(축소 실행 금지). 단계 입력이 빠지면 대화 없는 요청은 `needs_input`으로 끝내고, 대화 안에서는 아래 HITL로 멈춘다. 조건부 단계는 Review의 Finding 연결이 필요해 아직 실행하지 않는다.
- 구현된 세 Agent 사이에는 등록된 결과 전달 연결이 없으므로 각 단계는 자기 입력으로만 실행한다(“MVP · 순차”). 기능 실패는 그 단계의 `failed`와 고정 메시지로 남기고 새 단계를 시작하지 않으며, 완료한 결과는 보존한다. 결과는 Agent 원본 결과를 계획 순서로 묶을 뿐 종합 모델을 호출하지 않는다.
- `POST /internal/v1/orchestrations/stream`은 같은 그래프를 노드 단위로 흘리는 SSE다. 이벤트는 `plan`(계획 단계) → 단계마다 `started`(다음 노드가 실제로 실행할 기능)·`step`(그 단계의 결과·실패) → `done`(위 응답과 같은 최종 결과)이다. 응답 헤더를 보낸 뒤라 Router 실패는 `error` 이벤트 하나로 알리고 끝낸다. 내부 인증은 스트림 전에 검사한다. Agent의 모델 호출은 스트리밍하지 않아 단계 결과는 완성본 단위로 온다.
- 공통 Retrieval: 요청에 Content가 서명한 `scope {scopeToken}`이 있으면 Q&A 단계가 `inputs.story_context` 없이 Content 내부 검색 API로 근거를 받는다([계약](07-retrieval-contract-and-mocks.md#공통-retrieval-도구-오케스트레이션-2026-11-12-사용자-결정)). 그래서 Q&A는 입력 대기 없이 실행된다. resume의 `scope`로 Content가 새로 서명한 토큰이 오면 저장된 토큰을 바꾼다. 작가용 진입점은 Content `POST /api/v1/works/{id}/writing-ai/orchestrations`다. 결과에는 인용 근거(`sources`)와 `coverage`가 붙는다.
- 멀티턴(#57): 요청에 `conversation {threadId, scope}`가 있으면 체크포인터의 그 대화에 턴을 쌓는다. `threadId`는 Content가 발급하고 `scope`는 Content가 확인한 사용자·작품(예: `user:1/work:2`)이다. 첫 턴의 scope와 다르면 409(SSE는 `error`)이며 실행하지 않는다. 다음 턴의 Router에는 최근 5턴의 요청을, Q&A에는 최근 5턴의 질문·답을 `history`로 넘긴다. 둘 다 "그 목표" 같은 지칭 해석용 자료이고 근거가 아니다(Q&A 인용은 여전히 발췌만). Writing과 웹 조사에는 대화 기록을 보내지 않는다(웹 조사는 외부 전송 최소화). 턴마다 단계·메시지·누락 목록은 새로 시작한다. Q&A 검색어 재작성은 Content 몫이며 아직 없다.
- HITL(사용자 요청 2026-11-12): 대화 안에서 단계 입력이 빠지면 `gate` 노드가 LangGraph `interrupt`로 멈추고 `waiting`(계획 단계·`missingInputs`, SSE는 `waiting` 이벤트 뒤 `done`)을 돌려준다. Content가 작가에게 계획을 보여 주고 선택 구간·콘티·검색 발췌·외부 전송 동의 같은 입력을 준비해 같은 `conversation`으로 `resume {approved, inputs}`를 보내면 Router를 다시 부르지 않고 저장된 계획을 이어 실행한다. 입력이 여전히 모자라면 다시 `waiting`, `approved=false`면 `cancelled`이며 아무 Agent도 실행하지 않는다. 멈춘 실행이 없는데 resume하면 409다. 대기 중에 새 `request`를 보내면 새 턴으로 시작하고 멈춘 실행은 이어가지 않는다.
- Content MCP 초안 반영(DEC-49, 2026-11-13 사용자 결정): 대화 요청에 Content가 확인한 `target {workId, episode}`가 있으면 Writing & Editing 결과 뒤 `apply` 노드가 `interrupt`로 멈추고 `waiting`(`awaitingApproval: writing_editing`, 반영 대상 `approvalEpisode`, 결과 포함)을 돌려준다. 같은 대화의 `resume {approved: true}`이면 모델을 다시 부르지 않고 그 요청의 `X-User-Authorization`(작가 Bearer)으로 Content MCP `episode_read`로 최신 초안·revision을 읽은 뒤 `episode_update_draft`로 저장하고 단계에 `approval`·`applied {episode, revision}`를 남긴다. 새 원고 Text는 기존 초안 뒤에 이어 붙이고(덮어쓰지 않음), Patch는 초안 안에 선택 문장이 정확히 한 번 있을 때만 바꾼다. 없거나 여러 곳이면 409로 쓰지 않는다. 거절하면 결과만 남기고 쓰지 않는다. 반영 실패(인증 401·권한 403·revision 충돌 409·입력 422는 Content detail, 그 밖은 502·연결 503)는 결과를 보존한 채 단계 `failed`이며 남은 단계를 시작하지 않는다. 토큰은 요청 컨텍스트로만 넘기고 그래프 상태·체크포인트·추적에 넣지 않는다. 버전 저장·발행·삭제 도구는 부르지 않는다. `target`이 없거나 대화가 아니면 기존처럼 제안만 반환한다. Content는 아직 Writing 단계 입력(콘티·선택 구간)을 보내지 않아 화면에서 이 경로는 입력 대기 뒤에만 열린다.
- 체크포인트는 `AI_CHECKPOINT_DATABASE_URL`(postgresql://…/storyfork_ai)의 LangGraph `AsyncPostgresSaver`가 보관한다. **Core·Content의 `storyfork`와 다른 전용 DB**를 쓴다(#337, 사용자 결정 2026-11-13). 같은 DB의 `public`에 먼저 테이블이 생기면 빈 DB에서 Core Flyway가 시작을 멈추기 때문이다. 시작 때 `ensure_database`가 같은 서버의 `postgres` DB에 접속해 전용 DB가 없으면 만들고(DB 생성 권한이 없으면 수동 생성을 알리는 오류로 시작 실패), 이어서 `setup()`이 그 DB에 LangGraph 테이블(`checkpoints`·`checkpoint_blobs`·`checkpoint_writes`·`checkpoint_migrations`)을 만든다. 예전 설정으로 `storyfork`의 `public`에 이미 만들어진 체크포인트 테이블은 옮기거나 지우지 않는다. 실행 상태일 뿐 작품 정본이 아니며 Content의 Fork `checkpoint` 테이블과 다르다. 설정이 없으면 대화 요청은 503(SSE는 `error`)이고 대화 없는 요청은 그대로 실행한다. 보관 기간 정리는 아직 없다.
- 대화 세션 CRUD(#331, 사용자 요청 2026-11-13): 대화 테이블 없이 체크포인터 하나로 처리한다. 실행·갱신마다 checkpoint metadata에 `scope`를 남기고 상태에 `title`(첫 요청 앞 40자)을 두며, 턴마다 최종 응답을 `turns[].reply`에 남긴다. `GET /internal/v1/conversations?scope=`는 그 scope의 thread별 최신 checkpoint를 최근 순으로, `GET /internal/v1/conversations/{threadId}?scope=`는 제목과 턴별 요청·응답(멈춘 턴은 `waiting` 응답으로 마지막)을 준다. `PATCH …/{threadId} {scope, title}`는 `update_state`로 제목을 바꾸며 승인·입력 대기 중이면 409다(대기 상태를 덮으면 resume이 깨진다). `DELETE …/{threadId}`는 `delete_thread`, `DELETE …/{threadId}/turns/{index}`는 그 턴 직전 완료 checkpoint에서 갈라 그 턴과 뒤를 지운다(첫 턴이면 대화 삭제). 메시지 수정은 stream 요청의 `fromTurn`으로 같은 갈림점에서 새 요청을 실행한다. 첫 턴 수정은 새 턴이 끝날 때 기존 턴 목록을 교체한다. 실행 예외로 새 턴이 완료되지 않으면 기존 이력은 보존한다. 옛 갈래 checkpoint는 남지만 최신 상태가 아니다. scope가 다르거나 없는 대화는 404(SSE는 `error`)다. Content 공개 경로는 `/api/v1/works/{id}/chat/sessions`(목록·발급), `…/{threadId}`(이력·제목·삭제), `…/{threadId}/messages`(SSE 전송·resume `{approved, inputs?}`), `…/messages/{index}`(PUT 수정 SSE·DELETE)이며 Content는 작품 소유를 확인하고 `user:{회원}/work:{작품}` scope를 붙여 중계한다. SSE는 요청 스레드에서 응답에 바로 써 흘린다(비동기 응답은 끝날 때 ASYNC dispatch가 Security에서 거부돼 연결이 끊기므로 쓰지 않고, Security 설정은 바꾸지 않는다). 화면(집필실·세계관 채팅)은 Q&A 근거로 발행 회차가 필요하다.
- Langfuse 추적(#302, 사용자 요청 2026-11-12): 턴마다 `writing_ai.orchestration` trace를 열고 응답 `runId`로 그 trace id를 돌려준다. 하위에 `plan`(Router 결과 단계), `step.<기능>`(Agent 실행·실패)을 붙이며, resume한 단계도 저장된 `runId`로 같은 trace에 붙는다. Q&A는 `story_context.qa` 아래 `retrieval`(Content가 보낸 근거의 id·회차·종류) → `qa.generation`(모델명·입출력 토큰·지연·실패) → `evidence_check`(인용 id·발췌 밖 인용·주장·누락 수)로 나뉜다. 직접 호출(`/internal/v1/manuscript/qa`)도 같은 구조의 독립 trace가 된다. 팀 결정(2026-11-13)으로 질문·원고 인용·답변 본문은 각 단계의 input/output에 남긴다(root·`plan`의 요청, `story_context.qa`의 질문·답변, `retrieval`의 원고 인용, `qa.generation`의 입력·구조화 답변). 설정·현재 관계 발췌는 `tracing.excerpts`가 참조만 남기고, 회원 계정 정보·키는 보내지 않는다. 예외는 span 밖에서 올려 기능 실패의 고정 메시지만 남긴다. `LANGFUSE_PUBLIC_KEY`·`LANGFUSE_SECRET_KEY`가 없으면 꺼지고 `runId`도 없다. 전송은 SDK 백그라운드라 Langfuse 장애가 결과를 바꾸지 않는다. 오케스트레이션의 Q&A가 공통 Retrieval 도구를 쓰면 `retrieval` 아래 Content가 잰 공급자별 단계(`retrieval.elasticsearch`·`retrieval.neo4j` 등, ms·결과 수)가 붙는다. Content Q&A API를 직접 쓰는 경로의 검색 단계는 아직 trace에 없다. 서버는 로컬 self-host Compose로 띄운다([실행 방법](../../infrastructure/README.md#집필-ai-추적용-langfuse-302)).
- Router 실패는 503이다. 그래프 상태는 체크포인트 저장을 위해 JSON 값만 담는다. Q&A의 인용 id가 전달한 발췌 밖이면 Python도 502로 거절한다.

#### 작업 간 입력·출력

| 연결 | 다음 작업에 전달할 최소 입력 | 실행 전 확인 |
|---|---|---|
| Development → Writing | 기획이 지정한 집필용 BeatPlan 하나와 목표 회차, Content가 확인한 허용 입력 | 사용자가 바로 집필을 요청했는지와 대상·판본을 확인한다. 직접 선택·비교를 요청하면 기획 결과를 표시하고 새 집필 요청에서 선택을 받는다. |
| Review → Writing/Editing | 수정 요청, 유효 Finding과 근거·대상 원문 스냅샷/위치, 기준 초안 판본·선택 범위 | 아래 조건 판정 통과, Finding이 같은 대상·판본·허용 범위에 속하는지 확인. 선택 밖 변경 금지. 현재 적용은 작성 중 회차 초안만 지원한다. |
| Writing → Review | 생성된 Text/Patch의 고정 후보 또는 불변 참조, 원래 초안 revision·선택 범위/원문 스냅샷, 검수 요청과 허용 근거 | 후보와 원래 초안을 구분하고 Finding 위치를 후보 기준으로 표현한다. 후보 연결·참조 방식은 미구현이며 [후보 검수 계약](03-rag-simulation-design.md#4-writing--editing-agent)을 따른다. |
| 저장된 Simulation 후보 → 새 Review 요청 | 가상 후보의 불변 참조와 허용 기록, 기준 시점, 정본 비교 근거 | 별도 검수 요청과 Content 확인을 요구한다. 가상 후보와 기존 원고를 구분한다. |
| 선택된 Simulation 후보 → 새 Writing 요청 | 사용자가 선택·수정한 가상 후보의 참조와 집필 대상, Content가 확인한 입력 | 후보 선택과 새 집필 요청을 확인한다. 가상 재료와 정본 근거를 구분하고 다른 후보·인물 비공개 상태는 전달하지 않는다. |

MVP에서 한 요청 안에 이어지는 결과 전달은 Development → Writing, Writing/Editing → Review, Review → 조건부 Editing과 Development → Writing → Review다. Writing과 Editing은 한 기능으로 세므로 Writing → Review → Editing은 후속이다. 여러 선행 결과를 한 단계에 모으는 신규 연결과 기타 전달은 후속 검토한다. 서로 다른 저장소의 변경은 개별 승인으로 적용한다.

#### 조건부 수정 `if_issues_found`

사용자가 수정도 요청하고 검수가 정상 완료되어야 한다. Finding의 대상·판본·위치·비교 근거와 작성 중 초안의 허용 범위를 확인한다. 근거 부족·실패·부분 검수는 조건을 충족하지 않는다. 정상 검수에 수정할 항목이 없으면 이유를 표시하고 건너뛴다. 가상 반응은 확정 오류로 세지 않는다.

**확정 오류만 수정 입력에 포함한다.** 의심이 섞이면 검수 결과에 따로 표시하고, 의심만 있으면 조건부 수정 미지원으로 안내한다. 여러 구간에 확정 오류가 있으면 사용자가 지정한 한 구간만 수정한다. 지정이 없으면 구간을 선택한 새 편집 요청을 안내한다. 후보는 Content 승인 경로를 따른다.

현재 Router는 Review뿐 아니라 웹 조사·World & Plot 뒤의 `if_issues_found`도 분류할 수 있다. 이 출력이 곧 수정 허용이라는 뜻은 아니다. 각 기능의 Finding·근거·원문 범위를 위 조건에 맞게 연결하는 계약이 확정되기 전에는 해당 조건부 수정 실행을 지원하지 않는다.

#### Simulation 명시 요청 확인

전용 UI에서 Simulation을 선택하면 해당 선택을 확인한다. 자유 입력에서 Simulation이 분류되면 별도 실행 확인을 받은 뒤 계획을 검증한다. 사용자 요청이 모호한 경우에는 먼저 어떤 기능을 원하는지 확인한다. Router 분류나 Agent 판단만으로 실행하지 않는다.

집필 재료는 사용자가 후보를 선택·수정한 뒤 해당 참조를 담은 새 Writing 요청으로 받는다. 필수 인물 정보가 부족하면 부족 항목을 표시하고 진행 여부를 확인한 새 Simulation 요청으로 받는다. 이후 작업도 현재 권한·대상·판본과 후보 참조를 검증한다.

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

## 여섯 업무 Agent와 공통 Simulation의 경계

| 기능 | 입력 | 출력 | 호출 관계 |
|---|---|---|---|
| Story Context / Q&A | 질문, 작품/Fork/회차, 허용 자료 | 출처 있는 답변·모르는 항목 | 조회만 수행 |
| Review | 원고/설정, 검사 종류 | 위치·근거·확정/의심이 있는 Findings | Mechanical 또는 Semantic; Simulation은 사용자가 명시적으로 요청한 경우에만 실행 |
| Character Simulation Subgraph | 상황, 인물별 허용 지식, 행동 상한, 작가/독자 모드 | 범위가 제한된 가상 기록·임시 상태·장면 요약, 모드별 검토 결과 | 턴마다 행동 → 상태 갱신 → 다음 인물. [모드별 결과](03-rag-simulation-design.md#시뮬레이션-결과와-후속-검수) 참고 |
| Writing & Editing | Content가 확인한 허용 입력과 새 원고의 계획 **또는** 기존 원고의 고정 구간 | 새 Text **또는** before/after Patch | 문장·문체 생성에 집중; Retrieval·Simulation 직접 호출 없음. 필요 시 Review가 검수 |
| Story Development | 앞선 사건, 콘티, 목표 회차 | 전개 대안·인사이트·BeatPlan | 문장 생성 요청에만 Writing 호출 |
| World & Plot Management | 설정/플롯 변경 의도, 관련 판본 | 영향 대상·충돌·변경 후보 | 분석 후 Content 승인 경로 |
| 웹 조사 | 현실 검증 질문, 작품의 필요한 최소 맥락 | URL·검색 시각·주장별 근거·불확실성 | 웹 자료는 작품 정본과 분리 |

웹 조사는 외부 사실을 확인하는 도구다. 검색 결과의 문장은 명령이 아니며, 웹 페이지가 작품 설정이나 원고를 직접 수정할 수 없다. 외부 전송 동의와 개인정보·비공개 원고 최소화가 선행한다.

이전의 3개 업무 역할 통합안은 사용자 결정으로 채택하지 않는다. 여섯 업무 Agent와 기존 기능 경계를 유지한다. 이전 제안은 [검토 이력](08-agent-consolidation-proposal.md)이며 현행 설계가 아니다.

## Agent 결과를 묶어 표시 (목표)

Router가 요청별 작업을 선택하고 Python이 계획을 검증·실행한 뒤, Python이 결과를 묶어 표시한다(2026-11-12 사용자 결정). 각 Agent가 이미 생성한 답변·원고·검수·계획 등을 결과 종류로 구분하며, 직렬 작업은 실행 순서로 표시한다. 연결 문구가 필요하면 서버의 고정 문구를 사용한다. 결과를 종합하거나 재작성하기 위한 별도 답변 모델은 호출하지 않는다. Router의 분류 모델과 각 Agent의 모델, 명시적으로 실행한 Simulation의 장면 요약 모델은 각각의 기존 역할을 유지한다.

Text/Patch, Finding, BeatPlan, Simulation 기록과 변경 후보를 해당 Agent의 원본 결과로 제공한다. 결과마다 작업 상태와 사용한 출처·판본, 근거 부족·충돌, 확인/추론/불명 및 가상 여부를 유지한다. 사용자가 직접 볼 수 있는 결과는 Content가 확인한 권한 범위로 제한한다. 승인·적용 상태와 후보 참조는 Content가 실제 보관하거나 확인한 결과만 표시하며, 생성 완료를 승인이나 실제 반영으로 표시하지 않는다.

작업의 실패·부분 완료·건너뜀·중단을 각 단계에 표시한다. 결과·참조가 유효하지 않거나 후보 보관이 실패하면 해당 실패를 드러낸다. 사용자 소유 기록은 [기능별 정책](04-infrastructure-integration.md#복합-실행-기록과-중복-요청)을 적용한다. 복합 실행 결과는 해당 응답에서 묶어 표시한다.

## 결과의 공통 규칙

run ID, 대상 판본, 사용한 출처, 누락, 실제 모델/검색 성공 여부를 함께 기록한다. 확정된 원문·설정, AI 추론, 시뮬레이션 가정, 웹 사실을 다른 상태로 표시한다. 출처가 없거나 오래된 판본이면 정확한 답변으로 꾸미지 않는다. 외부 장애를 fixture 성공으로 대체하지 않는다.
