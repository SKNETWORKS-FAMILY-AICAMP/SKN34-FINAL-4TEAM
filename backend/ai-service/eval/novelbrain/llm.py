"""평가용 OpenAI 호출: 상한 장부·디스크 캐시·일시 오류 재시도.

실제 호출 한 번(재시도 포함)이 장부 한 줄이다. 상한(기본 3,000)에 닿으면 제공사를 부르기 전에 멈춘다.
같은 요청은 `.data/cache`에서 다시 읽어 재실행해도 호출하지 않는다. 입력·응답·키는 오류 메시지에 넣지 않는다.
"""

import fcntl
import hashlib
import json
import os
import threading
import time
from pathlib import Path

import openai
from openai import OpenAI, OpenAIError

from cost import MODEL, CostLog

CAP = 3000
RESERVE_USD = 0.05   # 진행 중인 호출이 상한을 넘기지 않게 남겨 두는 여유
TRANSIENT = (openai.RateLimitError, openai.APITimeoutError, openai.APIConnectionError, openai.InternalServerError)


class CallCapExceeded(RuntimeError):
    """실제 OpenAI 호출 상한에 닿았다."""


class LlmFailure(RuntimeError):
    """제공사 호출 실패·잘린 응답. 원인 분류만 담는다."""


class Ledger:
    def __init__(self, path, cap: int = CAP):
        self.path, self.cap, self._lock = Path(path), cap, threading.Lock()
        self.path.parent.mkdir(parents=True, exist_ok=True)

    def used(self) -> int:
        return sum(1 for _ in self.path.open()) if self.path.exists() else 0

    def charge(self, kind: str) -> int:
        """호출 직전에 한 줄을 남긴다. 상한이면 남기지 않고 예외. 스레드·프로세스 모두 flock으로 직렬화한다."""
        with self._lock, self.path.open('a+') as file:
            fcntl.flock(file, fcntl.LOCK_EX)
            file.seek(0)
            used = sum(1 for _ in file)
            if used >= self.cap:
                raise CallCapExceeded(f'OpenAI 호출 상한 {self.cap}회에 도달했다.')
            file.write(json.dumps({'n': used + 1, 'ts': round(time.time()), 'kind': kind}) + '\n')
            file.flush()
            return used + 1


class Llm:
    def __init__(self, ledger: Ledger, cache_dir, model: str | None = None, client=None, attempts: int = 3,
                 backoff: float = 2.0, cost: CostLog | None = None, limit_usd: float | None = None):
        self.ledger, self.cache_dir = ledger, Path(cache_dir)
        self.cost, self.limit_usd = cost, limit_usd
        self.model = model or os.environ['OPENAI_MODEL']
        self._client, self.attempts, self.backoff = client, attempts, backoff
        self._locks: dict[str, threading.Lock] = {}
        self._guard = threading.Lock()
        self.cache_dir.mkdir(parents=True, exist_ok=True)

    @property
    def client(self):
        if self._client is None:
            self._client = OpenAI(api_key=os.environ['OPENAI_API_KEY'], timeout=180, max_retries=0)
        return self._client

    def _path(self, instructions: str, input: str, schema, max_output_tokens: int) -> Path:
        key = hashlib.sha256(json.dumps(
            [self.model, instructions, input, schema.__name__ if schema else None, max_output_tokens],
            ensure_ascii=False).encode()).hexdigest()
        return self.cache_dir / f'{key}.json'

    def is_cached(self, instructions: str, input: str, *, schema=None, max_output_tokens: int = 4000) -> bool:
        """이 요청이 캐시에 있어 호출 없이 끝나는가(실행 전 예상 호출 수 계산용)."""
        return self._path(instructions, input, schema, max_output_tokens).exists()

    def ask(self, kind: str, instructions: str, input: str, *, schema=None, max_output_tokens: int = 4000):
        """텍스트 또는 schema(Pydantic) 결과 하나. 같은 요청이 캐시에 있으면 호출·장부 없이 돌려준다."""
        path = self._path(instructions, input, schema, max_output_tokens)
        key = path.name
        with self._guard:
            lock = self._locks.setdefault(key, threading.Lock())
        with lock:  # 같은 요청을 동시에 보내면 하나만 호출하고 나머지는 그 응답을 읽는다(중복 호출·캐시 덮어쓰기 방지)
            if path.exists():
                cached = json.loads(path.read_text())['result']
                return schema.model_validate(cached) if schema else cached
            return self._call(path, kind, instructions, input, schema, max_output_tokens)

    def _record(self, kind: str, usage, failed: bool = False, chars: int = 0) -> None:
        """호출의 토큰과 추정 금액을 비용 장부에 남긴다(잘린 응답도 청구되므로 센다). chars는 요청 글자 수(글자/토큰 비 실측용)."""
        if self.cost is not None and usage is not None:
            cached = getattr(getattr(usage, 'input_tokens_details', None), 'cached_tokens', 0) or 0
            self.cost.record(kind, usage.input_tokens, usage.output_tokens, cached, failed=failed, chars=chars)

    def write_cache(self, key: str, result, model: str | None, usage: dict | None) -> None:
        """Batch 회수처럼 밖에서 얻은 응답을 동기 호출과 같은 형식으로 캐시에 쓴다."""
        record = {'result': result.model_dump() if hasattr(result, 'model_dump') else result, 'model': model,
                  'usage': {'in': usage['in'], 'out': usage['out']} if usage else None}
        path = self.cache_dir / f'{key}.json'
        tmp = path.with_suffix(f'.{threading.get_ident()}.tmp')
        tmp.write_text(json.dumps(record, ensure_ascii=False))
        os.replace(tmp, path)

    def _call(self, path: Path, kind: str, instructions: str, input: str, schema, max_output_tokens: int):
        for attempt in range(self.attempts):
            if self.cost is not None and self.limit_usd is not None and self.cost.spent() + RESERVE_USD > self.limit_usd:
                raise CallCapExceeded(f'비용 상한 ${self.limit_usd:.2f}에 도달했다.')
            self.ledger.charge(kind)
            try:
                options = dict(model=self.model, store=False, max_output_tokens=max_output_tokens,
                               instructions=instructions, input=input)
                response = (self.client.responses.parse(text_format=schema, **options) if schema
                            else self.client.responses.create(**options))
            except TRANSIENT:
                time.sleep(self.backoff * 2 ** attempt)
                continue
            except OpenAIError as error:
                raise LlmFailure(type(error).__name__) from None
            chars = len(instructions) + len(input)
            if response.status != 'completed':
                self._record(kind, response.usage, failed=True, chars=chars)
                raise LlmFailure('incomplete')
            result = response.output_parsed if schema else response.output_text.strip()
            if result is None:
                self._record(kind, response.usage, failed=True, chars=chars)
                raise LlmFailure('unparsed')
            self._record(kind, response.usage, chars=chars)
            usage = response.usage
            record = {'result': result.model_dump() if schema else result, 'model': response.model,
                      'usage': {'in': usage.input_tokens, 'out': usage.output_tokens} if usage else None}
            tmp = path.with_suffix(f'.{threading.get_ident()}.tmp')
            tmp.write_text(json.dumps(record, ensure_ascii=False))
            os.replace(tmp, path)
            return result
        raise LlmFailure('transient')


def usd_llm(cache_dir, cost_path, limit_usd: float, ledger_path=None, model: str | None = None) -> Llm:
    """호출 수 상한(Ledger) 대신 비용 장부(`cost_path`)의 금액 상한으로 막는 Llm. 응답은 cache_dir에 캐시한다. 모델은 `cost.MODEL`로 고정한다(.env 값은 읽지 않는다)."""
    return Llm(Ledger(ledger_path or Path(cost_path).with_name('calls.jsonl'), cap=10 ** 9), cache_dir, model=model or MODEL, cost=CostLog(cost_path),
               limit_usd=limit_usd)
