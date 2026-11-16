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


@pytest.mark.parametrize('body', ['바람이 불었다.', '그는 웃었다. 그는 웃었다.'])
def test_patch_whose_selection_is_gone_or_ambiguous_writes_nothing(monkeypatch, body):
    episode = {**EPISODE, 'draft': {**EPISODE['draft'], 'body': body}}
    calls = content(monkeypatch, {'episode_read': (False, json.dumps(episode))})
    with pytest.raises(ContentMcpFailure) as error:
        service.apply_writing('work', 3, {'before': '그는 웃었다.', 'after': 'x'})
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
