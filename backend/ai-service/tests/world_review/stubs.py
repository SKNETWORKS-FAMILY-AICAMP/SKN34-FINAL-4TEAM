from fake_chat import fake_chat

from app.world_review import service
from app.world_review.models import Finding, Fix, WorldReviewRequest, WorldReviewResult

REL = {'id': 'rel-1', 'sourceCardId': 'seoyun', 'targetCardId': 'war', 'label': '겪음', 'polarity': 'asserted'}
WORLD = {
    'worldName': '달빛 세계', 'worldDescription': '달이 둘인 대륙',
    'cards': [
        {'id': 'seoyun', 'cardType': 'character', 'areaCode': 'society', 'title': '서윤', 'body': '29세. 10년 전 고향을 떠난 약초꾼.',
         'characterDocs': {'soul': '말수가 적다.', 'goal': '동생을 찾는다.', 'episodes': {'0': '고향을 떠났다.', '3': '편지를 받았다.'}}},
        {'id': 'war', 'cardType': 'event', 'areaCode': 'history', 'title': '북방 전쟁', 'body': '10년 전 일어난 전쟁.'},
        {'id': 'rule', 'cardType': 'rule', 'areaCode': 'special', 'title': '달의 규칙', 'body': '달이 둘이다.'},
    ],
    'relationships': [REL],
}


def card(id, card_type='location', body='본문'):
    return {'id': id, 'cardType': card_type, 'areaCode': 'basic', 'title': id, 'body': body}


def request(**override) -> WorldReviewRequest:
    """인물 서윤·사건 북방 전쟁·규칙 달의 규칙 카드 셋과 서윤 → 북방 전쟁 관계 하나가 있는 요청."""
    return WorldReviewRequest.model_validate({**WORLD, **override})


def fix(card_id='seoyun', target='soul', episode=None, text='바뀐 글'):
    return Fix(cardId=card_id, target=target, episode=episode, text=text)


def finding(card_ids=('seoyun',), kind='contradiction', message='서윤의 나이가 카드마다 다르다.', fix=None):
    return Finding(cardIds=list(card_ids), kind=kind, message=message, fix=fix)


def fake_agent(monkeypatch, *findings):
    """agent.review 대역. 받은 요청 DTO를 담은 dict를 돌려준다."""
    seen = {}

    def review(data):
        seen['data'] = data
        return WorldReviewResult(findings=list(findings)), {'model': 'resolved-model', 'providerResponseId': 'resp-1', 'usage': None}

    monkeypatch.setattr(service.agent, 'review', review)
    return seen


def fake_openai(monkeypatch, parsed=None, status='completed', error=None, text=None):
    """ChatOpenAI 대역(create_agent 실행). 생성자·bind 인자와 받은 메시지를 담은 dict를 돌려준다."""
    return fake_chat(monkeypatch, text=text if text is not None else (parsed.model_dump_json() if parsed else ''), status=status, error=error)
