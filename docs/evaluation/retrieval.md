# 검색 품질 평가 (#825)

> 상태: **구현·측정 완료**(2026-11-24). 고정 원문·고정 스냅샷으로 **검색만** 평가한다. 화면(LLMOps)에서 실행하지 않고(버튼 없음) pytest·CLI와 이 문서의 표로 두며, 화면의 '에이전트별 평가' 표(#837)에는 'CI에서 확인'으로 표시한다(사용자 결정 2026-11-24).
> 생성 품질(프롬프트 버전 평가)은 [운영 LLMOps 계약](../design/operations-llmops-contract.md)의 회귀 평가가 맡고, §1은 그 둘을 에이전트별로 한곳에 모은 평가 목록이다(§1.1 표는 LLMOps 화면 표와 같다).

## 요약

- 검색 평가 대상은 AI 안의 순위 검색 둘이다: 시뮬레이션 기억 `recall`([NovelBrain](novelbrain-overview.md))과 Q&A 설정 발췌(`story_qa.service.world_excerpts`). 새 세트는 만들지 않고 기존 한국어 62문항에 **MRR@5**를 더했다. 웹 검색은 제외, Content 벡터 검색은 후속이다.
- NovelBrain 전체(0+1+2+3)는 known(원고 문단) Recall@5 0.96·MRR@5 0.51, setting(설정 카드) 0.86·0.65, 미래 누설 0.08, 비목격 누설 0.00이다. **MRR이 Recall@5로는 안 보이던 것을 보인다**: 정답 문단은 상위 5에 들지만 24문항 중 19문항에서 2위다(1위는 인물 자신의 카드). 벡터만 쓰면 21문항에서 1위(MRR 0.92)다.
- Q&A 설정 발췌는 설정 질문 14문항 모두에서 정답 카드를 8건 안에 넣었고(Recall@8 1.00, MRR@8 0.92) 62문항 모두 기준 회차 뒤에 공개되는 설정이 새지 않았다.
- CI(AI 단위 레인)는 `tests/retrieval_eval`(14건, 모델·네트워크 없음, 약 2초)로 이 값이 임계값 아래로 내려가지 않게 지킨다(§6).

## 1. 평가 목록: 에이전트 × 모드 × 지표 × 세트

**모드**는 무엇을 채점하느냐다.

- **새 답변 생성**(고정 근거로 새 답변 생성): 항목의 고정 근거로 프롬프트 버전·모델이 새 답변을 만들게 해 채점한다. 프롬프트·모델을 바꿨을 때 나빠지지 않았는지 보는 LLMOps 회귀 평가이고 화면에서 실행한다.
- **원문 검색**(고정 원문 검색): 모델 없이 고정 원문·고정 스냅샷에서 검색 결과의 순위만 채점한다. 프롬프트·모델과 무관한 결정적 코드라 같은 입력이면 배포 전까지 값이 같으므로 화면에 실행 버튼을 두지 않고 pytest·CLI로 두며 CI에서 확인한다.
- 저장한 답변을 다시 채점하는 모드는 만들지 않는다(사용자 결정 2026-11-24). 평가는 항상 프롬프트 버전으로 새로 생성한다.

### 1.1 LLMOps 화면의 에이전트별 평가 표

LLMOps 화면 '평가·누설 검사'의 맨 위 '에이전트별 평가' 표와 같은 목록이다(프런트 `frontend/src/domain/entities/llmOpsEvalTable.ts`. 이 표를 고치면 그 상수도 고치고, 둘이 같은지 `llmOpsEvalTable.test.ts`가 본다).
에이전트마다 쓰는 평가 세트·지표가 다르다. 세트가 없는 에이전트도 숨기지 않고 '평가 세트 없음(후속)'으로 보인다. '최근 Run'은 화면이 평가 목록(최근 50건)에서 그 세트의 가장 최근 Run을 찾아 통과·미통과와 Run 상세로 보이는 칸이다.

| 에이전트 · 기능 | 모드 | 평가 세트(항목 수) | 지표 | 최근 결과 |
|---|---|---|---|---|
| 메인 에이전트 · `orchestration.main` | — | 평가 세트 없음(후속) | — | — |
| Decision Guard · `decision_guard.judge` | — | 평가 세트 없음(후속) | — | — |
| Q&A · `story_context.answer` | 새 답변 생성 | `qa.grounding`(6) | `faithfulness`(근거 충실도) · `context_precision`(문맥 정밀도) | 최근 Run |
| Q&A · 비공개 설정 누설(Fork 응답) | 새 답변 생성 | `leak.spoiler`(5) | GEval 누설 점수 | 최근 Run |
| Q&A · 설정·관계 발췌(`world_excerpts`) | 원문 검색 | 한국어 62문항(설정 14·누설 62) | Recall@8 · MRR@8 · 비공개 설정 누설 | 버튼 없음 · CI에서 확인 — setting Recall@8 1.00 · MRR@8 0.92, 누설 0건 |
| Q&A · 원고 벡터 검색(Content) | 원문 검색 | 평가 세트 없음(후속) | — | — |
| Manuscript Review · `manuscript_review.*` | — | 평가 세트 없음(후속) | — | — |
| World · 설정 충돌 지적 | 새 답변 생성 | `world.conflict`(5) | GEval(항목별 기준문) | 최근 Run |
| Writing · 집필 교정 | 새 답변 생성 | `writing.fix`(5) | GEval(항목별 기준문) | 최근 Run |
| Research · `web_research.search` | — | 평가 세트 없음(후속) | — | — |
| Research · 웹 검색 결과 | 원문 검색 | 제외(결과가 시점마다 달라 재현 불가) | — | — |
| Rating · `rating.assess` | — | 평가 세트 없음(후속) | — | — |
| 인물 시뮬레이션 · `character_simulation.act` | 새 답변 생성 | `simulation.act`(24) | `voice`(말투) · `intent`(의도) · `pov_ok`(시점) | 최근 Run |
| 인물 시뮬레이션 · `character_simulation.narrate` | 새 답변 생성 | `simulation.narrate`(46) | `style`(문체) · `info`(정보) · `pov_ok`(시점) | 최근 Run |
| 인물 시뮬레이션 · 기억 회상(NovelBrain `recall`) | 원문 검색 | 한국어 62문항(고정 스냅샷) | Recall@5 · P@5 · MRR@5 · 미래·비목격 누설 | 버튼 없음 · CI에서 확인 — 3단계 known Recall@5 0.96 · MRR@5 0.51, setting 0.86 · 0.65, 미래 누설 0.08 |
| 전처리 설정 추출 · `manuscript_extraction.extract` | 새 답변 생성 | `extraction.extract`(30) | `recall`(재현율) · `quote_ok`(인용 통과율) | 최근 Run |

- 후보 등록 평가 게이트(#787)는 Q&A 답변(`qa.grounding`)·인물 대사(`simulation.act`)·나레이션(`simulation.narrate`)에만 있다. 나머지 세트(`leak.spoiler`·`world.conflict`·`writing.fix`)는 범용이라 게이트가 아니다. `leak.spoiler`는 운영 정기 작업 `leak_sample_check`가 실제 Fork 응답을 표본으로 판정하는 것과 같은 방식(DeepEval)이다. 방식은 [운영 LLMOps 계약](../design/operations-llmops-contract.md), 시뮬레이션 세트는 [원문 평가 §10](simulation-original.md#10-운영-llmops-등록-형식내보내기)에 있다.
- 세트가 생기면 '평가 세트 없음(후속)' 행을 그 세트·지표로 바꾼다. 전처리 설정 추출은 #824로 `extraction.extract`(30회차)로 바뀌었다: 채점 모델 없이 코드가 정답표와 대조하고 `recall`은 설정다운 정답만 센다([추출 평가 세트](extraction-set.md)).
- 웹 검색은 제외한다(결과가 시점마다 달라 고정 입력이 성립하지 않는다, 재현 불가). Content 원고 벡터 검색(`app/retrieval`)은 후속이다: 색인·검색 범위는 Content가 소유하고 호출에 Content 내부 API와 Content가 서명한 토큰이 필요하다. NovelBrain 평가의 '벡터'는 운영과 같은 고정 리비전의 E5-small로 AI가 문단을 직접 임베딩해 코사인 kNN으로 찾는 근사다.

### 1.2 화면 표에 없는 평가(로컬 CLI)

LLMOps 화면에 Run이 남지 않고 로컬 CLI로 돌리는 평가다.

| 평가 | 모드 | 실행 | 지표 | 세트(항목 수) | 문서 |
|---|---|---|---|---|---|
| 인물 시뮬레이션 대사·연출·나레이션·검사 | 새 답변 생성 | 로컬 CLI `eval/simulation/orig_cli.py`(해리 포터는 저장소 밖) | act `voice`·`intent`·시점 위반율, direct 종류·화자 완전 일치, narrate `style`·`info`·시점 위반율, check 정확도·오경보율·놓침률 | 원문 평가 ①~④: 공개 150·150·100·100, 로컬 해리 포터 400·300·200·300 | [원문 평가](simulation-original.md) |
| NovelBrain 단계 효과(검색 문맥을 준 응답의 시점 일관성) | 새 답변 생성 | 로컬 CLI `run_timechara.py`·`ko_timechara/kt_run.py`(유료 호출) | 시공간 일관성 | KoTimeChara 3,328·TimeChara 600 | [NovelBrain 평가](novelbrain.md) |
| NovelBrain 근거 검색(영어 공개) | 원문 검색 | 로컬 CLI `run.py retrieval`(호출 없음) | Recall@5·P@5 | NarrativeQA 100·MuSiQue 100 | [NovelBrain 평가 §4.1](novelbrain.md#41-근거-검색-narrativeqamusique) |
| 전처리 설정 추출(로컬 세트) | 새 답변 생성 | 로컬 CLI `eval/extraction/ex_cli.py score`(유료 호출, 해리 포터·웹소설 원문은 저장소 밖) | `recall`(설정다운 정답)·`quote_ok` | 해리 포터 14·웹소설 87회차(로컬 전용) | [추출 평가 세트](extraction-set.md) |

## 2. 검색 평가 방식

고정 원문·고정 스냅샷으로 검색 두 가지만 잰다. 새 세트는 만들지 않고 NovelBrain 평가의 한국어 세트([§4.4](novelbrain.md#44-한국어-적용성저장소-샘플-62문항))를 그대로 쓴다.

- **원문**: 저장소 샘플 3편(`infrastructure/sample-data/content`의 구운몽·별빛 서약의 탑·회색 도시의 우편배달부). 회차 4·3·2개, 문단 20·15·7개, 설정 카드 17·13·8개, 관계 10·6·3개다. 회차마다 관계가 달라지는 샘플이 아니라 같은 관계 목록을 모든 회차에 쓴다.
- **질문**: 모델이 만든 한국어 62문항을 규칙(근거 구절이 원문에 있음·질문에 답이 그대로 없음·길이·낱말 겹침·중복)으로 다시 검증해 통과한 것이다. **사람이 검증한 세트가 아니다.** 종류는 `known`(그 인물이 겪은 사건의 문단, 24)·`setting`(설정 카드, 14)·`future`(기준 회차 뒤의 것, 13)·`unwitnessed`(그 인물이 나오지 않은 문단, 11)다.
- **고정 스냅샷**(`tests/retrieval_eval/fixtures/`): `ko_worlds.json`은 작품별 세계관을 Content MCP `world_studio_read` 응답 모양(카드 `body`·`semanticMetadata.revealFromEpisode`, 관계 `sourceCardId`·`targetCardId`·`label`)으로 담고, `ko_questions.jsonl`은 질문마다 `recall` 입력(인물 카드 id·기준 회차·질문·E5 상위 10 발췌)과 찾아야 할 근거 `gold`(known·setting) 또는 상위 5에 들면 안 되는 근거 `banned`(future는 기준 회차 뒤 문단·미공개 카드, unwitnessed는 그 문단)를 담는다.
- **무엇이 고정이고 무엇이 실제 코드인가**: 모델이 필요한 유일한 단계(E5 임베딩 → 상위 10 문단)의 결과만 얼린다. 세계관 변환(`world_snapshot`)·PPR·BM25·RRF·인물 시점 필터·Q&A 설정 거르기는 운영 코드를 그대로 돈다. 그래서 CI가 모델·네트워크 없이 결정적으로 돈다.
- **측정과 회귀 방지는 다르다**: 실제 정확도 측정은 E5를 실제로 돌리는 `ko.py run`의 결과(`results/ko-retrieval.json`)이고, pytest는 같은 입력에서 순위 코드가 나빠지지 않았는지만 본다([테스트 배치 원칙](../../backend/ai-service/docs/agent-structure.md#테스트-배치): 고정 모델 응답·벡터는 동작 검증용이라 정확도 측정 결과로 보고하지 않는다). 둘의 값은 같고, 어긋나면 테스트가 깨진다(§6).

## 3. 지표

| 지표 | 정의 | 읽는 법 |
|---|---|---|
| Recall@k | 상위 k 근거 안에서 찾은 정답 근거의 비율 | 질문마다 정답이 하나라 0 또는 1이다 |
| P@k | 상위 k칸 중 정답의 비율(결과가 k개보다 적어도 분모는 k) | 정답이 하나면 최대 1/k = 0.20이다 |
| **MRR@k** | 질문마다 첫 정답 근거 순위의 역수(상위 k 밖이면 0)를 평균 | 정답을 몇 번째에 찾았는가. 1.00은 늘 1위, 0.50은 늘 2위다. Recall@k가 같아도 순위가 다르면 갈린다 |
| 누설 | 막아야 할 근거가 상위 5에 든 질문의 비율. future는 기준 회차 뒤 문단·공개가 기준 회차 뒤에 시작되는 카드, unwitnessed는 그 인물이 나오지 않은 문단 | 낮을수록 좋다. 필터와 같은 조건이라 필터를 건 구성의 0은 규칙 집행의 확인이다([§4.4](novelbrain.md#44-한국어-적용성저장소-샘플-62문항)) |

근거 id는 문단과 카드이고 관계 항목은 근거가 아니라 뺀다. 같은 근거는 처음 순위에서 한 번만 센다. NovelBrain은 앞선 평가와 같은 k=5이고, 운영 `recall`은 인물 턴(3단계)과 나레이션(2단계) 모두 기본 k=8로 받는다(`app/simulation/service.py`). Q&A 설정 발췌는 운영 상한과 같은 k=8이다.
MRR은 순위에 민감하지만 운영은 받은 k건을 모델이 모두 읽는다. MRR 하락이 곧 품질 하락은 아니고 상위 몇 건만 쓰는 사용에서 의미가 크다.

## 4. 시뮬레이션 기억 회상(NovelBrain) 결과

한국어 62문항(known 24·setting 14·future 13·unwitnessed 11), k=5. Recall·P·누설은 [NovelBrain 평가 §4.4](novelbrain.md#44-한국어-적용성저장소-샘플-62문항)와 같은 값이고 MRR 열이 새 값이다(`python3 eval/novelbrain/report.py`의 출력).

| 구성 | known R@5 | known P@5 | known MRR@5 | setting R@5 | setting P@5 | setting MRR@5 | future 누설 | unwitnessed 누설 |
|---|---:|---:|---:|---:|---:|---:|---:|---:|
| 그래프만 (= 0단계) | 0.00 | 0.00 | 0.00 | 0.43 | 0.09 | 0.36 | 0.38 | 0.00 |
| 벡터만 | 0.96 | 0.19 | 0.92 | 0.00 | 0.00 | 0.00 | 1.00 | 1.00 |
| BM25만 | 0.00 | 0.00 | 0.00 | 1.00 | 0.20 | 0.95 | 0.77 | 0.00 |
| 0+1 | 0.96 | 0.19 | 0.48 | 0.43 | 0.09 | 0.33 | 1.00 | 1.00 |
| 0+1+2 (= 전체 − 필터, 나레이션이 쓰는 2단계) | 0.96 | 0.19 | 0.41 | 1.00 | 0.20 | 0.52 | 1.00 | 1.00 |
| 0+1+2+3 (= 전체, 인물 턴이 쓰는 3단계) | 0.96 | 0.19 | 0.51 | 0.86 | 0.17 | 0.65 | 0.08 | 0.00 |
| 전체 − 그래프 | 0.96 | 0.19 | 0.93 | 0.86 | 0.17 | 0.71 | 0.08 | 0.00 |
| 전체 − 벡터 | 0.00 | 0.00 | 0.00 | 0.86 | 0.17 | 0.71 | 0.08 | 0.00 |
| 전체 − BM25 | 0.96 | 0.19 | 0.56 | 0.29 | 0.06 | 0.25 | 0.08 | 0.00 |

- **MRR이 Recall@5가 가린 순위를 보인다.** known의 Recall@5는 벡터만·전체가 같은 0.96이지만 MRR@5는 0.92와 0.51이다. 벡터만은 24문항 중 21문항에서 정답 문단이 1위이고, 전체(3단계)는 19문항에서 2위·2문항에서 1위·2문항에서 3위(1문항은 상위 5 밖)다. 인물 자신의 카드(필터가 항상 허용하는 카드)가 24문항 중 21문항에서 1위여서 정답 문단이 한 칸 밀린다(예: ko-000은 1위 인물 카드, 2위 정답 문단). 그래프를 빼면 0.93으로 돌아온다. 이 샘플에서 그래프는 known의 재현율을 더하지 못하고 순위만 민다(setting의 MRR도 그래프를 빼면 0.65에서 0.71로 오른다).
- **필터는 setting의 재현율을 깎고 순위를 올린다.** 2단계 → 3단계에서 setting Recall@5는 1.00 → 0.86(14문항 중 2문항 손실)이지만 MRR@5는 0.52 → 0.65다. 정답 카드 앞에 있던 다른 인물 카드(공개 전이거나 그 인물과 관계로 이어지지 않음)와 그 인물 이름이 나오지 않는 원고 문단을 필터가 걷어 정답 카드가 올라온다(정답 순위가 1위인 문항 4개 → 7개). 손실 2문항(ko-034 오르벤의 서한, ko-042 주소가 지워진 편지)은 인물과 관계로 이어지지 않은 물건 카드라 필터가 확인 불가로 닫은 것이다([§4.4 필터의 대가](novelbrain.md#44-한국어-적용성저장소-샘플-62문항)).
- **역할 분담은 그대로다.** 원고 질문(known)은 벡터만, 설정 질문(setting)은 BM25가 찾는다(BM25만 MRR 0.95). 이 표는 구성 비교이지 검색기 간 우열이 아니다.
- **62문항·작품당 문단 7~20개의 작은 코퍼스다.** 한 문항이 Recall에서 1/24~1/14, MRR에서 더 작게 움직이므로 구성 사이 작은 차이는 잡음이다([§7](#7-한계)).

## 5. Q&A 설정·관계 발췌 결과

`world_excerpts`는 작품의 세계관을 질문의 기준 회차 시점으로 읽어 그 회차까지 공개된 카드·관계만 남기고(`episode_settings`), 8건을 넘으면 질문과 BM25로 맞는 8건을 보낸다(질문 낱말이 하나도 겹치지 않는 설정은 보내지 않는다). Content MCP를 고정 세계관으로 대신하고 62문항을 각자의 기준 회차로 던진다. 세 작품의 공개 설정·관계는 마지막 회차 기준 27·19·11건(8건 초과)이라 설정 질문은 모두 BM25가 고르는 경로를 탄다.

| 검사 | 질문 | 결과 |
|---|---|---|
| 정답 카드가 발췌 8건 안에 든다(Recall@8) | setting 14 | 1.00 (14/14) |
| 정답 카드의 순위(MRR@8) | setting 14 | 0.92 (1위 12·2위 1·3위 1) |
| 기준 회차 뒤에 공개되는 카드·관계가 새지 않는다 | 62 (그중 막을 설정이 있는 질문 23) | 누설 0건 |

- 발췌가 빈 질문이 3개(ko-014·ko-031·ko-046)다. 질문 낱말과 겹치는 공개 설정이 없을 때 설계대로 빈 발췌와 사유(`NO_SETTINGS`)를 돌려준 것이고 셋 모두 설정 질문이 아니다.
- 설정 질문만 정답 카드가 있다. 나머지 48문항은 누설 검사에만 쓴다.

## 6. pytest 임계값

`tests/retrieval_eval`은 CI의 AI 단위 레인(`pytest -m 'not integration'`)에서 모델·네트워크 없이 돈다. 임계값은 위 측정값을 소수 둘째 자리 아래로 내린 값이라 문항을 하나 잃으면(Recall은 1/24·1/14, 누설은 1/13) 깨진다. 값을 올리는 변경은 임계값도 올린다.

| 테스트 | 지표 | 측정값 | 임계값 |
|---|---|---|---|
| NovelBrain 3단계(인물 턴) | known Recall@5 | 0.958 | ≥ 0.95 |
| | known MRR@5 | 0.507 | ≥ 0.50 |
| | setting Recall@5 | 0.857 | ≥ 0.85 |
| | setting MRR@5 | 0.655 | ≥ 0.65 |
| | future 누설 | 0.077 | ≤ 0.08 |
| | unwitnessed 누설 | 0.000 | ≤ 0.00 |
| NovelBrain 2단계(나레이션) | known Recall@5 | 0.958 | ≥ 0.95 |
| | known MRR@5 | 0.415 | ≥ 0.41 |
| | setting Recall@5 | 1.000 | ≥ 1.00 |
| | setting MRR@5 | 0.523 | ≥ 0.52 |
| | 두 누설(대조군: 필터가 없어 새는 것이 정상) | 1.00 | ≥ 0.90 |
| Q&A 설정 발췌 | setting Recall@8 | 1.000 | ≥ 1.00 |
| | setting MRR@8 | 0.917 | ≥ 0.91 |
| | 누설(기준 회차 뒤에 공개되는 카드·관계)과 8건 초과 | 0건 | 0건(62문항 전부) |

그 밖의 검사: 스냅샷이 네 종류(24·14·13·11)를 모두 갖는다, 막을 설정이 있는 질문이 20개 이상이다(누설 검사가 빈 검사가 아니다), 스냅샷으로 계산한 2·3단계 값이 `results/ko-retrieval.json`과 같다(문서·임계값·결과가 한 입력에서 나왔다는 확인).

변이 확인: PPR 감쇠·BM25 idf·한글 bigram 토큰화·RRF 순위·필터의 이름 확인·미공개 카드 거르기·기준 회차 뒤 발췌 제거·2단계 BM25·Q&A의 공개 회차 거르기·BM25 순위·발췌 상한을 일부러 깨뜨린 11가지가 모두 하나 이상의 테스트를 깨뜨렸다.

## 7. 한계

- **회귀 방지이지 일반 정확도가 아니다.** 62문항은 모델이 만든 질문이고 사람이 검증하지 않았다. 코퍼스가 작아(작품당 문단 7~20개) 벡터가 상위 10에 정답을 거의 항상 넣는다. 임계값은 '이 입력에서 순위 코드가 나빠지지 않았다'만 말한다.
- **E5 발췌는 근사다.** 운영 원고 검색은 Content의 색인이고, 평가는 같은 E5-small로 AI가 문단을 직접 임베딩한다. Content 벡터 검색의 정확도는 이 평가 밖이다(후속).
- **관계는 회차별 변화가 없다.** 샘플 CSV의 관계 하나로 모든 회차를 평가해 회차별 관계(DEC-51)가 만드는 차이는 잡지 못한다. 시점은 카드의 공개 회차와 기억 문서로만 갈린다.
- **MRR은 한 문항에 크게 움직인다.** known 24·setting 14문항이라 한 문항이 1위에서 2위로 밀리면 평균이 known에서 0.02, setting에서 0.04 움직인다. 구성 사이의 작은 MRR 차이는 잡음일 수 있고 짝 부호 검정은 Recall·누설에만 있다.
- **결정적이지만 플랫폼 독립은 CI에서 확인한다.** 값은 순수 파이썬 계산이지만 BM25의 로그가 플랫폼 libm에 따라 마지막 자리가 다를 수 있다. 로컬(macOS arm64)에서 재현을 확인했고 Linux CI의 첫 실행은 PR에서 확인한다.
- **스냅샷은 손으로 고치지 않는다.** 샘플·질문·인코더가 바뀌면 아래 명령으로 둘을 함께 다시 만든다.

## 8. 재현

```sh
cd backend/ai-service
# CI와 같은 단위 테스트(모델 없음)
uv run --locked --extra dev python -m pytest -m 'not integration' tests/retrieval_eval
# 평가 도구 테스트(MRR·질문 채점·스냅샷 빌더)
uv run --locked --extra dev python -m pytest eval/novelbrain/test_metrics.py eval/novelbrain/test_ko.py

# 결과와 스냅샷을 다시 만든다(E5 로컬 모델 필요, OpenAI 호출 없음)
RUN='uv run --locked --extra dev --extra manuscript python eval/novelbrain'
$RUN/prepare.py e5                 # 운영과 같은 고정 리비전·SHA-256의 E5-small ONNX를 .data에 받는다(git 무시)
$RUN/ko.py run                     # results/ko-retrieval.json (Recall·P·MRR·누설·하나씩 빼기·짝 검정)
$RUN/ko.py snapshot                # tests/retrieval_eval/fixtures (recall 입력과 gold·banned)
python3 eval/novelbrain/report.py  # 표 출력
```

`ko.py run`과 `ko.py snapshot`은 같은 E5 발췌(`excerpts_for`)를 쓴다. 둘 중 하나만 다시 돌리면 §6의 마지막 검사가 깨진다.
