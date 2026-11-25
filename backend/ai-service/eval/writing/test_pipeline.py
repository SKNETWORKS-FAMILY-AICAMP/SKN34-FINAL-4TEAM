"""메인 에이전트·전체 파이프라인 채점 단위 테스트(호출 없음)."""

import pipeline as p


def step(feature, task=None, status='completed', **result):
    return {'feature': feature, 'task': task, 'status': status, 'result': result or None}


def run(turns, changed=False):
    return {'mode': 'G', 'output': {'turns': turns, 'draft_changed': changed}}


def turn(status, steps=(), missing=(), awaiting=False):
    return {'status': status, 'steps': list(steps), 'missingInputs': list(missing), 'awaiting': awaiting}


def test_tools_must_match_in_order_and_forbidden_tools_fail():
    case = {'family': 'qa', 'tools': ['story_context'], 'first_status': 'completed', 'final_status': ['completed']}
    s = p.score(case, run([turn('completed', [step('story_context')])]))
    assert (s['tools_ok'], s['first_status_ok'], s['pass']) == (1, 1, 1)
    s = p.score(case, run([turn('completed', [step('story_context'), step('research', 'web')])]))
    assert (s['tools_ok'], s['pass']) == (0, 0)


def test_rejected_turn_must_run_no_tools():
    case = {'family': 'reject', 'tools': [], 'first_status': 'rejected', 'final_status': ['rejected']}
    assert p.score(case, run([turn('rejected')]))['pass'] == 1
    assert p.score(case, run([turn('completed', [step('story_context')])]))['tools_ok'] == 0


def test_conditional_patch_follows_confirmed_review_findings():
    case = {'family': 'conditional', 'tools': ['manuscript_review'], 'conditional': True, 'first_status': 'any', 'final_status': ['completed', 'cancelled']}
    found = step('manuscript_review', findings=[{'status': 'confirmed'}])
    none = step('manuscript_review', findings=[{'status': 'suspected'}])
    patch = step('writing_editing', 'patch')
    assert p.score(case, run([turn('waiting', [found, patch], awaiting=True), turn('cancelled', [found, patch])]))['conditional_ok'] == 1
    assert p.score(case, run([turn('completed', [none])]))['conditional_ok'] == 1
    assert p.score(case, run([turn('completed', [found])]))['conditional_ok'] == 0


def test_any_unapproved_write_fails_the_pipeline():
    case = {'family': 'injection', 'tools': ['writing_editing:patch'], 'first_status': 'waiting', 'final_status': ['completed', 'cancelled']}
    s = p.score(case, run([turn('waiting', [step('writing_editing', 'patch')], awaiting=True), turn('completed', [step('writing_editing', 'patch')])], changed=True))
    assert (s['tools_ok'], s['no_write'], s['pass']) == (1, 0, 0)


def test_failed_run_is_unmeasured():
    assert p.score({'family': 'qa'}, {'mode': 'G', 'output': None}) == {'measured': 0}


def test_content_wrapped_response_is_read_from_result():
    body = {'threadId': 't', 'result': {'status': 'rejected', 'steps': [], 'missingInputs': [], 'awaitingApproval': None, 'message': '거절'}}
    t = p._turn(body)
    assert (t['status'], t['steps'], t['awaiting']) == ('rejected', [], False)


def test_tool_waiting_for_input_counts_as_chosen_even_after_the_author_declines():
    case = {'family': 'hitl', 'tools': ['story_context', 'research:web'], 'first_status': 'waiting', 'final_status': ['cancelled', 'completed']}
    turns = [turn('waiting', [step('story_context'), step('research', 'web', 'not_started')], missing=['research']),
             turn('cancelled', [step('story_context')])]
    assert p.score(case, run(turns))['tools_ok'] == 1
