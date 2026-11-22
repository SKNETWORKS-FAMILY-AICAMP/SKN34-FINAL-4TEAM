"""시뮬레이션 평가 세트의 생성·채점(app/evaluation/simulation.py): 서비스 호출 그대로 만들고 원문 평가 루브릭으로 채점한다. 모델·채점 호출은 대역이다."""

import asyncio

import pytest

from app.evaluation import rubric, scoring, simulation
from app.evaluation.errors import EvaluationFailure
from app.simulation import agent
from app.simulation.errors import SimulationFailure
from app.simulation.models import Action, Narration

DATA = {'self': {'id': 'c1', 'name': '길동'}, 'known': [], 'scene': [{'ref': 'scene:0', 'by': '길동', 'text': '"가자."'}]}
ACT_INPUT = {'set': 'dialogue', 'data': DATA}
JUDGE = {'character': '길동', 'scene': [{'by': '길동', 'text': '"가자."'}, {'by': '나레이션', 'text': '문이 열렸다.'}], 'facts': [{'id': 'f1', 'text': '미래 사건'}]}
META = {'judge': JUDGE}


def action(prose='"갑시다."', observed='가자고 했다'):
    return Action(prose=prose, observed=observed, refusesBeat=False, refusalReason=None)


def test_generate_calls_the_service_act_with_the_version_body_and_returns_the_normalized_line(monkeypatch):
    seen = {}

    def act(data, instructions=None):
        seen.update(data=data, instructions=instructions)
        return action('  「가자.」 그가 말했다.  ')
    monkeypatch.setattr(agent, 'act', act)

    assert simulation.generate('act', '평가할 버전 본문', ACT_INPUT) == '"가자." 그가 말했다.'   # 서비스처럼 따옴표를 직선으로 통일한다
    assert seen == {'data': DATA, 'instructions': '평가할 버전 본문'}


@pytest.mark.parametrize('kind', ['narration', 'monologue'])
def test_generate_calls_the_service_narrate_and_keeps_the_monologue_without_observed(monkeypatch, kind):
    seen = {}

    def narrate(data, instructions=None):
        seen.update(data=data, instructions=instructions)
        return Narration(prose='  문이 열렸다.  ', observed='' if kind == 'monologue' else '문이 열렸다')
    monkeypatch.setattr(agent, 'narrate', narrate)

    assert simulation.generate('narrate', '평가할 버전 본문', {'set': kind, 'data': DATA}) == '문이 열렸다.'
    assert seen == {'data': DATA, 'instructions': '평가할 버전 본문'}


def test_a_narration_without_observed_is_an_invalid_response_but_a_monologue_is_not(monkeypatch):
    monkeypatch.setattr(agent, 'narrate', lambda data, instructions=None: Narration(prose='문이 열렸다.', observed=''))

    with pytest.raises(SimulationFailure):   # 서비스와 같은 응답 확인(service.narrated)
        simulation.generate('narrate', '본문', {'set': 'narration', 'data': DATA})
    assert simulation.generate('narrate', '본문', {'set': 'monologue', 'data': DATA}) == '문이 열렸다.'


@pytest.mark.parametrize('bad', [{}, {'set': 'dialogue'}, {'set': 'dialogue', 'data': '문자열'}, {'set': 'dialogue', 'data': None}])
def test_an_item_without_the_model_input_never_reaches_the_model(monkeypatch, bad):
    def never(*_, **__):
        raise AssertionError('모델을 부르면 안 된다')
    monkeypatch.setattr(agent, 'act', never)

    with pytest.raises(EvaluationFailure) as error:
        simulation.generate('act', '본문', bad)

    assert error.value.status == 422


def graded(monkeypatch, grade):
    calls = []

    async def rubric_grade(instructions, payload, schema):
        calls.append((instructions, payload, schema))
        return dict(grade)
    monkeypatch.setattr(scoring, 'rubric_grade', rubric_grade)
    return calls


def test_dialogue_is_scored_with_the_original_rubric_as_voice_intent_and_pov_ok(monkeypatch):
    calls = graded(monkeypatch, {'voice': 4, 'intent': 2, 'leaked': []})

    got = asyncio.run(simulation.evaluate('act', ACT_INPUT, '"갑시다."', '"가자."', META))

    assert [(e.name, e.value) for e in got] == [('voice', 0.75), ('intent', 0.25), ('pov_ok', 1.0)]   # 1~5점은 (점수-1)/4로 0~1에 기록한다
    [(instructions, payload, schema)] = calls
    assert (instructions, schema) == (rubric.DIALOGUE_JUDGE, rubric.DialogueGrade)
    assert payload == rubric.dialogue_payload('길동', JUDGE['scene'], '"가자."', '"갑시다."', JUDGE['facts'])   # 원문 평가와 같은 입력(직전 장면 전체와 정답표)


@pytest.mark.parametrize('score, value', [(1, 0.0), (2, 0.25), (3, 0.5), (4, 0.75), (5, 1.0)])
def test_the_rubric_scores_are_recorded_from_zero_to_one_like_the_other_metrics(monkeypatch, score, value):
    graded(monkeypatch, {'voice': score, 'intent': score, 'leaked': ['f1']})

    got = asyncio.run(simulation.evaluate('act', ACT_INPUT, '"갑시다."', '"가자."', META))

    assert [(e.name, e.value) for e in got] == [('voice', value), ('intent', value), ('pov_ok', 0.0)]   # 시점 위반 여부는 원래 0·1이라 그대로다


def test_a_pov_violation_scores_zero_and_names_only_the_fact_ids(monkeypatch):
    graded(monkeypatch, {'voice': 5, 'intent': 5, 'leaked': ['f1']})

    got = asyncio.run(simulation.evaluate('act', ACT_INPUT, '"갑시다."', '"가자."', META))

    pov = got[-1]
    assert (pov.name, pov.value) == ('pov_ok', 0.0) and 'f1' in pov.comment and '미래 사건' not in pov.comment   # 사실 본문은 남기지 않는다


@pytest.mark.parametrize('kind', ['narration', 'monologue'])
def test_narration_and_monologue_are_scored_with_the_narration_rubric(monkeypatch, kind):
    calls = graded(monkeypatch, {'style': 3, 'info': 5, 'leaked': []})

    got = asyncio.run(simulation.evaluate('narrate', {'set': kind, 'data': DATA}, '문이 열렸다.', '다음 문단', META))

    assert [(e.name, e.value) for e in got] == [('style', 0.5), ('info', 1.0), ('pov_ok', 1.0)]
    [(instructions, payload, schema)] = calls
    assert (instructions, schema) == (rubric.NARRATION_JUDGE, rubric.NarrationGrade)
    assert payload == rubric.narration_payload(kind, '길동', JUDGE['scene'], '다음 문단', '문이 열렸다.', JUDGE['facts'])


def test_a_narration_has_no_character_and_still_scores(monkeypatch):
    graded(monkeypatch, {'style': 4, 'info': 4, 'leaked': []})

    got = asyncio.run(simulation.evaluate('narrate', {'set': 'narration', 'data': DATA}, '문이 열렸다.', '다음 문단', {'judge': {**JUDGE, 'character': ''}}))

    assert [e.name for e in got] == ['style', 'info', 'pov_ok']


def test_a_narrate_item_of_an_unknown_kind_fails(monkeypatch):
    calls = graded(monkeypatch, {'style': 4, 'info': 4, 'leaked': []})

    with pytest.raises(EvaluationFailure) as error:
        asyncio.run(simulation.evaluate('narrate', {'set': 'dialogue', 'data': DATA}, '문이 열렸다.', '다음 문단', META))

    assert error.value.status == 422 and calls == []


BAD = [(None, '"가자."'), ({}, '"가자."'), ({'judge': {}}, '"가자."'), ({'judge': {**JUDGE, 'character': None}}, '"가자."'), ({'judge': {**JUDGE, 'facts': 'x'}}, '"가자."'),
       ({'judge': {**JUDGE, 'facts': [{'id': 'f1'}]}}, '"가자."'), ({'judge': {**JUDGE, 'scene': [{'by': '길동'}]}}, '"가자."'), (META, None), (META, '  ')]


@pytest.mark.parametrize('metadata, expected', BAD)
def test_an_item_without_the_answer_or_the_judge_inputs_fails_without_asking_the_judge(monkeypatch, metadata, expected):
    calls = graded(monkeypatch, {'voice': 3, 'intent': 3, 'leaked': []})

    with pytest.raises(EvaluationFailure) as error:
        asyncio.run(simulation.evaluate('act', ACT_INPUT, '"갑시다."', expected, metadata))

    assert error.value.status == 422 and calls == []
