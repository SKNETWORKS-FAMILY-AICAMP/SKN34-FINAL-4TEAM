"""라운드 실행기·Batch 실행기 단위 테스트. 실제 네트워크·키 없이 대역 클라이언트로 제출·폴링·회수·부분 실패·재개를 확인한다."""

import json
from types import SimpleNamespace

import pytest
from pydantic import BaseModel

from batch import BatchExecutor, HybridExecutor, Pending, Planner, Round, SyncExecutor, estimate, parse_body, run_rounds, strict_schema
from cost import CostLog
from llm import Ledger, Llm, LlmFailure


class Out(BaseModel):
    value: int


class Nested(BaseModel):
    name: str
    items: list[Out]


def body(text, status='completed', tokens=(10, 5), cached=0):
    return {'id': 'resp_x', 'object': 'response', 'status': status, 'model': 'm',
            'output': [{'type': 'reasoning', 'summary': []},
                       {'type': 'message', 'role': 'assistant', 'content': [{'type': 'output_text', 'text': text}]}],
            'usage': {'input_tokens': tokens[0], 'output_tokens': tokens[1], 'input_tokens_details': {'cached_tokens': cached}}}


class SyncFake:
    """responses.create/parse 대역: 입력을 거꾸로 돌려주고, fail_on이 입력에 들어 있으면 잘린 응답(incomplete)을 낸다."""

    def __init__(self, fail_on=None):
        self.calls, self.fail_on = [], fail_on
        self.responses = SimpleNamespace(create=self._create, parse=self._parse)

    def _result(self, kw, **extra):
        self.calls.append(kw['input'])
        status = 'incomplete' if self.fail_on and self.fail_on in kw['input'] else 'completed'
        return SimpleNamespace(status=status, usage=SimpleNamespace(input_tokens=10, output_tokens=5, input_tokens_details=SimpleNamespace(cached_tokens=0)),
                               model='m', id='r', **extra)

    def _create(self, **kw):
        return self._result(kw, output_text=kw['input'][::-1])

    def _parse(self, **kw):
        return self._result(kw, output_parsed=kw['text_format'](value=len(kw['input'])))


def make_llm(tmp_path, client=None, **kw):
    return Llm(Ledger(tmp_path / 'ledger.jsonl', 10 ** 6), tmp_path / 'cache', model='m', client=client or SyncFake(), backoff=0,
               cost=CostLog(tmp_path / 'cost.jsonl'), **kw)


def test_planner_reads_cache_and_collects_missing_requests(tmp_path):
    llm = make_llm(tmp_path)
    llm.ask('k', 'ins', 'known')
    planner = Planner(llm)
    assert planner.ask('k', 'ins', 'known') == 'nwonk'
    with pytest.raises(Pending):
        planner.ask('gen', 'ins', 'missing', schema=Out, max_output_tokens=777)
    (request,) = planner.requests.values()
    assert (request.kind, request.instructions, request.input, request.schema, request.max_output_tokens) == ('gen', 'ins', 'missing', Out, 777)


def test_planner_raises_llm_failure_for_requests_that_failed_for_good(tmp_path):
    llm = make_llm(tmp_path)
    key = llm._path('ins', 'bad', None, 4000).stem
    with pytest.raises(LlmFailure):
        Planner(llm, failed={key}).ask('k', 'ins', 'bad')


def chain(task, llm):
    """a → b 두 단계: 둘째 요청의 입력이 첫째 응답에 달려 있어 라운드를 두 번 돈다."""
    first = llm.ask('a', 'ins', f'a{task}')
    return llm.ask('b', 'ins', first)


def test_run_rounds_resolves_dependent_requests_round_by_round(tmp_path):
    client = SyncFake()
    llm = make_llm(tmp_path, client)
    rounds = []

    def executor(requests):
        rounds.append(sorted(r.kind for r in requests.values()))
        return SyncExecutor(llm, workers=2)(requests)

    results = run_rounds([1, 2, 3], chain, llm, executor)
    assert results == ['a1', 'a2', 'a3']                       # 입력을 두 번 뒤집으면 제자리
    assert rounds == [['a', 'a', 'a'], ['b', 'b', 'b']]


def test_run_rounds_gives_up_on_a_request_after_one_retry_and_reports_failure(tmp_path):
    client = SyncFake(fail_on='a2')
    llm = make_llm(tmp_path, client)

    def work(task, llm):
        try:
            return llm.ask('a', 'ins', f'a{task}')
        except LlmFailure:
            return 'FAILED'

    results = run_rounds([1, 2], work, llm, SyncExecutor(llm, workers=1), retries=1)
    assert results == ['1a', 'FAILED']
    assert client.calls.count('a2') == 2                       # 처음 한 번 + 재제출 한 번, 그 뒤에는 영구 실패


def test_strict_schema_requires_every_field_and_forbids_extras():
    schema = strict_schema(Nested)
    assert schema['additionalProperties'] is False and sorted(schema['required']) == ['items', 'name']
    inner = schema['$defs']['Out']
    assert inner['additionalProperties'] is False and inner['required'] == ['value']


def test_parse_body_reads_text_structured_and_usage():
    result, usage = parse_body(body('안녕', tokens=(11, 7), cached=3), None)
    assert result == '안녕' and usage == {'in': 11, 'out': 7, 'cached': 3}
    result, _ = parse_body(body('{"value": 4}'), Out)
    assert result == Out(value=4)
    with pytest.raises(LlmFailure):
        parse_body(body('x', status='incomplete'), None)
    with pytest.raises(LlmFailure):
        parse_body(body('not json'), Out)


class BatchFake:
    """files/batches 대역. 업로드된 JSONL을 읽어 결과를 만든다: fail_on이 든 요청은 줄 오류, bad_status가 든 요청은 incomplete."""

    def __init__(self, fail_on=None, bad_status=None, statuses=('in_progress', 'completed')):
        self.fail_on, self.bad_status, self.statuses = fail_on, bad_status, list(statuses)
        self.uploads, self.created, self.retrieved, self.files_store = [], [], 0, {}
        self.files = SimpleNamespace(create=self._file_create, content=self._file_content)
        self.batches = SimpleNamespace(create=self._create, retrieve=self._retrieve)

    def _file_create(self, file, purpose):
        name, content = file
        fid = f'file-{len(self.uploads)}'
        self.uploads.append([json.loads(line) for line in content.decode().splitlines()])
        self.files_store[fid] = content.decode()
        return SimpleNamespace(id=fid)

    def _create(self, input_file_id, endpoint, completion_window, metadata=None):
        self.created.append({'input_file_id': input_file_id, 'endpoint': endpoint, 'window': completion_window})
        return SimpleNamespace(id=f'batch-{len(self.created)}', status='validating', input_file_id=input_file_id)

    def _retrieve(self, batch_id):
        self.retrieved += 1
        status = self.statuses[min(self.retrieved - 1, len(self.statuses) - 1)]
        index = int(batch_id.split('-')[1]) - 1
        done = status == 'completed'
        if done:
            lines = []
            for item in self.uploads[index]:
                text = item['body']['input'][::-1]
                if self.fail_on and self.fail_on in item['body']['input']:
                    lines.append({'custom_id': item['custom_id'], 'response': None, 'error': {'code': 'server_error', 'message': 'x'}})
                elif self.bad_status and self.bad_status in item['body']['input']:
                    lines.append({'custom_id': item['custom_id'], 'response': {'status_code': 200, 'body': body(text, status='incomplete')}, 'error': None})
                else:
                    payload = '{"value": 3}' if 'text' in item['body'] else text
                    lines.append({'custom_id': item['custom_id'], 'response': {'status_code': 200, 'body': body(payload)}, 'error': None})
            self.files_store[f'out-{index}'] = '\n'.join(json.dumps(line) for line in lines)
        return SimpleNamespace(id=batch_id, status=status, output_file_id=f'out-{index}' if done else None, error_file_id=None, errors=None)

    def _file_content(self, file_id):
        return SimpleNamespace(text=self.files_store[file_id])


def batch_executor(tmp_path, client, llm, **kw):
    return BatchExecutor(llm, client, tmp_path / 'batches', poll=0, sleep=lambda s: None, **kw)


def reqs(llm, *items, schema=None):
    planner = Planner(llm)
    for text in items:
        with pytest.raises(Pending):
            planner.ask('gen', 'ins', text, schema=schema, max_output_tokens=500)
    return planner.requests


def test_batch_executor_uploads_polls_and_fills_the_cache_at_batch_prices(tmp_path):
    client = BatchFake()
    llm = make_llm(tmp_path)
    requests = reqs(llm, 'abc', 'xyz')
    failed = batch_executor(tmp_path, client, llm)(requests)
    assert failed == set()
    upload = client.uploads[0]
    assert [u['url'] for u in upload] == ['/v1/responses'] * 2 and [u['method'] for u in upload] == ['POST'] * 2
    assert {u['custom_id'] for u in upload} == set(requests)
    assert upload[0]['body']['model'] == 'm' and upload[0]['body']['store'] is False and upload[0]['body']['max_output_tokens'] == 500
    assert client.created == [{'input_file_id': 'file-0', 'endpoint': '/v1/responses', 'window': '24h'}]
    assert llm.ask('gen', 'ins', 'abc', max_output_tokens=500) == 'cba'          # 캐시에서 읽힌다(호출 없음)
    rows = llm.cost.rows()
    assert len(rows) == 2 and all(r['batch'] and not r['failed'] for r in rows)


def test_batch_executor_sends_structured_requests_with_a_json_schema(tmp_path):
    client = BatchFake()
    llm = make_llm(tmp_path)
    requests = reqs(llm, 'abc', schema=Out)
    assert batch_executor(tmp_path, client, llm)(requests) == set()
    fmt = client.uploads[0][0]['body']['text']['format']
    assert fmt['type'] == 'json_schema' and fmt['strict'] is True and fmt['name'] == 'Out' and fmt['schema']['additionalProperties'] is False
    assert llm.ask('gen', 'ins', 'abc', schema=Out, max_output_tokens=500) == Out(value=3)


def test_batch_executor_reports_partial_failures_honestly(tmp_path):
    client = BatchFake(fail_on='bad-line', bad_status='cut-off')
    llm = make_llm(tmp_path)
    requests = reqs(llm, 'good', 'bad-line', 'cut-off')
    failed = batch_executor(tmp_path, client, llm)(requests)
    keys = {r.input: k for k, r in requests.items()}
    assert failed == {keys['bad-line'], keys['cut-off']}
    assert llm.ask('gen', 'ins', 'good', max_output_tokens=500) == 'doog'
    assert not llm.is_cached('ins', 'bad-line', max_output_tokens=500) and not llm.is_cached('ins', 'cut-off', max_output_tokens=500)
    rows = llm.cost.rows()
    assert sum(r['failed'] for r in rows) == 1            # 잘린 응답은 청구되므로 기록하고, 줄 오류는 토큰이 없다


def test_batch_executor_resumes_a_submitted_batch_instead_of_resubmitting(tmp_path):
    llm = make_llm(tmp_path)
    requests = reqs(llm, 'abc')

    class Crash(BatchFake):
        def _retrieve(self, batch_id):
            raise KeyboardInterrupt

    crashing = Crash()
    with pytest.raises(KeyboardInterrupt):
        batch_executor(tmp_path, crashing, llm)(requests)
    assert len(crashing.created) == 1
    client = BatchFake()
    client.uploads = list(crashing.uploads)          # 같은 서버라고 보고 업로드 기록을 이어 준다
    client.files_store = dict(crashing.files_store)
    assert batch_executor(tmp_path, client, llm)(requests) == set()
    assert client.created == []                      # 새 배치를 만들지 않았다
    assert llm.is_cached('ins', 'abc', max_output_tokens=500)


def test_batch_executor_splits_requests_into_chunks(tmp_path):
    client = BatchFake()
    llm = make_llm(tmp_path)
    requests = reqs(llm, *[f'text{i}' for i in range(5)])
    assert batch_executor(tmp_path, client, llm, max_requests=2)(requests) == set()
    assert [len(u) for u in client.uploads] == [2, 2, 1]


def test_hybrid_executor_uses_sync_for_small_rounds_and_batch_for_large(tmp_path):
    calls = []
    llm = make_llm(tmp_path)
    sync = lambda r: calls.append(('sync', len(r))) or set()  # noqa: E731
    batch = lambda r: calls.append(('batch', len(r))) or set()  # noqa: E731
    hybrid = HybridExecutor(sync, batch, threshold=3)
    hybrid(reqs(llm, 'a', 'b'))
    hybrid(reqs(llm, 'c', 'd', 'e'))
    assert calls == [('sync', 2), ('batch', 3)]


def test_estimate_uses_chars_per_token_and_batch_discount(tmp_path):
    llm = make_llm(tmp_path)
    requests = reqs(llm, 'x' * 1500)
    tokens_in, tokens_out, cost = estimate(requests, batch=False, chars_per_token=1.5, out_tokens={'gen': 300})
    assert tokens_in >= 1000 and tokens_out == 300
    assert estimate(requests, batch=False, chars_per_token=1.5, out_tokens={'gen': 9000})[1] == 500   # max_output_tokens(500)를 넘지 않는다
    assert estimate(requests, batch=True, chars_per_token=1.5, out_tokens={'gen': 300})[2] == pytest.approx(cost / 2)


def test_round_collects_every_independent_request_before_raising_pending(tmp_path):
    llm = make_llm(tmp_path)
    planner = Planner(llm)
    step = Round()
    assert step.get(lambda: planner.ask('k', 'ins', 'a')) == (None, False)      # 둘 다 캐시에 없다: 첫 Pending 뒤에도 둘째를 요청한다
    assert step.get(lambda: planner.ask('k', 'ins', 'b')) == (None, False)
    assert len(planner.requests) == 2
    with pytest.raises(Pending):
        step.done()
    llm.ask('k', 'ins', 'a')
    ready = Round()
    assert ready.get(lambda: Planner(llm).ask('k', 'ins', 'a')) == ('a'[::-1], False)
    ready.done()                                                                  # 대기가 없으면 통과


def test_round_reports_permanent_failures_without_stopping():
    def fail():
        raise LlmFailure('x')
    step = Round()
    assert step.get(fail) == (None, True)
    step.done()
