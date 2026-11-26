"""KoTimeChara 실행 공용: 작품 읽기·Llm(금액 상한)·실행기. 호출 수 상한(Ledger)은 쓰지 않고 비용 장부의 금액 상한으로 막는다.

응답은 `KT/cache`에 캐시해 같은 요청은 다시 내지 않고, 제출한 배치는 `KT/batches`에 남아 중단 뒤에 이어 받는다.
응답 모델과 채점 모델은 나눌 수 있다: 응답은 `make_gen_llm`(로컬 OpenCodex 게이트웨이의 다른 회사 모델, 단가표 `GEN_RATES`로 장부에 센다),
채점은 `make_judge_llm`(게이트웨이 `JUDGE_MODEL`, 금액 0)이 맡고 `llm.judge`로 붙인다. 게이트웨이 경로는 동기 실행만 지원한다.
"""

import json
import math
from types import SimpleNamespace

import kt_common  # noqa: F401  경로 설정이 다른 import보다 먼저여야 한다(스크립트로 실행할 때 eval/novelbrain을 찾는다)
from batch import make_executor as _make_executor
from cost import CostLog
from kt_common import COST, KT, LIMIT_USD
from llm import Ledger, Llm, usd_llm

JUDGE_MODEL = 'gpt-6.2-sol'   # 채점 모델(사용자 결정 2026-11-25): 로컬 OpenCodex 게이트웨이(구독 경로, 금액 0)의 이 하나로 고정한다. 응답 모델이 달라도 같은 채점기로 견준다
# 응답 모델의 단가(달러/100만 토큰, 입력·출력). 캐시 입력 할인은 세지 않고 입력 전부를 입력 단가로 센다(상한 쪽으로 어림).
# 게이트웨이에서 동기로 부르는 Gemini id는 `openrouter/google/gemini-3.8-flash`(꼬리 없는 행, OpenRouter 일반 경로 단가)다. `:batch` 행은 OpenRouter 목록 단가(조율자 확인 2026-11-25)지만
# 그 id는 게이트웨이에서 chat/completions로 못 불러 404(전 건 실패)라 동기 실행이 안 된다.
# `gpt-6-luna`·`gpt-6.1-terra`는 게이트웨이 구독 경로라 실제 지출은 0이고, 장부 금액은 OpenAI 공식 가격(2026-11-25 확인)으로 환산한 값이다(--limit-usd도 환산 금액에 걸린다).
GEN_RATES = {
    'gemini-3.8-flash': (0.825, 4.125),
    'gemini-3.8-flash:batch': (0.375, 1.875),
    'gemini-4-argon': (2.00, 10.00),   # 2026-11-30까지의 단가. 2026-12-01부터는 4.00/20.00이라 그 뒤에 쓰면 이 줄을 고친다
    'gemini-4-argon:batch': (1.00, 5.00),   # 2026-12-01 이후의 :batch 단가는 확인하지 못했다
    'claude-haiku-5-5': (0.10, 0.50),
    'claude-sonnet-5-5': (2.00, 10.00),
    'gpt-6-luna': (0.05, 0.25),
    'gpt-6.1-terra': (0.50, 2.50),
    'gpt-6.2-sol': (5.00, 25.00),   # 단가 미확인(구독 경로라 실제 지출 0): terra의 10배로 가정한 보수적 값이다. 공식 단가를 확인하면 이 줄을 고친다
}
# 응답(gen) 호출의 reasoning.effort. 게이트웨이의 Gemini는 기본값에서 생각 토큰이 호출당 평균 1,663 출력 토큰(3,000 한도에서 16/141 잘림)이고 low면 생각 0·출력 약 100토큰이다(조율자 실측).
EFFORTS = ('minimal', 'low', 'medium', 'high', 'xhigh', 'max')   # gpt-6-luna·gpt-6.1-terra는 low~max 다섯 가지를 받는다


def load_works(ids=None) -> dict[str, dict]:
    works = {p.parent.name: json.loads(p.read_text()) for p in sorted((KT / 'works').glob('*/work.json'))}
    return {i: works[i] for i in ids} if ids else works


def check_limit(limit_usd: float) -> float:
    """금액 상한은 0보다 크고 유한해야 한다: nan·inf는 비교식이 늘 거짓이라 상한이 안 걸린다(호출 전에 멈춘다)."""
    if not 0 < limit_usd < math.inf:
        raise SystemExit(f'금액 상한 {limit_usd}은(는) 쓸 수 없다: 0보다 크고 유한한 달러 값을 준다.')
    return limit_usd


def make_llm(cache_dir=None, cost_path=None, limit_usd: float = LIMIT_USD) -> Llm:
    return usd_llm(cache_dir or KT / 'cache', cost_path or COST, check_limit(limit_usd))


def make_executor(llm: Llm, mode: str):
    if mode == 'batch' and llm.judge is not None:
        raise SystemExit('--mode=batch는 응답·채점 모델을 나눈 실행(게이트웨이)에 쓸 수 없다. 동기(--mode=sync)로 돌린다.')
    return _make_executor(llm, mode, KT / 'batches')


def short(model: str) -> str:
    """게이트웨이 모델 id의 제공사 접두어(`google/…`·`anthropic-apikey/…`)를 뗀 이름."""
    return model.rsplit('/', 1)[-1]


def gen_rate(model: str) -> tuple[float, float, float]:
    """응답 모델의 장부 단가 (입력, 캐시 입력, 출력). 제공사 접두어는 떼고 마지막 `/` 뒤 이름으로 찾되, `:batch` 같은 꼬리가 붙은 정확한 이름의 행을 먼저 찾고
    없으면 꼬리를 뗀 이름의 행을 쓴다(게이트웨이의 Gemini id는 `openrouter/google/gemini-3.8-flash:batch` 꼴이다).
    표에 없는 모델은 luna 단가나 0원으로 세지 않고 호출 전에 멈춘다."""
    name = short(model)
    price = GEN_RATES.get(name) or GEN_RATES.get(name.split(':', 1)[0])
    if price is None:
        raise SystemExit(f'응답 모델 {model}의 단가를 모른다(kt_exec.GEN_RATES에 더한다).')
    return price[0], price[0], price[1]


class RatedCostLog(CostLog):
    """게이트웨이 응답 모델의 장부: Llm이 부르는 record에 그 모델의 단가(rate)와 이름(model)을 끼워 기본(luna) 단가로 세지 않는다."""

    def __init__(self, path, model: str, rate: tuple[float, float, float]):
        super().__init__(path)
        self.model, self.rate = model, rate

    def record(self, kind: str, tokens_in: int, tokens_out: int, cached: int = 0, batch: bool = False, failed: bool = False, chars: int = 0) -> float:
        return super().record(kind, tokens_in, tokens_out, cached, batch, failed, chars, rate=self.rate, model=self.model)


def _with_effort(client, model: str, effort: str):
    """응답 호출에만 reasoning.effort를 더하는 클라이언트(요청의 model은 게이트웨이 id 그대로). 일반 텍스트(create)와 구조화 출력(parse) 요청 모두에 붙는다.
    채점 Llm은 이 래퍼를 거치지 않아 채점 요청은 그대로다."""
    def sent(method: str):
        return lambda **options: getattr(client.responses, method)(**{**options, 'model': model, 'reasoning': {'effort': effort}})   # 호출할 때 찾는다(없는 메서드는 안 부른다)

    return SimpleNamespace(responses=SimpleNamespace(create=sent('create'), parse=sent('parse')))


def make_gen_llm(model: str, name: str, limit_usd: float | None, effort: str | None = None) -> Llm:
    """게이트웨이로 응답을 내는 Llm: 일반 텍스트 Responses 호출, 응답 캐시 `KT/cache-<name>`, 장부 `KT/cost-<name>.jsonl`을 `GEN_RATES` 단가로 센다.
    금액 상한(limit_usd)이 필수이고, 상한이 없거나 단가를 모르는 모델이면 폴더·장부를 만들기 전에 멈춘다.
    effort를 주면 응답 요청에 reasoning.effort로 보내고, 강도가 다른 응답이 같은 캐시 열쇠·기록 표기를 쓰지 않게 모델 이름에 `@<effort>`를 붙인다(단가는 붙이기 전 이름의 행).
    effort가 없으면 요청·캐시 열쇠가 예전과 글자 그대로 같다."""
    rate = gen_rate(model)
    if limit_usd is None:
        raise SystemExit('--gen-model은 장부 금액 상한 --limit-usd가 필수다.')
    check_limit(limit_usd)
    import sim_via   # 게이트웨이 어댑터(langchain-openai를 읽으므로 필요할 때만 불러온다)

    timeout = 180 if effort in (None, 'minimal', 'low') else 600   # 생각이 긴 호출(medium 이상)은 180초 안에 끝나지 않을 수 있다
    cost, client, label = KT / f'cost-{name}.jsonl', sim_via.client(model, timeout=timeout, max_retries=0), model
    if effort:
        client, label = _with_effort(client, model, effort), f'{model}@{effort}'
    llm = Llm(Ledger(cost.with_name('calls.jsonl'), cap=10 ** 9), KT / f'cache-{name}', model=label, client=client, cost=RatedCostLog(cost, label, rate), limit_usd=limit_usd)
    llm.via = 'ocx'
    return llm


def make_judge_llm(model: str, cost_path) -> Llm:
    """게이트웨이 채점 Llm(금액 0, via ocx). 채점 캐시는 `KT/cache-judge-<모델 이름>`이라 응답 모델이 달라도 같은 응답·프롬프트의 채점은 다시 부르지 않는다."""
    import sim_via

    return sim_via.ocx_llm(KT / f'cache-judge-{short(model)}', cost_path, model)
