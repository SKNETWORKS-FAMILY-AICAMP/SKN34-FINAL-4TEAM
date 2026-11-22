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
RESULTS = HERE / 'results'
LUNA = 'gpt-6-luna'   # 지금까지의 채점 모델(게이트웨이 이름, sim_via.MODEL과 같다). 이 채점의 기록은 runs, 응답 캐시는 cache-judge-ocx에 있다
SEED = 651
K, CONTEXT_CHARS = 6, 1800    # 직전 원문 줄 수와 글자 수 상한
