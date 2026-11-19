import json

import pytest

from app.content_mcp import service
from app.content_mcp.errors import ContentMcpFailure

EPISODE = {'number': 3, 'draft': {'title': '3화', 'body': '그는 웃었다. 바람이 불었다.', 'revision': 7, 'authorNote': '메모'}}


def content(monkeypatch, replies, authorization='Bearer user'):
    """Content MCP 대역. replies는 도구 이름별 (is_error, text). 호출 기록 list를 돌려준다."""
    monkeypatch.setenv('CONTENT_SERVICE_BASE_URL', 'http://content.test/')
    service.AUTHORIZATION.set(authorization)
    calls = []

    async def request(url, auth, tool, arguments):
        calls.append((url, auth, tool, arguments))
        return replies[tool]

    monkeypatch.setattr(service, '_request', request)
    return calls


def saved(revision=8):
    return False, json.dumps({'number': 3, 'draft': {'revision': revision}})


def test_approved_patch_replaces_only_the_selection_with_user_token(monkeypatch):
    calls = content(monkeypatch, {'episode_read': (False, json.dumps(EPISODE)), 'episode_update_draft': saved()})
    applied = service.apply_writing('work', 3, {'before': '그는 웃었다.', 'after': '그는 차갑게 웃었다.'})
    assert applied == {'episode': 3, 'revision': 8}
    assert [(c[0], c[1], c[2]) for c in calls] == [('http://content.test/mcp', 'Bearer user', 'episode_read'),
                                                    ('http://content.test/mcp', 'Bearer user', 'episode_update_draft')]
    assert calls[1][3] == {'id': 'work', 'number': 3, 'data': {
        'title': '3화', 'body': '그는 차갑게 웃었다. 바람이 불었다.', 'revision': 7, 'authorNote': '메모'}}


@pytest.mark.parametrize('body, before', [('바람이 불었다.', '그는 웃었다.'), ('그는 웃었다. 그는 웃었다.', '그는 웃었다.'),
                                          ('하하하', '하하')])  # 겹쳐 두 곳인 선택도 모호하다(#390)
def test_patch_whose_selection_is_gone_or_ambiguous_writes_nothing(monkeypatch, body, before):
    episode = {**EPISODE, 'draft': {**EPISODE['draft'], 'body': body}}
    calls = content(monkeypatch, {'episode_read': (False, json.dumps(episode))})
    with pytest.raises(ContentMcpFailure) as error:
        service.apply_writing('work', 3, {'before': before, 'after': 'x'})
    assert error.value.status == 409
    assert [c[2] for c in calls] == ['episode_read']


@pytest.mark.parametrize('body, expected', [('', '선장은 항구에 내렸다.'), ('앞 장면.', '앞 장면.\n\n선장은 항구에 내렸다.')])
def test_approved_draft_text_is_appended_so_the_existing_draft_is_kept(monkeypatch, body, expected):
    episode = {**EPISODE, 'draft': {**EPISODE['draft'], 'body': body}}
    calls = content(monkeypatch, {'episode_read': (False, json.dumps(episode)), 'episode_update_draft': saved()})
    service.apply_writing('work', 3, {'text': '선장은 항구에 내렸다.'})
    assert calls[1][3]['data']['body'] == expected


@pytest.mark.parametrize('text, status, message', [
    ('HTTP 409 CONFLICT\n초안이 최신이 아니에요.', 409, '초안이 최신이 아니에요.'),
    ('HTTP 401 AUTHENTICATION_REQUIRED\n인증이 필요해요.', 401, '인증이 필요해요.'),
    ('HTTP 500', 502, 'Content 작업에 실패했습니다.'),
    ('Invalid arguments', 502, 'Content 작업에 실패했습니다.'),
])
def test_tool_errors_keep_content_status_and_detail_or_close_as_502(monkeypatch, text, status, message):
    content(monkeypatch, {'episode_read': (True, text)})
    with pytest.raises(ContentMcpFailure) as error:
        service.call('episode_read', {'id': 'work', 'number': 3})
    assert (error.value.status, str(error.value)) == (status, message)


def test_missing_user_token_or_base_url_never_calls_content(monkeypatch):
    calls = content(monkeypatch, {}, authorization='')
    with pytest.raises(ContentMcpFailure) as error:
        service.call('episode_read', {})
    assert error.value.status == 401
    monkeypatch.delenv('CONTENT_SERVICE_BASE_URL')
    service.AUTHORIZATION.set('Bearer user')
    with pytest.raises(ContentMcpFailure) as error:
        service.call('episode_read', {})
    assert error.value.status == 503 and calls == []


def test_transport_failure_and_non_json_result_are_explicit_failures(monkeypatch):
    content(monkeypatch, {'episode_read': (False, 'not json')})
    with pytest.raises(ContentMcpFailure) as error:
        service.call('episode_read', {})
    assert error.value.status == 502

    async def broken(*_):
        raise OSError('connection refused')

    monkeypatch.setattr(service, '_request', broken)
    with pytest.raises(ContentMcpFailure) as error:
        service.call('episode_read', {})
    assert error.value.status == 503


def test_valid_json_with_incomplete_draft_is_rejected_before_writing(monkeypatch):
    calls = content(monkeypatch, {'episode_read': (False, '{"draft": {}}')})

    with pytest.raises(ContentMcpFailure) as error:
        service.apply_writing('work', 3, {'text': '이어쓰기'})

    assert error.value.status == 502
    assert [call[2] for call in calls] == ['episode_read']


def inherited(**fields):
    return False, json.dumps({'workId': 'fork', 'worldId': '00000000-0000-0000-0000-000000000001', 'upto': 2, 'cards': [], 'relationships': [],
                              'relationshipStatus': 'current', 'relationshipVersion': 3, **fields})


def test_inherited_world_reads_the_originals_world_with_the_user_token_up_to_the_episode(monkeypatch):
    calls = content(monkeypatch, {'work_inherited_world': inherited(cards=[{'id': 'kael'}])})
    read = service.inherited_world('fork', 4)
    assert [c[1:] for c in calls] == [('Bearer user', 'work_inherited_world', {'id': 'fork', 'upto': '4'})]
    assert read['cards'] == [{'id': 'kael'}] and read['worldId'] == '00000000-0000-0000-0000-000000000001'


def test_inherited_world_is_none_when_the_work_inherits_nothing(monkeypatch):
    content(monkeypatch, {'work_inherited_world': inherited(worldId=None)})
    assert service.inherited_world('fork', 4) is None


@pytest.mark.parametrize('reply', [inherited(relationshipStatus='unavailable'), (False, '[]')])
def test_inherited_world_with_unreadable_relations_or_a_bad_reply_fails_instead_of_running_without_relations(monkeypatch, reply):
    content(monkeypatch, {'work_inherited_world': reply})
    with pytest.raises(ContentMcpFailure) as error:
        service.inherited_world('fork', 4)
    assert error.value.status in (502, 503)


# --- apply_world: 작가가 승인한 설정 보강 제안을 세계관 초안의 그 칸에만 반영한다 ---------------------------------------------------

WORLD_ID = '00000000-0000-0000-0000-0000000000a1'
KAEL, WAR, RULE = 'card-kael', 'card-war', 'card-rule'
REL = {'id': 'rel-1', 'sourceCardId': KAEL, 'targetCardId': WAR, 'category': 'structural', 'body': '긴 설명', 'label': '겪음', 'direction': 'directed',
       'polarity': 'asserted', 'semanticMetadata': {}, 'lifecycle': 'active'}
def screen_card(card):
    """화면에서 만든 카드: semanticMetadata.studio.item이 카드와 같은 id·제목·본문·영역을 가진다. 프런트(HttpWorldStudioRepository.world())는 이 사본이
    본문(item.text)·제목·영역·분류·태그·별칭과 어긋나면 세계관 전체를 읽지 못한다."""
    item = {'id': card['id'], 'kind': 'entity', 'title': card['title'], 'text': card['body'], 'category': card['areaCode'], 'topics': [],
            'entityType': card['cardType'], 'subjectId': None, 'targetId': None, 'predicate': None, 'polarity': 'asserted', 'relatedIds': [],
            'condition': '', 'timeText': '', 'afterId': None, 'orderEvidence': [], 'evidence': [], 'origin': 'author_input', 'authorText': card['body'],
            'decision': 'approved'}
    studio = {'templateOrder': 1, 'userCategory': card['classification'], 'tags': card['tags'], 'aliases': card['aliases'], 'item': item}
    return {**card, 'semanticMetadata': {**card['semanticMetadata'], 'studio': studio}}


KAEL_CARD = screen_card({'id': KAEL, 'title': '카엘', 'body': '북문을 지키는 기사', 'cardType': 'character', 'areaCode': 'society', 'classification': '기사단',
                         'aliases': ['북문의 기사'], 'tags': ['주인공'], 'visibility': 'public', 'lifecycle': 'active',
                         'semanticMetadata': {'revealFromEpisode': 2, 'imageId': 'img-1',
                                              'characterDocs': {'soul': '말이 짧다', 'goal': '북문을 지킨다', 'episodes': {'0': '시작 전', '3': '편지를 받았다'}}}})
WAR_CARD = screen_card({'id': WAR, 'title': '북방 전쟁', 'body': '10년 전 일어난 전쟁', 'cardType': 'event', 'areaCode': 'history', 'classification': '',
                        'aliases': [], 'tags': [], 'visibility': 'private', 'lifecycle': 'active', 'semanticMetadata': {'revealFromEpisode': 1}})
# 옛 Seeder 카드는 정본 필드만 저장해 메타데이터가 비어 있다(studio 없음).
RULE_CARD = {'id': RULE, 'title': '달의 규칙', 'body': '달이 둘이다', 'cardType': 'rule', 'areaCode': 'special', 'classification': '', 'aliases': [], 'tags': [],
             'visibility': 'private', 'lifecycle': 'active', 'semanticMetadata': {}}
GONE_CARD = {**RULE_CARD, 'id': 'card-gone', 'lifecycle': 'removed'}
# 6-B로 반영한 AI 후보 카드의 부분 studio: item에 text가 없고(엄격 스키마) preprocessing이 따라온다. 여기에 text를 더하면 프런트가 읽지 못한다.
PARTIAL_CARD = {**WAR_CARD, 'id': 'card-partial', 'semanticMetadata': {
    'studio': {'item': {'id': 'card-partial', 'kind': 'note', 'subjectId': None, 'relatedIds': []}}, 'preprocessing': {'semanticType': 'event'}}}


def world_read(revision=7, cards=(KAEL_CARD, WAR_CARD, RULE_CARD, GONE_CARD)):
    """`world_studio_read`의 응답(WorldDraftResponse). 관계는 최신 회차 시점이다."""
    return False, json.dumps({'worldId': WORLD_ID, 'draftRevision': revision, 'name': '달빛 세계', 'description': '달이 둘인 대륙', 'cards': list(cards),
                              'relationships': [REL], 'relationshipEpisodes': {'rel-1': 3}, 'visibility': 'private'})


def world_saved(revision=8):
    return False, json.dumps({'worldId': WORLD_ID, 'draftRevision': revision, 'name': '달빛 세계', 'cards': [], 'relationships': []})


def fix_of(target='soul', text='새 글', card_id=KAEL, episode=None):
    return {'cardId': card_id, 'cardTitle': '제목', 'target': target, 'episode': episode, 'text': text}


def edited(monkeypatch, fixes, read=None):
    """apply_world를 실행하고 (결과, Content 호출 목록)을 돌려준다. edit_draft의 요청 본문은 calls[1][3]['request']다."""
    calls = content(monkeypatch, {'world_studio_read': read or world_read(), 'world_studio_edit_draft': world_saved()})
    return service.apply_world(WORLD_ID, 7, fixes), calls


def sent_card(calls, card_id=KAEL):
    [card] = [c for c in calls[1][3]['request']['cards'] if c['id'] == card_id]
    return card


@pytest.mark.parametrize('target, episode, path', [('soul', None, ('soul',)), ('goal', None, ('goal',)), ('episode', 3, ('episodes', '3')),
                                                   ('episode', 12, ('episodes', '12'))])  # 이미 있는 회차 문서와 아직 없는 회차 문서
def test_apply_world_changes_only_the_one_cell_of_the_character_documents(monkeypatch, target, episode, path):
    result, calls = edited(monkeypatch, [fix_of(target=target, episode=episode, text='새 글')])

    sent = sent_card(calls)
    expected = json.loads(json.dumps(KAEL_CARD))
    cell = expected['semanticMetadata']['characterDocs']
    for key in path[:-1]:
        cell = cell[key]
    cell[path[-1]] = '새 글'
    # 칸 하나만 바뀌고 제목·별칭·태그·공개 범위·분류·읽은 메타데이터(revealFromEpisode·imageId·studio)는 읽은 그대로 돌려보낸다.
    # 인물 문서는 최상위 characterDocs에만 있고 studio.item 안에 사본이 없어(프런트 metadataOf·studio 스키마) studio는 맞출 것이 없다.
    assert sent == expected
    assert result == {'worldId': WORLD_ID, 'revision': 8}


@pytest.mark.parametrize('card', [KAEL_CARD, WAR_CARD], ids=['character', 'event'])
def test_apply_world_body_fix_rewrites_the_screens_copy_of_the_body_too_so_the_frontend_can_still_read_the_world(monkeypatch, card):
    _, calls = edited(monkeypatch, [fix_of(target='body', card_id=card['id'], text='새 글')])

    # 프런트는 studio.item.text !== body이면 세계관 전체를 거절한다(HttpWorldStudioRepository.ts world(): row.item.text !== c.body).
    # 그래서 본문과 item.text가 함께 새 글이고, 그 밖(제목·영역·분류·태그·별칭·authorText·공개 회차·이미지·인물 문서·templateOrder)은 읽은 그대로다.
    expected = json.loads(json.dumps(card))
    expected['body'] = expected['semanticMetadata']['studio']['item']['text'] = '새 글'
    assert sent_card(calls, card['id']) == expected


@pytest.mark.parametrize('card', [RULE_CARD, PARTIAL_CARD], ids=['no-studio', 'partial-studio'])
def test_apply_world_body_fix_adds_no_keys_to_a_card_without_a_studio_item_text(monkeypatch, card):
    # studio가 없는 옛 카드와 text 없는 부분 studio(엄격 스키마)에는 새 키를 만들지 않는다. 본문만 바뀐다.
    _, calls = edited(monkeypatch, [fix_of(target='body', card_id=card['id'], text='새 글')], read=world_read(cards=[card]))
    assert sent_card(calls, card['id']) == {**card, 'body': '새 글'}


def test_apply_world_edits_the_draft_with_the_user_token_and_never_touches_other_cards_or_relationships(monkeypatch):
    _, calls = edited(monkeypatch, [fix_of(target='body', card_id=WAR, text='북방 전쟁은 10년 전에 시작됐다.'), fix_of(target='soul')])

    assert [(c[1], c[2]) for c in calls] == [('Bearer user', 'world_studio_read'), ('Bearer user', 'world_studio_edit_draft')]
    assert calls[0][3] == {'id': WORLD_ID}
    request = calls[1][3]['request']
    # replace=false는 보낸 카드만 갱신하는 편집이고 relationships를 보내지 않으면 관계는 저장된 그대로 남는다(Content 계약).
    assert calls[1][3]['id'] == WORLD_ID and request['replace'] is False and 'relationships' not in request and 'relationshipEpisodes' not in request
    assert [c['id'] for c in request['cards']] == [WAR, KAEL]  # 제안이 가리킨 카드만(제안 순서). 지운 카드와 건드리지 않은 카드는 보내지 않는다
    assert (request['expectedDraftRevision'], request['name'], request['description']) == (7, '달빛 세계', '달이 둘인 대륙')
    assert 1 <= len(request['key'].encode()) <= 200


def test_apply_world_applies_several_cells_of_one_card_to_one_payload_without_changing_the_rest(monkeypatch):
    _, calls = edited(monkeypatch, [fix_of(target='body', text='새 IDENTITY'), fix_of(target='goal', text='새 GOAL'),
                                    fix_of(target='episode', episode=0, text='새 00회차')])

    assert [c['id'] for c in calls[1][3]['request']['cards']] == [KAEL]
    docs = sent_card(calls)['semanticMetadata']['characterDocs']
    assert (sent_card(calls)['body'], docs['soul'], docs['goal'], docs['episodes']) == ('새 IDENTITY', '말이 짧다', '새 GOAL', {'0': '새 00회차', '3': '편지를 받았다'})
    assert sent_card(calls)['semanticMetadata']['studio']['item']['text'] == '새 IDENTITY'  # 본문과 함께 고친 글도 화면의 사본이 따라간다


def test_apply_world_makes_a_fresh_request_key_per_call(monkeypatch):
    _, first = edited(monkeypatch, [fix_of()])
    _, second = edited(monkeypatch, [fix_of()])
    assert first[1][3]['request']['key'] != second[1][3]['request']['key']


def test_apply_world_creates_the_character_documents_only_when_the_card_has_none(monkeypatch):
    bare = {**KAEL_CARD, 'semanticMetadata': {'revealFromEpisode': 2}}
    _, calls = edited(monkeypatch, [fix_of(target='goal', text='새 GOAL')], read=world_read(cards=[bare]))
    assert sent_card(calls)['semanticMetadata'] == {'revealFromEpisode': 2, 'characterDocs': {'soul': '', 'goal': '새 GOAL', 'episodes': {}}}


def test_apply_world_refuses_when_the_draft_is_not_the_revision_the_proposal_was_made_from_and_writes_nothing(monkeypatch):
    calls = content(monkeypatch, {'world_studio_read': world_read(revision=8)})

    with pytest.raises(ContentMcpFailure) as error:
        service.apply_world(WORLD_ID, 7, [fix_of()])

    assert error.value.status == 409 and '바뀌어' in str(error.value)
    assert [c[2] for c in calls] == ['world_studio_read']


@pytest.mark.parametrize('fixes', [
    [fix_of(card_id='card-ghost', target='body')],                 # 없는 카드
    [fix_of(card_id='card-gone', target='body')],                  # 삭제된 카드
    [fix_of(card_id=WAR, target='soul')],                          # 인물이 아닌 카드의 인물 문서
    [fix_of(), fix_of(card_id=RULE, target='goal')],               # 뒤 수정안이 어긋나도 앞 수정안만 쓰지 않는다
])
def test_apply_world_refuses_a_fix_that_no_longer_fits_the_read_cards_and_writes_nothing(monkeypatch, fixes):
    calls = content(monkeypatch, {'world_studio_read': world_read()})
    with pytest.raises(ContentMcpFailure) as error:
        service.apply_world(WORLD_ID, 7, fixes)
    assert error.value.status == 409 and [c[2] for c in calls] == ['world_studio_read']


@pytest.mark.parametrize('read', [(False, '{"draftRevision": 7}'), (False, json.dumps({'draftRevision': 7, 'name': 'x', 'cards': 'x'})),
                                  (False, json.dumps({'name': 'x', 'cards': []}))])
def test_apply_world_unreadable_world_is_502_without_writing(monkeypatch, read):
    calls = content(monkeypatch, {'world_studio_read': read})
    with pytest.raises(ContentMcpFailure) as error:
        service.apply_world(WORLD_ID, 7, [fix_of()])
    assert error.value.status == 502 and [c[2] for c in calls] == ['world_studio_read']


@pytest.mark.parametrize('saved', [(False, '{}'), (False, '{"draftRevision": "8"}'), (False, '[]')])
def test_apply_world_unconfirmed_save_response_is_502_not_a_success(monkeypatch, saved):
    content(monkeypatch, {'world_studio_read': world_read(), 'world_studio_edit_draft': saved})
    with pytest.raises(ContentMcpFailure) as error:
        service.apply_world(WORLD_ID, 7, [fix_of()])
    assert error.value.status == 502


def test_apply_world_keeps_contents_status_and_detail_when_the_edit_is_rejected(monkeypatch):
    content(monkeypatch, {'world_studio_read': world_read(), 'world_studio_edit_draft': (True, 'HTTP 409 WORLD_CONFLICT\n초안이 최신이 아니에요.')})
    with pytest.raises(ContentMcpFailure) as error:
        service.apply_world(WORLD_ID, 7, [fix_of()])
    assert (error.value.status, str(error.value)) == (409, '초안이 최신이 아니에요.')


WORLD = {'draftRevision': 4, 'name': '달빛 세계', 'description': '설명', 'cards': [
    {'id': 'k', 'title': '카엘', 'body': '기사', 'cardType': 'character', 'areaCode': 'society', 'visibility': 'public', 'aliases': ['북문지기'],
     'semanticMetadata': {'revealFromEpisode': 2, 'studio': {'item': {'text': '기사'}}}}]}


def edit_calls(monkeypatch, cards):
    calls = content(monkeypatch, {'world_studio_read': (False, json.dumps(WORLD)), 'world_studio_edit_draft': (False, json.dumps({'draftRevision': 5}))})
    assert service.edit_world({'id': 'w', 'request': {'expectedDraftRevision': 4, 'replace': True, 'cards': cards}}) == {'draftRevision': 5}
    return json.loads(json.dumps(calls[1][3]['request']))


def test_edit_world_overlays_the_given_fields_on_the_read_card_and_never_replaces(monkeypatch):
    sent = edit_calls(monkeypatch, [{'id': 'k', 'body': '과묵한 기사', 'semanticMetadata': {'tag': 1}}])
    [card] = sent['cards']
    assert sent['replace'] is False and sent['expectedDraftRevision'] == 4 and (sent['name'], sent['description']) == ('달빛 세계', '설명') and sent['key']
    assert card['body'] == card['semanticMetadata']['studio']['item']['text'] == '과묵한 기사'  # 화면이 읽는 사본도 함께 맞춘다
    assert (card['title'], card['visibility'], card['aliases'], card['semanticMetadata']['revealFromEpisode'], card['semanticMetadata']['tag']) == ('카엘', 'public', ['북문지기'], 2, 1)


def test_edit_world_adds_a_new_card_only_when_it_is_complete_and_refuses_a_malformed_request(monkeypatch):
    new = {'id': 'n', 'title': '새 설정', 'body': '본문', 'cardType': 'object', 'areaCode': 'basic'}
    assert edit_calls(monkeypatch, [new])['cards'] == [{**new, 'semanticMetadata': {}}]
    for bad in ({'id': 'w'}, {'id': 'w', 'request': {'cards': [{'id': 'n', 'title': '제목만'}]}}):
        with pytest.raises(ContentMcpFailure) as error:
            service.edit_world(bad)
        assert error.value.status == 422


def test_edit_world_keeps_a_content_conflict_as_it_is(monkeypatch):
    content(monkeypatch, {'world_studio_read': (False, json.dumps(WORLD)), 'world_studio_edit_draft': (True, 'HTTP 409\n세계관 초안이 바뀌었어요.')})
    with pytest.raises(ContentMcpFailure) as error:
        service.edit_world({'id': 'w', 'request': {'expectedDraftRevision': 3, 'cards': [{'id': 'k', 'body': '새 글'}]}})
    assert (error.value.status, str(error.value)) == (409, '세계관 초안이 바뀌었어요.')


def test_tool_specs_lists_the_content_tools_once_and_returns_only_the_allowed_names(monkeypatch):
    import asyncio
    from mcp.types import Tool  # 실제 SDK 타입(필드 이름이 inputSchema가 아니라 input_schema)이어야 대역이 실서버와 같다
    monkeypatch.setenv('CONTENT_SERVICE_BASE_URL', 'http://content.test/')
    monkeypatch.setattr(service, '_SPECS', {})
    asked = []

    async def listed(url, authorization):
        asked.append((url, authorization))
        return [Tool(name=n, description=f'{n} 설명', inputSchema={'type': 'object'}) for n in ('episode_read', 'episode_update_draft')]

    monkeypatch.setattr(service, '_list', listed)
    service.AUTHORIZATION.set('Bearer user')
    assert asyncio.run(service.tool_specs(('episode_read', 'work_read'))) == [{'name': 'episode_read', 'description': 'episode_read 설명', 'schema': {'type': 'object'}}]
    asyncio.run(service.tool_specs(('episode_read',)))
    assert asked == [('http://content.test/mcp', 'Bearer user')]  # 두 번째는 캐시


def test_edit_world_without_the_read_revision_refuses_instead_of_overwriting(monkeypatch):
    calls = content(monkeypatch, {'world_studio_read': (False, json.dumps(WORLD))})
    with pytest.raises(ContentMcpFailure) as error:
        service.edit_world({'id': 'w', 'request': {'cards': [{'id': 'k', 'body': '새 글'}]}})
    assert error.value.status == 422 and [c[2] for c in calls] == ['world_studio_read']
