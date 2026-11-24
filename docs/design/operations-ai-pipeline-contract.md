# AI 파이프라인 관찰 대시보드 계약 (DEC-58)

LLM Ops `프롬프트·평가` 쪽(`/admin?tab=llm&view=prompts`, sub 없음 = 가장 왼쪽·기본 보기 `전체(AI 파이프라인)`, 명시하려면 `&sub=all`. #857 전에는 `프롬프트·모델` 쪽의 `전체`)에 **AI 파이프라인** 보기를 더해, 집필 AI 파이프라인 전체를 캔버스 그래프로 보이고
노드(Decision Guard·메인 에이전트·업무 Agent·도구)를 누르면 그 노드가 실제로 어떻게 판정·처리했는지 모든 기록을 보인다.
목적은 프롬프트 개선이다(Decision Guard는 OpenAI Decisions 판정 모델이라 프롬프트로 고친다). 평가 세트를 이 화면에서 만드는 일은 다음 단계다.

## 결정 (2026-11-20 사용자 결정)

- 화면: `프롬프트·평가` 쪽 위에 보기 전환 `전체(AI 파이프라인) | 에이전트별 평가 | 프롬프트 | 모델`(주소 `&sub=`, 없으면 전체, 에이전트별 평가는 `&sub=evals`). AI 파이프라인 = 파이프라인 캔버스 + 노드 기록 패널. 프롬프트가 연결된 노드(`promptNames`)는 캔버스 아래 노드 버튼 목록과 노드를 골랐을 때 열리는 기록 패널 머리에 `프롬프트 보기`가 있어 그 프롬프트의 상세(개선 루프)로 바로 간다(하나면 버튼·여럿이면 목록 메뉴·없으면 버튼 없음. 캔버스 노드 위에는 두지 않는다: 그림이 지저분해지고 노드 이름을 가렸다. 새 API 없음, 프롬프트 이름은 한국어 표시 이름과 작은 코드로 보인다). 캔버스 위 드롭다운 `워크플로우`(주소 `&flow=`)로 전체와 내부 흐름을 고른다(아래 '워크플로우(내부 흐름) 보기').
- 캔버스는 이미 쓰는 `react-force-graph-2d`(d3-force + canvas, 새 의존성 없음)로 그리고, 노드 위치는 고정 좌표(왼→오 흐름)다.
- 데이터 정본은 Langfuse observation이다(DEC-55). 새 저장소를 만들지 않는다. 기본 기간은 최근 7일.

## 파이프라인 노드

운영 서비스가 고정 목록으로 정의한다(`llmops/service/PipelineNodes.kt`: `id`, 표시 이름, 다음 노드, observation 이름 규칙). 이름 규칙은 AI 코드의 실제 observation 이름과 맞춘다.
요청의 모든 observation은 그 요청의 태그 `feature:<키>`를 달므로, 업무 Agent·도구 노드는 태그 `feature:orchestration` 요청 안에서 **이름 목록**으로 가르고,
단독 노드는 태그 `feature:<키>` 요청 안에서 그 키로 시작하는 이름이다(아래 `writing_editing`만 `writing`으로 시작한다). 이름이 같은 observation(`rating.generation`·`world_review*`)도 요청 종류별로 따로 센다.

| 노드 | observation 이름(`orchestration` 요청 안) | 다음 |
|---|---|---|
| `request` 집필 AI 요청 = 요청 전체(루트) | 요청 루트 `orchestration` | guard |
| `guard` Decision Guard | `decision_guard`, `decision_guard.generation` | main (거절이면 끝) |
| `main` 메인 에이전트 | `main_agent`, `main_agent.blocked` | 업무 Agent 7개(읽기·검토 4 → 작성 3), mcp |
| `qa` 작품 질문 | `step.story_context`, `story_context.qa`, `qa.generation`, `retrieval`, `retrieval.embedding`·`.elasticsearch`·`.postgres_verify`, `world_read`, `evidence_check` | main |
| `manuscript_review` 원고 검수 | `step.manuscript_review`, `manuscript_review.generation` | main |
| `rating` 심의 등급 | `step.rating`, `rating.generation` | main |
| `research` 고증 조사 | `step.research`, `research.generation`·`.platform_pick`·`.platform_refer` | main |
| `writing` 기획·집필·수정 | `step.writing_editing`, `writing.plan`·`.plan_pick`·`.plan_revise`·`.generation` | apply, main |
| `world` 세계관 | `step.world`, `world_review`, `world_review.generation`, `world_review.enrich`(`.generation`), `world_review.impact`(`.generation`) | apply, main |
| `character_simulation` 인물 시뮬레이션 | `step.character_simulation`, `step.character_simulation.plan`, `simulation.plan`·`.act`·`.narrate`·`.check`·`.director`·`.turn` | apply, novelbrain, main |
| `novelbrain` NovelBrain 기억 회상 | `novelbrain.recall` | — |
| `mcp` Content MCP 도구 | `mcp.`로 시작하는 이름 | — |
| `apply` 작가 승인 반영 | `step.writing_editing.apply`, `step.world.apply`, `step.character_simulation.apply` | mcp |

**흐름**: `request`는 요청 전체(루트)라 다른 노드는 모두 그 안의 단계이고, 이 노드의 건수는 요청 수·지연은 요청 전체 지연이다. Guard를 지난 요청은 메인으로 가고,
메인은 업무 Agent 7개(읽기·검토 `qa`·`manuscript_review`·`rating`·`research` → 작성 `writing`·`world`·`character_simulation` 순)와 Content MCP 도구를 부른다.
업무 Agent는 결과를 메인에 돌려주고 메인이 그 결과로 답을 다시 종합하므로 Agent마다 `next`에 `main`(되돌아가는 선)이 있다. 작가 승인 반영은 `writing`·`world`·`character_simulation`에만 있어
`apply`로 가는 선도 이 셋뿐이고(`qa`·`manuscript_review`·`rating`·`research`는 메인으로만 돌아간다), `apply`는 Content MCP로 반영하므로 `mcp`로 이어진다.
그래서 `next`에는 `main` ⇄ 업무 Agent 순환이 있다.

노드 id `qa`·`writing`은 약칭이고 AI 쪽 기능 키는 `story_context`·`writing_editing`이라 observation 이름은 `step.story_context`·`step.writing_editing`이다.
하위 이름에는 `step.` 접두가 없다.

단독 기능은 자기 요청(태그 `feature:<키>`)이며 캔버스 아래 줄에 따로 둔다(`next`는 비고 `standalone: true`): `proposals`·`initial_world`·`manuscript_extraction`(회차 원고
전처리 작업도 이 요청이다)·`work_tags`·`world_review`·`rating_direct`(요청 `rating`. id `rating`은 위 업무 Agent라 겹치지 않게 바꿨다)·
`writing_editing`(Content가 `/internal/v1/writing/drafts`·`patches`로 직접 부르는 새 원고·부분 수정 요청. 요청 루트 `writing_editing`과 모델 호출 `writing.generation`이라 접두는 `writing`이다).
초안의 `preprocessing` 노드는 두지 않는다: 전처리 작업의 요청 루트가 `manuscript_extraction`이라 같은 데이터이고 따로 가를 이름이 없다.
AI 코드의 단독 요청 중 `manuscript_review`·`web_research`는 노드가 없다.

## AI 계측 보강 (ai-service, 반영됨 2026-11-21)

- `decision_guard` span의 `output`에 판정 결과 `{allowed, reason, capabilities}`를 남긴다(전에는 metadata에 있었다. 모델의 기능별 yes/no 원답은 남기지 않는다).
- `main_agent` generation의 `output`을 `{text, toolCalls:[{name, args}]}`로 남긴다(전에는 글 또는 도구 이름 목록). 도구를 부른 이유는 그 호출의 인자(`ask_*`의 요청문)와 같은 응답의 글이다.
- 메인이 실행하지 않고 돌려보낸 도구 호출(노출 밖·함께 실행하지 못해 미룸·대상 작품·세계관 불일치·MCP 한도)은 `main_agent.blocked` span(input `{name}`, output `{reason}`)으로 남긴다.
  라이브러리 미들웨어(도구 호출 한도·승인 거절)가 돌려보내는 호출은 남기지 않는다.
- NovelBrain 회상(`novelbrain.service.recall`, 인물 시뮬레이션이 부른다)은 `novelbrain.recall` retriever span으로 남긴다: input `{actor_id, episode, stage, query}`(나레이터는 actor_id null, query는 앞 500자), output `{recalled:[{ref, card_id?, title?, score}], count}`. 카드 항목(`card:<id>[#문서]`)만 카드 id·제목을 담고 관계·원고 항목은 ref와 점수뿐이며 카드·관계·원고 본문은 남기지 않는다.
- 새로 남기는 observation의 level은 모두 DEFAULT다. 이 계측 전 7일 안의 기록은 옛 모양이다(`decision_guard`는 output 없이 metadata에 판정, `main_agent`의 output은 글 또는 도구 이름 목록).
- 프롬프트 시드 문자열은 바꾸지 않는다.

## 운영 API (`llm` 권한)

| 경로 | 내용 |
|---|---|
| `GET /llmops/pipeline?from&to` | `{nodes:[{id,label,next:[id],standalone,count,errors,p95LatencyMs?,promptNames:[string]}]}` — 노드별 observation 수·ERROR level 수·p95 지연과 그 노드 generation에 연결된 프롬프트 이름. 기본 기간은 최근 7일이고 비었거나 거꾸로면 400. p95는 노드 이름별 p95 중 가장 큰 값이고 측정된 지연이 없으면 null이다 |
| `GET /llmops/pipeline/{nodeId}/records?from&to&level&page` | 그 노드 observation 목록(최신순, 20개씩) `{items:[{id,traceId,name,type,startTime,latencyMs?,level,statusMessage?,model?,promptName?,promptVersion?,input?,output?,metadata?}], page, size, total}`(trace 목록과 같은 쪽 모양). `latencyMs`는 시작~종료 밀리초이고 Langfuse 시각이 밀리초 단위라 같은 밀리초 안에 끝난 단계(NovelBrain 회상 같은 빠른 단계)는 0, 종료 시각이 없으면 null이다. 본문은 칸마다 앞 8,000자까지(JSON 글은 JSON으로, 넘으면 앞 8,000자만 글로). `metadata`에서는 Langfuse SDK가 모든 observation에 붙이는 `scope.`·`resourceAttributes.`로 시작하는 키를 뺀다(8,000자는 남은 키 기준, 남는 키가 없으면 null). `level`은 Langfuse level 하나(`DEBUG`·`DEFAULT`·`WARNING`·`ERROR`, 없으면 전체, 그 밖의 값은 400). 쪽은 0부터이고 최신 1,000개까지만 닿는다(쪽 번호 50부터 400). 없는 `nodeId`는 404 |
| `GET /llmops/traces/{id}` (기존 확장) | observation마다 `parentObservationId`·`input`·`output`·`metadata`를 더한다(같은 8,000자 제한) — 작업 하나의 실행 흐름 트리. `parentObservationId`는 부모 단계의 id(루트는 null)이고 `input`·`output`·`metadata`는 JSON 글이면 JSON으로 주고 `metadata`에서는 위와 같이 SDK 키를 뺀다 |

Langfuse 실패는 502 `UPSTREAM_FAILED`(기존 규칙).
Guard의 거절은 level이 아니라 `decision_guard` 출력 `allowed=false`(level DEFAULT)라 `level` 필터로는 걸러지지 않는다. 화면은 기록의 출력으로 거절을 표시한다.

## 화면

- 캔버스: 노드 = 이름·건수·오류 수(오류가 있으면 위험 색), 선 = 흐름. 위 흐름의 되돌아가는 선 때문에 `next`는 순환이므로 열(왼→오)은 되돌아가는 선(`request`부터 서버 순서로 따라가 이미 지나온 노드로 돌아오는 선)을 빼고 정하고, 가는 선과 되돌아오는 선은 겹치지 않게 그린다(되돌아오는 선은 비켜 그린 점선). 업무 Agent 열은 읽기·검토(`qa`·`manuscript_review`·`rating`·`research`)가 위, 작성(`writing`·`world`·`character_simulation`)이 아래이고 각 묶음 위에 작은 라벨을 달며, 두 묶음 사이 빈칸이 요청·Guard·메인과 같은 줄에 와서 메인→MCP 직접 선이 업무 Agent 위를 지나지 않는다. `novelbrain`은 인물 시뮬레이션 오른쪽 같은 줄에 놓인다. 묶음 표는 프런트(`llmOpsPipeline.ts`)에 고정이라 새 Agent는 거기에도 넣고(없으면 라벨 없이 묶음 밖에 놓임) 모르는 id의 노드도 연결(`next`)대로 빠지지 않고 그려진다. 노드를 누르면 캔버스·노드 버튼 아래에 기록 패널(표가 전체 폭이다. 오른쪽 반쪽 폭에 두면 표 칸이 잘리고 페이지가 가로로 늘어났다).
- 기록 패널: 결과 필터(전체·통과·거절/오류), 기록 표(시각·결과·지연·모델·프롬프트 버전; 지연은 노드 p95·실행 흐름 단계도 같게 0이면 '1ms 미만', 종료 시각이 없어 모르면 —), 줄을 펼치면 입력·출력·판정 근거(메타데이터)·도구 호출(이름·인자)을 그대로 보인다. NovelBrain 기억 회상 기록은 출력의 `recalled` 목록을 '회상한 기억' 목록으로 더 보인다(카드 항목은 제목 뒤에 ref의 문서 조각을 붙여 같은 인물 카드의 문서를 구분하고(`#identity`·`#soul`·`#goal` → '제목 · 정체'·'제목 · 성격'·'제목 · 목표', 그 밖의 조각은 원문 그대로), 관계·원고 항목은 제목이 없어 ref).
  Guard는 결과 칸에 허용/거절과 기능별 판정을, 메인은 부른 도구와 인자를 보인다. 줄마다 `실행 흐름 보기`(그 trace의 observation 트리, 단계마다 입력·출력)와
  그 노드 프롬프트로 가는 `프롬프트 보기`(기존 프롬프트 상세)를 둔다.
- 키보드: 캔버스는 보조이고, 같은 노드 목록을 캔버스 아래 버튼 목록으로도 둔다(초점·Enter로 열림). 서버 노드가 없는 단계(워크플로우의 구조용 노드)는 점선 테두리로 구분한다.

## 워크플로우(내부 흐름) 보기 (#857 3차, 2026-11-24 사용자 결정)

캔버스 위 드롭다운 `워크플로우`(주소 `&flow=<키>`, 없거나 모르는 값은 전체)로 같은 캔버스 자리에 한 흐름만 그린다. 첫 항목 **전체**(기본)는 위 서버 노드 흐름이고, 나머지는 **내부에 순서 있는 여러 LLM 단계가 있는 에이전트**의 내부 흐름이다(단일 호출 에이전트는 넣지 않는다). 전체에서 내부 흐름이 있는 노드를 고르면 기록 패널에 `내부 흐름 보기`가 있어 그 항목으로 바꾼다. 흐름을 바꾸면 고른 노드·열어 둔 기록은 닫는다. 새 API는 없다.

- **숫자 규칙**: 건수·오류는 서버 노드(`GET /llmops/pipeline`)와 1:1인 단계에만 보인다(인물 시뮬레이션의 `novelbrain`). 서버 노드가 없는 단계는 **구조용 노드**(점선 테두리, 이름과 'LLM 호출'·'LLM 아님'만, 지어낸 숫자 없음)이고, 고르면 서버에 기록을 묻지 않고 단계 설명(코드 근거)과 `프롬프트 보기`만 보인다. 서버가 그 흐름의 LLM 단계를 한 노드로 함께 세는 값은 흐름 위 한 줄('서버는 이 흐름의 LLM 단계를 ‘…’ 한 노드로 함께 세요…')과 `집계 기록 보기`(그 서버 노드의 기록 패널)로 보인다.
- **프롬프트 보기**: 단계가 쓰는 프롬프트(구조용 단계는 흐름 정의의 `prompts`)는 노드 버튼 목록과 단계 설명·기록 패널 머리의 `프롬프트 보기`로 간다. 캔버스 위에는 두지 않는다.
- 정의는 프런트 도메인 상수(`frontend/src/domain/entities/llmOpsFlows.ts`의 `FLOW_DEFS`)이고 단계·순서·프롬프트의 근거는 아래 표의 코드다. 같은 에이전트의 프롬프트 전체와 같은지(SEEDS)·서버 노드 id가 실제로 있는지를 단위 테스트가 파일로 대조한다. 배치는 기존 `layoutPipeline`을 그대로 쓰고, 두 칸 넘게 되돌아가는 선(시뮬레이션의 다음 턴)만 노드 아래로 도는 호로 그린다.

| 흐름(`flow`) | 속한 서버 노드 | 단계 순서(LLM = 프롬프트) | 코드 근거 |
|---|---|---|---|
| `simulation` 인물 시뮬레이션 | `character_simulation` | 계획(LLM `character_simulation.plan`, [시뮬레이션] 버튼 시작이면 없음) → **한 턴마다** 연출 결정(LLM `.direct`, Decisions API) → NovelBrain 기억 회상(서버 노드 `novelbrain`) → 턴 쓰기(LLM `.act` 인물 대사 / `.narrate` 나레이션·독백·마무리) → 검사(서버 규칙 + LLM `.check`) → 위반이면 그 턴만 최대 2회 다시 쓰고 통과하면 다음 턴(연출 결정) → 장면이 끝나면 작가 승인·초안 반영 | `orchestration/tools.py` `ask_character_simulation`, `simulation/scene_agent.py`·`director.py`·`tools.py`·`service.py`·`agent.py` |
| `preprocessing` 원고 전처리 | `manuscript_extraction` | 접수·회차 읽기(Content claim) → 회차별 추출(LLM `manuscript_extraction.extract`, 회차 4개씩 병렬) → 정체 정리(LLM `.resolve`, 작품당 1회) → 정리(코드, LLM 아님) → 적재(Content) | `preprocessing/worker.py`, `manuscript_extraction/service.py`·`agent.py`, [원고 전처리 계약](manuscript-preprocessing-contract.md) |
| `review` 원고 검수 | `manuscript_review` | 초안 읽기 → Mechanical 검수(LLM `manuscript_review.mechanical`) ‖ 설정 읽기 → Semantic 검수(LLM `.semantic`)(`both`면 병렬, 하나만 고르면 그 검수만) → 지적 검증·위치 찾기(코드) | `manuscript_review/service.py`·`agent.py` |
| `research` 고증 조사 | `research` | 조사 종류 고르기(task) → 웹 조사(LLM `web_research.search`) / 공개 세계관 목록 읽기 → 세계관 고르기(LLM `research.pick`) → 상세 읽기 → 참고 카드 고르기(LLM `research.refer`) | `orchestration/tools.py` `ask_research`, `research/service.py`·`agent.py` |
| `writing` 기획·집필·수정 | `writing` | 작업 종류 고르기(task) → 전개 기획(LLM `writing_editing.plan`) → 원고 쓰기(LLM `.draft`, 바로 집필) / 선택 구간 수정(LLM `.patch`) / 고칠 계획 고르기(LLM `.plan_pick`) → 계획 수정안(LLM `.plan_revise`) | `orchestration/tools.py` `ask_writing`·`_revise_plan`, `writing/agent.py` |

넣지 않은 것(단일 LLM 호출이거나 호출이 서로 이어지지 않음): Decision Guard·메인(프롬프트 하나), 작품 질문(검색 뒤 LLM 1회), 심의 등급(1회), 세계관(검토·보강·영향 분석은 서로 독립인 호출 1회씩), 단독 `proposals`·`work_tags`·`writing_editing`(1회), **초기 세계관 분석**(`initial_world`: 저장된 세계관 초안 → AI 후보 → 작가 검토의 별개 기능이고 LLM 1회라 원고 전처리 흐름이 아니다). AI 자율 연재(`serial.*`, 여러 단계)는 서버 파이프라인 노드가 없어 이번에 넣지 않았다(요청하면 같은 방식으로 더한다). 인물 시뮬레이션에 '장면 요약' 같은 요약 호출은 코드에 없다.

### 단계별 서버 노드 (예정, 서버 구현 없음)

지금 서버는 흐름의 LLM 단계를 아래처럼 한 노드로 함께 센다. 단계별 건수·오류·기록을 보이려면 운영 서비스가 노드를 더해야 하고, 그러면 프런트는 흐름 정의에서 그 단계를 `server`로 바꾸면 된다.

| 흐름 | 지금 | 단계별 노드를 더하려면 |
|---|---|---|
| 인물 시뮬레이션 | `character_simulation` 한 노드가 `simulation.plan`·`.director`·`.act`·`.narrate`·`.check`·`.turn`을 함께 센다 | **관측 이름이 이미 갈려 있어** 노드 정의(`PipelineNodes.kt`)에 이름만 더하면 된다(plan·director·act·narrate·check). 기억 회상은 이미 `novelbrain` 노드 |
| 원고 전처리 | `manuscript_extraction` 한 노드. 추출과 정체 정리가 **같은 관측 이름 `manuscript_extraction.generation`** 이다 | `promptName`(`manuscript_extraction.extract`·`.resolve`)으로 나누거나 AI가 이름을 나눠야 한다 |
| 원고 검수 | `manuscript_review`. 두 검수가 같은 이름 `manuscript_review.generation` | `promptName`(`manuscript_review.mechanical`·`.semantic`)으로 나눈다 |
| 고증 조사 | `research`. 웹 `research.generation`, 공개 세계관 `research.platform_pick`·`.platform_refer` | 이름이 이미 갈려 있어 노드만 더하면 된다 |
| 기획·집필·수정 | `writing`. `writing.plan`·`.plan_pick`·`.plan_revise`는 이름이 갈려 있고 원고·부분 수정은 같은 이름 `writing.generation` | 앞 셋은 노드만, 원고·부분 수정은 `promptName`(`writing_editing.draft`·`.patch`)으로 나눈다 |

LLM이 아닌 단계(접수·정리·적재·읽기·검증·승인 반영 등)는 Langfuse에 LLM 호출 observation이 없으므로 서버 노드를 요청하지 않는다(필요하면 AI가 단계 span을 남겨야 한다).

## ponytail 한계

- 워크플로우 정의(`llmOpsFlows.ts`)는 코드를 읽고 정한 프런트 상수다. 에이전트의 단계·순서가 바뀌면 같이 고친다(프롬프트 목록은 단위 테스트가 SEEDS와 대조하지만 단계 순서는 코드 변경을 따라가지 못한다).
- 노드 목록과 선(`next`)은 코드에 고정이다. 새 Agent를 추가하거나 실행 흐름·승인 반영이 바뀌면 운영 목록도 함께 고친다.
- 본문 8,000자 자르기 때문에 긴 원고는 끝이 보이지 않는다. 전문은 Langfuse에서 본다(개발자용).
- 노드 p95는 풀링 백분위가 아니라 노드 이름별 p95 중 가장 큰 값이다(노드마다 쿼리를 따로 보내지 않으려는 단순화). 건수·오류 수·프롬프트 이름은 Metrics API 집계라 정확하다.
- 이름으로만 가르므로 `retrieval`은 시뮬레이션이 불러도 작품 질문 노드에 센다. 목록에 없는 이름은 어느 노드에도 세지 않는다.
- `novelbrain.recall`은 지금 인물 시뮬레이션(인물 턴·나레이션)에서만 부른다. 다른 곳에서 부르게 되어도 `novelbrain` 노드에 센다(선은 인물 시뮬레이션에서만 이어진다).
