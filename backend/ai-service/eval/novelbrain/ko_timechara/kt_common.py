"""KoTimeChara 공용 경로·상수. 어느 위치에서 실행해도 `eval/novelbrain`의 모듈을 import할 수 있게 경로를 잡는다.

소설 원문·라벨·세계관·질문·모델 응답은 모두 `KT`(= `.data/ko_timechara`, git 무시) 밖에 쓰지 않는다. 저장소에는 집계 수치(`RESULTS`)만 둔다.
"""

import sys
from pathlib import Path

NB = Path(__file__).resolve().parents[1]
if str(NB) not in sys.path:
    sys.path.insert(0, str(NB))

from cost import LIMIT_USD  # noqa: E402
from prepare import DATA, SEED  # noqa: E402

KT = DATA / 'ko_timechara'
RESULTS = NB / 'results'
COST = DATA / 'cost.jsonl'   # 이번 작업의 모든 호출(KoTimeChara·TimeChara 600건·MuSiQue)이 하나의 비용 장부를 쓴다

__all__ = ['COST', 'DATA', 'KT', 'LIMIT_USD', 'NB', 'RESULTS', 'SEED']
