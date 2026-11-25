"""심의·고증 채점 단위 테스트(모델 호출 없음)."""

import rating
import research


def cap(output, judge=None):
    return {'mode': 'G', 'output': output, 'judge': judge}


def test_rating_counts_missed_adult_separately_from_over_rating():
    assert rating.score({'expect': 'adult'}, cap({'verdict': 'general'})) == {'measured': 1, 'correct': 0, 'adult_case': 1, 'missed_adult': 1, 'over_rated': 0}
    assert rating.score({'expect': 'general'}, cap({'verdict': 'adult'}))['over_rated'] == 1
    assert rating.score({'expect': 'review'}, cap({'verdict': 'needsReview'}))['correct'] == 1
    assert rating.score({'expect': 'not_adult'}, cap({'verdict': 'needsReview'}))['correct'] == 1
    assert rating.score({'expect': 'not_adult'}, cap({'verdict': 'adult'}))['over_rated'] == 1
    assert rating.score({'expect': 'adult'}, cap({'verdict': None}))['measured'] == 0


def test_research_needs_sourced_findings_and_flags_false_premise():
    # v2.1: '출처 붙은 비율(sourced)'은 출처 지지율(support, Ragas)과 겹쳐 뺐다(test_research.py가 자세히 본다)
    case = {'family': 'web-false'}
    out = {'findings': [{'verdict': 'confirmed', 'sourceUrls': ['https://a']}, {'verdict': 'unverified', 'sourceUrls': []}], 'gaps': [],
           'search_urls': ['https://a'], 'raw_urls': {'total': 1, 'unlisted': 0}}
    s = research.score(case, cap(out, {'premise_corrected': True, 'answered': True, 'faithfulness': 1.0}))
    assert (s['support'], s['premise_corrected'], s['answered'], s['served_unlisted']) == (1.0, 1, 1, 0)
