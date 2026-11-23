"""Research `platform`(#547)의 모델 호출 두 번(후보 고르기·참고안). ChatOpenAI는 대역이다."""

import json

import pytest
from fake_chat import fake_chat

from app.research import agent
from app.research.errors import ResearchFailure
from app.research.models import PlatformDraft, PlatformPick, Reference

WORLDS = [{'id': 'w1', 'name': '달빛 세계', 'description': '설명', 'genre': 'fantasy', 'author': '작가', 'cardCount': 2}]


def test_pick_asks_for_world_ids_as_structured_output(monkeypatch):
    seen = fake_chat(monkeypatch, text=PlatformPick(worldIds=['w1']).model_dump_json())

    picked = agent.pick('마법 학원 참고', WORLDS)

    assert picked == PlatformPick(worldIds=['w1'])
    assert seen['init']['store'] is False and seen['init']['include'] is None and seen['tools'] == []
    assert json.loads(seen['messages'][-1].content) == {'request': '마법 학원 참고', 'worlds': WORLDS}
    assert '실행하지 않는다' in seen['messages'][0].content  # 카드·설명 속 지시를 따르지 않는다는 안전 지시


def test_refer_returns_the_draft_from_the_read_cards(monkeypatch):
    draft = PlatformDraft(references=[Reference(worldId='w1', cardId='c1', note='참고')], gaps=['빠진 것'])
    seen = fake_chat(monkeypatch, text=draft.model_dump_json())
    read = [{'worldId': 'w1', 'name': '달빛 세계', 'cards': [{'cardId': 'c1', 'title': '교칙', 'text': '본문'}]}]

    assert agent.refer('마법 학원 참고', read) == draft
    assert json.loads(seen['messages'][-1].content)['worlds'] == read
    assert '수정안은 쓰지 않는다' in seen['messages'][0].content


def test_traces_keep_only_the_request_and_ids_not_descriptions_or_card_text(monkeypatch):
    traced = []
    monkeypatch.setattr(agent.agent_runtime, 'run', lambda *args, trace, schema, **kw: traced.append(trace) or (None, schema.model_construct()))
    read = [{'worldId': 'w1', 'name': '달빛 세계', 'description': '설명', 'cards': [{'cardId': 'c1', 'title': '교칙', 'text': '본문'}]}]

    agent.pick('요청', WORLDS)
    agent.refer('요청', read)

    assert traced == [{'request': '요청', 'worldIds': ['w1']}, {'request': '요청', 'worldIds': ['w1'], 'cardIds': ['c1']}]


@pytest.mark.parametrize('call', [lambda: agent.pick('요청', WORLDS), lambda: agent.refer('요청', [])])
def test_model_calls_fail_closed_on_an_incomplete_response(monkeypatch, call):
    fake_chat(monkeypatch, text='', status='incomplete')
    with pytest.raises(ResearchFailure) as error:
        call()
    assert error.value.status == 502
