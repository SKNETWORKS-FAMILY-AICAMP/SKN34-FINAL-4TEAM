# 인물 시뮬레이션 성적표 (#642)

인물 시뮬레이션 턴 속도 스위치(설정 A~E)가 속도와 품질에 주는 영향을 지표로 잰다. 스위치는 [AI 서비스 README](../../README.md#인물-시뮬레이션-턴-속도-스위치와-성적표-642), 설정·지표·결과 표는 [평가 결과](../../../../docs/evaluation/simulation.md)에 있다.
`eval/novelbrain`(TimeChara 파싱·세계관 구성·시점 규칙·공개 채점·비용 장부·Wilson 구간·부호 검정)을 import해서 쓰고 다시 구현하지 않는다(`sys.path`에 `eval/novelbrain`을 더한다).
그래서 모듈 이름은 `sim_` 접두어로 novelbrain의 모듈과 겹치지 않게 했다.

## 파일

| 파일 | 역할 |
|---|---|
| `sim_cli.py` | 명령 `prepare`·`estimate`·`run`·`report`·`build-hp`·`show-hp`·`seed-hp`와 결과 JSON 조립. `run`·`estimate`·`report`는 `--world thin|hp`, `run`은 `--via openai|ocx` |
| `sim_config.py` | 설정 A~E(환경 변수 조합)·스위치 적용·같은 경로의 설정 재사용 계획·예상 호출 수와 금액(순수 함수) |
| `sim_worlds.py` | TimeChara·홍길동전 시연 세계관·해리 포터 원문 기반 세계관(`hp_world`) → `service.World`(Content 호출 없음), 표본 고정, 고정 장면 목록(해리 포터 8 + 한국어 2) |
| `hp_chapters.py` | 해리 포터 번역본 장 나누기(머리 형식·목차·빠진 장 처리, 못 찾은 장은 묶음) |
| `hp_build.py` | 장 → 모델 추출 → 정체 정리(영어 이름) → 인물 IDENTITY·SOUL·GOAL → `.data/hp/world.json`(시연 세계관 형식, 서버 한도 안·인물당 관계 상한) · `preview.md` |
| `hp_traits.py` | SOUL·GOAL 다시 쓰기: 원문 전체의 변하지 않는 면만 쓰게 하는 요청, 반전·결과 금지 낱말(정해 둔 것 + 인물의 뒤 회차에만 나오는 고유명사) 검사 |
| `hp_seed.py` | `world.json`을 로컬 스택에 배치로 적재하고 다시 실행하면 서버를 world.json과 같게 맞춘다(바뀐 카드·관계 갱신, 줄어든 관계는 종료 연결로 끝냄; `seed.py` 함수 재사용, localhost만, 비밀번호는 환경변수) |
| `sim_via.py` | `--via ocx`: 로컬 OpenCodex 게이트웨이(구독 경로)용 채점 어댑터·시뮬레이션 `ChatOpenAI` 대체(`chat`, 429 대기 포함)와 금액 0 장부 |
| `sim_quality.py` | 품질: 질문 → 운영 인물 턴 경로(`character_view` → `act` → 서버 규칙 → `check` → 재생성) → 공개 기준 채점 |
| `sim_speed.py` | 속도: 고정 장면을 장면 에이전트로 끝까지 돌려 `UsageLedger` 기록을 집계 단위로 만든다 |
| `sim_stats.py` | 백분위·품질/속도 집계·표 출력(순수 함수) |
| `orig_cli.py` | **원문 기반 평가 세트**([설계](../../../../docs/evaluation/simulation-original.md)) 명령 `collect`·`label`·`align`·`build-sets`(`--dev`: 후보 고르기용 dev 문항)·`review`·`review-pair`(두 실행의 글 나란히 보기)·`estimate`·`run`·`report`·`compare`·`summary`(실행 전부를 기준선과 짝 비교해 한 파일로; 채점 모델 기본은 ocx `gpt-6.2-sol`(기록은 `runs-gpt-6.2-sol`, `run·summary·compare`의 `--judge-model`·`--grader`), 처음의 `gpt-6-luna`는 `--judge-model gpt-6-luna`·`--grader gpt-6-luna`로만 쓰고 기록은 `runs`다)·`scenes`(해리 포터 고정 장면에서 끝까지)·`export`. 공개 세트(고전 5·근대 5·SCP 5)와 해리 포터(`--corpus public|hp`) |
| `orig_turns.py`·`orig_align.py` | 원문을 대사·지문 턴으로 자르고(따옴표 규칙) 화자·독백만 두 경로(OpenAI·ocx) 판별이 일치할 때 확정 |
| `orig_corpus.py`·`orig_collect.py` | 원천(공개 세트 파일·해리 포터 world.json) 읽기와 공개 원천 수집(고전은 `kt_select` 재사용) |
| `orig_sets.py`·`orig_variants.py` | 문항 생성(자격·정답 유출·편중 없는 뽑기·사실 주입)과 평가 때만 끼우는 후보(입력 구성 V1~V5·연출 D·act·나레이션 지시문 P·N·추론 강도 E·모델 M, [결과 문서 §13](../../../../docs/evaluation/simulation-original.md#13-품질-끌어올리기-1단계--v2-기준선과-후보-짝-비교-2026-11-22)) |
| `v2_charts.py`·`v3_charts.py` | **버전 보고서 그림**([v2](../../../../docs/evaluation/simulation-v2.md)·[v3](../../../../docs/evaluation/simulation-v3.md)): 결과 집계(`results/*.json`)에서 그림을 다시 그린다(`uv run --with matplotlib python eval/simulation/v3_charts.py`, matplotlib는 그릴 때만 불러오고 값을 읽는 순수 함수만 단위 테스트한다) |
| `sim_v4.py`·`sim_scene_judge.py`·`v4_report.py`·`v4_cli.py`·`v4_charts.py` | **V4 시험**([보고서](../../../../docs/evaluation/simulation-v4-draft-parallel.md)): 슈퍼바이저 초안 → 턴별 병렬 수정·검사(평가 전용, `app/` 변경 없음), 장면 채점(계획·설정 기준), 조건 비교 집계(Fisher·순열 검정), 실행(`run`·`judge`·`report`, `--via ocx|openai`)과 그림 |
| `orig_judge.py`·`orig_agree.py`·`judge_cli.py` | **채점 보강**([결과 문서 §14](../../../../docs/evaluation/simulation-original.md#14-채점-모델-교체gpt-62-sol말투-기준ab-선택p1b-확인-2026-11-22)): 채점 모델을 바꿔 저장된 생성을 다시 채점(`regrade`, 생성은 다시 안 함, 기록은 채점 방식마다 `runs-<이름>`), 말투 기준(`voiceRef`) 채점, 같은 문항 두 생성의 A/B 선택(`judge-pair`, 순서를 바꿔 두 번), 두 채점의 일치(`agree`, 두 채점이 모두 채점한 문항만). `run --judge-model`로 만든 후보의 생성 기록은 `--source <모델>`로 읽는다. 순수 함수와 테스트는 모델·코퍼스를 대역으로 둔다 |
| `orig_run.py`·`orig_export.py` | 서비스 함수 호출·채점·집계·짝 비교와 LLMOps 형식 내보내기(`app/evaluation/datasets/simulation/`) |
| `test_*.py` | 위 순수 로직과 실행 흐름의 단위 테스트(모델·채점·Content는 대역, 호출 없음) |
| `results/*.json` | `run`이 쓰는 집계(커밋 대상, 질문·응답 없음). 아직 없다 |

`.data/`(git 무시)에는 TimeChara 원문·표본(`sample.json`)·질문별 기록(`runs/*.jsonl`: 응답 본문 포함)·채점 캐시·비용 장부·해리 포터 번역본(`hp/raw`)과 거기서 만든 장 나눈 글·`world.json`·`preview.md`가 있다. **저장소에 커밋하지 않는다.**

## 재현

명령 전체(`prepare`·`estimate`·`run`·`report`)는 [결과 문서 §5](../../../../docs/evaluation/simulation.md#5-재현)에 있다. `prepare`는 HuggingFace 로그인·약관 동의가 필요하다(비상업 연구 한정, 토큰은 `~/.cache/huggingface/token`).
단위 테스트: `uv run --locked --extra dev python -m pytest -m 'not integration' eval/simulation` (`eval/novelbrain`과 한 번에 돌려도 이름이 겹치지 않는다).

## 규칙

- **`run`은 비용 승인 뒤에만 쓴다.** 시작 전에 예상 표를 출력하고 예상 합계가 상한(`--limit-usd`, 기본 10달러)을 넘으면 호출 없이 멈춘다. 시작한 뒤에는 `.data/cost.jsonl` 장부의 누적 합계로 막는다(품질·속도·재실행이 같은 장부를 쓴다): 품질은 진행 중인 질문의 비용이 끝나야 장부에 남아 새 질문을 '장부 + 동시 수(`--workers`) × 질문당 최대 금액'이 상한 안일 때만 시작하고(`sim_config.question_max_usd`: 모든 시도·채점을 출력 상한으로 센 금액), 속도는 장면 하나의 여유(0.50달러)가 남을 때만 시작한다. 시뮬레이션 모델 호출(act·check·narrate·director)은 토큰으로 계산해 같은 장부에 남기고, 채점은 `eval/novelbrain`의 `usd_llm`이 남긴다. 단가는 `cost.py`(gpt-5.6-luna) 값이다.
- 같은 경로를 지나는 설정은 한 번만 돌린다(`sim_config.plan_runs`): 품질에서는 추론 강도만 닿아 C·D·E가 B와 같고, 속도에서는 세계관 캐시(D)가 Content 호출이 없어 효과가 없으므로 C와 같다. 결과 JSON의 `ranAs`가 그 대응이다.
- `run`은 시작할 때 `LANGFUSE_*` 키를 지운다: TimeChara 원문이 팀 Langfuse에 남지 않고, 프롬프트도 코드 문자열(운영 production 버전이 아님)로 돈다.
- 중단하면 `.data/runs/<suite>-<설정>.jsonl`에 끝낸 질문·장면이 남아 같은 명령이 이어 받는다. 처음부터 다시 내려면 그 파일을 지운다(프롬프트·표본을 바꾼 뒤에는 꼭 지운다).
- 속도는 장면을 순서대로 돈다(병렬 호출이 지연을 흔들지 않게). 품질은 `--workers`(기본 12) 질문씩 병렬이다.
- 질문·응답·모델 응답 본문은 오류 메시지·로그에 넣지 않는다. 호출 실패·채점 실패는 점수를 꾸미지 않고 `errors`·`failedJudge`로 센다.
- **해리 포터 원문 기반 세계관**(`build-hp`·`seed-hp`, 방법·누설 방지·한계는 [결과 문서 §8](../../../../docs/evaluation/simulation.md#8-원문-기반-세계관해리-포터)): `build-hp`는 장부 누적 상한(`--limit-usd`, 기본 18달러)을 시작 전 예상과 호출 사이 모두 지키고, 끝낸 호출은 디스크 캐시에 남아 같은 명령이 이어 받는다.
  `seed-hp`는 로컬 스택(localhost만)에만 넣고 공유·원격 DB에는 넣지 않는다. 다시 실행하면 회차마다 서버의 그 시점 관계와 world.json의 그 시점 관계를 비교해 다른 것만 보낸다(서버는 관계를 지우지 않고 종료 연결을 쓰므로 줄어든 관계도 이렇게 끝난다). 비밀번호는 환경변수 `STORYFORK_SEED_PASSWORD`로만 받고 출력하지 않는다.
- **서비스 기본 act 모델은 `gpt-6.1-terra`다**(`agent.ACT_MODEL`, 사용자 결정 2026-11-23, [§16](../../../../docs/evaluation/simulation-original.md#16-인물-대사act-기본-모델을-gpt-61-terra로-2026-11-23-사용자-결정)): `run`·`scenes`·`sim_cli`의 장부는 act 호출을 그 모델의 단가(`orig_variants.RATES`: 입력 1.00·캐시 0.05·출력 5.00달러/1M 토큰)로 세고 줄에 `model`을 남긴다(`orig_variants.priced`, 단가를 모르는 모델이면 멈춘다). 새 실행의 ① 대사 기록 `via.act`·장면 결과 `act`에 `{provider: openai, model, thinking: default}`가 남고(act를 부르지 않는 세트의 기록에는 없다. 장면의 재개 기록·결과 파일 이름에는 모델이 붙어 `scenes-<run>-gpt-6.1-terra.jsonl`·`orig-hp-scenes-<run>-gpt-6.1-terra.json`이 되므로 옛 luna act 기록을 재사용하거나 덮어쓰지 않고, `run`은 같은 이름의 기존 ① 기록이 act 모델이 다르면 호출 전에 멈추고 `--tag`를 바꾸라고 한다) `estimate`는 ① 대사를 terra 단가로 어림한다. **기준선 base2·P1 등 이전 기록은 luna act**라 새 실행과 act 모델이 다르다: 같은 조건으로 재려면 `SIMULATION_ACT_MODEL=gpt-6-luna`(OPENAI_MODEL과 같으면 표기 없이 예전 모양이다). `--via ocx`는 게이트웨이가 luna 하나라 act 모델이 OPENAI_MODEL과 다르면 쓰지 않고, 장면 실행(`scenes`)은 외부 제공사(`SIMULATION_ACT_BASE_URL`)와 함께 쓰지 않는다.
- **act 제공사 변수(`SIMULATION_ACT_*`)**: 서비스의 act가 그대로 따르므로 평가 실행기는 환경 변수만 정하면 된다(`orig_cli.py run --sets 1 --variant P1 --tag H1`의 act 호출이 그 제공사로 간다). 제공사는 Chat Completions·`reasoning_effort`라 OpenAI Responses 전용 후보 E1·E2(`reasoning`)와 `--via ocx`(게이트웨이 고정)는 함께 쓰지 않고, 다른 세트의 호출은 OpenAI라 ①만 돈다. 이 실행의 호출은 OpenAI 장부가 아니라 `.data/cost-hemmingway.jsonl`에 `orig_variants.RATES`의 모델 단가(Hemmingway: 입력 0.72·캐시 입력 0.072·출력(생각 포함) 2.70달러/100만 토큰, 캐시 토큰 수는 몰라 전부 입력 단가의 상한)로 센다(`estimate`·상한 확인도 그 단가). `--tag`는 후보 이름보다 앞서므로 같은 후보(P1)를 다른 모델로 잰 기록을 따로 둔다. 기록의 `via.act`(provider·model·thinking)와 `summary`·`compare`·`judge-pair` 결과의 `act`에 어떤 제공사·모델로 만든 실행인지 남는다. Hemmingway 시험 결과는 [결과 문서 §15](../../../../docs/evaluation/simulation-original.md#15-hemmingway-act-시험-20문항-맛보기에서-탈락-2026-11-22)(탈락, 서비스는 OpenAI 유지)다.
- **`--via ocx`**: OpenAI 상한에 닿으면 안내하는 이어 받기 경로다(로컬 OpenCodex 게이트웨이, 금액 0, 모델 gpt-6-luna). `speed`는 거절한다. ocx 호출은 장부에 `via: ocx`·금액 0으로 남고 품질 결과의 문항 기록에 `via`가 남는다(openai·ocx가 섞이면 `report`가 알린다).
- **원문 기반 평가 세트(`orig_*`)**: OpenAI 호출은 별도 장부 `.data/cost-orig.jsonl`(상한 35달러)로 세고, 유료 명령마다 같은 명령 안에서 키 파일을 불러온다. 원문·문항·모델 응답은 `.data/orig`·`.data/hp`(git 무시)에만 있고 `results/orig-*.json`에는 집계만 있다. 화자 판별의 두 경로는 응답 캐시를 따로 쓴다(같은 캐시면 일치가 거짓이 된다).
- 의존성 파일은 바꾸지 않았다.
