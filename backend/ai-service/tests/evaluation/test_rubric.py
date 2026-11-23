"""시뮬레이션 평가 루브릭(rubric): 운영 회귀 평가와 원문 평가(eval/simulation)가 같은 문구·같은 입력 모양을 쓴다."""

import pytest
from pydantic import ValidationError

from app.evaluation import rubric

FACTS = [{'id': 'f1', 'text': '해리는 호그와트에 입학했다', 'extra': 'x'}, {'id': 'f2', 'text': '론의 쥐가 사라졌다'}, {'id': 'f3', 'text': '마법사의 돌이 지하에 있다'}]


def test_top_facts_ranks_by_shared_bigrams_with_the_text_and_keeps_input_order_on_ties():
    got = rubric.top_facts('호그와트에 입학했다', FACTS, 2)
    assert [f['id'] for f in got] == ['f1', 'f2']   # f1이 가장 겹치고 나머지는 겹침이 같아 입력 순서
    assert [f['id'] for f in rubric.top_facts('', FACTS, 10)] == ['f1', 'f2', 'f3']


def test_parse_grade_accepts_scores_one_to_five_and_known_fact_ids_only():
    ok = rubric.DialogueGrade(voice=4, intent=2, leaked=['f1'])
    assert rubric.parse_grade(ok, ['f1', 'f2']) == {'voice': 4, 'intent': 2, 'leaked': ['f1']}
    assert rubric.parse_grade(rubric.DialogueGrade(voice=6, intent=2, leaked=[]), ['f1']) is None   # 범위 밖
    assert rubric.parse_grade(rubric.DialogueGrade(voice=3, intent=3, leaked=['zzz']), ['f1']) is None   # 입력에 없는 id
    assert rubric.parse_grade(rubric.NarrationGrade(style=5, info=1, leaked=[]), []) == {'style': 5, 'info': 1, 'leaked': []}
    with pytest.raises(ValidationError):
        rubric.DialogueGrade(voice='높음', intent=1, leaked=[])


SCENE = [{'ref': 'scene:0', 'by': '길동', 'text': '"가자."', 'extra': 1}]


def test_the_judge_payloads_keep_only_what_the_rubric_reads_and_rank_the_facts_by_the_generated_text():
    dialogue = rubric.dialogue_payload('길동', SCENE, '"가자."', '"호그와트에 입학했다."', FACTS)
    assert list(dialogue) == ['character', 'scene', 'gold', 'generated', 'facts']
    assert dialogue['scene'] == [{'by': '길동', 'text': '"가자."'}] and dialogue['facts'][0] == {'id': 'f1', 'text': '해리는 호그와트에 입학했다'}   # id·text만
    narration = rubric.narration_payload('monologue', '길동', SCENE, '다음 문단', '생성 문단', FACTS)
    assert list(narration) == ['kind', 'character', 'scene', 'gold', 'generated', 'facts'] and narration['kind'] == 'monologue'


def test_only_the_top_facts_up_to_the_limit_reach_the_judge():
    many = [{'id': f'f{i}', 'text': f'사실{i}번'} for i in range(rubric.FACTS + 10)]
    assert len(rubric.dialogue_payload('길동', SCENE, 'g', '생성', many)['facts']) == rubric.FACTS
