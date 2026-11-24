"""파이프라인 평가의 앞 두 단 점수(코드 채점, 모델 호출 없음): ① 세계관 = 추출 skipped 기반 인용 통과율·평가 인물 포함률, ② 페르소나 = 인물 문서 줄의 원문 근거 비율.
셋째 단(시뮬레이션: voice·intent·style·info·시점 위반)은 orig_run의 기존 루브릭 집계를 그대로 쓴다.

ponytail: 추출 재현율(정답표 대비)은 #824(app/evaluation/extraction.py)가 병합되면 더한다. 페르소나는 원문 근거와 이름 명시만 코드로 가리고, 성격·말투가 맞는지는 시뮬레이션 점수로 본다.
"""

import re
from collections import Counter

from app.manuscript_extraction.models import Card
from app.manuscript_extraction.service import LABELS
from pipe_world import find_character

QUOTE_CODES = ('INVALID_OR_AMBIGUOUS_QUOTE', 'INVALID_MENTION_NAME')   # 인용·이름이 원문과 맞지 않아 빠진 항목
KNOWER_ONLY = ('KNOWLEDGE_NOT_EXPLICIT', 'INVALID_KNOWER')   # 항목이 아니라 항목 안의 인지 대상 하나만 뺀 것: 빠진 항목 수에서 뺀다
LABEL = re.compile('^(?:' + '|'.join(re.escape(label) for label in LABELS.values()) + ') ')   # 문서 줄은 '<표지> <인용>'이다(service._line)


def ratio(part: int, whole: int) -> float | None:
    return part / whole if whole else None


def extraction_stats(extractions) -> dict:
    """회차별 추출(EpisodeExtraction)의 남은 항목(대상·진술·관계)과 skipped(코드별 빠진 건수)로: 항목 통과율 = 남은 / 제안(남은 + 빠진), 인용 통과율 = 1 − 인용·이름 문제로 빠진 / 제안."""
    rows, skipped = list(extractions), Counter()
    for row in rows:
        skipped.update(row.skipped)
    kept = sum(len(row.mentions) + len(row.statements) + len(row.relationships) for row in rows)
    dropped = sum(n for code, n in skipped.items() if code not in KNOWER_ONLY)
    quote = sum(skipped[code] for code in QUOTE_CODES)
    proposed = kept + dropped
    return {'episodes': len(rows), 'kept': kept, 'dropped': dropped, 'skipped': dict(sorted(skipped.items())),
            'itemPass': ratio(kept, proposed), 'quotePass': None if not proposed else 1 - quote / proposed}


def coverage(names: set[str], cards: list[Card]) -> dict:
    """평가 문항에 나오는 인물 이름 중 파이프라인 인물 카드에 이은 비율(이름·별칭으로 잇는 규칙은 pipe_world.find_character)."""
    found = sum(1 for name in names if find_character(cards, name))
    return {'names': len(names), 'found': found, 'rate': ratio(found, len(names))}


def persona_stats(pairs: list[tuple[Card, dict[int, str]]]) -> dict:
    """(인물 카드, 그 작품의 회차별 원문) 쌍마다 문서 줄이 원문 근거 인용인지 센다(작품이 다른 쌍을 한꺼번에 센다). 줄은 '<표지> <인용>'이고 인용이 그 문서가 실린 회차의 원문에 글자 그대로 있으면 grounded다.
    IDENTITY(카드 본문)·SOUL·GOAL은 첫 등장 회차의 글이고 회차 기억 'NN'은 그 회차(00은 첫 등장 회차)의 글이다. named는 줄이 인물의 이름·별칭을 담은 것이다.
    줄이 하나도 없는 문서는 empty(IDENTITY를 이름으로 채운 것 포함)이고, ready는 IDENTITY·SOUL이 모두 줄로 있는 인물이라 운영의 필수 인물 문서 규칙을 실질적으로 채운 수다."""
    docs = {name: {'lines': 0, 'grounded': 0, 'named': 0, 'empty': 0} for name in ('identity', 'soul', 'goal', 'memory')}
    ready = 0
    for card, sources in pairs:
        written = card.characterDocs
        parts = {'identity': [(card.body, card.firstEpisode)], 'soul': [(written.soul, card.firstEpisode)], 'goal': [(written.goal, card.firstEpisode)],
                 'memory': [(text, int(number) or card.firstEpisode) for number, text in written.episodes.items()]}
        have = {}
        for name, texts in parts.items():
            lines = [(LABEL.sub('', line), episode) for text, episode in texts for line in text.split(chr(10)) if LABEL.match(line)]
            have[name] = bool(lines)
            docs[name]['empty'] += not lines
            docs[name]['lines'] += len(lines)
            docs[name]['grounded'] += sum(quote in sources.get(episode, '') for quote, episode in lines)
            docs[name]['named'] += sum(any(who in quote for who in (card.title, *card.aliases)) for quote, _ in lines)
        ready += have['identity'] and have['soul']
    return {'characters': len(pairs), 'ready': ready, 'docs': docs}
