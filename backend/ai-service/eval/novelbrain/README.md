# NovelBrain 평가 (#58)

`app/novelbrain`의 단계(0 그래프 PPR → 1 +원고 벡터 → 2 +BM25 → 3 +인물 시점 필터)와 단독 방식(그래프만·벡터만·BM25만)이 실제로 얼마나 효과가 있는지 공개 데이터와 저장소 샘플로 잰다.
수치와 해석은 [평가 결과](../../../../docs/evaluation/novelbrain.md)에 있다. 알고리즘(`ppr`·`bm25_rank`·`rrf`·`filter_for_character`·`recall`)은 `app.novelbrain`을 그대로 import하며 여기서 다시 구현하지 않는다.

## 파일

| 파일 | 역할 |
|---|---|
| `metrics.py` | Recall@k·P@k·EM/F1·채점 응답 파싱·TimeChara 시공간 점수 결합·Wilson 구간(순수 함수) |
| `llm.py` | OpenAI 호출 장부(첫 평가는 상한 3,000회, 호출 직전에 한 줄)·디스크 캐시·일시 오류 재시도(시도마다 장부에 남김). `usd_llm`은 호출 수 대신 비용 장부의 금액 상한으로 막는다 |
| `cost.py` | 비용 장부: 호출마다 토큰과 추정 금액(USD, 공식 단가·캐시 입력·Batch 절반·긴 입력 할증)을 `.data/cost.jsonl`에 남기고 합계·글자/토큰 비 실측 |
| `batch.py` | 라운드 실행기(`run_rounds`: 생성 → 채점 → 둘째 채점처럼 단계가 의존하는 평가를 `work(task, llm)` 하나로 푼다)와 동기·Batch API 실행기(제출 상태를 남겨 이어 받기, 실패 요청 재제출·부분 실패 표시), 예상 금액 출력 |
| `prepare.py` | 공개 원천 내려받기·표본 고정(`musique`·`narrativeqa`·`timechara`·`e5`) |
| `graph.py` | 문단 묶음에서 개체·트리플 추출(HippoRAG OpenIE 방식)·개체 병합 |
| `embed.py` | 운영 E5-small 인코더로 벡터 계산·kNN·`Excerpt.quote`(256자) 창 |
| `run.py` | MuSiQue·NarrativeQA의 단독·누적 검색 지표, MuSiQue 답 정확도 |
| `timechara.py`·`run_timechara.py` | TimeChara 시점 규칙·역할 프롬프트·세계관 구성, 생성·공개 기준 채점·짝 비교 |
| `ko.py`·`datasets/ko_sample.jsonl` | 저장소 샘플로 만든 한국어 인물 시점 질문 62개와 그 평가 |
| `ko_timechara/` | KoTimeChara: 한국어 장편 시점 평가 세트. 작품 고르기·회차 나누기(`kt_select`·`kt_text`), 정답표와 세계관을 서로 다른 호출로 추출(`kt_label`·`kt_world`·`kt_extract`), 질문 생성(`kt_questions`), 구성별 문맥·누설 지표(`kt_context`), 응답 생성·채점(`kt_run`), 데이터 구성 집계(`kt_report`). 원문·라벨·질문·응답은 `.data/ko_timechara`에만 둔다 |
| `report.py` | `results/*.json`을 문서용 표로 출력 |
| `results/*.json` | 집계 수치만(커밋). 질문별 순위·응답 원본은 `.data/runs`에 둔다 |

`.data/`(git 무시)에는 원문·번역·색인·모델 응답 원본·장부·캐시가 있다. **저장소에 커밋하지 않는다.**

## 재현

명령 전체는 [결과 문서 §8](../../../../docs/evaluation/novelbrain.md#8-재현)에 있다. TimeChara는 HuggingFace 로그인·약관 동의가 필요하다(비상업 연구 한정, 토큰은 `~/.cache/huggingface/token`).
단위 테스트: `cd backend/ai-service && uv run --locked --extra dev python -m pytest eval/novelbrain -q` (numpy가 없는 환경에서는 kNN 테스트 1건만 건너뛴다).

## 규칙

- 실제 OpenAI 호출은 모두 `llm.py`를 거친다. 첫 평가는 장부(`.data/ledger.jsonl`)가 3,000회를 막았고, KoTimeChara·TimeChara 600건·MuSiQue 다시 풀기는 비용 장부(`.data/cost.jsonl`)의 금액 상한(28달러, 이전 키 사용분은 `.data/cost-previous-key.jsonl`에 기록만)이 막는다. 재시도와 실패한(잘린) 호출도 센다. 큰 라운드는 Batch API(절반 가격)로 낼 수 있고 실행 전에 예상 금액을 출력한다.
- 평가 모델은 `cost.MODEL`(`gpt-5.6-luna`)로 고정한다. 메인 `.env`의 `OPENAI_MODEL`이 바뀌어도 `usd_llm`은 읽지 않는다(비교 가능성). 키는 `.env`에서만 읽는다.
- KoTimeChara 작품을 늘릴 때는 `kt_common.ROUNDS`(확대 차수별 누적 편수)에 새 차수를 더한다. 작품 id와 질문 임베딩 묶음이 차수를 따르므로 이미 만든 추출·질문·응답 캐시가 그대로 맞는다.
- 입력·원고·모델 응답·키는 오류 메시지와 로그에 넣지 않는다. 호출 실패·잘린 응답·파싱 실패는 점수를 꾸미지 않고 집계의 `failed`로 센다.
- 의존성 파일은 바꾸지 않았다. 일회성 도구가 필요하면 `uv run --with <패키지>`로만 쓴다.
