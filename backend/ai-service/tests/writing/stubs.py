from fake_chat import fake_chat


def fake_openai(monkeypatch, text='새 문장', status='completed', error=None):
    """ChatOpenAI 대역(create_agent 실행). 생성자·bind 인자와 받은 메시지를 담은 dict를 돌려준다."""
    return fake_chat(monkeypatch, text=text, status=status, error=error)
