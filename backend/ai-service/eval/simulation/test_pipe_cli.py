"""파이프라인 평가 실행기(pipe_cli)의 순수 부분: 문항 고르기, 못 돌리는 문항 건너뛰기, 두 세계관 집계·짝 비교, 실행 설정 섞임 방지, 세계관 단 보고."""

from types import SimpleNamespace as NS

import pytest

import pipe_cli as pc
from app.manuscript_extraction.models import Card, CharacterDocs, LoadPayload, Relation


def item(id, work='a', base=1, kind='dialogue'):
    return {'id': id, 'work': work, 'base': base, 'kind': kind, 'source': {'kind': 'modern'}}


def test_select_items_filters_works_samples_evenly_and_orders_by_base():
    items = [item('a-1', 'a', 3), item('a-2', 'a', 1), item('b-1', 'b', 1), item('a-3', 'a', 2), item('a-4', 'a', 1)]
    assert [i['id'] for i in pc.select_items(items, {'a'}, None)] == ['a-2', 'a-4', 'a-3', 'a-1']
    assert [i['id'] for i in pc.select_items(items, {'a'}, 2)] == ['a-3', 'a-1']   # 작품을 거른 뒤 세트 순서에서 같은 간격으로 2개(a-1·a-3)를 뽑고 기준 회차 순으로 늘어놓는다


def test_evaluator_skips_unrunnable_pipeline_items_without_calling_the_model():
    calls = []
    corpus = NS(status=lambda it: 'late_card' if it['id'] == 'public-1-0002' else 'ok')
    evaluate = lambda it: calls.append(it['id']) or {'id': it['id'], 'grade': {'voice': 3}, 'skipped': None}  # noqa: E731
    run = pc.evaluator(corpus, evaluate, pipeline=True)
    assert run(item('a'))['grade'] == {'voice': 3}
    skipped = run(item('public-1-0002'))
    assert (skipped['id'], skipped['skipped'], skipped['grade'], skipped['usage'], skipped['kind']) == ('public-1-0002', 'late_card', None, [], 'dialogue') and calls == ['a']
    assert pc.evaluator(corpus, evaluate, pipeline=False)(item('public-1-0002'))['grade'] == {'voice': 3}   # 손라벨 세계관은 상태를 따지지 않는다(문항 거름은 호출하는 쪽이 이미 했다)
    assert pc.skipped_by([{'skipped': 'late_card'}, {'skipped': None}, {'skipped': 'late_card'}, {'skipped': 'leak'}]) == {'late_card': 2, 'leak': 1}


def graded(i, voice, intent, leaked=(), skipped=None):
    return {'id': f'x{i}', 'kind': 'dialogue', 'work': 'a', 'workKind': 'modern', 'error': None, 'skipped': skipped, 'usage': [],
            'grade': None if skipped else {'voice': voice, 'intent': intent, 'leaked': list(leaked)}}


def test_assemble_summarizes_each_world_and_pairs_them_on_shared_items():
    pipeline = [graded(0, 4, 3), graded(1, 3, 2, ['f']), graded(2, 0, 0, skipped='no_character')]
    hand = [graded(0, 3, 3), graded(1, 3, 2)]
    got = pc.assemble('1', pipeline, hand)
    assert got['pipeline']['skippedBy'] == {'no_character': 1} and got['pipeline']['summary']['n'] == 3 and got['pipeline']['summary']['skipped'] == 1
    assert got['hand']['summary']['voice']['mean'] == 3.0 and got['hand']['skippedBy'] == {}
    # 후보 = 파이프라인, 기준선 = 손라벨(방향이 바뀌면 up·down이 뒤집힌다), 건너뛴 문항은 짝에서 빠진다
    assert got['vsHand']['metrics']['voice'] == {'n': 2, 'up': 1, 'down': 0, 'tie': 1, 'p': 1.0, 'meanDiff': 0.5}
    assert got['vsHand']['metrics']['clean'] == {'n': 2, 'up': 0, 'down': 1, 'tie': 1, 'p': 1.0, 'meanDiff': -0.5}
    assert 'hand' not in pc.assemble('1', pipeline, []) and 'vsHand' not in pc.assemble('1', pipeline, [])


def test_assemble_pairs_with_another_tags_runs_for_the_reveal_comparison_and_the_noise_floor():
    pipeline, hand = [graded(0, 4, 3), graded(1, 3, 2, ['f'])], [graded(0, 3, 3), graded(1, 3, 2)]
    other = {'pipeline': [graded(0, 3, 3), graded(1, 3, 2)], 'hand': [graded(0, 3, 3), graded(1, 2, 2)]}   # 다른 태그의 기록(기준선): 이 태그가 후보
    got = pc.assemble('1', pipeline, hand, other)
    assert got['vsOther']['metrics']['voice'] == {'n': 2, 'up': 1, 'down': 0, 'tie': 1, 'p': 1.0, 'meanDiff': 0.5}   # 파이프라인끼리: 공개 회차 설정이 다른 두 실행
    assert got['vsOther']['metrics']['clean'] == {'n': 2, 'up': 0, 'down': 1, 'tie': 1, 'p': 1.0, 'meanDiff': -0.5}
    assert got['vsOtherHand']['metrics']['voice'] == {'n': 2, 'up': 1, 'down': 0, 'tie': 1, 'p': 1.0, 'meanDiff': 0.5}   # 손라벨끼리(이 태그 [3,3], 다른 태그 [3,2]): 같은 조건을 두 번 돌린 차이(재현 잡음)
    assert 'vsOther' not in pc.assemble('1', pipeline, hand) and 'vsOtherHand' not in pc.assemble('1', pipeline, hand, {'pipeline': other['pipeline'], 'hand': []})


def test_claim_run_refuses_to_mix_settings_in_one_record_folder(tmp_path):
    pc.claim_run(tmp_path, {'reveal': 'none', 'via': 'ocx'})
    pc.claim_run(tmp_path, {'reveal': 'none', 'via': 'ocx'})   # 같은 설정은 이어 받는다
    with pytest.raises(SystemExit, match='reveal'):
        pc.claim_run(tmp_path, {'reveal': 'first', 'via': 'ocx'})


def card(key, title, body, first, soul='', typ='character'):
    return Card(key=key, cardType=typ, title=title, aliases=[], body=body, firstEpisode=first, characterDocs=CharacterDocs(soul=soul, goal='', episodes={}) if typ == 'character' else None)


def entry(wid, title, quote_ok, lonely=False):
    """작품 하나의 세계관 단 입력(작품, Built 대역, 평가 인물 이름). lonely면 SOUL도 IDENTITY 줄도 없는 인물 카드 하나를 더한다."""
    work = {'id': wid, 'episodes': [{'number': 1, 'text': f'{title}은 사람이다. 그는 웃었다.'}]}
    cards = [card('k', title, f'[사실] {title}은 사람이다.', 1, soul='[묘사] 그는 웃었다.'), card('e', '1화 · 일', '[사건] x', 1, typ='event')]
    payload = LoadPayload(cards=cards + ([card('z', '병', '병', 1)] if lonely else []), relations=[Relation(fromKey='k', toKey='k', label='자기', fromEpisode=1, ended=False)])
    rows = {1: NS(mentions=[0], statements=[0, 0], relationships=[], skipped={'INVALID_OR_AMBIGUOUS_QUOTE': 0 if quote_ok else 1})}
    return work, NS(payload=payload, extractions=rows, failures=[] if quote_ok else [(2, 'MODEL_TIMEOUT')], calls=2), {title, '없는이'}


def test_world_section_reports_each_work_and_pools_the_total():
    got = pc.world_section([entry('a', '갑', True), entry('b', '을', False, lonely=True)])
    a = got['perWork']['a']
    assert (a['cards'], a['characters'], a['relations']) == (2, 1, 1) and a['coverage'] == {'names': 2, 'found': 1, 'rate': 0.5} and a['failures'] == []
    assert a['extraction']['quotePass'] == 1.0 and got['perWork']['b']['extraction']['quotePass'] == 1 - 1 / 4 and got['perWork']['b']['failures'] == [[2, 'MODEL_TIMEOUT']]
    assert a['persona']['docs']['identity'] == {'lines': 1, 'grounded': 1, 'named': 1, 'empty': 0} and a['persona']['ready'] == 1
    # 평가 문항에 나오지 않은 인물까지 모든 인물 카드로 센 문서 공백(SOUL 없음·IDENTITY를 이름으로 채움)
    b = got['perWork']['b']
    assert (a['soulEmpty'], a['identityEmpty'], b['characters'], b['soulEmpty'], b['identityEmpty']) == (0, 0, 2, 1, 1)
    total = got['total']
    assert total['coverage'] == {'names': 4, 'found': 2, 'rate': 0.5} and total['persona']['characters'] == 2 and total['extraction']['episodes'] == 2   # 작품을 합쳐 다시 센다
    assert total['extraction']['quotePass'] == 1 - 1 / 7 and total['failures'] == 1 and total['cards'] == 5
    assert (total['characters'], total['soulEmpty'], total['identityEmpty']) == (3, 1, 1)


def test_availability_counts_statuses_per_set_and_per_work():
    total, by_work = pc.availability({'1': [('a', 'ok'), ('a', 'docs_missing'), ('b', 'docs_missing')], '3n': [('a', 'ok'), ('b', 'ok')]})
    assert total == {'1': {'ok': 1, 'docs_missing': 2}, '3n': {'ok': 2}}
    assert by_work == {'a': {'1': {'ok': 1, 'docs_missing': 1}, '3n': {'ok': 1}}, 'b': {'1': {'docs_missing': 1}, '3n': {'ok': 1}}}


def test_render_shows_the_stages_the_baseline_availability_and_pairs():
    pipeline, hand = [graded(0, 4, 3), graded(1, 3, 2)], [graded(0, 3, 3), graded(1, 3, 2)]
    other = {'pipeline': [graded(0, 3, 3), graded(1, 3, 2)], 'hand': [graded(0, 3, 3), graded(1, 3, 2)]}
    result = {'tag': 't', 'vsTag': 'u', 'world': pc.world_section([entry('a', '갑', True), entry('b', '을', True, lonely=True)]), 'items': {'1': {'ok': 1, 'docs_missing': 3}},
              'simulation': {'1': pc.assemble('1', pipeline, hand, other)}}
    text = pc.render(result)
    assert '인물 카드 3장 중 SOUL 없음 1장(33.3%) · IDENTITY를 이름으로 채움 1장(33.3%)' in text   # 수정 전 기준선: 인물 카드 단위 문서 공백
    assert '문항 ① 대사: ok 1(25.0%) · SOUL 없음(운영이 시작 거절) 3(75.0%)' in text   # 문항 단위 가용률(상태별 개수와 비율, ok가 먼저)
    assert '짝 비교(파이프라인 − 손라벨): voice 1↑0↓1=' in text and '짝 비교(t − u): voice 1↑0↓1=' in text and '짝 비교(손라벨끼리 t − u): voice 0↑0↓2=' in text


def test_parser_defaults_follow_the_cheap_safe_choices():
    args = pc.parser().parse_args(['run'])
    assert (args.sets, args.worlds, args.via, args.judge, args.reveal, args.tag, args.limit_usd) == ('1,3n,3m', 'pipeline,hand', 'openai', 'ocx', 'none', 'run', 5.0)
    assert pc.parser().parse_args(['estimate', '--works', 'm01', '--limit', '2']).limit == 2
