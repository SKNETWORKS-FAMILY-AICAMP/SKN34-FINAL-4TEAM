"""원문을 턴(대사·지문)으로 나누고, 모델 판별(화자·독백) 요청·병합과 직전 원문 줄·장면 인물을 만든다. 순수 함수: 모델·네트워크 호출이 없다."""

import re
from collections import Counter

from pydantic import BaseModel

from orig_common import CONTEXT_CHARS, K

QUOTE = re.compile(r'"([^"\n]*)"|“([^”\n]*)”|「([^」\n]*)」|『([^』\n]*)』')
TAG_MAX = 60        # 대사 곁의 지문 조각이 이보다 짧으면 지문 턴이 아니라 그 대사의 꼬리표(화자 판별 근거)다
LABEL_CHARS = 500   # 판별 요청에 싣는 줄 하나의 글자 상한
NARRATOR, UNKNOWN = '나레이션', '화자 미상'
FIRST_PERSON = '나'  # 1인칭 작품의 서술자 이름(인물 카드가 없다)

LABEL_INSTRUCTIONS = (
    '다음은 한국 소설의 한 대목이다. turns의 각 줄을 판별한다(before는 앞서 지나간 줄로 판별하지 않고 맥락으로만 본다). '
    'kind가 dialogue인 줄은 speaker에 그 대사를 말한 인물의 이름 하나를 names에서 골라 쓴다(tag·앞뒤 줄이 근거이고, 확실하지 않으면 빈 문자열). '
    'kind가 narration인 줄은 인물의 속마음(그 인물이 마음속으로 생각하거나 느끼는 것을 직접 적은 글: "~라고 생각했다", 혼잣말 같은 서술)이면 monologue에 '
    '그 인물의 이름을 names에서 골라 쓰고, 겉으로 드러난 행동·배경·남이 보고 알 수 있는 일이면 빈 문자열이다. '
    '모든 줄에 대해 {i, speaker, monologue}를 줄 번호(i)대로 하나씩 답한다. dialogue 줄의 monologue와 narration 줄의 speaker는 빈 문자열이다.')


class Label(BaseModel):
    i: int
    speaker: str
    monologue: str


class Labels(BaseModel):
    labels: list[Label]


def split_turns(text: str) -> list[dict]:
    """원문을 턴으로: 따옴표(직선·둥근·낫표) 구간 하나가 대사 턴, 따옴표 없는 글은 지문 턴이다.
    대사 곁(앞·뒤)의 짧은 지문 조각(TAG_MAX 미만)은 그 대사의 꼬리표(tag)이고 긴 조각은 지문 턴이다(whole=False: 한 문단 전체가 아닌 조각).
    한 문단에 대사가 하나도 없으면 지문 턴 하나(whole=True)다. 짝이 없는 따옴표는 따옴표로 보지 않는다."""
    turns = []
    for par, line in enumerate(l.strip() for l in text.split('\n') if l.strip()):
        pieces, last = [], 0
        for m in QUOTE.finditer(line):
            if line[last:m.start()].strip():
                pieces.append(['n', line[last:m.start()].strip()])
            inner = next(g for g in m.groups() if g is not None).strip()
            if inner:
                pieces.append(['d', f'"{inner}"'])
            last = m.end()
        if line[last:].strip():
            pieces.append(['n', line[last:].strip()])
        whole = not any(kind == 'd' for kind, _ in pieces)
        for k, (kind, piece) in enumerate(pieces):
            if kind == 'n' and (whole or len(piece) >= TAG_MAX):
                turns.append({'kind': 'narration', 'text': piece, 'par': par, 'whole': whole})
            elif kind == 'd':
                near = [pieces[j][1] for j in (k - 1, k + 1) if 0 <= j < len(pieces) and pieces[j][0] == 'n' and len(pieces[j][1]) < TAG_MAX]
                turns.append({'kind': 'dialogue', 'text': piece, 'tag': ' '.join(near), 'par': par})
    return [{'i': i, **t} for i, t in enumerate(turns)]


def _view(turn: dict) -> dict:
    return {'i': turn['i'], 'kind': turn['kind'], 'text': turn['text'][:LABEL_CHARS], 'tag': turn.get('tag', '')}


def label_chunks(turns: list[dict], names: list[str], first_person: bool, size: int = 40, before: int = 4) -> list[dict]:
    """판별 요청들: 연속 size턴씩이고 앞쪽 before턴은 맥락(before)으로만 싣는다. 1인칭 작품은 서술자 「나」도 고를 수 있다."""
    allowed = [*names, FIRST_PERSON] if first_person and FIRST_PERSON not in names else list(names)
    return [{'names': allowed, 'before': [_view(t) for t in turns[max(0, s - before):s]], 'turns': [_view(t) for t in turns[s:s + size]]}
            for s in range(0, len(turns), size)]


def read_labels(out: Labels, turns: list[dict], names: list[str]) -> dict[int, tuple[str, str]]:
    """모델 답 → {줄 번호: (화자, 독백 인물)}. 요청에 없던 번호와 같은 번호의 두 번째 답은 버리고, names에 없는 이름은 「모름」(빈 문자열)이다.
    대사 줄의 독백과 지문 줄의 화자는 값이 있어도 비운다."""
    kind = {t['i']: t['kind'] for t in turns}
    got: dict[int, tuple[str, str]] = {}
    for item in out.labels:
        if item.i not in kind or item.i in got:
            continue
        speaker, monologue = (item.speaker.strip(), '') if kind[item.i] == 'dialogue' else ('', item.monologue.strip())
        got[item.i] = (speaker if speaker in names else '', monologue if monologue in names else '')
    return got


def merge_labels(turns: list[dict], first: dict | None, second: dict | None) -> dict[int, dict]:
    """두 경로의 판별에서 같은 줄만 확정한다. 대사는 화자가 같고 비어 있지 않을 때, 지문은 독백 여부(인물)가 같을 때 agreed다.
    한쪽 경로가 실패했으면(None) 그 줄은 모두 unlabeled다(정답·화자 근거로 쓰지 않는다)."""
    merged = {}
    for t in turns:
        a, b = (first or {}).get(t['i']), (second or {}).get(t['i'])
        speaker, monologue = a if a is not None and a == b else ('', '')
        ok = a is not None and a == b and (speaker != '' if t['kind'] == 'dialogue' else True)
        merged[t['i']] = {'status': 'agreed' if ok else 'unlabeled', 'speaker': speaker if ok else '', 'monologue': monologue if ok else ''}
    return merged


def context_lines(turns: list[dict], t: int, k: int = K, limit: int = CONTEXT_CHARS) -> list[dict]:
    """t번째 턴 앞의 원문 줄(같은 목록 안, 최대 k줄, 글자 수 합 limit 이하, 오래된 줄부터 뺀다. 가장 가까운 한 줄은 늘 남긴다).
    줄 = {kind(dialogue·narration·monologue), by(확인된 화자·「나레이션」·「화자 미상」), text, speaker(화자 또는 독백 인물)}."""
    lines = []
    for turn in turns[max(0, t - k):t]:
        who = turn.get('speaker', '') if turn.get('status') == 'agreed' else ''
        owner = turn.get('monologue', '') if turn.get('status') == 'agreed' else ''
        if turn['kind'] == 'dialogue':
            lines.append({'kind': 'dialogue', 'by': who or UNKNOWN, 'text': turn['text'], 'speaker': who})
        else:
            lines.append({'kind': 'monologue' if owner else 'narration', 'by': NARRATOR, 'text': turn['text'], 'speaker': owner})
    kept, size = [], 0
    for line in reversed(lines):
        if kept and size + len(line['text']) > limit:
            break
        kept.append(line)
        size += len(line['text'])
    return kept[::-1]


def cast_around(turns: list[dict], t: int, window: int = 15, cap: int = 6, only=None) -> list[str]:
    """t번째 턴 앞뒤 window턴에서 확인된 화자들(정답 화자가 먼저, 나머지는 많이 나온 순·처음 나온 순). only가 있으면 그 이름만, cap명까지."""
    gold = turns[t].get('speaker') or turns[t].get('monologue') or ''
    near = [x['speaker'] for x in turns[max(0, t - window):t + window + 1]
            if x['kind'] == 'dialogue' and x.get('status') == 'agreed' and x['speaker'] and (only is None or x['speaker'] in only)]
    counts = Counter(near)
    order = sorted(counts, key=lambda n: (-counts[n], near.index(n)))
    return ([gold] if gold else [])[:1] + [n for n in order if n != gold][:cap - (1 if gold else 0)]


def person_of(narration: str) -> str:
    """지문 글자만으로 1인칭 작품인지 어림한다: 「나는·내가…」가 「그는·그녀가…」보다 훨씬 많고 3번 이상이면 first, 아니면 third."""
    first = len(re.findall(r'나는|내가|나도|저는|제가', narration))
    third = len(re.findall(r'그는|그가|그녀는|그녀가|그도', narration))
    return 'first' if first >= 3 and first > third * 1.5 else 'third'
