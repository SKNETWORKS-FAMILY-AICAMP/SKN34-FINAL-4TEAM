"""Research `platform`(#547): 다른 작가의 공개 세계관에서 참고 설정을 찾는다. 모델과 Content MCP는 대역이다."""

import pytest

from app.content_mcp.errors import ContentMcpFailure
from app.research import service
from app.research.errors import ResearchFailure
from app.research.models import PlatformReference

from .stubs import FakeMcp, card, platform_models, public_world

ASK = '마법 학원 설정 참고할 만한 세계관 찾아줘'


def platform(monkeypatch, public, own=(), **models):
    mcp = FakeMcp(public, own)
    monkeypatch.setattr(service.content_mcp, 'call', mcp)
    return mcp, platform_models(monkeypatch, service, **models)


def test_picks_reads_and_fills_the_source_from_what_was_read(monkeypatch):
    public = {'w1': public_world('w1', [card('c1', '학원 기숙사'), card('c2', '교칙')]), 'w2': public_world('w2', [card('c3')])}
    mcp, seen = platform(monkeypatch, public, pick=['w1'], refs=[('w1', 'c2', '교칙 서술 방식을 참고')], gaps=['학원 위치는 못 찾음'])

    result = service.platform(ASK)

    # 세계관 이름·카드 제목·작가는 모델 출력이 아니라 읽은 값이다.
    assert result.references == [PlatformReference(worldId='w1', worldName='세계 w1', cardId='c2', cardTitle='교칙', authorNickname='작가 w1',
                                                   note='교칙 서술 방식을 참고')]
    assert result.gaps == ['학원 위치는 못 찾음']
    # 1회차는 세계관 요약(id·이름·설명·장르·작가·카드 수)만, 2회차는 고른 세계관의 읽은 카드를 받는다.
    [(asked, worlds)] = seen.pick
    assert asked == ASK and worlds == [
        {'id': 'w1', 'name': '세계 w1', 'description': 'w1 설명', 'genre': 'fantasy', 'author': '작가 w1', 'cardCount': 2},
        {'id': 'w2', 'name': '세계 w2', 'description': 'w2 설명', 'genre': 'fantasy', 'author': '작가 w2', 'cardCount': 1}]
    [(_, read)] = seen.refer
    assert [w['worldId'] for w in read] == ['w1'] and [c['cardId'] for c in read[0]['cards']] == ['c1', 'c2']
    assert mcp.reads() == ['w1']
    assert {t for t, _ in mcp.calls} == {'world_studio_list', 'world_studio_public_list', 'world_studio_public_read'}  # 읽기 도구 셋뿐이다


def test_does_not_offer_the_authors_own_worlds(monkeypatch):
    public = {'mine': public_world('mine', [card('m1')]), 'w1': public_world('w1', [card('c1')])}
    _, seen = platform(monkeypatch, public, own=['mine'], pick=['w1'])

    service.platform(ASK)

    assert [w['id'] for w in seen.pick[0][1]] == ['w1']


@pytest.mark.parametrize('picked', ['not-listed', 'mine'])
def test_rejects_a_world_the_model_picked_outside_the_candidates(monkeypatch, picked):
    public = {'mine': public_world('mine', [card('m1')]), 'w1': public_world('w1', [card('c1')])}
    mcp, seen = platform(monkeypatch, public, own=['mine'], pick=[picked])

    with pytest.raises(ResearchFailure) as error:
        service.platform(ASK)

    assert error.value.status == 502 and mcp.reads() == [] and seen.refer == []


@pytest.mark.parametrize('cited', [('w1', 'c3'), ('w2', 'c1'), ('w1', 'nope')])
def test_rejects_a_citation_that_was_not_read(monkeypatch, cited):
    public = {'w1': public_world('w1', [card('c1')]), 'w2': public_world('w2', [card('c3')])}
    platform(monkeypatch, public, pick=['w1'], refs=[(*cited, '근거')])

    with pytest.raises(ResearchFailure) as error:
        service.platform(ASK)

    assert error.value.status == 502


def test_without_other_public_worlds_returns_no_result_without_calling_the_model(monkeypatch):
    mcp, seen = platform(monkeypatch, {'mine': public_world('mine', [card('m1')])}, own=['mine'])

    result = service.platform(ASK)

    assert result.references == [] and result.gaps
    assert seen.pick == [] and seen.refer == [] and mcp.reads() == []


def test_with_no_pick_returns_no_result_without_the_second_model_call(monkeypatch):
    mcp, seen = platform(monkeypatch, {'w1': public_world('w1', [card('c1')])}, pick=[])

    result = service.platform(ASK)

    assert result.references == [] and result.gaps
    assert len(seen.pick) == 1 and seen.refer == [] and mcp.reads() == []


def test_reads_at_most_three_candidates(monkeypatch):
    public = {f'w{i}': public_world(f'w{i}', [card(f'c{i}')]) for i in range(1, 6)}
    mcp, seen = platform(monkeypatch, public, pick=['w1', 'w1', 'w2', 'w3', 'w4', 'w5'], refs=[('w3', 'c3', '참고')])

    result = service.platform(ASK)

    assert mcp.reads() == ['w1', 'w2', 'w3']  # 같은 id를 다시 골라도 자리를 쓰지 않고, 넘치는 후보는 앞의 셋만 읽는다
    assert [w['worldId'] for w in seen.refer[0][1]] == ['w1', 'w2', 'w3'] and result.references[0].worldId == 'w3'


def test_reads_every_page_of_the_public_list(monkeypatch):
    public = {f'w{i:03}': public_world(f'w{i:03}') for i in range(205)}
    mcp, seen = platform(monkeypatch, public, pick=[])

    service.platform(ASK)

    pages = [a for t, a in mcp.calls if t == 'world_studio_public_list']
    assert [(p['page'], p['size']) for p in pages] == [('0', '100'), ('1', '100'), ('2', '100')]
    assert len(seen.pick[0][1]) == 205


def test_cuts_long_cards_and_stops_sending_cards_once_the_total_is_used_up(monkeypatch):
    monkeypatch.setattr(service, 'CARD_CHARS', 10)
    monkeypatch.setattr(service, 'TOTAL_CHARS', 15)
    public = {'w1': public_world('w1', [card('c1', text='가' * 50), card('c2', text='나' * 8), card('c3', text='다' * 8), card('c4', text='라')])}
    _, seen = platform(monkeypatch, public, pick=['w1'])

    service.platform(ASK)

    [world] = seen.refer[0][1]
    cards = {c['cardId']: c for c in world['cards']}
    # 장당 10자, 전체 15자: 첫 카드는 장당 한도에서, 둘째는 남은 5자에서 잘리고, 남은 글자가 없으면 그 뒤 카드(c3·c4)는 입력에 넣지 않고 세계관에 생략 수만 단다.
    assert (cards['c1']['text'], cards['c1']['truncated']) == ('가' * 10, True)
    assert (cards['c2']['text'], cards['c2']['truncated']) == ('나' * 5, True)
    assert list(cards) == ['c1', 'c2'] and world['omittedCards'] == 2


def test_says_nothing_about_omitted_cards_while_every_card_fits(monkeypatch):
    public = {'w1': public_world('w1', [card('c1'), card('c2')])}
    _, seen = platform(monkeypatch, public, pick=['w1'])

    service.platform(ASK)

    [world] = seen.refer[0][1]
    assert len(world['cards']) == 2 and 'omittedCards' not in world


def test_rejects_a_citation_of_a_card_left_out_of_the_model_input(monkeypatch):
    monkeypatch.setattr(service, 'TOTAL_CHARS', 4)
    public = {'w1': public_world('w1', [card('c1', text='가나다라마'), card('c2')])}
    platform(monkeypatch, public, pick=['w1'], refs=[('w1', 'c2', '근거')])

    with pytest.raises(ResearchFailure) as error:
        service.platform(ASK)

    assert error.value.status == 502


def test_keeps_short_cards_whole_and_hides_card_links_from_the_model(monkeypatch):
    link = '[학원](card:11111111-1111-4111-8111-111111111111) 옆 기숙사'
    _, seen = platform(monkeypatch, {'w1': public_world('w1', [card('c1', text=link)])}, pick=['w1'])

    service.platform(ASK)

    [read] = seen.refer[0][1][0]['cards']
    assert read['text'] == '학원 옆 기숙사' and 'truncated' not in read


def test_surfaces_content_mcp_failures(monkeypatch):
    def broken(tool, arguments):
        raise ContentMcpFailure(503, 'Content MCP를 호출할 수 없습니다.')
    monkeypatch.setattr(service.content_mcp, 'call', broken)
    seen = platform_models(monkeypatch, service)

    with pytest.raises(ContentMcpFailure) as error:
        service.platform(ASK)

    assert error.value.status == 503 and seen.pick == []


def test_rejects_an_unreadable_content_response(monkeypatch):
    monkeypatch.setattr(service.content_mcp, 'call', lambda tool, arguments: {'unexpected': True})
    platform_models(monkeypatch, service)

    with pytest.raises(ContentMcpFailure) as error:
        service.platform(ASK)

    assert error.value.status == 502


def test_needs_a_request(monkeypatch):
    platform(monkeypatch, {'w1': public_world('w1', [card('c1')])}, pick=['w1'])
    with pytest.raises(ResearchFailure) as error:
        service.platform('  ')
    assert error.value.status == 422
