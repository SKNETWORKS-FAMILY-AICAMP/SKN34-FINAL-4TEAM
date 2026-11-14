# NovelBrain 평가 (#58)

`app/novelbrain`의 단계(0 그래프 PPR → 1 +원고 벡터 → 2 +BM25 → 3 +인물 시점 필터)와 단독 방식(그래프만·벡터만·BM25만)이 실제로 얼마나 효과가 있는지 공개 데이터와 저장소 샘플로 잰다.
수치와 해석은 [평가 결과](../../../../docs/evaluation/novelbrain.md)에 있다. 알고리즘(`ppr`·`bm25_rank`·`rrf`·`filter_for_character`·`recall`)은 `app.novelbrain`을 그대로 import하며 여기서 다시 구현하지 않는다.

## 파일

| 파일 | 역할 |
|---|---|
| `metrics.py` | Recall@k·P@k·EM/F1·채점 응답 파싱·TimeChara 시공간 점수 결합·Wilson 구간(순수 함수) |
| `llm.py` | OpenAI 호출 장부(상한 3,000회, 호출 직전에 한 줄)·디스크 캐시·일시 오류 재시도(시도마다 장부에 남김) |
| `prepare.py` | 공개 원천 내려받기·표본 고정(`musique`·`narrativeqa`·`timechara`·`e5`) |
| `graph.py` | 문단 묶음에서 개체·트리플 추출(HippoRAG OpenIE 방식)·개체 병합 |
| `embed.py` | 운영 E5-small 인코더로 벡터 계산·kNN·`Excerpt.quote`(256자) 창 |
| `run.py` | MuSiQue·NarrativeQA의 단독·누적 검색 지표, MuSiQue 답 정확도 |
| `timechara.py`·`run_timechara.py` | TimeChara 시점 규칙·역할 프롬프트·세계관 구성, 생성·공개 기준 채점·짝 비교 |
| `ko.py`·`datasets/ko_sample.jsonl` | 저장소 샘플로 만든 한국어 인물 시점 질문 62개와 그 평가 |
| `report.py` | `results/*.json`을 문서용 표로 출력 |
| `results/*.json` | 집계 수치만(커밋). 질문별 순위·응답 원본은 `.data/runs`에 둔다 |

`.data/`(git 무시)에는 원문·번역·색인·모델 응답 원본·장부·캐시가 있다. **저장소에 커밋하지 않는다.**

## 재현

```sh
cd backend/ai-service
RUN='uv run --locked --extra dev --extra manuscript python eval/novelbrain'

# 1단계: 데이터(호출 없음). TimeChara는 HuggingFace 로그인·약관 동의가 필요하다(비상업 연구 한정, 토큰은 ~/.cache/huggingface/token).
$RUN/prepare.py e5 && $RUN/prepare.py musique && $RUN/prepare.py narrativeqa && $RUN/prepare.py timechara

# 그래프 추출(OpenAI 호출 약 220회, 결과는 .data/cache에 남아 재실행은 0회)
set -a; . /Users/yunseongho/orca/SKN34-FINAL-4TEAM/.env; set +a   # OPENAI_API_KEY·OPENAI_MODEL을 환경에만 올린다
$RUN/graph.py musique && $RUN/graph.py narrativeqa

# 2단계
$RUN/timechara.py embed                       # 소설 청크 18,568개 벡터(약 5분, 호출 없음)
$RUN/run.py retrieval musique && $RUN/run.py retrieval narrativeqa           # 호출 없음
$RUN/run.py answers musique gold none                                       # MuSiQue 답(약 700회)
$RUN/run_timechara.py contexts                                              # 호출 없음: 문맥의 미래·타인 기억 노출
$RUN/run_timechara.py run && $RUN/run_timechara.py paired                   # TimeChara(약 1,800회)
$RUN/ko.py generate && $RUN/ko.py run                                        # 한국어(생성 약 95회)
python3 eval/novelbrain/report.py                                           # 표
```

단위 테스트: `uv run --locked --extra dev python -m pytest eval/novelbrain -q` (numpy가 없는 환경에서는 kNN 테스트 1건만 건너뛴다).

## 규칙

- 실제 OpenAI 호출은 모두 `llm.py`를 거치고 장부(`.data/ledger.jsonl`)가 3,000회를 막는다. 재시도와 실패한 호출도 센다.
- 입력·원고·모델 응답·키는 오류 메시지와 로그에 넣지 않는다. 호출 실패·잘린 응답·파싱 실패는 점수를 꾸미지 않고 집계의 `failed`로 센다.
- 의존성 파일은 바꾸지 않았다. 일회성 도구가 필요하면 `uv run --with <패키지>`로만 쓴다.
