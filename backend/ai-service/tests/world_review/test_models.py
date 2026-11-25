import pytest
from pydantic import ValidationError

from app.world_review.models import (MAX_CARD_CHARS, MAX_CARDS, MAX_FILL_CHARS, Affected, CardFix, EnrichResponse, Finding, Fix, FillLine,
                                     FillRequest, FillResponse, ImpactResponse, WorldReviewRequest)

from .stubs import FILL, WORLD, affected, card, fill_line, fill_request, request


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


def test_refs_are_the_card_and_relationship_ids_in_input_order():
    assert request().refs() == {'cards': ['seoyun', 'war', 'rule'], 'relationships': ['rel-1']}


def test_enrich_response_has_exactly_the_contract_keys():
    fixes = [CardFix(cardId='seoyun', cardTitle='서윤', target='episode', episode=3, text='새 글')]
    shown = EnrichResponse(worldId='w', revision=7, fixes=fixes, note='보강했다', model='m').model_dump()
    assert shown == {'worldId': 'w', 'revision': 7, 'note': '보강했다', 'model': 'm', 'fixes': [
        {'cardId': 'seoyun', 'cardTitle': '서윤', 'target': 'episode', 'episode': 3, 'text': '새 글'}]}
    assert issubclass(CardFix, Fix)  # 수정안 규칙(target·episode·text)은 check의 Fix와 같다


def test_impact_response_has_exactly_the_contract_keys():
    shown = ImpactResponse(affected=[affected(kind='scene', ref='scene-1', certainty='inferred')], conflicts=['충돌'], gaps=['모름'], model='m').model_dump()
    assert shown == {'affected': [{'kind': 'scene', 'ref': 'scene-1', 'title': '서윤', 'reason': '나이 설정이 바뀐다.', 'certainty': 'inferred'}],
                     'conflicts': ['충돌'], 'gaps': ['모름'], 'model': 'm'}


@pytest.mark.parametrize('patch', [{'kind': 'plot'}, {'kind': 'chapter'}, {'certainty': 'likely'}, {'certainty': 'suspected'}])
def test_affected_kinds_and_certainties_are_the_contract_values(patch):
    with pytest.raises(ValidationError):
        Affected(**{'kind': 'card', 'ref': 'a', 'title': 't', 'reason': 'r', 'certainty': 'confirmed', **patch})


# --- fill: 한 인물의 비어 있는 IDENTITY·SOUL을 원고 발췌의 문장으로 채운다 ---------------------------------------------------------------

def test_fill_limit_is_the_contract_number():
    assert MAX_FILL_CHARS == 12000


def test_fill_request_takes_one_card_its_names_the_empty_targets_and_the_passages():
    data = fill_request()
    assert (data.cardId, data.title, data.aliases, data.targets) == ('chisam', '치삼', ['치삼이'], ['body', 'soul'])
    assert [(p.episode, p.text[:4]) for p in data.passages] == [(2, '장터의 '), (4, '"됐어,')]
    assert fill_request(aliases=[]).aliases == []


@pytest.mark.parametrize('patch', [
    {'passages': []},                                                      # 발췌가 없으면 고를 문장이 없다
    {'targets': []},                                                       # 채울 문서가 없다
    {'targets': ['goal']},                                                 # GOAL은 선택 문서라 채우지 않는다
    {'targets': ['body', 'soul', 'goal']},
    {'title': ''},
    {'cardId': ''},
    {'passages': [{'episode': 0, 'text': '글'}]},                          # 회차는 1 이상
    {'passages': [{'episode': 1, 'text': ''}]},
])
def test_a_fill_request_outside_the_contract_is_rejected(patch):
    with pytest.raises(ValidationError):
        FillRequest.model_validate({**FILL, **patch})


def test_fill_passages_are_limited_to_12000_chars_in_total():
    fill_request(passages=[{'episode': 1, 'text': '가' * 6000}, {'episode': 2, 'text': '나' * 6000}])
    with pytest.raises(ValidationError):
        fill_request(passages=[{'episode': 1, 'text': '가' * 6000}, {'episode': 2, 'text': '나' * 6001}])


def test_fill_refs_are_the_card_id_the_targets_and_the_episode_numbers_never_the_text_or_the_names():
    assert fill_request().refs() == {'cardId': 'chisam', 'targets': ['body', 'soul'], 'episodes': [2, 4]}
    assert fill_request(passages=[{'episode': 5, 'text': '가'}, {'episode': 3, 'text': '나'}, {'episode': 5, 'text': '다'}]).refs()['episodes'] == [3, 5]


def test_fill_line_kinds_and_targets_are_the_contract_values():
    assert fill_line(target='soul', kind='fact').kind == 'fact'
    with pytest.raises(ValidationError):
        FillLine(target='goal', kind='fact', episode=1, quote='글')
    with pytest.raises(ValidationError):
        FillLine(target='body', kind='rule', episode=1, quote='글')


def test_fill_response_has_exactly_the_contract_keys():
    shown = FillResponse(lines=[fill_line()], skipped=1, model='m').model_dump()
    assert shown == {'lines': [{'target': 'body', 'kind': 'description', 'episode': 2, 'quote': '키가 작고 얼굴이 검게 탔다.'}], 'skipped': 1, 'model': 'm'}
