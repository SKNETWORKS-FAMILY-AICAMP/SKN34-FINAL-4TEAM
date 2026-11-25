"""추출 평가 세트의 정답표 빌더(ex_gold): 두 번의 검증된 추출을 core(교집합)·합집합으로 합치고 ocx로 부르는 틀을 가짜 호출로 확인한다. 호출 없음."""

import json
from types import SimpleNamespace

import pytest

import ex_gold
from app.evaluation import extraction
from app.manuscript_extraction import agent
from app.manuscript_extraction.errors import PreprocessingFailure

S1, S2, S3 = '길동은 서울로 떠났다.', '춘섬은 길동의 어머니였다.', '홍 판서는 길동을 아꼈다.'
BODY = '\n'.join((S1, S2, S3))


def mention(i, name, kind='character'):
    return {'id': i, 'name': name, 'kind': kind, 'quote': S1}


def relation(i, source, target, label):
    return {'id': i, 'source': source, 'target': target, 'label': label, 'quote': S2}


def statement(n, kind, quote, document=None):
    return {'id': f's{n}', 'kind': kind, 'quote': quote, 'document': document or ('memory' if kind == 'event' else 'identity')}


def run(mentions, statements=(), relationships=(), skipped=None):
    return {'mentions': list(mentions), 'statements': [statement(n, *row) for n, row in enumerate(statements)], 'relationships': list(relationships), 'skipped': skipped or {}}


A = run([mention('m1', '길동'), mention('m2', '춘섬'), mention('m3', '서울', 'location')], [('event', S1), ('fact', S2)], [relation('r1', 'm2', 'm1', '어머니')])
B = run([mention('a', '홍길동'), mention('b', '춘섬'), mention('c', '서울', 'object'), mention('d', '홍 판서')], [('fact', S2), ('fact', S3)],
        [relation('x', 'a', 'b', '모자'), relation('y', 'a', 'd', '주인')])


def by_name(table, name, kind=None):
    [found] = [m for m in table['mentions'] if m['name'] == name and (kind is None or m['kind'] == kind)]
    return found


def test_merge_keeps_the_union_and_marks_what_both_runs_found_as_core():
    table, agreement = ex_gold.merge(BODY, [A, B])

    assert [(m['name'], m['kind'], m['core']) for m in table['mentions']] == [('길동', 'character', True), ('춘섬', 'character', True), ('서울', 'location', False),
                                                                           ('서울', 'object', False), ('홍 판서', 'character', False)]   # 종류가 다른 서울은 합치지 않는다
    assert by_name(table, '길동')['aliases'] == ['홍길동'] and by_name(table, '춘섬')['aliases'] == []   # 호칭이 다른 쪽은 별칭으로 남는다
    assert [(s['quote'], s['core']) for s in table['statements']] == [(S1, False), (S2, True), (S3, False)]
    assert agreement == {'mentions': pytest.approx(2 / 5), 'statements': pytest.approx(1 / 3), 'relationships': 0.5}


def test_a_merged_statement_keeps_the_kind_and_the_document_of_the_first_run_that_found_it():
    first = run([mention('a', '길동')], [('fact', S1, 'soul')])
    second = run([mention('a', '길동')], [('fact', S1, 'memory'), ('goal', S2, 'goal')])

    table, _ = ex_gold.merge(BODY, [first, second])

    assert [(s['quote'], s['kind'], s['document'], s['core']) for s in table['statements']] == [(S1, 'fact', 'soul', True), (S2, 'goal', 'goal', False)]   # 게이트 채점이 document로 설정 진술을 가른다


def test_relations_merge_by_their_two_ends_whatever_the_direction_and_the_label_and_use_the_merged_mention_names():
    table, _ = ex_gold.merge(BODY, [A, B])

    assert table['relationships'] == [{'source': '춘섬', 'target': '길동', 'label': '어머니', 'core': True},   # 첫째 번의 방향·라벨이 남는다
                                      {'source': '길동', 'target': '홍 판서', 'label': '주인', 'core': False}]   # 둘째 번의 끝점도 합친 대상의 이름이다(홍길동 → 길동)


def test_two_mentions_of_one_run_are_never_merged_and_the_closest_name_wins():
    first = run([mention('a', '민수'), mention('b', '민수 아버지')])
    second = run([mention('c', '민수 아버지')])

    table, _ = ex_gold.merge(BODY, [first, second])

    assert [(m['name'], m['core']) for m in table['mentions']] == [('민수', False), ('민수 아버지', True)]   # 같은 이름이 있으면 포함으로 맞춘 쪽보다 앞선다


def test_two_mentions_only_the_second_run_found_are_not_merged_with_each_other():
    first = run([mention('a', '춘섬')])
    second = run([mention('b', '길동'), mention('c', '길동')])

    table, _ = ex_gold.merge(BODY, [first, second])

    assert [(m['name'], m['core']) for m in table['mentions']] == [('춘섬', False), ('길동', False), ('길동', False)]   # 첫째 번에 짝이 없으면 둘째 번끼리도 합치지 않는다


def test_a_mention_is_merged_with_one_mention_of_the_other_run_only_once():
    first = run([mention('a', '길동')])
    second = run([mention('b', '길동'), mention('c', '길동')])

    table, _ = ex_gold.merge(BODY, [first, second])

    assert [(m['name'], m['core']) for m in table['mentions']] == [('길동', True), ('길동', False)]   # 둘째 번의 두 번째 길동은 합칠 짝이 없다


def test_statements_merge_when_their_quotes_overlap_and_prefer_the_largest_overlap():
    first = run([mention('a', '길동')], [('event', S1), ('event', S2)])
    second = run([mention('a', '길동')], [('fact', S1 + '\n' + S2)])   # 두 문장을 한 인용으로 묶은 둘째 번(원문에서 두 정답과 겹친다)

    table, _ = ex_gold.merge(BODY, [first, second])

    assert [(s['quote'], s['core']) for s in table['statements']] == [(S1, False), (S2, True)]   # 둘째 번 항목 하나는 더 많이 겹치는 S2와만 합쳐진다(흡수되어 새 항목이 생기지 않는다)


def test_agreement_of_a_kind_with_no_items_is_none():
    _, agreement = ex_gold.merge(BODY, [run([mention('a', '길동')]), run([mention('b', '길동')])])

    assert agreement == {'mentions': 1.0, 'statements': None, 'relationships': None}


def episode(**changes):
    return {'id': 'extraction.extract-01', 'number': 2, 'title': '운수 좋은 날', 'body': BODY, 'license': '저작권 만료(테스트)',
            'source': {'work': '운수 좋은 날', 'author': '현진건', 'origin': 'https://ko.wikisource.org/wiki/x', 'license': '저작권 만료(테스트)', 'episode': 2}, **changes}


def test_an_item_has_the_model_input_the_answer_table_and_the_gold_provenance(monkeypatch):
    monkeypatch.setattr(ex_gold, 'MIN_CORE', (2, 1))   # 이 시험의 두 실행은 core 대상 2·진술 1이다
    item = ex_gold.build_item(episode(), [A, B])

    assert item['id'] == 'extraction.extract-01' and item['input'] == {'number': 2, 'title': '운수 좋은 날', 'body': BODY}   # 운영이 모델에 보내는 값 그대로
    extraction.Gold.model_validate(item['expectedOutput'])   # 항목 채점이 읽는 모양
    assert item['metadata']['license'] == '저작권 만료(테스트)' and item['metadata']['source']['author'] == '현진건'
    assert item['metadata']['gold'] == {'model': ex_gold.MODEL, 'runs': ['A', 'B'], 'agreement': {'mentions': pytest.approx(2 / 5), 'statements': pytest.approx(1 / 3), 'relationships': 0.5}}
    json.dumps(item, ensure_ascii=False)   # jsonl 한 줄이 된다


@pytest.mark.parametrize('mentions, statements, built', [(3, 5, True), (2, 5, False), (3, 4, False), (0, 0, False)])
def test_an_episode_whose_core_is_below_the_floor_is_not_an_item(mentions, statements, built):
    lines = [f'{i}번째 문장은 인물이 말했다.' for i in range(8)]
    both = run([mention(f'm{i}', f'인물{chr(0xAC00 + i)}') for i in range(mentions)], [('event', lines[i]) for i in range(statements)])   # 두 번이 같으면 전부 core다

    got = ex_gold.build_item(episode(body='\n'.join(lines)), [both, both])

    assert ex_gold.MIN_CORE == (3, 5) and (got is not None) is built   # core 대상 3개·진술 5개 미만이면 재현율이 너무 거칠어 정답이 없는 것으로 본다


def test_the_two_gold_instructions_differ_from_each_other_and_from_the_production_prompt():
    from app.manuscript_extraction import prompt
    assert len({ex_gold.RUNS['A'], ex_gold.RUNS['B'], prompt.EXTRACT}) == 3 and list(ex_gold.RUNS) == ['A', 'B']
    for text in ex_gold.RUNS.values():   # 서비스 검증이 걸러 내는 규칙을 모두 안다(걸러 낸 항목은 정답표에 들어가지 못한다)
        assert all(word in text for word in ('quote', 'knowers', 'occurredEpisode', 'knownFromEpisode', 'certainty', 'change'))


def test_use_ocx_sends_the_extraction_calls_to_the_gateway_with_the_gold_model_and_no_openai_key(monkeypatch):
    made = []

    class Chat:
        def __init__(self, **options):
            made.append(options)

        def with_structured_output(self, schema, **kwargs):
            return SimpleNamespace(invoke=lambda messages: {'parsed': schema, 'kwargs': kwargs, 'messages': messages})

    monkeypatch.setattr(ex_gold, 'ChatOpenAI', Chat)
    monkeypatch.setattr(agent, 'ChatOpenAI', agent.ChatOpenAI)   # 끝나면 되돌린다
    for name, value in (('OPENAI_API_KEY', 'sk-real-key'), ('OPENAI_BASE_URL', 'https://api.openai.com/v1'), ('OPENAI_MODEL', 'production-model')):
        monkeypatch.setenv(name, value)   # use_ocx가 바꾸는 값을 테스트가 끝나면 되돌린다

    ex_gold.use_ocx('gpt-gold')
    llm = agent.ChatOpenAI(model='production-model', api_key='sk-real-key', timeout=70, max_tokens=16000, use_responses_api=True, store=False)
    got = llm.with_structured_output('schema', method='json_schema').invoke(['m'])

    [options] = made
    assert (options['model'], options['api_key'], options['base_url'], options['timeout'], options['max_tokens']) == ('gpt-gold', 'ocx', ex_gold.sim_via.GATEWAY, 900, 32000)
    assert options['use_responses_api'] is True and options['store'] is False   # 서비스가 정한 나머지 인자는 그대로다
    assert got['kwargs'] == {'method': 'json_schema'} and got['messages'] == ['m']
    import os
    assert (os.environ['OPENAI_API_KEY'], os.environ['OPENAI_BASE_URL'], os.environ['OPENAI_MODEL']) == ('ocx', ex_gold.sim_via.GATEWAY, 'gpt-gold')   # 실제 키가 어디로도 가지 않는다


EPISODE_INPUT = {'number': 2, 'title': '운수 좋은 날', 'body': BODY}


def test_run_asks_once_per_instructions_and_model_and_reuses_the_cached_result(tmp_path, monkeypatch):
    calls = []
    monkeypatch.setattr(extraction, 'generate', lambda instructions, item_input, model=None: calls.append((instructions, item_input, model)) or A)

    first = ex_gold.run('A', '지시문 가', episode(), tmp_path, 'gpt-gold')
    second = ex_gold.run('A', '지시문 가', episode(), tmp_path, 'gpt-gold')
    other = ex_gold.run('B', '지시문 가', episode(), tmp_path, 'gpt-gold')   # 같은 지시문이라도 실행 이름이 다르면 따로 센다
    changed = ex_gold.run('A', '바뀐 지시문', episode(), tmp_path, 'gpt-gold')

    assert first == second == other == changed == A
    assert calls == [('지시문 가', EPISODE_INPUT, 'gpt-gold'), ('지시문 가', EPISODE_INPUT, 'gpt-gold'), ('바뀐 지시문', EPISODE_INPUT, 'gpt-gold')]


def test_a_cached_result_is_reused_only_for_the_same_model_and_the_same_episode_text(tmp_path, monkeypatch):
    calls = []
    monkeypatch.setattr(extraction, 'generate', lambda instructions, item_input, model=None: calls.append((item_input['body'], model)) or A)
    longer = episode(body=BODY + '\n한 줄 더.')

    ex_gold.run('A', '지시문', episode(), tmp_path, 'gpt-gold')
    ex_gold.run('A', '지시문', episode(), tmp_path, 'gpt-other')   # 모델이 다르면 다시 부른다
    ex_gold.run('A', '지시문', longer, tmp_path, 'gpt-other')   # 회차 글이 다르면 다시 부른다
    ex_gold.run('A', '지시문', longer, tmp_path, 'gpt-other')   # 같으면 부르지 않는다

    assert calls == [(BODY, 'gpt-gold'), (BODY, 'gpt-other'), (longer['body'], 'gpt-other')]


def test_build_makes_items_from_both_runs_and_reports_the_failed_ones_by_their_codes(tmp_path, monkeypatch):
    monkeypatch.setattr(ex_gold, 'MIN_CORE', (2, 1))

    def generate(instructions, item_input, model=None):
        if instructions == ex_gold.RUNS['B'] and item_input['number'] == 3:
            raise PreprocessingFailure('MODEL_TIMEOUT', 504)
        return B if instructions == ex_gold.RUNS['B'] else A
    monkeypatch.setattr(extraction, 'generate', generate)

    items, failures = ex_gold.build([episode(), episode(id='extraction.extract-02', number=3)], tmp_path, workers=2)

    assert [item['id'] for item in items] == ['extraction.extract-01'] and failures == [('extraction.extract-02', 'B', 'MODEL_TIMEOUT')]   # 실패한 회차는 항목으로 만들지 않고 숨기지도 않는다


def test_build_reports_an_episode_whose_core_is_too_small_instead_of_hiding_it(tmp_path, monkeypatch):
    monkeypatch.setattr(extraction, 'generate', lambda instructions, item_input, model=None: B if instructions == ex_gold.RUNS['B'] else A)

    items, failures = ex_gold.build([episode()], tmp_path, workers=1)

    assert items == [] and failures == [('extraction.extract-01', '-', 'CORE_TOO_SMALL')]
