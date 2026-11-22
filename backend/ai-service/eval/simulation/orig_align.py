"""화자·독백 판별 실행: 회차를 청크로 나눠 두 경로(예: OpenAI gpt-6-luna와 ocx)에 같은 요청을 따로 보내고 같은 턴만 확정한다.

모델은 대사의 화자와 지문이 인물의 독백인지만 판별한다(턴 자르기는 규칙). 호출 실패·잘린 응답·파싱 실패한 청크는 두 경로 모두 판별 못 한 것으로 두고 집계에 센다.
"""

import json
from concurrent.futures import ThreadPoolExecutor

from orig_common import SEED  # noqa: F401,I001  경로 설정이 llm import보다 먼저여야 한다
from llm import LlmFailure
from pydantic import ValidationError

import orig_turns as ot

ALIGN_TOKENS = 8000   # 추론 토큰도 출력 상한에 들어가 작으면 JSON이 잘린다


def ask_labels(llm, chunk: dict) -> dict | None:
    """청크 하나를 한 경로에 보내 {줄 번호: (화자, 독백 인물)}. 호출·파싱이 실패하면 None."""
    try:
        out = llm.ask('align', ot.LABEL_INSTRUCTIONS, json.dumps(chunk, ensure_ascii=False), schema=ot.Labels, max_output_tokens=ALIGN_TOKENS)
    except (LlmFailure, ValidationError):   # 호출 실패·잘린 JSON은 판별 못 한 청크다
        return None
    return ot.read_labels(out, chunk['turns'], chunk['names'])


def align_episode(text: str, names: list[str], first_person: bool, first, second, size: int = 40, workers: int = 12) -> dict:
    """회차 본문을 턴으로 자르고 두 경로의 판별에서 같은 턴만 확정한다: {turns(status·speaker·monologue 포함), chunks, failedChunks}."""
    turns = ot.split_turns(text)
    chunks = ot.label_chunks(turns, names, first_person, size)
    with ThreadPoolExecutor(workers) as pool:   # 두 경로의 모든 청크를 한꺼번에 낸다
        a, b = ([f.result() for f in row] for row in [[pool.submit(ask_labels, llm, chunk) for chunk in chunks] for llm in (first, second)])
    merged, failed = {}, 0
    for chunk, la, lb in zip(chunks, a, b, strict=True):
        merged |= ot.merge_labels(chunk['turns'], la, lb)
        failed += la is None or lb is None
    return {'turns': [{**t, **merged[t['i']]} for t in turns], 'chunks': len(chunks), 'failedChunks': failed}


def agreement(turns: list[dict]) -> dict:
    """일치율 집계: 대사 수·일치한 대사 수, 지문 수·일치한 지문 수(독백 여부가 같은 것), 확정된 독백 수."""
    dialogue = [t for t in turns if t['kind'] == 'dialogue']
    narration = [t for t in turns if t['kind'] == 'narration']
    return {'dialogue': len(dialogue), 'dialogueAgreed': sum(t['status'] == 'agreed' for t in dialogue), 'narration': len(narration),
            'narrationAgreed': sum(t['status'] == 'agreed' for t in narration), 'monologue': sum(t['status'] == 'agreed' and bool(t.get('monologue')) for t in narration)}
