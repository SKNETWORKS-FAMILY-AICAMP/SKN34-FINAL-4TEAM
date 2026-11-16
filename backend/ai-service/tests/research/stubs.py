from fake_chat import fake_chat

REAL = 'https://example.org/joseon-travel'


def search_call(status='completed', urls=(REAL,)):
    """ChatOpenAI가 AIMessage content에 담는 web_search_call 블록."""
    return {'type': 'web_search_call', 'id': 'ws-1', 'status': status,
            'action': {'type': 'search', 'query': 'q', 'sources': [{'type': 'url', 'url': u} for u in urls]}}


def fake_openai(monkeypatch, output, parsed, status='completed'):
    """ChatOpenAI 대역(create_agent 실행). output은 web_search_call 블록, parsed는 구조화 결과다."""
    return fake_chat(monkeypatch, text=parsed.model_dump_json() if parsed else '', status=status, blocks=output)
