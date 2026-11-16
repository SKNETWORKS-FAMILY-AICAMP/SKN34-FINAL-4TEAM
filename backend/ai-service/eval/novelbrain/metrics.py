"""NovelBrain 평가 지표: 순위 지표·답 일치·TimeChara 공개 채점 규칙 결합·신뢰구간. 모두 표준 라이브러리 순수 함수다."""

import math
import re
import string
from collections import Counter


def dedupe(ids: list[str]) -> list[str]:
    """같은 id는 처음 나온 순위에서 한 번만 센다(한 근거가 여러 항목으로 들어와도 중복 점수를 받지 않게)."""
    return list(dict.fromkeys(ids))


def _hits(ranked: list[str], gold: set[str], k: int) -> int:
    if not gold:
        raise ValueError('정답 근거가 없는 질문은 지표에서 제외해야 한다.')
    return len(set(dedupe(ranked)[:k]) & set(gold))


def recall_at_k(ranked: list[str], gold: set[str], k: int) -> float:
    """상위 k개 안에서 찾은 정답 근거의 비율."""
    return _hits(ranked, gold, k) / len(gold)


def precision_at_k(ranked: list[str], gold: set[str], k: int) -> float:
    """상위 k칸 중 정답 근거의 비율. 결과가 k개보다 적어도 분모는 k다."""
    return _hits(ranked, gold, k) / k


def normalize_answer(text: str) -> str:
    """SQuAD 규칙: 소문자·구두점·관사 제거 후 공백 정리."""
    text = text.lower().translate(str.maketrans('', '', string.punctuation))
    return ' '.join(re.sub(r'\b(a|an|the)\b', ' ', text).split())


def exact_match(pred: str, golds: list[str]) -> float:
    return float(any(normalize_answer(pred) == normalize_answer(gold) for gold in golds))


def _f1(pred: str, gold: str) -> float:
    pred_tokens, gold_tokens = normalize_answer(pred).split(), normalize_answer(gold).split()
    common = sum((Counter(pred_tokens) & Counter(gold_tokens)).values())
    if not common:
        return 0.0
    precision, recall = common / len(pred_tokens), common / len(gold_tokens)
    return 2 * precision * recall / (precision + recall)


def answer_f1(pred: str, golds: list[str]) -> float:
    """별칭 중 가장 높은 토큰 F1."""
    return max((_f1(pred, gold) for gold in golds), default=0.0)


def parse_score(content: str, valid) -> int | None:
    """채점 응답의 점수. TimeChara 원본 extract_score처럼 마지막 비어 있지 않은 줄의 마지막 숫자를 쓴다.

    범위 밖이거나 숫자가 없으면 점수를 꾸며 내지 않고 None(파싱 실패)을 돌려준다.
    """
    lines = [line.strip() for line in content.strip().splitlines() if line.strip()]
    if not lines:
        return None
    digits = re.findall(r'(?<![\d.])\d(?![\d.])', lines[-1])
    if not digits:
        return None
    score = int(digits[-1])
    return score if score in valid else None


def spatiotemporal_score(data_type: str, temporal: int, spatial: int | None) -> int:
    """TimeChara 공개 규칙: absence·presence는 공간×시간, future·past-only는 시간만."""
    if data_type in ('past-absence', 'past-presence'):
        if spatial is None:
            raise ValueError('absence·presence는 공간 점수가 필요하다.')
        return temporal * spatial
    if data_type in ('future', 'past-only'):
        return temporal
    raise ValueError(f'알 수 없는 data_type: {data_type}')


def wilson_interval(successes: int, n: int, z: float = 1.96) -> tuple[float, float]:
    """이항 비율의 Wilson 95% 구간. 표본이 작아 점추정만으로는 단계 차이를 읽을 수 없어 함께 낸다."""
    if n == 0:
        return 0.0, 0.0
    p = successes / n
    denom = 1 + z * z / n
    center = (p + z * z / (2 * n)) / denom
    margin = z * math.sqrt(p * (1 - p) / n + z * z / (4 * n * n)) / denom
    return max(0.0, center - margin), min(1.0, center + margin)


def sign_test(a: list[float], b: list[float]) -> dict:
    """같은 질문에서 두 구성의 점수를 짝지어 센다: a가 높은 질문 수(up)·낮은 질문 수(down)와 정확 부호 검정(양측) p.
    같은 점수의 질문은 검정에서 뺀다. 표본이 작아 평균 차이만으로는 '올랐다'고 말할 수 없어서 쓴다."""
    up = sum(x > y for x, y in zip(a, b, strict=True))
    down = sum(x < y for x, y in zip(a, b, strict=True))
    n = up + down
    p = min(1.0, 2 * sum(math.comb(n, i) for i in range(min(up, down) + 1)) / 2 ** n) if n else 1.0
    return {'up': up, 'down': down, 'p': p}
