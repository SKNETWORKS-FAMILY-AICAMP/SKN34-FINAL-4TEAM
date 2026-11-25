# 프롬프트 자동 개선(GEPA) 평가 (#823)

인물 시뮬레이션 지시문(`character_simulation.act`·`character_simulation.narrate`)의 새 버전을 [GEPA](https://github.com/gepa-ai/gepa)(`gepa` 0.1.x, MIT)로 만든다.
계약은 [운영 LLMOps 계약 — 프롬프트 자동 개선](../design/operations-llmops-contract.md#프롬프트-자동-개선-823-2026-11-24-사용자-결정)이고 이 문서는 데이터·비용·읽는 법을 적는다.
수치는 문서·로컬 측정으로 한 어림이었고, 첫 실측은 [첫 실행 결과](#첫-실행-결과-841-2026-11-24)에 있다.

## 흐름 한 줄

LLMOps 화면의 `자동 개선` 버튼 → 운영이 접수 → AI 작업 워커가 (유효한 production 기준 Run이 없으면 기준 평가) → GEPA로 최적화 풀에서 지시문을 고쳐 val 점수가 가장 높은 후보를 고르고 → 시드보다 0.05 이상 나으면 새 버전(라벨 없음)으로 저장 → 그 버전의 **게이트 세트** 회귀 평가 Run 1회로 끝난다. 후보 등록·서비스 반영은 사람이 기존 버튼으로 한다.

## 데이터: 게이트 세트와 최적화 풀

| 프롬프트 | 게이트 세트(Langfuse, 기존) | 최적화 풀(저장소 파일, seed가 Langfuse Dataset `optimize.<게이트 세트>`로 등록) | train | val | 라이선스(저작권 만료 / CC BY-SA 3.0) |
|---|---|---|---|---|---|
| `character_simulation.act` | `simulation.act` 24문항 | `app/evaluation/datasets/optimize/simulation.act.jsonl` 126문항(1.25MB) | 106 | 20 | 73 / 53 |
| `character_simulation.narrate` | `simulation.narrate` 46문항(나레이션 24·독백 22) | `.../optimize/simulation.narrate.jsonl` 54문항(0.45MB) | 34 | 20 | 45 / 9 |

- 풀은 원문 평가 공개 세트(고전 5·근대 5·SCP 5, 해리 포터 없음)의 문항 중 **게이트 세트가 고르지 않은 나머지**다. 항목 모양은 게이트 세트와 같고(`input`·`expectedOutput`·`metadata.judge`) `metadata.split`(`train`·`val`)이 더해진다. 게이트 세트와 한 문항도 겹치지 않아(`tests/optimization/test_pool.py`) 게이트 세트가 최적화가 한 번도 보지 못한 검증 세트다.
- val은 풀 전체에서 같은 간격으로 20개(풀이 작으면 풀의 40%까지)다. 기본 호출 상한 150에서 기준 본문의 val 평가(20호출)가 호출의 큰 몫을 쓰지 않게 작게 잡았고, 묶음(라이선스·종류)이 풀에 있는 비율대로 섞인다.
- `datasets/optimize/`는 seed가 Langfuse Dataset `optimize.<게이트 세트 이름>`(예 `optimize.simulation.act`)로 멱등 등록한다(#868, `seed.load()`가 `datasets/*.jsonl`과 함께 읽는다). `load_pool`은 Langfuse 키가 있으면 그 Dataset에서 읽고(운영 화면에서 올린 문항 포함, 읽지 못하면 저장소 파일로 몰래 바꾸지 않고 실패), 키가 없는 로컬 오프라인 평가에서만 저장소 파일을 읽는다. seed는 Langfuse에 같은 id·input·expectedOutput·metadata의 문항이 이미 있으면 올리지 않는다(올리면 문항 시각이 바뀌어 배포마다 기준 Run이 무효가 되므로. 없거나 내용이 다른 문항만 올린다).
- 운영 화면 업로드([계약](../design/operations-llmops-contract.md#평가-데이터셋-api-868)): **pool에 올리면** 다음 자동 개선부터 그 문항을 쓰고 기준 Run과 상관없다. `metadata.split`이 없는 줄은 input 해시로 **그 풀의 기존 val 비율**(act 20/126 ≈ 16%)대로 train·val이 정해진다. **gate에 올리면** 그 세트의 마지막 문항이 바뀌어 기준 Run이 무효가 되므로 다음 평가가 production 버전을 먼저 다시 평가한다(비용 발생). 풀과 게이트는 같은 input을 나누어 갖지 않아 업로드도 짝 세트에 이미 있는 input을 거절한다.
- 다시 만들기(호출 없음): `backend/ai-service/eval/simulation/.data`에 원문 평가 데이터(`/Users/yunseongho/orca/storyfork-eval-data/sim-orig-eval/.data`)를 연결한 뒤 `python eval/simulation/orig_cli.py export --pool`(게이트 세트는 `--pool` 없이 같은 명령, 바꾸면 기준 Run을 다시 만든다).

## 비용과 시간(어림)

항목 하나를 한 후보로 평가하면 **metric call 1회** = 생성 1 + 채점 1(둘 다 OpenAI). 반성 모델(`gpt-6-sol`)은 로컬 게이트웨이라 OpenAI 호출이 아니다.

| `maxMetricCalls` | act의 OpenAI 호출 | narrate의 OpenAI 호출 | 비고 |
|---|---|---|---|
| 150(기본) | 2×150 + 2×24 = 348 | 2×150 + 2×46 = 392 | 유효한 기준 Run이 없으면(게이트 세트에 문항을 올린 직후 포함) 게이트 세트 평가만큼 더 든다 |
| 500(서버 상한) | 1,048 | 1,092 | |

- 시간·금액은 첫 실행에서 실측했다(act 상한 150: 약 9~10분, OpenAI 호출 380건 안팎, 약 0.65달러, [결과](#첫-실행-결과-841-2026-11-24)). 처음 어림(호출당 2~3초, 항목 5개 동시면 20~45분)보다 훨씬 빨랐다. narrate는 아직 재지 않았다.
- GEPA는 시드의 val 전체 평가(20호출)부터 하고 반복마다 minibatch(3문항) 둘 + 개선되면 val 전체를 평가한다. 상한 150이면 후보 몇 개를 전체 평가할 수 있고 상한이 val 문항 수(20)보다 작으면 시드만 평가하고 끝난다. 상한은 반복 단위로 확인해 넘을 수 있다(실측: 상한 40에 42, 상한 150에 154·168).
- 실패한 호출은 0점으로 두되 전체의 20%를 넘으면 중단한다.

## 결과 읽는 법

| 어디 | 무엇 |
|---|---|
| LLMOps → 프롬프트 상세 | 새 버전(라벨 없음, 변경 메모 `GEPA 자동 개선: 기준 v{n}, val {seed}→{best}, 평가 Run {run}`)과 그 버전의 회귀 평가 결과. 통과하면 `후보 등록` → `서비스에 반영` |
| LLMOps → 평가 상세 | 지표 평균과 **문항별 결과 표**(문항 id·지표 점수·결과·이유. 실패 = 항목 오류 · `pov_ok` 0 · 지표 하나라도 0.5 미만, 실패 먼저. 실행 중인 Run의 점수 없는 문항은 '진행 중'). 게이트 세트의 실패 문항을 보고 지시문을 사람이 더 고칠 수 있다 |
| LLMOps → 추적(기능 `prompt_optimization`) | 한 번의 개선: `seedScore`·`bestScore`·`savedVersion`·`baselineRun`·`evaluationRun`(두 평가 Run은 이름만, 항목 호출은 각 Run의 trace)·`outcome`(`saved`·`no_improvement`·`rejected`)·저장하지 않은 이유 `reason`(`개선 없음` 등)·`failedCalls`/`totalCalls`. 안쪽 생성·채점 호출이 generation으로 남아 비용이 보인다(채점은 `evaluation.rubric_grade`, 모델·토큰만 — #851 이후 실행부터). 실패면 level ERROR와 고정 사유 |
| 워커 로그(`ai-jobs-worker`) | GEPA의 점수 줄(`GEPA Iteration N: …`)과 실패 줄(`프롬프트 자동 개선 <이름> v<버전> 실패: …`). 반성 지시문 본문·예외 메시지는 없고(#852) 예기치 않은 예외는 클래스 이름과 호출 경로만 나온다(#850, [진단](#예기치-않게-끝났을-때-진단-850)) |

`outcome=no_improvement`(최고 − 시드 < 0.05)·`rejected`(`SAFETY` 문장 누락·길이 2배 초과)면 저장하지 않는다. 지표 표준오차가 0.03~0.08이라 0.05 여유 없이 최고를 고르면 잡음만으로 시드를 넘는다.

## 예기치 않게 끝났을 때 진단 (#850)

`TypeError`처럼 예기치 않은 예외로 끝난 접수(trace `prompt_optimization` ERROR, `status_message`가 클래스 이름)는 워커 로그의 `프롬프트 자동 개선 <이름> v<버전> 실패:` 줄에서 시작한다. 예외 클래스 아래에 호출 경로가 바깥 → 안쪽 프레임마다 `패키지/폴더/파일:줄 함수`로 나오고 마지막 줄이 난 곳이다. 메시지·모델 입력·응답 본문은 로그에 없다(`service._stack`).

[첫 실행](#첫-실행-결과-841-2026-11-24)의 `TypeError`(시드 val 평가 중 `simulation.act` 20건 전부, 워커를 재시작하자 사라졌고 재현하지 못했다)가 다시 나면:

1. **워커를 다시 띄우기 전에** 위 로그 줄(호출 경로)을 저장한다. 의심은 langchain-openai의 Responses 응답 처리와 오래 산 워커 프로세스의 상태다(재시작하면 증상이 사라진다).
2. 호출 경로로 모자라면 같은 잡을 훅이 달린 **임시 큐 워커**로 접수해 예외를 메시지까지 잡는다. 훅 모듈은 의심 호출을 감싸 예외를 찍는다(진단용이라 저장소에 두지 않는다):

   ```python
   # diag_hook.py
   import traceback

   from app.simulation import agent


   def noisy(call):
       def wrapped(*args, **kwargs):
           try:
               return call(*args, **kwargs)
           except Exception:
               traceback.print_exc()   # 메시지까지 찍는다: 평가 세트 본문이 섞일 수 있다
               raise
       return wrapped


   agent.act = noisy(agent.act)   # narrate를 의심하면 agent.narrate
   ```

   문제의 워커와 같은 이미지·환경(`ai-jobs-worker` 컨테이너, 훅 파일은 `PYTHONPATH`가 닿는 곳에 복사)에서 임시 워커를 띄운다. 접수 API는 `jobs` 큐로만 올리므로 같은 잡은 `apply_async`로 그 큐에 보낸다(큐 이름 `diag`는 예시):

   ```sh
   celery -A app.jobs.worker worker -Q diag -I diag_hook --concurrency=1 --loglevel=INFO
   python -c "from app.jobs.worker import run_optimization; run_optimization.apply_async(args=[{'prompt': 'character_simulation.act', 'version': 2, 'maxMetricCalls': 150}], queue='diag')"
   ```

   같은 프롬프트의 개선이 이미 실행 중이면 409로 끝나니 먼저 끝났거나 멈춘 것을 확인한다. 임시 워커에서 재현되지 않으면 오래 산 워커 프로세스의 상태가 의심스럽다(첫 실행도 별도 프로세스에서는 재현되지 않았다).
3. 끝나면 임시 워커를 끈다. 진단 출력에는 평가 세트 본문·모델 응답이 섞일 수 있어 저장소·이슈에 붙이기 전에 확인한다.

## 첫 실행에서 확인할 것(2026-11-24 결과는 아래)

1. `PROMPT_OPTIMIZER_BASE_URL`(로컬 `http://host.docker.internal:10100/v1`)이 `ai-jobs-worker` 컨테이너에서 닿는지(Linux는 compose가 `extra_hosts`를 준다). 로컬 OpenCodex 게이트웨이는 `Host` 헤더가 `localhost`·`127.0.0.1`·`[::1]`이 아니면 403(`origin_rejected`)이라 컨테이너가 `host.docker.internal`로 그냥 부르면 막힌다(첫 실행에서 확인, API 키로도 못 지난다). 그래서 AI가 그 이름일 때만 `Host: localhost:<포트>`로 바꿔 보낸다(`agent._headers`). 워커는 시작할 때 반성 모델에 짧은 확인 호출 1회를 해서, 닿지 않으면 OpenAI 호출 없이 trace ERROR `프롬프트 개선 모델 호출에 실패했어요.`로 끝난다(429·일시 오류는 SDK가 두 번까지 다시 시도한다).
2. 실제 호출 수·시간·금액(OpenAI 사용량)이 위 어림과 맞는지, `failedCalls`가 0에 가까운지.
3. 개선 폭이 0.05를 넘는지와 게이트 세트 Run이 통과하는지. 게이트 세트 평가는 24·46문항이라 같은 지시문도 Run마다 흔들린다([계약 한계](../design/operations-llmops-contract.md#ponytail-한계)).

## 첫 실행 결과 (#841, 2026-11-24)

로컬 실스택(Compose `storyfork-local`, develop 이미지 `3c17708f3`(자동 개선)·`f950bf953`(추출), Langfuse v4, 반성 `gpt-6-sol`(OpenCodex), 생성 `gpt-6.1-terra`·채점 `gpt-6-luna`)에서 `character_simulation.act` production(v2)과 `manuscript_extraction.extract` production(v1)을 처음 실제로 돌렸다.
접수는 AI 내부 API(`POST /internal/v1/optimizations`·`/evaluations`, `X-Internal-Token`)를 컨테이너 안에서 직접 불렀다(운영 화면·운영 API로 접수하는 경로는 쓰지 않았고, 운영 API는 결과 조회만 관리자 로그인으로 확인했다, 발견 4). 호출 수는 워커 로그의 `api.openai.com` 요청 수, 금액은 Langfuse generation 비용이다(채점 호출은 generation이 아니라 따로 어림했다, 발견 6).
이 실행은 아래 발견 1의 수정이 들어가기 전 이미지라, 워커 컨테이너 안에 `127.0.0.1:10100` → `host.docker.internal:10100` TCP 포워더를 띄우고 `PROMPT_OPTIMIZER_BASE_URL=http://127.0.0.1:10100/v1`로 워커를 다시 만들어 돌렸다(컨테이너를 다시 만들면 포워더가 사라진다).

### 자동 개선 1회(act, 상한 150)

| 항목 | 실측 |
|---|---|
| 결과 | `saved`: 새 버전 v5(라벨 없음, 기준 본문의 1.95배), val 0.6292 → 0.7042(+0.075), 게이트 회귀 평가 Run 통과 |
| 시간 | 555초(약 9분 15초). 반복 8회, 평가 호출 168회(상한 150을 반복 단위로 확인해 18회 넘음), 실패 0 |
| OpenAI 호출 | 384건 = 생성 168 + 채점 168 + 게이트 평가 24 + 24 (처음 어림 348) |
| 반성 호출 | 게이트웨이 9건(연결 확인 1 + 반성 8), 입력 39,090·출력 11,669 토큰, 실패·429 없음 |
| 금액 | 생성 $0.60(자동 개선 168건 $0.526 + 게이트 평가 24건 $0.079) + 채점 약 $0.05(192건 × $0.00026) = **약 0.65달러**. 반성은 구독 게이트웨이라 OpenAI 청구가 없다(Langfuse 정가 환산 $0.19) |

게이트 세트(`simulation.act` 24문항) 회귀 평가 Run은 항목 24개를 28~36초에 끝냈다(OpenAI 호출 48건, 생성 $0.06~0.08).

| 게이트 Run(act) | voice | intent | pov_ok | passed | 생성 입력 토큰(24건) |
|---|---|---|---|---|---|
| v2 기준 — 이번 실행에서 새로 돌린 Run | 0.4375 | 0.3958 | 0.9583 | 통과 | 48,314 |
| v2 기준 — 11-23 Run(참고) | 0.4583 | 0.4167 | 0.9167 | 통과 | |
| v4 — 진단 실행이 저장(val 0.6292 → 0.6792, +0.0500) | 0.4583 | 0.3646 | 0.9583 | 통과 | 56,522 |
| v5 — 위 본 실행이 저장(val +0.075) | 0.5104 | 0.4688 | 0.9583 | 통과 | 67,466 |

v5는 게이트에서도 voice·intent가 +0.073(1~5점으로 +0.29) 올랐고, v4는 val이 +0.05 올랐지만 게이트는 그대로였다(voice +0.02, intent −0.03). `passed`는 '기준보다 허용 오차(0.1) 넘게 나빠지지 않았다'일 뿐이라 둘 다 통과다.

### trace `prompt_optimization` 모양(본 실행)

- 요청 루트 관측 하나(이름·trace 이름 `prompt_optimization`, 태그 `feature:prompt_optimization`, level DEFAULT). metadata: 시작 때 `prompt`·`baseVersion`(2)·`maxMetricCalls`(150), 끝날 때 `seedScore` 0.6292·`bestScore` 0.7042·`totalCalls` 168·`failedCalls` 0·`outcome` `saved`·`savedVersion` 5·`evaluationRun` `character_simulation.act@v5-20261124T110012Z-15244e`·`status` `success`. 기준 Run이 이미 있어 `baselineRun`은 없었다. 저장하지 않은 경우는 상한 20 접수에서 `outcome=no_improvement`·`reason=개선 없음`(`seedScore`=`bestScore`)로 확인했다.
- 안쪽 generation 177개: `simulation.act`(terra) 168개와 `optimization.reflect`(`gpt-6-sol`, 모델·토큰만, 본문 없음) 9개(첫 번째가 연결 확인). 게이트 평가 Run의 항목 24개는 이 trace가 아니라 Run 자기 trace에 있다(항목 traceId가 최적화 trace와 모두 다르다). #851 이후 실행은 채점 호출 수만큼 `evaluation.rubric_grade` generation(채점 모델, 모델·토큰만)이 더해진다.
- 새 버전 `commitMessage`: `GEPA 자동 개선: 기준 v2, val 0.6292→0.7042, 평가 Run character_simulation.act@v5-20261124T110012Z-15244e`.

### 확인한 것과 발견

1. **게이트웨이 Host 거절(고침)**: 컨테이너에서 `host.docker.internal:10100`은 TCP는 닿지만 게이트웨이가 `Host` 헤더가 `localhost`·`127.0.0.1`·`[::1]`이 아니라며 403(`cross-origin data-plane request blocked`, `origin_rejected`)을 돌려준다. API 키(`Authorization`·`X-OpenCodex-API-Key`)를 줘도 같고 `Host: 127.0.0.1:10100`을 보내면 200이다. 문서·`.env.example`이 안내한 값이 그대로는 한 번도 동작하지 않던 것이다. 고침: `agent._headers`가 `host.docker.internal`일 때만 `Host: localhost:<포트>`를 보낸다(컨테이너 안에서 httpx·OpenAI SDK로 200 확인).
2. **`TypeError`로 끝난 첫 접수 2건(원인 미상, 로그만 고침)**: 처음 두 번의 접수(10:21·10:40, 상한 150)가 시드 val 평가 중 `simulation.act` generation 20건이 모두 `TypeError`로 끝나 18.5초·31.4초 만에 실패했다(OpenAI 호출 20건씩만 쓰고 새 버전 없음, trace ERROR). HTTP는 200이었고 응답을 처리하다 난 것이다. 같은 코드·같은 입력이 그 직후 별도 Celery 워커 프로세스(진단 잡 3건)와 단독 프로세스(5스레드 첫 호출 12회·해시 시드 10개)에서는 모두 정상이었고, 워커 컨테이너를 재시작하자 다시는 나지 않았다(재시작·재생성 뒤 접수 5건 정상). 환경 변수·`-A` 인자·동시성·프로세스 나이는 같게 맞춰 봐도 재현되지 않았고 문제의 프로세스를 지워 traceback을 못 잡았다. 로그에 클래스 이름(`TypeError`)만 남아 원인을 볼 수 없던 것이 문제라, `run_job`이 예기치 않은 예외의 클래스 이름과 난 곳(`폴더/파일:줄 함수`, 메시지·본문 없음)을 남기게 고쳤다. 다시 나면 그 줄로 시작한다(후속 #850: 지금은 난 곳 한 줄이 아니라 호출 경로 전체를 남기고, 절차는 [예기치 않게 끝났을 때 진단](#예기치-않게-끝났을-때-진단-850)에 있다).
3. **평가 스레드와 Langfuse SDK 정상**: 기준·회귀 평가가 별도 스레드에서 돌아도 SDK 예외 없이 Run·점수·`passed`가 남고 항목 span은 `prompt_optimization` trace에 붙지 않는다(위 trace 모양). 평가 Run 항목마다 `Propagated attribute 'experiment_item_metadata.judge.facts'(·`judge.scene`) value is over 200 characters. Dropping value.` 경고 두 줄이 워커 로그에 남는다(Langfuse SDK 4.18이 항목 metadata를 span 속성으로 퍼뜨리다 200자 넘는 값을 버린다). 점수·trace에는 영향이 없고 로그만 길어진다(`run_experiment`가 항목 metadata를 퍼뜨리는 평가 경로 공통 동작).
4. **문항별 결과(items) 응답 모양**: Langfuse Experiments items API는 항목 하나에 1행이다(act 게이트 Run 24행·24개 `experimentItemId`, 추출 Run 30행·30개). 행마다 `level`·`experimentItemId`·`scores`(배열, act 지표 3개·추출 2개)가 있고 행 키 10개·점수 키 11개가 운영 `EvaluationServiceTest`의 `experimentItem` 픽스처와 같아 운영 `items()` 매핑이 기대하는 모양이다. 운영 엔드포인트도 관리자 로그인으로 호출해 확인했다(`GET /llmops/evaluations/{runId}`): act v5 Run은 200·`completed`·`passed=true`·`items` 24개(`itemId` 24개 고유, 항목당 1행, 항목 오류 0, 문항 `failed` 11 — 지표 하나라도 0.5 미만인 문항이라 Run의 `passed`와는 별개), 추출 Run은 200·`completed`·`passed=true`·`items` 30개(고유 30, 항목 오류 0, `failed` 17)였다. 예: `{itemId: simulation.act-02, scores:{intent:0, pov_ok:1, voice:0.25}, failed:true}`.
5. **GEPA 표준 출력**: GEPA 0.1.4가 반복마다 반성 모델이 쓴 새 지시문 전체와 val 항목별 점수를 `print`해 워커 로그에 남긴다(반복당 수 KB). 지시문은 공개 평가 세트로 만든 것이라 위험은 작지만 '모델 응답을 로그에 남기지 않는다' 규칙과는 어긋난다(#852에서 고쳤다: 점수 줄만 워커 로그에 남기고 새 지시문·예외 메시지·스택 줄은 버리며 표준 출력에는 아무것도 찍지 않는다).
6. **채점 호출이 Langfuse에 안 남는다**: `rubric_grade`가 `AsyncOpenAI`를 직접 불러 generation이 아니라서 '추적'·비용에는 생성 호출만 보인다. 채점(`gpt-6-luna`)은 호출당 입력 약 2,060·출력 약 115 토큰이라 실제 비용은 화면보다 10% 안팎 크다(#851에서 채점 호출을 generation `evaluation.rubric_grade`로 남기게 고쳤다: 이후 실행부터 trace·비용 화면에 보인다). 또 Langfuse의 luna 단가는 입력 $0.10·출력 $0.50(/1M 토큰)이라 `simulation-v3.md`의 어림($0.20·$1.20)의 절반 안팎이다(terra는 $1.00·$5.00으로 같다). **어느 쪽이 맞는지는 확인하지 못해 문서도 Langfuse 정의도 바꾸지 않았다**: 문서의 어림은 `eval/novelbrain/cost.py`의 `gpt-5.6-luna` 공식 단가(입력 $0.20·출력 $1.20, 2026-11-14 확인)이고 `gpt-6-luna`의 OpenAI 공식 단가는 확인하지 못했다([시뮬레이션 평가 문서](simulation.md)의 '단가' 줄). Langfuse의 `gpt-6-luna` 정의($0.10·$0.50, 제3자 가격 사이트와 같다)도 공식 확인이 아니다. 공식 단가를 확인하면 한쪽을 맞춘다(문서, 또는 LLM Ops 「모델」 보기에서 정의 수정).
7. **val 잡음과 임계 0.05**: 같은 시드 지시문의 val 점수가 10번의 평가에서 0.608~0.658(평균 0.633, 표준편차 0.016)로 흔들렸다. 임계 0.05는 그 약 3배지만 후보 여럿 중 최고를 고르는 선택 편향이 있어, 진단 실행은 정확히 +0.0500(경계값 포함)으로 저장됐는데 게이트에서는 오르지 않았다. 후보 등록 전에 게이트 Run을 사람이 보는 현재 흐름이 이 편향의 방어선이다.
8. **저장된 지시문이 길다**: v4는 기준의 1.42배(2,104자), v5는 1.95배(2,885자, 상한 2배 2,958자에 거의 닿음)다. 호출마다 입력이 늘어 게이트 평가 생성 입력이 48,314 → 67,466 토큰(+40%, 호출당 약 +$0.0008)이 됐다. 길이 상한이 호출 단가 상승을 막지는 않는다.
9. **어림과 실측**: 시간은 20~45분 어림이 9~10분(항목 5개 동시, 호출당 약 3.5초), 호출 수는 348이 384(상한 초과 반복 18회), 금액은 '수 달러'가 약 0.65달러였다.

### 기본 상한 150에 대한 제안(결정은 사용자)

150을 유지하자는 제안이다. 근거: ① 150에서 전체 val 평가를 5번 받은 후보를 비교하고(시드 제외, 평가 호출 168회) 9~10분·약 0.65달러로 끝난다. ② 시드 val 잡음(표준편차 0.016)이 후보 사이의 차이(0.02~0.075)와 비슷해 상한을 키워도 '여럿 중 최고' 선택 편향만 커진다. ③ 상한 60에서는 후보 2개를 보고 시드와 0.017 차의 최고를 골라 개선을 판정하기에 모자란다. 배선 점검(접수·워커·게이트웨이·Langfuse)만 할 때는 상한 20이 쓸 만하다: 시드 val 한 번 평가(35초, 약 0.06달러)로 끝나 `no_improvement`가 남는다.

### 추출 기준 Run(`manuscript_extraction.extract` v1, 게이트 30회차)

`extraction.extract` 세트는 새 이미지로 `ai-eval-seed`를 한 번 돌려 30항목이 올라갔고(Langfuse에 처음 생김), production 기준 Run 한 번을 `POST /internal/v1/evaluations`로 돌렸다. 결과·해석은 [추출 평가 세트 8.6절](extraction-set.md#86-운영-기준-run-첫-실측-841-2026-11-24)에 있다: `recall` 0.4646·`quote_ok` 0.7987, 3분 38초, 생성 30호출 $0.089, 채점 모델 없음.

## 검증(단위, 모델·Langfuse·Postgres 대역)

```sh
cd backend/ai-service
uv run --locked --extra dev python -m pytest -m 'not integration' tests/optimization tests/jobs tests/evaluation
cd eval/simulation && python -m pytest -q test_orig_export.py   # 풀 내보내기(CI가 아니라 로컬)
```
