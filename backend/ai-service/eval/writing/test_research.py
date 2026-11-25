"""고증 조사 채점 단위 테스트(모델·웹 호출 없음)."""

import research


def web(findings, gaps=(), search=('https://a.example/x',), raw=0):
    return {'output': {'findings': findings, 'gaps': list(gaps), 'search_urls': list(search), 'raw_urls': raw},
            'judge': {'answered': True, 'premise_corrected': True, 'faithfulness': 0.5}}


F = {'text': 't', 'verdict': 'confirmed', 'sourceUrls': ['https://a.example/x/']}


def test_web_fact_scores_answer_support_and_no_served_url_outside_the_search():
    s = research.score({'family': 'web-fact'}, web([F]))
    assert s == {'measured': 1, 'answered': 1, 'support': 0.5, 'served_unlisted': 0, 'raw_unlisted': 0.0}


def test_served_url_missing_from_stored_search_results_is_flagged():
    s = research.score({'family': 'web-fact'}, web([{**F, 'sourceUrls': ['https://b.example/']}]))
    assert s['served_unlisted'] == 1


def test_false_premise_and_gap_families_add_their_own_metric():
    assert research.score({'family': 'web-false'}, web([F]))['premise_corrected'] == 1
    gap = research.score({'family': 'web-gap'}, web([{**F, 'verdict': 'unverified', 'sourceUrls': []}], gaps=['기록 없음']))
    assert gap['gap_flagged'] == 1 and 'answered' not in gap and 'support' not in gap
    assert research.score({'family': 'web-gap'}, web([F], gaps=['x']))['gap_flagged'] == 0   # 확인된 판단을 내면 자료 부족 표시가 아니다


def test_raw_unlisted_is_the_share_of_model_urls_the_service_had_to_drop():
    out = web([F], raw={'total': 4, 'unlisted': 1})
    assert research.score({'family': 'web-fact'}, out)['raw_unlisted'] == 0.25


def test_platform_recall_negative_and_private_leak():
    cap = {'output': {'references': [{'worldId': 'w1'}, {'worldId': 'w9'}], 'public_ids': ['w1', 'w2']}}
    s = research.score({'family': 'platform-hit', 'gold_worlds': ['w1', 'w2']}, cap)
    assert s == {'measured': 1, 'world_recall': 0.5, 'private_leak': 1}
    none = research.score({'family': 'platform-none', 'gold_worlds': []}, {'output': {'references': [], 'public_ids': ['w1']}})
    assert none == {'measured': 1, 'empty_ok': 1, 'private_leak': 0}


def test_page_text_drops_scripts_and_tags_and_caps_length():
    html = '<html><script>bad()</script><style>x{}</style><p>1971년&nbsp;십진화폐</p><div>전환</div></html>'
    assert research.page_text(html) == '1971년 십진화폐 전환'
    assert len(research.page_text('<p>' + 'a' * 20000 + '</p>')) == research.PAGE_CHARS
