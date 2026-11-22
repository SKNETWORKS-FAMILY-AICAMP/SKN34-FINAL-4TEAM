"""후보 입력 구성(평가 전용): 서비스가 만든 입력(asked·extra)에서 무엇을 넣고 빼는지만 바꿔 같은 문항으로 기준선(A)과 짝 비교한다. 서비스 코드는 그대로다.

V1 말투 예시: 기준 회차 이전 원문에서 그 인물이 한 대사(꼬리표에 이름이 먼저 나오는 줄) 5~8줄을 known에, ③ 나레이션은 앞 회차 지문 몇 문단을 문체 예시(style)에 넣는다. 지금 장면과 겹침이 큰 줄이 먼저다.
V2 금지 목록 장면 관련분만(#646): 검사 입력의 forbidden에서 검사할 문단·직전 줄과 겹침이 큰 항목 상위 N개만 남긴다.
V3 관계 장면 관련분만(#646): known의 관계 줄에서 장면 인물과 이어진 관계(같은 쌍)·직전 줄과 겹침이 큰 관계 상위 N개만 남긴다. V4 = V2 + V3. V5 = V3의 상한을 48로(①만).
후크는 act 계열(①·④) (asked, extra, item, corpus) → (asked, extra), narrate 계열(③) (data, extra, item, corpus) → (data, extra)다.
"""

from orig_common import SEED  # noqa: F401,I001  경로 설정이 import보다 먼저여야 한다

import orig_turns
from orig_corpus import _bigrams

VOICE_LINES, VOICE_MIN, VOICE_LEN = 8, 3, (8, 200)   # 말투 예시 줄 수·최소 줄 수·한 줄의 글자 수
STYLE_PARAGRAPHS, STYLE_LEN = 4, (40, 400)
RELATIONS, FORBIDDEN = 24, 20   # 장면 관련분만 남길 때의 상한


def _episodes(corpus) -> list:
    """(회차, 규칙으로 자른 턴) 목록. 말투 예시 후보를 찾느라 한 번만 자른다."""
    if getattr(corpus, '_turn_cache', None) is None:
        corpus._turn_cache = [(ep, orig_turns.split_turns(ep['text'])) for ep in corpus.episodes()]
    return corpus._turn_cache


def _scene(item: dict) -> str:
    return ' '.join(line['text'] for line in item['context'])


def _speaks(tag: str, mine: set[str], rest: list[str]) -> bool:
    """꼬리표에서 가장 먼저 나오는 장면 인물 이름이 그 인물이면 그 인물의 대사로 본다(규칙, 모델 판별 없음)."""
    where = {n: tag.find(n) for n in {*mine, *rest} if n and tag.find(n) >= 0}
    return bool(where) and min(where, key=where.get) in mine


def voice_lines(corpus, item: dict, k: int = VOICE_LINES) -> list[str]:
    """기준 회차 이전 원문에서 그 인물이 한 대사 k줄(지금 장면과 겹침이 큰 순으로 고른 뒤 회차 순서로)."""
    me = next((p for p in corpus.people(item['work']) if p['id'] == item['speaker_id']), None)
    if me is None:
        return []
    mine = {me['title'], *(a for a in me.get('aliases', []) if len(a) >= 2)}
    rest, scene, found = [n for n in item['cast'] if n != item['speaker']], _bigrams(_scene(item)), []
    for ep, turns in _episodes(corpus):
        if ep['work'] != item['work'] or ep['n'] > item['base']:
            continue
        for t in turns:
            size = len(t['text'])
            if t['kind'] == 'dialogue' and t['tag'] and VOICE_LEN[0] <= size <= VOICE_LEN[1] and _speaks(t['tag'], mine, rest):
                found.append((len(_bigrams(t['text']) & scene), ep['n'], t['i'], t['text']))
    best = sorted(found, reverse=True)[:k]
    return [text for _, _, _, text in sorted(best, key=lambda f: (f[1], f[2]))]


def style_paragraphs(corpus, item: dict, k: int = STYLE_PARAGRAPHS) -> list[str]:
    """기준 회차 이전 같은 작품의 지문(문단 전체) k개: 지금 장면과 겹침이 큰 순으로 고른 뒤 회차 순서로."""
    scene, found = _bigrams(_scene(item)), []
    for ep, turns in _episodes(corpus):
        if ep['work'] == item['work'] and ep['n'] <= item['base']:
            found += [(len(_bigrams(t['text']) & scene), ep['n'], t['i'], t['text']) for t in turns
                      if t['kind'] == 'narration' and t.get('whole') and STYLE_LEN[0] <= len(t['text']) <= STYLE_LEN[1]]
    return [text for _, _, _, text in sorted(sorted(found, reverse=True)[:k], key=lambda f: (f[1], f[2]))]


def _voice_doc(lines: list[str]) -> dict:
    return {'ref': 'manuscript:voice', 'label': '말투 예시(앞 회차 원문에서 이 인물이 한 대사)', 'text': '\n'.join(lines)}


def v1_act(asked: dict, extra: dict, item: dict, corpus, k: int = VOICE_LINES) -> tuple[dict, dict]:
    """① 입력의 known 끝에 말투 예시를 더한다(예시가 VOICE_MIN줄 미만이면 그대로)."""
    lines = voice_lines(corpus, item, k)
    return ({**asked, 'known': [*asked['known'], _voice_doc(lines)]} if len(lines) >= VOICE_MIN else asked), extra


def v1_narrate(data: dict, extra: dict, item: dict, corpus) -> tuple[dict, dict]:
    """③ 독백은 그 인물의 말투 예시를 known에, 나레이션은 앞 회차 지문을 나레이터 문체 지침(style)에 더한다."""
    if item['kind'] == 'monologue':
        lines = voice_lines(corpus, item)
        return ({**data, 'known': [*data['known'], _voice_doc(lines)]} if len(lines) >= VOICE_MIN else data), extra
    paragraphs = style_paragraphs(corpus, item)
    doc = {'ref': 'manuscript:style', 'title': '나레이터 문체 예시(앞 회차 원문)', 'text': '\n\n'.join(paragraphs)}
    return ({**data, 'style': [*data.get('style', []), doc]} if paragraphs else data), extra


def v3_relations(asked: dict, extra: dict, item: dict, corpus, cap: int = RELATIONS) -> tuple[dict, dict]:
    """known의 관계 줄을 cap개로: 장면 인물과 이어진 관계(같은 쌍)가 먼저, 그다음 직전 줄과 겹침이 큰 순. 관계 아닌 항목은 그대로 둔다."""
    relations = [d for d in asked['known'] if d['ref'].startswith('relation:')]
    if len(relations) <= cap:
        return asked, extra
    others, scene = [n for n in item['cast'] if n != item['speaker']], _bigrams(_scene(item))
    keep = {d['ref'] for d in sorted(relations, key=lambda d: (any(n in d['text'] for n in others), len(_bigrams(d['text']) & scene)), reverse=True)[:cap]}
    return {**asked, 'known': [d for d in asked['known'] if not d['ref'].startswith('relation:') or d['ref'] in keep]}, extra


def v2_forbidden(asked: dict, extra: dict, item: dict, corpus, cap: int = FORBIDDEN) -> tuple[dict, dict]:
    """검사 입력의 forbidden을 cap개로: 검사할 문단(gold)·직전 줄과 겹침이 큰 항목(원래 순서 유지)."""
    docs = extra.get('forbidden', [])
    if len(docs) <= cap:
        return asked, extra
    query = _bigrams(item['gold'] + ' ' + _scene(item))
    keep = sorted(sorted(range(len(docs)), key=lambda i: -len(_bigrams(docs[i]['text']) & query))[:cap])
    return asked, {**extra, 'forbidden': [docs[i] for i in keep]}


def v4_check(asked: dict, extra: dict, item: dict, corpus) -> tuple[dict, dict]:
    return v2_forbidden(*v3_relations(asked, extra, item, corpus), item, corpus)


def v5_relations(asked: dict, extra: dict, item: dict, corpus) -> tuple[dict, dict]:
    """V3보다 덜 줄인다(관계 48개까지): 장면과 무관한 관계가 인물 이해에 주는 도움을 덜 버리는지 본다."""
    return v3_relations(asked, extra, item, corpus, cap=48)


# 세트 키 → 후크. 키가 없는 세트는 입력을 바꾸지 않는다.
VARIANTS = {'V1': {'1': v1_act, '3n': v1_narrate, '3m': v1_narrate}, 'V2': {'4': v2_forbidden}, 'V3': {'1': v3_relations, '4': v3_relations},
            'V4': {'1': v3_relations, '4': v4_check}, 'V5': {'1': v5_relations}}
