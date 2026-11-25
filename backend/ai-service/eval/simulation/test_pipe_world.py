"""파이프라인 평가의 ①→② 연결(pipe_world): Content 적재·읽기 모양 변환, 기준 회차별 관계, 이름으로 인물 카드 잇기, 문항 상태."""

import uuid

import pipe_world as pw
from app.manuscript_extraction.models import Card, CharacterDocs, LoadPayload, Relation


def payload() -> LoadPayload:
    docs = CharacterDocs(soul='[묘사] 성미가 급하다.', goal='[목표] 돈을 번다.', episodes={'00': '[사실] 가난하다.', '02': '[사건] 설렁탕을 사 왔다.'})
    cards = [Card(key='a', cardType='character', title='김 첨지', aliases=['김첨지 영감'], body='[묘사] 김 첨지는 인력거꾼이다.', firstEpisode=1, characterDocs=docs),
             Card(key='b', cardType='character', title='치삼', aliases=[], body='', firstEpisode=2, characterDocs=CharacterDocs(soul='', goal='', episodes={})),
             Card(key='s', cardType='location', title='동소문', aliases=[], body='[묘사] 서울의 문.', firstEpisode=1),
             Card(key='e', cardType='event', title='1화 · 비가 왔다', aliases=[], body='발생: 1화 / 참여: 김 첨지\n[사건] 비가 왔다.', firstEpisode=1)]
    rel = lambda to, label, ep, ended=False: Relation(fromKey='a', toKey=to, label=label, fromEpisode=ep, ended=ended)  # noqa: E731
    return LoadPayload(cards=cards, relations=[rel('b', '친구', 2), rel('b', '친구', 4, True), rel('s', '거주', 1)])


QUOTES = {('a', 'b', '친구', 2): '김 첨지는 치삼과 친구였다.'}


def test_read_at_matches_what_content_stores_and_returns():
    read = pw.read_at('w1', payload(), QUOTES, 3)
    cards = {c['title']: c for c in read['cards']}
    assert read['worldId'] == 'w1' and read['identity'] == []   # 원고 구축은 「동일 인물」 관계를 만들지 않는다(후보만 남긴다)
    a = cards['김 첨지']
    assert (a['body'], a['aliases'], a['cardType'], a['lifecycle'], a['visibility']) == ('[묘사] 김 첨지는 인력거꾼이다.', ['김첨지 영감'], 'character', 'active', 'private')
    # 인물 문서의 회차 키는 정수 글자('00'이 아니라 '0'), 공개 회차(revealFromEpisode)는 정하지 않는다(DEC-53)
    assert a['semanticMetadata'] == {'characterDocs': {'soul': '[묘사] 성미가 급하다.', 'goal': '[목표] 돈을 번다.', 'episodes': {'0': '[사실] 가난하다.', '2': '[사건] 설렁탕을 사 왔다.'}}}
    assert cards['동소문']['semanticMetadata'] == {}   # 인물이 아닌 카드는 문서가 없다
    assert len({c['id'] for c in read['cards']}) == 4 and uuid.UUID(a['id'])
    rel = {r['label']: r for r in read['relationships']}
    assert set(rel) == {'친구', '거주'}   # 친구는 2화에 이어져 4화에 끝난다: 3화에는 이어져 있다
    friend = rel['친구']
    assert (friend['category'], friend['direction'], friend['polarity'], friend['lifecycle'], friend['body']) == ('structural', 'directed', 'asserted', 'active', '김 첨지는 치삼과 친구였다.')
    assert (friend['sourceCardId'], friend['targetCardId']) == (a['id'], cards['치삼']['id']) and rel['거주']['body'] == '거주'   # 근거 인용이 없으면 관계 이름


def test_read_at_can_set_reveal_from_first_episode():
    cards = {c['title']: c for c in pw.read_at('w1', payload(), {}, 3, reveal='first')['cards']}
    assert cards['치삼']['semanticMetadata']['revealFromEpisode'] == 2 and cards['동소문']['semanticMetadata'] == {'revealFromEpisode': 1}


def test_active_relations_follow_start_and_end_like_content():
    rel = lambda ep, ended=False: Relation(fromKey='a', toKey='b', label='친구', fromEpisode=ep, ended=ended)  # noqa: E731
    at = lambda rels, ep: [r.fromEpisode for r in pw.active_relations(rels, ep)]  # noqa: E731
    rels = [rel(2), rel(3), rel(5, True), rel(7)]   # 이미 이어진 관계의 재시작(3)은 건너뛰고, 5에 끝나고, 7에 다시 이어진다
    assert at(rels, 1) == [] and at(rels, 4) == [2] and at(rels, 5) == [] and at(rels, 9) == [7]
    assert at([rel(3, True)], 5) == []   # 시작이 없던 종료는 무시한다


def test_pipeline_world_reads_documents_per_base_episode():
    world = pw.PipelineWorld('w1', payload(), QUOTES)
    w3 = world.world(3)
    a = w3.characters[pw.card_id('w1', 'a')]
    assert (a.text, a.soul, a.goal) == ('[묘사] 김 첨지는 인력거꾼이다.', '[묘사] 성미가 급하다.', '[목표] 돈을 번다.')
    assert a.episodes == {0: '[사실] 가난하다.', 2: '[사건] 설렁탕을 사 왔다.'} and a.revealFromEpisode is None and w3.episode == 3
    assert {r.label for r in w3.snapshot.relations} == {'친구', '거주'} and world.world(3) is w3
    assert {r.label for r in world.world(1).snapshot.relations} == {'거주'} and {r.label for r in world.world(4).snapshot.relations} == {'거주'}


def test_find_character_by_exact_name_or_alias_ignoring_spaces():
    cards = payload().cards
    assert pw.find_character(cards, '김첨지').key == 'a' and pw.find_character(cards, '김첨지 영감').key == 'a'   # 공백 무시, 별칭
    assert pw.find_character(cards, '치삼이') is None and pw.find_character(cards, '동소문') is None   # 표기가 다르면 인물 없음, 인물 카드만 잇는다
    same = [*cards, Card(key='b3', cardType='character', title='치삼', aliases=[], body='', firstEpisode=3)]
    assert pw.find_character(same, '치삼') is None   # 같은 이름 카드가 둘(동명이인)이면 어느 쪽인지 알 수 없다


class Hand:
    """손라벨 코퍼스 대역: 인물(id·이름)과 금지 사실."""

    def people(self, wid):
        return [{'id': 'c1', 'title': '김 첨지', 'aliases': [], 'reveal': 1}, {'id': 'c2', 'title': '치삼', 'aliases': [], 'reveal': 2}, {'id': 'c3', 'title': '개똥이', 'aliases': [], 'reveal': 1}]

    def facts(self, wid, person, ep):
        return [{'id': 'f1'}]


def item(kind, speaker, base):
    return {'work': 'w', 'kind': kind, 'speaker': speaker, 'base': base}


def test_status_explains_why_an_item_cannot_run():
    corpus = pw.PipelineCorpus(Hand(), {'w': pw.PipelineWorld('w1', payload(), {})})
    assert corpus.status(item('dialogue', '김 첨지', 2)) == 'ok'
    assert corpus.status(item('dialogue', '개똥이', 2)) == 'no_character'   # 파이프라인이 만든 카드가 없다
    assert corpus.status(item('dialogue', '치삼', 1)) == 'late_card'   # 카드의 첫 등장 회차(2)가 기준 회차(1)보다 늦다: 인물 문서에 뒤 회차 글이 들어 있다
    assert corpus.status(item('monologue', '치삼', 2)) == 'docs_missing'   # IDENTITY·SOUL이 비어 운영 시뮬레이션이 시작을 거절한다
    assert corpus.status(item('narration', '', 1)) == 'ok'   # 나레이션은 화자 카드가 필요 없다
    assert pw.PipelineCorpus(Hand(), {'w': None}).status(item('narration', '', 1)) == 'world_failed'


def test_status_treats_an_empty_identity_like_a_missing_soul_and_gaps_name_which_document_is_empty():
    # #839: 정체 진술이 없으면 IDENTITY(카드 본문)는 이름으로 채우지 않고 빈 문자열이다. SOUL이 있어도 운영 시뮬레이션은 IDENTITY가 비면 시작을 거절한다.
    soul, none = CharacterDocs(soul='[묘사] 말이 많다.', goal='', episodes={}), CharacterDocs(soul=' ', goal='', episodes={})   # 공백만 있는 SOUL도 빈 문서다(운영 _filled)
    person = lambda key, title, body, docs: Card(key=key, cardType='character', title=title, aliases=[], body=body, firstEpisode=1, characterDocs=docs)  # noqa: E731
    cards = [person('m', '말보', '', soul), person('n', '글보', '[묘사] 글보는 선비다.', soul), person('o', '소울', '[묘사] 소울은 종이다.', none), person('p', '둘다', '', none)]
    corpus = pw.PipelineCorpus(Hand(), {'w': pw.PipelineWorld('w1', LoadPayload(cards=cards, relations=[]), {})})
    status = {name: corpus.status(item('dialogue', name, 2)) for name in ('말보', '글보', '소울', '둘다')}
    assert status == {'말보': 'docs_missing', '글보': 'ok', '소울': 'docs_missing', '둘다': 'docs_missing'}
    assert {name: corpus.gaps(item('dialogue', name, 2)) for name in status} == {'말보': 'IDENTITY', '글보': '', '소울': 'SOUL', '둘다': 'IDENTITY+SOUL'}


def test_corpus_world_maps_hand_label_ids_to_pipeline_card_ids_and_keeps_hand_facts():
    corpus = pw.PipelineCorpus(Hand(), {'w': pw.PipelineWorld('w1', payload(), {})})
    world, ids = corpus.world('w', 2)
    assert ids == {'c1': pw.card_id('w1', 'a'), 'c2': pw.card_id('w1', 'b')} and pw.card_id('w1', 'a') in world.characters   # 개똥이(c3)는 잇지 못했다
    assert corpus.facts('w', None, {}) == [{'id': 'f1'}] and corpus.name == 'public'
