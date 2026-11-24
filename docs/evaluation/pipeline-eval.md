# 원문 → 세계관 → 인물 시뮬레이션 통합 평가 (#836)

> 상태: **구현·ocx 스모크 완료**(2026-11-24). 유료 OpenAI 호출은 하지 않았다(사용자 승인 전): 호출 수·금액 어림(§5)과 상한·캐시만 구현·검증했고, 로컬 게이트웨이(ocx, 금액 0)로 작품 1편·문항 5개만 돌려 흐름을 확인했다(§6).
> 기존 [원문 기반 평가](simulation-original.md)는 사람이 만든 정답 세계관(손라벨 카드)에서 인물을 시뮬레이션했다. 이 평가는 **실제 파이프라인이 원문에서 만든 세계관**으로 같은 문항을 돌린다.
> 평가 전체 목록은 [평가 목록](retrieval.md#1-평가-목록-에이전트--모드--지표--세트)이다(이 평가의 행은 §9처럼 그 문서가 정리된 뒤 더한다).

## 요약

- 원문 → ① 회차 원고 전처리(`app/manuscript_extraction`의 `extract`→`resolve`→`organize`, 운영 프롬프트·검증 그대로) → 적재 payload(`LoadPayload`: 카드·관계·인물 IDENTITY·SOUL·GOAL·회차별 기억)
  → Content가 적재·응답하는 모양(MCP `world_studio_read`)으로 변환 → ② 인물 시뮬레이션(`service.world_from` → NovelBrain 회상 → `agent.act`·`narrate`) → 원작의 다음 줄과 기존 루브릭으로 채점.
- 작품·문항·정답은 원문 평가 공개 세트(고전 5·근대 5·SCP 5, 저작권 만료 또는 CC BY-SA, 회차 2~7천 자)를 그대로 쓴다. 같은 문항을 손라벨 세계관으로도 돌려 나란히 비교한다(§3.3).
- 점수는 세 단이다: **세계관**(인용 통과율·평가 인물 포함률), **페르소나**(인물 문서 줄의 원문 근거 비율), **시뮬레이션**(기존 `voice`·`intent`·`style`·`info`·시점 위반).
- 세계관은 (원문, 지시문, 모델) 해시 키로 `.data`에 캐시해 이 셋이 바뀔 때만 다시 만든다. `--limit-usd` 상한과 `estimate`(호출 수·금액)가 있다.
- 스모크(작품 1편 3회차, 문항 5개, ocx): 파이프라인이 끝까지 돌았고 문항 입력 조립·채점·짝 비교가 동작한다. **표본이 5개라 점수 차이는 아무것도 말하지 않는다**(§6). 눈에 띈 것은 점수가 아니라 세계관이다: 인물 카드 6장 중 SOUL이 있는 인물은 1명이다.

## 1. 흐름과 무엇이 실제 코드인가

| 단계 | 실제 서비스 코드 | 이 평가가 하는 일 |
|---|---|---|
| 회차 추출 | `manuscript_extraction.service.extract`(production 프롬프트 코드 시드, 항목별 원문 대조) | 공개 세트 회차 글을 `EpisodeText`로 넘기고 응답을 캐시. 모델 호출만 장부로 감싼다 |
| 정체 정리 | `service.resolve` | 작품 전체 한 번 |
| 적재 구성 | `service.organize`(모델 없음) | 결과 `LoadPayload`를 `.data`에 저장(점검·수동 비교용) |
| 적재·읽기 모양 | Content `ManuscriptBuildMapper`·`world_studio_read` | `pipe_world.read_at`이 같은 모양으로 변환(§2) |
| 세계관 읽기 | `simulation.service.world_from` | 기준 회차(`item.base`)마다 한 번 |
| 인물 입력 조립·회상 | `character_view`·`narrator_view`(NovelBrain `recall` 3단계·2단계) | `orig_run.act_view`·`narrate_data` 그대로 |
| 생성 | `agent.act`·`agent.narrate` | `orig_run.evaluate_dialogue`·`evaluate_narration` 그대로 |
| 채점 | 원문 평가 루브릭(`app/evaluation/rubric.py`), 금지 사실은 공개 세트 정답표 | 그대로. 채점 모델 기본 `gpt-6.2-sol`(ocx) |

원고 발췌(Content Retrieval)는 `world_from`이 받지 않아 쓰지 않는다(`sim_worlds`의 손라벨 평가와 같다). 코드는 `backend/ai-service/eval/simulation/`의 `pipe_world.py`(변환·인물 잇기·문항 상태)·`pipe_build.py`(① 캐시 실행·장부·예상)·`pipe_score.py`(앞 두 단 점수)·`pipe_cli.py`(명령)이고, `orig_*`는 고치지 않았다.

## 2. Content 적재·응답 모양과 같은 점·다른 점

`ManuscriptBuildMapper`(적재)와 `WorldStudioMcpTools`(`world_studio_read`)를 근거로 `pipe_world.read_at`이 만든다. 세계관은 작품 전체 회차로 한 번 만들고 기준 회차마다 관계만 그 시점으로 읽는다.

| 항목 | Content | 이 평가 |
|---|---|---|
| 카드 본문 | `body` = 인물은 IDENTITY, 그 밖은 본문 | 같다 |
| 인물 문서 | `semanticMetadata.characterDocs{soul, goal, episodes}`, `episodes` 키는 정수 글자(`'00'` → `'0'`) | 같다(`NovelBrain`의 `_EPISODE_KEY`가 `'00'`을 못 읽는다) |
| 공개 회차 | 없음: 자동 적재는 `visibility=private`이고 `revealFromEpisode`를 정하지 않는다(DEC-53). 카드는 회차와 무관하게 모두 읽힌다 | 같다(기본 `--reveal none`). `--reveal first`는 작가가 제안값(`firstEpisode`)을 그대로 공개 회차로 정한 경우를 따로 본다 |
| 관계 | `structural`·`directed`·`asserted`, 본문 = 근거 인용(없으면 관계 이름), 회차별 시점(DEC-51: 시작·종료·재시작) | 같다: 시작·종료를 회차 순으로 따라 `episode`화에 이어진 관계만(`active_relations`) |
| 「동일 인물」 | 만들지 않는다(후보 `identityCandidates`는 작가가 승인해야 관계가 된다) | `identity: []` |
| 카드·관계 id | 작업 id와 key에서 만든 UUID | 세계관 id와 key에서 만든 uuid5 |
| 시뮬레이션이 읽지 않는 필드(`areaCode`·`classification`·`tags`, `semanticMetadata`의 `studio`·`manuscriptBuild`·`preprocessing`) | 있다 | 뺐다 |
| 회차 하나가 실패 | 작업 전체가 실패하고 이어 받는다 | 나머지 회차로 세계관을 만들고 실패를 결과에 센다(모든 회차·정체 정리·구성이 실패하면 그 작품은 `world_failed`) |

**`--reveal none`의 결과**: 인물이 아닌 카드(장소·물건·규칙·조직·사건)는 공개 회차가 없어 전지적 나레이터(`narrator_view`, 인물 필터 없음)가 기준 회차 뒤에 처음 나온 카드도 본다. `test_pipe_build.py`가 이를 확인한다(기준 회차 1에서 2화에 처음 나온 인물 카드의 본문이 나레이터 입력에 든다; `--reveal first`면 가려진다). 인물 시점 입력은 관계로 이어지지 않은 카드·뒤 회차 기억을 `recall` 필터가 이미 막는다.

## 3. 점수 세 단

### 3.1 세계관(코드 채점, 모델 호출 없음)

| 지표 | 정의 |
|---|---|
| 항목 통과율 | 남은 항목(대상·진술·관계) ÷ 제안(남은 + 빠진). 빠진 항목은 추출 결과의 `skipped`(코드별 건수) |
| **인용 통과율** | 1 − (인용·이름이 원문과 맞지 않아 빠진 항목 `INVALID_OR_AMBIGUOUS_QUOTE`·`INVALID_MENTION_NAME`) ÷ 제안. 한 대상이 떨어져 그것을 가리키던 진술이 연쇄로 빠진 것(`UNKNOWN_ENTITY` 등)은 항목 통과율에만 든다. 인지 대상 하나만 뺀 `KNOWLEDGE_NOT_EXPLICIT`·`INVALID_KNOWER`는 항목이 빠진 것이 아니라 분모에서 뺀다 |
| **평가 인물 포함률** | 평가 문항(① 대사·③ 나레이션·③ 독백)에 나오는 인물 이름 중 파이프라인 인물 카드에 이은 비율. 제목·별칭과 공백을 무시한 완전 일치로 잇고, 카드가 없거나 같은 이름 카드가 둘(동명이인)이면 '인물 없음'으로 센다(표기가 다른 같은 인물도 없음으로 센다) |
| 재현율 | **아직 없다**: #824(`app/evaluation/extraction.py`)가 develop에 병합되면 정답표 대비 재현율을 더한다(남은 일) |

### 3.2 페르소나(코드 채점 가능한 범위만)

평가 인물 카드의 문서 줄은 `<표지> <인용>`이다(`[사건]`·`[묘사]`·`[사실]`·`[규칙]`·`[계획]`·`[목표]`·`[추측]`). IDENTITY·SOUL·GOAL은 첫 등장 회차의 글이고 회차 기억 `NN`은 그 회차(`00`은 첫 등장 회차)의 글이다.

| 지표 | 정의 |
|---|---|
| 원문 근거(grounded) | 줄의 인용이 그 회차 원문에 글자 그대로 있는 줄 ÷ 줄. 파이프라인이 이미 대조하므로 거의 100%여야 하고, 어긋나면 적재 payload가 운영 불변식을 깬 것이다 |
| 이름 명시(named) | 줄이 인물의 이름·별칭을 담은 줄 ÷ 줄. '그는'처럼 대명사로 쓴 줄은 근거는 있어도 named가 아니다 |
| ready | IDENTITY·SOUL이 모두 줄로 있는 인물 수. IDENTITY를 이름으로 채운 인물(`organize`의 대체값)·SOUL 없는 인물은 아니다: 운영 시뮬레이션은 SOUL이 비면 시작을 거절한다(`service._filled`) |
| empty | 줄이 하나도 없는 문서(IDENTITY·SOUL·GOAL·회차 기억별 인물 수) |

성격·말투가 원작과 맞는지는 코드로 못 가려 시뮬레이션 점수(§3.3)가 대신 본다.

### 3.3 시뮬레이션(기존 루브릭) + 손라벨 기준선

① 대사 `voice`·`intent`, ③ 나레이션·독백 `style`·`info`와 시점 위반율은 [원문 평가 §7](simulation-original.md#7-채점집계)과 같은 채점이다. 같은 문항을 두 세계관으로 돌린다:

- `pipeline`: ①이 만든 세계관. 문항의 화자·장면 인물을 이름으로 카드에 잇는다.
- `hand`: 손라벨 세계관(기준선). 파이프라인으로 돌릴 수 있는 문항만 돌려 같은 문항 짝 비교(`vsHand`, 부호 검정)가 성립하게 한다.

파이프라인으로 못 돌리는 문항은 모델을 부르지 않고 이유와 함께 `skipped`로 센다(숨기지 않는다). 세트 전체 문항의 가용률도 `items`에 낸다(호출 없음):

| 이유 | 뜻 |
|---|---|
| `world_failed` | 그 작품의 ①이 끝까지 가지 못했다 |
| `no_character` | 화자 카드를 이름으로 잇지 못했다(대사·독백) |
| `late_card` | 화자 카드의 첫 등장 회차가 기준 회차보다 늦다. 인물 문서는 첫 등장 회차의 글이라 뒤 회차 내용이 든다(손라벨 문항은 기준 회차 이전에 나온 화자만 뽑았다) |
| `docs_missing` | SOUL이 비어 운영 시뮬레이션이 시작을 거절한다(`service._filled`) |
| `leak` | 정답 줄이 모델 입력에 글자 그대로 있다(기존 정답 유출 방지) |

## 4. 사용법

```sh
cd backend/ai-service
# 공개 세트 원문·문항(.data/orig)이 필요하다. 워크트리에 없으면 평가 데이터 폴더를 링크한다(.data는 git 무시):
mkdir -p eval/simulation/.data && ln -s <평가 데이터>/sim-orig-eval/.data/orig eval/simulation/.data/orig
RUN='uv run --locked --extra dev python eval/simulation/pipe_cli.py'

$RUN estimate [--works m01,s02] [--limit 20]        # ① 추출·정체 정리 호출 수와 ② 문항 수·금액 어림(호출 0). 캐시에 있는 것은 뺀다
# 이하 모델 호출. OpenAI는 유료 명령마다 같은 명령 안에서 키 파일을 불러온다(값은 출력하지 않는다)
set -a; . <키 파일>; set +a
$RUN build  --works m01 --limit-usd 2               # ① 세계관 만들기(캐시에 없는 회차만 부른다)
$RUN run    --works m01 --limit 20 --limit-usd 3 --tag p1   # ② 파이프라인·손라벨 세계관으로 같은 문항 실행(세계관은 캐시에서만 읽는다)
$RUN report --works m01 --tag p1                    # 표 + results/pipeline-eval-p1.json(집계만, 원문·카드 본문 없음)
```

- `--works`가 없으면 고른 세트에 문항이 있는 14편(`m02`는 문항이 없다). `--sets`는 `1` 대사·`3n` 나레이션·`3m` 독백(기본 셋 다). `--limit N`은 세트마다 같은 간격으로 N문항. `--worlds pipeline,hand`가 기본.
- 캐시: `.data/pipeline/worlds/<작품>/`의 `extract-<회차>.<해시>.json`·`resolve.<해시>.json`·`payload.<해시>.json`. 해시 = 단계 + 지시문 + 모델 + 입력. **원문·지시문·`OPENAI_MODEL`이 바뀌면 그 단계만 다시 부른다.** 실패한 회차는 캐시하지 않고(`.failed` 표시만 남겨 `run`·`report`가 실패로 읽는다) 다시 `build`하면 그 회차만 다시 부른다. `run`·`report`는 캐시만 읽고 없으면 `build`부터 하라고 멈춘다.
- 위치는 `PIPELINE_EVAL_DATA`로 바꿀 수 있다(기본 `eval/simulation/.data/pipeline`).
- 비용 장부: OpenAI는 `cost-pipeline.jsonl`(`--limit-usd`, 기본 5달러, 원문 평가 장부 `cost-orig.jsonl`과 따로), ocx는 `cost-ocx.jsonl`(금액 0, 토큰만). `build`·`run`은 시작 전에 예상 금액이 남은 상한을 넘으면 호출 없이 멈추고, 추출 호출은 동시 호출 수만큼 여유를 두고 상한 전에 멈춘다. 멈춘 뒤 같은 명령은 캐시·기록으로 이어 받는다.
- 기록 폴더 `.data/pipeline/runs/<태그>/`는 설정 하나(`--via`·채점·`--reveal`·act 모델)만 담는다. 다른 설정으로 이어 받으려 하면 호출 전에 멈추니 `--tag`를 바꾼다.
- **`--via ocx`(로컬 게이트웨이, 금액 0, `gpt-6-luna`)**: `OPENAI_API_KEY=ocx OPENAI_MODEL=gpt-6-luna SIMULATION_ACT_MODEL=gpt-6-luna`로 돌린다. **서비스 기본 act 모델 `gpt-6.1-terra`는 ocx로 못 돌린다**: `sim_via`가 모델을 `gpt-6-luna`로 고정하고 `--via ocx`는 act 모델이 `OPENAI_MODEL`과 다르면 거절한다(`orig_cli`와 같다). 그래서 ocx 결과는 luna act이고, 서비스 기본(terra) 점수는 유료 실행으로만 낼 수 있다. 게이트웨이 `/v1/models`에 `gpt-6.1-terra`가 보이지만 `sim_via`는 이 작업에서 고치지 않았다.
- 테스트: `uv run --locked --extra dev python -m pytest -m 'not integration' eval/simulation/test_pipe_world.py eval/simulation/test_pipe_build.py eval/simulation/test_pipe_score.py eval/simulation/test_pipe_cli.py`(모델은 대역, CI의 `tests/` 밖이라 로컬에서 돈다).

## 5. 비용·호출 어림(`estimate`, 호출 없음)

공개 세트 14편 전체(① 대사 150·③ 나레이션 70·③ 독백 30문항, 세계관 둘, 채점 ocx 0원, 단가 [원문 평가](simulation-original.md)·`cost.py`와 같은 어림: luna 입력 0.20·출력 1.20, act terra 입력 1.00·출력 5.00달러/1M 토큰):

| 단계 | 호출 | 예상 |
|---|---|---|
| ① 세계관(추출 89회 + 정체 정리 13회, 스모크로 이미 만든 `m01` 제외) | 102회 | 입력 약 53만·출력 약 18만 토큰, **약 0.32달러** |
| ② ① 대사 150 × 세계관 2(act terra) | 300회 | 문항당 약 0.0045달러, 약 1.35달러 |
| ② ③ 나레이션 70·독백 30 × 세계관 2(luna) | 200회 | 문항당 약 0.001달러, 약 0.21달러 |
| **합계** | 약 600회 | **약 1.9달러**(채점을 `--judge openai`로 하면 호출당 더 든다) |

세계관 출력 토큰(추출 호출당 2,000·정체 정리 200)은 ocx로 잰 값에 여유를 둔 어림이다(§6). 회차가 길거나 인물이 많으면 더 나올 수 있으니 유료 실행 뒤 장부로 고친다. 기본 상한 5달러 안이다.

## 6. 스모크 결과(ocx, 2026-11-24)

범위: `m01` 운수 좋은 날(현진건, 3회차 10,118자), 문항 ① 대사 2·③ 나레이션 2·③ 독백 1을 두 세계관으로, 채점 `gpt-6.2-sol`(ocx), 모델 `gpt-6-luna`(act도 luna), `--reveal none`. 전부 ocx라 금액 0이다. **유료 OpenAI 호출은 없다.** 집계는 `results/pipeline-eval-smoke.json`이다.

**① 세계관**: 추출 3회·정체 정리 1회(호출 4, 프로세스 시작을 포함해 약 48초). 카드 30장(인물 6·장소 12·사건 8·물건 2·조직 1·규칙 1)·관계 3개. 제안 59개 중 45개가 남았다(항목 통과율 76.3%). 빠진 14개는 `UNKNOWN_ENTITY` 8(앞선 대상 탈락의 연쇄)·`INVALID_MENTION_NAME` 4·`INVALID_RELATION_ENDPOINT` 2라 **인용 통과율은 93.2%**(인용·이름 문제 4건)다. 평가 문항의 인물 3명을 모두 카드에 이었다(**포함률 3/3**).
호출당 토큰(`cost-ocx.jsonl`): 추출 입력 4,062~4,387·출력 859~2,258, 정체 정리 입력 2,943·출력 114.

**② 페르소나**: 평가 인물 3명 중 IDENTITY·SOUL이 모두 줄로 있는 인물은 **1명**(김 첨지)이다. 줄은 모두 원문 근거가 있다(IDENTITY·SOUL 줄 3개 중 3개, 100%). 이름을 담은 줄은 1개(33.3%)다. 인물 카드 6장 중 SOUL이 있는 카드는 1장이고, IDENTITY가 이름으로 채워진 카드가 3장이다(치삼이·치삼·개똥이). 치삼과 치삼이는 이름이 달라 별개 카드로 남았다(손라벨 세계관도 둘을 따로 둔다).

**③ 시뮬레이션**: `m01`의 세트 전체 문항 17개(대사 6·나레이션 8·독백 3)가 모두 파이프라인 세계관으로 돌 수 있었다(`ok`). 대사·독백 화자가 모두 SOUL이 있는 김 첨지이기 때문이고, 건너뛴 문항은 없다.

| 세트 | 세계관 | 문항 | 점수 | 시점 위반 |
|---|---|---:|---|---:|
| ① 대사 | pipeline | 2 | voice 2.00 · intent 1.00 | 0% |
| ① 대사 | hand | 2 | voice 3.00 · intent 1.00 | 0% |
| ③ 나레이션 | pipeline | 2 | style 2.00 · info 1.50 | 0% |
| ③ 나레이션 | hand | 2 | style 2.00 · info 1.50 | 0% |
| ③ 독백 | pipeline | 1 | style 2.00 · info 1.00 | 0% |
| ③ 독백 | hand | 1 | style 2.00 · info 1.00 | 0% |

짝 비교(파이프라인 − 손라벨): voice 0↑2↓(평균차 −1.00, p=0.500, n=2), 그 밖의 지표는 모두 같다. **n이 1~2라 어느 쪽이 낫다고 말할 수 없다.** 이 스모크가 확인한 것은 ① 운영 `extract`·`resolve`·`organize`가 ocx로 끝까지 돈다 ② 변환한 세계관이 `world_from`·`character_view`·`narrator_view`를 통과해 모델 입력이 만들어진다 ③ 두 세계관 집계·짝 비교·표·결과 JSON이 나온다는 것이다. 소요: ② 문항 5개 × 세계관 2는 프로세스 시작을 포함해 약 45초(두 번 나눠 실행).

## 7. 한계

- **표본·분산**: 스모크는 1작품·문항 5개·모델 1회다. 모델 응답은 실행마다 달라 같은 원문도 다른 세계관이 나오는데(분산) 이 평가는 캐시에 고정된 첫 결과 하나만 쓴다. 여러 번 뽑아 분산을 재려면 모델 이름이나 지시문 글자를 바꿔 다른 캐시를 만든다.
- **act 모델**: 서비스 기본(terra) 점수는 유료 실행으로만 낸다(§4). 채점은 모델 채점이고 사람 검수 전이다([원문 평가 §14](simulation-original.md#14-채점-모델-교체gpt-62-sol말투-기준ab-선택p1b-확인-2026-11-22)).
- **세계관은 작품 전체 회차로 한 번 만든다.** 기준 회차보다 뒤 회차 내용이 세계관에 이미 있다(기준 회차 `baseEpisode`가 올린 원고의 마지막 회차보다 앞이면 운영에서도 같은 상황이다). 인물 문서는 첫 등장 회차의 글이라 첫 등장이 기준 회차 뒤인 카드는 `late_card`로 뺀다. 작가가 기준 회차까지만 올린 세계관(회차마다 따로 구축)은 재지 않는다.
- **정답표는 손라벨 세계관의 것**이다. 금지 사실(미래·비목격 사건)과 평가 인물 이름은 [공개 세트 정답표](simulation-original.md#3-원천과-라이선스)를 따라서, 파이프라인이 다르게 만든 인물(다른 이름·합쳐진 카드)은 완전 일치 규칙으로만 잇고 못 이으면 '인물 없음'(`no_character`)으로 센다. 표기 변형(예: 치삼 ↔ 치삼이)을 잇는 규칙은 실데이터에서 놓침이 보일 때 더한다.
- **`world_from`은 원고 발췌를 받지 않는다**(Content Retrieval 없음). 인물 입력은 카드·관계·회차 기억·SOUL로만 만들어진다.
- Content 검증기(Kotlin)는 이 평가를 거치지 않는다. 운영에서 같은 payload가 적재되는지는 §8의 수동 비교로 본다.
- **고어체·한자 표기가 섞인 고전(구운몽 등)·SCP 글**에서 인용 통과율이 어떤지는 아직 재지 않았다(스모크는 근대 소설 한 편이다).
- 해리 포터(저작권, 로컬 전용)는 이 평가에 넣지 않았다.

## 8. 실제 스택 업로드(수동 1회, 발표 전)

실제 Content·Neo4j·DEC-51(회차별 관계)을 거친 결과와 이 평가의 변환이 같은 규칙인지 한 번 확인한다. 이 평가가 캐시한 `payload`를 그대로 올리는 경로는 없다(Content가 저장한 추출을 다시 계산해 글자 단위로 대조하고, 적재는 AI 워커가 만든 결과만 받는다). 그래서 같은 원문을 실제 스택에 올려 만든 세계관과 비교한다.

1. 최초 구축이 켜진 로컬 스택을 띄운다(Content·AI·`ai-worker`·RabbitMQ·Postgres·Neo4j).
2. 작가 계정으로 새 작품을 만들고, `.data/orig/works/<작품>/work.json`의 `episodes[].text`를 회차로 원고 가져오기(화면 또는 `POST /works/{id}/manuscript-imports/bulk`)에 올린다. 회차가 저장되면 최초 구축이 자동으로 시작된다([저장 계약](../design/initial-build-storage-contract.md#업로드-자동-시작과-celery-큐-2026-11-20-사용자-결정)).
3. 구축이 끝나면 세계관 작업실에서 카드·관계를 읽고 `pipe_cli.py build`가 만든 `payload.*.json`과 **규칙을 비교**한다(모델이 달라 카드 내용은 같지 않다): 카드 종류별 수·인물 문서(SOUL·GOAL·회차 기억의 키가 정수 글자)·관계 시작 회차·공개 회차가 비어 있는지.
4. DEC-51 회차 선택 화면에서 N화를 고르고 보이는 관계가 `active_relations(관계, N)`과 같은 규칙(시작·종료·재시작)인지 본다.
5. 같은 인물·같은 기준 회차로 시뮬레이션을 시작해 입력(known)이 `pipe_cli.py`의 `act_view`가 만든 것과 같은 모양인지 본다.

## 9. 남은 일

- **평가 목록(`retrieval.md`)에 행 추가**: #837이 그 문서 §1을 개편(§1.2 '화면 표에 없는 평가(로컬 CLI)')하므로 충돌을 피하려고 이 작업에서는 고치지 않았다. 병합 뒤 §1.2 표에 다음 줄을 더한다: `` | 원문 → 세계관 → 인물 시뮬레이션 통합(전처리 `extract`·`resolve`·`organize` → `world_from` → `act`·`narrate`) | 생성(통합) | 로컬 CLI `eval/simulation/pipe_cli.py`(`--via ocx`는 금액 0) | 세계관 인용 통과율·평가 인물 포함률, 페르소나 인물 문서 줄의 원문 근거 비율, act `voice`·`intent`·narrate `style`·`info`·시점 위반율(손라벨 세계관 기준선과 같은 문항 짝 비교) | 공개 세트 14편: ① 대사 150·③ 나레이션 70·③ 독백 30 | [통합 평가](pipeline-eval.md) | ``
- **#824 재현율**: `app/evaluation/extraction.py`가 develop에 병합되면 §3.1에 정답표 대비 재현율을 더한다(공개 세트의 `extraction.extract` 정답표를 이 작품들의 회차에 맞춰 재사용).
- **유료 실행(사용자 승인 후)**: ① `estimate` → ② `build --limit-usd`(약 0.3달러) → ③ `run --reveal none`·`--reveal first`를 태그를 바꿔 각각(약 1.6달러씩, 두 번째는 손라벨 기준선 기록을 새 태그로 다시 만든다) → ④ `report`. `--reveal`별 시점 위반율과 `docs_missing`·`late_card` 가용률이 먼저 볼 지표다.
- 작품 14편 전체 세계관의 `world_failed`·고어체 인용 통과율, 같은 원문 여러 번 추출한 분산.
- Content 실제 업로드 결과와 이 평가 변환의 자동 비교는 §8을 사람이 한 번 한 뒤 필요하면 만든다.
