import json

from fake_chat import fake_chat


def data(**overrides) -> dict:
    return {'schemaVersion': 'work-tags.v1', 'title': '메밀꽃 필 무렵', 'description': '장돌뱅이 허생원의 하룻밤 이야기',
            'episodes': [{'number': 1, 'title': '봉평장', 'text': '여름 장이란 애시당초에 글러서 해는 아직 중천에 있건만'}],
            'allowedGenres': ['현대', '드라마', '고전'], 'maxGenres': 2, 'maxHashtags': 3} | overrides


def output(**overrides) -> dict:
    return {'schemaVersion': 'work-tags.v1', 'genres': ['고전', '드라마'], 'hashtags': ['장돌뱅이', '메밀꽃', '여름밤']} | overrides


def fake_openai(monkeypatch, proposed=None, **kwargs):
    """ChatOpenAI 대역(create_agent 실행). proposed는 모델이 돌려줄 구조화 결과(dict)다."""
    return fake_chat(monkeypatch, text=json.dumps(proposed, ensure_ascii=False) if proposed is not None else '', **kwargs)
