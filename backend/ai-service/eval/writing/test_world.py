"""세계관 채점 단위 테스트(모델 호출 없음): check 탐지·대조 오경고, enrich 사실 보존·새 모순·금지 낱말, impact P/R."""

import world


def cap(output, judge=None):
    return {'mode': 'G', 'output': output, 'judge': judge}


def test_conflict_is_detected_and_consistent_control_false_alarms_by_the_same_rule():
    findings = [{'cards': ['론'], 'kind': 'contradiction'}, {'cards': ['헤드위그', '해리'], 'kind': 'contradiction'}]
    assert world.score({'family': 'conflict', 'card': '해리', 'partner': '헤드위그'}, cap({'findings': findings}))['detected'] == 1
    assert world.score({'family': 'consistent', 'card': '해리', 'partner': '헤드위그'}, cap({'findings': findings}))['false_alarm'] == 1
    other_kind = [{'cards': ['해리'], 'kind': 'doc_role'}]
    assert world.score({'family': 'conflict', 'card': '해리', 'partner': '헤드위그'}, cap({'findings': other_kind}))['detected'] == 0


def test_enrich_scores_kept_facts_new_conflicts_over_the_baseline_and_forbidden_words():
    case = {'family': 'enrich', 'card': '세베루스 스네이프', 'english': 'Severus Snape', 'facts': ['a', 'b']}
    out = {'fixes': [{'cardTitle': '세베루스 스네이프', 'target': 'body', 'text': '마법의 약 교수다. 사실 이중첩자다.'}], 'recheck': 3, 'baseline': 1}
    s = world.score(case, cap(out, {'kept': [True, False]}))
    assert (s['valid'], s['fact_kept'], s['new_conflicts']) == (1, 0.5, 2) and s['forbidden'] >= 2   # '이중첩자'·'이중'·'첩자'·'사실은' 계열


def test_enrich_without_a_body_fix_has_no_recheck_score():
    s = world.score({'family': 'enrich', 'card': '해리', 'facts': ['a']}, cap({'fixes': [], 'recheck': None, 'baseline': 0}, {'kept': [False]}))
    assert s['valid'] == 0 and 'new_conflicts' not in s and s['fact_kept'] == 0


def test_impact_compares_cards_and_relationships_ignoring_relationship_direction():
    gold = {'cards': ['해리 포터', '제임스 포터'], 'relationships': ['해리 포터→제임스 포터']}
    affected = [{'kind': 'card', 'ref': '해리 포터'}, {'kind': 'relationship', 'ref': '제임스 포터→해리 포터'}, {'kind': 'card', 'ref': '론'},
                {'kind': 'episode', 'ref': '3'}]
    assert world.impact_counts(gold, affected) == {'impact_tp': 2, 'impact_predicted': 3, 'impact_gold': 3, 'other_affected': 1}
