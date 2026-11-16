"""DEC-47 적재 문서는 SOUL·GOAL·회차 기억만 받는다."""
import pytest
from pydantic import ValidationError
from app.preprocessing.models import CharacterDocs


def test_goal_and_episode_zero_survive_payload_round_trip():
    data = {'soul': '신분 차별을 싫어한다', 'goal': '율도국을 세운다', 'episodes': {'00': '서자임을 안다', '03': '활빈당을 만났다'}}
    assert CharacterDocs.model_validate(data).model_dump() == data


def test_legacy_memory_is_not_an_output_document():
    with pytest.raises(ValidationError):
        CharacterDocs(soul='성격', memory='기억', episodes={})
