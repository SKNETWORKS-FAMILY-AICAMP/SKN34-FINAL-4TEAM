"""작품 Q&A 채점·문항 도구 단위 테스트(모델·검색 호출 없음)."""

import qa

GOLD = [{'episode': 3, 'start': 100, 'end': 160}]


def hit(ep, start, end, i='h'):
    return {'id': i, 'episode': ep, 'start': start, 'end': end}


def test_quote_must_appear_verbatim_to_become_a_gold_span():
    body = '해리는 벽장에서 살았다. 편지가 왔다.'
    assert qa.locate(body, '편지가 왔다.') == (14, 21)
    assert qa.locate(body, '편지가 도착했다.') is None


def test_gold_window_centers_the_span_and_stays_inside_the_body():
    body = ''.join(str(i % 10) for i in range(1000))
    w = qa.window(body, 500, 510, 100)
    assert len(w) == 100 and body[500:510] in w and w == body[455:555]
    assert qa.window(body, 0, 10, 100) == body[:100] and qa.window(body, 990, 1000, 100) == body[900:]
    assert qa.window(body, 0, 300, 100) == body[:100]   # 범위가 창보다 길면 앞부분


def test_substitution_replaces_longest_names_once_without_chaining():
    assert qa.substitute('해리 포터와 론 위즐리가 호그와트에 갔다') == '도윤 서머벨와 켄 마치뱅크가 엘름홀드에 갔다'
    assert qa.substitute('그리핀도르') == '그레이번'   # '그리' 같은 짧은 키가 먼저 먹지 않는다


def test_second_opinion_agreement_is_loose_on_spacing_and_containment():
    assert qa.agree('헤드위그', '흰 올빼미 헤드위그')
    assert qa.agree('9와 4분의 3 승강장', '9와4분의3승강장')
    assert not qa.agree('론', '헤르미온느') and not qa.agree('', '론')


def test_split_puts_a_third_of_each_family_in_dev():
    assert [qa.split_of(i) for i in range(6)] == ['dev', 'test', 'test', 'dev', 'test', 'test']


def test_search_scores_recall_at_8_mrr_and_rank_for_the_curve():
    hits = [hit(3, 0, 90), hit(5, 100, 160), hit(3, 150, 300), hit(3, 120, 130)]
    assert qa.first_rank(hits, GOLD) == 3
    s = qa.score_search({'family': 'single', 'basis': 6, 'gold': GOLD}, {'manuscript': hits, 'world': []})
    assert s == {'measured': 1, 'leak': 0, 'recall@8': 1, 'rr': 1 / 3, 'rank': 3}


def test_retrieved_chunk_after_the_basis_episode_is_a_leak():
    s = qa.score_search({'family': 'future', 'basis': 4, 'gold': [{'episode': 9, 'start': 0, 'end': 5}]}, {'manuscript': [hit(2, 0, 9), hit(9, 0, 9)], 'world': []})
    assert s == {'measured': 1, 'leak': 1}


def test_setting_question_scores_card_recall_at_8():
    s = qa.score_search({'family': 'setting', 'basis': 50, 'gold_card': '호그와트'}, {'manuscript': [], 'world': [{'title': '그리핀도르'}, {'title': '호그와트'}]})
    assert s['card_recall@8'] == 1
    failed = qa.score_search({'family': 'setting', 'basis': 50, 'gold_card': '호그와트'}, {'manuscript': [], 'world': [], 'world_error': '502: x'})
    assert 'card_recall@8' not in failed and failed['measured'] == 1   # 세계관 읽기 실패는 카드 지표만 미측정


def claims(*texts, sources=('e1',)):
    return {'claims': [{'text': t, 'kind': 'confirmed', 'sourceIds': list(sources)} for t in texts], 'gaps': [], 'quotes': {'e1': 'q', 'e2': 'r'},
            'gold_ids': ['e1']}


def test_answerable_question_scores_judge_faithfulness_and_distractor_citations():
    case = {'family': 'single'}
    judged = {'correct': True, 'faithfulness': 1.0, 'closed': True}
    assert qa.score_answer(case, {'output': claims('x', sources=('e1', 'e2')), 'judge': judged}) == {
        'measured': 1, 'false_abstain': 0, 'correctness': 1, 'faithfulness': 1.0, 'noise_cited': 0.5, 'memorized': 1}
    refused = qa.score_answer(case, {'output': claims(), 'judge': {'closed': False}})
    assert refused == {'measured': 1, 'false_abstain': 1, 'correctness': 0, 'memorized': 0}


def test_noise_cited_is_the_share_of_cited_ids_outside_the_gold_evidence():
    assert qa.noise_cited(claims('a', 'b', sources=('e2',))) == 1.0
    assert qa.noise_cited(claims('a', sources=('e1',))) == 0.0 and qa.noise_cited(claims()) == 0.0


def test_out_of_scope_question_passes_only_when_the_answer_abstains():
    case = {'family': 'future'}
    assert qa.score_answer(case, {'output': claims(), 'judge': {}})['abstain_ok'] == 1
    bad = qa.score_answer(case, {'output': claims('미래 사실'), 'judge': {'faithfulness': 0.0}})
    assert bad == {'measured': 1, 'abstain_ok': 0, 'faithfulness': 0.0}


def test_failed_generation_or_judge_is_unmeasured():
    assert qa.score_answer({'family': 'single'}, {'output': None}) == {'measured': 0}
    assert qa.score_answer({'family': 'single'}, {'output': claims('x'), 'judge': None}) == {'measured': 0}


def test_summary_means_floats_rates_binaries_and_draws_the_recall_curve():
    cases = {'a': {'family': 'single', 'split': 'test'}, 'b': {'family': 'single', 'split': 'dev'}}
    scored = [('a', 0, {}, {'measured': 1, 'recall@8': 1, 'rank': 2, 'correctness': 0.5}),
              ('b', 0, {}, {'measured': 1, 'recall@8': 0, 'rank': 0, 'correctness': 1.0})]
    out = qa.summary(cases, scored)
    assert out['recall@8']['value'] == 0.5 and out['correctness'] == {'mean': 0.75, 'n': 2}
    assert out['recall_curve'][1] == 0 and out['recall_curve'][2] == 0.5 and 'rank' not in out
    assert out['by_split']['test']['correctness']['mean'] == 0.5


def test_label_sheet_flags_disagreements_and_puts_them_first():
    rows = [{'id': 'qa.single-001', 'family': 'single', 'split': 'test', 'basis': 5, 'question': 'q1', 'answer': '헤드위그',
             'second': {'answer': '헤드위그', 'answerable': True}},
            {'id': 'qa.single-002', 'family': 'single', 'split': 'test', 'basis': 5, 'question': 'q2', 'answer': '론',
             'second': {'answer': '헤르미온느', 'answerable': True}},
            {'id': 'qa.none-001', 'family': 'none', 'split': 'dev', 'basis': 9, 'question': 'q3', 'second': {'answer': '', 'answerable': False}}]
    table = qa.label_rows(rows)
    assert [t['id'] for t in table] == ['qa.single-002', 'qa.none-001', 'qa.single-001']
    assert [t['needs_review'] for t in table] == ['Y', 'N', 'N'] and table[1]['모델 정답'] == '답할 수 없음'
    assert 'κ표본' in table[0]['메모'] and table[1]['메모'] == ''
