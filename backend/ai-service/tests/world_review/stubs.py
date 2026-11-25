from fake_chat import fake_chat

from app.world_review import service
from app.world_review.models import (Affected, EnrichResult, Finding, Fix, FillLine, FillRequest, FillResult, ImpactResult, WorldReviewRequest,
                                     WorldReviewResult)

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


# work_context_read의 응답(StoryContextResponse)과 story_plan_list의 응답(계획 목록)이다. impact의 ref는 이 값과 위 스냅샷의 id만 인정한다.
CONTEXT = {'title': '달빛 연대기', 'summary': '', 'basisEpisode': 4, 'character': '', 'settings': [], 'draft': '',
           'episodes': [{'number': n, 'version': 1, 'versionId': f'v{n}', 'title': f'{n}화', 'sourceCharacters': 100, 'excerpts': []} for n in (2, 3)],
           'selection': {'omittedCharacters': 0, 'eligibleEpisodes': 2}}
PLANS = [{'id': 'plot-1', 'kind': 'plot', 'title': '남매', 'content': '남매가 다시 만난다.', 'episodeNumber': None, 'parentId': None},
         {'id': 'scene-1', 'kind': 'scene', 'title': '재회', 'content': '서윤이 동생을 만난다.', 'episodeNumber': 5, 'parentId': 'plot-1'}]
META = {'model': 'resolved-model', 'providerResponseId': 'resp-1', 'usage': None}


def card(id, card_type='location', body='본문'):
    return {'id': id, 'cardType': card_type, 'areaCode': 'basic', 'title': id, 'body': body}


def request(**override) -> WorldReviewRequest:
    """인물 서윤·사건 북방 전쟁·규칙 달의 규칙 카드 셋과 서윤 → 북방 전쟁 관계 하나가 있는 요청."""
    return WorldReviewRequest.model_validate({**WORLD, **override})


def fix(card_id='seoyun', target='soul', episode=None, text='바뀐 글'):
    return Fix(cardId=card_id, target=target, episode=episode, text=text)


def affected(kind='card', ref='seoyun', title='서윤', reason='나이 설정이 바뀐다.', certainty='confirmed'):
    return Affected(kind=kind, ref=ref, title=title, reason=reason, certainty=certainty)


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


def fake_enrich(monkeypatch, *fixes, note='서윤의 문서를 보강했어요.'):
    """agent.enrich 대역. 받은 요청 문장과 스냅샷을 담은 dict를 돌려준다."""
    seen = {}

    def enrich(text, data):
        seen.update(request=text, data=data)
        return EnrichResult(fixes=list(fixes), note=note), META

    monkeypatch.setattr(service.agent, 'enrich', enrich)
    return seen


def fake_impact(monkeypatch, *items, conflicts=(), gaps=()):
    """agent.impact 대역. 받은 요청 문장·스냅샷·원고 문맥·계획을 담은 dict를 돌려준다."""
    seen = {}

    def impact(text, data, context, plans):
        seen.update(request=text, data=data, context=context, plans=plans)
        return ImpactResult(affected=list(items), conflicts=list(conflicts), gaps=list(gaps)), META

    monkeypatch.setattr(service.agent, 'impact', impact)
    return seen


# 인물 문서 채우기(fill) 요청: 치삼 카드의 IDENTITY·SOUL이 비어 있고, 이름이 나온 발췌가 2화(첫 등장)와 4화에 있다.
PASSAGES = [{'episode': 2, 'text': '장터의 소금장수 치삼이 다가왔다. 키가 작고 얼굴이 검게 탔다.'},
            {'episode': 4, 'text': '"됐어, 난 안 할 거야." 치삼이 퉁명스럽게 말했다.'}]
FILL = {'cardId': 'chisam', 'title': '치삼', 'aliases': ['치삼이'], 'targets': ['body', 'soul'], 'passages': PASSAGES}


def fill_request(**override) -> FillRequest:
    return FillRequest.model_validate({**FILL, **override})


def fill_line(target='body', kind='description', episode=2, quote='키가 작고 얼굴이 검게 탔다.'):
    return FillLine(target=target, kind=kind, episode=episode, quote=quote)


def fake_fill(monkeypatch, *lines):
    """agent.fill 대역. 받은 요청 DTO를 담은 dict를 돌려준다."""
    seen = {}

    def fill(data):
        seen['data'] = data
        return FillResult(lines=list(lines)), META

    monkeypatch.setattr(service.agent, 'fill', fill)
    return seen


def fake_openai(monkeypatch, parsed=None, status='completed', error=None, text=None):
    """ChatOpenAI 대역(create_agent 실행). 생성자·bind 인자와 받은 메시지를 담은 dict를 돌려준다."""
    return fake_chat(monkeypatch, text=text if text is not None else (parsed.model_dump_json() if parsed else ''), status=status, error=error)
