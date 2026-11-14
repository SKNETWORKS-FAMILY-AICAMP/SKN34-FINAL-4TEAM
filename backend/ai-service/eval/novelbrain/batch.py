"""라운드 실행기와 Batch API 실행기.

단계가 의존하는 평가(생성 → 채점 → 둘째 채점)를 기존 `work(task, llm)` 코드를 바꾸지 않고 푼다. `Planner`는 llm 대용으로,
응답이 캐시에 있으면 그것을 돌려주고 없으면 요청을 모아 `Pending`을 던진다. `run_rounds`는 모인 요청을 실행기로 한꺼번에 실행해 캐시를
채운 뒤 task를 다시 돌린다. 실행기는 동기(스레드) 또는 Batch API(절반 가격)이며, 제출한 배치는 `.data/batches`에 남아 중단 뒤에
같은 명령으로 이어 받는다. 실패한 요청은 한 번 다시 내고 그래도 안 되면 `LlmFailure`로 task에 알려 집계가 실패로 센다.
"""

import hashlib
import json
import os
import threading
import time
from collections.abc import Callable
from concurrent.futures import ThreadPoolExecutor
from dataclasses import dataclass
from pathlib import Path

from pydantic import ValidationError

from cost import LIMIT_USD, calibrate, usd
from llm import CallCapExceeded, Llm, LlmFailure

TERMINAL = {'completed', 'failed', 'expired', 'cancelled'}


class Pending(Exception):
    """이 요청이 캐시에 없어 이번 라운드에는 이어 갈 수 없다."""


@dataclass(frozen=True)
class Request:
    kind: str
    instructions: str
    input: str
    schema: type | None
    max_output_tokens: int


class Planner:
    """llm 대용: 캐시에 있으면 그 응답, 없으면 요청을 모으고 Pending, 영구 실패한 요청은 LlmFailure."""

    def __init__(self, llm: Llm, failed=frozenset()):
        self.llm, self.failed, self.requests = llm, failed, {}

    def is_cached(self, instructions, input, *, schema=None, max_output_tokens=4000):
        return self.llm.is_cached(instructions, input, schema=schema, max_output_tokens=max_output_tokens)

    def ask(self, kind, instructions, input, *, schema=None, max_output_tokens=4000):
        key = self.llm._path(instructions, input, schema, max_output_tokens).stem
        if self.llm.is_cached(instructions, input, schema=schema, max_output_tokens=max_output_tokens):
            return self.llm.ask(kind, instructions, input, schema=schema, max_output_tokens=max_output_tokens)
        if key in self.failed:
            raise LlmFailure('batch_failed')
        self.requests[key] = Request(kind, instructions, input, schema, max_output_tokens)
        raise Pending


class Round:
    """한 라운드에서 서로 독립인 호출을 모두 낸 뒤에 멈추는 도우미: 캐시에 없는 호출이 있어도 나머지를 계속 요청하고 done()에서 Pending을 던진다."""

    def __init__(self):
        self.pending = False

    def get(self, call):
        """(결과, 영구 실패 여부). 아직 캐시에 없으면 (None, False)로 두고 pending을 기록한다."""
        try:
            return call(), False
        except Pending:
            self.pending = True
            return None, False
        except LlmFailure:
            return None, True

    def done(self) -> None:
        if self.pending:
            raise Pending


def strict_schema(model) -> dict:
    """Pydantic 모델의 JSON 스키마를 OpenAI strict 구조화 출력 형식으로: 모든 객체에 additionalProperties=false, 모든 필드 required."""
    def fix(node):
        if isinstance(node, dict):
            if node.get('type') == 'object' or 'properties' in node:
                node['additionalProperties'] = False
                node['required'] = list(node.get('properties', {}))
            for value in node.values():
                fix(value)
        elif isinstance(node, list):
            for value in node:
                fix(value)
        return node
    return fix(model.model_json_schema())


def body_usage(body: dict) -> dict:
    usage = body.get('usage') or {}
    return {'in': usage.get('input_tokens', 0), 'out': usage.get('output_tokens', 0),
            'cached': (usage.get('input_tokens_details') or {}).get('cached_tokens', 0)}


def parse_body(body: dict, schema) -> tuple:
    """Responses API 응답 본문에서 결과와 토큰 사용량. 잘린 응답·비어 있는 응답·스키마에 안 맞는 응답은 LlmFailure다."""
    if body.get('status') != 'completed':
        raise LlmFailure('incomplete')
    text = ''.join(part.get('text', '') for item in body.get('output', []) if item.get('type') == 'message'
                   for part in item.get('content', []) if part.get('type') == 'output_text')
    if schema is not None:
        try:
            return schema.model_validate_json(text), body_usage(body)
        except ValidationError:
            raise LlmFailure('unparsed') from None
    if not text.strip():
        raise LlmFailure('unparsed')
    return text.strip(), body_usage(body)


def estimate(requests: dict, batch: bool, chars_per_token: float, out_tokens: dict, default_out: int = 800) -> tuple[int, int, float]:
    """요청 묶음의 예상 입력·출력 토큰과 금액. 글자 수/토큰 수 비와 종류별 평균 출력 토큰은 파일럿에서 잰 값을 넘긴다."""
    tokens_in = sum(int((len(r.instructions) + len(r.input)) / chars_per_token) + 30 for r in requests.values())
    tokens_out = sum(min(out_tokens.get(r.kind, default_out), r.max_output_tokens) for r in requests.values())
    return tokens_in, tokens_out, usd(tokens_in, tokens_out, batch=batch)


class SyncExecutor:
    """요청을 스레드로 하나씩 호출한다(Llm.ask: 캐시·장부·재시도 포함). 실패한 요청의 키를 돌려준다."""

    def __init__(self, llm: Llm, workers: int = 12):
        self.llm, self.workers = llm, workers

    def __call__(self, requests: dict) -> set[str]:
        failed, lock = set(), threading.Lock()

        def one(item):
            key, r = item
            try:
                self.llm.ask(r.kind, r.instructions, r.input, schema=r.schema, max_output_tokens=r.max_output_tokens)
            except LlmFailure:
                with lock:
                    failed.add(key)

        with ThreadPoolExecutor(self.workers) as pool:
            list(pool.map(one, requests.items()))
        return failed


class HybridExecutor:
    """작은 라운드는 동기로(기다리지 않게), 큰 라운드는 Batch로(절반 가격)."""

    def __init__(self, sync: Callable, batch: Callable, threshold: int = 300):
        self.sync, self.batch, self.threshold = sync, batch, threshold

    def __call__(self, requests: dict) -> set[str]:
        return (self.batch if len(requests) >= self.threshold else self.sync)(requests)

    @property
    def uses_batch(self) -> bool:
        return True


class BatchExecutor:
    """Batch API(`/v1/responses`)로 요청을 묶어 제출·폴링·회수한다. 응답은 동기 호출과 같은 형식으로 캐시에 쓰고 Batch 가격으로 장부에 남긴다.

    제출한 배치는 state_dir에 기록해 두므로 중단 뒤에 같은 요청 묶음으로 다시 부르면 새로 내지 않고 이어서 기다린다.
    """

    def __init__(self, llm: Llm, client, state_dir, poll: float = 60, sleep=time.sleep, max_requests: int = 1500, max_inflight: int = 3,
                 log=print):
        self.llm, self.client, self.state_dir = llm, client, Path(state_dir)
        self.poll, self.sleep, self.max_requests, self.max_inflight, self.log = poll, sleep, max_requests, max_inflight, log
        self.state_dir.mkdir(parents=True, exist_ok=True)

    def _line(self, key: str, r: Request) -> str:
        body = {'model': self.llm.model, 'store': False, 'max_output_tokens': r.max_output_tokens, 'instructions': r.instructions, 'input': r.input}
        if r.schema is not None:
            body['text'] = {'format': {'type': 'json_schema', 'name': r.schema.__name__, 'strict': True, 'schema': strict_schema(r.schema)}}
        return json.dumps({'custom_id': key, 'method': 'POST', 'url': '/v1/responses', 'body': body}, ensure_ascii=False)

    def _submit(self, keys: list[str], requests: dict) -> str:
        """키 묶음 하나를 올려 배치를 만들고 상태 파일에 기록한다(재개용)."""
        name = hashlib.sha256('|'.join(keys).encode()).hexdigest()[:16]
        state = self.state_dir / f'{name}.json'
        if state.exists():
            saved = json.loads(state.read_text())
            if not saved.get('done'):
                self.log(f'배치 {saved["batch_id"]} 재개(요청 {len(keys)}건)')
                return name
        content = '\n'.join(self._line(k, requests[k]) for k in keys).encode()
        file = self.client.files.create(file=(f'{name}.jsonl', content), purpose='batch')
        batch = self.client.batches.create(input_file_id=file.id, endpoint='/v1/responses', completion_window='24h')
        state.write_text(json.dumps({'batch_id': batch.id, 'keys': keys, 'done': False}))
        self.log(f'배치 {batch.id} 제출(요청 {len(keys)}건)')
        return name

    def _ingest(self, name: str, requests: dict, batch) -> set[str]:
        """끝난 배치의 출력을 읽어 캐시에 쓰고, 실패·누락한 키를 돌려준다."""
        state_path = self.state_dir / f'{name}.json'
        state = json.loads(state_path.read_text())
        keys, seen, failed = state['keys'], set(), set()
        if getattr(batch, 'output_file_id', None):
            for line in self.client.files.content(batch.output_file_id).text.splitlines():
                if not line.strip():
                    continue
                item = json.loads(line)
                key = item['custom_id']
                seen.add(key)
                response = item.get('response')
                if item.get('error') or not response or response.get('status_code') != 200:
                    failed.add(key)
                    continue
                r, usage = requests[key], body_usage(response['body'])
                chars = len(r.instructions) + len(r.input)
                try:
                    result, usage = parse_body(response['body'], requests[key].schema)
                except LlmFailure:
                    failed.add(key)
                    if self.llm.cost is not None and usage['in']:
                        self.llm.cost.record(r.kind, usage['in'], usage['out'], usage['cached'], batch=True, failed=True, chars=chars)
                    continue
                self.llm.write_cache(key, result, response['body'].get('model'), usage)
                if self.llm.cost is not None:
                    self.llm.cost.record(r.kind, usage['in'], usage['out'], usage['cached'], batch=True, chars=chars)
        failed |= set(keys) - seen
        state['done'] = True
        state_path.write_text(json.dumps(state))
        return failed

    def __call__(self, requests: dict) -> set[str]:
        keys = sorted(requests)
        chunks = [keys[i:i + self.max_requests] for i in range(0, len(keys), self.max_requests)]
        failed, active = set(), {}
        while chunks or active:
            while chunks and len(active) < self.max_inflight:
                chunk = chunks.pop(0)
                active[self._submit(chunk, requests)] = chunk
            for name, chunk in list(active.items()):
                batch_id = json.loads((self.state_dir / f'{name}.json').read_text())['batch_id']
                batch = self.client.batches.retrieve(batch_id)
                if batch.status not in TERMINAL:
                    continue
                del active[name]
                errors = [getattr(e, 'code', '') for e in (getattr(getattr(batch, 'errors', None), 'data', None) or [])]
                if batch.status == 'failed' and 'token_limit_exceeded' in errors and len(chunk) > 1:
                    half = len(chunk) // 2   # 배치 큐의 토큰 한도에 걸렸으면 반으로 나눠 다시 낸다(요청 실패로 세지 않는다)
                    self.log(f'배치 {batch_id} 토큰 한도 초과: {len(chunk)}건을 둘로 나눠 다시 제출')
                    chunks[:0] = [chunk[:half], chunk[half:]]
                    (self.state_dir / f'{name}.json').write_text(json.dumps({'batch_id': batch_id, 'keys': chunk, 'done': True}))
                    continue
                bad = self._ingest(name, requests, batch)
                self.log(f'배치 {batch_id} {batch.status}: 요청 {len(chunk)}건 중 실패·누락 {len(bad)}건')
                failed |= bad
            if active or chunks:
                self.sleep(self.poll)
        return failed


def run_rounds(tasks: list, work: Callable, llm: Llm, executor: Callable, retries: int = 1, max_rounds: int = 12, log=print,
               plan: dict | None = None) -> list:
    """work(task, ask)를 모든 task에 돌려, 캐시에 없는 요청이 나오면 모아 executor로 실행하고 다시 돈다(의존하는 단계는 라운드가 늘어난다).

    plan={'limit_usd', 'chars_per_token', 'out_tokens', 'batch'}를 주면 라운드마다 예상 금액을 출력하고 상한을 넘으면 실행 전에 멈춘다.
    같은 요청이 `retries`번 실패하면 영구 실패로 두고 그 요청을 부르는 task에는 LlmFailure를 던진다.
    """
    failures: dict[str, int] = {}
    permanent: set[str] = set()
    for number in range(1, max_rounds + 1):
        planner, results, pending = Planner(llm, frozenset(permanent)), [], 0
        for task in tasks:
            try:
                results.append(work(task, planner))
            except Pending:
                results.append(None)
                pending += 1
        if not planner.requests:
            return results
        if plan:
            tokens_in, tokens_out, cost = estimate(planner.requests, plan.get('batch', False), plan['chars_per_token'], plan['out_tokens'])
            spent = llm.cost.spent() if llm.cost is not None else 0.0
            log(f'라운드 {number}: 요청 {len(planner.requests)}건(대기 task {pending}), 예상 입력 {tokens_in:,}·출력 {tokens_out:,} 토큰 → 약 ${cost:.2f} '
                f'(장부 ${spent:.2f} / 상한 ${plan["limit_usd"]:.2f})')
            if spent + cost > plan['limit_usd']:
                raise CallCapExceeded(f'예상 금액이 상한을 넘는다(${spent + cost:.2f} > ${plan["limit_usd"]:.2f}). 표본을 줄여라.')
        for key in executor(planner.requests):
            failures[key] = failures.get(key, 0) + 1
            if failures[key] > retries:
                permanent.add(key)
    raise RuntimeError(f'{max_rounds}라운드 안에 끝나지 않았다.')


# 파일럿 전에 쓰는 호출당 출력 토큰 어림값. 실행 뒤에는 장부의 실측 평균이 이 값을 덮어쓴다.
OUT_GUESS = {'label': 3000, 'world': 2500, 'learn': 800, 'profile': 500, 'question': 300, 'gen': 700, 'judge': 700}


def make_executor(llm: Llm, mode: str, state_dir):
    """mode: sync(스레드 호출) · batch(Batch API, 절반 가격) · hybrid(요청 300건 이상인 라운드만 Batch). 제출한 배치는 state_dir에 남아 이어 받는다."""
    sync = SyncExecutor(llm)
    if mode == 'sync':
        return sync
    from openai import OpenAI

    client = OpenAI(api_key=os.environ['OPENAI_API_KEY'], timeout=120, max_retries=5)   # 폴링 중 일시 오류는 SDK 재시도에 맡긴다
    batch = BatchExecutor(llm, client, state_dir)
    return batch if mode == 'batch' else HybridExecutor(sync, batch)


def plan_for(llm: Llm, mode: str, limit_usd: float = LIMIT_USD) -> dict:
    """`run_rounds`의 plan: 라운드마다 예상 금액을 출력하고 상한을 넘으면 멈춘다. 글자/토큰 비와 출력 평균은 장부의 실측값을 쓴다."""
    ratio, measured = calibrate(llm.cost.summary())
    return {'limit_usd': limit_usd, 'chars_per_token': ratio, 'out_tokens': {**OUT_GUESS, **measured}, 'batch': mode == 'batch'}


def cost_report(llm: Llm) -> None:
    """종류별 호출 수·토큰·추정 금액과 합계."""
    for kind, b in sorted(llm.cost.summary().items()):
        print(f"  {kind:8s} 호출 {b['calls']:5d} (Batch {b['batch']}, 실패 {b['failed']}) 입력 {b['in']:>10,} 출력 {b['out']:>9,} 토큰 → ${b['usd']:.3f}")
    print(f'  장부 합계 ${llm.cost.spent():.3f} / 상한 ${llm.limit_usd:.2f}')
