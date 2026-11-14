"""인물 시뮬레이션 테스트 공용 대역: 합성 세계관, Content MCP·NovelBrain·모델 대역.

세계관은 `world_studio_read` 응답 모양이고 기준 회차는 3이다. 문서마다 고유 표식(KAEL-SOUL 등)을 넣어
인물 입력에 다른 인물의 문서·미래 기억이 섞였는지 문자열로 확인한다.
"""

import json
from types import SimpleNamespace

from app.simulation import service
from app.simulation.models import Action, CheckItem, SimulationPlan, Verdict

WORLD, KAEL, LINA, GATE, REL, REL2, REL3, REL4, SHADOW, REL5, REL6 = (f'00000000-0000-0000-0000-{n:012d}' for n in range(1, 12))
EPISODE = 3
TARGET = {'workId': 'work', 'episode': EPISODE}


def card(id, title, body, cardType='character', docs=None, lifecycle='active', aliases=(), reveal=None):
    meta = {**({'characterDocs': docs} if docs else {}), **({'revealFromEpisode': reveal} if reveal else {})}
    return {'id': id, 'title': title, 'body': body, 'cardType': cardType, 'areaCode': 'basic', 'classification': '',
            'aliases': list(aliases), 'tags': [], 'semanticMetadata': meta, 'visibility': 'private', 'lifecycle': lifecycle}


def relation(id, source, target, label, body, direction='directed', polarity='asserted', lifecycle='active'):
    return {'id': id, 'sourceCardId': source, 'targetCardId': target, 'category': 'emotional', 'body': body, 'label': label,
            'direction': direction, 'polarity': polarity, 'semanticMetadata': {}, 'lifecycle': lifecycle}


READ = {
    'worldId': WORLD, 'draftRevision': 4, 'name': '달빛 세계', 'description': '', 'relationshipStatus': 'current',
    'cards': [
        card(KAEL, '카엘', 'KAEL-IDENTITY 북문을 지키는 기사', docs={
            'soul': 'KAEL-SOUL 말이 짧고 퉁명스러운 반말', 'memory': 'KAEL-MEMORY 왕가에 맹세했다',
            'episodes': {'2': 'KAEL-EP2 리나를 처음 만났다', '5': 'KAEL-EP5-FUTURE 왕이 죽는다'}}),
        card(LINA, '리나', 'LINA-IDENTITY 떠돌이 약초상', docs={
            'soul': 'LINA-SOUL 존댓말을 쓰는 상냥한 말투', 'memory': 'LINA-MEMORY-SECRET 사실은 왕국의 첩자다',
            'episodes': {'3': 'LINA-EP3 성문을 살폈다'}}),
        card(GATE, '북문', 'GATE-LORE 북쪽 성문', cardType='location', reveal=3),  # 기준 회차(3)에 공개되는 카드
        card(SHADOW, '그림자 길드', 'SHADOW-GUILD 아직 공개되지 않은 조직', cardType='organization', reveal=5),
        card('00000000-0000-0000-0000-0000000000ff', '지워진 인물', 'REMOVED-CARD', lifecycle='removed'),
    ],
    'relationships': [
        relation(REL, KAEL, LINA, '경계', '카엘은 리나를 경계한다'),
        relation(REL2, LINA, GATE, '출입', 'REL-LINA-GATE 리나는 북문을 드나든다'),   # 카엘이 끝점이 아닌 관계
        relation(REL3, KAEL, LINA, '친구', '', direction='symmetric', polarity='denied'),
        relation(REL4, KAEL, LINA, '스승', 'REL-REMOVED', lifecycle='removed'),
        relation(REL5, KAEL, SHADOW, '숙적', 'REL-SHADOW 정체를 아직 모른다'),  # 상대 카드가 기준 회차에 아직 공개되지 않았다
        relation(REL6, KAEL, GATE, '수호', 'REL-KAEL-GATE 카엘은 북문을 지킨다'),
    ],
}
PLAN_IF = SimulationPlan(mode='if', premise='IF-PREMISE 만약 북문이 열려 있었다면?', characterIds=[KAEL, LINA])
PLAN_FLOW = SimulationPlan(mode='flow', characterIds=[KAEL, LINA], beats=[
    'B0-NOW 카엘이 성문에서 리나를 막아선다', 'B1-FUTURE 리나가 정체를 숨기며 통행을 청한다'])


def fake_content(monkeypatch, worlds=None, read=READ):
    """Content MCP 대역. 호출 기록 [(도구, 인자)]를 돌려준다."""
    calls = []
    linked = [{'worldId': WORLD, 'name': '달빛 세계', 'linkedWorkId': 'work'}] if worlds is None else worlds

    def call(tool, arguments):
        calls.append((tool, arguments))
        return {'world_studio_list': linked, 'world_studio_read': read}[tool]

    monkeypatch.setattr(service.content_mcp, 'call', call)
    return calls


def recalled(ref=f'card:{GATE}', source='graph', text='GATE-LORE 북문은 밤에 닫힌다'):
    return SimpleNamespace(ref=ref, source=source, text=text, rank=1, score=0.5)


def fake_novelbrain(monkeypatch, items=None):
    """app.novelbrain.service.recall 대역(world_snapshot은 실제 함수). recall 호출 기록 list를 돌려준다."""
    calls = []

    def recall(world, character_id, episode, query, stage=3, manuscript=(), k=8):
        calls.append({'world': world, 'character_id': character_id, 'episode': episode, 'query': query,
                      'stage': stage, 'manuscript': list(manuscript), 'k': k})
        return SimpleNamespace(items=[recalled()] if items is None else items, gaps=[], stage=stage)

    monkeypatch.setattr(service.novelbrain, 'recall', recall)
    return calls


def action(prose='카엘이 낮게 말했다. "멈춰."', observed='카엘이 북문 앞에서 리나를 막아섰다.', refuses=False, reason=None):
    return Action(prose=prose, observed=observed, refusesBeat=refuses, refusalReason=reason)


def verdict(payload, fail=(), refs=(), detail='판정 설명', beat_done=False, scene_complete=False):
    """payload의 checks 종류마다 판정을 만든다. fail에 든 종류만 위반이고 refs는 위반 근거다."""
    items = [CheckItem(kind=k, passed=k not in fail, detail=detail, refs=list(refs) if k in fail else []) for k in payload['checks']]
    return Verdict(checks=items, beatDone=beat_done, sceneComplete=scene_complete)


def fake_models(monkeypatch, acts, verdicts):
    """act·check 대역. 인자는 (payload) -> 응답 함수, 응답 하나(계속 반복), 응답 목록(차례로, 마지막은 반복) 중 하나다.

    호출한 payload 기록을 SimpleNamespace(act=[…], check=[…])로 돌려준다.
    """
    calls = SimpleNamespace(act=[], check=[])

    def feed(script, log):
        queue = list(script) if isinstance(script, list) else None

        def call(payload):
            log.append(payload)
            if callable(script):
                return script(payload)
            return script if queue is None else (queue.pop(0) if len(queue) > 1 else queue[0])
        return call

    monkeypatch.setattr(service.agent, 'act', feed(acts, calls.act))
    monkeypatch.setattr(service.agent, 'check', feed(verdicts, calls.check))
    return calls


def text(payload) -> str:
    """payload 전체를 한 문자열로. 표식 포함 여부를 확인할 때 쓴다."""
    return json.dumps(payload, ensure_ascii=False)
