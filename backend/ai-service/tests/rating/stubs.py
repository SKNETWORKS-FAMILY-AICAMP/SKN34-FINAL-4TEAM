from typing import get_args

from fake_chat import fake_chat

from app.rating import service
from app.rating.models import Assessment, Criterion, RatingResult

WORK = 'work-1'
QUOTE = '그는 칼로 손가락을 하나씩 잘랐다.'
WORLD = {
    'worldId': 'world-1',
    'cards': [
        {'id': 'hana', 'cardType': 'character', 'title': '하나', 'body': '17세 고등학생.'},
        {'id': 'late', 'cardType': 'character', 'title': '늦은 인물', 'body': '40세.', 'semanticMetadata': {'revealFromEpisode': 2}},
        {'id': 'town', 'cardType': 'location', 'title': '항구 마을', 'body': '안개가 잦다.'},
    ],
    'relationships': [],
}


def result(level=0, quote=QUOTE, criterion='violence', prohibited=False):
    """모든 판별 항목을 평가한 응답. criterion 하나만 level이고 나머지는 0이다."""
    return RatingResult(prohibited=prohibited, assessments=[
        Assessment(criterion=c, level=level if c == criterion else 0,
                   quotes=[quote] if c == criterion and level else [], rationale='근거')
        for c in get_args(Criterion)])


def adult(**kwargs):
    return result(3, **kwargs)


def general():
    return result(0)


def fake_content(monkeypatch, bodies=None, world=WORLD, linked=WORK):
    """Content MCP 대역. bodies는 회차 번호 → 초안 본문이며 호출한 도구·인자 목록을 돌려준다."""
    bodies = bodies or {1: '비가 왔다.', 2: '비명이 울렸다. 그는 칼로 손가락을 하나씩 잘랐다.'}
    calls = []

    def call(tool, arguments):
        calls.append((tool, arguments))
        if tool == 'episode_read':
            number = arguments['number']
            return {'draft': {'title': f'{number}화', 'body': bodies[number], 'revision': 7, 'authorNote': f'{number}화 메모'}}
        if tool == 'world_studio_list':
            return [{'worldId': 'world-1', 'linkedWorkId': linked}]
        if tool == 'world_studio_read':
            return world
        raise AssertionError(tool)

    monkeypatch.setattr(service.content_mcp, 'call', call)
    return calls


def fake_agent(monkeypatch, *results):
    """agent.rate 대역. 회차는 병렬로 판별되므로 제목(N화)의 N번째 결과를 돌려준다(예외면 던짐). 받은 회차 자료 목록을 돌려준다."""
    seen = []

    def rate(episode):
        seen.append(episode)
        index = int(episode['title'].removesuffix('화')) - 1
        if isinstance(results[index], Exception):
            raise results[index]
        return results[index], {'model': 'resolved-model', 'providerResponseId': f'resp-{index + 1}', 'usage': None}

    monkeypatch.setattr(service.agent, 'rate', rate)
    return seen


def fake_openai(monkeypatch, parsed=None, status='completed', error=None, text=None):
    """ChatOpenAI 대역(create_agent 실행). 생성자·bind 인자와 받은 메시지를 담은 dict를 돌려준다."""
    return fake_chat(monkeypatch, text=text if text is not None else (parsed.model_dump_json() if parsed else ''), status=status, error=error)
