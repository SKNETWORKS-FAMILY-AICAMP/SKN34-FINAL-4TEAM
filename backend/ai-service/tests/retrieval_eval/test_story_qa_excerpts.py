"""검색 품질 평가(#825): 고정 스냅샷으로 Q&A 설정 발췌(`story_qa.service.world_excerpts`: 공개 회차 거르기 + BM25 8건)를 본다.

Content MCP를 고정 세계관(`fixtures/ko_worlds.json`, 카드 17·13·8개)으로 대신해 한국어 62문항을 그 질문의 기준 회차로 던진다. 설정 질문(`setting` 14문항)은 근거 카드가 8건 안에
드는지(Recall@8·MRR@8), 모든 질문은 기준 회차 뒤에 공개되는 카드·관계가 한 건도 새지 않는지를 본다. 세계관이 8건을 넘으면 질문 낱말이 하나도 겹치지 않는 설정은 보내지 않으므로
질문에 따라 발췌가 비기도 한다(그때는 NO_SETTINGS 사유). 값은 docs/evaluation/retrieval.md의 표와 같다.
"""

from statistics import mean

import pytest

from app.story_qa import service
from eval.novelbrain.metrics import recall_at_k, reciprocal_rank


@pytest.fixture
def excerpt_ids(monkeypatch, worlds):
    """Content MCP를 고정 세계관으로 대신한 `world_excerpts`: 질문 → 발췌 ref 목록(BM25 순위 그대로)."""
    def call(tool, arguments):
        if tool == 'world_studio_list':
            return [{'worldId': title, 'linkedWorkId': title} for title in worlds]
        assert tool == 'world_studio_read'
        return worlds[arguments['id']]

    monkeypatch.setattr(service.content_mcp, 'call', call)
    return lambda q: [e.id for e in service.world_excerpts(q['work'], q['episode'], q['question'])[0]]


def test_setting_questions_find_their_card_among_the_eight_excerpts(questions, excerpt_ids):
    rows = [(q, excerpt_ids(q)) for q in questions if q['kind'] == 'setting']
    gold = lambda q: {f'card:{i}' for i in q['gold']}  # noqa: E731
    assert mean(recall_at_k(ids, gold(q), service.WORLD_EXCERPTS) for q, ids in rows) >= 1.0
    assert mean(reciprocal_rank(ids, gold(q), service.WORLD_EXCERPTS) for q, ids in rows) >= 0.91


def hidden(read: dict, episode: int) -> set[str]:
    """기준 회차 뒤에 공개되는 카드와 그 카드에 이어진 관계의 ref."""
    later = {c['id'] for c in read['cards'] if (c.get('semanticMetadata') or {}).get('revealFromEpisode', 0) > episode}
    return {f'card:{i}' for i in later} | {f"relation:{r['id']}" for r in read['relationships'] if {r['sourceCardId'], r['targetCardId']} & later}


def test_no_excerpt_is_revealed_after_the_question_episode(questions, worlds, excerpt_ids):
    guarded = 0
    for q in questions:
        ids, banned = excerpt_ids(q), hidden(worlds[q['work']], q['episode'])
        assert len(ids) <= service.WORLD_EXCERPTS and not set(ids) & banned, q['id']
        guarded += bool(banned)
    assert guarded >= 20  # 막을 설정이 있는 질문이 충분히 있어야 이 검사가 뜻을 가진다(측정 시점 23문항)
