"""검증 실행 단위 테스트: 라운드 흐름(생성 → 공간·시간·성격 채점 → 둘째 채점)·집단별 집계·짝 검정(대역 클라이언트, 네트워크 없음)."""

from types import SimpleNamespace

from batch import SyncExecutor, run_rounds
from cost import CostLog
from kt_context import CONFIGS
from kt_run import context_rates, group_report, ko_system_prompt, make_work, subset
from llm import Ledger, Llm

TEMPLATES = {'spatiotemporal': 'S [Interactions] {question_0} {answer_0} [Fact] {agent_fact_0} Spatiotemporal Consistency {agent_name}',
             'personality': 'P {question_0} {response_0} {agent_personality} Personality Consistency {agent_name}'}


class Fake:
    """responses.create 대역: 생성은 고정 응답, 공간 기준이 'Absence:'면 0, 그 밖의 시공간은 1, 성격은 5점."""

    def __init__(self):
        self.calls = []
        self.responses = SimpleNamespace(create=self._create)

    def _create(self, **kw):
        text = kw['input']
        self.calls.append('judge' if 'Consistency' in text else 'gen')
        out = ('근거\n5\n5' if 'Personality Consistency' in text else '근거\n0\n0' if 'Absence:' in text else '근거\n1\n1') if 'Consistency' in text else '인물의 응답'
        usage = SimpleNamespace(input_tokens=10, output_tokens=5, input_tokens_details=SimpleNamespace(cached_tokens=0))
        return SimpleNamespace(status='completed', usage=usage, model='m', output_text=out)


def row(idx, kind, **kw):
    base = {'idx': idx, 'id': f'w-{idx}', 'work': 'w', 'kind': 'web', 'genre': '무협', 'data_type': kind, 'character': '철수', 'cutoff': 3,
            'question': f'질문 {idx}', 'temporal_label': 'T', 'spatial_label': {'past-absence': 'Absence: x', 'past-presence': 'Presence: x'}.get(kind, '-')}
    return base | kw


def contexts_for(rows, configs=('zero', 's3')):
    return {r['idx']: {c: {'items': [] if c == 'zero' else [{'ref': 'card:c1', 'text': '문맥'}], 'future': c == 'zero', 'foreign': False, 'unseen': False}
                       for c in configs} for r in rows}


def run(tmp_path, rows, configs=('zero', 's3')):
    fake = Fake()
    llm = Llm(Ledger(tmp_path / 'l.jsonl', 10 ** 6), tmp_path / 'cache', model='m', client=fake, backoff=0, cost=CostLog(tmp_path / 'c.jsonl'))
    work = make_work(contexts_for(rows, configs), TEMPLATES, {'w': {'철수': '용감하다.'}})
    records = run_rounds([(r, c) for r in rows for c in configs], work, llm, SyncExecutor(llm))
    return records, fake


def test_make_work_generates_then_judges_and_skips_time_when_the_spatial_score_is_zero(tmp_path):
    rows = [row(0, 'future'), row(1, 'past-absence'), row(2, 'past-presence')]
    records, fake = run(tmp_path, rows)
    by = {(r['idx'], r['config']): r for r in records}
    assert by[0, 's3']['score'] == 1 and by[0, 's3']['temporal'] == 1 and by[0, 's3']['spatial'] is None
    assert by[1, 's3']['score'] == 0 and by[1, 's3']['spatial'] == 0 and by[1, 's3']['temporal'] == 0     # 공간 0이면 시간은 묻지 않는다
    assert by[2, 's3']['score'] == 1 and by[2, 's3']['spatial'] == 1 and by[2, 's3']['temporal'] == 1
    assert by[0, 'zero']['personality'] == 5 and by[0, 's3']['personality'] == 5 and by[0, 'zero']['future_ctx'] is True
    assert by[0, 's3']['response'] == '인물의 응답' and by[0, 's3']['kind'] == 'web' and by[0, 's3']['work'] == 'w'


def test_make_work_counts_a_missing_personality_text_as_not_scored_not_as_a_failure(tmp_path):
    rows = [row(0, 'future', character='영희')]
    records, _ = run(tmp_path, rows)
    assert records[0]['score'] == 1 and records[0]['personality'] is None


def test_group_report_summarizes_and_pairs_within_each_group():
    records = []
    for idx in range(8):
        for config, score in (('zero', 0), ('s3', 1 if idx < 7 else 0)):
            records.append({'idx': idx, 'config': config, 'data_type': 'future', 'score': score, 'personality': None, 'future_ctx': config == 'zero',
                            'foreign_ctx': False, 'unseen_ctx': config == 'zero', 'kind': 'web' if idx < 4 else 'classic', 'genre': '무협' if idx < 4 else '고전'})
    out = group_report(records, 'kind', pairs=(('s3', 'zero'),))
    assert set(out) == {'web', 'classic'}
    assert out['web']['configs']['s3']['by_type']['future']['score'] == 1.0 and out['classic']['configs']['s3']['by_type']['future']['score'] == 0.75
    assert out['web']['paired']['s3|zero'] == {'a_only': 4, 'b_only': 0, 'p': 0.125}
    assert out['web']['leak']['zero'] == {'future_ctx': 1.0, 'unseen_ctx': 1.0, 'foreign_ctx': 0.0}


def test_subset_is_deterministic_and_keeps_the_requested_size_and_all_types_when_possible():
    rows = [row(i, kind) for i, kind in enumerate(['future', 'past-only', 'past-absence', 'past-presence'] * 10)]
    assert subset(rows, 8) == subset(rows, 8) and len(subset(rows, 8)) == 8
    assert {r['data_type'] for r in subset(rows, 8)} == {'future', 'past-only', 'past-absence', 'past-presence'}
    assert subset(rows, 100) == rows
    assert 'Absence:' not in ko_system_prompt('철수', 3) and '철수' in ko_system_prompt('철수', 3) and '3화' in ko_system_prompt('철수', 3)


def test_context_rates_average_each_flag_per_configuration_and_per_type():
    rows = [row(0, 'future'), row(1, 'future'), row(2, 'past-only')]
    contexts = {0: {c: {'items': [1, 2], 'future': True, 'foreign': False, 'unseen': False} for c in CONFIGS},
                1: {c: {'items': [1], 'future': False, 'foreign': True, 'unseen': True} for c in CONFIGS},
                2: {c: {'items': [], 'future': True, 'foreign': False, 'unseen': False} for c in CONFIGS}}
    rate = context_rates(rows, contexts)['s3']
    assert rate['all'] == {'questions': 3, 'future': 2 / 3, 'unseen': 1 / 3, 'foreign': 1 / 3, 'items': 1.0}
    assert rate['by_type']['future']['future'] == 0.5 and rate['by_type']['past-only']['items'] == 0.0 and 'past-absence' not in rate['by_type']
