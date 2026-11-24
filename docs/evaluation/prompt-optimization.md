# 프롬프트 자동 개선(GEPA) 평가 (#823)

인물 시뮬레이션 지시문(`character_simulation.act`·`character_simulation.narrate`)의 새 버전을 [GEPA](https://github.com/gepa-ai/gepa)(`gepa` 0.1.x, MIT)로 만든다.
계약은 [운영 LLMOps 계약 — 프롬프트 자동 개선](../design/operations-llmops-contract.md#프롬프트-자동-개선-823-2026-11-24-사용자-결정)이고 이 문서는 데이터·비용·읽는 법을 적는다.
수치는 문서·로컬 측정으로 한 어림이며 첫 실행에서 실측한다.

## 흐름 한 줄

LLMOps 화면의 `자동 개선` 버튼 → 운영이 접수 → AI 작업 워커가 (production 기준 Run이 없으면 기준 평가) → GEPA로 최적화 풀에서 지시문을 고쳐 val 점수가 가장 높은 후보를 고르고 → 시드보다 0.05 이상 나으면 새 버전(라벨 없음)으로 저장 → 그 버전의 **게이트 세트** 회귀 평가 Run 1회로 끝난다. 후보 등록·서비스 반영은 사람이 기존 버튼으로 한다.

## 데이터: 게이트 세트와 최적화 풀

| 프롬프트 | 게이트 세트(Langfuse, 기존) | 최적화 풀(AI 이미지 안, Langfuse 아님) | train | val | 라이선스(저작권 만료 / CC BY-SA 3.0) |
|---|---|---|---|---|---|
| `character_simulation.act` | `simulation.act` 24문항 | `app/evaluation/datasets/optimize/simulation.act.jsonl` 126문항(1.25MB) | 106 | 20 | 73 / 53 |
| `character_simulation.narrate` | `simulation.narrate` 46문항(나레이션 24·독백 22) | `.../optimize/simulation.narrate.jsonl` 54문항(0.45MB) | 34 | 20 | 45 / 9 |

- 풀은 원문 평가 공개 세트(고전 5·근대 5·SCP 5, 해리 포터 없음)의 문항 중 **게이트 세트가 고르지 않은 나머지**다. 항목 모양은 게이트 세트와 같고(`input`·`expectedOutput`·`metadata.judge`) `metadata.split`(`train`·`val`)이 더해진다. 게이트 세트와 한 문항도 겹치지 않아(`tests/optimization/test_pool.py`) 게이트 세트가 최적화가 한 번도 보지 못한 검증 세트다.
- val은 풀 전체에서 같은 간격으로 20개(풀이 작으면 풀의 40%까지)다. 기본 호출 상한 150에서 기준 본문의 val 평가(20호출)가 호출의 큰 몫을 쓰지 않게 작게 잡았고, 묶음(라이선스·종류)이 풀에 있는 비율대로 섞인다.
- `datasets/optimize/`는 `seed.load()`(`datasets/*.jsonl`만 읽음)에 안 걸려 Langfuse에 올라가지 않는다.
- 다시 만들기(호출 없음): `backend/ai-service/eval/simulation/.data`에 원문 평가 데이터(`/Users/yunseongho/orca/storyfork-eval-data/sim-orig-eval/.data`)를 연결한 뒤 `python eval/simulation/orig_cli.py export --pool`(게이트 세트는 `--pool` 없이 같은 명령, 바꾸면 기준 Run을 다시 만든다).

## 비용과 시간(어림)

항목 하나를 한 후보로 평가하면 **metric call 1회** = 생성 1 + 채점 1(둘 다 OpenAI). 반성 모델(`gpt-6-sol`)은 로컬 게이트웨이라 OpenAI 호출이 아니다.

| `maxMetricCalls` | act의 OpenAI 호출 | narrate의 OpenAI 호출 | 비고 |
|---|---|---|---|
| 150(기본) | 2×150 + 2×24 = 348 | 2×150 + 2×46 = 392 | 기준 평가가 없으면 게이트 세트 평가만큼 더 든다 |
| 500(서버 상한) | 1,048 | 1,092 | |

- 호출당 2~3초, 항목 5개 동시이면 20~45분이다(`docs/evaluation/simulation-v3.md`의 지연 기준). act 호출당 입력이 길어 단가는 `simulation-v3.md`의 어림보다 낮을 수 있다.
- GEPA는 시드의 val 전체 평가(20호출)부터 하고 반복마다 minibatch(3문항) 둘 + 개선되면 val 전체를 평가한다. 상한 150이면 후보 몇 개를 전체 평가할 수 있고 상한이 val 문항 수(20)보다 작으면 시드만 평가하고 끝난다. 상한은 반복 단위로 확인해 조금 넘을 수 있다(실측: 상한 40에 호출 42).
- 실패한 호출은 0점으로 두되 전체의 20%를 넘으면 중단한다.

## 결과 읽는 법

| 어디 | 무엇 |
|---|---|
| LLMOps → 프롬프트 상세 | 새 버전(라벨 없음, 변경 메모 `GEPA 자동 개선: 기준 v{n}, val {seed}→{best}, 평가 Run {run}`)과 그 버전의 회귀 평가 결과. 통과하면 `후보 등록` → `서비스에 반영` |
| LLMOps → 평가 상세 | 지표 평균과 **문항별 결과 표**(문항 id·지표 점수·결과·이유. 실패 = 항목 오류 · `pov_ok` 0 · 지표 하나라도 0.5 미만, 실패 먼저). 게이트 세트의 실패 문항을 보고 지시문을 사람이 더 고칠 수 있다 |
| LLMOps → 추적(기능 `prompt_optimization`) | 한 번의 개선: `seedScore`·`bestScore`·`savedVersion`·`evaluationRun`·`outcome`(`saved`·`no_improvement`·`rejected`)·저장하지 않은 이유 `reason`(`개선 없음` 등)·`failedCalls`/`totalCalls`. 안쪽 생성 호출이 generation으로 남아 비용이 보인다. 실패면 level ERROR와 고정 사유 |

`outcome=no_improvement`(최고 − 시드 < 0.05)·`rejected`(`SAFETY` 문장 누락·길이 2배 초과)면 저장하지 않는다. 지표 표준오차가 0.03~0.08이라 0.05 여유 없이 최고를 고르면 잡음만으로 시드를 넘는다.

## 첫 실행에서 확인할 것

1. `PROMPT_OPTIMIZER_BASE_URL`(로컬 `http://host.docker.internal:10100/v1`)이 `ai-jobs-worker` 컨테이너에서 닿는지(반성 호출 실패는 trace ERROR `프롬프트 개선 모델 호출에 실패했어요.`로 바로 끝난다).
2. 실제 호출 수·시간·금액(OpenAI 사용량)이 위 어림과 맞는지, `failedCalls`가 0에 가까운지.
3. 개선 폭이 0.05를 넘는지와 게이트 세트 Run이 통과하는지. 게이트 세트 평가는 24·46문항이라 같은 지시문도 Run마다 흔들린다([계약 한계](../design/operations-llmops-contract.md#ponytail-한계)).

## 검증(단위, 모델·Langfuse·Postgres 대역)

```sh
cd backend/ai-service
uv run --locked --extra dev python -m pytest -m 'not integration' tests/optimization tests/jobs tests/evaluation
cd eval/simulation && python -m pytest -q test_orig_export.py   # 풀 내보내기(CI가 아니라 로컬)
```
