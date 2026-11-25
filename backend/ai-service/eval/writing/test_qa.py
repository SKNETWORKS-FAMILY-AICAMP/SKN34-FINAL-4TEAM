"""작품 Q&A 채점 단위 테스트(모델·검색 호출 없음)."""

import qa

GOLD = [{'episode': 3, 'start': 100, 'end': 160}]


def hit(ep, start, end, i='h'):
    return {'id': i, 'episode': ep, 'start': start, 'end': end}


def test_quote_must_appear_verbatim_to_become_a_gold_span():
    body = '해리는 벽장에서 살았다. 편지가 왔다.'
    assert qa.locate(body, '편지가 왔다.') == (14, 21)
    assert qa.locate(body, '편지가 도착했다.') is None


def test_first_rank_overlapping_the_gold_span_drives_recall_and_mrr():
    hits = [hit(3, 0, 90), hit(5, 100, 160), hit(3, 150, 300), hit(3, 120, 130)]
    assert qa.first_rank(hits, GOLD) == 3
    s = qa.score_search({'family': 'single', 'basis': 6, 'gold': GOLD}, {'manuscript': hits, 'world': []})
    assert (s['recall@1'], s['recall@3'], s['recall@8'], s['rr']) == (0, 1, 1, 1 / 3)


def test_retrieved_chunk_after_the_basis_episode_is_a_leak():
    s = qa.score_search({'family': 'future', 'basis': 4, 'gold': [{'episode': 9, 'start': 0, 'end': 5}]}, {'manuscript': [hit(2, 0, 9), hit(9, 0, 9)], 'world': []})
    assert s['leak'] == 1 and 'recall@8' not in s


def test_setting_question_is_found_when_the_gold_card_is_among_world_excerpts():
    s = qa.score_search({'family': 'setting', 'basis': 50, 'gold_card': '호그와트'}, {'manuscript': [], 'world': [{'title': '그리핀도르'}, {'title': '호그와트'}]})
    assert s['card_found'] == 1


def test_answer_scoring_uses_judge_and_citations():
    case = {'family': 'single', 'basis': 6, 'gold': GOLD}
    capture = {'output': {'claims': [{'text': 'x', 'kind': 'confirmed', 'sourceIds': ['m1', 'm2']}], 'gaps': []},
               'evidence': {'m1': hit(3, 110, 140), 'm2': hit(2, 0, 10)}, 'judge': {'correct': True, 'abstained': False, 'supported': True}}
    s = qa.score_answer(case, capture)
    assert (s['correct'], s['citation_hit'], s['citation_precision'], s['false_abstain'], s['supported']) == (1, 1, 0.5, 0, 1)


def test_unanswerable_question_passes_only_when_the_answer_abstains():
    case = {'family': 'none', 'basis': 6}
    ok = qa.score_answer(case, {'output': {'claims': [], 'gaps': ['없음']}, 'evidence': {}, 'judge': {'correct': True, 'abstained': True, 'supported': True}})
    bad = qa.score_answer(case, {'output': {'claims': [], 'gaps': []}, 'evidence': {}, 'judge': {'correct': False, 'abstained': False, 'supported': True}})
    assert (ok['abstain_ok'], bad['abstain_ok']) == (1, 0) and 'citation_hit' not in ok


def test_failed_generation_or_judge_is_unmeasured():
    assert qa.score_answer({'family': 'single', 'gold': GOLD}, {'output': None}) == {'measured': 0}
    assert qa.score_answer({'family': 'single', 'gold': GOLD}, {'output': {'claims': [], 'gaps': []}, 'evidence': {}, 'judge': None}) == {'measured': 0}
