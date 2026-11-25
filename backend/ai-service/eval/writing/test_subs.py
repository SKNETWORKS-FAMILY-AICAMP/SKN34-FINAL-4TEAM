"""원고 검수·세계관·집필·심의·고증 채점 단위 테스트(모델 호출 없음)."""

import editing
import rating
import research
import review
import world


def cap(output, judge=None):
    return {'mode': 'G', 'output': output, 'judge': judge}


def test_review_detects_when_a_finding_overlaps_the_inserted_span():
    case = {'family': 'contradiction', 'inserted': [{'start': 50, 'end': 70}]}
    found = cap({'findings': [{'start': 10, 'end': 20, 'status': 'suspected'}, {'start': 60, 'end': 65, 'status': 'confirmed'}]})
    assert review.score(case, found) == {'measured': 1, 'detected': 1, 'findings': 2}
    assert review.score(case, cap({'findings': [{'start': None, 'end': None, 'status': 'confirmed'}]}))['detected'] == 0


def test_review_clean_excerpt_counts_confirmed_findings_as_false_alarm():
    s = review.score({'family': 'clean', 'inserted': []}, cap({'findings': [{'start': 1, 'end': 2, 'status': 'suspected'}]}))
    assert (s['false_alarm'], s['findings']) == (0, 1)
    s = review.score({'family': 'clean', 'inserted': []}, cap({'findings': [{'start': 1, 'end': 2, 'status': 'confirmed'}]}))
    assert s['false_alarm'] == 1


def test_typos_are_counted_one_by_one():
    case = {'family': 'typo', 'inserted': [{'start': 0, 'end': 3}, {'start': 10, 'end': 13}, {'start': 20, 'end': 23}]}
    s = review.score(case, cap({'findings': [{'start': 9, 'end': 12, 'status': 'confirmed'}]}))
    assert (s['typos_found'], s['typos']) == (1, 3)


def test_world_conflict_is_detected_when_a_finding_names_the_changed_or_partner_card():
    case = {'family': 'conflict', 'card': '해리', 'partner': '헤드위그'}
    assert world.score(case, cap({'findings': [{'cards': ['론']}, {'cards': ['헤드위그', '해리']}]}))['detected'] == 1
    assert world.score(case, cap({'findings': [{'cards': ['론']}]}))['detected'] == 0


def test_world_enrich_measures_kept_sentences_and_forbidden_words():
    case = {'family': 'enrich', 'card': '스네이프', 'original': '마법의 약 교수다. 해리를 싫어한다.'}
    out = {'fixes': [{'cardTitle': '스네이프', 'target': 'body', 'text': '마법의 약 교수다. 사실 이중첩자다.'}]}
    s = world.score(case, cap(out))
    assert (s['kept'], s['forbidden'], s['valid']) == (0.5, 1, 1)


def test_patch_preserves_text_outside_the_requested_fix():
    case = {'family': 'patch', 'selection': '해리는 성에 도착햇다.', 'expected': '해리는 성에 도착했다.'}
    good = editing.score(case, cap({'after': '해리는 성에 도착했다.'}))
    bad = editing.score(case, cap({'after': '해리는 웅장한 성에 마침내 도착했다.'}))
    assert (good['exact'], good['preserved']) == (1, 1) and (bad['exact'], bad['preserved']) == (0, 0)


def test_plan_obeys_banned_name_and_count_constraints():
    case = {'family': 'plan', 'banned': ['론'], 'max_plans': 3}
    ok = editing.score(case, cap({'plans': [{'title': '숲', 'beats': ['해리가 숲에 간다']}]}))
    bad = editing.score(case, cap({'plans': [{'title': '숲', 'beats': ['론이 따라온다']}] * 4}))
    assert (ok['constraints'], bad['constraints']) == (1, 0)


def test_rating_counts_missed_adult_separately_from_over_rating():
    assert rating.score({'expect': 'adult'}, cap({'verdict': 'general'})) == {'measured': 1, 'correct': 0, 'adult_case': 1, 'missed_adult': 1, 'over_rated': 0}
    assert rating.score({'expect': 'general'}, cap({'verdict': 'adult'}))['over_rated'] == 1
    assert rating.score({'expect': 'review'}, cap({'verdict': 'needsReview'}))['correct'] == 1
    assert rating.score({'expect': 'not_adult'}, cap({'verdict': 'needsReview'}))['correct'] == 1
    assert rating.score({'expect': 'not_adult'}, cap({'verdict': 'adult'}))['over_rated'] == 1
    assert rating.score({'expect': 'adult'}, cap({'verdict': None}))['measured'] == 0


def test_research_needs_sourced_findings_and_flags_false_premise():
    case = {'family': 'web', 'false_premise': True}
    out = {'findings': [{'verdict': 'confirmed', 'sourceUrls': ['https://a']}, {'verdict': 'unverified', 'sourceUrls': []}], 'gaps': []}
    s = research.score(case, cap(out, {'premise_corrected': True, 'answered': True}))
    assert (s['sourced'], s['premise_corrected'], s['answered']) == (0.5, 1, 1)
