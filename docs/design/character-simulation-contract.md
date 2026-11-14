# 인물 시뮬레이션·NovelBrain 계약 (#58)

> 상태: 2026-11-14 사용자 결정, 구현 진행 중(스택 draft PR). [UC-09](../usecase-spec/UC-09.md) · [RAG·시뮬레이션 설계](../writing-ai-architecture/03-rag-simulation-design.md#3-character-simulation-subgraph) · [Retrieval 계약](../writing-ai-architecture/07-retrieval-contract-and-mocks.md)

## 결정

| 항목 | 결정 |
|---|---|
| 목표 | 세계관 정본에서 **인물이 기준 회차까지 아는 것만** 찾는 기억 추론(NovelBrain) 위에서, 인물별로 격리된 에이전트가 턴을 이어 가는 시뮬레이션을 집필실 채팅에서 실행하고, 결과를 웹소설 장면(지문 + `"대사"`)으로 흘린 뒤 작가 승인 시 회차 원고에 저장한다. |
| 진입 | 집필실 AI 채팅(기존 오케스트레이션·SSE). Intent Router의 `character_simulation`을 실행 단계로 연결한다. 별도 시뮬레이션 화면은 만들지 않는다. Router는 이번 요청만으로 먼저 분류하고 되묻기일 때만 이전 요청을 붙인다(집필 요청이 섞이면 시뮬레이션 요청이 집필로 끌려갔다). |
| 모드 | **IF 모드**: 메인 에이전트와 정한 "만약 ~했다면?" 전제 하나만 강제, 인물은 자유. **흐름 모드**: 메인 에이전트와 정한 비트(장면·사건 순서)를 따른다. 흐름 모드는 메인 에이전트 단독 집필에서 생기는 오류를 인물 격리로 해결하는 장치다. |
| 인물 입력 | DEC-47 인물 문서. `IDENTITY.md`(카드 본문)·`SOUL.md`(말투·사고)·`MEMORY.md`·`memory/NN회차.md` 중 **기준 회차 이하**만. 다른 인물의 문서·비공개 생각은 넣지 않는다. |
| 모델 | 인물 행동·검사·요약 모두 OpenAI `gpt-6-luna`(DEC-28, 기존 `OPENAI_MODEL` 설정). |
| 저장 | 시뮬레이션 기록은 대화 체크포인트에만 남는다. 장면이 끝나면 기존 승인 카드(`waiting`)로 작가 승인을 받고, 승인 시에만 Content MCP로 대상 회차 초안에 반영한다(DEC-36, UC-09 최소 보장). 원고·설정 정본 자동 반영은 없다. |
| 새 의존성 | 없음. BM25·PPR·RRF는 표준 라이브러리로 계산한다. 평가 스크립트의 일회성 도구는 `uv run --with`로만 쓰고 `pyproject.toml`·lockfile을 바꾸지 않는다. |

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
메인 에이전트: 모드 판정 → IF 전제 또는 비트 목록 + 참여 인물 확정 (정하지 못하면 `clarify` 한 문장으로 되묻고 작가가 다음 메시지로 답한다. 비트가 없으면 계획 호출이 제안한 비트로 진행)
 → 턴: 다음 인물 선택 → recall(그 인물, 기준 회차) → 그 인물에게 보이는 장면 상태만 투영
       → 행동·대사 생성 → 검사(아래 오류 1~3, IF 위반/비트 진행)
       → 위반이면 그 턴만 재생성(최대 2회) → 그래도 위반이면 멈춘다(부분 결과 + `stopReason`)
       → 통과하면 지문 + "대사" 문단을 SSE step으로 내보내고 장면 상태 갱신
 → 종료(비트 완료·IF 장면 완결·턴 한도) → 승인 대기(waiting) → 승인 시 회차 초안 반영
```

- 위치: `backend/ai-service/app/simulation/`(턴 루프·프롬프트·검사)과 `app/orchestration/`의 `character_simulation` 단계 연결. LangGraph 단일 그래프에 노드로 둔다(기존 `StateGraph`·체크포인터 재사용).
- 인물 호출마다 그 인물의 입력만 새로 조립한다. 이전 인물의 입력·모델 대화 상태를 넘기지 않는다.
- 턴 한도 기본 12, 재생성 2회. 위반 반복·비트 거부·턴 한도는 그 단계를 `failed`로 두고 부분 결과(`status: stopped|failed`, `stopReason`)를 함께 돌려준다. 부분 장면을 완료로 꾸미지 않고 승인(저장)도 묻지 않는다(UC-09 E2).
- 인물이 자기 성격대로 비트를 거부하면 오류가 아니라 **기획 쪽 문제**로 보고 `stopReason: beat_rejected`로 멈춘다. 작가는 채팅으로 흐름을 고쳐 다시 요청한다("이대로 진행"은 후속).
- 작가가 중간에 보낸 메시지는 다음 턴의 장면 상태에 반영한다.

### 흐름 모드가 해결하는 오류

| 오류 | 막는 방법 | 지표 | 이번 범위 |
|---|---|---|---|
| 1. 알면 안 되는 것(미래 정보·다른 인물의 비밀) | NovelBrain 3단계 필터 + 검사 | 지식 누설률 | ✅ |
| 2. 말투 섞임 | 인물마다 자기 `SOUL.md`만 넣고 따로 호출 + 검사 | 말투 일관성(1~7), 대사만 보고 화자 맞히기 정확도 | ✅ |
| 3. 호칭·관계 오류 | 회차별 관계를 인물 입력에 넣음 + 검사 | 관계 일치율 | ✅ |
| 4. 설정 위반 / 5. 시간·장소 불일치 / 6. 성격 붕괴 | 목록만 | — | 후속 |

### SSE·응답

- 기존 이벤트(`plan`·`started`·`step`·`waiting`·`done`·`error`)를 그대로 쓴다. 새 이벤트 종류는 없다. 턴마다의 `step`은 그때까지의 **누적** 결과를 담으며 화면은 같은 단계 항목을 교체한다.
- `character_simulation` 단계 결과(`StepResult.result`)와 턴마다의 `step` 이벤트는 다음 모양을 쓴다.

```json
{
  "mode": "if" | "flow",
  "premise": "IF 전제(흐름 모드는 null)",
  "beats": [{"index": 0, "text": "성문 대면", "status": "done" | "pending" | "rejected"}],
  "turns": [{
    "index": 0, "characterId": "card-id", "characterName": "카엘",
    "prose": "지문과 \"대사\"로 된 문단",
    "checks": [{"kind": "knowledge_leak" | "voice_mix" | "relation" | "premise" | "beat", "passed": true, "detail": "..."}],
    "regenerated": 0,
    "evidence": [{"ref": "...", "source": "graph" | "manuscript" | "bm25"}]
  }],
  "status": "running" | "completed" | "stopped" | "failed",
  "stopReason": null
}
```

- 화면은 `turns[].prose`를 소설 문단으로 잇고 `checks`·`evidence`는 접어서 보인다. 끝나면 기존 승인 카드에 `초안에 반영`(=회차로 저장)을 보인다.
- 승인 시 반영 본문은 `turns[].prose`를 빈 줄로 이은 텍스트이며, 기존 `content_mcp.apply_writing`의 Text 경로(초안 뒤에 잇기)를 쓴다.

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
| 4 | `feat/58-simulation-chat-ui` | 3 | 집필실 채팅 장면 카드·승인 저장 |
| 5 | `feat/58-novelbrain-evaluation` | 2 | 평가 스크립트·결과 문서 |

## ponytail 한계

- BM25는 카드·인물 문서만 메모리에서 계산한다(카드 최대 1,000개). 원고 BM25는 Elasticsearch 질의 추가가 필요해 후속이다.
- PPR은 한 세계관의 관계만으로 계산한다(작품 사이 연결 없음).
- 오류 4~6, 대안 후보 비교, 독자 검증(F-SIM-11), 크레딧·비용 동의, 인물 상태 정본 채택(UC-06)은 범위 밖이다.
- 비트는 Story Development 에이전트 없이 메인 에이전트가 채팅에서 최소 형태로 만든다.
