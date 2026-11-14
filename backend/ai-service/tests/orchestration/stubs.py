from datetime import datetime, timezone
from types import SimpleNamespace

from app.intent.models import IntentResult, IntentStep
from app.manuscript.models import AnswerResponse, Claim
from app.orchestration import service
from app.research.models import Finding, ResearchResponse
from app.retrieval.models import RetrievalResult
from app.simulation import agent, director
from app.simulation.models import Action, Check, CheckItem, Decision, Narration, SimulationPlan, SimulationResult, Turn, Verdict
from app.writing.models import DraftResponse, PatchResponse

QA = {'question': '길드 규칙은?', 'excerpts': [{'id': 'a', 'episode': 4, 'quote': '길드는 밤에 문을 닫는다.'}]}
DRAFT = {'draft': {'episodeNumber': 11, 'plan': '선장이 항구에 도착한다.'}}
PATCH = {'patch': {'selection': '그는 웃었다.', 'instruction': '더 차갑게'}}
WEB = {'question': '조선 후기 한양에서 동래까지 며칠?'}
SCOPE = {'scopeToken': 'signed.token'}
COVERAGE = {'expected': [{'number': 4, 'versionId': 'r4'}], 'withVerifiedExcerpt': [{'number': 4, 'versionId': 'r4'}],
            'withoutVerifiedExcerpt': []}
SIM = {'mode': 'if', 'premise': '만약 북문이 열려 있었다면?', 'characterIds': ['k']}
FORM = {'mode': 'flow', 'beats': ['성문 대면', '숨긴 정체'], 'characterIds': ['k']}
RAW_LINE = '카엘이 말했다. “멈춰.”'  # 모델이 낸 그대로(둥근 따옴표)
OPENING, LINE, CLOSING = '성문 위로 밤비가 내렸다.', '카엘이 말했다. "멈춰."', '비가 그쳤다.'  # LINE은 따옴표를 직선 큰따옴표로 통일한 뒤의 글이다
SCENE_TEXT = '\n\n'.join([OPENING, LINE, LINE, CLOSING])  # 시작 나레이션, 카엘 두 번, 마무리 나레이션
WORLD = {'worldId': 'w', 'relationships': [], 'cards': [{
    'id': 'k', 'title': '카엘', 'body': 'KAEL-IDENTITY 북문을 지키는 기사', 'cardType': 'character', 'lifecycle': 'active',
    'semanticMetadata': {'characterDocs': {'soul': 'KAEL-SOUL 말이 짧다', 'memory': '', 'episodes': {}}}}]}


def scene(*prose, status='completed', reason=None):
    """인물 시뮬레이션 결과 대역. prose마다 한 턴이다."""
    turns = [Turn(index=i, characterId='k', characterName='카엘', prose=p, regenerated=0, evidence=[],
                  checks=[Check(kind='knowledge_leak', passed=True, detail='문제 없음')]) for i, p in enumerate(prose)]
    return SimulationResult(mode='if', premise=SIM['premise'], beats=[], turns=turns, status=status, stopReason=reason)


SCENE = scene('카엘이 말했다. "멈춰."', '리나가 웃었다. "알겠어요."')
FOUND = RetrievalResult(status='found', excerpts=QA['excerpts'], gaps=[{'code': 'UNVERIFIED_HIT', 'detail': '제외한 결과가 있어요.'}],
                        coverage=COVERAGE, steps=[{'provider': 'elasticsearch', 'ms': 5, 'hits': 2}])


def plan(*steps, status='route', **extra):
    """Intent Router 결과 대역. steps는 feature 또는 (feature, when)."""
    items = [IntentStep(feature=s, when='always') if isinstance(s, str) else IntentStep(feature=s[0], when=s[1])
             for s in steps]
    return IntentResult(status=status, steps=items, **extra)


def fake_agents(monkeypatch, routed, fail=None, retrieved=FOUND, drafted=None):
    """Router와 구현된 업무 Agent 대역. 호출 기록 list를 돌려준다. fail은 {이름: 던질 예외}.

    시뮬레이션은 계획 모델(sim_plan: drafted 또는 완성된 SIM)만 대역이다. 장면은 실제 장면 에이전트가 쓰므로 `fake_scene`으로 바깥 의존을 대신한다.
    """
    calls, fail = [], fail or {}

    def recorded(name, result):
        def call(*args, **kwargs):
            calls.append((name, args, kwargs))
            if name in fail:
                raise fail[name]
            return result(*args) if callable(result) else result
        return call

    monkeypatch.setattr(service.intent, 'route', recorded('route', routed))
    monkeypatch.setattr(service.retrieval, 'retrieve', recorded('retrieval', retrieved))
    monkeypatch.setattr(service.manuscript, 'answer', recorded('story_context', AnswerResponse(
        claims=[Claim(text='밤에 닫는다', kind='confirmed', sourceIds=['a'])], gaps=[])))
    monkeypatch.setattr(service.writing, 'draft', recorded('draft', DraftResponse(
        text='선장은 항구에 내렸다.', model='m', providerResponseId='r', usage=None)))
    monkeypatch.setattr(service.writing, 'patch', recorded('patch', PatchResponse(
        before='그는 웃었다.', after='그는 차갑게 웃었다.', model='m', providerResponseId='r', usage=None)))
    monkeypatch.setattr(service.simulation, 'plan', recorded(
        'sim_plan', lambda request, history, target: drafted or SimulationPlan(**SIM)))
    monkeypatch.setattr(service.research, 'research', recorded('web_research', ResearchResponse(
        findings=[Finding(text='약 15일', verdict='unverified', sourceUrls=[])], gaps=[],
        searchedAt=datetime(2026, 11, 12, tzinfo=timezone.utc))))
    return calls


def fake_scene(monkeypatch, complete_after=2, fail=None, read=WORLD):
    """장면 에이전트의 바깥 의존(세계관·연출 결정·모델 호출)만 대역으로 둔다. 장면은 실제 에이전트가 쓴다.

    카엘이 complete_after번 말하면 이야기가 끝난다. fail은 'narration'·'speech'(해당 검사를 계속 위반)이다.
    호출 기록을 SimpleNamespace(director·act·narrate·check)로 돌려준다.
    """
    log = SimpleNamespace(director=[], act=[], narrate=[], check=[])
    sim = service.simulation  # app.simulation.service

    def read_world(work_id, episode):
        if isinstance(read, Exception):
            raise read
        return read

    async def decide(state, allowed, cast, last_pov=None):
        log.director.append(list(allowed))
        turn = allowed[0] if len(allowed) == 1 else 'speech'
        return Decision(turn=turn, speaker=cast[0]['id'] if turn == 'speech' else None, pov='omniscient')

    def check(payload):
        log.check.append(payload['checks'])
        kind = 'narration' if payload['self']['id'] is None else 'speech'
        violated = fail == kind
        return Verdict(checks=[CheckItem(kind=k, passed=not violated, detail='판정 설명', refs=[]) for k in payload['checks']],
                       beatDone=False, sceneComplete=len(log.act) >= complete_after)

    monkeypatch.setattr(sim, 'read_world', read_world)
    monkeypatch.setattr(director, 'decide', decide)
    monkeypatch.setattr(agent, 'act', lambda data: log.act.append(data) or Action(prose=RAW_LINE, observed='카엘이 막아섰다.', refusesBeat=False, refusalReason=None))
    monkeypatch.setattr(agent, 'narrate', lambda data: log.narrate.append(data) or Narration(
        prose=CLOSING if data['purpose'] == 'closing' else OPENING, observed='밤비가 내린다.'))
    monkeypatch.setattr(agent, 'check', check)
    return log
