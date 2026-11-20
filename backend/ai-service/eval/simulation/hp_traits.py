"""인물 SOUL·GOAL 다시 쓰기(#642 후속): 원문 전체에서 변하지 않는 말투·성격·가치관·습관·대표적 욕구만 쓰고, 반전·결과·나중에 밝혀지는 것은 문서에 두지 않는다.

IDENTITY·별칭·설정 본문은 처음 나온 대목만으로 쓴 그대로이고(첫 등장 규칙), SOUL·GOAL은 인물이 나온 순간부터 늘 보이지만 '사람됨'이라 이야기 전체에서 한결같은 면만 쓴다.
정체·이중첩자·충성의 반전, 생사·부상·변신 같은 결과, 나중에 밝혀지는 과거·혈연·비밀, 후반 사건의 이름과 결말은 문서에 쓰지 않고 회차 기억·관계에만 둔다.
모델이 쓴 문서는 서버 쪽에서 한 번 더 검사한다: 금지 낱말(모든 인물에 쓰는 것 + 인물별로 정한 것 + 그 인물의 회차 기억에서 뒤 회차에만 나오는 고유명사)이 들어 있으면
그 낱말을 알려 주고 한 번 다시 쓰게 하며, 그래도 걸리면 그 인물의 문서는 이전 값으로 두고 목록에 남긴다(지어내지도 숨기지도 않는다).
"""

import json
import re

from pydantic import BaseModel

MAX_TRAITS = 70          # 모델에 주는 기록 수 상한(넘으면 시간 순으로 고르게 뽑는다)
MIN_LATE_EPISODES = 4    # 회차 기억이 이보다 적은 인물은 '뒤 회차에만 나오는' 낱말을 뽑지 않는다
MIN_LATE_LEN = 3         # 뽑는 고유명사의 최소 글자 수: 두 글자 낱말은 보통 낱말 속에 우연히 들어 있어 문서를 잘못 걸러 낸다(정해 둔 두 글자 금지어는 따로 둔다)
HONORIFICS = {'professor', 'mr', 'mrs', 'ms', 'miss', 'madam', 'uncle', 'aunt', 'lord', 'sir', 'dr'}

TRAIT_INSTRUCTIONS = """소설 「해리 포터」의 인물 한 명에 대한 기록입니다: 원문 전체에서 그 인물에 대해 뽑은 성격·말투·바람(시간 순, 같은 내용은 한 번). 작가가 인물 설정을 쓰듯, 이 인물의 **이야기 내내 변하지 않는 면**만 문서 둘로 씁니다.

- soul: '## 말투'와 '## 사고방식' 두 절에 글머리표('- ')로. 말투는 어조·말버릇·호칭 습관, 사고방식은 성격·가치관·습관·반응 방식입니다. 300~500자.
- goal: 이 인물이 이야기 내내 한결같이 바라는 것(대표적 욕구) 1~3줄, 글머리표('- '). 뚜렷한 것이 없으면 빈 문자열.

이 문서는 인물이 처음 나온 순간부터 늘 보이므로 이야기가 진행되며 일어나거나 밝혀지는 일은 쓰지 않습니다. 쓰지 않는 것:
- 정체·이중첩자·충성하는 쪽의 반전, 겉모습 뒤에 숨은 사실
- 죽음·부상·변신·실종 같은 결과
- 나중에 밝혀지는 과거·혈연·비밀
- 특정 사건의 이름과 그 결말(특히 이야기 후반의 일), 다른 인물과의 관계가 바뀐 일
일어난 일이 아니라 사람됨(말하고 생각하고 반응하는 방식)을 씁니다. 기록에 없는 것은 지어내지 않고, 기록이 부족하면 드러난 만큼만 짧게 씁니다. 권·장 번호를 쓰지 않습니다.
avoid가 있으면 그 낱말과 그 낱말이 가리키는 사실을 문서에 쓰지 않습니다(앞서 쓴 문서에 들어가 있던 낱말입니다)."""

# 모든 인물의 문서에서 금지하는 낱말(번역본 표기): 이야기 후반에 밝혀지는 것의 이름
GLOBAL_SPOILERS = ('호크룩스', '영혼의 조각', '영혼 조각', '죽음의 성물', '혼혈 왕자', '혼혈왕자', '이중 첩자', '이중첩자', '이중 스파이', '다변 물약')
# 인물별 금지 낱말(영어 정식 이름의 낱말이 모두 들어 있는 인물): 정체·충성의 반전, 숨은 정체, 죽음, 배신
PERSON_SPOILERS = {
    'Severus Snape': ('릴리', '이중', '첩자', '스파이', '충성', '죽음을 먹는', '패트로누스', '덤블도어를 죽', '덤블도어의 명령'),
    'Quirrell': ('볼드모트', '숙주', '터번', '뒤통수', '두 얼굴'),
    'Peter Pettigrew': ('스캐버스', '웜테일', '벌레꼬리', '쥐로', '애니마구스', '배신', '볼드모트'),
    'Alastor Moody': ('크라우치', '가짜', '변신', '복수약'),
    'Barty Crouch Jr.': ('무디', '탈옥', '복종', '임페리오'),
    'Albus Dumbledore': ('사망', '죽음을 맞', '죽임을 당', '살해', '스네이프에게', '반지', '저주받은'),
    'Harry Potter': ('호크룩스', '영혼 조각', '영혼의 조각', '죽음의 성물'),
    'Voldemort': ('톰 리들', '리들', '호크룩스', '고아'),
    'Sirius Black': ('베일', '죽었', '사망'),
}


class Traits(BaseModel):
    soul: str
    goal: str


def tokens(name: str) -> list[str]:
    return [t for t in re.findall(r'[a-z]+', name.lower()) if t not in HONORIFICS]


def trait_entries(records) -> list[dict]:
    """성격·말투·바람 중 하나라도 있는 기록만(사건·처지·외모·그 장의 일은 후반 정보를 싣기 쉬워 주지 않는다), 같은 내용은 한 번, 시간 순."""
    seen, entries = set(), []
    for r in records:
        entry = {'personality': r.personality.strip(), 'speech': r.speech.strip(), 'wants': r.wants.strip()}
        if any(entry.values()) and (signature := tuple(entry.values())) not in seen:
            seen.add(signature)
            entries.append(entry)
    return entries


def sample(entries: list, limit: int = MAX_TRAITS) -> list:
    """limit개를 넘으면 처음과 끝을 지키며 시간 순으로 고르게 뽑는다."""
    if len(entries) <= limit:
        return entries
    return [entries[round(i * (len(entries) - 1) / (limit - 1))] for i in range(limit)]


def trait_request(title: str, aliases: list[str], entries: list, avoid=()) -> tuple[str, str]:
    """SOUL·GOAL 요청: 이름·별칭과 기록뿐이다(영어 이름은 싣지 않는다). avoid는 앞서 쓴 문서에 걸린 금지 낱말이다."""
    data = {'name': title, 'aliases': aliases, 'records': sample(entries)}
    if avoid:
        data['avoid'] = sorted(avoid)
    return TRAIT_INSTRUCTIONS, json.dumps(data, ensure_ascii=False)


def _found(text: str, nouns: set[str], longest: int) -> set[str]:
    """text 안에 들어 있는 고유명사(낱말 경계 없이 부분 일치: 한글은 조사가 붙는다)."""
    return {text[i:j] for i in range(len(text)) for j in range(i + 2, min(len(text), i + longest) + 1) if text[i:j] in nouns}


def late_nouns(texts: dict[int, str], nouns: set[str], own: set[str]) -> set[str]:
    """그 인물의 회차 기억(texts: 회차 → 글)에서 가운데 회차 뒤에만 나오는 고유명사: 반전·결말의 이름일 가능성이 높아 문서에 쓰지 않는다. 기억이 적은 인물은 뽑지 않는다."""
    ordinals = sorted(texts)
    if len(ordinals) < MIN_LATE_EPISODES:
        return set()
    cut, longest, early, late = ordinals[(len(ordinals) - 1) // 2], max(map(len, nouns), default=0), set(), set()
    for ordinal in ordinals:
        (early if ordinal <= cut else late).update(_found(texts[ordinal], nouns, longest))
    return {n for n in late - early if len(n) >= MIN_LATE_LEN and n not in own and not any(n in name for name in own)}


def forbidden_words(en: str | None, own: set[str], late: set[str]) -> set[str]:
    """이 인물의 문서에 들어가면 안 되는 낱말: 모두에게(GLOBAL) + 이 인물에게(PERSON) + 뒤 회차에만 나오는 고유명사. 이 인물의 이름·별칭은 뺀다."""
    own_tokens = set(tokens(en or ''))
    personal = {w for name, words in PERSON_SPOILERS.items() if set(tokens(name)) <= own_tokens for w in words}
    return {w for w in {*GLOBAL_SPOILERS, *personal, *late} if len(w) >= 2 and not any(w in name or name in w for name in own)}


def caught(text: str, words) -> list[str]:
    """text에 들어 있는 금지 낱말(부분 일치, 정렬)."""
    return sorted(w for w in words if w in text)
