from datetime import datetime, timezone
from types import SimpleNamespace
from typing import Any, NamedTuple

from langchain_core.language_models.chat_models import BaseChatModel
from langchain_core.messages import AIMessage, HumanMessage
from langchain_core.outputs import ChatGeneration, ChatResult

from app.intent import service as intent
from app.intent.models import DecisionResult
from app.story_qa.models import AnswerResponse, Claim
from app.orchestration import agent as main_agent, tools as service
from app.rating.models import EpisodeRating, RatingResponse
from app.research.models import Finding, ResearchResponse
from app.retrieval.models import RetrievalResult
from app.review.models import Finding as ReviewFinding, ReviewResponse
from app.simulation import agent, director
from app.simulation.models import Action, Check, CheckItem, Decision, Narration, SimulationPlan, SimulationResult, Turn, Verdict
from app.world_review.models import Finding as WorldFinding, Fix, WorldReviewRequest, WorldReviewResponse
from app.writing.models import BeatPlan, DraftResponse, PatchResponse, PlanResponse

QA = {'question': '길드 규칙은?', 'excerpts': [{'id': 'a', 'episode': 4, 'quote': '길드는 밤에 문을 닫는다.'}]}
DRAFT = {'draft': {'episodeNumber': 11, 'plan': '선장이 항구에 도착한다.'}}
PATCH = {'patch': {'selection': '그는 웃었다.', 'instruction': '더 차갑게'}}
WEB = {'question': '조선 후기 한양에서 동래까지 며칠?'}
REVIEW = {'check': 'mechanical'}
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
    'semanticMetadata': {'characterDocs': {'soul': 'KAEL-SOUL 말이 짧다', 'goal': '', 'episodes': {}}}}]}


WORLD_REVIEW = WorldReviewResponse(
    findings=[WorldFinding(cardIds=['k'], kind='doc_role', message='SOUL에 목표가 섞여 있어요.',
                           fix=Fix(cardId='k', target='soul', episode=None, text='말이 짧다.'))], reviewedCards=1, model='m')
WORLD_REVIEW_REQUEST = WorldReviewRequest(worldName='달빛 세계', worldDescription='', cards=[], relationships=[])


def scene(*prose, status='completed', reason=None):
    """인물 시뮬레이션 결과 대역. prose마다 한 턴이다."""
    turns = [Turn(index=i, characterId='k', characterName='카엘', prose=p, regenerated=0, evidence=[],
                  checks=[Check(kind='knowledge_leak', passed=True, detail='문제 없음')]) for i, p in enumerate(prose)]
    return SimulationResult(mode='if', premise=SIM['premise'], beats=[], turns=turns, status=status, stopReason=reason)


SCENE = scene('카엘이 말했다. "멈춰."', '리나가 웃었다. "알겠어요."')
FOUND = RetrievalResult(status='found', excerpts=QA['excerpts'], gaps=[{'code': 'UNVERIFIED_HIT', 'detail': '제외한 결과가 있어요.'}],
                        coverage=COVERAGE, steps=[{'provider': 'elasticsearch', 'ms': 5, 'hits': 2}])


BEAT = BeatPlan(title='항구의 밤', beats=['선장이 항구에 도착한다.', '카이가 배를 숨긴다.'])
CONTEXT = {'title': '작품', 'settings': [{'title': '항구', 'body': '밤에 닫힌다'}], 'draft': ''}


class Step(NamedTuple):
    """메인 에이전트 대역이 부를 서브 에이전트 하나. check·task·fix는 그 도구의 열거형 인자다."""
    feature: str
    when: str = 'always'
    check: str | None = None
    task: str | None = None
    fix: int | None = None


class Planned(NamedTuple):
    decision: DecisionResult
    calls: list[tuple[str, dict]]




def call(step: Step) -> tuple[str, dict]:
    """기능 단계를 메인 에이전트의 도구 호출로 바꾼다. 조건부 수정은 task=patch, 작업 종류가 없는 집필은 draft다."""
    if step.feature == 'writing_editing':
        task = 'patch' if step.when == 'if_issues_found' else step.task or 'draft'
        return 'ask_writing', {'task': task, **({'fix': step.fix} if step.fix is not None else {})}
    return service.TOOL_NAMES.get(step.feature, f'ask_{step.feature}'), {'check': step.check} if step.check else {}


def _step(s) -> Step:
    return s if isinstance(s, Step) else Step(s) if isinstance(s, str) else Step(*s)


def plan(*steps, status='route', reason=None, capabilities=None):
    """Decision Guard 판정과 메인 에이전트가 순서대로 부를 도구. steps는 feature, (feature, when), Step 또는
    한 모델 턴에 함께 부르는 묶음 list(#474)다.

    status=rejected면 거절(reason), clarify면 고른 기능 없음이다. capabilities로 판정 기능을 따로 정하면 steps는 호출 순서만 뜻한다.
    """
    turns = [[_step(x) for x in s] if isinstance(s, list) else _step(s) for s in steps]
    items = [i for t in turns for i in (t if isinstance(t, list) else [t])]
    if status == 'rejected':
        return Planned(DecisionResult(allowed=False, reason=reason), [])
    features = capabilities if capabilities is not None else [] if status == 'clarify' else list(dict.fromkeys(i.feature for i in items))
    return Planned(DecisionResult(allowed=True, capabilities=features), [[call(i) for i in t] if isinstance(t, list) else call(t) for t in turns])


class FakeMain(BaseChatModel):
    """메인 에이전트 모델 대역. 이번 턴 도구를 부른 모델 응답 수만큼 대본을 진행해 다음 도구(list면 한 응답의 병렬 묶음)를 부르고,
    대본이 끝나면 answer로 종합한다.

    resume으로 다시 불려도 같은 메시지면 같은 답을 낸다. 호출마다 노출된 도구 이름과 받은 메시지를 seen에 남긴다.
    """
    script: list
    answer: Any  # 종합 답변 또는 올릴 예외
    seen: Any  # pydantic이 list를 복사하지 않게 Any로 둔다
    model_name: str = 'test-main'

    @property
    def _llm_type(self) -> str:
        return 'fake-main'

    def bind_tools(self, tools, **kwargs):
        return self.bind(tools=[t.name for t in tools], settings=kwargs)

    def _generate(self, messages, stop=None, run_manager=None, tools=None, settings=None, **kwargs) -> ChatResult:
        self.seen.append({'tools': tools or [], 'settings': settings or kwargs, 'messages': messages})
        last = max(i for i, m in enumerate(messages) if isinstance(m, HumanMessage))
        done = sum(isinstance(m, AIMessage) and bool(m.tool_calls) for m in messages[last:])
        meta = {'status': 'completed', 'model_name': 'resolved-main', 'id': f'resp-{len(self.seen)}'}
        usage = {'input_tokens': 20, 'output_tokens': 5, 'total_tokens': 25}
        if done < len(self.script) and tools:
            batch = self.script[done] if isinstance(self.script[done], list) else [self.script[done]]
            calls = [{'name': name, 'args': args if name == 'ask_web_research' else {'request': messages[last].text, **args},
                      'id': f'call-{done}-{i}'} for i, (name, args) in enumerate(batch)]
            message = AIMessage(content='', tool_calls=calls, response_metadata=meta, usage_metadata=usage)
        elif isinstance(self.answer, Exception):
            raise self.answer
        else:
            message = AIMessage(content=self.answer, response_metadata=meta, usage_metadata=usage)
        return ChatResult(generations=[ChatGeneration(message=message)])


def fake_main(monkeypatch, *calls, answer='종합 답변'):
    """메인 에이전트의 ChatOpenAI를 대역으로 바꾼다. calls는 (도구 이름, 인자) 순서다. 모델 호출 기록(Seen)을 돌려준다."""
    seen = Seen()
    monkeypatch.setenv('OPENAI_API_KEY', 'test-key')
    monkeypatch.setenv('OPENAI_MODEL', 'test-model')

    def chat(**kwargs):
        seen.init = kwargs
        return FakeMain(script=list(calls), answer=answer, seen=seen)

    monkeypatch.setattr(main_agent, 'ChatOpenAI', chat)
    return seen


class Seen(list):
    """메인 에이전트 모델 호출마다의 {tools, settings, messages}. init은 ChatOpenAI 생성자 인자다(모델을 만들면 채운다)."""


def fake_agents(monkeypatch, routed, fail=None, retrieved=FOUND, drafted=None):
    """Decision Guard·메인 에이전트 모델과 구현된 업무 Agent 대역. 호출 기록 list를 돌려준다. fail은 {이름: 던질 예외}.

    routed는 plan(...)이다. 메인 에이전트 모델 호출 기록은 calls.main(도구 이름·메시지)에 있다.

    시뮬레이션은 계획 모델(sim_plan: drafted 또는 완성된 SIM)만 대역이다. 장면은 실제 장면 에이전트가 쓰므로 `fake_scene`으로 바깥 의존을 대신한다.
    """
    calls, fail = Calls(), fail or {}

    def recorded(name, result):
        def call(*args, **kwargs):
            calls.append((name, args, kwargs))
            if name in fail:
                raise fail[name]
            return result(*args) if callable(result) else result
        return call

    monkeypatch.setattr(intent, 'judge', recorded('judge', routed.decision))
    seen = fake_main(monkeypatch, *routed.calls)
    monkeypatch.setattr(service.retrieval, 'retrieve', recorded('retrieval', retrieved))
    monkeypatch.setattr(service.story_qa, 'answer', recorded('story_context', AnswerResponse(
        claims=[Claim(text='밤에 닫는다', kind='confirmed', sourceIds=['a'])], gaps=[])))
    monkeypatch.setattr(service.writing, 'draft', recorded('draft', DraftResponse(
        text='선장은 항구에 내렸다.', model='m', providerResponseId='r', usage=None)))
    monkeypatch.setattr(service.writing, 'plan', recorded('writing_plan', PlanResponse(
        plans=[BEAT], notes=['10화의 약속은 확정 사건'], model='m', providerResponseId='r', usage=None)))
    monkeypatch.setattr(service.writing, 'plan_and_draft', recorded('plan_and_draft', DraftResponse(
        text='선장은 항구에 내렸다.', model='m', providerResponseId='r', usage=None, plan=BEAT)))
    monkeypatch.setattr(service.content_mcp, 'call', recorded('mcp', lambda tool, args: CONTEXT))
    monkeypatch.setattr(service.writing, 'patch', recorded('patch', PatchResponse(
        before='그는 웃었다.', after='그는 차갑게 웃었다.', model='m', providerResponseId='r', usage=None)))
    monkeypatch.setattr(service.simulation, 'plan', recorded(
        'sim_plan', lambda request, history, target: drafted or SimulationPlan(**SIM)))
    monkeypatch.setattr(service.research, 'research', recorded('web_research', ResearchResponse(
        findings=[Finding(text='약 15일', verdict='unverified', sourceUrls=[])], gaps=[],
        searchedAt=datetime(2026, 11, 12, tzinfo=timezone.utc))))
    monkeypatch.setattr(service.review, 'review', recorded('review', lambda data: ReviewResponse(
        workId=data.workId, episode=data.episode, revision=4, check=data.check, gaps=[], model='m', providerResponseId='r', usage=None,
        findings=[ReviewFinding(category='spelling', quote='웃엇다', reason='맞춤법', status='confirmed', evidenceRefs=[],
                                suggestion='웃었다', start=3, end=6)])))
    monkeypatch.setattr(service.rating, 'rate', recorded('rating', lambda data: RatingResponse(
        workId=data.workId, verdict='general', prohibited=False,
        episodes=[EpisodeRating(episode=n, revision=4, verdict='general', signals={'profanityCount': 0}) for n in data.episodes])))
    monkeypatch.setattr(service.world_review, 'linked_request', recorded('world_review_read', lambda work_id: WORLD_REVIEW_REQUEST))
    monkeypatch.setattr(service.world_review, 'review', recorded('world_review', WORLD_REVIEW))
    calls.main = seen
    return calls


class Calls(list):
    """업무 Agent 호출 기록. main은 fake_agents가 채우는 메인 에이전트 모델 호출 기록(Seen)이다."""


def fake_scene(monkeypatch, complete_after=2, fail=None, read=WORLD):
    """장면 에이전트의 바깥 의존(세계관·연출 결정·모델 호출)만 대역으로 둔다. 장면은 실제 에이전트가 쓴다.

    카엘이 complete_after번 말하면 이야기가 끝난다. fail은 'narration'·'speech'(해당 검사를 계속 위반)이다.
    호출 기록을 SimpleNamespace(director·act·narrate·check)로 돌려준다.
    """
    log = SimpleNamespace(director=[], act=[], narrate=[], check=[], read=[])
    sim = service.simulation  # app.simulation.service

    def read_world(work_id, episode):
        log.read.append((work_id, episode))
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
