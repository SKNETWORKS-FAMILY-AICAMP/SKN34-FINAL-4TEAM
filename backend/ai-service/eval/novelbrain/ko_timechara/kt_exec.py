"""KoTimeChara 실행 공용: 작품 읽기·Llm(금액 상한)·실행기. 호출 수 상한(Ledger)은 쓰지 않고 비용 장부의 금액 상한으로 막는다.

응답은 `KT/cache`에 캐시해 같은 요청은 다시 내지 않고, 제출한 배치는 `KT/batches`에 남아 중단 뒤에 이어 받는다.
"""

import json

import kt_common  # noqa: F401  경로 설정이 다른 import보다 먼저여야 한다(스크립트로 실행할 때 eval/novelbrain을 찾는다)
from batch import cost_report, plan_for  # noqa: F401  다른 kt_* 모듈이 여기서 가져간다
from batch import make_executor as _make_executor
from kt_common import COST, KT, LIMIT_USD
from llm import Llm, usd_llm


def load_works(ids=None) -> dict[str, dict]:
    works = {p.parent.name: json.loads(p.read_text()) for p in sorted((KT / 'works').glob('*/work.json'))}
    return {i: works[i] for i in ids} if ids else works


def make_llm(cache_dir=None, cost_path=None, limit_usd: float = LIMIT_USD) -> Llm:
    return usd_llm(cache_dir or KT / 'cache', cost_path or COST, limit_usd)


def make_executor(llm: Llm, mode: str):
    return _make_executor(llm, mode, KT / 'batches')
