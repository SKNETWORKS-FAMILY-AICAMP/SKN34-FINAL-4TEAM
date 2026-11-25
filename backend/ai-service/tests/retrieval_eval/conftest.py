"""고정 스냅샷 읽기. 스냅샷은 `eval/novelbrain/ko.py snapshot`이 만든다(만드는 법·내용은 docs/evaluation/retrieval.md)."""

import json
from pathlib import Path

import pytest

FIXTURES = Path(__file__).parent / 'fixtures'


@pytest.fixture(scope='session')
def worlds() -> dict:
    """작품 이름 → Content MCP `world_studio_read` 응답 모양의 세계관(카드·관계)."""
    return json.loads((FIXTURES / 'ko_worlds.json').read_text(encoding='utf-8'))


@pytest.fixture(scope='session')
def questions() -> list[dict]:
    """한국어 62문항: 질문·기준 회차·인물 카드 id·E5 상위 10 발췌와 찾아야 할 근거 `gold` 또는 상위에 들면 안 되는 근거 `banned`."""
    return [json.loads(line) for line in (FIXTURES / 'ko_questions.jsonl').read_text(encoding='utf-8').splitlines()]
