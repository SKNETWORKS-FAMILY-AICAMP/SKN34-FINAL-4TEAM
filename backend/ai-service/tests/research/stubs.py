from types import SimpleNamespace

from fake_chat import fake_chat

from app.research.models import PlatformDraft, PlatformPick, Reference

REAL = 'https://example.org/joseon-travel'


def search_call(status='completed', urls=(REAL,)):
    """ChatOpenAI가 AIMessage content에 담는 web_search_call 블록."""
    return {'type': 'web_search_call', 'id': 'ws-1', 'status': status,
            'action': {'type': 'search', 'query': 'q', 'sources': [{'type': 'url', 'url': u} for u in urls]}}


def fake_openai(monkeypatch, output, parsed, status='completed'):
    """ChatOpenAI 대역(create_agent 실행). output은 web_search_call 블록, parsed는 구조화 결과다."""
    return fake_chat(monkeypatch, text=parsed.model_dump_json() if parsed else '', status=status, blocks=output)


# --- platform(#547) ---

def card(card_id, title=None, text='본문'):
    return {'id': card_id, 'title': title or f'카드 {card_id}', 'text': text, 'cardType': 'location', 'aliases': [], 'tags': []}


def public_world(world_id, cards=()):
    """`world_studio_public_read` 응답 모양."""
    return {'id': world_id, 'name': f'세계 {world_id}', 'description': f'{world_id} 설명', 'genre': 'fantasy', 'authorNickname': f'작가 {world_id}',
            'cards': list(cards)}


class FakeMcp:
    """Content MCP 대역: 작가 본인 세계관(own)과 공개 세계관(public, id → 상세)을 돌려준다. 호출 기록은 calls다."""

    def __init__(self, public, own=()):
        self.public, self.own, self.calls = public, list(own), []

    def __call__(self, tool, arguments):
        self.calls.append((tool, arguments))
        if tool == 'world_studio_list':
            return [{'worldId': w, 'name': f'내 {w}'} for w in self.own]
        if tool == 'world_studio_public_list':
            ids, size, page = list(self.public), int(arguments['size']), int(arguments['page'])
            items = [{'id': w, 'name': self.public[w]['name'], 'description': self.public[w]['description'], 'genre': 'fantasy',
                      'authorNickname': self.public[w]['authorNickname'], 'cardCount': len(self.public[w]['cards'])}
                     for w in ids[page * size:(page + 1) * size]]
            return {'items': items, 'page': page, 'size': size, 'total': len(ids)}
        if tool == 'world_studio_public_read':
            return self.public[arguments['id']]
        raise AssertionError(f'platform이 부르면 안 되는 MCP 도구: {tool}')

    def reads(self):
        return [a['id'] for t, a in self.calls if t == 'world_studio_public_read']


def platform_models(monkeypatch, service, pick=(), refs=(), gaps=()):
    """platform의 두 모델 호출 대역. pick은 1회차가 고른 세계관 id, refs는 2회차가 인용한 (worldId, cardId, note)다."""
    seen = SimpleNamespace(pick=[], refer=[])
    monkeypatch.setattr(service.agent, 'pick', lambda request, worlds: seen.pick.append((request, worlds)) or PlatformPick(worldIds=list(pick)))
    monkeypatch.setattr(service.agent, 'refer', lambda request, worlds: seen.refer.append((request, worlds)) or PlatformDraft(
        references=[Reference(worldId=w, cardId=c, note=n) for w, c, n in refs], gaps=list(gaps)))
    return seen
