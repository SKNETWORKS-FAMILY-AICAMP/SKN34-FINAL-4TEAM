"""자율 연재 테스트 대역: 모델 호출마다 정해진 답을 차례로 돌려주는 ChatOpenAI 대역과 요청 자료."""

import json
from types import SimpleNamespace
from typing import Any

from langchain_core.callbacks import adispatch_custom_event, dispatch_custom_event
from langchain_core.messages import AIMessage
from langchain_core.outputs import ChatGeneration, ChatResult

from app import agent_runtime
from app.agent_runtime import MODEL_EVENT
from app.simulation import agent as simulation_agent, director, service as simulation_engine
from app.simulation.models import Action, CheckItem, Decision, Narration, PlanDraft, Verdict

from fake_chat import FakeChat

# Content의 serialContext 모양: 작품 제목·소개, 최근 회차 원문(episodes), 그 이전 회차 요약(summaries), 설정 카드, 회차 실행만 관련 장면 인용(related)
CONTEXT = json.dumps({'title': '작품', 'summary': '', 'episodes': [{'number': 4, 'title': '4화', 'body': '서윤이 문을 열었다.'}],
                      'summaries': [{'number': 1, 'title': '1화', 'summary': '서윤이 편지를 발견한다.'}], 'cards': [],
                      'related': [{'episode': 1, 'quote': '편지는 서랍 맨 아래에 있었다.'}]}, ensure_ascii=False)
CHOICE = {'text': '서윤이 모든 진실을 털어놓는다', 'votes': 3}
KAEL, LINA, REL = ('00000000-0000-0000-0000-00000000000' + n for n in '123')


def _character(id, title, body, soul):
    return {'id': id, 'title': title, 'body': body, 'cardType': 'character', 'areaCode': 'basic', 'classification': '', 'aliases': [], 'tags': [],
            'semanticMetadata': {'characterDocs': {'soul': soul, 'goal': '', 'episodes': {}}}, 'visibility': 'private', 'lifecycle': 'active'}


# Content가 요청에 실어 보내는 세계관: MCP world_studio_read 응답 모양 + 「동일 인물」 관계(identity)
WORLD = {'worldId': '00000000-0000-0000-0000-0000000000aa', 'draftRevision': 1, 'name': '달빛 세계', 'description': '', 'relationshipStatus': 'current',
         'cards': [_character(KAEL, '카엘', '북문을 지키는 기사', '말이 짧은 반말'), _character(LINA, '리나', '떠돌이 약초상', '존댓말을 쓰는 상냥한 말투')],
         'relationships': [{'id': REL, 'sourceCardId': KAEL, 'targetCardId': LINA, 'category': 'emotional', 'body': '카엘은 리나를 경계한다', 'label': '경계',
                            'direction': 'directed', 'polarity': 'asserted', 'semanticMetadata': {}, 'lifecycle': 'active'}],
         'identity': []}
# staged_engine이 쓰는 장면(회차 집필의 뼈대): 나레이션 1 → 카엘 → 리나 → 나레이션 2
SCENE = '\n\n'.join(['나레이션 1', '카엘의 대사 1', '리나의 대사 2', '나레이션 2'])


def story(opening: str, length: int = 6000) -> str:
    """정확히 length자인 원고(기본은 최소 분량 4,000자를 넘는 길이, 경계를 재려고 공백 없이 채운다)."""
    return opening + '가' * (length - len(opening))


# (모델이 돌려줄 본문 또는 JSON 값, 입력 토큰, 출력 토큰)
CHOICES = ({'choices': ['서윤이 모든 진실을 털어놓는다', '카이가 편지를 태워 버린다', '두 사람이 함께 마을을 떠난다', '편지를 쓴 낯선 사람이 찾아온다']}, 200, 100)
SUMMARY = ({'summary': '투표에서 서윤의 고백이 1위였고, 추천이 많은 제안은 새벽의 대화를 원했다.'}, 100, 50)
PLAN = ({'plans': [{'title': '진실의 밤', 'beats': ['서윤이 망설인다', '진실을 털어놓는다']}], 'notes': []}, 300, 100)
DRAFT = (story('서윤은 오랫동안 숨겨 온 이야기를 꺼냈다.'), 400, 200)
REWRITE = (story('서윤은 처음부터 모든 것을 차분히 털어놓았다.'), 400, 200)
SHORT = ('서윤이 이야기를 꺼냈다.', 400, 200)
PASS = ({'passed': True, 'issues': []}, 500, 20)
FAIL = ({'passed': False, 'issues': ['1화의 설정과 어긋난다: 서윤의 나이']}, 500, 30)
EPISODE_SUMMARY = ({'summary': '서윤이 편지를 발견하고 카이를 의심한다. 카이는 편지를 숨긴 사실을 부인한다.'}, 120, 60)


def choices_request(**overrides) -> dict:
    return {'workId': 'work-1', 'episodeNumber': 2, 'direction': '서윤의 성장 이야기', 'context': CONTEXT, 'creditLimit': 5} | overrides


def summaries_request(**overrides) -> dict:
    return {'workId': 'work-1', 'episodeNumber': 3, 'title': '3화', 'body': '서윤이 편지를 발견했다.', 'creditLimit': 3} | overrides


def simulation(**overrides) -> dict:
    return {'workId': 'work-1', 'episodeNumber': 2, 'premise': '서윤이 비밀을 털어놓는다', 'beats': ['망설임', '고백'], 'context': CONTEXT,
            'creditLimit': 5} | overrides


def episode(**overrides) -> dict:
    return {'workId': 'work-1', 'episodeNumber': 2, 'direction': '서윤의 성장 이야기', 'context': CONTEXT, 'creditLimit': 50, 'choice': CHOICE, 'world': WORLD,
            'proposals': [{'title': '고백 장면', 'body': '서윤이 편지를 보여 주면 좋겠어요', 'likes': 2, 'scene': None},
                          {'title': '새벽의 대화', 'body': '둘이 새벽에 이야기해요', 'likes': 1, 'scene': '서윤이 입을 열었다.'}]} | overrides


class Scripted(FakeChat):
    """호출(_generate)마다 queue의 다음 답을 돌려준다. 모델에 닿지 못한 호출(상한에서 막힌 호출)은 답도 기록도 소비하지 않는다."""
    queue: Any
    calls: Any

    def _generate(self, messages, stop=None, run_manager=None, **kwargs) -> ChatResult:
        self.seen['messages'] = messages
        self.calls.append(self.seen)
        body, tokens_in, tokens_out = self.queue.pop(0)
        reply = AIMessage(content=[{'type': 'text', 'text': body if isinstance(body, str) else json.dumps(body, ensure_ascii=False)}],
                          response_metadata={'status': 'completed', 'model_name': 'resolved-model', 'id': 'resp-1'},
                          usage_metadata={'input_tokens': tokens_in, 'output_tokens': tokens_out, 'total_tokens': tokens_in + tokens_out})
        return ChatResult(generations=[ChatGeneration(message=reply)])


def answers(monkeypatch, *replies) -> list[dict]:
    """모델 호출마다 replies를 차례로 답하는 ChatOpenAI 대역. 실제로 모델에 닿은 호출의 기록(init 인자·보낸 messages 등)을 모은 목록을 돌려준다."""
    monkeypatch.setenv('OPENAI_API_KEY', 'test-key')
    monkeypatch.setenv('OPENAI_MODEL', 'test-model')
    queue, calls = list(replies), []
    monkeypatch.setattr(agent_runtime, 'ChatOpenAI',
                        lambda **kwargs: Scripted(seen={'init': kwargs}, reply=None, model_name=kwargs['model'], queue=queue, calls=calls))
    return calls


def sent(call: dict) -> tuple[str, dict]:
    """한 모델 호출이 받은 (지시문, 자료 JSON)."""
    system, human = call['messages']
    return system.content, json.loads(human.content)


def staged_engine(monkeypatch, *, speeches=2, tokens=(1000, 100), fail_checks=False, plan=None, order=None) -> SimpleNamespace:
    """인물 시뮬레이션 엔진의 모델 호출 대역(계획·연출·인물 턴·나레이션·검사)과 NovelBrain 대역. 호출마다 엔진처럼 MODEL_EVENT로 사용량을 알린다.

    세계관은 요청 것만 쓴다(Content MCP·원고 검색을 부르면 실패). 인물이 speeches번 말하면 장면이 끝난다(SCENE). order 목록을 주면 호출 이름을 'sim.<이름>'으로 쌓는다.
    """
    engine = SimpleNamespace(plan=[], act=[], recalled=[], director=0, narrate=0, check=0, events=0)

    def mark(name):
        engine.events += 1
        if order is not None:
            order.append(f'sim.{name}')

    def usage(name):
        return {'name': name, 'ms': 1, 'failed': False, 'inputTokens': tokens[0], 'outputTokens': tokens[1]}

    def report(name):  # 엔진이 알리는 방식: LangChain 실행 밖이면 알릴 곳이 없어 건너뛴다
        try:
            dispatch_custom_event(MODEL_EVENT, usage(name))
        except RuntimeError:
            pass

    def fake_plan(request, history, characters):
        engine.plan.append({'request': request, 'characters': characters})
        mark('plan')
        report('plan')
        return plan or PlanDraft(mode='if', premise='만약 카엘이 진실을 알았다면?', beats=[], characterIds=[KAEL, LINA])

    async def decide(state, allowed, cast, last_pov=None):
        engine.director += 1
        mark('director')
        try:
            await adispatch_custom_event(MODEL_EVENT, usage('director'))
        except RuntimeError:
            pass
        if list(allowed) == ['end']:
            return Decision(turn='end', pov='omniscient')
        if 'speech' in allowed:
            return Decision(turn='speech', speaker=cast[len(engine.act) % len(cast)]['id'], pov='omniscient')
        return Decision(turn='narration', pov='omniscient')

    def act(data):
        engine.act.append(data)
        mark('act')
        report('act')
        name = data['self']['name']
        return Action(prose=f'{name}의 대사 {len(engine.act)}', observed=f'{name}이(가) 말했다.', refusesBeat=False, refusalReason=None)

    def narrate(data):
        engine.narrate += 1
        mark('narrate')
        report('narrate')
        return Narration(prose=f'나레이션 {engine.narrate}', observed='무슨 일이 있었다.')

    def check(payload):
        engine.check += 1
        mark('check')
        report('check')
        items = [CheckItem(kind=kind, passed=not fail_checks, detail='판정 설명', refs=[]) for kind in payload['checks']]
        return Verdict(checks=items, beatDone=False, sceneComplete=len(engine.act) >= speeches)

    def forbidden(*args, **kwargs):
        raise AssertionError('자율 연재는 Content MCP로 세계관을 읽지 않는다(요청의 world를 쓴다)')

    monkeypatch.setattr(simulation_engine.content_mcp, 'call', forbidden)
    monkeypatch.setattr(simulation_engine, 'read_world', forbidden)
    def recall(world, character_id, episode, query, stage=3, manuscript=(), k=8):
        engine.recalled.append((character_id, episode))
        return SimpleNamespace(items=[], gaps=[], stage=stage)

    monkeypatch.setattr(simulation_engine.novelbrain, 'recall', recall)
    monkeypatch.setattr(simulation_agent, 'plan', fake_plan)
    monkeypatch.setattr(simulation_agent, 'act', act)
    monkeypatch.setattr(simulation_agent, 'narrate', narrate)
    monkeypatch.setattr(simulation_agent, 'check', check)
    monkeypatch.setattr(director, 'decide', decide)
    return engine
