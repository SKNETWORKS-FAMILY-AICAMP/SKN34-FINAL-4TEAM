"""집필 채점 단위 테스트(모델 호출 없음): IFEval식 규칙 제약, patch 범위 밖 변경·맞춤법 F1 재사용, 계획 수정 제약."""

import editing


def cap(output, judge=None):
    return {'mode': 'G', 'output': output, 'judge': judge}


def test_plan_constraints_follow_ifeval_kinds():
    case = {'family': 'plan', 'constraints': [{'id': 'keywords:forbidden_words', 'words': ['말포이']},
                                              {'id': 'detectable_format:number_plans', 'min': 2, 'max': 3},
                                              {'id': 'detectable_format:number_beats', 'max': 2}]}
    ok = {'plans': [{'title': '숲', 'beats': ['해리가 숲에 간다']}, {'title': '성', 'beats': ['론', '헤르미온느']}]}
    assert editing.score(case, cap(ok))['constraints'] == 1
    assert editing.score(case, cap({'plans': ok['plans'][:1]}))['constraints'] == 0
    assert editing.score(case, cap({'plans': ok['plans'] + [{'title': '말포이의 방', 'beats': []}]}))['constraints'] == 0


def test_draft_length_paragraph_and_quotation_rules():
    text = '"어서 와."\n\n해리가 웃었다.\n\n론이 손을 흔들었다.'
    assert editing.check({'id': 'startend:quotation'}, text) and editing.check({'id': 'length_constraints:number_paragraphs', 'min': 3}, text)
    assert not editing.check({'id': 'length_constraints:number_chars', 'min': 100}, text)
    assert editing.check({'id': 'keywords:existence', 'words': ['론']}, text)


def test_patch_counts_changes_outside_the_expected_edit():
    case = {'family': 'patch', 'kind': 'replace', 'selection': '해리는 성에 갔다.', 'expected': '해리는 호그와트 성에 갔다.'}
    good = editing.score(case, cap({'after': '해리는 호그와트 성에 갔다.'}))
    bad = editing.score(case, cap({'after': '해리는 웅장한 호그와트 성에 마침내 갔다.'}))
    assert (good['exact'], good['out_of_scope_chars'], good['untouched_outside']) == (1, 0, 1)
    assert bad['exact'] == 0 and bad['out_of_scope_chars'] > 0 and bad['untouched_outside'] == 0


def test_spelling_patch_reuses_the_review_spelling_counts():
    selection, expected = '그는 몇일 뒤 금새 돌아왔다.', '그는 며칠 뒤 금세 돌아왔다.'
    spans = [{'start': 3, 'end': 5, 'correct': '며칠'}, {'start': 8, 'end': 10, 'correct': '금세'}]
    case = {'family': 'patch', 'kind': 'spelling', 'selection': selection, 'expected': expected, 'spans': spans}
    s = editing.score(case, cap({'after': '그는 며칠 뒤 금새 돌아왔다.'}))
    assert (s['tp'], s['fp'], s['fn']) == (1, 0, 1) and s['exact'] == 0


def test_revise_plan_rules_check_title_only_replace_and_append():
    case = {'family': 'revise_plan', 'title': '숲', 'content': '1. 해리가 간다.'}
    assert editing.check({'id': 'revise:title_only', 'title': '숲 (수정)'}, '', {'title': '숲 (수정)', 'content': '1. 해리가 간다.'}, case)
    assert not editing.check({'id': 'revise:title_only', 'title': '숲 (수정)'}, '', {'title': '숲 (수정)', 'content': '1. 론이 간다.'}, case)
    assert editing.check({'id': 'revise:replace', 'old': '해리', 'new': '네빌'}, '', {'title': '숲', 'content': '1. 네빌이 간다.'}, case)
    assert editing.check({'id': 'revise:append'}, '', {'title': '숲', 'content': '1. 해리가 간다.\n2. 다음 날 아침 대연회장에서 셋이 속삭인다.'}, case)


def test_judged_cases_carry_violation_and_quality():
    case = {'family': 'draft', 'constraints': []}
    s = editing.score(case, cap({'text': '글'}, {'violation': True, 'violation_reason': 'x', 'quality': 4}))
    assert (s['violation'], s['quality']) == (1, 4)
