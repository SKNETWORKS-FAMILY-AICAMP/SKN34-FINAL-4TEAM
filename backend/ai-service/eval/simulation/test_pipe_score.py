"""파이프라인 평가의 앞 두 단 점수(pipe_score): 추출 제외 건수 기반 인용 통과율, 평가 인물 포함률, 인물 문서 줄의 원문 근거 비율."""

from types import SimpleNamespace as NS

import pipe_score as ps
from app.manuscript_extraction.models import Card, CharacterDocs


def extraction(mentions, statements, relationships, skipped):
    return NS(mentions=[0] * mentions, statements=[0] * statements, relationships=[0] * relationships, skipped=skipped)


def test_extraction_stats_counts_kept_dropped_and_quote_pass():
    rows = [extraction(2, 3, 1, {'INVALID_OR_AMBIGUOUS_QUOTE': 2, 'DUPLICATE_STATEMENT': 1, 'KNOWLEDGE_NOT_EXPLICIT': 4}), extraction(1, 1, 0, {'INVALID_MENTION_NAME': 1})]
    got = ps.extraction_stats(rows)
    # 남은 8 + 빠진 항목 4(인지 대상 하나만 뺀 KNOWLEDGE_NOT_EXPLICIT는 항목이 빠진 것이 아니라 분모에서 뺀다) = 제안 12, 인용 문제로 빠진 3
    assert got == {'episodes': 2, 'kept': 8, 'dropped': 4, 'itemPass': 8 / 12, 'quotePass': 0.75,
                   'skipped': {'DUPLICATE_STATEMENT': 1, 'INVALID_MENTION_NAME': 1, 'INVALID_OR_AMBIGUOUS_QUOTE': 2, 'KNOWLEDGE_NOT_EXPLICIT': 4}}
    assert ps.extraction_stats([extraction(0, 0, 0, {})]) == {'episodes': 1, 'kept': 0, 'dropped': 0, 'itemPass': None, 'quotePass': None, 'skipped': {}}   # 아무것도 제안하지 않은 회차는 비율이 없다


def card(key, title, body, first, soul='', goal='', episodes=None, aliases=()):
    return Card(key=key, cardType='character', title=title, aliases=list(aliases), body=body, firstEpisode=first, characterDocs=CharacterDocs(soul=soul, goal=goal, episodes=episodes or {}))


SOURCES = {1: '김 첨지는 인력거꾼이다. 그는 성미가 급하다.', 2: '치삼은 오래된 친구였다.'}


def test_persona_stats_checks_each_document_line_against_the_source():
    cards = [card('a', '김 첨지', '[사실] 김 첨지는 인력거꾼이다.' + chr(10) + '[묘사] 원문에 없는 문장이다.', 1, soul='[묘사] 그는 성미가 급하다.', episodes={'00': '[사실] 김 첨지는 인력거꾼이다.'}),
             card('b', '치삼', '치삼', 2, episodes={'02': '[사건] 치삼은 오래된 친구였다.'})]
    got = ps.persona_stats([(c, SOURCES) for c in cards])
    assert got['characters'] == 2 and got['ready'] == 1   # IDENTITY·SOUL이 모두 줄로 있는 인물(치삼은 IDENTITY가 이름으로 채운 것, SOUL 없음)
    assert got['docs']['identity'] == {'lines': 2, 'grounded': 1, 'named': 1, 'empty': 1}   # 한 줄은 원문에 없고, 둘째 인물은 줄이 없다
    assert got['docs']['soul'] == {'lines': 1, 'grounded': 1, 'named': 0, 'empty': 1}   # 이름 없이 '그는'으로 쓴 줄은 근거는 있어도 named가 아니다
    assert got['docs']['goal'] == {'lines': 0, 'grounded': 0, 'named': 0, 'empty': 2}
    assert got['docs']['memory'] == {'lines': 2, 'grounded': 2, 'named': 2, 'empty': 0}   # 00은 첫 등장 회차 원문, 02는 2화 원문에서 찾는다


def test_persona_stats_accepts_aliases_as_naming_and_missing_source_is_ungrounded():
    cards = [card('a', '김 첨지', '[사실] 영감은 인력거꾼이다.', 1, aliases=['영감'])]
    got = ps.persona_stats([(cards[0], {1: '영감은 인력거꾼이다.'})])['docs']['identity']
    assert got == {'lines': 1, 'grounded': 1, 'named': 1, 'empty': 0}
    assert ps.persona_stats([(cards[0], {})])['docs']['identity']['grounded'] == 0   # 그 회차 원문이 없으면 근거를 확인할 수 없다
    other = card('x', '복동', '[사실] 복동은 종이다.', 1)
    assert ps.persona_stats([(cards[0], {1: '영감은 인력거꾼이다.'}), (other, {1: '복동은 종이다.'})])['docs']['identity'] == {'lines': 2, 'grounded': 2, 'named': 2, 'empty': 0}   # 작품이 달라도 한꺼번에 센다


def test_coverage_counts_evaluation_names_linked_to_pipeline_cards():
    cards = [card('a', '김 첨지', '[사실] x.', 1), card('b', '치삼', '[사실] y.', 2)]
    assert ps.coverage({'김첨지', '치삼', '개똥이'}, cards) == {'names': 3, 'found': 2, 'rate': 2 / 3}
    assert ps.coverage(set(), cards) == {'names': 0, 'found': 0, 'rate': None}
