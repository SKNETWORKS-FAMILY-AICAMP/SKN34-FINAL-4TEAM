"""심의 등급 채점·라벨 시트 단위 테스트(모델 호출 없음)."""

import csv

import rating


def cap(verdict):
    return {'output': {'verdict': verdict}}


def test_adult_case_missed_and_non_adult_over_rated_are_scored_separately():
    assert rating.score({'expect': 'adult'}, cap('needsReview')) == {'measured': 1, 'correct': 0, 'adult_case': 1, 'missed_adult': 1, 'over_rated': 0}
    assert rating.score({'expect': 'general'}, cap('needsReview'))['over_rated'] == 1          # 원작의 평이한 회차를 '검토 필요'로 올린 경우
    assert rating.score({'expect': 'not_adult'}, cap('needsReview'))['over_rated'] == 0        # 폭력 장면의 검토 필요는 허용
    assert rating.score({'expect': 'not_adult'}, cap('adult'))['over_rated'] == 1
    assert rating.score({'expect': 'adult'}, {'output': {'verdict': None}}) == {'measured': 0}


def test_human_label_replaces_the_constructed_expectation_when_present():
    case = {'expect': 'general', 'human': 'adult'}
    assert rating.score(case, cap('adult'))['correct'] == 1 and rating.score(case, cap('adult'))['adult_case'] == 1


def test_second_opinion_needs_review_only_when_it_falls_outside_the_allowed_verdicts():
    assert rating.disagrees('not_adult', 'needsReview') is False
    assert rating.disagrees('general', 'needsReview') is True
    assert rating.disagrees('adult', 'adult') is False


def test_label_sheet_puts_review_rows_first_with_bom_and_blank_human_column(tmp_path):
    path = tmp_path / 'x.csv'
    rating.write_labels(path, [{'id': 'a', 'family': 'f', 'summary': 's', 'gold': 'general', 'second': 'general', 'review': False},
                               {'id': 'b', 'family': 'f', 'summary': 's', 'gold': 'general', 'second': 'adult', 'review': True}])
    assert path.read_bytes().startswith(b'\xef\xbb\xbf')
    rows = list(csv.reader(path.open(encoding='utf-8-sig')))
    assert rows[0] == rating.LABEL_COLUMNS and [r[0] for r in rows[1:]] == ['b', 'a'] and rows[1][5] == 'Y' and rows[1][6] == ''


def test_profanity_only_rows_exclude_other_hate_labels():
    lines = ['document\tlabel', '욕1\t3', '정치\t2,3', '평범\t8', '욕2\t3']
    assert rating.kmhas_rows(lines) == {'profanity': ['욕1', '욕2'], 'clean': ['평범']}


def test_kappa_uses_human_labels_mapped_to_verdict_classes():
    cases = {'a': {'expect': 'general', 'human': 'general'}, 'b': {'expect': 'adult', 'human': 'adult'}}
    scored = [('a', 0, cap('general'), rating.score(cases['a'], cap('general'))), ('b', 0, cap('adult'), rating.score(cases['b'], cap('adult')))]
    assert rating.summary(cases, scored)['human_kappa']['value'] == 1.0
