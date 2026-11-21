# AI 파이프라인 관찰 대시보드 계약 (DEC-58)

LLM Ops `프롬프트·모델` 쪽(`/admin?tab=llm&view=prompts`)에 **전체** 보기를 더해, 집필 AI 파이프라인 전체를 캔버스 그래프로 보이고
노드(Decision Guard·메인 에이전트·업무 Agent·도구)를 누르면 그 노드가 실제로 어떻게 판정·처리했는지 모든 기록을 보인다.
목적은 프롬프트 개선이다(Decision Guard는 OpenAI Decisions 판정 모델이라 프롬프트로 고친다). 평가 세트를 이 화면에서 만드는 일은 다음 단계다.

## 결정 (2026-11-20 사용자 결정)

- 화면: `프롬프트·모델` 쪽 위에 보기 전환 `전체 | 프롬프트 | 모델`(주소 `&sub=`, 없으면 전체). 전체 = 파이프라인 캔버스 + 노드 기록 패널.
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
- 키보드: 캔버스는 보조이고, 같은 노드 목록을 캔버스 아래 버튼 목록으로도 둔다(초점·Enter로 열림).

## ponytail 한계

- 노드 목록과 선(`next`)은 코드에 고정이다. 새 Agent를 추가하거나 실행 흐름·승인 반영이 바뀌면 운영 목록도 함께 고친다.
- 본문 8,000자 자르기 때문에 긴 원고는 끝이 보이지 않는다. 전문은 Langfuse에서 본다(개발자용).
- 노드 p95는 풀링 백분위가 아니라 노드 이름별 p95 중 가장 큰 값이다(노드마다 쿼리를 따로 보내지 않으려는 단순화). 건수·오류 수·프롬프트 이름은 Metrics API 집계라 정확하다.
- 이름으로만 가르므로 `retrieval`은 시뮬레이션이 불러도 작품 질문 노드에 센다. 목록에 없는 이름은 어느 노드에도 세지 않는다.
- `novelbrain.recall`은 지금 인물 시뮬레이션(인물 턴·나레이션)에서만 부른다. 다른 곳에서 부르게 되어도 `novelbrain` 노드에 센다(선은 인물 시뮬레이션에서만 이어진다).
