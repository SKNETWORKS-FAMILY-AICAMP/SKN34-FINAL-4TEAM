"""운영 인코더(E5-small ONNX)로 문단을 벡터로 바꾸고 코사인 kNN으로 찾는다. 벡터는 `.data`에 캐시한다.

`manuscript` 추가 패키지(numpy·onnxruntime·tokenizers)가 필요하다: `uv run --locked --extra dev --extra manuscript ...`
numpy는 함수 안에서 불러 와서, 추가 패키지 없이도 이 모듈의 순수 함수(best_window)를 import할 수 있다.
"""

import hashlib
import json
import re
from pathlib import Path

from app.novelbrain.service import tokenize
from prepare import DATA

# E5 입력 한도(512토큰)를 넘지 않게 자른다.
# ponytail: 운영은 한도를 넘는 입력을 422로 거절하지만 평가는 잘라 쓴다. 잘린 수는 run 결과에 기록하지 않는다(문단은 대부분 1,500자 이하).
MAX_CHARS = 1800


def embed_texts(texts: list[str], kind: str, batch_size: int = 16):
    """kind는 'passage' 또는 'query'(운영과 같은 접두어). (n, 384) float32 배열."""
    import numpy as np
    from app.story_qa.service import E5Encoder

    encoder = E5Encoder(DATA / 'e5-small')
    order = sorted(range(len(texts)), key=lambda i: len(texts[i]))  # 길이순으로 묶어 패딩 낭비를 줄인다
    out = np.zeros((len(texts), 384), dtype=np.float32)
    for start in range(0, len(order), batch_size):
        batch = order[start:start + batch_size]
        out[batch] = encoder.encode([f'{kind}: {texts[i][:MAX_CHARS]}' for i in batch])
    return out


def cached_embeddings(path: Path, texts: list[str], kind: str):
    """본문 목록(순서 포함)·kind·자르는 길이가 같은 캐시만 읽는다(지문은 `<path>.sha256`). 아니거나 지문이 없는 옛 캐시면 다시 계산해 저장한다."""
    import numpy as np

    stamp = path.with_name(path.name + '.sha256')
    fingerprint = hashlib.sha256(json.dumps([kind, MAX_CHARS, texts], ensure_ascii=False).encode()).hexdigest()
    if path.exists() and stamp.exists() and stamp.read_text() == fingerprint:
        return np.load(path)
    stamp.unlink(missing_ok=True)   # 저장하다 끊겨도 옛 지문이 새 행렬에 남지 않게 한다
    matrix = embed_texts(texts, kind)
    np.save(path, matrix)
    stamp.write_text(fingerprint)
    return matrix


def knn(matrix, query, k: int) -> list[int]:
    """코사인 유사도(정규화된 벡터의 내적) 상위 k개의 행 번호. 같은 점수는 앞 번호 먼저."""
    import numpy as np

    return np.argsort(-(matrix @ query), kind='stable')[:k].tolist()


def best_window(text: str, query: str, size: int = 256) -> str:
    """Excerpt.quote(최대 256자) 용으로 질문 낱말이 가장 많이 든 문장 창을 고른다. 같으면 앞쪽.

    ponytail: Content의 sourceExcerpts(줄 단위 점수)와 같은 목적의 단순 근사다. 한 문장이 size보다 길면 잘라 쓴다.
    """
    text = ' '.join(text.split())
    if len(text) <= size:
        return text
    terms = set(tokenize(query))
    sentences = re.split(r'(?<=[.!?。])\s+', text)
    best, best_hits = '', -1
    for i in range(len(sentences)):
        window = ''
        for sentence in sentences[i:]:
            if len(window) + len(sentence) + 1 > size:
                break
            window = f'{window} {sentence}'.strip()
        window = window or sentences[i][:size]
        hits = len(terms & set(tokenize(window)))
        if hits > best_hits:
            best, best_hits = window, hits
    return best
