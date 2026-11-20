"""DEC-47 적재 문서는 SOUL·GOAL·회차 기억만 받는다."""
import pytest
from pydantic import ValidationError
from app.manuscript_extraction.models import Card, CharacterDocs, ExtractedRelation, ProposedRelation


def test_initial_load_carries_first_appearance_without_reader_disclosure():
    card = Card(key='hero', cardType='character', title='길동', aliases=[],
                body='길동', firstEpisode=3)
    serialized = card.model_dump(mode='json')
    assert serialized['firstEpisode'] == 3
    assert 'revealFromEpisode' not in serialized
    assert Card.model_validate(serialized) == card


@pytest.mark.parametrize('include_first_appearance', [False, True])
def test_initial_load_rejects_ambiguous_legacy_disclosure_field(include_first_appearance):
    data = dict(key='hero', cardType='character', title='길동', aliases=[],
                body='길동', revealFromEpisode=3)
    if include_first_appearance:
        data['firstEpisode'] = 3
    with pytest.raises(ValidationError):
        Card.model_validate(data)


def test_goal_and_episode_zero_survive_payload_round_trip():
    data = {'soul': '신분 차별을 싫어한다', 'goal': '율도국을 세운다', 'episodes': {'00': '서자임을 안다', '03': '활빈당을 만났다'}}
    assert CharacterDocs.model_validate(data).model_dump() == data


def test_legacy_memory_is_not_an_output_document():
    with pytest.raises(ValidationError):
        CharacterDocs(soul='성격', memory='기억', episodes={})


def test_the_model_proposes_only_started_or_ended_and_never_the_episode():
    """관계의 시작 회차와 종료 여부는 프로그램이 현재 회차로 채운다. 모델이 낼 모양에는 없다."""
    assert set(ProposedRelation.model_fields) == {'id', 'source', 'target', 'label', 'change', 'quote'}
    fields = dict(id='r1', source='m1', target='m2', label='소속', quote='길동은 활빈당에 가입했다.')
    ProposedRelation(**fields, change='started'), ProposedRelation(**fields, change='ended')
    for change in ('learned', 'changed'):
        with pytest.raises(ValidationError):
            ProposedRelation(**fields, change=change)
    with pytest.raises(ValidationError):
        ProposedRelation(**fields, change='started', fromEpisode=1)
    assert set(ExtractedRelation.model_fields) == set(ProposedRelation.model_fields) | {'fromEpisode', 'ended'}
