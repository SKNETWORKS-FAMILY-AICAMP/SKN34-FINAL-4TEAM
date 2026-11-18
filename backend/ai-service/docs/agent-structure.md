# AI Service 구현 경계

## 현재

현재 실행 코드는 Health, 단일 OpenAI 호출을 사용하는 이어쓰기 제안 생성, 초기 세계관 후보 추출입니다.

- `app/main.py → health/router.py → HealthResponse`: 내부 상태를 반환합니다. Health에서 OpenAI 키를 요구하거나 모델 클라이언트를 생성하지 않습니다.
- `app/main.py → generation/router.py → generate → OpenAI.responses.create`: `POST /internal/v1/proposals`에서 `X-Internal-Token`을 검증하고 전달받은 문맥·요청으로 이어쓰기 제안을 생성합니다. 키·모델은 생성 요청 시 읽고 클라이언트는 요청 후 닫습니다. 미설정·제공사 실패는 503이며 모델·응답 ID·사용량을 결과에 포함합니다.
- `app/main.py → initial_world/router.py → extract`: `POST /internal/v1/initial-world/extractions`에서 Content가 고정한 입력으로 후보만 생성하고 원문 근거·기존 ID를 검증합니다. 저장·승인은 하지 않습니다.
- `app/main.py → world_review/router.py → service.review → agent.review(gpt-6-luna 구조화 출력)`: `POST /internal/v1/world-reviews`에서 Content가 보낸 세계관 스냅샷의 설정 오류(모순·인물 문서 역할·사건 필수 정보)를 지적하고 선택 수정안을 반환합니다. 카드 id·지적 종류·수정안 규칙을 service가 다시 검증하며 카드를 고치지 않습니다. 오케스트레이션 `world_review` 노드는 Content MCP `world_studio_read`로 연결 세계관을 읽어 같은 service를 부릅니다([계약](../../../docs/design/world-review-contract.md)).
- `app/intent/service.py → judge → agent.decide → create_agent(SensitiveDataGuard·ModerationGuard → DecisionsModel) → OpenAI Decisions`: Decision Guard(#473, #55 Router 대체)입니다. 작가 요청을 OpenAI Decisions(`gpt-6-luna`)의 `guard` 질문과 등록된 8개 기능별 `yes/no` 질문으로 판정해 `DecisionResult {allowed, reason, capabilities}`를 돌려줍니다. 순서·`clarity`·검사 종류·작업 종류는 묻지 않습니다(메인 에이전트가 정함). 선택지·고정 문구는 `prompt.py`, 결과 불변식은 `models.py`에 둡니다. Decisions 앞의 입력 가드레일 미들웨어가 작가 요청의 이메일·카드번호·API 키(`PIIMiddleware` 상속, 모델 호출 없이 `sensitive_data`)와 moderation 차단 범주(`OpenAIModerationMiddleware` 상속, `unsafe`)를 먼저 거릅니다(#373). 자유 입력은 이번 요청만으로 먼저 판정하고 고른 기능이 없을 때만 이전 요청(`history`)을 붙여 한 번 더 묻습니다. UI가 고른 operation은 가드레일만 거쳐 그 기능 하나로 확정합니다. 자체 HTTP 엔드포인트는 없고 메인 에이전트의 `DecisionGuardMiddleware.before_agent`가 턴당 1회 호출합니다. [Decision Guard](../../../docs/writing-ai-architecture/02-ai-architecture.md#decision-guard-jev-가드-대체)
- `app/main.py → story_qa/router.py → service.embed | service.answer → agent.answer → agent_runtime.run(create_agent)`: `POST /internal/v1/manuscript/embeddings`는 고정 리비전 E5-small(ONNX, `--extra manuscript`)로 Content가 보낸 문단·질문을 384차원 벡터로 바꿉니다. 모델 밖 계산이라 Agent가 아닌 service가 실행합니다. `POST /internal/v1/manuscript/qa`는 Content가 범위 확인·원문 재대조를 마친 발췌(원고·설정·현재 관계)만으로 구조화 답변(주장별 confirmed/inferred·sourceIds, gaps)을 1회 생성합니다(#56). `service.answer`가 주장마다 전달한 발췌 id만 인용했는지 확인하고 어긋나면 502입니다. 호출자는 Content `ManuscriptIndexJob`(색인)과 `ManuscriptQaService`(검색·답변)이며 Content도 인용 ID를 다시 검증하고 응답을 구성합니다. [원고 벡터 인덱스 v1](../../../docs/writing-ai-architecture/07-retrieval-contract-and-mocks.md#원고-벡터-인덱스-v1)
- `app/main.py → research/router.py → service.research → agent.search → agent_runtime.run(create_agent, web_search)`: `POST /internal/v1/research/web`에서 작가 질문·짧은 맥락을 웹 검색으로 확인해 주장별 확인·상충·미확인과 출처 URL·검색 시각을 반환합니다(#292). agent는 검색 호출 실패·불완전 응답을 오류로 바꾸고, service는 실제 검색 결과에 없는 URL을 근거에서 지우며 근거가 남지 않은 주장을 미확인으로 내립니다. 아직 Content 호출자는 없습니다. [웹 조사 설계](../../../docs/writing-ai-architecture/03-rag-simulation-design.md#7-웹-조사-에이전트)
- `app/main.py → work_tags/router.py → service.suggest → agent.propose → agent_runtime.run(create_agent)`: `POST /internal/v1/work-tags/suggestions`에서 Content가 넘긴 작품 제목·소개·발행 회차(최대 3개)와 장르 승인 목록·상한으로 장르·키워드 후보만 만듭니다(#372). `service.suggest`가 목록 밖 장르·상한·중복·장르 이름을 그대로 반복한 키워드를 보정하지 않고 502로 거부하며 저장하지 않습니다. 추적에는 원고 본문 없이 제목과 회차 번호만 남깁니다. 호출자는 Content `WorkTagSuggestionService`입니다.
- `app/main.py → writing/router.py → agent.draft|patch → agent_runtime.run(create_agent)`, 오케스트레이션 `→ agent.plan|plan_and_draft`: `POST /internal/v1/writing/drafts`는 계획·허용 문맥으로 새 회차 원고 Text를, `POST /internal/v1/writing/patches`는 선택 구간 하나의 before/after Patch를 반환합니다(#62). 전개 기획 `plan`(BeatPlan 대안 1~3개, 원고 없음)과 계획 하나를 정해 바로 쓰는 `plan_and_draft`는 오케스트레이션만 부릅니다(#387). 모델 밖 검증이 없어 service 없이 router가 agent를 호출합니다. 호출자는 Content `ProposalService.writeDraft|writePatch`이며, 저장은 기존 제안 승인(accept)에서 판본을 다시 확인한 뒤에만 합니다. [Writing 설계](../../../docs/writing-ai-architecture/03-rag-simulation-design.md#4-writing--editing-agent)
- `app/main.py → review/router.py → service.review → content_mcp.call + agent.review → agent_runtime.run(create_agent)`: `POST /internal/v1/reviews`에서 작가 Bearer(`X-User-Authorization`)로 회차 초안(`episode_read`)을, Semantic이면 연결 세계관의 그 회차 시점 공개 설정(`world_studio_list`·`world_studio_read`, 연결한 세계관이 없는 Fork는 이어받은 원작 세계관 `work_inherited_world`)도 읽어 Mechanical·Semantic 중 하나 또는 둘 다(`both`, 스레드 병렬, Semantic → Mechanical 순서로 합침)로 검수합니다(#59·#369). service가 분류·원고 구절·설정 ref를 대조하고 어긋나면 502, 구절 위치를 UTF-16 `[start,end)`로 붙이며 위치가 하나로 정해지지 않으면 null·`suspected`입니다. Simulation·Retrieval은 부르지 않습니다. 호출자는 오케스트레이션 `review` 단계(검사 종류는 단계 입력이며 Router가 알아내면 `plan`이 채움, 대상은 `target`)이며 단독 Content 호출자는 없습니다. [Review 현재 구현](../../../docs/writing-ai-architecture/03-rag-simulation-design.md#현재-구현--mvp-59)
- `app/main.py → rating/router.py → service.rate → content_mcp.call + agent.rate → agent_runtime.run(create_agent)`: `POST /internal/v1/ratings`에서 작가 Bearer(`X-User-Authorization`)로 요청한 회차 초안(`episode_read`, 1–10개)을 모두 먼저 읽고, 연결 세계관이 있으면 인물 카드(`world_studio_list`·`world_studio_read` 1회, 그 회차까지 공개된 것만)를 더해 제목·작가 메모·비속어 빈도(규칙 신호)와 함께 회차마다(스레드 병렬) 모델이 판별 항목 일곱 개의 수준(0–3)·근거 구절·금지 표현(`prohibited`)을 평가합니다. 심의 기준은 `app/rating/guidelines/*.md`를 파일 이름순으로 지시문에 붙이며 MCP·파일 도구는 쓰지 않습니다. models가 항목 누락·근거 유무를 검증하고 문턱값으로 `adult`·`general`·`needsReview`를 계산하며, service가 근거 구절이 그 회차 초안에 있는지(공백·둥근 따옴표 정규화) 대조합니다. 응답 형식·근거 위반은 그 회차만 판별 실패(`verdict: null`)이고 모델 미설정·호출 실패는 503입니다. 묶음 판정은 하나라도 `adult`면 `adult`, 전부 `general`일 때만 `general`이며, 결과는 제안이라 작품 등급을 바꾸지 않습니다. 호출자는 오케스트레이션 `rating` 단계(단계 입력 없음, `target` 회차 하나)이며 단독 Content 호출자는 없습니다. [Rating 설계](../../../docs/writing-ai-architecture/03-rag-simulation-design.md#5-rating-agent)
- `app/agent_runtime.py run → LangChain create_agent(ChatOpenAI) + ModelCallMiddleware + ModelCallLimitMiddleware`: Story Context Q&A·Writing·웹 조사·Review·Rating·장르·키워드 추천 업무 Agent의 공통 실행 틀입니다(#373, [DEC-52](../../../docs/design/decisions.md)). 모델은 `ChatOpenAI`(Responses API, `store=False`, `max_retries=0`, 기능별 출력 한도·timeout)이고 구조화 출력은 제공사 strict JSON schema(`ProviderStrategy`)입니다. `ModelCallMiddleware`(`AgentMiddleware` 상속, `wrap_model_call`)가 모델 호출을 기능별 Langfuse generation(`qa`·`writing`·`research`·`review.generation`·`rating.generation`·`work_tags.generation`)으로 감싸 모델·사용량·출력을 남기고, 키·모델 미설정·제공사 실패는 503, 스키마 위반·불완전 응답은 502로 기능의 고정 문구 실패로 바꿉니다. 호출 한도는 `ModelCallLimitMiddleware(run_limit=1)`입니다. 웹 조사는 내장 `web_search`를 `tool_choice=required`로 강제하고 검색 출처를 응답 content 블록으로 받습니다. Decision Guard(Decisions 모델 슬롯·가드레일 미들웨어)·메인 에이전트·시뮬레이션은 각자 `create_agent`를 조립하며 이 함수를 쓰지 않습니다.
- `app/main.py → orchestration/router.py → service.run → LangGraph(main_agent → scene ⇄ apply → finish)`: `POST /internal/v1/orchestrations`입니다(#473). `main_agent` 노드가 메인 에이전트(`agent.py`: `create_agent`, `ChatOpenAI` Responses API·`store=False`·재시도 없음·병렬 도구 호출 켬, 지시는 `prompt.py`)를 실행합니다. 미들웨어는 `DecisionGuardMiddleware`(턴당 1회 판정, 거절·기능 없음·`world_plot`이면 모델 호출 없이 `rejected`·`clarify`·`unsupported`, 판정 실패 503)·`MainModelMiddleware`(`main_agent` generation 추적, 모델 실패는 단계 보존 `failed`)·`ToolCallLimit`(라이브러리 상속, 턴당 3회·기능당 1회, 막거나 미룬 호출은 세지 않음)·`DynamicToolMiddleware`(판정 기능의 도구만 노출, 노출 밖 호출은 한도가 세기 전에 막고 실행 직전 재확인, 한 모델 턴의 병렬 묶음은 조회형 `PARALLEL`만 동시에 실행하고 `ask_writing`·`ask_character_simulation`·입력이 빠진 호출은 `[순차]`로 미룸(#474), 실패·취소·입력 대기·시뮬레이션 계획 뒤와 5번째 호출에는 도구 제거)·`ModelCallLimitMiddleware`(메인 모델 턴당 5회) 순서이며, `after_model` 훅이 역순으로 돈다는 점에 맞춘 순서입니다. 도구는 `tools.py`의 `ask_*` 7종(`ask_story_qa`·`ask_review`·`ask_world_review`·`ask_writing`·`ask_web_research`·`ask_rating`·`ask_character_simulation`)이 기존 업무 서비스를 감쌉니다. 모델 인자는 `request`(2,000자)와 `check`·`task`·`fix`뿐이고 대상·scope·입력·동의는 상태에서 읽으며, 결과는 `steps[]`(원본, reducer로 모아 모델이 부른 순서)와 ToolMessage 요약 JSON으로 남깁니다. 입력이 빠지면 도구 안 `interrupt`로 `waiting`이 되고 같은 대화의 `resume {approved, inputs, scope?}`가 멈춘 도구만 이어 실행합니다(대화가 없으면 `needs_input`, 거절이면 `cancelled`). Review 뒤 조건부 수정은 `ask_writing(task=patch, fix)`가 이번 턴 Review의 확정 지적·한 곳·revision 일치를 검증하고, 고칠 것이 없으면 `skipped`입니다(#370). Writing의 기획·바로 집필(`task=plan|draft`)은 Content MCP `work_context_read`로 허용 문맥을 읽어 실행하고, 기획 결과는 반영 승인을 묻지 않습니다(#387). `POST /internal/v1/orchestrations/stream`은 같은 실행을 FastAPI 내장 SSE(`plan`·`started`·`step`·`waiting`·`done`|`error`)로 흘립니다(`plan`은 판정 기능, `started`는 도구의 custom stream). `conversation {threadId, scope}`가 있으면 체크포인터에 턴을 쌓아 메인 에이전트에는 최근 5턴의 요청·답변을, Decision Guard·Q&A에는 이전 요청·질문답을 지칭 해석용으로 넘기고, 첫 턴과 다른 scope는 409로 막습니다(#57). 체크포인트는 `lifespan`이 `AI_CHECKPOINT_DATABASE_URL`로 연 `AsyncPostgresSaver`가 보관하며, 설정이 없으면 대화 요청은 503입니다. 이 URL은 Core·Content DB가 아닌 전용 DB(`storyfork_ai`)를 가리키고, `ensure_database`가 시작 때 없으면 만듭니다(#337). `/internal/v1/conversations…`는 같은 체크포인터로 대화 목록·이력·제목·삭제·턴 삭제를 처리하고, stream의 `fromTurn`이 메시지 수정입니다(#331). 호출자는 Content `WritingAiService`(작가 진입점 `/api/v1/works/{id}/writing-ai/orchestrations`, 채팅 `/api/v1/works/{id}/chat/sessions…`)입니다. [실행 계약](../../../docs/writing-ai-architecture/02-ai-architecture.md#유지되는-실행-계약)
- `app/orchestration/service.py apply → content_mcp/service.apply_writing → MCPServerStreamableHttp → Content /mcp`: 대화 안 Writing 결과(과 시뮬레이션 장면)를 작가가 승인하면 작가 Bearer로 `episode_read` → `episode_update_draft`를 호출해 회차 초안에 반영합니다(DEC-49). 토큰은 요청 컨텍스트로만 받고 상태·체크포인트에 넣지 않습니다. [집필 AI 연결](../../../docs/design/content-mcp-contract.md#집필-ai-연결)
- `app/orchestration/tools.py ask_character_simulation → service.py scene → app/simulation/scene_agent.py(LangChain create_agent) → director·tools·service·agent(OpenAI) + app/novelbrain.recall + content_mcp.call`: 인물 시뮬레이션(#58·#362, [계약](../../../docs/design/character-simulation-contract.md))입니다. 별도 HTTP 엔드포인트와 router는 없고 오케스트레이션이 호출합니다. 파일은 `models.py`(DTO·`Scene`·`Decision`·`SceneAction`)·`prompt.py`·`agent.py`(모델 호출 1회씩: 계획·인물 턴·나레이션·검사, 호출마다 공통 `MODEL_EVENT`로 사용량·지연·실패를 알림)·`service.py`(세계관 읽기·계획·장면 상태 순수 함수·연출 규칙·턴 입력 조립)·`director.py`(연출 결정)·`tools.py`·`scene_agent.py`(미들웨어·에이전트 조립)·`errors.py`입니다. `ask_character_simulation` 도구가 Content MCP `world_studio_list`(linkedWorkId)·`world_studio_read(id, episode)`로 작품의 연결 세계관을 기준 회차(`target.episode`) 시점으로 읽고(연결한 세계관이 없는 Fork는 `work_inherited_world`로 원작 세계관의 공개 카드·Fork 기준 회차까지를 읽기 전용으로 이어받으며 `content_mcp.inherited_world`가 관계 확인 불가를 실패로 닫는다, [계약](../../../docs/design/character-simulation-contract.md#fork-이어받기-365)) 요청 문장에서 모드(IF·흐름)·IF 전제·비트·참여 인물을 정합니다(`agent.plan`, 모델에는 인물 id·이름만 전달, 흐름 모드 비트는 작가가 적은 목록을 그대로 쓰고 없으면 제안). [시뮬레이션] 버튼의 시작 양식(`OrchestrationRequest.simulation`)이 있으면 계획 모델을 부르지 않고 그 값을 `plan_from_form`으로 세계관(활성 인물 카드·모드별 필수값)에 맞춰 보며, 어긋나면 되묻지 않고 단계 failed입니다. 정하지 못한 것이 있으면 장면을 쓰지 않고 `clarify` 한 문장으로 되묻고(종합 호출 없음), 연결 세계관이나 인물이 없으면 명시적 실패입니다. 메인 에이전트가 끝난 뒤 바깥 `scene` 노드가 장면 에이전트를 실행합니다(도구 안에서 쓰면 턴마다 resume 때 계획 모델이 다시 불리기 때문): `StageMiddleware`(턴 사이 `interrupt`: next·edit·redo·stop·반려) → `DirectorMiddleware`(`OpenAIDecisionClassifier`=TypeSafeClassifier를 OpenAI Decisions에 연결한 서브클래스가 이번 턴(나레이션·독백·대사·마무리)·화자·시점을 정하고, `wrap_model_call`이 결정대로 도구 호출을 만듦. 에이전트 모델 슬롯은 호출되지 않는 자리 표시) → 도구(`narrate`·`monologue`·`speak`·`end_scene`: 전지적은 `narrator_view`(기준 회차까지 세계관, 2단계), 인물 시점·독백·대사는 `character_view`(그 인물의 문서·자기가 끝점인 관계·`recall(stage=3)`·장면 상태, 다른 인물 속마음 미전달)로 입력을 새로 조립해 `agent.act|narrate`) → `SceneCheckMiddleware`(`agent.check` 1회로 오류 1·2·3과 IF 전제/비트 진행, 나레이션은 미래 누설을 판정하고 `service.verify`가 검사 종류·근거 ref를 다시 확인, 위반이면 그 턴만 최대 2회 재생성하고 고정 안내 문구만 전달, 통과한 턴을 장면에 붙이고 턴 이벤트 발행). 호출 한도는 ModelCallLimit·ToolCallLimit이 안전망으로 지킵니다. 장면(`Scene` JSON)은 에이전트 상태에 있어 바깥 그래프의 체크포인터에 저장되고, 에이전트의 `interrupt`가 바깥 그래프로 전달돼 `waiting`(`awaitingScene`)이 됩니다. 턴이 끝나면 미들웨어가 상태의 `step`에 단계 항목을 남기고, 공통 `ProgressMiddleware`(`app/agent_runtime.py`, 맨 앞)가 custom stream으로 흘려 SSE `step`(누적 결과)이 되며, 공통 `UsageLedger` 콜백이 턴·호출별 토큰·지연·실패를 추적 span으로 남깁니다(#373). 인물 대사 한도 12턴·재생성 2회이고 검사 반복 위반(`check_failed`)·비트 거부(`beat_rejected`)·한도(`turn_limit`)·중간 실패는 쌓은 턴을 지킨 채 장면을 멈추고(턴이 있으면 작가가 이어 가거나 끝내도록 계속 대기, 첫 턴 실패면 단계 failed) 승인 대상이 아닙니다. 끝난 장면(작가의 `stop` 포함)은 Writing과 같은 `apply` 승인 interrupt(`awaitingApproval: character_simulation`)를 거치며 승인 대기 중의 장면 조작(edit·redo·next)은 장면으로 되돌립니다. 승인 시 나레이션·독백·대사 문단을 순서대로 빈 줄로 이은 텍스트를 `apply_writing`의 Text 경로로 초안 뒤에 잇습니다. 받을 수 없는 `resume.scene`은 그래프 실행 전에 422(SSE는 `error`)입니다. 시뮬레이션 기록은 대화 체크포인트에만 남습니다.
- `app/retrieval/service.py → httpx → Content POST /internal/v1/ai/qa/retrieval`: 공통 Retrieval 도구입니다. AI는 DB에 직접 접속하지 않고, Content가 서명한 `scopeToken`을 되돌려 보내 Content가 범위·권한을 다시 확정한 근거와 공급자별 측정값을 받습니다. 오케스트레이션 Q&A가 `scope`로 호출하며 Content 응답 오류는 상태를 유지한 `RetrievalFailure`입니다. [계약](../../../docs/writing-ai-architecture/07-retrieval-contract-and-mocks.md#공통-retrieval-도구-오케스트레이션-2026-11-12-사용자-결정)
- `app/novelbrain/service.py`: 인물 시뮬레이션의 기억 추론 라이브러리입니다(HTTP 경계가 없어 router 없음). 세계관 스냅샷(Content MCP `world_studio_read`)과 Retrieval 원고 발췌를 받아 그래프 PPR → 원고 → BM25·RRF → 인물 시점 필터 순으로 `recall`합니다. 인물 시점 필터는 `stage=3`이고 `character_id`가 있을 때만 적용되며, 필터 없는 결과(`character_id=None`)는 전지적 나레이터용이라 인물 문맥에 그대로 넘기지 않습니다. 모델을 부르지 않습니다. [계약](../../../docs/design/character-simulation-contract.md#novelbrain--차례로-쌓는-4단계)
- 생성은 Content의 [`ProposalService`](../../content-service/src/main/kotlin/ai/storyfork/content/proposal/service/ProposalService.kt)가 [`GenerationClient`](../../content-service/src/main/kotlin/ai/storyfork/content/proposal/client/GenerationClient.kt)를 통해 요청합니다. Content는 권한·기준 버전·문맥을 확인하고 DB 트랜잭션 밖에서 생성 API를 호출합니다. 응답을 받으면 기준을 다시 확인해 제안을 저장하며, 채택과 원고 반영은 별도 요청으로 처리합니다. Core의 AI 호출은 Health 확인 경로입니다.

[최신 설계](../../../docs/design/design.md)의 집필 AI 여섯 Agent와 시뮬레이션 행동·요약 목표 모델은 OpenAI `gpt-6-luna`로 결정됐습니다. 그 밖의 모델·제공사·에이전트 프레임워크는 미정입니다. 집필 AI 복합 실행만 사용자 요청으로 LangGraph를 씁니다. 업무 Agent(Q&A·Writing·웹 조사·Review)와 메인 에이전트는 LangChain `create_agent`(`langchain-openai`)로, 이어쓰기·초기 세계관·Decision Guard·시뮬레이션 모델 호출은 `openai` SDK로 실행합니다. 남아 있는 `openai-agents` 의존성을 전체 기술 선정 완료로 해석하지 않습니다.

## 기능 패키지 구조

AI 기능은 `app/<기능>/` 수직 슬라이스로 둡니다. 파일은 그 책임이 실제로 있을 때만 만들며, 모든 기능이 아래 파일을 전부 가질 필요는 없습니다.

```text
app/<기능>/
├── router.py   # 내부 인증, HTTP 입출력 검증, 실행 함수 호출, 오류의 HTTP 변환
├── models.py   # 요청·응답·structured output DTO와 그 불변식
├── prompt.py   # 모델 지시문(자료 속 명령을 따르지 않는 안전 지시 포함)
├── agent.py    # 모델 호출 1회(업무 Agent는 app/agent_runtime.run), timeout, 제공사 오류의 기능 오류 변환
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
- `agent`는 요청 시점에 키·모델을 읽어 모델 클라이언트를 만듭니다. 업무 Agent는 `app/agent_runtime.run`(create_agent + 공통 미들웨어)으로 호출하고 그 밖의 기능은 OpenAI 클라이언트를 호출 후 닫습니다. `store=False`, 기능별 timeout, `max_retries=0`을 쓰고 미설정·제공사 실패·불완전 응답을 기능 오류로 바꿉니다. tool·handoff·graph는 기능 계약이 요구할 때만 씁니다.
- `service`는 입력에 없던 식별자·근거·URL을 인용하지 않았는지 대조하고, 통과한 결과만 반환합니다. 잘못된 결과를 보정하거나 임의 결과로 바꾸지 않고 오류로 반환합니다.
- `errors`의 기능 실패는 상태 코드와 고정 메시지만 가집니다. 입력·원고·모델 응답·원문 예외를 오류 메시지나 로그에 넣지 않습니다.
- 시작 시 객체를 조립하는 bootstrap·DI 컨테이너·provider·registry는 두지 않습니다. 기능 사이에 공유할 코드는 둘 이상의 기능이 같은 책임을 가질 때 `app/` 아래 모듈 하나로 둡니다.
- 자동 재시도와 정상 응답을 가장하는 fallback은 추가하지 않습니다.

## 서비스 내부의 기능별 구조

**Kotlin·Spring Boot 업무 서비스**는 기능별로 `Controller → Service → Repository → PostgreSQL`을 따릅니다. Controller는 공개 HTTP 입출력, Service는 업무 규칙·권한·트랜잭션, JPA Repository는 영속성을 맡습니다. Content에서 모델 실행이 필요하면 Service가 전용 HTTP Client(`client/`, 계약 DTO는 `client/dto/`)를 통해 AI Service에 요청합니다. [Spring 계층 지침](../../core-api/AGENTS.md)

**Python·FastAPI AI Service**는 `app/main.py`에서 기능별 Router를 등록하고 위 기능 패키지 구조를 따릅니다. 생성·조회·취소·재시도가 필요한 기능은 기능 계약에서 필요한 상태와 소유자를 정합니다. [AI 구현 지침](../AGENTS.md)

## STORYFORK 서비스 경계 (DEC-41)

[4개 서비스 구조](../../../docs/design/service-boundaries.md)에 따라 Core는 회원·인증·크레딧·회원 알림, Content는 창작·독서 정본·콘텐츠 인가·채택·발행, 운영은 문의·공지·신고 사건·운영 판단·감사·작업 감시, AI는 허용된 모델 실행을 소유합니다. Content와 AI는 내부 HTTP의 요청·응답 DTO로 연결합니다. 실행 체크포인트와 색인을 도입할 경우 각 기능 계약에서 소유·복구 범위를 정하고 회차·세계관의 업무 체크포인트와 구분합니다.

LLMOps는 운영 영역입니다. Langfuse는 MVP 이후 도입 시 별도 제품으로 배포하며 자체 UI와 운영 화면 API 통합 중 방식은 미정입니다. Spring에서 제품 전체를 재구현하지 않으며 AI 계측·버전 적용·평가 실행 위치는 연동 계약에서 정합니다. `app/tracing.py`가 집필 AI 오케스트레이션과 Q&A RAG 단계(근거 참조 → 모델 생성 → 인용 대조)를 Langfuse SDK로 메타데이터와 질문·원고·답변 본문을 추적합니다(#302, 팀 결정 2026-11-13). 설정·현재 관계 발췌는 참조만 남깁니다. 키가 없으면 꺼집니다. 서버는 `infrastructure/docker-compose.langfuse.yaml`의 로컬 self-host로 띄웁니다.

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
