"""DEC-47 적재 문서는 SOUL·GOAL·회차 기억만 받는다."""
import pytest
from pydantic import ValidationError
from app.preprocessing.models import Card, CharacterDocs


def test_initial_load_carries_first_appearance_without_reader_disclosure():
    card = Card(key='hero', cardType='character', title='길동', aliases=[],
                body='길동', firstAppearanceEpisode=3)
    serialized = card.model_dump(mode='json')
    assert serialized['firstAppearanceEpisode'] == 3
    assert 'revealFromEpisode' not in serialized
    assert Card.model_validate(serialized) == card


@pytest.mark.parametrize('include_first_appearance', [False, True])
def test_initial_load_rejects_ambiguous_legacy_disclosure_field(include_first_appearance):
    data = dict(key='hero', cardType='character', title='길동', aliases=[],
                body='길동', revealFromEpisode=3)
    if include_first_appearance:
        data['firstAppearanceEpisode'] = 3
    with pytest.raises(ValidationError):
        Card.model_validate(data)


def test_goal_and_episode_zero_survive_payload_round_trip():
    data = {'soul': '신분 차별을 싫어한다', 'goal': '율도국을 세운다', 'episodes': {'00': '서자임을 안다', '03': '활빈당을 만났다'}}
    assert CharacterDocs.model_validate(data).model_dump() == data


def test_legacy_memory_is_not_an_output_document():
    with pytest.raises(ValidationError):
        CharacterDocs(soul='성격', memory='기억', episodes={})
