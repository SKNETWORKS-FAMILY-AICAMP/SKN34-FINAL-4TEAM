"""원문 기반 평가(orig_*)의 공용 경로·상수. 원문·정답표·세계관·문항·모델 응답은 모두 ORIG(.data, git 무시) 밖에 쓰지 않는다."""

import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
NB = HERE.parent / 'novelbrain'
for path in (NB, NB / 'ko_timechara'):   # eval/novelbrain(llm·cost·metrics…)과 kt_* 모듈을 어느 위치에서 실행해도 import할 수 있게
    if str(path) not in sys.path:
        sys.path.insert(0, str(path))

DATA = HERE / '.data'
ORIG = DATA / 'orig'          # 공개 세트(고전·근대·SCP)와 해리 포터 세트의 원문·정렬·문항·실행 기록
HP_DIR = DATA / 'hp'          # 해리 포터 번역본·world.json(sim_worlds.HP_DIR와 같다)
COST = DATA / 'cost-orig.jsonl'   # 이 작업의 OpenAI 장부(이전 .data/cost.jsonl과 따로 센다)
COST_ACT = DATA / 'cost-hemmingway.jsonl'   # act가 외부 제공사(Hemmingway)로 가는 실행의 장부: OpenAI 장부와 합치지 않고 단가는 orig_variants.RATES다
RESULTS = HERE / 'results'
LUNA = 'gpt-6-luna'   # 처음의 채점 모델(게이트웨이 이름, sim_via.MODEL과 같다). 이 채점의 기록은 runs, 응답 캐시는 cache-judge-ocx에 있고 --judge-model로만 쓴다
JUDGE = 'gpt-6.2-sol'   # 채점 기본 모델(사용자 지시 2026-11-22). 이 채점의 기록은 runs-gpt-6.2-sol, 응답 캐시는 cache-judge-gpt-6.2-sol이다
SEED = 651
K, CONTEXT_CHARS = 6, 1800    # 직전 원문 줄 수와 글자 수 상한
