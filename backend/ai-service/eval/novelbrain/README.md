# NovelBrain 평가 (#58)

`app/novelbrain`의 단계(0 그래프 PPR → 1 +원고 벡터 → 2 +BM25 → 3 +인물 시점 필터)와 단독 방식(그래프만·벡터만·BM25만)이 실제로 얼마나 효과가 있는지 공개 데이터와 저장소 샘플로 잰다.
수치와 해석은 [평가 결과](../../../../docs/evaluation/novelbrain.md)에 있다. 알고리즘(`ppr`·`bm25_rank`·`rrf`·`filter_for_character`·`recall`)은 `app.novelbrain`을 그대로 import하며 여기서 다시 구현하지 않는다.

## 파일

| 파일 | 역할 |
|---|---|
| `metrics.py` | Recall@k·P@k·MRR@k·EM/F1·채점 응답 파싱·TimeChara 시공간 점수 결합·Wilson 구간(순수 함수) |
| `llm.py` | OpenAI 호출 장부(첫 평가는 상한 3,000회, 호출 직전에 한 줄)·디스크 캐시·일시 오류 재시도(시도마다 장부에 남김). `usd_llm`은 호출 수 대신 비용 장부의 금액 상한으로 막는다 |
| `cost.py` | 비용 장부: 호출마다 토큰과 추정 금액(USD, 공식 단가·캐시 입력·Batch 절반·긴 입력 할증)을 `.data/cost.jsonl`에 남기고 합계·글자/토큰 비 실측 |
| `batch.py` | 라운드 실행기(`run_rounds`: 생성 → 채점 → 둘째 채점처럼 단계가 의존하는 평가를 `work(task, llm)` 하나로 푼다)와 동기·Batch API 실행기(제출 상태를 남겨 이어 받기, 실패 요청 재제출·부분 실패 표시), 예상 금액 출력 |
| `prepare.py` | 공개 원천 내려받기·표본 고정(`musique`·`narrativeqa`·`timechara`·`e5`) |
| `graph.py` | 문단 묶음에서 개체·트리플 추출(HippoRAG OpenIE 방식)·개체 병합 |
| `embed.py` | 운영 E5-small 인코더로 벡터 계산·kNN·`Excerpt.quote`(256자) 창 |
| `run.py` | MuSiQue·NarrativeQA의 단독·누적 검색 지표, MuSiQue 답 정확도 |
| `timechara.py`·`run_timechara.py` | TimeChara 시점 규칙·역할 프롬프트·세계관 구성, 생성·공개 기준 채점·짝 비교, 저장된 응답을 게이트웨이 채점기로 채점만 다시(`rejudge`) |
| `ko.py`·`datasets/ko_sample.jsonl` | 저장소 샘플로 만든 한국어 인물 시점 질문 62개와 그 평가(Recall·P·MRR·누설). `ko.py snapshot`은 `recall` 입력(E5 상위 발췌 포함)을 `tests/retrieval_eval/fixtures`에 고정해 CI 단위 테스트가 모델 없이 임계값을 지키게 한다([검색 품질 평가](../../../../docs/evaluation/retrieval.md)) |
| `ko_timechara/` | KoTimeChara: 한국어 장편 시점 평가 세트. 작품 고르기·회차 나누기(`kt_select`·`kt_text`), 정답표와 세계관을 서로 다른 호출로 추출(`kt_label`·`kt_world`·`kt_extract`), 질문 생성(`kt_questions`), 구성별 문맥·누설 지표(`kt_context`), 응답 생성·채점·다시 채점(`kt_run`, 응답 모델과 채점 모델을 나눈 교차 모델 평가는 `kt_exec`의 단가표·게이트웨이 Llm), 데이터 구성 집계(`kt_report`), 정답표만으로 만드는 시간 쌍·자리 쌍과 코드 채점(`kt_pairs`, 채점 모델 없음), 비용 대비 시공간 점수 그래프(`kt_plot`, matplotlib는 `uv run --with`로만), 전처리 시제품(`kt_world2`)·서비스 전처리 기준선(`kt_world_svc`)·전처리 평가(`kt_linkeval`)([아래](#전처리-시제품v2연결-평가)). 원문·라벨·질문·응답은 `.data/ko_timechara`에만 둔다 |
| `report.py` | `results/*.json`을 문서용 표로 출력 |
| `results/*.json` | 집계 수치만(커밋). 질문별 순위·응답 원본은 `.data/runs`에 둔다 |

`.data/`(git 무시)에는 원문·번역·색인·모델 응답 원본·장부·캐시가 있다. **저장소에 커밋하지 않는다.**

## 재현

명령 전체는 [결과 문서 §8](../../../../docs/evaluation/novelbrain.md#8-재현)에 있다. TimeChara는 HuggingFace 로그인·약관 동의가 필요하다(비상업 연구 한정, 토큰은 `~/.cache/huggingface/token`).
단위 테스트: `cd backend/ai-service && uv run --locked --extra dev python -m pytest eval/novelbrain -q` (numpy가 없는 환경에서는 numpy가 필요한 4건(kNN·벡터 캐시·KoTimeChara 문맥 둘)만 건너뛴다). 이 디렉터리의 테스트는 CI가 돌지 않는다. CI가 지키는 검색 임계값 테스트는 `tests/retrieval_eval`(`python -m pytest -m 'not integration' tests/retrieval_eval`)다.

## KoTimeChara 교차 모델 평가 (응답 모델과 채점 모델 분리)

응답 모델은 로컬 OpenCodex 게이트웨이(127.0.0.1:10100, 구독 경로)의 다른 회사 모델로 바꾸고, 채점은 게이트웨이 `gpt-6.2-sol` 하나로 고정해 견준다(채점 금액 0, OpenAI 키를 읽지 않는다).
결과는 `--name`으로 따로 쌓아 기존 `rows.json`·`cost.jsonl`·`results/ko-timechara.json`은 덮지 않는다(`--gen-model`·`--judge-model`·`--limit`·`--no-personality`는 `--name`이 필수).

```sh
cd backend/ai-service
curl -s http://127.0.0.1:10100/v1/models                 # 게이트웨이의 모델 id 확인(목록의 Gemini id는 openrouter/google/gemini-3.8-flash:batch 꼴이지만 :batch는 동기 호출이 안 된다: 아래)
# 파일럿: 유형 비율대로 200문항, 응답은 Gemini·채점은 sol. 응답 장부 상한(--limit-usd)이 필수이고 단가표(kt_exec.GEN_RATES) 밖의 모델은 호출 전에 멈춘다
uv run --locked --extra dev --extra manuscript python eval/novelbrain/ko_timechara/kt_run.py run --gen-model=openrouter/google/gemini-3.8-flash --gen-effort=low --name=gemini-flash-pilot --limit-usd=5 --limit=200 --configs=zero,s3
# 저장된 응답(기본 rows.json의 luna 응답)을 같은 sol로 채점만 다시: 기준선. 응답이 없는(실패) 기록은 실패로 둔다
uv run --locked --extra dev --extra manuscript python eval/novelbrain/ko_timechara/kt_run.py rejudge --name=luna-sol --limit=200 --configs=zero,s3 [--from=rows-x.json] [--no-personality]
# 집계(호출 없음) → results/ko-timechara-<name>.json (기록에 없는 구성이 낀 짝은 건너뛴다)
uv run --locked --extra dev --extra manuscript python eval/novelbrain/ko_timechara/kt_run.py report --name=gemini-flash-pilot
```

파일은 `.data/ko_timechara`에 쌓인다: `runs/rows-<name>.json`(기록마다 `gen_model`·`gen_via`·`judge_model`·`judge_via`), `cost-<name>.jsonl`(응답은 단가표 금액, 채점은 0·via ocx), 응답 캐시 `cache-<name>`, 채점 캐시 `cache-judge-<채점 모델>`(응답 모델이 달라도 같은 응답·프롬프트의 채점은 다시 부르지 않는다).
게이트웨이 경로는 동기 실행만 된다(`--mode=batch` 불가).
`:batch` 경로는 동기 실행 불가다: `openrouter/google/…:batch` id는 게이트웨이에서 chat/completions로 부를 수 없어 404(전 건 실패)이므로 Gemini는 `:batch`가 없는 `openrouter/google/gemini-3.8-flash`로 부른다.
`--gen-effort=minimal|low|medium|high|xhigh|max`(`--gen-model`과 함께)는 응답 호출에만 Responses의 `reasoning.effort`로 보낸다. 게이트웨이의 Gemini는 기본값에서 생각 토큰이 호출당 평균 1,663 출력 토큰(최대 2,996, `max_output_tokens` 3,000에서 16/141 잘림)이고 `low`면 생각 0·출력 약 100토큰이다. 강도는 응답 캐시 열쇠와 기록·집계의 `gen_model`(`<id>@low`)에 들어가 강도가 다른 응답을 재사용하지 않고, 채점 요청과 옵션 없는 실행의 요청·캐시 열쇠는 그대로다.
`gpt-6-luna`·`gpt-6.1-terra`도 `--gen-model`로 쓸 수 있다(강도 low~max). 게이트웨이 구독 경로라 **실제 지출은 0**이고 장부 금액은 OpenAI 공식 가격(2026-11-25 확인, 100만 토큰당 입력/출력 luna 0.05/0.25·terra 0.50/2.50달러)으로 환산한 값이다. `--limit-usd`도 이 환산 금액에 걸린다.

비용 대비 시공간 점수 그래프(`kt_plot.py`, 호출 없음): 묶음 `<표시 이름>=<run name>[,<run name>…]` 하나가 선 하나이고 run은 적은 순서(강도 순)대로 잇는다. matplotlib는 의존성이 아니라 `uv run --with`로만 쓴다.

```sh
uv run --locked --extra dev --with matplotlib python eval/novelbrain/ko_timechara/kt_plot.py 'gpt-6-luna=luna-low,luna-medium,luna-high,luna-xhigh,luna-max' 'gpt-6.1-terra=terra-low,terra-medium,terra-high,terra-xhigh,terra-max' 'gemini-3.8-flash=gemini-flash-low' --out=.data/ko_timechara/plots/cost-score.png
```

run마다 `rows-<name>.json`의 구성 s3·zero 시공간(가중) 점수와 `cost-<name>.jsonl`의 gen 행 환산 금액 합계 ÷ 질문 수(문항당 비용, 구성 zero·s3의 응답을 합친 값)를 읽어 x=문항당 비용(로그 눈금)·y=s3 점수(%)로 그리고, 같은 색 점선이 zero 점수다. 점의 강도 라벨은 기록의 `gen_model`(`<id>@<강도>`)에서 읽는다(없으면 '기본'). 응답 비용이 없는 run(다시 채점한 기준선 등)은 로그 눈금에 못 그려 건너뛴다(표에는 남는다). 표는 PNG 옆에 같은 이름의 .json으로 쓴다.

## TimeChara 다시 채점·KoTimeChara 시점 쌍 정확도

**TimeChara 다시 채점**(`run_timechara.py rejudge`): 저장된 luna 응답(`.data/runs/timechara-rows.json`, 600문항 × 7구성)을 다시 만들지 않고 게이트웨이 `gpt-6.2-sol`(구독 경로, 금액 0)로 채점만 다시 한다(`kt_run.py rejudge`와 같은 방식).
결과는 `.data/runs/timechara-rows-<name>.json`·`results/timechara-<name>.json`(기록·집계에 `gen_model`·`judge_model` 표기, 기록에 있는 구성끼리만 짝 비교)에 따로 쓰고 기존 `timechara-rows.json`·`results/timechara.json`은 덮지 않는다.
채점 캐시는 `.data/timechara-cache-judge-<모델>`, 장부는 `.data/cost-timechara-<name>.jsonl`이라 KoTimeChara와 섞이지 않는다. `--limit`은 유형 비율을 지키며 고정 시드로 N문항(파일럿)이다.

```sh
cd backend/ai-service
uv run --locked --extra dev --extra manuscript python eval/novelbrain/run_timechara.py rejudge --name=luna-sol [--configs=zero,s2,s3] [--judge-model=gpt-6.2-sol] [--limit=8] [--no-personality]
```

**시점 쌍 정확도**(`ko_timechara/kt_pairs.py`, 채점 모델 없음): 정답표(지식표)만 읽어 같은 사건 e에 대한 두 문항을 한 쌍으로 만든다. 시간 쌍은 같은 인물·다른 기준 회차(사건 전 1~6회 → 정답 unknown, 사건 후 0~3회 → direct), 자리 쌍은 같은 기준 회차(사건 후 0~3회)·다른 인물
(참여·목격한 인물 → direct, 참여·목격하지 않았고 전해 듣지도 않았으며 사건 회차까지 이미 등장한 인물 → unknown, `kt_questions`의 past-absence 규칙 그대로)이다. 작품당 시간 쌍·자리 쌍 각 16개(문항 64개), 선택지는 direct·hearsay·unknown을 문항마다 고정 시드로 섞는다(hearsay는 늘 오답).
쌍 정확도는 두 문항이 모두 정답인 쌍의 비율이다(늘 '모른다'로 답하는 응답은 문항 정확도 50%여도 쌍 정확도 0%). 응답은 구조화 출력(선택지 번호)이고 스키마에 안 맞거나 잘린 응답은 실패로 따로 센다. 문맥·시스템 프롬프트는 `kt_run`과 같다.

```sh
uv run --locked --extra dev --extra manuscript python eval/novelbrain/ko_timechara/kt_pairs.py build                                 # 호출 없음: .data/ko_timechara/pairs.jsonl·pairs_stats.json
uv run --locked --extra dev --extra manuscript python eval/novelbrain/ko_timechara/kt_pairs.py run --gen-model=gpt-6-luna --gen-effort=low --name=pairs-luna --limit-usd=3 [--configs=zero,s2,s3,no_vector,link_bm25,link_ppr,link2_bm25] [--limit=8]   # --limit은 쌍 N개
uv run --locked --extra dev --extra manuscript python eval/novelbrain/ko_timechara/kt_pairs.py report --name=pairs-luna             # 호출 없음: results/ko_timechara-pairs-<name>.json
```

`run`은 `.data/ko_timechara/runs/pairs-rows-<name>.json`을 쓰고 응답 캐시(`cache-<name>`)·장부(`cost-<name>.jsonl`)는 이름별로 나뉜다(`kt_run`의 --name과 겹치지 않게 준다). 집계는 구성별 문항·쌍 정확도(Wilson 95% 구간·실패 수), 쌍 종류(시간·자리)·side·웹소설/고전별, 고른 키 분포, 문맥 누설 지표(`future`·`foreign`·`unseen`과 같은 회차 사건 노출 `asked_ep`),
문맥 항목 종류 분포(인물 본문·회차 기억·사건 카드·관계·원고 발췌)·평균 항목 수, 구성 사이 쌍 단위 정확 부호 검정(`s3|zero`·`s3|s2`에 더해 나머지 구성 각각 대 zero·대 s3)이다.

**벡터(원고 발췌) 없는 구성**(`--configs`, 같은 `--name`에 구성을 더해 다시 돌리면 문맥이 같은 응답은 캐시에서 읽힌다): `no_vector`(그래프 PPR + 카드 BM25를 RRF로 합쳐 필터),
`link_bm25`(카드 BM25 순위에 필터만 = 인물 본인 문서와 직접 연결된 카드 안에서 질문 낱말로 고르기), `link_ppr`(그래프 순위에 필터만),
`link2_bm25`(`link_bm25`가 허용하는 것 + 기준 회차 스냅샷에서 인물로부터 관계 2홉 안의(부정 관계 제외) 인물이 아닌 카드 중 공개 회차가 지난 것, 순위는 카드 BM25.
다른 인물의 카드·기억 문서는 넓히지 않고 서비스 필터는 바꾸지 않는다), `link_cells`(`link_bm25` + 인물이 아닌 카드의 회차 칸(⑦이 쓴 작가용 설명)을 후보에 더한 BM25: 그 인물과 이어진 사건에 그 카드가 '관련'으로 걸려 있고 칸의 회차가 질문 시점 이하인 칸만 — 서비스는 비인물 카드 회차 칸을 읽지 않아 평가 코드에서만 흉내 낸다),
`link_known`(`link_cells` 중 칸의 문장마다 근거 인용이 그 인물이 이어진 사건의 인용과 겹치는 문장만; 칸에는 인물이 모를 사건의 문장도 섞여 `link_cells`는 모르는 쪽이 새므로 그 문장을 뺀다). `kt_run`의 기본 구성(`kt_context.CONFIGS` 10개)은 그대로다.
`asked_ep`는 문맥에 물어본 사건과 같은 회차의 사건 카드나 원고 발췌가 든 비율이다(`unseen`이 원고 발췌만 봐서 놓치는 카드 쪽 노출을 보완하는 거친 지표, 같은 회차의 다른 사건도 센다).

## 전처리 시제품(v2)·연결 평가

사용자와 정한 방향: 인물 기억은 설정집(카드·관계·인물 문서)만 쓰고(원고 벡터 검색·두 다리 확장 없음), 그래서 품질은 전처리가 만드는 **연결**이 정한다. 아래는 서비스 전처리(`app/manuscript_extraction`)를 바꾸지 않는 **평가 폴더 안의 실험**이다.

- `ko_timechara/kt_world2.py`(시제품): 회차 원문만 읽는다(정답표·기존 세계관은 읽지 않는다). 회차마다 ① 인물 뽑기 → (③ 사건 정리: 행동·대화 하나가 한 사건, `@이름`·대상 7종·인물 역할 experienced/heard/mentioned ∥ ② 인물 문서: 인물 목록의 모두에게 인물마다, 정체·성격·말투·목표·행적(그 회차에서 한 일·겪은 일),
  말투 대사는 원문 대조, '밝혀지지 않는다'류 문장은 뺌) → (④ 인물 사이 관계 + ④' 사건의 자리: 누가 그 자리에 있었나·소식을 들었나, 이름이 사건 인용 300자 안에 있을 때만 '그 자리에 있던' 인물을 더함).
  작품마다 한 패스로 ⑤ 합치기(같은 카드: 종류·이름·호칭 변형은 서비스 `_base` 규칙으로 코드가 합치고, 이름이 다른 같은 인물·동명이인은 모델 호출 한 번이 코드가 고른 후보 쌍과 증거 문장을 보고 확정·거부만 한다(인용이 입력 인용 중 하나여야 받지만 이름 포함을 코드가 확인한 호칭 변형의 same은 인용이 틀려도 받는다). 같은 사건에 함께 나오거나 관계가 있는 두 인물은 모델이 같다고 해도 합치지 않는다.
  숨겨진 정체는 카드를 따로 두고 「동일 인물」 관계를 밝혀진 회차부터, DEC-53 저장 규칙대로 가면 하나에 본체 하나·사슬·순환 없음)와 ⑥ 뒤 회차 들음(회차마다 앞 회차 사건 목록 + 이 회차 본문, 앞 사건을 처음 전해 듣는 인물에게 그 회차에 「들음」을 잇는다). 모델 출력은 모두 원문으로 다시 확인하고 어긋난 항목의 코드별 건수를 남긴다.
  `겪음`·`들음` 관계는 사건 회차(뒤 회차 들음은 듣는 회차)로 기록하고 이름만 나온 인물(mentioned)은 잇지 않는다. SOUL·GOAL은 회차 없이 따로 두지 않고 인물 카드의 `episodes[n]`(인물 문서·행적 + 그 회차에 겪은·들은 사건)에 둔다.
  `--step-llm 'kind=모델[@강도]'`로 단계(chars·doc·events·presence·rels·learn·merge)마다 모델·추론 강도를 달리할 수 있다(강도가 높으면 출력 한도를 배수로 늘린다). 들음은 luna@high가 low보다 정확하다.
  마지막으로 ⑦ 카드 다듬기(`--no-refine`으로 끈다): 원문을 보고 모든 카드의 회차 칸을 채운다. 인물이 아닌 카드(장소·조직·능력·사물·규칙·이름 붙은 사건)는 코드가 회차마다 원문에서 카드 이름(합쳐진 호칭 포함)이 글자 그대로 나온 문장과 앞뒤 한 문장(회차당 10곳)과 그 카드가 @로 나온 사건의 인용을 모아 카드 단위로 모델에 준다(카드끼리 병렬, 입력이 길면 회차 묶음으로 나눈다).
  모델은 모은 문장만 보고 본문(처음 나온 회차 문장만으로 쓴 '무엇인가' 1~2문장)과 회차 칸(`episodes[n]`, 그 회차 문장으로 쓴 설명 3~6문장, 인물 이름·사건을 써도 되는 작가용)을 쓰고 문장마다 근거 인용을 준다 — 그 회차에 모아 보여 준 원문 안에 글자 그대로 있는 문장만 받고, 본문에서 인물 이름·글에 대한 말·과거 동작 끝맺음·처음 회차 사건 글과 4자 이상 겹치는 문장은 처음 회차 칸으로 옮기며, 앞 문장을 되풀이하는 칸 문장은 버린다.
  NovelBrain 필터는 장소·조직·능력·규칙 카드 본문을 모든 인물에게 보여 주고 비인물 카드의 회차 칸은 보여 주지 않는다(서비스 변환·색인도 인물 카드의 회차 문서만 읽는다) — 본문 누설은 분류가 아니라 칸으로 막는다. 사건 카드는 부르지 않고 인물 카드의 회차 칸·IDENTITY도 건드리지 않는다.
  대신 작가용 종합 소개(`world['summary']`, 필터·스냅샷이 읽지 않는다): 병합 인물 또는 전체 3,000자를 넘는 인물의 회차 칸들로 5~8문장, 문장마다 근거 회차 번호가 실제 칸인지만 확인한다. 직전 판의 인물 경로(병합 인물 IDENTITY 다시 쓰기·긴 회차 칸 줄이기)는 `--tighten`일 때만 켠다(알아야 하는 쪽 점수를 깎아 끈다).
  호출 종류는 `refine_card`·`refine_summary`·`refine_identity`·`refine_section`이다.
- `ko_timechara/kt_world_svc.py`(서비스 기준선): 지금 서비스의 `extract → resolve → organize`를 서비스 코드 수정 없이 같은 작품에 돌려(기존 `eval/simulation/pipe_build`가 `agent.ChatOpenAI`를 로컬 게이트웨이 gpt-6-luna로 바꿔 끼움, Langfuse 키는 지운다) `LoadPayload`를 세계관 모양으로 바꾼다(사건 카드는 인물과 관계가 없다).
- `ko_timechara/kt_linkeval.py`(전처리 평가, 호출 없음): 세계관 셋(`world.json`·`world2.json`·`world_svc.json`)을 정답표와 같은 잣대로 잰다. 사건 짝짓기(인용이 정답표 근거 문장과 겹침 / 인용이 없으면 요약 2-gram + 참여 인물 겹침의 보조 규칙)·사건 재현율·겪음 정확도와 재현율·들음·인물 병합(쪼개짐·섞임)·
  인물 기준 지식 정확도를 Wilson 95% 구간과 함께 `results/ko-timechara-linkeval-<name>.json`(집계만)에 쓴다. 정답표 인물도 호칭 변형 규칙으로 한 인물씩 묶어 잰다(정답표의 `철수`·`철수야`처럼 갈라진 인물을 올바르게 합친 카드가 섞임으로 읽히지 않게). 지식 F1(2tp/(2tp+fp+fn), 정밀·재현의 조화평균)이 주 지표이고, 인물 회차 기억의 사건이 아닌 서술도 같은 회차 정답 사건과 `text` 규칙으로 맞으면 안다고 세는 '넓힌' 판정(`…_wide`, 세 세계관 모두)과 들음의 '같은 회차에 들음'·'뒤 회차에 들음' 분리를 함께 낸다.
  `--worlds`는 `world`·`world2`·`world_svc`나 자가 개선 판 `sv-<이름>`이다. 규칙·한계는 모듈 설명.

```sh
cd backend/ai-service
uv run --locked --extra dev --extra manuscript python eval/novelbrain/ko_timechara/kt_world2.py run --gen-model=gpt-6-luna --gen-effort=low --step-llm=learn=gpt-6-luna@high --name=sv-final --limit-usd=5 w01 w13 w25 w41 c01   # .data/ko_timechara/works/<id>/sv-final.json·sv-final_stats.json·sv-final/(회차별 기록·merge.json·learned.json). 세계관 파일 이름은 world로 시작하거나 sv-<이름>
uv run --locked --extra dev --extra manuscript python eval/novelbrain/ko_timechara/kt_world2.py refine --from=sv-final --gen-model=gpt-6-luna --gen-effort=low --name=sv-final-refined --limit-usd=5 w01 w13 w25 w41 c01   # 앞 단계 결과 위에서 ⑦ 다듬기만 새로 부른다(--no-refine이면 호출 없이 같은 기록으로 기본 세계관만 다시 조립 = 전후 비교의 전)
uv run --locked --extra dev --extra manuscript python eval/novelbrain/ko_timechara/kt_world_svc.py run --workers=6 w01 w13 w25 w41 c01                                   # world_svc.json(서비스 전처리 기준선)
uv run --locked --extra dev --extra manuscript python eval/novelbrain/ko_timechara/kt_linkeval.py --name=w5 w01 w13 w25 w41 c01                                          # 호출 없음
# 같은 시점 쌍 문항을 다른 전처리 결과로: 문항의 인물은 정답표 이름이라 그 세계관의 카드에 이름으로 잇는다(카드가 없으면 문맥이 빈다)
uv run --locked --extra dev --extra manuscript python eval/novelbrain/ko_timechara/kt_pairs.py run --world=world2 --works=w01,w13,w25,w41,c01 --configs=zero,link_bm25,link_ppr,no_vector --gen-model=gpt-6-luna --gen-effort=low --name=pairs-w2 --limit-usd=5
```

`kt_world2.py`의 `--name`은 응답 캐시(`cache-<name>`)·장부(`cost-<name>.jsonl`)·세계관 파일 이름(`works/<id>/<name>.json`)을 정하고 기존 `world.json`·`knowledge.jsonl`과 겹치는 이름(`world`·`world_svc`·`work`·`knowledge`·`vectors`)은 막는다.

## 규칙

- 실제 OpenAI 호출은 모두 `llm.py`를 거친다. 첫 평가는 장부(`.data/ledger.jsonl`)가 3,000회를 막았고, KoTimeChara·TimeChara 600건·MuSiQue 다시 풀기는 비용 장부(`.data/cost.jsonl`)의 금액 상한(28달러, 이전 키 사용분은 `.data/cost-previous-key.jsonl`에 기록만)이 막는다. 재시도와 실패한(잘린) 호출도 센다. 큰 라운드는 Batch API(절반 가격)로 낼 수 있고 실행 전에 예상 금액을 출력한다.
- 교차 모델 평가의 게이트웨이 호출도 `llm.py`를 거친다: 응답 `Llm`에 채점 `Llm`(`judge=`)을 붙여 'judge' 호출만 채점 모델·채점 캐시로 보내고(`Llm.for_kind`를 `Planner`·`SyncExecutor`가 요청마다 부른다), 응답 장부는 `GEN_RATES` 단가(캐시 입력 할인 없이 입력 전부를 입력 단가로 세는 상한 쪽 어림)로 센다. `GEN_RATES`는 `:batch`가 붙은 정확한 이름의 행(`gemini-3.8-flash:batch` 0.375/1.875 등)을 먼저 찾고, 없으면 꼬리를 뗀 이름의 행을 쓴다(`:batch` id는 동기 호출이 안 된다). 상한이 있는 `Llm`은 응답에 사용량(usage)이 없으면 금액을 셀 수 없어 그 자리에서 멈춘다.
- 평가 모델은 `cost.MODEL`(`gpt-5.6-luna`)로 고정한다. 메인 `.env`의 `OPENAI_MODEL`이 바뀌어도 `usd_llm`은 읽지 않는다(비교 가능성). 키는 `.env`에서만 읽는다.
- KoTimeChara 작품을 늘릴 때는 `kt_common.ROUNDS`(확대 차수별 누적 편수)에 새 차수를 더한다. 작품 id와 질문 임베딩 묶음이 차수를 따르므로 이미 만든 추출·질문·응답 캐시가 그대로 맞는다.
- 저장된 산출물은 다른 실행이 조용히 덮거나 섞지 않는다. 벡터 캐시(`vectors*.npy`)는 본문 목록(순서)·접두어 종류의 지문(`.sha256`)이 같을 때만 읽고 지문이 없는 옛 캐시는 다시 계산한다. `kt_questions.py <작품 id>`는 고른 작품의 질문·성격만 바꿔 병합하고(통계·검수 표본은 전체 실행에서만 갱신), `kt_run.py --works`는 질문 임베딩 묶음을 전체 질문으로 정해 전체 실행과 같은 문맥·요청을 낸다. `ko.py generate`는 종류 하나라도 질문이 없으면 기존 질문 파일을 지키고 멈추며, `run.py answers`는 모델·문항(지문)·k가 같은 이전 구성(gold·none 등)만 이어 붙인다. 전해 들은 인물 추출이 실패한 회차는 지식표에 `learn_failed`로 남아 그 구간의 past-absence 질문을 만들지 않는다.
- 입력·원고·모델 응답·키는 오류 메시지와 로그에 넣지 않는다. 호출 실패·잘린 응답·파싱 실패는 점수를 꾸미지 않고 집계의 `failed`로 센다.
- 의존성 파일은 바꾸지 않았다. 일회성 도구가 필요하면 `uv run --with <패키지>`로만 쓴다.
