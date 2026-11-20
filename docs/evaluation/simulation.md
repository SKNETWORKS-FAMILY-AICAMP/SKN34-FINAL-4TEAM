# 인물 시뮬레이션 턴 속도·품질 성적표 (#642)

> 상태: **실행 전.** 스위치 4종과 실행기(`backend/ai-service/eval/simulation/`)는 구현했고, 실제 호출(`run`)은 비용 승인 뒤에 한다. 아래 결과 표는 `report` 출력으로 채운다.
> 계약: [인물 시뮬레이션·NovelBrain 계약](../design/character-simulation-contract.md). 스위치 설명: [AI 서비스 README](../../backend/ai-service/README.md#인물-시뮬레이션-턴-속도-스위치와-성적표-642). 실행기: [`eval/simulation/README.md`](../../backend/ai-service/eval/simulation/README.md).

## 1. 목적

인물 시뮬레이션은 턴 하나에 모델 호출을 차례로 3~8번 기다린다(연출 결정 Decisions 1~2회 → 대사·나레이션 생성 1회 → 검사 1회, 위반 시 생성·검사 최대 2회 반복). 대화 모드에서는 resume 요청마다 세계관도 다시 읽는다
(`world_studio_list` + `world_studio_read` 2회 + 원고 발췌 검색). **모델은 `gpt-6-luna`로 고정**하고(사용자 결정 2026-11-20), 대기 시간을 줄이는 설정이 품질을 얼마나 해치는지 지표로 재서 기본 설정을 정한다.
채택 설정과 그 근거는 결과가 나온 뒤 6장에 적는다.

## 2. 설정 A~E

설정은 환경 변수 스위치의 누적 조합이다. 기본값은 모두 꺼짐(지금 동작)이고 스위치는 호출 때 읽는다.

| 설정 | 환경 변수 | 뜻 |
|---|---|---|
| A | (없음) | **현재 동작.** 비교 기준 |
| B | `SIMULATION_REASONING_EFFORT=low` | 계획·인물 턴·나레이션·검사 호출에 `reasoning.effort=low` |
| C | B + `SIMULATION_SKIP_FORCED_DIRECTOR=1` | 규칙이 정한 턴(시작·메모·비트 전환·마무리, 대사 아님)은 연출 모델을 부르지 않는다. 시점은 직전 턴 시점(없으면 전지적) |
| D | C + `SIMULATION_WORLD_CACHE=1` | 목록의 `draftRevision`이 같으면 세계관 읽기를 프로세스 안에서 재사용한다. **성적표에서는 Content를 부르지 않아 효과가 0**이다(C와 같은 실행으로 기록) |
| E | D + `SIMULATION_SKIP_NARRATION_CHECK=1` | 전지적 나레이션은 검사 모델을 부르지 않는다(서버 규칙 검사는 유지) |

두 스위트가 같은 경로를 지나는 설정은 한 번만 돌리고 결과를 재사용한다(`ranAs`): **품질**은 인물 대사 턴만 지나 추론 강도만 닿으므로 **C·D·E는 B와 같다**. **속도**는 **D가 C와 같다**.
세계관 캐시의 실제 효과(Content 호출 2~3회와 원고 발췌 검색 대신 목록 1회)는 이 성적표 밖이며, 단위 테스트가 호출 수로 보증한다.

## 3. 지표

### 3.1 품질(`quality`): TimeChara 검증 세트

- **표본:** 검증 600건에서 유형(future·past-only·past-absence·past-presence)마다 50개, 시드 642로 고정(`prepare`가 `.data/sample.json`에 질문 번호를 남긴다). 200문항.
- **입력:** 질문을 *그 시점 인물에게 인터뷰어가 묻는 장면 한 줄*로 바꾼다(IF 전제는 고정 문장, 참여 인물은 그 인물 한 명, 시점은 `limited:<인물>`). 세계관은 `eval/novelbrain`과 같이 `timechara.build_world`(그 시리즈의 사실 사건 전부)로 만들고 `snapshot`을 인물의 기준 장으로 자른다. **원고 발췌 없이 카드·관계만** 입력이다(소설 청크를 쓰지 않는다).
- **경로:** 운영 인물 턴 그대로 `service.character_view` → `agent.act` → 서버 규칙(`_problem`) → `agent.check`(`service.verify`) → 위반이면 고정 안내로 다시 쓴다(최대 2번). 장면 에이전트의 도구·검사 미들웨어를 한 턴만 돌릴 수 없어 같은 함수를 같은 순서로 부르는 얇은 루프다.
- **채점:** [공개 TimeChara 기준](novelbrain.md)(`run_timechara.judge_spatiotemporal·judge_personality`)을 그대로 쓴다: future·past-only는 시간(0/1), absence·presence는 공간(먼저)×시간, 성격 1~7. 채점 모델은 `cost.MODEL`로 고정이다.

| 지표 | 정의 |
|---|---|
| 시공간 일관성(최종) | 사용자가 보게 될 응답(재생성 뒤 마지막 시도)의 유형별 평균(Wilson 95% 구간)과 공개 유형 비중(1/3·1/3·1/6·1/6)의 가중 평균. 채점하지 못한 응답은 평균에서 뺀다 |
| 시공간 일관성(첫 응답) | 검사 전 첫 응답의 같은 값. 검사·재생성이 얼마나 올렸는지 본다 |
| 성격 일관성 | 1~7 평균(성격 설명이 있는 인물만) |
| 검사 위반률 | 첫 응답을 서버 규칙·검사 모델이 위반으로 본 비율 |
| 누설 적발률 | 심판이 누설(시공간 0)로 본 첫 응답 중 우리 검사가 위반으로 걸렀던 비율. `leakRate`는 그중 `knowledge_leak` 항목으로 건 비율 |
| 오경보율 | 심판이 맞다(시공간 1)고 본 첫 응답 중 검사가 걸렀던 비율(맞는 답을 막는 대가) |
| 멈춤 비율·평균 재생성 | 세 번 모두 위반이라 턴이 멈춘 비율, 질문당 재생성 횟수 평균 |
| 짝 비교 | 같은 질문에서 B와 A의 최종 시공간 점수를 짝지은 정확 부호 검정(`B|A`) |

### 3.2 속도(`speed`): 고정 장면 10개

- **장면:** 같은 TimeChara 세계관(해리 포터)의 8개(IF 4·흐름 4, 1~5권 끝을 기준 회차로, 인물 2~3명)와 [홍길동전 시연 세계관](../../infrastructure/sample-data/simulation-demo/honggildong/README.md)의 2개(5화 장면 계획 앞의 둘을 비트로 쓴 흐름과 같은 시점의 IF). 목록은 `sim_worlds.SCENES`다.
- **실행:** `scene_agent.build_scene_agent(pausing=False)`로 장면이 끝나거나 멈출 때까지(운영 오케스트레이션과 같이 `SceneContext(loaded=World)`·`UsageLedger`) 돈다. 시점은 연출 모델이 고른다(장면마다 인물 구성이 달라 시점이 섞인다). 장면은 순서대로 돈다.

| 지표 | 정의 |
|---|---|
| 턴 p50·p95 ms | `UsageLedger`가 턴(단계)마다 남긴 모델 호출 시간의 합의 백분위. `벽시계`는 턴이 끝난 시각 사이(recall 같은 계산 포함)다 |
| 호출 수/턴 | 턴당 모델 호출 수와 종류별(`director`·`act`·`narrate`·`check`) 평균 |
| 토큰/턴 | 턴당 입력·출력 토큰 평균 |
| $/장면 | 호출별 토큰을 `cost.py` 단가로 곱한 장면당 금액. 연출 Decisions 응답이 토큰을 안 주면 0으로 세고 `unpricedCalls`로 센다 |
| 한 번에 통과율·평균 재생성 | 턴 중 `regenerated == 0`인 비율, 턴당 재생성 평균 |
| 장면 결말 | 장면 중 `completed`·`stopped:<stopReason>`(check_failed·turn_limit·beat_rejected·call_limit)·`failed`의 비율 |

## 4. 데이터와 권리

- TimeChara 검증 세트는 **CC BY-NC 4.0, 비상업 연구 한정**이고 HuggingFace gated(로그인·약관 동의)다. 코드·공개 채점 프롬프트는 MIT([`ahnjaewoo/timechara@c0032b88`](https://github.com/ahnjaewoo/timechara/tree/c0032b88a869b163035c71cb602ef5e5bb8c00d0)).
- 해리 포터 등 소설의 원문·질문·응답·세계관은 **`eval/simulation/.data`에만** 둔다(git 무시). 저장소와 이 문서에는 집계(점수·횟수·시간·토큰)만 있다.
- `run`은 Langfuse 키를 지운다: 질문·응답 본문이 팀 Langfuse(추적)에 남지 않는다.
- 한국어 세계관은 위키문헌(저작권 만료) 원문을 근거로 한 저장소의 시연 데이터다.

## 5. 재현

```bash
cd backend/ai-service
uv run --locked --extra dev python eval/simulation/sim_cli.py prepare    # 내려받기·표본 고정(호출 없음, HuggingFace 로그인 필요)
uv run --locked --extra dev python eval/simulation/sim_cli.py estimate   # 예상 호출 수·금액(호출 없음)
set -a; . <저장소 루트 .env>; set +a                                        # OPENAI_API_KEY·OPENAI_MODEL=gpt-6-luna
uv run --locked --extra dev python eval/simulation/sim_cli.py run --suite quality --configs A,B,C,D,E --limit-usd 10   # 비용 승인 뒤에만
uv run --locked --extra dev python eval/simulation/sim_cli.py run --suite speed --configs A,B,C,D,E --limit-usd 10
uv run --locked --extra dev python eval/simulation/sim_cli.py report
```

실행 전 예상 금액과 상한: `estimate`는 설정·표본별 예상 호출 수와 금액을 호출 없이 출력하고, `run`은 시작 전에 같은 표를 출력한 뒤 `.data/cost.jsonl` 장부의 누적 합계가 `--limit-usd`에 닿으면 새 질문·장면을 시작하지 않는다(끝낸 것은 `.data/runs`에 남아 이어 받는다).
`prepare` 전에는 입력 크기를 가정값(act 8,000·check 20,000토큰)으로 센다: 그 값으로 품질 A·B가 약 6달러, 속도 A·B·C·E가 약 4달러(출력을 호출당 상한 1,500토큰으로 센 상한에 가까운 값)다. 실제 입력 크기는 `prepare` 뒤 `estimate`가 잰다.

**단가:** `eval/novelbrain/cost.py`의 gpt-5.6-luna 값(입력 $0.20·캐시 입력 $0.02·출력 $1.20 / 100만 토큰)을 쓴다. `gpt-6-luna`의 OpenAI 공식 단가는 확인하지 못했다(제3자 가격 사이트는 입력 $0.10·출력 $0.50으로 적지만 공식 페이지로 확인하지 못했다). 이 값이 맞다면 장부·예상 금액은 실제보다 높게(안전하게) 잡힌 것이다.

## 6. 결과

> **실행 전.** 아래 표는 `sim_cli.py report`의 출력으로 채우고, 같은 시점의 설정 결정(채택 설정과 근거)을 이어서 적는다.

### 6.1 품질(TimeChara 표본 200문항)

| 설정 | 시공간 최종 | 시공간 첫 응답 | 성격 | 검사 위반률 | 누설 적발률 | 오경보율 | 멈춤 | 평균 재생성 |
|---|---|---|---|---|---|---|---|---|
| A | 실행 전 | | | | | | | |
| B | 실행 전 | | | | | | | |
| C·D·E | B와 같은 실행 | | | | | | | |

### 6.2 속도(고정 장면 10개)

| 설정 | 턴 p50 ms | 턴 p95 ms | 호출/턴 | 토큰/턴 입력·출력 | $/장면 | 한 번에 통과 | 평균 재생성 | 장면 결말 |
|---|---|---|---|---|---|---|---|---|
| A | 실행 전 | | | | | | | |
| B | 실행 전 | | | | | | | |
| C | 실행 전 | | | | | | | |
| D | C와 같은 실행 | | | | | | | |
| E | 실행 전 | | | | | | | |

## 7. 읽는 법과 한계

- 표본 200문항에서 유형별 한 점대의 차이는 잡음일 수 있다(Wilson 구간·짝 부호 검정으로만 '올랐다·내렸다'를 말한다). 속도의 p95는 장면 10개의 턴 수십 개로 센 값이다.
- 품질 입력은 원고 발췌가 없고(카드·관계만), 인물 카드의 SOUL·GOAL이 비어 있다(TimeChara 사건 요약뿐). 절대 점수는 [NovelBrain 평가](novelbrain.md)의 TimeChara 점수와 같은 구도가 아니며 **설정 사이의 상대 비교**로 읽는다.
- 품질은 인물 대사 턴만 잰다. 전지적 나레이션 검사 생략(E)이 나레이션의 미래 누설을 얼마나 늘리는지는 이 성적표의 질문으로는 보이지 않는다(E의 품질 영향은 별도 평가가 필요하다).
- 추론 강도가 클수록 `max_output_tokens`(생성·검사 1,500) 안에서 추론 토큰이 늘어 응답이 잘려 502가 날 수 있다. 낮은 강도(B)에서는 이 위험이 줄지만 `high`를 쓰면 상한부터 다시 본다.
- 계획(`agent.plan`) 호출에도 같은 추론 강도가 적용된다(`_parse` 공통). 성적표는 계획 호출을 재지 않는다.
- 해리 포터 8개 장면의 인물 이름·비트는 TimeChara 데이터의 이름과 맞춰 있어야 하며, 맞지 않으면 `estimate`·`run`이 짐작하지 않고 멈춘다(`prepare` 뒤 첫 `estimate`가 확인).
