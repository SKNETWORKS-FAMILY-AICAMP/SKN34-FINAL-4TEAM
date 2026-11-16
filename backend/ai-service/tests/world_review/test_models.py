import pytest
from pydantic import ValidationError

from app.world_review.models import MAX_CARD_CHARS, MAX_CARDS, Finding, Fix, WorldReviewRequest

from .stubs import WORLD, card, request


def docs(**body):
    """서윤 카드에 characterDocs를 body로 넣은 요청에서 읽은 인물 문서."""
    cards = [{**WORLD['cards'][0], 'characterDocs': body}]
    return WorldReviewRequest.model_validate({**WORLD, 'cards': cards, 'relationships': []}).cards[0].characterDocs


def test_old_memory_is_put_before_the_00_episode_like_novelbrain():
    assert docs(soul='s', memory='옛 기억', episodes={'0': '00회차', '1': '1회차'}).episodes == {0: '옛 기억\n\n00회차', 1: '1회차'}


@pytest.mark.parametrize('episodes', [{'1': '1회차'}, {'0': '  \n', '1': '1회차'}])
def test_old_memory_becomes_the_00_episode_when_there_is_none_to_prefix(episodes):
    assert docs(soul='s', memory='옛 기억', episodes=episodes).episodes == {0: '옛 기억', 1: '1회차'}


@pytest.mark.parametrize('memory', [{}, {'memory': ''}, {'memory': ' \n'}])
def test_blank_or_missing_memory_changes_nothing(memory):
    assert docs(soul='s', episodes={'0': '00회차'}, **memory).episodes == {0: '00회차'}


def test_memory_is_not_part_of_what_the_model_receives():
    sent = request().model_dump(exclude_none=True)['cards'][0]['characterDocs']
    assert set(sent) == {'soul', 'goal', 'episodes'}
    assert 'memory' not in docs(soul='s', memory='옛 기억').model_dump()


def test_the_limits_are_the_contract_numbers():
    assert (MAX_CARDS, MAX_CARD_CHARS) == (300, 4000)


def test_card_limits_are_300_cards_and_4000_chars_of_body_and_docs_each():
    WorldReviewRequest.model_validate({**WORLD, 'cards': [card(f'c{i}') for i in range(MAX_CARDS)], 'relationships': []})
    with pytest.raises(ValidationError):
        WorldReviewRequest.model_validate({**WORLD, 'cards': [card(f'c{i}') for i in range(MAX_CARDS + 1)], 'relationships': []})
    fits = {**WORLD['cards'][0], 'body': '가' * (MAX_CARD_CHARS - 10), 'characterDocs': {'soul': '나' * 6, 'goal': '다' * 4, 'episodes': {}}}
    assert WorldReviewRequest.model_validate({**WORLD, 'cards': [fits], 'relationships': []}).cards[0].chars() == MAX_CARD_CHARS
    with pytest.raises(ValidationError):  # 본문과 모든 문서의 합이 한도를 넘는다
        over = {**fits, 'characterDocs': {'soul': '나' * 6, 'goal': '다' * 4, 'episodes': {'7': '라'}}}
        WorldReviewRequest.model_validate({**WORLD, 'cards': [over], 'relationships': []})


@pytest.mark.parametrize('patch', [
    {'cardType': 'monster'}, {'areaCode': 'sky'},
])
def test_card_type_and_area_are_the_contract_codes(patch):
    with pytest.raises(ValidationError):
        WorldReviewRequest.model_validate({**WORLD, 'cards': [{**WORLD['cards'][1], **patch}], 'relationships': []})


def test_relationship_polarity_is_asserted_or_denied():
    with pytest.raises(ValidationError):
        request(relationships=[{**WORLD['relationships'][0], 'polarity': 'both'}])
    assert request(relationships=[{**WORLD['relationships'][0], 'polarity': 'denied'}]).relationships[0].polarity == 'denied'


@pytest.mark.parametrize('key', ['a', '1.5', ''])
def test_episode_keys_are_integers(key):
    with pytest.raises(ValidationError):
        docs(soul='s', episodes={key: '글'})


@pytest.mark.parametrize('kind', ['contradiction', 'doc_role', 'missing_info', 'other'])
def test_finding_kinds_are_the_contract_kinds(kind):
    assert Finding(cardIds=['a'], kind=kind, message='m', fix=None).kind == kind


def test_other_finding_kinds_and_fix_targets_are_rejected():
    with pytest.raises(ValidationError):
        Finding(cardIds=['a'], kind='typo', message='m', fix=None)
    with pytest.raises(ValidationError):
        Fix(cardId='a', target='title', episode=None, text='글')
