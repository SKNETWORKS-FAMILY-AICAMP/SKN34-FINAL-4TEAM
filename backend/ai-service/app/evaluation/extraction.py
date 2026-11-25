"""추출 평가 세트(extraction.extract)의 생성·코드 채점. 운영 회귀 평가는 이 세트만 정답표와 코드로 채점한다(채점 모델 없음, 설계 docs/evaluation/extraction-set.md).

생성은 업무 Agent 틀이 아니라 실제 서비스 호출이다: app/manuscript_extraction/service.extract에 평가 대상 프롬프트 버전의 본문·모델을 그대로 주고(production 버전을 읽지 않는다)
결과는 서비스와 같은 원문·참조·시점 검증을 거친다. 정답표(항목 expectedOutput)는 상위 모델이 서로 다른 지시문으로 두 번 뽑은 대상·진술·관계이고 항목마다 core(두 번 모두 뽑음)가 있다.
채점 지표는 0~1이고 높을수록 좋다: recall = '설정다운' core 정답 중 추출이 맞춘 비율을 대상·진술·관계마다 구해 그런 정답이 있는 종류끼리 평균, quote_ok = 통과 항목 ÷ (통과 + skipped 건수).
설정다운 것은 kind·document 필드로 코드가 가린다(모델 호출 없음): 대상은 물건이 아니면 모두(인물·장소·세력·규칙), 물건은 회차 글에 MIN_OBJECT_MENTIONS번 이상 나올 때만(한 번 지나가는 음식·일상 물건은 뺀다),
진술은 인물 문서(identity·soul·goal)에 실리는 것(memory = 줄거리 사건은 뺀다), 관계는 두 끝점이 모두 설정 대상이고 한쪽 이상이 인물인 것이다. 뺀 core 정답의 재현율은 참고(outside)로 남긴다.
정밀도(합집합 정답 기준)·종류 일치·관계 방향·라벨·설정 밖 재현율은 참고라 recall 점수의 metadata에만 남긴다(게이트에 올리지 않는다). 호칭·진술·관계를 맞추는 규칙은 names_match·overlaps·score 한 곳이다(정답표 합치기도 같은 함수를 쓴다).
모델·검증 실패(PreprocessingFailure)는 0점이 아니라 항목 실패다(고정 코드만 담는다).
"""

import re
import unicodedata
from statistics import fmean

from langfuse import Evaluation
from pydantic import BaseModel, StrictBool, ValidationError

from app.evaluation.errors import EvaluationFailure
from app.manuscript_extraction import service
from app.manuscript_extraction.models import EpisodeText

DATASET = 'extraction.extract'   # 평가 세트 이름
PROMPT = 'manuscript_extraction.extract'   # 이 세트가 짝으로 평가하는 지시문
METRICS = ('recall', 'quote_ok')   # Run 점수로 남기고 게이트가 비교하는 지표
KINDS = {'mentions': '대상', 'statements': '진술', 'relationships': '관계'}   # 항목 종류 → 항목 로그의 표기
SETTING_DOCUMENTS = ('identity', 'soul', 'goal')   # 인물 문서에 실리는 진술(설정). memory(줄거리 사건·인물이 알게 된 것)는 설정이 아니다
MIN_OBJECT_MENTIONS = 2   # 물건은 회차 글에 이만큼 이상 나와야 고유한 물건(설정)으로 센다
OVERLAP = 0.5   # 두 인용이 짧은 쪽의 이만큼 이상 겹치면 같은 진술이다
BAD_INPUT = '추출 평가 항목의 input에는 number(1 이상)·title·body가 필요합니다.'
BAD_ITEM = '추출 평가 항목에 정답표(expectedOutput의 mentions·statements(document 포함)·relationships, 설정에 드는 core 정답 하나 이상)가 필요합니다.'


class GoldMention(BaseModel):
    name: str
    kind: str
    aliases: list[str]
    core: StrictBool


class GoldStatement(BaseModel):
    kind: str
    document: str   # 진술이 실리는 문서(identity·soul·goal·memory): 설정 진술을 가른다
    quote: str
    core: StrictBool


class GoldRelation(BaseModel):
    source: str   # 끝점은 GoldMention.name
    target: str
    label: str
    core: StrictBool


class Gold(BaseModel):
    """정답표(항목 expectedOutput): 종류마다 항목 목록이고 core는 두 번 모두 뽑은 것(교집합)이다. 모든 항목이 합집합이다."""
    mentions: list[GoldMention]
    statements: list[GoldStatement]
    relationships: list[GoldRelation]


def generate(instructions: str, item_input: dict, model: str | None = None) -> dict:
    """항목 입력(회차 한 편, 서비스가 그 호출에 보내는 값 그대로)을 서비스 호출로 실행해 검증된 추출을 돌려준다. instructions·model은 평가하는 버전의 본문·모델이다.
    원문(source)·evidence는 trace에 되풀이하지 않으려 뺀다(채점은 항목 input의 body를 쓴다)."""
    try:
        episode = EpisodeText.model_validate(item_input)
    except ValidationError:   # pydantic 오류 문자열은 입력(원고)을 에코한다
        raise EvaluationFailure(422, BAD_INPUT) from None
    return service.extract(episode, instructions, model).model_dump(include={'mentions', 'statements', 'relationships', 'skipped'})


def evaluate(item_input: dict, output: dict, expected) -> list[Evaluation]:
    """추출(output)을 정답표(expected)와 코드로 대조한 지표들(METRICS). 정답표가 없거나 core 정답이 하나도 없으면 모델 호출 없이 항목 실패다."""
    body = item_input.get('body') if isinstance(item_input, dict) else None
    if not isinstance(body, str):
        raise EvaluationFailure(422, BAD_INPUT)
    try:
        result = score(body, output, expected)
    except ValidationError:   # 정답표 형식이 틀렸다
        raise EvaluationFailure(422, BAD_ITEM) from None
    if result['recall'] is None:
        raise EvaluationFailure(422, BAD_ITEM)
    found = ' · '.join(f'{KINDS[kind]} {value:.2f}' for kind, value in result['recalls'].items() if value is not None)
    dropped = ', '.join(f'{code} {count}' for code, count in sorted(output['skipped'].items()))   # 뺀 항목의 코드별 건수(원문은 없다)
    return [Evaluation(name='recall', value=result['recall'], comment=f'재현율 {found}', metadata={**result['reference'], 'recalls': result['recalls']}),
            Evaluation(name='quote_ok', value=result['quote_ok'], comment=f'뺀 항목: {dropped}' if dropped else None)]


def names_match(a: str, b: str) -> bool:
    """두 호칭이 같은가: 공백·문장부호를 없애고 소문자로 접은(NFKC) 글이 같거나, 짧은 쪽이 두 글자 이상이고 긴 쪽에 들어 있다(김 첨지=김첨지=첨지, 점순⊂점순이).
    ponytail: 포함 규칙은 휴리스틱이다. 흔한 낱말이 이름인 작품은 잘못 맞출 수 있어 필요해지면 별칭 표(kt_text.canonical_names)로 바꾼다."""
    short, long = sorted((_fold(a), _fold(b)), key=len)
    return bool(short) and (short == long or (len(short) >= 2 and short in long))


def shared(body: str, a: str, b: str) -> int:
    """두 인용이 원문에서 겹치는 글자 수(원문에 없는 인용은 0)."""
    x, y = body.find(a), body.find(b)
    return max(0, min(x + len(a), y + len(b)) - max(x, y)) if x >= 0 and y >= 0 else 0


def overlaps(body: str, a: str, b: str) -> bool:
    """두 인용이 짧은 쪽의 OVERLAP 이상 겹치는가. 인용은 한 문장이라 위치 겹침으로 같은 진술을 판정한다."""
    size = shared(body, a, b)
    return size > 0 and size >= OVERLAP * min(len(a), len(b))


def score(body: str, output: dict, gold: dict | Gold) -> dict:
    """{recall(설정 core가 있는 종류의 평균, 없으면 None), quote_ok, recalls(종류별 설정 재현율), reference{precision(종류별), outside(종류별 설정 밖 core 재현율), kind_match, direction, label}}. 정의할 수 없는 비율은 None이다.
    gold가 정답표 모양이 아니면 pydantic ValidationError다."""
    gold = Gold.model_validate(gold)
    found = {kind: output[kind] for kind in KINDS}
    names = {m['id']: m['name'] for m in found['mentions']}
    aliases = {g.name: [g.name, *g.aliases] for g in gold.mentions}   # 관계 정답의 끝점도 별칭으로 맞춘다

    def near(name, options):
        return any(names_match(name, option) for option in options)

    def direction(c, g):   # 관계가 정답과 맞지 않으면 None, 맞으면 방향(source→target)까지 같은가
        source, target = names.get(c['source'], ''), names.get(c['target'], '')
        g_source, g_target = aliases.get(g.source, [g.source]), aliases.get(g.target, [g.target])
        if near(source, g_source) and near(target, g_target):
            return True
        return False if near(source, g_target) and near(target, g_source) else None

    hits = {'mentions': lambda c, g: near(c['name'], [g.name, *g.aliases]),
            'statements': lambda c, g: overlaps(body, c['quote'], g.quote),
            'relationships': lambda c, g: direction(c, g) is not None}
    split = partition(body, gold)
    recalls, outside, precision = {}, {}, {}
    for kind in KINDS:
        inside, rest = split[kind]
        recalls[kind] = _ratio(sum(any(hits[kind](c, g) for c in found[kind]) for g in inside), len(inside))
        outside[kind] = _ratio(sum(any(hits[kind](c, g) for c in found[kind]) for g in rest), len(rest))
        precision[kind] = _ratio(sum(any(hits[kind](c, g) for g in getattr(gold, kind)) for c in found[kind]), len(found[kind]))
    named = [(c, matches) for c in found['mentions'] if (matches := [g for g in gold.mentions if hits['mentions'](c, g)])]   # 정답 대상을 맞춘 추출 대상과 그 정답들
    related = [(c, matches) for c in found['relationships'] if (matches := [(g, d) for g in gold.relationships if (d := direction(c, g)) is not None])]
    kept, dropped = sum(len(found[kind]) for kind in KINDS), sum(output['skipped'].values())
    defined = [value for value in recalls.values() if value is not None]
    return {'recall': fmean(defined) if defined else None, 'quote_ok': kept / (kept + dropped) if kept + dropped else 1.0, 'recalls': recalls,
            'reference': {'precision': precision, 'outside': outside,
                          'kind_match': _ratio(sum(any(g.kind == c['kind'] for g in matches) for c, matches in named), len(named)),
                          'direction': _ratio(sum(any(same for _, same in matches) for _, matches in related), len(related)),
                          'label': _ratio(sum(any(names_match(c['label'], g.label) for g, _ in matches) for c, matches in related), len(related))}}


def partition(body: str, gold: Gold) -> dict[str, tuple[list, list]]:
    """종류마다 (설정다운 core 정답, 설정 밖 core 정답). 가르는 규칙은 이 모듈 설명 그대로다(kind·document 필드와 회차 글의 이름 횟수만 쓴다)."""
    by_name = {g.name: g for g in gold.mentions}

    def setting_mention(g):   # 대상: 물건이 아니면 설정이고, 물건은 회차 글에 두 번 이상 나올 때만 설정이다
        return g.kind != 'object' or max(body.count(name) for name in (g.name, *g.aliases)) >= MIN_OBJECT_MENTIONS

    def setting_relation(g):   # 관계: 두 끝점이 모두 설정 대상이고 한쪽 이상이 인물이다
        ends = [by_name.get(g.source), by_name.get(g.target)]
        return all(ends) and all(setting_mention(end) for end in ends) and any(end.kind == 'character' for end in ends)

    setting = {'mentions': setting_mention, 'statements': lambda g: g.document in SETTING_DOCUMENTS, 'relationships': setting_relation}
    core = {kind: [g for g in getattr(gold, kind) if g.core] for kind in KINDS}
    return {kind: ([g for g in core[kind] if setting[kind](g)], [g for g in core[kind] if not setting[kind](g)]) for kind in KINDS}


def _fold(text: str) -> str:
    return re.sub(r'[\W_]+', '', unicodedata.normalize('NFKC', text)).lower()


def _ratio(hit: int, total: int) -> float | None:
    return hit / total if total else None
