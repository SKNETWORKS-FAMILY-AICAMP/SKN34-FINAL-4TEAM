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


SOURCES = {1: '김 첨지는 인력거꾼이다. 그는 성미가 급하다. 아내는 병들었다.', 2: '치삼은 오래된 친구였다.'}


def test_persona_stats_checks_each_document_line_against_the_source():
    cards = [card('a', '김 첨지', '[사실] 김 첨지는 인력거꾼이다.' + chr(10) + '[묘사] 원문에 없는 문장이다.', 1, soul='[묘사] 그는 성미가 급하다.', episodes={'00': '[사실] 김 첨지는 인력거꾼이다.'}),
             card('b', '치삼', '', 2, episodes={'02': '[사건] 치삼은 오래된 친구였다.'}), card('c', '아내', '[사실] 아내는 병들었다.', 1)]
    got = ps.persona_stats([(c, SOURCES) for c in cards])
    assert got['characters'] == 3 and got['ready'] == 1   # IDENTITY·SOUL이 모두 줄로 있는 인물만(치삼은 IDENTITY가 빈 문자열·SOUL 없음, 아내는 SOUL 없음)
    assert got['docs']['identity'] == {'lines': 3, 'grounded': 2, 'named': 2, 'empty': 1}   # 한 줄은 원문에 없고, 치삼은 줄이 없다
    assert got['docs']['soul'] == {'lines': 1, 'grounded': 1, 'named': 0, 'empty': 2}   # 이름 없이 '그는'으로 쓴 줄은 근거는 있어도 named가 아니다
    assert got['docs']['goal'] == {'lines': 0, 'grounded': 0, 'named': 0, 'empty': 3}
    assert got['docs']['memory'] == {'lines': 2, 'grounded': 2, 'named': 2, 'empty': 1}   # 00은 첫 등장 회차 원문, 02는 2화 원문에서 찾는다


def test_persona_stats_finds_soul_quotes_in_the_first_and_later_episodes_only():
    # #839: SOUL은 첫 등장 회차뿐 아니라 뒤 회차의 soul 진술까지 쌓는다. IDENTITY·GOAL은 첫 등장 회차의 글만이다.
    soul = '[묘사] 그는 성미가 급하다.' + chr(10) + '[묘사] 치삼은 오래된 친구였다.' + chr(10) + '[묘사] 원문에 없는 문장이다.'
    first_one = card('a', '김 첨지', '[사실] 치삼은 오래된 친구였다.', 1, soul=soul, goal='[목표] 치삼은 오래된 친구였다.')
    got = ps.persona_stats([(first_one, SOURCES)])['docs']
    assert got['soul'] == {'lines': 3, 'grounded': 2, 'named': 0, 'empty': 0}   # 첫 등장 회차(1화)와 뒤 회차(2화)의 글은 근거이고 원문에 없는 줄은 아니다
    assert got['identity']['grounded'] == 0 and got['goal']['grounded'] == 0   # 같은 줄이라도 IDENTITY·GOAL은 첫 등장 회차(1화)에서만 찾는다
    later = card('b', '치삼', '[사실] 치삼은 오래된 친구였다.', 2, soul='[묘사] 그는 성미가 급하다.')
    assert ps.persona_stats([(later, SOURCES)])['docs']['soul']['grounded'] == 0   # 첫 등장(2화)보다 앞 회차(1화)의 글은 SOUL의 근거가 될 수 없다


def test_soul_future_reads_a_quote_with_line_breaks_as_one_line():
    # 인용에 개행이 있으면 표지 없이 이어지는 물리 줄이 생긴다: 첫 줄만 앞 회차에 있어도 전체 인용은 뒤 회차에만 있다(파이프라인 검증도 원문 그대로 나온 인용만 통과시킨다)
    sources = {1: '그는 웃었다.', 2: '그는 웃었다.' + chr(10) + '아무도 믿지 않았다.'}
    who = card('a', '김 첨지', '[사실] x.', 1, soul='[묘사] 그는 웃었다.' + chr(10) + '아무도 믿지 않았다.')
    assert ps.soul_future(who, sources, 1) == (1, 1) and ps.soul_future(who, sources, 2) == (1, 0)


def test_persona_stats_checks_a_quote_with_line_breaks_as_a_whole():
    good, bad = card('a', '김 첨지', '[사실] 김 첨지는' + chr(10) + '인력거꾼이다.', 1), card('b', '치삼', '[사실] 치삼은' + chr(10) + '거짓말쟁이다.', 1)
    sources = {1: '김 첨지는' + chr(10) + '인력거꾼이다. 치삼은 사람이다.'}
    assert ps.persona_stats([(good, sources), (bad, sources)])['docs']['identity'] == {'lines': 2, 'grounded': 1, 'named': 2, 'empty': 0}   # 개행이 있어도 한 줄이고 인용 전체가 원문에 있어야 근거다


def test_soul_future_counts_lines_found_only_in_episodes_after_the_base_episode():
    # #839: SOUL은 회차 차원 없이 뒤 회차의 soul 진술까지 쌓는다. 기준 회차(base)까지의 원문에 없는 줄은 기준 회차 뒤에 드러난 성격·말투다.
    sources = {1: '그는 성미가 급하다.', 2: '치삼은 오래된 친구였다.', 3: '그는 말이 없다.'}
    soul = '표지 없는 앞머리' + chr(10) + '[묘사] 그는 성미가 급하다.' + chr(10) + '[묘사] 치삼은 오래된 친구였다.' + chr(10) + '[묘사] 그는 말이 없다.'
    who = card('a', '김 첨지', '[사실] x.', 1, soul=soul)
    assert [ps.soul_future(who, sources, base) for base in (1, 2, 3)] == [(3, 2), (3, 1), (3, 0)]   # 표지로 시작하지 않는 앞머리는 줄이 아니다
    assert ps.soul_future(card('b', '치삼', '[사실] x.', 1, soul=''), sources, 1) == (0, 0)


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
