"""TimeChara 실행기의 순수 로직 단위 테스트: 문맥 메시지·항목 회차·채점 흐름·집계. 실제 호출 없이 대역 모델을 쓴다."""

import json
from collections import Counter
from types import SimpleNamespace

import pytest

import run_timechara
from batch import SyncExecutor, run_rounds
from cost import MODEL, CostLog
from llm import Ledger, Llm
from run_timechara import (context_message, foreign_memory, item_episode, judge_personality, judge_spatiotemporal, make_work, paired,
                           summarize)

LOOKUP = {'chunk': {'harry_potter:12': 7}, 'event': {'e-abc': 9}, 'when': {'r-x': 4}}
SPATIAL = '{agent_name}|{question_0}|{answer_0}|{agent_fact_0}'
PERSONALITY = '{agent_name}|{question_0}|{response_0}|{agent_personality}'


class Judge:
    """채점 모델 대역: 입력에 든 사실 표지로 점수를 정하고 호출 수를 센다."""

    def __init__(self, scores):
        self.scores, self.calls = scores, []

    def ask(self, kind, instructions, input, max_output_tokens):
        self.calls.append(input)
        for marker, score in self.scores.items():
            if marker in input:
                return f'reasoning...\n{score}\n{score}'
        return 'no score here'


def test_context_message_follows_the_public_rag_cutoff_format():
    assert context_message('What?', []) == 'What?'
    assert context_message('What?', ['a', 'b']) == 'Context: a\n\nb\n***\nWhat?'


def test_item_episode_reads_the_source_chapter_of_each_item_kind():
    assert item_episode('manuscript:harry_potter:12', LOOKUP) == 7
    assert item_episode('card:e-abc', LOOKUP) == 9
    assert item_episode('card:c-harry#ep03', LOOKUP) == 3
    assert item_episode('relation:r-x', LOOKUP) == 4
    assert item_episode('card:c-harry#identity', LOOKUP) is None
    assert item_episode('card:c-harry#goal', LOOKUP) is None
    assert item_episode('relation:unknown', LOOKUP) is None


def test_foreign_memory_flags_other_characters_private_documents_only():
    assert foreign_memory('card:c-ron#ep03', 'c-harry') and foreign_memory('card:c-ron#soul', 'c-harry') and foreign_memory('card:c-ron#goal', 'c-harry')
    assert not foreign_memory('card:c-harry#ep03', 'c-harry') and not foreign_memory('card:c-harry#goal', 'c-harry')
    assert not foreign_memory('card:c-ron#identity', 'c-harry') and not foreign_memory('card:e-abc', 'c-harry')


def row(data_type, temporal='T-fact', spatial='-'):
    return {'data_type': data_type, 'question': 'Q', 'temporal_label': temporal, 'spatial_label': spatial}


def test_future_and_past_only_are_judged_on_time_alone():
    for kind in ('future', 'past-only'):
        judge = Judge({'T-fact': 1})
        assert judge_spatiotemporal(judge, row(kind), 'R', 'Name', SPATIAL) == {'temporal': 1, 'spatial': None, 'score': 1}
        assert len(judge.calls) == 1


def test_absence_and_presence_ask_space_first_and_skip_time_when_space_fails():
    judge = Judge({'S-fact': 0, 'T-fact': 1})
    assert judge_spatiotemporal(judge, row('past-absence', spatial='S-fact'), 'R', 'Name', SPATIAL) == {
        'temporal': 0, 'spatial': 0, 'score': 0}
    assert len(judge.calls) == 1                       # 공개 evaluate.py처럼 공간이 0이면 시간은 묻지 않는다
    judge = Judge({'S-fact': 1, 'T-fact': 1})
    assert judge_spatiotemporal(judge, row('past-presence', spatial='S-fact'), 'R', 'Name', SPATIAL)['score'] == 1
    assert len(judge.calls) == 2


def test_unparseable_judgement_is_none_not_a_guess():
    result = judge_spatiotemporal(Judge({}), row('future'), 'R', 'Name', SPATIAL)
    assert result['score'] is None
    assert judge_personality(Judge({}), 'Q', 'R', 'Name', 'Brave.', PERSONALITY) is None


def test_personality_is_scored_one_to_seven():
    assert judge_personality(Judge({'Brave.': 6}), 'Q', 'R', 'Name', 'Brave.', PERSONALITY) == 6
    assert judge_personality(Judge({'Brave.': 9}), 'Q', 'R', 'Name', 'Brave.', PERSONALITY) is None


def record(config, data_type, score, personality=None, future=False, foreign=False):
    return {'config': config, 'data_type': data_type, 'score': score, 'personality': personality, 'future_ctx': future,
            'foreign_ctx': foreign}


def test_summarize_weights_types_like_the_benchmark_and_counts_failures():
    records = (
        [record('s2', 'future', s) for s in (1, 0, 1, 0)] + [record('s2', 'past-only', s) for s in (1, 1)]
        + [record('s2', 'past-absence', 0), record('s2', 'past-presence', 1)]
        + [record('s2', 'future', None)]
        + [record('s3', 'future', 1, personality=5, future=False)]
    )
    out = summarize(records)
    s2 = out['s2']
    assert s2['by_type']['future'] == {'n': 4, 'score': 0.5, 'ci': pytest.approx(s2['by_type']['future']['ci'])}
    assert s2['failed'] == 1
    # 가중 평균: future 1/3, past-only 1/3, absence 1/6, presence 1/6 → 0.5/3 + 1/3 + 0/6 + 1/6
    assert s2['weighted'] == pytest.approx(0.5 / 3 + 1 / 3 + 0 + 1 / 6)
    assert out['s3']['personality'] == 5 and out['s3']['by_type']['future']['n'] == 1


def test_summarize_reports_context_leak_rates_per_type():
    records = [record('s2', 'future', 1, future=True), record('s2', 'future', 1, future=False),
               record('s2', 'future', 1, future=True, foreign=True), record('s3', 'future', 1)]
    out = summarize(records)
    assert out['s2']['future_ctx'] == pytest.approx(2 / 3) and out['s2']['foreign_ctx'] == pytest.approx(1 / 3)
    assert out['s3']['future_ctx'] == 0


def test_paired_counts_discordant_questions_and_gives_an_exact_sign_test():
    def rec(idx, config, score):
        return {'idx': idx, 'config': config, 'score': score}
    records = [rec(i, 'a', x) for i, x in enumerate([1, 1, 0, 0])] + [rec(i, 'b', x) for i, x in enumerate([0, 1, 1, 0])]
    assert paired(records, 'a', 'b') == {'a_only': 1, 'b_only': 1, 'p': 1.0}
    records = [rec(i, 'a', 1) for i in range(9)] + [rec(i, 'b', 0 if i < 8 else 1) for i in range(9)] + [rec(20, 'a', 1), rec(20, 'b', None)]
    out = paired(records, 'a', 'b')                      # 한쪽이 실패(None)한 질문은 짝에서 뺀다
    assert (out['a_only'], out['b_only']) == (8, 0) and out['p'] == pytest.approx(2 * 1 / 2 ** 8)


class Client:
    """responses.create 대역: 정한 글을 돌려주고 받은 입력을 모은다."""

    def __init__(self, text):
        self.inputs, self.text = [], text
        self.responses = SimpleNamespace(create=self._create)

    def _create(self, **kw):
        self.inputs.append(kw['input'])
        usage = SimpleNamespace(input_tokens=1, output_tokens=1, input_tokens_details=None)
        return SimpleNamespace(status='completed', usage=usage, model='m', output_text=self.text)


def split_llms(tmp_path):
    """응답 Llm(gen 클라이언트)에 채점 Llm(judge 클라이언트)을 붙인 Llm과 두 클라이언트."""
    gen, judge = Client('인물의 응답'), Client('근거\n1\n1')

    def build(tag, client, **kw):
        return Llm(Ledger(tmp_path / f'{tag}.jsonl', 10 ** 6), tmp_path / f'cache-{tag}', model=tag, client=client, backoff=0, **kw)

    return build('gen', gen, judge=build('judge', judge)), gen, judge


def work_for(**kw):
    contexts = {0: {'zero': {'items': [], 'future': False, 'foreign': False}}}
    return make_work(contexts, {'spatiotemporal': SPATIAL, 'personality': PERSONALITY}, lambda r: 'SYS', lambda r: 'Name', lambda r: 'Brave.', **kw)


TASK = ({**row('future'), 'idx': 0}, 'zero')


def test_make_work_sends_the_generation_and_the_judging_to_different_llms(tmp_path):
    llm, gen, judge = split_llms(tmp_path)
    (record,) = run_rounds([TASK], work_for(), llm, SyncExecutor(llm))
    assert gen.inputs == ['Q']                                              # 응답은 응답 Llm만
    assert len(judge.inputs) == 2 and all('인물의 응답' in text for text in judge.inputs)   # 시공간·성격 채점은 채점 Llm만
    assert (record['response'], record['score'], record['personality']) == ('인물의 응답', 1, 1)


def test_make_work_with_saved_responses_judges_them_without_generating(tmp_path):
    llm, gen, judge = split_llms(tmp_path)
    (record,) = run_rounds([TASK], work_for(responses={(0, 'zero'): '옛 응답'}), llm, SyncExecutor(llm))
    assert gen.inputs == [] and record['response'] == '옛 응답' and record['score'] == 1
    assert len(judge.inputs) == 2 and all('옛 응답' in text for text in judge.inputs)
    (failed,) = run_rounds([TASK], work_for(responses={(0, 'zero'): None}), llm, SyncExecutor(llm))
    assert failed['response'] is None and failed['score'] is None and failed['personality'] is None   # 응답이 없는 기록은 실패 그대로
    assert gen.inputs == [] and len(judge.inputs) == 2                                              # 그 기록은 아무 호출도 내지 않았다


# ---- 저장된 응답을 채점만 다시(rejudge) ----

TEMPLATES = {'spatiotemporal': 'S [Interactions] {question_0} {answer_0} [Fact] {agent_fact_0} Spatiotemporal Consistency {agent_name}',
             'personality': 'P {question_0} {response_0} {agent_personality} Personality Consistency {agent_name}'}
KINDS = ('future', 'past-only', 'past-absence', 'past-presence')


class JudgeFake:
    """responses.create 대역: 시공간 채점은 verdict, 성격 채점은 5점. 받은 입력을 모은다."""

    def __init__(self, verdict='1'):
        self.calls, self.verdict = [], verdict
        self.responses = SimpleNamespace(create=self._create)

    def _create(self, **kw):
        self.calls.append(kw['input'])
        out = '근거\n5\n5' if 'Personality Consistency' in kw['input'] else f'근거\n{self.verdict}\n{self.verdict}'
        usage = SimpleNamespace(input_tokens=10, output_tokens=5, input_tokens_details=SimpleNamespace(cached_tokens=0))
        return SimpleNamespace(status='completed', usage=usage, model='m', output_text=out)


def question(kind, number):
    spatial = {'past-absence': 'Absence: x', 'past-presence': 'Presence: x'}.get(kind, '-')
    return {'series': 'harry_potter', 'data_type': kind, 'character': 'Harry Potter', 'character_period': '1st-year', 'question': f'Q{number}',
            'temporal_label': 'T', 'spatial_label': spatial}


def saved_record(idx, config, kind, response='옛 응답', **kw):
    return {'idx': idx, 'config': config, 'data_type': kind, 'response': response, 'score': 0, 'temporal': 0, 'spatial': None, 'personality': 1,
            'future_ctx': config == 'zero', 'foreign_ctx': config == 's3', **kw}


def tc_sandbox(tmp_path, monkeypatch, per_type=2):
    """run_timechara를 임시 폴더로 돌린다(실제 데이터·게이트웨이 없이): 유형마다 per_type문항, 구성 zero·s2·s3·ppr의 저장된 응답."""
    data, tc = tmp_path / 'data', tmp_path / 'tc'
    (tc / 'data' / 'personality').mkdir(parents=True)
    (data / 'runs').mkdir(parents=True)
    rows = [question(kind, number) for number, kind in enumerate(k for k in KINDS for _ in range(per_type))]
    (tc / 'valid.json').write_text(json.dumps(rows))
    for name, text in (('spatiotemporal', TEMPLATES['spatiotemporal']), ('personality', TEMPLATES['personality'])):
        (tc / 'data' / f'{name}_consistency_evaluation_prompt.txt').write_text(text)
    (tc / 'data' / 'personality' / 'harry_potter_personality.txt').write_text('용감하다.')
    saved = [saved_record(i, config, r['data_type']) for i, r in enumerate(rows) for config in ('zero', 's2', 's3', 'ppr')]
    (data / 'runs' / 'timechara-rows.json').write_text(json.dumps(saved))
    for name, value in {'DATA': data, 'TC': tc, 'RESULTS': tmp_path / 'results', 'PER_TYPE': 1}.items():
        monkeypatch.setattr(run_timechara, name, value)
    return data, rows, saved


def judge_llm_double(tmp_path, monkeypatch, judge, made=None):
    llm = Llm(Ledger(tmp_path / 'j-ledger.jsonl', 10 ** 6), tmp_path / 'cache-judge', model='gpt-6.2-sol', client=judge, backoff=0, cost=CostLog(tmp_path / 'j-cost.jsonl'))
    llm.via = 'ocx'
    monkeypatch.setattr(run_timechara, 'judge_llm', lambda model, name: (made is not None and made.append((model, name))) or llm)
    return llm


def test_rejudge_scores_the_saved_responses_with_the_new_judge_only_and_writes_only_named_files(tmp_path, monkeypatch):
    data, rows, saved = tc_sandbox(tmp_path, monkeypatch)
    (tmp_path / 'results').mkdir()
    (tmp_path / 'results' / 'timechara.json').write_text('KEEP')
    judge, made = JudgeFake(verdict='0'), []
    judge_llm_double(tmp_path, monkeypatch, judge, made)
    before = (data / 'runs' / 'timechara-rows.json').read_text()
    run_timechara.rejudge('sol', ('zero', 's3'))
    assert made == [('gpt-6.2-sol', 'sol')] and judge.calls and all('Consistency' in text for text in judge.calls)    # 채점 호출만 갔다(응답 생성 호출은 없다)
    assert all('옛 응답' in text for text in judge.calls)                                                              # 저장된 응답을 채점했다
    out = json.loads((data / 'runs' / 'timechara-rows-sol.json').read_text())
    assert len(out) == len(rows) * 2 and {r['config'] for r in out} == {'zero', 's3'}                                  # 고른 구성만, 다른 구성(s2·ppr)은 건너뛴다
    assert {r['score'] for r in out} == {0} and {r['personality'] for r in out} == {5} and {r['response'] for r in out} == {'옛 응답'}   # 새 채점이 이긴다
    assert {(r['future_ctx'], r['foreign_ctx']) for r in out if r['config'] == 'zero'} == {(True, False)}              # 문맥 표지는 원본 기록에서 옮긴다
    assert {(r['gen_model'], r['gen_via'], r['judge_model'], r['judge_via']) for r in out} == {(MODEL, 'openai', 'gpt-6.2-sol', 'ocx')}
    assert (data / 'runs' / 'timechara-rows.json').read_text() == before and (tmp_path / 'results' / 'timechara.json').read_text() == 'KEEP'   # 원본·기존 집계는 그대로
    result = json.loads((tmp_path / 'results' / 'timechara-sol.json').read_text())
    assert set(result['configs']) == {'zero', 's3'} and set(result['paired']) == {'s3|zero'} and 'first_80' in result and result['questions'] == len(rows)
    assert result['models'] == {'gen_model': [MODEL], 'gen_via': ['openai'], 'judge_model': ['gpt-6.2-sol'], 'judge_via': ['ocx']}
    assert set(result['paired_by_type']['future']) == {'s3|zero'} and set(result['first_80']['paired']) == {'s3|zero'}


def test_rejudge_keeps_failed_records_failed_skips_personality_on_request_and_pilots_by_type(tmp_path, monkeypatch):
    data, rows, saved = tc_sandbox(tmp_path, monkeypatch, per_type=4)
    for record in saved:
        if (record['idx'], record['config']) == (0, 's3'):
            record.update(response=None, score=None)                                                                  # 응답이 없는(실패) 기록 하나
    (data / 'runs' / 'timechara-rows.json').write_text(json.dumps(saved))
    judge = JudgeFake()
    judge_llm_double(tmp_path, monkeypatch, judge)
    run_timechara.rejudge('pilot', ('s3',), limit=8, personality=False)
    out = json.loads((data / 'runs' / 'timechara-rows-pilot.json').read_text())
    assert len(out) == 8 and Counter(r['data_type'] for r in out) == {kind: 2 for kind in KINDS}                      # 유형 비율을 지키며 문항 8개
    assert {r['personality'] for r in out} == {None} and all('Personality Consistency' not in text for text in judge.calls)
    assert [r['idx'] for r in out] == sorted(r['idx'] for r in out)
    result = json.loads((tmp_path / 'results' / 'timechara-pilot.json').read_text())
    assert 'first_80' not in result and result['questions'] == 8                                                       # 파일럿은 처음 80건 부분집합을 쓰지 않는다
    run_timechara.rejudge('failed', ('s3',), personality=False)
    full = {r['idx']: r for r in json.loads((data / 'runs' / 'timechara-rows-failed.json').read_text())}
    assert full[0]['response'] is None and full[0]['score'] is None and full[1]['score'] == 1                         # 실패 기록은 호출 없이 실패 그대로
    run_timechara.rejudge('all', ('s3',), limit=16, personality=False)                                                  # limit이 문항 수와 같으면 전체 재채점이다
    assert 'first_80' in json.loads((tmp_path / 'results' / 'timechara-all.json').read_text())                          # 처음 80건 부분집합도 집계한다


def test_rejudge_refuses_names_that_collide_with_archives_and_inputs_that_do_not_match_the_questions(tmp_path, monkeypatch):
    data, rows, saved = tc_sandbox(tmp_path, monkeypatch)
    judge = JudgeFake()
    judge_llm_double(tmp_path, monkeypatch, judge)
    for bad in ('', '../x', 'a/b', '.hidden', 'filter-v1', 'before-seed-fix'):                                         # 경로·보관 파일(timechara-rows-filter-v1.json 등)과 겹치는 이름
        with pytest.raises(SystemExit):
            run_timechara.rejudge(bad, ('zero',))
    with pytest.raises(SystemExit):                                                                                    # 기록에 없는 구성만 고르면 빈 결과를 성공처럼 쓰지 않는다
        run_timechara.rejudge('none', ('s9',))
    with pytest.raises(SystemExit):
        run_timechara.rejudge('zero-limit', ('zero',), limit=0)
    stale = [dict(r) for r in saved]
    stale[0]['data_type'] = 'future' if stale[0]['data_type'] != 'future' else 'past-only'                              # 질문 파일과 어긋난 기록은 엉뚱한 질문으로 채점하지 않는다
    (data / 'runs' / 'timechara-rows.json').write_text(json.dumps(stale))
    with pytest.raises(SystemExit):
        run_timechara.rejudge('stale', ('zero',))
    assert judge.calls == [] and not list((data / 'runs').glob('timechara-rows-*.json')) and not (tmp_path / 'results').exists()


def test_judge_llm_is_a_gateway_model_with_a_timechara_cache_and_a_free_ledger_named_by_the_run(tmp_path, monkeypatch):
    monkeypatch.setattr(run_timechara, 'DATA', tmp_path)
    llm = run_timechara.judge_llm('gpt-6.2-sol', 'sol')
    assert (llm.model, llm.via, llm.limit_usd, llm.cache_dir) == ('gpt-6.2-sol', 'ocx', None, tmp_path / 'timechara-cache-judge-gpt-6.2-sol')   # KoTimeChara 채점 캐시와 섞이지 않는다
    assert llm.cost.path == tmp_path / 'cost-timechara-sol.jsonl' and llm.cost.record('judge', 5_000_000, 5_000_000) == 0.0
    assert run_timechara.judge_llm('anthropic-apikey/some-judge', 'x').cache_dir == tmp_path / 'timechara-cache-judge-some-judge'


def test_write_results_keeps_its_shape_for_unstamped_records_and_only_pairs_configs_that_exist(tmp_path, monkeypatch):
    data, rows, saved = tc_sandbox(tmp_path, monkeypatch)
    records = [saved_record(i, config, r['data_type']) for i, r in enumerate(rows) for config in run_timechara.CONFIGS]
    run_timechara.write_results(records, 'saved', True)
    plain = json.loads((tmp_path / 'results' / 'timechara.json').read_text())
    assert 'models' not in plain and set(plain['paired']) == {f'{a}|{b}' for a, b in run_timechara.PAIRS} and plain['model'] == 'saved' and 'first_80' in plain   # 예전 모양 그대로
    run_timechara.write_results([r for r in records if r['config'] in ('zero', 's3')], 'saved', False, name='two')
    two = json.loads((tmp_path / 'results' / 'timechara-two.json').read_text())
    assert set(two['paired']) == {'s3|zero'} and 'first_80' not in two and (tmp_path / 'results' / 'timechara.json').exists()


def test_write_results_prints_a_table_even_when_every_judgement_failed(tmp_path, monkeypatch, capsys):
    data, rows, saved = tc_sandbox(tmp_path, monkeypatch)
    failed = [saved_record(i, c, r['data_type'], response=None, score=None, personality=None) for i, r in enumerate(rows) for c in ('zero', 's3')]
    run_timechara.write_results(failed, 'saved', False, name='none-scored')
    assert 's3' in capsys.readouterr().out                                                                             # 점수가 하나도 없어도(가중 평균 None) 표를 출력한다


def test_main_dispatches_every_command_keeps_the_old_flags_and_refuses_unknown_options(tmp_path, monkeypatch):
    calls = []

    def spy(name, result=None):
        monkeypatch.setattr(run_timechara, name, lambda *args, **kw: calls.append((name, args, kw)) or result)

    for name in ('run', 'rejudge', 'write_results', 'build_contexts', 'context_report'):
        spy(name)
    spy('build_inputs', ([], {}))
    (tmp_path / 'runs').mkdir()
    (tmp_path / 'runs' / 'timechara-rows.json').write_text('[{"x": 1}]')
    monkeypatch.setattr(run_timechara, 'DATA', tmp_path)
    run_timechara.main(['run'])
    run_timechara.main(['run', '--mode=batch', '--subset'])
    run_timechara.main(['paired'])
    run_timechara.main(['contexts', '--subset'])
    run_timechara.main(['rejudge', '--name=sol', '--limit=8', '--configs=zero,s3', '--no-personality'])
    run_timechara.main(['rejudge', '--name=sol2', '--judge-model=gpt-6-luna'])
    assert [(c[0], c[1]) for c in calls if c[0] in ('run', 'write_results', 'build_inputs')] == [
        ('run', ('sync', True)), ('run', ('batch', False)), ('write_results', ([{'x': 1}], 'saved', True)), ('build_inputs', (False,))]
    assert [(c[1], c[2]) for c in calls if c[0] == 'rejudge'] == [
        (('sol', ('zero', 's3')), {'judge_model': 'gpt-6.2-sol', 'limit': 8, 'personality': False}),
        (('sol2', ('zero', 's2', 's3')), {'judge_model': 'gpt-6-luna', 'limit': None, 'personality': True})]            # 기본 구성 zero,s2,s3·기본 채점 gpt-6.2-sol
    calls.clear()
    for argv in (['rejudge'], ['rejudge', '--name=x', '--judge_model=y'], ['rejudge', '--name=x', '--limit=x'], ['rejudge', '--name=x', '--no-personality=1'],
                 ['run', '--mode=fast'], ['run', '--subsets'], ['bogus'], []):                                         # 철자 틀린 옵션이 조용히 무시되지 않는다
        with pytest.raises(SystemExit):
            run_timechara.main(argv)
    assert calls == []
