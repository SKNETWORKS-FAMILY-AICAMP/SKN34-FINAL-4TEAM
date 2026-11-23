"""장면 채점(원문 장면이 없는 고정 장면용) 단위 테스트: 응답 검증·집계·입력 조립. 모델은 대역이다."""

import json

import pytest
from pydantic import ValidationError

import sim_scene_judge as j
import sim_worlds as w
from app.simulation import service
from llm import LlmFailure


def payload():
    return {'plan': {'mode': 'flow', 'premise': None, 'beats': ['b0']}, 'characters': [{'name': 'A', 'soul': '말투 A'}, {'name': 'B', 'soul': '말투 B'}],
            'turns': [{'index': 0, 'kind': 'narration', 'by': '나레이션', 'text': '글', 'facts': [{'id': 't0f0', 'text': '미래'}]},
                      {'index': 1, 'kind': 'character', 'by': 'A', 'text': '"안녕"', 'facts': []},
                      {'index': 2, 'kind': 'monologue', 'by': 'B', 'text': '속마음', 'facts': [{'id': 't2f0', 'text': '비밀'}]}]}


def grade(**changes):
    turns = [j.TurnGrade(index=0, voice=None, follows=True, leaked=[]), j.TurnGrade(index=1, voice=4, follows=True, leaked=[]),
             j.TurnGrade(index=2, voice=3, follows=False, leaked=['t2f0'])]
    return j.SceneGrade(**{'overall': 4, 'plan': 3, 'turns': turns, **changes})


def test_a_valid_grade_becomes_plain_data():
    assert j.parse_scene_grade(grade(), payload()) == {'overall': 4, 'plan': 3, 'turns': [
        {'index': 0, 'voice': None, 'follows': True, 'leaked': []}, {'index': 1, 'voice': 4, 'follows': True, 'leaked': []},
        {'index': 2, 'voice': 3, 'follows': False, 'leaked': ['t2f0']}]}


@pytest.mark.parametrize('changes', [
    {'overall': 6}, {'overall': 0}, {'plan': 9},
    {'turns': grade().turns[:2]},                                                               # 한 턴이 빠졌다
    {'turns': [*grade().turns, grade().turns[0]]},                                              # 한 턴이 겹친다
    {'turns': [*grade().turns[:2], j.TurnGrade(index=7, voice=3, follows=True, leaked=[])]},    # 없는 턴 번호
    {'turns': [grade().turns[0], j.TurnGrade(index=1, voice=None, follows=True, leaked=[]), grade().turns[2]]},   # 대사 턴인데 말투 점수가 없다
    {'turns': [grade().turns[0], j.TurnGrade(index=1, voice=9, follows=True, leaked=[]), grade().turns[2]]},      # 범위 밖 말투 점수
    {'turns': [grade().turns[0], j.TurnGrade(index=1, voice=4, follows=True, leaked=['t0f0']), grade().turns[2]]},  # 다른 턴의 사실 id
])
def test_a_grade_that_does_not_fit_the_scene_is_a_failed_grade_not_a_guess(changes):
    assert j.parse_scene_grade(grade(**changes), payload()) is None


def test_a_voice_score_on_a_narration_turn_is_dropped_because_narration_has_no_voice():
    turns = [j.TurnGrade(index=0, voice=5, follows=True, leaked=[]), *grade().turns[1:]]
    assert j.parse_scene_grade(grade(turns=turns), payload())['turns'][0]['voice'] is None


class FakeLlm:
    def __init__(self, answer):
        self.answer, self.asked = answer, []

    def ask(self, kind, instructions, text, schema, max_output_tokens):
        self.asked.append((kind, json.loads(text), schema))
        if isinstance(self.answer, Exception):
            raise self.answer
        return self.answer


def test_judge_scene_asks_once_with_the_payload_and_returns_none_when_the_call_or_json_fails():
    llm = FakeLlm(grade())
    assert j.judge_scene(llm, payload())['overall'] == 4 and llm.asked == [('judge', payload(), j.SceneGrade)]
    assert j.judge_scene(FakeLlm(LlmFailure('호출 실패')), payload()) is None
    with pytest.raises(ValidationError) as error:
        j.SceneGrade(overall='x', plan=1, turns=[])
    assert j.judge_scene(FakeLlm(error.value), payload()) is None            # 잘린 JSON은 채점 실패다


def test_scene_metrics_average_the_voice_count_leaking_turns_and_compare_the_two_halves():
    grades = j.parse_scene_grade(grade(), payload())
    got = j.scene_metrics(grades)
    assert got == {'overall': 4, 'plan': 3, 'voice': 3.5, 'leakTurns': 1, 'turns': 3, 'follows': pytest.approx(2 / 3), 'voiceDrift': -1.0}   # 앞 절반(턴 0~1) 4, 뒤 절반(턴 2) 3


def test_turn_facts_keep_the_forbidden_docs_most_like_the_turn_and_give_them_ids():
    docs = [{'ref': f'card:x#ep0{i}', 'label': 'l', 'text': text} for i, text in enumerate(['사자가 성 앞에서 울었다', '아무 관계 없는 이야기', '사자가 성 안으로 들어갔다'])]
    got = j.turn_facts(3, docs, '사자가 성 앞에 섰다', 2)
    assert [f['id'] for f in got] == ['t3f0', 't3f1'] and [f['text'] for f in got] == ['사자가 성 앞에서 울었다', '사자가 성 안으로 들어갔다']
    assert j.turn_facts(0, [], '글', 5) == []


def test_the_scene_payload_has_the_plan_the_souls_and_the_forbidden_facts_per_turn():
    plan, world = w.Worlds([], {}).scene(next(spec for spec in w.SCENES if spec['id'] == 'ko-5-flow'))
    names = [world.characters[i].title for i in plan.characterIds]
    record = {'transcript': {'beats': plan.beats, 'turns': [{'kind': 'narration', 'by': service.NARRATOR, 'text': '바람이 불었다.'},
                                                           {'kind': 'character', 'by': names[0], 'text': '"가자."'}, {'kind': 'monologue', 'by': names[1], 'text': '속으로 생각했다.'}]}}
    got = j.scene_payload(plan, world, record)
    assert got['plan'] == {'mode': 'flow', 'premise': None, 'beats': plan.beats} and [c['name'] for c in got['characters']] == names
    assert all(c['soul'] for c in got['characters']) and [t['index'] for t in got['turns']] == [0, 1, 2] and [t['by'] for t in got['turns']][1:] == names[:2]
    assert all(f['id'].startswith(f't{t["index"]}f') for t in got['turns'] for f in t['facts'])
