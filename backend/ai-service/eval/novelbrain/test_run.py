"""실행기의 순수 로직 단위 테스트: 항목→문단 순위 변환·평가용 세계관 구성·구성별 집계."""

import pytest

from run import aggregate, compare, leave_one_out, passage_ranking, reader_input, score_answers, text_world


def test_passage_ranking_maps_cards_excerpts_and_relations_to_passages_in_order():
    pids = {'p1', 'p2', 'p3'}
    rel_pid = {'t0': 'p3', 'm1': 'p1'}
    refs = ['relation:t0', 'card:p1', 'card:e5#identity', 'manuscript:p2', 'manuscript:p1', 'relation:unknown', 'card:e9']
    # p3(관계 t0) → p1(카드) → p2(발췌). 개체 카드·모르는 관계는 문단이 아니다. 같은 문단은 처음 순위에서 한 번만.
    assert passage_ranking(refs, pids, rel_pid) == ['p3', 'p1', 'p2']


def test_text_world_has_passage_cards_text_free_entities_and_provenance_relations():
    sample = {'passages': [{'id': 'p1', 'title': 'Green', 'text': 'Steve Hillage made Green.'},
                           {'id': 'p2', 'text': 'Steve Hillage married Miquette Giraudy.'}]}
    graph = {'entities': {'steve hillage': {'name': 'Steve Hillage', 'type': 'character', 'passages': ['p1', 'p2']},
                          'green': {'name': 'Green', 'type': 'object', 'passages': ['p1']},
                          'm': {'name': 'M', 'type': 'other', 'passages': ['p2']},   # 너무 짧은 이름은 세계관에서 뺀다
                          'miquette giraudy': {'name': 'Miquette Giraudy', 'type': 'character', 'passages': ['p2']}},
             'triples': [{'s': 'steve hillage', 'r': 'made', 'o': 'green', 'p': 'p1'},
                         {'s': 'steve hillage', 'r': 'married', 'o': 'miquette giraudy', 'p': 'p2'},
                         {'s': 'steve hillage', 'r': 'knows', 'o': 'm', 'p': 'p2'}]}
    world, rel_pid = text_world(sample, graph)
    passages = [c for c in world.cards if c.id in ('p1', 'p2')]
    entities = [c for c in world.cards if c.id not in ('p1', 'p2')]
    assert [c.title for c in passages] == ['Green', ''] and all(c.text for c in passages)  # 제목이 없는 문단은 빈 제목
    assert sorted(c.title for c in entities) == ['Green', 'Miquette Giraudy', 'Steve Hillage'] and all(c.text == '' for c in entities)
    triples = [r for r in world.relations if r.label != 'mentioned in']
    assert sorted(r.label for r in triples) == ['made', 'married']      # 'M'이 끝점인 트리플도 빠진다
    assert {rel_pid[r.id] for r in triples} == {'p1', 'p2'}
    mentions = [r for r in world.relations if r.label == 'mentioned in']
    assert len(mentions) == 4 and {rel_pid[r.id] for r in mentions} == {'p1', 'p2'}   # 'M'의 등장 관계도 뺀다: 2+1+1


def test_aggregate_averages_recall_and_precision_and_groups_by_key():
    rows = [{'ranked': ['a', 'b', 'c'], 'gold': ['a', 'x'], 'group': 2},
            {'ranked': ['x', 'y'], 'gold': ['x'], 'group': 3}]
    result = aggregate(rows, k=2, group='group')
    assert result['n'] == 2
    assert result['recall@2'] == (0.5 + 1.0) / 2
    assert result['p@2'] == (0.5 + 0.5) / 2
    assert result['by_group'][2]['recall@2'] == 0.5 and result['by_group'][3]['n'] == 1


def test_aggregate_reports_standard_errors_so_small_gaps_can_be_read_as_noise():
    rows = [{'ranked': ['a'], 'gold': ['a'], 'group': 1}, {'ranked': ['b'], 'gold': ['a'], 'group': 1}]
    result = aggregate(rows, k=1, group='group')
    assert result['recall@1'] == 0.5 and result['recall@1_se'] == pytest.approx(0.5)   # stdev([1, 0]) / sqrt(2)
    assert aggregate(rows[:1], k=1)['recall@1_se'] == 0.0                             # 표본 1개는 오차를 말할 수 없어 0


def test_reader_input_lists_titled_passages_then_the_question():
    text = reader_input('Who?', [{'title': 'Green', 'text': 'Steve made it.'}, {'title': '', 'text': 'No title.'}])
    assert text == '[1] Green\nSteve made it.\n\n[2] No title.\n\nQuestion: Who?\nAnswer:'
    assert reader_input('Who?', []) == 'Question: Who?\nAnswer:'


def test_score_answers_reports_em_f1_by_hops_and_counts_failures():
    rows = [{'pred': 'Miquette Giraudy', 'golds': ['Miquette Giraudy'], 'hops': 2},
            {'pred': 'Steve Hillage Smith', 'golds': ['Steve Hillage'], 'hops': 3},
            {'pred': None, 'golds': ['x'], 'hops': 2}]
    result = score_answers(rows)
    assert result['n'] == 2 and result['failed'] == 1
    assert result['em'] == 0.5 and result['f1'] == (1.0 + 0.8) / 2
    assert result['by_hops'][2]['em'] == 1.0 and result['by_hops'][3]['f1'] == 0.8


def test_leave_one_out_fuses_the_remaining_rankings_with_rrf():
    graph, vector, bm25 = ['g1', 'shared'], ['v1', 'shared'], ['b1', 'shared']
    loo = leave_one_out(graph, vector, bm25)
    assert loo['full'][0] == 'shared' and loo['no_graph'][0] == 'shared'      # 세 목록(또는 남은 두 목록)에 든 ref가 먼저
    assert 'g1' not in loo['no_graph'] and 'v1' not in loo['no_vector'] and 'b1' not in loo['no_bm25']
    assert set(loo['full']) == {'g1', 'v1', 'b1', 'shared'}


def test_compare_runs_the_sign_test_per_pair_and_per_group():
    scores = {'a': [1.0, 1.0, 0.5, 0.0], 'b': [0.0, 1.0, 0.0, 0.0]}
    out = compare(scores, [('a', 'b')], groups=[2, 2, 3, 3])
    assert out['all']['a|b'] == {'up': 2, 'down': 0, 'p': 0.5}
    assert out['by_group'][2]['a|b']['up'] == 1 and out['by_group'][3]['a|b'] == {'up': 1, 'down': 0, 'p': 1.0}
    assert compare(scores, [('a', 'b')])['by_group'] == {}
