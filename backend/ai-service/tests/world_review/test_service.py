import json

import pytest

from app.content_mcp.errors import ContentMcpFailure
from app.world_review import service
from app.world_review.errors import WorldReviewFailure
from app.world_review.models import MAX_CARD_CHARS, MAX_CARDS, WorldReviewResult

from .stubs import REL, card, fake_agent, fake_openai, finding, fix, request


def test_a_valid_review_is_returned_with_the_reviewed_card_count_and_model(monkeypatch):
    replacement = fix(target='episode', episode=0, text='새 00회차')
    fake_agent(monkeypatch, finding(card_ids=('seoyun', 'war'), kind='doc_role', fix=replacement),
               finding(card_ids=('rule',), kind='other', message='규칙이 모자란다.'))

    result = service.review(request())

    assert [f.kind for f in result.findings] == ['doc_role', 'other']
    assert result.findings[0].fix == replacement and result.findings[1].fix is None
    assert (result.reviewedCards, result.model) == (3, 'resolved-model')


def test_relationships_to_cards_that_were_not_sent_are_not_sent(monkeypatch):
    seen = fake_agent(monkeypatch)

    service.review(request(relationships=[REL, {**REL, 'id': 'rel-2', 'targetCardId': 'ghost'}]))

    assert [r.id for r in seen['data'].relationships] == ['rel-1']


def test_no_cards_means_no_model_call_and_an_empty_review(monkeypatch):
    seen = fake_agent(monkeypatch)

    result = service.review(request(cards=[], relationships=[]))

    assert seen == {} and (result.findings, result.reviewedCards) == ([], 0)


@pytest.mark.parametrize('bad', [
    finding(card_ids=('ghost',)),                                                       # 입력에 없는 카드
    finding(card_ids=('seoyun', 'ghost')),
    finding(card_ids=()),                                                               # 카드 0개
    finding(message='가' * 301),                                                        # 300자 초과
    finding(message='  '),                                                              # 읽을 문장이 없다
    finding(fix=fix(card_id='war', target='body')),                                     # 수정할 카드가 지적의 카드가 아니다
    finding(fix=fix(card_id='ghost', target='body')),                                   # 입력에 없는 카드
    finding(card_ids=('war',), fix=fix(card_id='war', target='soul')),                  # 인물이 아닌 카드의 SOUL
    finding(card_ids=('war',), fix=fix(card_id='war', target='goal')),
    finding(card_ids=('war',), fix=fix(card_id='war', target='episode', episode=0)),
    finding(fix=fix(target='soul', episode=1)),                                         # 회차는 target=episode일 때만
    finding(fix=fix(target='body', episode=0)),
    finding(fix=fix(target='episode', episode=None)),                                   # target=episode는 회차가 있어야 한다
    finding(fix=fix(target='episode', episode=-1)),
    finding(fix=fix(text='가' * 3001)),                                                 # 카드 본문·문서 한도
    finding(fix=fix(target='body', text='가' * 3001)),
    finding(fix=fix(text=' \n')),                                                      # 칸을 비우는 수정은 수정안이 아니다
])
def test_findings_outside_the_contract_are_errors_not_repaired(monkeypatch, bad):
    fake_agent(monkeypatch, bad)
    with pytest.raises(WorldReviewFailure) as error:
        service.review(request())
    assert error.value.status == 502


def test_four_cards_in_one_finding_is_an_error(monkeypatch):
    world = request(cards=[card(f'c{i}') for i in range(4)], relationships=[])
    fake_agent(monkeypatch, finding(card_ids=('c0', 'c1', 'c2', 'c3')))
    with pytest.raises(WorldReviewFailure) as error:
        service.review(world)
    assert error.value.status == 502


@pytest.mark.parametrize('ok', [
    finding(card_ids=('seoyun', 'war', 'rule')),                                        # 카드 3개
    finding(message='가' * 300),
    finding(card_ids=('war',), fix=fix(card_id='war', target='body', text='가' * 3000)),  # 인물이 아닌 카드는 본문만
    finding(fix=fix(target='body')),                                                    # 인물 카드의 본문(IDENTITY)
    finding(fix=fix(target='goal')),
    finding(fix=fix(target='episode', episode=0)),
    finding(card_ids=('war', 'seoyun'), fix=fix(card_id='seoyun', target='episode', episode=12)),  # 아직 없는 회차 문서도 새로 쓸 수 있다
])
def test_findings_inside_the_contract_pass_unchanged(monkeypatch, ok):
    fake_agent(monkeypatch, ok)
    assert service.review(request()).findings == [ok]


def test_trace_keeps_refs_and_never_the_setting_bodies(monkeypatch, spans):
    fake_openai(monkeypatch, WorldReviewResult(findings=[finding(fix=fix())]))

    service.review(request())

    recorded = {s.name: json.loads(s.attributes['langfuse.observation.input']) for s in spans() if 'langfuse.observation.input' in s.attributes}
    assert recorded['world_review'] == {'cards': ['seoyun', 'war', 'rule'], 'relationships': ['rel-1']}
    assert '약초꾼' not in json.dumps(recorded, ensure_ascii=False) and '달이 둘인 대륙' not in json.dumps(recorded, ensure_ascii=False)


# --- 채팅 경로: 작품에 연결된 세계관을 Content MCP로 읽어 같은 요청으로 만든다 ---------------------------------------------------

def payload(id, card_type='location', body='본문', meta=None, lifecycle='active', area='basic'):
    """`world_studio_read`의 카드 한 장(CardPayload JSON). 인물 문서는 semanticMetadata에 있다."""
    return {'id': id, 'title': id.upper(), 'body': body, 'cardType': card_type, 'areaCode': area, 'classification': '', 'aliases': [], 'tags': [],
            'semanticMetadata': meta or {}, 'visibility': 'private', 'lifecycle': lifecycle}


def link(id, source, target, label='겪음', polarity='asserted', lifecycle='active'):
    return {'id': id, 'sourceCardId': source, 'targetCardId': target, 'category': 'structural', 'body': '긴 설명', 'label': label,
            'direction': 'directed', 'polarity': polarity, 'semanticMetadata': {}, 'lifecycle': lifecycle}


def read(cards, relationships=()):
    return {'worldId': 'world-1', 'draftRevision': 3, 'name': '달빛 세계', 'description': '달이 둘인 대륙', 'cards': cards,
            'relationships': list(relationships), 'visibility': 'private'}


def fake_content(monkeypatch, world, linked='work-1'):
    """Content MCP 대역. 호출한 도구 이름과 인자 목록을 돌려준다."""
    calls = []

    def call(tool, arguments):
        calls.append((tool, arguments))
        if tool == 'world_studio_list':
            return [{'worldId': 'world-1', 'linkedWorkId': 'other'}, {'worldId': 'world-2', 'linkedWorkId': linked}]
        if tool == 'world_studio_read':
            return world
        raise AssertionError(tool)

    monkeypatch.setattr(service.content_mcp, 'call', call)
    return calls


DOCS = {'characterDocs': {'soul': '말수가 적다.', 'goal': '동생을 찾는다.', 'memory': '옛 기억', 'episodes': {'3': '편지를 받았다.'}}}


def test_linked_request_reads_the_latest_world_of_the_work_without_an_episode(monkeypatch):
    calls = fake_content(monkeypatch, read(
        [payload('seoyun', 'character', '29세', meta={**DOCS, 'revealFromEpisode': 2}, area='society'), payload('gone', lifecycle='removed'),
         payload('war', 'event', area='history'), payload('stale', 'location', meta=DOCS)],
        [link('rel-1', 'seoyun', 'war'), link('rel-2', 'seoyun', 'gone'), link('rel-3', 'war', 'seoyun', lifecycle='removed'),
         link('rel-4', 'war', 'seoyun', label='원수', polarity='denied')]))

    data = service.linked_request('work-1')

    # 시뮬레이션이 연결 세계관을 찾는 방식(world_studio_list의 linkedWorkId → world_studio_read)이되, 회차를 지정하지 않아 최신 관계다.
    assert calls == [('world_studio_list', {}), ('world_studio_read', {'id': 'world-2'})]
    assert (data.worldName, data.worldDescription) == ('달빛 세계', '달이 둘인 대륙')
    assert [(c.id, c.cardType, c.areaCode, c.title, c.body) for c in data.cards] == [
        ('seoyun', 'character', 'society', 'SEOYUN', '29세'), ('war', 'event', 'history', 'WAR', '본문'), ('stale', 'location', 'basic', 'STALE', '본문')]
    # 인물 문서는 인물 카드에만 읽고, 옛 memory는 00회차 앞에 이어 붙는다.
    assert data.cards[0].characterDocs.model_dump() == {'soul': '말수가 적다.', 'goal': '동생을 찾는다.', 'episodes': {0: '옛 기억', 3: '편지를 받았다.'}}
    assert data.cards[1].characterDocs is None and data.cards[2].characterDocs is None
    assert [(r.id, r.sourceCardId, r.targetCardId, r.label, r.polarity) for r in data.relationships] == [
        ('rel-1', 'seoyun', 'war', '겪음', 'asserted'), ('rel-4', 'war', 'seoyun', '원수', 'denied')]


def test_linked_request_sends_card_links_as_plain_text_in_the_body_and_the_character_documents(monkeypatch):
    # 채팅 경로의 AI 입력 경계: 모델 입력에 카드 id가 섞이지 않게 대상이 있든 없든 글자만 보낸다(DEC-53).
    link = '[승상](card:aaaaaaaa-2222-3333-4444-555555555555)'
    docs = {'characterDocs': {'soul': f'말투 {link}', 'goal': f'목표 {link}', 'episodes': {'0': f'기억 {link}'}}}
    fake_content(monkeypatch, read([payload('seoyun', 'character', f'앞 {link} 뒤', meta=docs), payload('war', 'event', f'{link}')]))

    cards = service.linked_request('work-1').cards

    assert [c.body for c in cards] == ['앞 승상 뒤', '승상']
    assert cards[0].characterDocs.model_dump() == {'soul': '말투 승상', 'goal': '목표 승상', 'episodes': {0: '기억 승상'}}


def test_linked_request_does_not_send_cards_over_the_limits(monkeypatch):
    cards = [payload(f'c{i}') for i in range(MAX_CARDS + 5)]
    cards[1] = payload('long', body='가' * (MAX_CARD_CHARS + 1))
    fake_content(monkeypatch, read(cards, [link('r', 'c0', 'long'), link('s', 'c0', 'c2')]))

    data = service.linked_request('work-1')

    ids = [c.id for c in data.cards]
    assert len(ids) == MAX_CARDS and 'long' not in ids and ids[:3] == ['c0', 'c2', 'c3']
    assert [r.id for r in data.relationships] == ['s']  # 보내지 않은 카드에 이어진 관계는 뺀다


def test_a_work_without_a_linked_world_fails_with_a_reason_the_author_can_read(monkeypatch):
    calls = fake_content(monkeypatch, read([payload('a')]), linked='other-work')

    with pytest.raises(WorldReviewFailure) as error:
        service.linked_request('work-1')

    assert error.value.status == 409 and '연결된 세계관' in str(error.value) and [t for t, _ in calls] == ['world_studio_list']


@pytest.mark.parametrize('world', [{'worldId': 'world-1'}, {**read([payload('a')]), 'cards': 'x'}, read([{**payload('a'), 'areaCode': 'sky'}]),
                                   read([payload('a')], [{'sourceCardId': 'a', 'targetCardId': 'a'}])])  # 관계에 id가 없다
def test_an_unreadable_content_response_is_502_without_echoing_it(monkeypatch, world):
    fake_content(monkeypatch, world)
    with pytest.raises(WorldReviewFailure) as error:
        service.linked_request('work-1')
    assert error.value.status == 502 and 'sky' not in str(error.value)


def test_content_failures_keep_their_status_and_message(monkeypatch):
    def call(tool, arguments):
        raise ContentMcpFailure(404, '세계관을 찾을 수 없어요.')

    monkeypatch.setattr(service.content_mcp, 'call', call)
    with pytest.raises(ContentMcpFailure) as error:
        service.linked_request('work-1')
    assert (error.value.status, str(error.value)) == (404, '세계관을 찾을 수 없어요.')
