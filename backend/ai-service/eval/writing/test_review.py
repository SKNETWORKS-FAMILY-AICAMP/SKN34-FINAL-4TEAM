"""원고 검수 채점 단위 테스트(모델 호출 없음): 모순 탐지·대조 오경고(확정/의심)·맞춤법 F1·오류 삽입 위치."""

import random

import review


def finding(start, end, status='confirmed', category='setting', suggestion=''):
    return {'start': start, 'end': end, 'status': status, 'category': category, 'suggestion': suggestion}


def test_a_contradiction_is_detected_only_by_a_finding_overlapping_the_inserted_sentence():
    case = {'family': 'contradiction', 'inserted': [{'start': 10, 'end': 20}]}
    assert review.score(case, {'output': {'findings': [finding(0, 5)]}}) == {'measured': 1, 'detected': 0, 'detected_confirmed': 0}
    assert review.score(case, {'output': {'findings': [finding(15, 30, 'suspected')]}}) == {'measured': 1, 'detected': 1, 'detected_confirmed': 0}


def test_control_false_alarms_count_only_near_the_changed_sentence_but_clean_counts_every_finding():
    findings = [finding(0, 5, 'confirmed'), finding(12, 14, 'suspected')]
    control = {'family': 'control', 'inserted': [{'start': 10, 'end': 20}]}
    clean = {'family': 'clean', 'inserted': []}
    assert review.score(control, {'output': {'findings': findings}}) == {'measured': 1, 'false_alarm_confirmed': 0, 'false_alarm_suspected': 1}
    assert review.score(clean, {'output': {'findings': findings}}) == {'measured': 1, 'false_alarm_confirmed': 1, 'false_alarm_suspected': 1}


def test_service_failures_are_unmeasured_not_zero():
    assert review.score({'family': 'clean'}, {'output': None}) == {'measured': 0}


def test_spelling_needs_the_right_word_in_the_suggestion_and_stray_spelling_findings_are_false_positives():
    spans = [{'start': 0, 'end': 3, 'correct': '며칠'}, {'start': 10, 'end': 13, 'correct': '금세'}]
    findings = [finding(0, 3, category='spelling', suggestion='며칠 뒤'), finding(10, 13, category='spelling', suggestion='곧'),
                finding(30, 32, category='spelling', suggestion='x'), finding(40, 42, category='name')]
    assert review.spelling_counts(findings, spans) == {'tp': 1, 'fp': 1, 'fn': 1}
    assert review.f1(1, 1, 1) == 0.5 and review.f1(0, 0, 0) is None


def test_inserted_errors_are_at_the_recorded_positions_of_the_changed_text():
    text = '그는 며칠 뒤 금세 돌아와 어떻게든 해 보겠다고 말했다. 해그리드가 문을 열었다.'
    changed, spans = review.swap_typos(text, random.Random(1), 3)
    assert len(spans) == 3 and changed != text
    for s in spans:
        assert changed[s['start']:s['end']] == s['wrong'] and s['wrong'] != s['correct']
