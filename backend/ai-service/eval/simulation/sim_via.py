"""평가 실행기의 --via ocx: 로컬 OpenCodex 게이트웨이(구독 경로)로 Responses 호출을 보낸다(#642 후속).

OpenAI SDK는 OPENAI_BASE_URL을 따르므로 이 프로세스의 환경변수만 바꾸고 키는 아무 문자열이다. 게이트웨이의 Responses parse는 input이 메시지 목록이고 store=False일 때만 되므로,
평가 코드 안의 얇은 어댑터(채점 Llm이 쓴다)가 문자열 input을 [{'role': 'user', 'content': input}]으로 바꾸고 store=False를 강제하며 모델 이름을 게이트웨이 모델로 맞춘다.
시뮬레이션 agent는 ChatOpenAI라 요청이 이미 메시지 목록·store=False이므로 어댑터가 필요 없다: chat()이 게이트웨이 주소·모델·더미 키로 ChatOpenAI를 만들어 이 프로세스의 agent.ChatOpenAI 자리에 끼운다.
운영 app/**은 고치지 않는다.
한계(ponytail): ① /v1/decisions(연출 결정)는 게이트웨이에 없어 speed는 못 돈다 ② 지연이 OpenAI API와 달라 속도 비교에 쓰면 안 된다 ③ 채점 모델 gpt-5.6-luna도 게이트웨이에는 없어 gpt-6-luna로 바뀐다(결과에 via로 남긴다).
금액은 0이라 ocx 호출은 OpenAI 금액 합계·상한에서 빠진다(장부 행에 via: ocx). 429·구독 한도는 지수 대기(합계 10분 안)로 다시 시도하고 계속 실패하면 그 오류를 올린다.
"""

import fcntl
import json
import os
import sys
import time
from pathlib import Path
from types import SimpleNamespace

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'novelbrain'))

import openai  # noqa: E402
from langchain_openai import ChatOpenAI  # noqa: E402

from cost import MODEL as JUDGE_MODEL, CostLog  # noqa: E402  eval/novelbrain/cost.py
from llm import Ledger, Llm  # noqa: E402

GATEWAY = 'http://127.0.0.1:10100/v1'
MODEL = 'gpt-6-luna'                    # 게이트웨이에서 쓸 수 있는 모델
WAITS = (15, 30, 60, 120, 240, 120)     # 429 뒤 기다리는 초(합계 585초 < 10분)


def adapt(options: dict, model: str = MODEL) -> dict:
    """Responses create/parse 인자를 게이트웨이가 받는 모양으로: 문자열 input은 메시지 목록으로, store=False, 모델은 게이트웨이 모델로. 원본은 바꾸지 않는다."""
    adapted = {**options, 'store': False, 'model': model}
    if isinstance(adapted.get('input'), str):
        adapted['input'] = [{'role': 'user', 'content': adapted['input']}]
    return adapted


def backoff(call, wait=time.sleep):
    """429(구독 한도)는 WAITS만큼 차례로 기다려 다시 부르고, 계속 429면 그 오류를 올린다. 다른 오류는 다시 부르지 않는다."""
    for delay in (*WAITS, None):
        try:
            return call()
        except openai.RateLimitError:
            if delay is None:
                raise
            wait(delay)


class Responses:
    def __init__(self, inner, wait=time.sleep, model: str = MODEL):
        self._inner, self._wait, self._model = inner, wait, model

    def _send(self, method: str, options: dict):
        return backoff(lambda: getattr(self._inner, method)(**adapt(options, self._model)), self._wait)

    def create(self, **options):
        return self._send('create', options)

    def parse(self, **options):
        return self._send('parse', options)


class Client:
    """OpenAI 클라이언트처럼 쓰는 어댑터: responses만 바꾼다."""

    def __init__(self, inner, wait=time.sleep, model: str = MODEL):
        self._inner = inner
        self.responses = Responses(inner.responses, wait, model)


def client(model: str = MODEL, **options) -> Client:
    return Client(openai.OpenAI(**{'api_key': 'ocx', 'base_url': GATEWAY, **options}), model=model)


def chat(wait=time.sleep, **options) -> SimpleNamespace:
    """agent.ChatOpenAI 자리에 끼우는 ocx용 모델: 서비스가 정한 주소·모델·키는 게이트웨이 값으로 덮고(나머지 인자는 그대로) 구조화 출력 호출의 429는 backoff로 기다린다."""
    real = ChatOpenAI(**{**options, 'model': MODEL, 'api_key': 'ocx', 'base_url': GATEWAY})

    def structured(schema, **kwargs):
        runnable = real.with_structured_output(schema, **kwargs)
        return SimpleNamespace(invoke=lambda messages: backoff(lambda: runnable.invoke(messages), wait))

    return SimpleNamespace(with_structured_output=structured)


def use_ocx() -> None:
    """이 프로세스를 ocx로 바꾼다: 환경변수(SDK 기본 클라이언트가 읽는다)와 시뮬레이션 agent의 ChatOpenAI. 되돌리지 않는다."""
    os.environ['OPENAI_BASE_URL'], os.environ['OPENAI_API_KEY'] = GATEWAY, 'ocx'
    from app.simulation import agent
    agent.ChatOpenAI = chat


class OcxCostLog(CostLog):
    """구독 경로(ocx)의 장부: 금액 0과 via: ocx를 적어 OpenAI 합계·상한(spent)에 들어가지 않는다. 토큰과 부른 모델 이름은 그대로 남긴다."""

    def __init__(self, path, model: str = MODEL):
        super().__init__(path)
        self.model = model

    def record(self, kind: str, tokens_in: int, tokens_out: int, cached: int = 0, batch: bool = False, failed: bool = False, chars: int = 0) -> float:
        line = json.dumps({'ts': round(time.time()), 'kind': kind, 'in': tokens_in, 'cached': cached, 'out': tokens_out, 'batch': batch, 'failed': failed, 'usd': 0.0,
                           'chars': chars, 'via': 'ocx', 'model': self.model})
        with self._lock, self.path.open('a') as file:
            fcntl.flock(file, fcntl.LOCK_EX)
            file.write(line + '\n')
        return 0.0


def ocx_llm(cache_dir, cost_path, model: str = MODEL) -> Llm:
    """ocx로 부르는 Llm(model = 게이트웨이 모델, 채점 모델을 고를 때 쓴다). 기본 모델은 응답 캐시가 OpenAI와 같은 열쇠(모델 이름은 gpt-5.6-luna 그대로)라 이미 끝낸 호출을 이어 받고,
    다른 모델은 그 이름이 캐시 열쇠에 들어가 다른 모델의 답을 재사용하지 않는다. 금액이 0이라 상한(limit_usd)은 두지 않고 장부 줄에 모델 이름을 남긴다."""
    llm = Llm(Ledger(Path(cost_path).with_name('calls.jsonl'), cap=10 ** 9), cache_dir, model=JUDGE_MODEL if model == MODEL else model,
              client=client(model, timeout=180, max_retries=0), cost=OcxCostLog(cost_path, model))
    llm.via = 'ocx'
    return llm
