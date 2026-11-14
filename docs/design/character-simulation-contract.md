# 인물 시뮬레이션·NovelBrain 계약 (#58)

> 상태: 2026-11-14 사용자 결정, 구현 진행 중(스택 draft PR). [UC-09](../usecase-spec/UC-09.md) · [RAG·시뮬레이션 설계](../writing-ai-architecture/03-rag-simulation-design.md#3-character-simulation-subgraph) · [Retrieval 계약](../writing-ai-architecture/07-retrieval-contract-and-mocks.md)

## 결정

| 항목 | 결정 |
|---|---|
| 목표 | 세계관 정본에서 **인물이 기준 회차까지 아는 것만** 찾는 기억 추론(NovelBrain) 위에서, 인물별로 격리된 에이전트와 나레이터가 턴을 이어 가는 시뮬레이션을 집필실 무대에서 실시간으로 보여 주고, 결과를 웹소설 장면(나레이션 지문 + 독백 + `"대사"`)으로 이어 붙여 작가 승인 시 회차 원고에 저장한다. |
| 진입 | 집필실 [시뮬레이션] 버튼으로 시작한다(아래 '버튼 진입'). 채팅 자유 입력도 Intent Router의 `character_simulation`으로 같은 실행 단계에 들어온다. 화면은 집필실 중앙의 **무대 패널**이고 채팅에는 상태 한 줄만 남는다(아래 '무대'). Router는 이번 요청만으로 먼저 분류하고 되묻기일 때만 이전 요청을 붙인다(집필 요청이 섞이면 시뮬레이션 요청이 집필로 끌려갔다). |
| 모드 | **IF 모드**: 메인 에이전트와 정한 "만약 ~했다면?" 전제 하나만 강제, 인물은 자유. **흐름 모드**: 메인 에이전트와 정한 비트(장면·사건 순서)를 따른다. 흐름 모드는 메인 에이전트 단독 집필에서 생기는 오류를 인물 격리로 해결하는 장치다. |
| 인물 입력 | DEC-47 인물 문서. `IDENTITY.md`(카드 본문)·`SOUL.md`(말투·사고)·`MEMORY.md`·`memory/NN회차.md` 중 **기준 회차 이하**만. 다른 인물의 문서·비공개 생각은 넣지 않는다. |
| 모델 | 인물 행동·나레이션·독백·검사·요약은 OpenAI `gpt-6-luna`(DEC-28, 기존 `OPENAI_MODEL` 설정), 연출 결정은 OpenAI Decisions(`gpt-6-luna`)다. |
| 실행 틀 | 장면은 LangChain `create_agent` + 미들웨어·훅·콜백·이벤트 리스너로 쓴다(#362, 사용자 결정 2026-11-14). 시뮬레이션만 이 틀이고 Q&A·집필·고증은 기존 오케스트레이션 그래프다. |
| 연출·시점 | 인물이 말하기 전에 매 턴 연출 결정(나레이션·독백·인물 대사·마무리, 화자, 시점)을 거친다. 시점은 전지적·인물의 3인칭 제한·인물의 1인칭이며 비트마다 바뀔 수 있다. 독백은 나레이터가 시점 인물의 지식 범위로 쓴다. |
| 저장 | 시뮬레이션 기록은 대화 체크포인트에만 남는다. 장면이 끝나면 승인 질문(`waiting`, `awaitingApproval`)으로 작가 승인을 받고, 승인 시에만 Content MCP로 열린 회차 초안 끝에 나레이션·독백·대사를 순서대로 이어 붙인다(DEC-36, UC-09 최소 보장). 원고·설정 정본 자동 반영은 없다. |
| 새 의존성 | `langchain`(v1)·`langchain-typesafe==0.0.1a3`(사용자 승인 2026-11-14, `uv add`로 `pyproject.toml`·lockfile 갱신, 다른 패키지 버전은 바뀌지 않았다). `langchain-openai`는 쓰지 않는다(아래 '실행 틀'의 모델 슬롯). BM25·PPR·RRF는 표준 라이브러리로 계산한다. 평가 스크립트의 일회성 도구는 `uv run --with`로만 쓰고 `pyproject.toml`·lockfile을 바꾸지 않는다. |

## NovelBrain — 차례로 쌓는 4단계

| 단계 | 구성 | 앞 단계의 약점 | 출처 |
|---|---|---|---|
| 0 | **세계관 그래프 + PPR**: 질문에서 찾은 인물·장소 카드를 출발점으로 기준 회차 시점의 관계(DEC-51)를 따라 Personalized PageRank | 기준선(작가가 만든 정본) | HippoRAG, KAG |
| 1 | + 원고 벡터: 기존 Content 내부 검색(`POST /internal/v1/ai/qa/retrieval`) 발췌 | 그래프에 연결되지 않은 장면·대사·감정 | 기존 Elasticsearch kNN |
| 2 | + BM25(카드·인물 문서 본문) → 세 순위를 RRF(`k=60`)로 합산 | 벡터가 놓치는 고유명사·지명 | GBrain |
| 3 | + 시점·인물 필터: 그 인물의 기준 회차 이하 기억과, 그 인물이 끝점인 관계·공개 카드만 남김 | 미래 정보·다른 인물의 비밀 | KAG식 범위 강제, DEC-47 |

- 실행 순서와 평가 표가 같다. 단계별 누적 점수와 함께 방식별 단독 점수를 평가에 낸다.
- 위치: `backend/ai-service/app/novelbrain/`. 순수 함수(`ppr`·`bm25_rank`·`rrf`·`filter_for_character`)와 한 번의 조회 함수 `recall(...)`로 둔다. 평가 스크립트도 같은 순수 함수를 import한다.
- 데이터 출처(AI는 DB에 직접 접속하지 않는다): 카드·관계·인물 문서는 Content MCP `world_studio_read(id, episode)`(작가 토큰, 소유자만), 원고 발췌는 기존 Retrieval 도구(`scopeToken`). 세계관 ID는 Content MCP의 작품·회차 세계관 조회 도구로 찾는다. Content 서버 변경은 필요할 때만 하며, 하면 이 문서에 추가한다.

### `recall` 인터페이스

```python
def recall(world: WorldSnapshot, character_id: str | None, episode: int, query: str,
           stage: Literal[0, 1, 2, 3] = 3, manuscript: list[Excerpt] = (), k: int = 8) -> RecallResult
```

- `WorldSnapshot`: `world_studio_read` 응답에서 만든 카드(id·cardType·title·text·`characterDocs`·`revealFromEpisode`)와 그 회차의 관계 목록.
- `RecallResult.items[]`: `{ref, source: graph|manuscript|bm25, text, rank, score}`, `RecallResult.gaps[]`: 확인할 수 없어 제외한 항목.
- 필터 단계에서 지식 출처·시점을 확인할 수 없는 항목은 결과에서 빼고 `gaps`에 남긴다. 사실로 채우지 않는다(설계 §3).
- 구현 규칙(2026-11-14 확정): ref는 `card:<id>`·`card:<id>#identity|soul|memory|ep<NN>`·`relation:<id>`·`manuscript:<발췌id>`다. 0단계는 PPR 점수, 1단계부터 RRF 합산이다.
  인물 필터는 다른 인물의 SOUL·MEMORY·회차 기억, 자기 기준 회차 뒤 기억, `revealFromEpisode`가 기준 회차 뒤인 카드를 조용히 뺀다.
  확인할 수 없는 것은 `gaps`로 남긴다: 관계로 연결되지 않은 인물·사건·물건 카드, 그 인물이 끝점이 아닌 관계, 상대 카드가 미공개이거나 스냅샷에 없는 관계,
  인물 이름이 나오지 않는 원고 발췌, Retrieval의 원고 아닌 발췌(`relationship_current_not_episode`·`setting_via_retrieval`), 형식을 알 수 없는 ref.
  부정(`polarity=denied`) 관계는 '연결'로 치지 않고 PPR 간선에서도 빼며, 관계 항목에는 `카엘 ↛ 리라 (아님): 스승`처럼 부정임을 드러낸다.
  `revealFromEpisode`가 없는 카드는 허용한다(독자 노출 기준이지 인물 지식 기준이 아니며, 막으면 대부분의 세계 설정이 빠진다).
  `world.episode`가 기준 회차보다 늦으면 ValueError다. `MEMORY.md`는 회차 표시가 없어 항상 허용한다.

## 시뮬레이션 실행

```text
메인 에이전트: 모드 판정 → IF 전제 또는 비트 목록 + 참여 인물 확정 (정하지 못하면 `clarify` 한 문장으로 되묻고 작가가 다음 메시지로 답한다. 비트가 없으면 계획 호출이 제안한 비트로 진행. 버튼 진입은 양식 값을 그대로 쓴다)
 → 장면 에이전트(create_agent)가 턴마다:
     연출 결정(Decisions: 이번 턴·화자·시점) → 도구 하나 실행
        narrate    나레이션: 전지적이면 기준 회차까지의 세계관(NovelBrain 2단계, 인물 필터 없음), 인물 시점이면 그 인물의 지식 범위(3단계 필터)
        monologue  시점 인물의 속마음을 나레이터가 그 인물의 지식·말투로(대사와 따로 쓰는 턴)
        speak      그 인물만 아는 것으로 대사와 짧은 행동(인물마다 격리된 호출)
        end_scene  마무리 나레이션
     → 검사(아래 오류 1~3, IF 전제/비트 진행. 나레이션은 미래 누설) → 위반이면 그 턴만 재생성(최대 2회) → 그래도 위반이면 멈춘다(부분 결과 + `stopReason`)
     → 통과하면 턴을 장면에 붙이고 턴 이벤트(SSE step)를 내보낸 뒤 interrupt(awaitingScene)로 작가의 조작을 기다린다
 → 종료(흐름: 마지막 비트 완료, IF: 장면 완결 → 마무리 나레이션 / 작가의 stop) → 승인 대기(awaitingApproval) → 승인 시 회차 초안 반영
```

- 위치: `backend/ai-service/app/simulation/`(장면 에이전트·도구·연출·검사·프롬프트)와 `app/orchestration/`의 `character_simulation` 노드 연결. 실행 틀·연출·무대는 아래 절을 본다.
- 인물 호출마다 그 인물의 입력만 새로 조립한다. 이전 인물의 입력·모델 대화 상태를 넘기지 않는다. 다른 인물에게는 인물이 겉으로 드러낸 행동(`observed`)과 나레이션이 모두에게 알린 것만 장면 상태로 보이고 속마음·독백은 가지 않는다.
- 인물 대사 한도 12턴(나레이션·독백은 세지 않고 전체 40턴이 안전 한도), 재생성 2회. 위반 반복·비트 거부·한도는 부분 결과(`status: stopped|failed`, `stopReason`)를 남기고 승인 대상이 아니다(UC-09 E2). 대화 안에서는 멈춘 장면을 작가가 이어 가거나 끝낼 수 있다(아래 '실패·중단').
- 인물 대사는 `"대사"`와 짧은 행동만 쓴다. 배경·장소·분위기 묘사는 나레이터 몫이다(인물 지침에서 금지).
- 인물이 자기 성격대로 비트를 거부하면 오류가 아니라 **기획 쪽 문제**로 보고 `stopReason: beat_rejected`로 멈춘다. 작가는 줄을 고치거나 흐름을 바꿔 다시 요청한다.
- 작가가 중간에 넣는 한마디는 끼어들기 메모로 다음 턴에 반영한다(아래 '장면 조작').

### 흐름 모드가 해결하는 오류

| 오류 | 막는 방법 | 지표 | 이번 범위 |
|---|---|---|---|
| 1. 알면 안 되는 것(미래 정보·다른 인물의 비밀) | NovelBrain 3단계 필터 + 검사 | 지식 누설률 | ✅ |
| 2. 말투 섞임 | 인물마다 자기 `SOUL.md`만 넣고 따로 호출 + 검사 | 말투 일관성(1~7), 대사만 보고 화자 맞히기 정확도 | ✅ |
| 3. 호칭·관계 오류 | 회차별 관계를 인물 입력에 넣음 + 검사 | 관계 일치율 | ✅ |
| 4. 설정 위반 / 5. 시간·장소 불일치 / 6. 성격 붕괴 | 목록만 | — | 후속 |

### SSE·응답

- 기존 이벤트(`plan`·`started`·`step`·`waiting`·`done`·`error`)를 그대로 쓴다. 새 이벤트 종류는 없다. 턴이 끝날 때마다의 `step`은 그때까지의 **누적** 결과를 담으며 화면은 같은 단계 항목을 교체한다.
- `character_simulation` 단계 결과(`StepResult.result`)와 턴마다의 `step` 이벤트는 다음 모양을 쓴다.

```json
{
  "mode": "if" | "flow",
  "premise": "IF 전제(흐름 모드는 null)",
  "beats": [{"index": 0, "text": "성문 대면", "status": "done" | "pending" | "rejected"}],
  "turns": [{
    "index": 0, "kind": "narration" | "monologue" | "character",
    "characterId": "card-id(나레이션은 null, 독백은 시점 인물)", "characterName": "카엘(나레이션은 '나레이션')",
    "prose": "나레이션은 지문, 독백은 속마음, 인물 턴은 \"대사\"와 짧은 행동",
    "checks": [{"kind": "knowledge_leak" | "voice_mix" | "relation" | "premise" | "beat", "passed": true, "detail": "..."}],
    "regenerated": 0,
    "evidence": [{"ref": "...", "source": "graph" | "manuscript" | "bm25"}],
    "pov": "omniscient" | "limited:<인물 id>" | "first:<인물 id>",
    "editedByAuthor": false
  }],
  "notes": [{"afterTurn": 1, "text": "작가의 끼어들기 기록"}],
  "status": "running" | "paused" | "completed" | "stopped" | "failed",
  "stopReason": null
}
```

- `running`은 첫 턴 전, `paused`는 턴 사이 대기, `completed`는 장면 끝, `stopped`·`failed`는 멈춘 부분 결과(`stopReason`: `check_failed`·`beat_rejected`·`turn_limit`, 호출 실패는 null)다. 나레이션·독백은 검사 결과(`checks`)를 내보이지 않는다.
- 화면은 `turns[].prose`를 종류별로 그리고(나레이션 지문 블록·독백 줄·인물 말풍선) `checks`·`evidence`는 접어서 보인다.
- 승인 시 반영 본문은 `turns[].prose`(나레이션·독백 포함)를 순서대로 빈 줄로 이은 텍스트이며, 기존 `content_mcp.apply_writing`의 Text 경로(초안 뒤에 잇기)를 쓴다.

## 실행 틀: LangChain `create_agent` + 미들웨어 (#362, 사용자 결정 2026-11-14)

| 개념 | 구현(`app/simulation/`) | 하는 일 |
|---|---|---|
| Middleware | `StageMiddleware`(`scene_agent.py`) | 턴 사이 사람 개입(HITL에 준하는 `interrupt`): next·edit·redo·stop·반려를 받는다 |
| | `DirectorMiddleware` | 연출 결정을 거쳐 도구 호출을 만든다 |
| | `SceneCheckMiddleware` | 검사·최대 2회 재실행·통과한 턴을 장면에 붙임 |
| | `ModelCallLimit`·`ToolCallLimit`(라이브러리) | 호출 한도 안전망(`LOOP_LIMIT`=80). 넘으면 장면을 끊고 단계 `failed` |
| Hook | `before_agent` | 승인 대기에서 돌아온 작가의 조작을 새 실행의 시작에서 장면에 반영 |
| | `before_model` | Stage: 턴 사이 대기 / Director: 연출 결정 |
| | `wrap_model_call` | Director: 결정대로 도구 호출을 만든다(모델을 부르지 않는다) |
| | `wrap_tool_call` | SceneCheck: 검사·재실행·장면 갱신·턴 이벤트 |
| | `after_agent` | 턴 사이 표시 정리 |
| Callback | `UsageCallback`(`callbacks.py`) | 모델 호출마다 토큰·지연·실패(`agent.py`가 `simulation.model` 이벤트로 알림)와 도구 실패를 모아 턴이 끝날 때 추적 span `simulation.turn`으로 남긴다. 본문·키는 없다 |
| Event Listener | `SceneEvents` | 턴이 끝날 때 `adispatch_custom_event('scene', 단계 항목)`으로 낸 이벤트를 받아 LangGraph custom stream으로 중계 → SSE `step`(누적 결과) |

- 도구(`tools.py`)는 `narrate`·`monologue`·`speak`·`end_scene`이며 기존 입력 조립(NovelBrain recall·인물 격리)·`act`·`check`·검증을 그대로 쓴다. 같은 턴을 재생성할 때는 조회한 입력을 다시 만들지 않는다.
- **모델 슬롯**: 어느 도구를 쓸지는 연출 결정(Decisions)이 정하므로 `create_agent`의 모델은 호출되지 않는 자리 표시(`DirectorModel`)다. 그래서 `langchain-openai`가 필요 없고 장면에는 모델 노드의 호출 비용이 없다.
- **오케스트레이션 연결**: 바깥 그래프의 `character_simulation` 노드가 에이전트를 실행한다. 에이전트 상태(장면 `Scene` JSON 포함)는 바깥 그래프의 체크포인터(PostgreSQL)에 저장되고, 에이전트의 `interrupt`는 바깥 그래프로 전달돼 `waiting`이 된다. 같은 대화의 `resume`이 노드를 다시 실행하면 에이전트는 멈춘 자리에서 이어 간다. 노드는 요청마다 새로 만든 값(`SceneContext`: 계획·대상·요청·조회 토큰)만 넘기고 세계관·원고 발췌는 한 요청에 한 번 읽는다.
- 대화가 없으면(체크포인트 없음) 턴 사이에서 멈출 수 없어 `StageMiddleware` 없이 장면이 끝날 때까지 한 번에 돈다.

## 연출 결정 (인물이 말하기 전에 매 턴)

- 모델: `langchain_typesafe.TypeSafeClassifier`를 OpenAI Decisions(`POST https://api.openai.com/v1/decisions`, `gpt-6-luna`, 키 `OPENAI_API_KEY`)에 연결한 최소 서브클래스 `OpenAIDecisionClassifier`(`director.py`)다. 패키지 기본 경로(`/v1/systemone`)는 OpenAI에서 404이고 경로만 바꾸면 요청 형식이 달라 400이라 경로·요청 변환·응답 변환만 덮어쓴다. 형식의 정본은 `app/intent/agent.py`다. Decisions는 확률을 주지 않아 고른 값만 1.0으로 채우며, 거부·선택지 밖·질문과 다른 답은 실패다.
- 질문(모두 선택지): `turn`(나레이션·독백·대사·마무리 중 규칙이 허용한 것), `speaker`(대사를 할 인물), `pov`(전지적·인물의 3인칭 제한·인물의 1인칭). 입력은 장면 요약(비트·최근 8줄·끼어들기 기록·규칙이 정한 이유)이며 인물은 별칭 `c1…`으로만 주고받는다(id·설정 문서·독백 내용은 보내지 않는다).
- 규칙(`service.rules`): 장면 시작·작가의 끼어들기 메모·흐름 모드의 비트 전환은 나레이션이 먼저, 이야기가 끝났으면(IF는 장면 완결 판정, 흐름은 모든 비트 완료) 마무리(`end`), 나레이션·독백이 두 번 이어지면 이번엔 대사, 인물 대사 12턴(또는 전체 40턴)이면 한도로 멈춘다. 규칙이 턴을 하나로 정하면 묻지 않고 알려 주고 화자·시점만 묻는다.
- 검증: 독백은 시점 인물이 있어야 하고(전지적이면 실패), 도구가 받은 인물은 이 장면의 참여 인물이어야 한다. 어긋난 결정은 고치지 않고 실패(502), 호출 실패는 503이다. 둘 다 장면을 멈춘 채 두고 작가가 이어 간다(첫 턴이면 단계 `failed`).
- 결정은 턴에 기록된다: `kind`·`characterId`·`pov`(내부 기록에는 화자와 마무리 여부까지). 재생성(검사 위반)은 연출을 다시 정하지 않고, 다시 말하기(`redo`)는 그 턴에 기록된 결정을 그대로 쓴다.

## 시점과 독백

| 시점(`pov`) | 나레이터가 아는 것 | 서술 | 검사 |
|---|---|---|---|
| `omniscient` | 기준 회차 N까지 공개된 세계관(2단계 조회, 인물 시점 필터 없음, 미공개 카드·N화 뒤 기억·N화 뒤 원고 제외) | 전지적 3인칭 | 미래 정보 누설 |
| `limited:<인물>` | 그 인물이 N화까지 아는 것(3단계 필터, 인물 입력과 같다) | 그 인물의 3인칭 제한 | 지식 누설 |
| `first:<인물>` | 같다 | 그 인물의 1인칭, 그 인물 말투(SOUL) | 지식 누설 + 말투 |
| 독백(`monologue`) | 시점 인물(`limited`·`first`) | 그 인물의 속마음. 다른 인물에게 보이지 않는다 | 지식 누설 + 말투 |

- 나레이션은 어느 시점이든 `characterId`가 없고 이름이 '나레이션'이다. 독백 턴만 시점 인물의 id·이름을 가진다.
- 나레이션 문체는 설정집의 `나레이터…` 카드(제목이 `나레이터`로 시작, 유형 무관, 인물 카드면 IDENTITY+SOUL)가 정한다. 없으면 기본 지침이다. 이 카드는 문체 지침이라 인물로 고를 수 없고 인물의 입력에도 들어가지 않는다.
- 나레이션 `observed`(모두에게 알린 사실)만 인물의 장면 상태로 간다. 나레이션 본문과 독백은 인물에게 가지 않는다.

## 무대(Stage): 턴마다 멈추는 실행 (2026-11-14 사용자 결정)

- 화면: 집필실 중앙의 무대 패널(모달 아님)이 장면을 실시간으로 보여 준다. 나레이션은 지문 블록, 독백은 시점 인물의 속마음 줄, 대사는 인물 말풍선이다. 채팅에는 "시뮬레이션 진행 중 · N턴" 한 줄과 무대 열기 링크만 남는다. 서버→화면은 기존 SSE, 화면→서버는 기존 resume 요청이다(새 WebSocket 없음).
- 턴마다 멈춤: 에이전트가 한 턴을 쓰면 `interrupt({steps, awaitingScene: 'character_simulation'})`로 멈추고 장면은 에이전트 상태에 남는다. 화면은 자동 재생 중이면 `waiting`(awaitingScene)을 받자마자 `resume.scene={action:'next'}`를 보내고 일시정지면 보내지 않는다. 매 턴이 별도 HTTP 요청이고 각 요청의 SSE가 그 턴의 `step`(누적 결과)을 흘린다.

### 장면 조작 `resume.scene`

| action | 필드 | 동작 | 모델 호출 |
|---|---|---|---|
| `next` | `note?`(≤300자) | 다음 턴 하나를 쓴다. note는 끼어들기 메모로 남아 다음 턴(나레이션)이 장면 안 사실로 옮기고 이후 나레이터의 연출 지시가 된다. 인물에게는 메모 글이 가지 않는다 | 연출 결정 + 도구 1턴(+검사) |
| `edit` | `turn`, `text`(≤2000자) | 그 턴의 글을 작가 글로 바꾼다(`editedByAuthor`, 검사 결과 삭제). 다음 인물이 보는 장면 상태도 이 글이 된다(독백은 계속 숨김) | 없음 |
| `redo` | `turn`, `note?` | 그 턴부터 뒤를 지우고 기록된 연출 결정(같은 인물·시점)으로 그 턴만 다시 쓴다. note는 다시 쓰는 줄에 주는 작가의 지시다. 메모 때문에 쓰인 나레이션을 다시 쓰면 그 메모가 되살아난다 | 도구 1턴(+검사) |
| `stop` | — | 지금까지로 장면을 끝낸다(`completed`, 마무리 나레이션 없음). 이어서 승인 질문이다 | 없음 |

- `approved`: 화면은 장면 조작에 `approved:true`를 함께 보낸다. scene이 있으면 `approved`는 적용하지 않고 조작을 처리한 뒤 다시 멈춘다. 승인·거절은 scene 없는 resume으로만 한다. 장면이 끝나기 전의 승인(scene 없는 `approved:true`)은 422이고, 장면 중의 거절(`approved:false`)은 반영 없이 `cancelled`로 끝낸다.
- 받을 수 없는 조작(장면·승인 대기가 아닐 때의 scene, 없는 `turn`, 장면 전의 승인)은 그래프를 실행하기 전에 422(SSE는 `error` 이벤트)로 막아 상태가 바뀌지 않는다.
- 승인 질문(`awaitingApproval`)에서도 edit·redo·next(끼어들기 포함)는 가능하다. 단계를 다시 진행 중으로 돌려 장면으로 되돌아가며(끝난 장면은 마무리 나레이션을 걷어 내고 마지막 비트를 다시 연다), 다시 끝나면 승인 질문이 이어진다.

### 실패·중단

- 검사 반복 위반(`check_failed`)·비트 거부(`beat_rejected`)·한도(`turn_limit`)는 그 턴을 붙이지 않고 쌓은 턴과 메모를 지킨 채 `status: stopped`(호출 실패는 `failed`)와 이유를 남긴다. 턴이 하나 이상 있으면 `waiting`(awaitingScene)으로 계속 멈춰 있고(단계는 `failed`로 이유를 보인다) 작가가 줄을 고치거나 다시 말하게 하거나 `next`로 다시 시도하거나 `stop`으로 지금까지를 끝낼 수 있다. 화면은 이때 자동 재생을 멈춘다.
- 첫 턴이 실패해 쌓은 턴이 없으면 이어 갈 장면이 없어 단계를 `failed`(부분 결과 `stopped|failed`, 승인 없음)로 끝낸다.
- 작가가 `stop`한 장면은 `completed`라서 승인 질문이 이어진다. 승인 없이 끝나는 것은 `failed`뿐이다.

### 응답·SSE

- `waiting`: `{steps, awaitingScene: 'character_simulation'}`(승인 대기는 `awaitingApproval`). 최종 응답과 대화 이력 조회(`GET conversations/{threadId}`)의 `reply`에도 `awaitingScene`이 있어 새로고침 뒤 무대를 복원한다. 이때 `steps`는 멈춘 payload의 단계(현재 장면)다.
- 턴이 끝날 때마다 `step`(그때까지의 누적 결과, 단계 `status`는 아직 `not_started`)을 흘린다. 모델을 부르지 않은 조작(edit)은 멈춘 payload의 장면을 `step`으로 알린 뒤 `waiting`을 보낸다. 장면이 끝나면 마무리 턴의 `step`, 노드가 끝난 단계의 `step`, 승인 `waiting`, `done` 순이다.

## 버튼 진입 (2026-11-14 사용자 결정)

시연 진입은 집필실의 **[시뮬레이션] 버튼**이다. 채팅 자유 입력의 Router 분류는 건드리지 않는다. 버튼은 Router의 모델 분류를 거치지 않고 `operation`으로 기능을 직접 지정해, 모호한 문장이 되묻기로 끝나 시연이 끊기는 일을 피한다(가드레일은 기존 operation 경로대로 거친다).

- 시작 양식(무대 패널): **IF**는 전제 한 줄("만약 ~했다면")과 참여 인물(연결 세계관의 인물 카드, 1~6명)이다. **흐름**은 이 작품의 장면 계획(`story_plan`, `kind=scene`) 중 열린 회차(`episode_number`)가 같은 것들을 순서대로 비트로 쓰고(`제목: 내용`을 200자로 자름, 최대 8개), 참여 인물은 그 계획들의 `characters` 합집합이다(양식에서 고칠 수 있다). 그 회차의 장면 계획이 없으면 안내하고 비트를 직접 입력하게 한다.
- 시작은 채팅 메시지다: `operation: 'character_simulation'`, `request`(요약 문장, 예 "흐름 모드 시뮬레이션: 장면 계획 3개"), `simulation: {mode: 'if'|'flow', premise?: ≤500자, beats?: ≤8개 × ≤200자, characterIds: 1~6개 × ≤100자}`.
- Content `WritingAiRequest.simulation`: `mode`·길이·개수를 검증하고 `operation`이 `character_simulation`인 새 요청에서만 받는다(아니면 422, 권한 확인 전에 거절). 값은 그대로 AI에 넘긴다.
- AI `OrchestrationRequest.simulation`: `SimulationPlan`과 같은 한도(전제 500자, 비트 8개×200자, 인물 6명×100자, 모르는 필드 거절)로 검증하고 `operation`이 `character_simulation`인 새 요청에서만 받는다(아니면 422).
  있으면 `simulation_plan`이 계획 모델을 부르지 않고 이 값을 계획으로 쓰되, 인물 id가 연결 세계관의 활성 인물 카드인지와 모드별 필수값(IF 전제, 흐름 비트 1개 이상)을 확인한다. 어긋나면 되묻지 않고 단계 `failed`와 이유로 끝낸다.

## 평가

| 축 | 데이터셋 | 숫자 |
|---|---|---|
| 0→1 | NarrativeQA 일부(영어, Apache 2.0, 저작권 만료작) | 근거 Recall@5·P@5 |
| 1→2 | MuSiQue 일부(영어, 다단계) | 정확도, HippoRAG 공개 수치와 비교 |
| 2→3 | TimeChara 검증 600건(영어, 데이터 CC BY-NC 4.0·코드 MIT, 비상업 연구 한정, HF 약관 동의 필요) | 누설률·시공간 일관성(0/1)·성격 일관성(1~7), 리더보드·`rag-cutoff`와 비교 |
| 한국어 적용성 | 저장소 샘플 작품 자체 세트 50~100건 | 같은 지표의 단계별 추세 |
| 흐름 모드 A/B | 같은 비트를 A 메인 단독 / B 흐름 모드로 작성 | 오류 1~3 건수 |

- 위치: `backend/ai-service/eval/novelbrain/`(스크립트·지표). 결과 수치·그래프 설명은 `docs/evaluation/novelbrain.md`.
- 알고리즘(PPR·RRF·필터)은 언어와 무관해 본평가는 영어 원본으로 하고, 언어를 타는 BM25 토큰화·임베딩만 한국어 세트로 확인한다.
- 원문·번역·색인·모델 응답 원본은 저장소에 커밋하지 않는다(`eval/novelbrain/.data/`, git 무시). 저장소에는 스크립트와 집계 수치만 둔다. 실모델 호출 규모는 데이터셋마다 100~200건이다.
- 그래프가 없는 영어 데이터셋은 원문에서 모델로 인물·관계를 뽑아 평가용 그래프를 만든다(HippoRAG 방식).

## PR 스택 (draft)

| 순서 | 브랜치 | base | 내용 |
|---|---|---|---|
| 1 | `docs/58-character-simulation-contract` | `develop` | 이 계약 |
| 2 | `feat/58-novelbrain` | 1 | `app/novelbrain/` |
| 3 | `feat/58-character-simulation` | 2 | `app/simulation/` + 오케스트레이션 연결 |
| 4 | `feat/58-simulation-chat-ui` | 3 | 집필실 시뮬레이션 무대(Stage)·승인 저장 |
| 5 | `feat/58-novelbrain-evaluation` | 2 | 평가 스크립트·결과 문서 |

## ponytail 한계

- BM25는 카드·인물 문서만 메모리에서 계산한다(카드 최대 1,000개). 원고 BM25는 Elasticsearch 질의 추가가 필요해 후속이다.
- PPR은 한 세계관의 관계만으로 계산한다(작품 사이 연결 없음).
- 오류 4~6, 대안 후보 비교, 독자 검증(F-SIM-11), 크레딧·비용 동의, 인물 상태 정본 채택(UC-06)은 범위 밖이다.
- 비트는 Story Development 에이전트 없이 메인 에이전트가 채팅에서 최소 형태로 만든다(버튼 진입은 장면 계획 또는 작가가 적은 값을 쓴다).
- 연출 결정은 Decisions가 확률을 주지 않아 선택값만 쓴다(신뢰도 기준 없음). 장면은 에이전트 상태(대화 체크포인트)에만 있어 보관 기간 정리가 없다.
- 원고 발췌 검색은 요청(턴)마다 같은 검색어로 한 번씩 한다. 인물 시점 나레이션·독백의 조회는 그 인물의 대사 입력과 같은 규칙이다.
