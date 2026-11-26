"""검증 실행 단위 테스트: 라운드 흐름(생성 → 공간·시간·성격 채점 → 둘째 채점)·집단별 집계·짝 검정(대역 클라이언트, 네트워크 없음)."""

import json
from collections import Counter
from types import SimpleNamespace

import pytest

import kt_run
from batch import SyncExecutor, run_rounds
from cost import MODEL, CostLog
from kt_context import CONFIGS
from kt_run import context_rates, embed_group, group_report, ko_system_prompt, make_work
from llm import Ledger, Llm

TEMPLATES = {'spatiotemporal': 'S [Interactions] {question_0} {answer_0} [Fact] {agent_fact_0} Spatiotemporal Consistency {agent_name}',
             'personality': 'P {question_0} {response_0} {agent_personality} Personality Consistency {agent_name}'}


class Fake:
    """responses.create 대역: 생성은 고정 응답, 공간 기준이 'Absence:'면 0, 그 밖의 시공간은 verdict(기본 1), 성격은 5점."""

    def __init__(self, verdict='1'):
        self.calls, self.verdict = [], verdict
        self.responses = SimpleNamespace(create=self._create)

    def _create(self, **kw):
        text = kw['input']
        self.calls.append('judge' if 'Consistency' in text else 'gen')
        out = ('근거\n5\n5' if 'Personality Consistency' in text else '근거\n0\n0' if 'Absence:' in text else f'근거\n{self.verdict}\n{self.verdict}') if 'Consistency' in text else '인물의 응답'
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


def test_ko_system_prompt_names_the_character_and_cutoff():
    prompt = ko_system_prompt('철수', 3)
    assert '철수' in prompt and '3화' in prompt and 'Absence:' not in prompt


def test_embed_group_keeps_the_first_works_together_and_separates_each_expansion():
    assert {embed_group(w) for w in ('c01', 'c05', 'w01', 'w12')} == {0} and {embed_group(w) for w in ('w13', 'w40')} == {1}
    assert embed_group('w41') == embed_group('w48') == 2           # ROUNDS = (12, 40, 48)


def test_build_contexts_embeds_each_group_with_all_its_questions_even_when_only_some_works_run(monkeypatch):
    embedded = []

    def fake_embed(texts, kind):
        embedded.append(list(texts))
        return [(len(texts), i) for i in range(len(texts))]                      # 같은 묶음의 질문 수와 위치가 벡터를 대신한다

    monkeypatch.setattr(kt_run, 'embed_texts', fake_embed)
    monkeypatch.setattr(kt_run, 'contexts_for', lambda r, data, knowledge, vector: (r['work'], vector))
    rows = [{'idx': 0, 'work': 'c01', 'question': 'q0'}, {'idx': 1, 'work': 'w13', 'question': 'q1'}, {'idx': 2, 'work': 'w14', 'question': 'q2'}]
    contexts = kt_run.build_contexts(rows, {'w14': {'knowledge': []}})            # w14만 실행해도
    assert contexts == {2: ('w14', (2, 1))} and embedded == [['q0'], ['q1', 'q2']]   # 벡터는 w13과 함께 묶은 임베딩에서 나온다(전체 실행과 같다)


def test_context_rates_average_each_flag_per_configuration_and_per_type():
    rows = [row(0, 'future'), row(1, 'future'), row(2, 'past-only')]
    contexts = {0: {c: {'items': [1, 2], 'future': True, 'foreign': False, 'unseen': False} for c in CONFIGS},
                1: {c: {'items': [1], 'future': False, 'foreign': True, 'unseen': True} for c in CONFIGS},
                2: {c: {'items': [], 'future': True, 'foreign': False, 'unseen': False} for c in CONFIGS}}
    rate = context_rates(rows, contexts)['s3']
    assert rate['all'] == {'questions': 3, 'future': 2 / 3, 'unseen': 1 / 3, 'foreign': 1 / 3, 'items': 1.0}
    assert rate['by_type']['future']['future'] == 0.5 and rate['by_type']['past-only']['items'] == 0.0 and 'past-absence' not in rate['by_type']


# ---- 응답 모델과 채점 모델을 나눈 실행·다시 채점·이름 붙인 결과 ----

def fake_llm(tmp_path, tag, fake, model=None, via=None):
    llm = Llm(Ledger(tmp_path / f'{tag}-ledger.jsonl', 10 ** 6), tmp_path / f'cache-{tag}', model=model or tag, client=fake, backoff=0,
              cost=CostLog(tmp_path / f'cost-{tag}.jsonl'))
    if via:
        llm.via = via
    return llm


def sandbox(tmp_path, monkeypatch, rows):
    """kt_run을 임시 폴더와 대역 입력으로 돌린다(실제 데이터·임베딩·게이트웨이 없이). 불러온 것을 기록해 두 번째 값으로 돌려준다."""
    kt, tc, loaded = tmp_path / 'kt', tmp_path / 'tc', []
    (kt / 'runs').mkdir(parents=True)
    tc.mkdir()
    (tc / 'spatiotemporal_consistency_evaluation_prompt.txt').write_text(TEMPLATES['spatiotemporal'])
    (tc / 'personality_consistency_evaluation_prompt.txt').write_text(TEMPLATES['personality'])
    (kt / 'personalities.json').write_text(json.dumps({'w': {'철수': '용감하다.'}}, ensure_ascii=False))
    for name, value in {'KT': kt, 'TC': tc, 'RESULTS': tmp_path / 'results', 'COST': tmp_path / 'cost.jsonl',
                        'load_rows': lambda: loaded.append('rows') or rows,
                        'build_data': lambda wids: loaded.append('data') or {w: {} for w in wids},
                        'build_contexts': lambda every, data, only=None: loaded.append('contexts') or {
                            i: c for i, c in contexts_for(rows, CONFIGS).items() if only is None or i in only}}.items():
        monkeypatch.setattr(kt_run, name, value)
    return kt, loaded


def spy_plans(monkeypatch):
    """run_rounds가 받은 plan(예상 금액 점검)을 모은다."""
    plans, real = [], kt_run.run_rounds
    monkeypatch.setattr(kt_run, 'run_rounds', lambda *args, **kw: plans.append(kw['plan']) or real(*args, **kw))
    return plans


def test_run_sends_the_generation_to_the_gen_llm_and_the_judging_to_the_judge_llm(tmp_path, monkeypatch):
    kt, _ = sandbox(tmp_path, monkeypatch, [row(0, 'future'), row(1, 'past-presence')])
    plans = spy_plans(monkeypatch)
    gen, judge, made = Fake(), Fake(), []
    monkeypatch.setattr(kt_run, 'make_gen_llm', lambda model, name, limit_usd, effort: made.append(('gen', model, name, limit_usd, effort)) or fake_llm(
        tmp_path, 'gen', gen, model=model, via='ocx'))
    monkeypatch.setattr(kt_run, 'make_judge_llm', lambda model, cost: made.append(('judge', model, cost)) or fake_llm(tmp_path, 'judge', judge, via='ocx'))
    kt_run.run('sync', ('zero', 's3'), gen_model='google/gemini-3.8-flash', name='g1', limit_usd=5.0, gen_effort='low')
    assert plans == [None]                                                                                            # 나눈 실행은 luna 단가표로 어림하지 않는다
    assert made == [('gen', 'google/gemini-3.8-flash', 'g1', 5.0, 'low'), ('judge', 'gpt-6.2-sol', kt / 'cost-g1.jsonl')]   # 채점 기본은 sol, 장부는 이름 붙은 한 파일, 강도는 응답 쪽만
    assert gen.calls and set(gen.calls) == {'gen'} and judge.calls and set(judge.calls) == {'judge'}                  # 서로 다른 Llm으로 갔다
    records = json.loads((kt / 'runs' / 'rows-g1.json').read_text())
    assert len(records) == 4 and {r['score'] for r in records} == {1} and {r['response'] for r in records} == {'인물의 응답'}
    assert {(r['gen_model'], r['gen_via'], r['judge_model'], r['judge_via']) for r in records} == {('google/gemini-3.8-flash', 'ocx', 'gpt-6.2-sol', 'ocx')}


def test_a_named_run_without_personality_writes_only_its_own_files(tmp_path, monkeypatch):
    kt, _ = sandbox(tmp_path, monkeypatch, [row(0, 'future')])
    (kt / 'runs' / 'rows.json').write_text('KEEP')
    (tmp_path / 'cost.jsonl').write_text('KEEP')
    plans = spy_plans(monkeypatch)
    fake, seen = Fake(), []
    monkeypatch.setattr(kt_run, 'make_llm', lambda **kw: seen.append(kw) or fake_llm(tmp_path, 'one', fake))
    kt_run.run('sync', ('zero', 's3'), name='np', personality=False)
    assert seen[0]['cost_path'] == kt / 'cost-np.jsonl' and isinstance(plans[0], dict)                                  # 하나의 Llm이 하는 지금 방식은 예상 금액 점검을 그대로 한다
    assert (kt / 'runs' / 'rows.json').read_text() == 'KEEP' and (tmp_path / 'cost.jsonl').read_text() == 'KEEP'        # 기존 파일은 그대로
    records = json.loads((kt / 'runs' / 'rows-np.json').read_text())
    assert len(records) == 2 and {r['personality'] for r in records} == {None} and {r['score'] for r in records} == {1}
    assert fake.calls.count('judge') == 1                                                                             # 두 구성이 같은 시공간 채점 한 번을 나눠 쓴다(성격 채점은 없다)
    assert {(r['gen_via'], r['judge_via'], r['judge_model']) for r in records} == {('openai', 'openai', 'one')}         # 채점 모델을 따로 주지 않으면 응답 모델이 채점한다


@pytest.mark.parametrize('options', [{'gen_model': 'gemini-3.8-flash', 'limit_usd': 1.0}, {'judge_model': 'gpt-6.2-sol'}, {'limit': 4}, {'personality': False}])
def test_options_that_change_the_result_need_a_name_so_the_plain_files_are_never_overwritten(options, tmp_path, monkeypatch):
    kt, loaded = sandbox(tmp_path, monkeypatch, [row(0, 'future')])
    (kt / 'runs' / 'rows.json').write_text('KEEP')
    with pytest.raises(SystemExit):
        kt_run.run('sync', ('zero',), **options)
    assert loaded == [] and (kt / 'runs' / 'rows.json').read_text() == 'KEEP'


@pytest.mark.parametrize('options', [{'gen_model': 'mystery-9', 'limit_usd': 5.0}, {'gen_model': 'gemini-3.8-flash'}])
def test_a_gen_model_without_a_price_or_a_cap_stops_before_anything_is_loaded_or_called(options, tmp_path, monkeypatch):
    kt, loaded = sandbox(tmp_path, monkeypatch, [row(0, 'future')])
    with pytest.raises(SystemExit):
        kt_run.run('sync', ('zero',), name='g', **options)
    assert loaded == [] and not (kt / 'cost-g.jsonl').exists() and not list(tmp_path.glob('cache*'))


def test_an_empty_config_list_stops_before_anything_is_loaded_instead_of_writing_an_empty_result_over_the_old_one(tmp_path, monkeypatch):
    kt, loaded = sandbox(tmp_path, monkeypatch, [row(0, 'future')])
    (kt / 'runs' / 'rows.json').write_text('KEEP')
    with pytest.raises(SystemExit):
        kt_run.run('sync', ())
    assert loaded == [] and (kt / 'runs' / 'rows.json').read_text() == 'KEEP'


def test_gen_effort_needs_a_gen_model_because_only_the_gateway_response_calls_carry_it(tmp_path, monkeypatch):
    kt, loaded = sandbox(tmp_path, monkeypatch, [row(0, 'future')])
    with pytest.raises(SystemExit):
        kt_run.run('sync', ('zero',), name='g', gen_effort='low')
    assert loaded == [] and not (kt / 'cost-g.jsonl').exists()


def test_the_gateway_path_cannot_run_as_a_batch(tmp_path, monkeypatch):
    kt, loaded = sandbox(tmp_path, monkeypatch, [row(0, 'future')])
    monkeypatch.setattr(kt_run, 'make_gen_llm', lambda model, name, limit_usd, effort: fake_llm(tmp_path, 'gen', Fake(), model=model, via='ocx'))
    monkeypatch.setattr(kt_run, 'make_judge_llm', lambda model, cost: fake_llm(tmp_path, 'judge', Fake(), via='ocx'))
    with pytest.raises(SystemExit):
        kt_run.run('batch', ('zero',), gen_model='gemini-3.8-flash', limit_usd=1.0, name='g')
    assert loaded == []


def test_a_pilot_run_judges_only_the_sampled_questions_and_builds_only_their_contexts(tmp_path, monkeypatch):
    rows = [row(i, kind) for i, kind in enumerate(['future'] * 6 + ['past-only'] * 6)]
    kt, _ = sandbox(tmp_path, monkeypatch, rows)
    monkeypatch.setattr(kt_run, 'make_llm', lambda **kw: fake_llm(tmp_path, 'one', Fake()))
    kt_run.run('sync', ('zero',), name='pilot', limit=4)
    records = json.loads((kt / 'runs' / 'rows-pilot.json').read_text())
    assert len(records) == 4 and Counter(r['data_type'] for r in records) == {'future': 2, 'past-only': 2}


def test_a_partial_works_run_without_a_name_does_not_write_rows_json(tmp_path, monkeypatch):
    kt, _ = sandbox(tmp_path, monkeypatch, [row(0, 'future')])
    monkeypatch.setattr(kt_run, 'make_llm', lambda **kw: fake_llm(tmp_path, 'one', Fake()))
    kt_run.run('sync', ('zero',), ('w',))                                        # 작품을 거른 실행은 캐시만 채운다
    assert not list((kt / 'runs').glob('rows*.json'))


def test_run_and_report_refuse_a_name_that_is_a_path(tmp_path, monkeypatch):
    _, loaded = sandbox(tmp_path, monkeypatch, [row(0, 'future')])
    for call in (lambda: kt_run.run('sync', ('zero',), name='../x'), lambda: kt_run.report('../x')):
        with pytest.raises(SystemExit):
            call()
    assert loaded == []


def first_run(tmp_path, monkeypatch, rows):
    """응답을 만들고 채점(모두 1점)한 rows-first.json을 만든다(구성 zero·s3)."""
    kt, loaded = sandbox(tmp_path, monkeypatch, rows)
    monkeypatch.setattr(kt_run, 'make_llm', lambda **kw: fake_llm(tmp_path, 'one', Fake()))
    kt_run.run('sync', ('zero', 's3'), name='first')
    return kt, loaded


def test_rejudge_scores_the_saved_responses_with_the_new_judge_only_and_keeps_failed_records_failed(tmp_path, monkeypatch):
    kt, loaded = first_run(tmp_path, monkeypatch, [row(0, 'future'), row(1, 'past-absence'), row(2, 'future')])
    saved = json.loads((kt / 'runs' / 'rows-first.json').read_text())
    saved[0].update(response=None, score=None)                                  # 응답이 없는(실패) 기록 하나
    for key in ('gen_model', 'gen_via'):                                        # 응답 모델 기록이 없는 옛 기록 하나
        saved[1].pop(key)
    (kt / 'runs' / 'rows-first.json').write_text(json.dumps(saved, ensure_ascii=False))
    judge, made = Fake(verdict='0'), []
    monkeypatch.setattr(kt_run, 'make_judge_llm', lambda model, cost: made.append((model, cost)) or fake_llm(tmp_path, 'judge', judge, via='ocx'))
    loaded.clear()
    kt_run.rejudge('rows-first.json', 'second', ('zero', 's3'), 'gpt-6.2-sol')
    assert made == [('gpt-6.2-sol', kt / 'cost-second.jsonl')] and set(judge.calls) == {'judge'}                      # 생성은 부르지 않았다
    assert 'contexts' not in loaded                                             # 문맥을 다시 만들지 않는다
    second = {(r['idx'], r['config']): r for r in json.loads((kt / 'runs' / 'rows-second.json').read_text())}
    assert len(second) == 6
    assert second[0, 'zero']['response'] is None and second[0, 'zero']['score'] is None and second[0, 'zero']['personality'] is None
    assert all(r['score'] == 0 and r['response'] == '인물의 응답' for k, r in second.items() if k != (0, 'zero'))       # 새 채점이 이긴다, 응답은 그대로
    assert {r['judge_model'] for r in second.values()} == {'gpt-6.2-sol'} and {r['judge_via'] for r in second.values()} == {'ocx'}
    assert second[saved[1]['idx'], saved[1]['config']]['gen_model'] == MODEL and second[saved[1]['idx'], saved[1]['config']]['gen_via'] == 'openai'   # 옛 기록은 옛 실행의 응답 모델
    assert second[2, 's3']['gen_model'] == 'one' and second[2, 's3']['gen_via'] == 'openai'                                                  # 기록에 있으면 그대로 옮긴다
    assert {r['personality'] for r in second.values()} == {5, None}             # 성격도 다시 채점한다(응답이 없는 기록만 없음)


def test_rejudge_limits_by_type_skips_other_configs_and_never_overwrites_its_source(tmp_path, monkeypatch):
    rows = [row(i, kind) for i, kind in enumerate(['future'] * 4 + ['past-only'] * 4)]
    kt, _ = first_run(tmp_path, monkeypatch, rows)
    monkeypatch.setattr(kt_run, 'make_judge_llm', lambda model, cost: fake_llm(tmp_path, 'judge', Fake(verdict='0')))
    with pytest.raises(SystemExit):                                              # 입력 기록을 같은 이름으로 덮지 않는다
        kt_run.rejudge('rows-first.json', 'first', ('zero', 's3'), 'gpt-6.2-sol')
    with pytest.raises(SystemExit):                                              # 같은 파일을 다른 경로 표기로 줘도 덮지 않는다
        kt_run.rejudge('../runs/rows-first.json', 'first', ('zero', 's3'), 'gpt-6.2-sol')
    with pytest.raises(SystemExit):                                              # 고른 구성이 기록에 없으면 빈 결과를 성공처럼 쓰지 않는다
        kt_run.rejudge('rows-first.json', 'none', ('s9',), 'gpt-6.2-sol')
    stale = json.loads((kt / 'runs' / 'rows-first.json').read_text())
    stale[3]['id'] = 'other-work-3'
    (kt / 'runs' / 'rows-stale.json').write_text(json.dumps(stale, ensure_ascii=False))
    with pytest.raises(SystemExit):                                              # 질문 파일을 다시 만들어 idx·id가 어긋난 기록은 엉뚱한 질문으로 채점하지 않는다
        kt_run.rejudge('rows-stale.json', 'stale-out', ('zero', 's3'), 'gpt-6.2-sol')
    kt_run.rejudge('rows-first.json', 'few', ('s3',), 'gpt-6.2-sol', personality=False, limit=4)
    few = json.loads((kt / 'runs' / 'rows-few.json').read_text())
    assert len(few) == 4 and {r['config'] for r in few} == {'s3'} and Counter(r['data_type'] for r in few) == {'future': 2, 'past-only': 2}
    assert {r['personality'] for r in few} == {None}
    assert not (kt / 'runs' / 'rows-none.json').exists() and len(json.loads((kt / 'runs' / 'rows-first.json').read_text())) == 16


def test_pilot_keeps_the_type_ratio_with_a_fixed_seed_in_question_order():
    rows = [row(i, kind) for i, kind in enumerate(['future'] * 40 + ['past-only'] * 40 + ['past-absence'] * 20 + ['past-presence'] * 20)]
    picked = kt_run.pilot(rows, 24)
    assert Counter(r['data_type'] for r in picked) == {'future': 8, 'past-only': 8, 'past-absence': 4, 'past-presence': 4}
    assert [r['idx'] for r in picked] == sorted(r['idx'] for r in picked) and kt_run.pilot(rows, 24) == picked
    assert kt_run.pilot(rows, None) is rows and kt_run.pilot(rows, 200) is rows
    with pytest.raises(SystemExit):
        kt_run.pilot(rows, 0)


@pytest.mark.parametrize('name', ['', '../x', 'a/b', '.hidden', 'a b', 'data', 'context', 'sample'])
def test_check_name_rejects_paths_and_names_that_collide_with_existing_result_files(name):
    with pytest.raises(SystemExit):
        kt_run.check_name(name)
    assert kt_run.check_name('gemini-flash.v2') == 'gemini-flash.v2'


def record(idx, config, score, **kw):
    return {'idx': idx, 'config': config, 'data_type': 'future', 'score': score, 'personality': None, 'future_ctx': config == 'zero', 'foreign_ctx': False,
            'unseen_ctx': False, 'kind': 'web', 'genre': '무협', **kw}


def test_report_with_a_name_aggregates_that_rows_file_skips_missing_pairs_and_leaves_the_plain_result_alone(tmp_path, monkeypatch):
    kt, _ = sandbox(tmp_path, monkeypatch, [row(i, 'future') for i in range(4)])
    stamp = {'gen_model': 'google/gemini-3.8-flash', 'gen_via': 'ocx', 'judge_model': 'gpt-6.2-sol', 'judge_via': 'ocx'}
    records = [record(i, c, s, **stamp) for i in range(4) for c, s in (('zero', 0), ('s3', 1))]
    (kt / 'runs' / 'rows-x.json').write_text(json.dumps(records))
    (tmp_path / 'results').mkdir()
    (tmp_path / 'results' / 'ko-timechara.json').write_text('KEEP')
    kt_run.report('x')
    result = json.loads((tmp_path / 'results' / 'ko-timechara-x.json').read_text())
    assert (tmp_path / 'results' / 'ko-timechara.json').read_text() == 'KEEP'
    assert set(result['configs']) == {'zero', 's3'} and set(result['paired']) == {'s3|zero'} and set(result['by_kind']['web']['paired']) == {'s3|zero'}
    assert set(result['by_type_paired']['future']) == {'s3|zero'}
    assert result['models'] == {'gen_model': ['google/gemini-3.8-flash'], 'gen_via': ['ocx'], 'judge_model': ['gpt-6.2-sol'], 'judge_via': ['ocx']}


def test_the_plain_report_keeps_its_shape_and_prints_even_when_every_call_failed(tmp_path, monkeypatch, capsys):
    kt, _ = sandbox(tmp_path, monkeypatch, [row(0, 'future')])
    (kt / 'runs' / 'rows.json').write_text(json.dumps([record(0, 'zero', None), record(0, 's3', None)]))
    kt_run.report()
    result = json.loads((tmp_path / 'results' / 'ko-timechara.json').read_text())
    assert 'models' not in result and result['configs']['s3']['failed'] == 1 and result['paired'] == {'s3|zero': result['paired']['s3|zero']}
    assert 's3' in capsys.readouterr().out                                       # 점수가 하나도 없어도(가중 평균 None) 표를 출력한다


def test_build_contexts_only_builds_the_asked_questions_but_embeds_their_whole_group(monkeypatch):
    embedded = []
    monkeypatch.setattr(kt_run, 'embed_texts', lambda texts, kind: embedded.append(list(texts)) or [(len(texts), i) for i in range(len(texts))])
    monkeypatch.setattr(kt_run, 'contexts_for', lambda r, data, knowledge, vector: (r['work'], vector))
    rows = [{'idx': 0, 'work': 'w13', 'question': 'q0'}, {'idx': 1, 'work': 'w13', 'question': 'q1'}]
    assert kt_run.build_contexts(rows, {'w13': {'knowledge': []}}, only={1}) == {1: ('w13', (2, 1))} and embedded == [['q0', 'q1']]   # 벡터는 전체 묶음에서 나온다


@pytest.mark.parametrize('effort', ['minimal', 'low', 'medium', 'high', 'xhigh', 'max'])
def test_main_accepts_every_effort_the_gateway_models_take(effort, monkeypatch):
    efforts = []
    monkeypatch.setattr(kt_run, 'run', lambda *args, **kw: efforts.append(kw['gen_effort']))
    kt_run.main(['run', '--gen-model=gpt-6-luna', f'--gen-effort={effort}', '--name=l', '--limit-usd=1'])
    assert efforts == [effort]


def test_main_passes_the_new_options_and_refuses_ones_it_does_not_know(monkeypatch):
    calls = []
    monkeypatch.setattr(kt_run, 'run', lambda *args, **kw: calls.append(('run', args, kw)))
    monkeypatch.setattr(kt_run, 'rejudge', lambda *args, **kw: calls.append(('rejudge', args, kw)))
    monkeypatch.setattr(kt_run, 'report', lambda *args: calls.append(('report', args)))
    kt_run.main(['run', '--gen-model=google/gemini-3.8-flash', '--gen-effort=low', '--limit-usd=5', '--limit=40', '--name=g1', '--no-personality', '--configs=zero,s3'])
    kt_run.main(['rejudge', '--name=sol', '--configs=zero', '--limit=8'])
    kt_run.main(['rejudge', '--from=rows-g1.json', '--name=sol2', '--judge-model=gpt-6-luna', '--no-personality'])
    kt_run.main(['run', '--configs=zero'])
    kt_run.main(['report', '--name=g1'])
    kt_run.main(['report'])
    assert calls == [
        ('run', ('sync', ('zero', 's3'), ()), {'gen_model': 'google/gemini-3.8-flash', 'gen_effort': 'low', 'judge_model': None, 'name': 'g1', 'limit_usd': 5.0, 'limit': 40, 'personality': False}),
        ('rejudge', ('rows.json', 'sol', ('zero',)), {'judge_model': 'gpt-6.2-sol', 'personality': True, 'limit': 8}),
        ('rejudge', ('rows-g1.json', 'sol2', CONFIGS), {'judge_model': 'gpt-6-luna', 'personality': False, 'limit': None}),
        ('run', ('sync', ('zero',), ()), {'gen_model': None, 'gen_effort': None, 'judge_model': None, 'name': None, 'limit_usd': None, 'limit': None, 'personality': True}),
        ('report', ('g1',)), ('report', (None,))]
    calls.clear()
    for argv in (['run', '--gen_model=x'], ['run', '--gen', 'x'], ['run', '--no-personality=1'], ['run', '--limit=x'], ['run', '--gen-effort=extreme'], ['rejudge', '--gen-effort=low'], ['rejudge', '--limit-usd=3'], ['rejudge'], ['bogus']):
        with pytest.raises(SystemExit):
            kt_run.main(argv)                                                    # 철자 틀린 옵션이 조용히 무시돼 기본 유료 모델로 도는 일을 막는다
    assert calls == []


def test_build_data_reads_the_world_file_the_caller_names_and_the_default_stays_world_json(tmp_path, monkeypatch):
    from kt_world import save_world

    folder = tmp_path / 'works' / 'w00'
    folder.mkdir(parents=True)
    (folder / 'knowledge.jsonl').write_text('')
    for name in ('world', 'world2'):
        save_world(folder / f'{name}.json', {'series': name, 'cards': [], 'relations': [], 'when': {}, 'character_id': {}, 'title': {}})
    monkeypatch.setattr(kt_run, 'KT', tmp_path)
    monkeypatch.setattr(kt_run, 'load_works', lambda ids=None: {'w00': {'episodes': [{'number': 1, 'text': '철수는 영희에게 칼을 건넸다.'}]}})
    monkeypatch.setattr(kt_run, 'cached_embeddings', lambda path, texts, kind: 'vectors')
    assert kt_run.build_data(['w00'])['w00']['world']['series'] == 'world'
    assert kt_run.build_data(['w00'], world='world2')['w00']['world']['series'] == 'world2'
