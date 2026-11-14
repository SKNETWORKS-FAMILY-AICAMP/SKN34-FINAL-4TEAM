"""평가용 그래프 구성 단위 테스트: 배치·추출 결과 검증·개체 병합·실패를 숨기지 않는 추출 루프."""

import json

import pytest

from graph import Entity, Extraction, PassageOut, Triple, batches, build_graph, entity_key, extract_all, validate
from llm import LlmFailure


def passage(pid, text, title=None):
    return {'id': pid, 'text': text, **({'title': title} if title else {})}


def test_batches_keep_order_and_size():
    items = [passage(f'p{i}', 'x') for i in range(7)]
    assert [[p['id'] for p in b] for b in batches(items, 3)] == [['p0', 'p1', 'p2'], ['p3', 'p4', 'p5'], ['p6']]


def test_entity_key_ignores_case_articles_and_punctuation():
    assert entity_key('The Green Knight') == entity_key('green  knight!')
    assert entity_key("St. Michael's Mount") == 'st michaels mount'


def out(pid, entities=(), triples=()):
    return PassageOut(id=pid, entities=[Entity(name=n, type=t) for n, t in entities],
                      triples=[Triple(subject=s, relation=r, object=o) for s, r, o in triples])


def test_validate_drops_ungrounded_entities_and_bad_triples():
    batch = [passage('p1', 'Steve Hillage married Miquette Giraudy in London.')]
    result = Extraction(passages=[
        out('p1', entities=[('Steve Hillage', 'character'), ('Napoleon', 'character')],
            triples=[('Steve Hillage', 'Married To', 'Miquette Giraudy'),
                     ('Steve Hillage', 'enemy of', 'Napoleon'),      # 본문에 없는 개체
                     ('Steve Hillage', 'is', 'Steve Hillage'),        # 자기 자신
                     ('Steve Hillage', '', 'London')]),                # 관계 없음
        out('p-unknown', triples=[('A', 'b', 'C')]),                  # 요청하지 않은 id
    ])
    valid = validate(batch, result)
    assert list(valid) == ['p1']
    assert [(t.subject, t.relation, t.object) for t in valid['p1'].triples] == [('Steve Hillage', 'married to', 'Miquette Giraudy')]
    assert [e.name for e in valid['p1'].entities] == ['Steve Hillage']


def test_build_graph_merges_surface_forms_and_unique_first_name_aliases():
    passages = [passage('p1', 'x'), passage('p2', 'x'), passage('p3', 'x')]
    outputs = {
        'p1': out('p1', [('Harry Potter', 'character'), ('Hogwarts', 'location')],
                  [('Harry Potter', 'studies at', 'Hogwarts')]),
        'p2': out('p2', [('Harry', 'character')], [('Harry', 'friend of', 'Ron Weasley')]),
        'p3': out('p3', [('the Hogwarts', 'location')], [('Ron Weasley', 'studies at', 'Hogwarts')]),
    }
    graph = build_graph(passages, outputs)
    keys = set(graph['entities'])
    assert keys == {'harry potter', 'hogwarts', 'ron weasley'}  # 'harry'는 유일한 'harry potter'로, 'the hogwarts'는 같은 키로 합쳐진다
    assert graph['entities']['harry potter']['passages'] == ['p1', 'p2']
    assert graph['entities']['hogwarts']['passages'] == ['p1', 'p3']
    assert {(t['s'], t['r'], t['o'], t['p']) for t in graph['triples']} == {
        ('harry potter', 'studies at', 'hogwarts', 'p1'), ('harry potter', 'friend of', 'ron weasley', 'p2'),
        ('ron weasley', 'studies at', 'hogwarts', 'p3')}


def test_ambiguous_first_name_is_not_merged():
    outputs = {'p1': out('p1', [('Harry Potter', 'character'), ('Harry Lime', 'character'), ('Harry', 'character')], [])}
    graph = build_graph([passage('p1', 'x')], outputs)
    assert {'harry potter', 'harry lime', 'harry'} <= set(graph['entities'])


def test_build_graph_reports_passages_the_model_skipped():
    graph = build_graph([passage('p1', 'x'), passage('p2', 'x')], {'p1': out('p1')})
    assert graph['missing'] == ['p2']


class FakeLlm:
    def __init__(self, fail_on=None):
        self.requests, self.fail_on = [], fail_on

    def ask(self, kind, instructions, input, *, schema, max_output_tokens):
        ids = [p['id'] for p in json.loads(input)]
        self.requests.append(ids)
        if self.fail_on in ids:
            raise LlmFailure('transient')
        return Extraction(passages=[out(i, [('Alice', 'character')], [('Alice', 'knows', 'Bob')]) for i in ids])


def test_extract_all_returns_every_batch_result():
    items = [passage(f'p{i}', 'Alice knows Bob.') for i in range(5)]
    llm = FakeLlm()
    result = extract_all(items, llm, batch_size=2, workers=2)
    assert set(result) == {f'p{i}' for i in range(5)}
    assert sorted(len(r) for r in llm.requests) == [1, 2, 2]


def test_extract_all_does_not_hide_a_failed_batch():
    items = [passage(f'p{i}', 'Alice knows Bob.') for i in range(4)]
    with pytest.raises(RuntimeError, match='1 배치'):
        extract_all(items, FakeLlm(fail_on='p3'), batch_size=2, workers=1)
