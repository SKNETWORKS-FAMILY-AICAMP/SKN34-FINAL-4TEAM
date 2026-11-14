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

CAP = 3000
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
                 backoff: float = 2.0):
        self.ledger, self.cache_dir = ledger, Path(cache_dir)
        self.model = model or os.environ['OPENAI_MODEL']
        self._client, self.attempts, self.backoff = client, attempts, backoff
        self.cache_dir.mkdir(parents=True, exist_ok=True)

    @property
    def client(self):
        if self._client is None:
            self._client = OpenAI(api_key=os.environ['OPENAI_API_KEY'], timeout=180, max_retries=0)
        return self._client

    def ask(self, kind: str, instructions: str, input: str, *, schema=None, max_output_tokens: int = 4000):
        """텍스트 또는 schema(Pydantic) 결과 하나. 같은 요청이 캐시에 있으면 호출·장부 없이 돌려준다."""
        key = hashlib.sha256(json.dumps(
            [self.model, instructions, input, schema.__name__ if schema else None, max_output_tokens],
            ensure_ascii=False).encode()).hexdigest()
        path = self.cache_dir / f'{key}.json'
        if path.exists():
            cached = json.loads(path.read_text())['result']
            return schema.model_validate(cached) if schema else cached
        for attempt in range(self.attempts):
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
            if response.status != 'completed':
                raise LlmFailure('incomplete')
            result = response.output_parsed if schema else response.output_text.strip()
            if result is None:
                raise LlmFailure('unparsed')
            usage = response.usage
            record = {'result': result.model_dump() if schema else result, 'model': response.model,
                      'usage': {'in': usage.input_tokens, 'out': usage.output_tokens} if usage else None}
            tmp = path.with_suffix(f'.{threading.get_ident()}.tmp')
            tmp.write_text(json.dumps(record, ensure_ascii=False))
            os.replace(tmp, path)
            return result
        raise LlmFailure('transient')
