"""문맥 구성 단위 테스트: 원고 조각 나누기·근거 겹침·독립 누설 지표·구성별 문맥(작은 합성 세계관). 소설 원문 없음."""

import pytest

from app.novelbrain.models import Card, Relation, WorldSnapshot
from kt_context import (ALL_CONFIGS, CONFIGS, ITEM_KINDS, K_CTX, LINK_CONFIGS, asked_episode, chunk_episode, item_episode, item_kind, known_cells, linked_cells, overlaps,
                        two_hop_cards, unseen_exposure)


def test_chunk_episode_merges_short_lines_splits_long_ones_and_keeps_all_text():
    lines = [f'짧은 줄 {n}번이다.' for n in range(60)] + ['아주 긴 줄이다. ' * 120]
    chunks = chunk_episode('\n'.join(lines), size=200, ceiling=300)
    assert all(len(c) <= 300 for c in chunks) and len(chunks) > 5
    rejoined = ' '.join(chunks).replace(' ', '')
    assert rejoined == ''.join(lines).replace(' ', '')
    assert chunk_episode('\n\n  \n', 200, 300) == []


def test_overlaps_needs_a_shared_run_of_twelve_characters_or_a_short_evidence_inside_the_quote():
    quote = '그날 밤 철수는 영희에게 오래된 칼을 조용히 건넸다 그리고 떠났다'
    assert overlaps(quote, '철수는 영희에게 오래된 칼을 조용히 건넸다')
    assert overlaps(quote, '앞부분은 다른 문장 영희에게 오래된 칼을 조용히 뒷부분도 다르다')      # 일부만 겹쳐도(12자 이상) 겹침
    assert not overlaps(quote, '전혀 다른 문장이 여기에 길게 적혀 있다')
    assert overlaps('가나다라 마바사', '마바사') and not overlaps('가나다라', '마바사')          # 12자보다 짧은 근거는 통째로 들어 있을 때만


def knowledge():
    return [{'episode': 1, 'events': [{'id': 'E1.1', 'episode': 1, 'summary': 's', 'evidence': '철수는 영희에게 오래된 칼을 조용히 건넸다.',
                                       'participants': [{'name': '철수', 'evidence': 'x'}], 'witnesses': []}], 'learned': []},
            {'episode': 2, 'events': [{'id': 'E2.1', 'episode': 2, 'summary': 's', 'evidence': '영희는 홀로 남아 오랫동안 울었다고 한다.',
                                       'participants': [{'name': '영희', 'evidence': 'x'}], 'witnesses': []}], 'learned': []}]


def test_unseen_exposure_flags_excerpts_of_events_the_character_missed_or_that_are_in_the_future():
    k = knowledge()
    chunk_episode_of = {'w:1:0': 1, 'w:2:0': 2}
    by_episode = {1: k[0]['events'], 2: k[1]['events']}
    row = {'character': '영희', 'cutoff': 1}
    seen_by_other = [{'ref': 'manuscript:w:1:0', 'text': '그날 밤 철수는 영희에게 오래된 칼을 조용히 건넸다. 그리고 떠났다.'}]
    assert unseen_exposure(seen_by_other, row, k, chunk_episode_of, by_episode)                 # 영희가 참여·목격하지 않은 1화 사건
    assert not unseen_exposure(seen_by_other, {**row, 'character': '철수'}, k, chunk_episode_of, by_episode)   # 철수는 거기 있었다
    future = [{'ref': 'manuscript:w:2:0', 'text': '영희는 홀로 남아 오랫동안 울었다고 한다. 밤이 깊었다.'}]
    assert unseen_exposure(future, row, k, chunk_episode_of, by_episode)                        # 기준 회차(1) 뒤 사건은 본인이 참여해도 미래다
    assert not unseen_exposure([{'ref': 'card:c1#ep01', 'text': '철수는 영희에게 오래된 칼을 조용히 건넸다.'}], row, k, chunk_episode_of, by_episode)   # 원고 발췌만 본다


def test_item_episode_reads_manuscript_relation_memory_and_reveal_episodes():
    lookup = {'chunk': {'w:3:1': 3}, 'when': {'r1': 2}, 'reveal': {'c1': 1, 'e04-1': 4}}
    assert item_episode('manuscript:w:3:1', lookup) == 3 and item_episode('relation:r1', lookup) == 2
    assert item_episode('card:c1#ep05', lookup) == 5 and item_episode('card:c1#identity', lookup) == 1
    assert item_episode('card:e04-1', lookup) == 4 and item_episode('card:zz', lookup) is None
    assert item_episode('card:x001#cell07', lookup) == 7                                                                   # 인물이 아닌 카드의 회차 칸도 그 회차


def test_build_contexts_make_every_configuration_and_the_filter_removes_future_material():
    np = pytest.importorskip('numpy')
    from kt_context import contexts_for
    from kt_world import WChar, WEvent, WorldOut, build_world, validate_world

    texts = {1: '철수는 영희에게 칼을 건넸다. 영희는 말없이 받았다.', 2: '철수는 먼 길을 떠났다. 영희는 홀로 남았다.'}
    ep1, _ = validate_world(texts[1], WorldOut(characters=[WChar(name='철수', role='검객', memory='철수는 칼을 건넸다.'), WChar(name='영희', role='처녀', memory='영희는 칼을 받았다.')],
                                               events=[WEvent(title='칼의 전달', summary='철수가 영희에게 칼을 건넸다.', participants=['철수', '영희'])], relations=[]))
    ep2, _ = validate_world(texts[2], WorldOut(characters=[WChar(name='철수', role='', memory='철수는 먼 길을 떠났다.')],
                                               events=[WEvent(title='이별', summary='철수가 먼 길을 떠났다.', participants=['철수'])], relations=[]))
    world = build_world('w', {1: ep1, 2: ep2}, {})
    chunks = [{'id': 'w:1:0', 'episode': 1, 'text': texts[1]}, {'id': 'w:2:0', 'episode': 2, 'text': texts[2]}]
    data = {'chunks': chunks, 'vectors': np.array([[1.0, 0.0], [0.0, 1.0]], dtype=np.float32), 'world': world}
    row = {'idx': 0, 'work': 'w', 'character': '영희', 'cutoff': 1, 'question': '철수가 먼 길을 떠났다는 걸 아나요?', 'data_type': 'future'}
    out = contexts_for(row, data, knowledge(), np.array([0.0, 1.0], dtype=np.float32))
    assert set(out) == set(ALL_CONFIGS) and out['zero']['items'] == []
    assert all(len(c['items']) <= K_CTX for c in out.values())
    assert out['vector']['future'] and any('먼 길을 떠났다' in i['text'] for i in out['vector']['items'])    # 벡터만: 미래 발췌가 그대로 들어온다
    assert not out['s3']['future'] and all('이별' not in i['text'] for i in out['s3']['items'])             # 필터: 기준 회차 뒤는 없다


def test_a_character_without_a_card_gets_an_empty_context_in_every_configuration_instead_of_failing():
    from kt_context import contexts_for

    row = {'idx': 0, 'work': 'w', 'character': '영희', 'cutoff': 1, 'question': '철수가 떠났다는 걸 아나요?', 'event_episode': 2}
    out = contexts_for(row, {'world': {'character_id': {'철수': 'c001'}}}, [], None)             # 이 세계관에는 영희 카드가 없다(전처리가 못 만들었다)
    assert set(out) == set(ALL_CONFIGS) and all(c == {'items': [], 'future': False, 'foreign': False, 'unseen': False, 'asked_ep': False} for c in out.values())
    assert contexts_for({k: v for k, v in row.items() if k != 'event_episode'}, {'world': {'character_id': {}}}, [], None)['s3']['asked_ep'] is None


def test_the_established_configurations_stay_the_defaults_of_kt_run_and_the_link_variants_come_on_top():
    assert CONFIGS == ('zero', 'ppr', 'vector', 'bm25', 's1', 's2', 's3', 'no_graph', 'no_vector', 'no_bm25')    # kt_run의 기본 구성·집계 구성은 그대로
    assert LINK_CONFIGS == ('link_bm25', 'link_ppr', 'link2_bm25', 'link_cells', 'link_known')


def card(card_id, card_type, reveal=None):
    return Card(id=card_id, cardType=card_type, title=card_id, text=f'{card_id} 본문', revealFromEpisode=reveal)


def link(relation_id, source, target, polarity='asserted'):
    return Relation(id=relation_id, source=source, target=target, label='관계', direction='directed', polarity=polarity)


def test_two_hop_cards_walk_asserted_relations_both_ways_and_keep_only_revealed_non_character_cards():
    cards = [card('A', 'character', 1), card('B', 'character', 1), card('C', 'character', 1), card('D', 'character', 1), card('E1', 'event', 1),
             card('E2', 'event', 2), card('E3', 'event', 5), card('L', 'location'), card('E4', 'event', 1), card('E5', 'event', 1), card('X', 'event', 1)]
    relations = [link('r1', 'A', 'B'), link('r2', 'A', 'E1'), link('r3', 'B', 'E2'), link('r4', 'B', 'E3'), link('r5', 'B', 'L'),
                 link('r6', 'C', 'B'), link('r7', 'C', 'E4'), link('r8', 'A', 'D', 'denied'), link('r9', 'D', 'E5')]
    snap = WorldSnapshot(worldId='w', episode=3, cards=cards, relations=relations)
    # A: 1홉 E1, B를 거친 2홉 E2·L. E3은 공개 전(5화), E4는 3홉(A-B-C-E4), E5는 부정 관계(A-D) 너머, X는 연결 없음, 인물 B·C·D는 넓히지 않는다
    assert two_hop_cards(snap, 'A', 3) == {'E1', 'E2', 'L'}
    assert two_hop_cards(snap, 'B', 3) == {'E1', 'E2', 'L', 'E4'}          # 관계는 방향 없이 걷는다(A→B·C→B도 B에서 걸린다)
    assert two_hop_cards(snap, 'B', 5) == {'E1', 'E2', 'E3', 'L', 'E4'}    # 공개 회차가 지나면 들어온다


def test_item_kind_names_the_six_context_item_kinds_and_asked_episode_counts_only_event_cards_and_excerpts_of_that_episode():
    refs = ['card:c1#identity', 'card:c1#soul', 'card:c1#goal', 'card:c1#ep03', 'card:e03-1', 'relation:r1', 'manuscript:w:3:1', 'card:x001#cell03']
    assert [item_kind(r) for r in refs] == ['identity', 'identity', 'identity', 'memory', 'event', 'relation', 'manuscript', 'cell']      # cell = 인물이 아닌 카드의 회차 칸(link_cells만)
    assert set(ITEM_KINDS) == {item_kind(r) for r in refs} and len(ITEM_KINDS) == 6
    lookup = {'chunk': {'w:3:1': 3, 'w:2:0': 2}, 'when': {'r1': 3}, 'reveal': {'c1': 1, 'e03-1': 3, 'e02-1': 2}}

    def items(*names):
        return [{'ref': n, 'text': 't'} for n in names]

    assert asked_episode(items('manuscript:w:3:1'), lookup, 3) and asked_episode(items('card:e03-1'), lookup, 3)          # 같은 회차의 원고 발췌·사건 카드
    assert not asked_episode(items('card:e02-1', 'manuscript:w:2:0'), lookup, 3)                                           # 다른 회차
    assert not asked_episode(items('card:c1#ep03', 'card:c1#identity', 'relation:r1'), lookup, 3)                          # 회차 기억·인물 본문·관계는 세지 않는다(3화로 적혀 있어도)
    assert not asked_episode([], lookup, 3)


def test_link_configs_pick_from_cards_connected_to_the_character_and_the_two_leg_variant_adds_events_of_related_people():
    np = pytest.importorskip('numpy')
    from kt_context import contexts_for
    from kt_world import WChar, WEvent, WRel, WorldOut, build_world, validate_world

    text = '철수는 영희에게 칼을 건넸다. 영희는 말없이 받았다. 철수는 홀로 검술을 연마했다.'
    episode_1, _ = validate_world(text, WorldOut(
        characters=[WChar(name='철수', role='검객', memory='철수는 칼을 건넸다.'), WChar(name='영희', role='처녀', memory='영희는 칼을 받았다.')],
        events=[WEvent(title='칼의 전달', summary='철수가 영희에게 칼을 건넸다.', participants=['철수', '영희']),
                WEvent(title='검술 수련', summary='철수가 홀로 검술을 연마했다.', participants=['철수'])],
        relations=[WRel(source='철수', target='영희', label='스승')]))
    world = build_world('w', {1: episode_1}, {})                      # 카드: 영희 c001·철수 c002·사건 e01-1(칼의 전달)·e01-2(검술 수련 = 영희 없이 철수 혼자)
    data = {'chunks': [{'id': 'w:1:0', 'episode': 1, 'text': text}], 'vectors': np.array([[1.0, 0.0]], dtype=np.float32), 'world': world}
    row = {'idx': 0, 'work': 'w', 'character': '영희', 'cutoff': 1, 'question': '철수가 홀로 검술을 연마했다는 걸 아나요?', 'data_type': 'future', 'event_episode': 1}
    vector = np.array([1.0, 0.0], dtype=np.float32)
    out = contexts_for(row, data, knowledge(), vector)
    refs = {c: [i['ref'] for i in out[c]['items']] for c in ALL_CONFIGS}
    assert set(refs['link_bm25']) == {'card:e01-1', 'card:c002#identity'}      # 영희와 직접 연결된 카드 안에서 질문 낱말로: 철수의 인물 본문·함께한 사건. 영희와 연결 없는 사건(e01-2)·철수의 회차 기억은 없다
    assert set(refs['link2_bm25']) == set(refs['link_bm25']) | {'card:e01-2'} and refs['link2_bm25'][0] == 'card:e01-2'   # 영희-철수-검술 수련 두 다리까지: 사건이 들어오고 순위는 카드 BM25
    assert 'card:c002#ep01' not in refs['link2_bm25']                                                                  # 다른 인물의 기억 문서는 넓히지 않는다
    assert set(refs['link_ppr']) == {'card:c001#identity', 'card:c002#identity', 'card:e01-1', 'relation:r01-1', 'relation:p-e01-1-c001'}   # 그래프 가까운 순, 영희의 관계만
    assert not any(r.startswith('manuscript:') for c in LINK_CONFIGS for r in refs[c])                                   # 벡터(원고 발췌) 없음
    assert not any(out[c]['future'] or out[c]['foreign'] or out[c]['unseen'] for c in LINK_CONFIGS)
    assert [out[c]['asked_ep'] for c in ('zero', 'link_bm25', 'link_ppr', 'link2_bm25', 'vector')] == [False, True, True, True, True]   # 1화 사건 카드·원고 발췌가 문맥에 있는가
    later = contexts_for({**row, 'event_episode': 2}, data, knowledge(), vector)
    assert {ctx['asked_ep'] for ctx in later.values()} == {False}                                                         # 2화 항목은 어디에도 없다
    plain = contexts_for({k: v for k, v in row.items() if k != 'event_episode'}, data, knowledge(), vector)
    assert {ctx['asked_ep'] for ctx in plain.values()} == {None}                                                          # event_episode가 없는 행(일반 질문)은 재지 않는다


def test_unseen_exposure_also_checks_the_quotes_behind_a_cell_against_the_events_of_the_episode_the_cell_is_from():
    k = knowledge()
    by_episode = {1: k[0]['events'], 2: k[1]['events']}
    items = [{'ref': 'card:x001#cell01', 'text': '장터: 어떤 설명이다.'}]
    quotes = {'card:x001#cell01': ['그날 밤 철수는 영희에게 오래된 칼을 조용히 건넸다 그리고 떠났다']}
    row = {'character': '영희', 'cutoff': 1}
    assert unseen_exposure(items, row, k, {}, by_episode, quotes)                                                   # 영희가 없던 1화 사건의 근거 문장이 칸의 근거 인용과 겹친다
    assert not unseen_exposure(items, {**row, 'character': '철수'}, k, {}, by_episode, quotes)                      # 철수는 거기 있었다
    assert not unseen_exposure(items, row, k, {}, by_episode) and not unseen_exposure(items, row, k, {}, by_episode, {'card:x001#cell01': ['전혀 다른 문장이 여기에 길게 적혀 있다']})


def tie(relation_id, source, target):
    return Relation(id=relation_id, source=source, target=target, label='관련', direction='directed')


def test_linked_cells_are_the_cells_of_non_character_cards_tied_to_an_event_the_character_is_linked_to_up_to_the_asked_episode():
    def with_cells(c, **cells):
        return c.model_copy(update={'episodes': {int(n[1:]): text for n, text in cells.items()}})

    cards = [card('A', 'character', 1), card('B', 'character', 1), card('C', 'character', 1), card('E1', 'event', 1), card('E3', 'event', 1), card('E4', 'event', 1),
             with_cells(card('L', 'location', 1), n1='L 1화 칸', n3='L 3화 칸'), with_cells(card('M', 'location', 1), n1='M 칸'), with_cells(card('N', 'location', 1), n1='N 칸'),
             with_cells(card('P', 'location', 1), n1='  '), with_cells(card('C2', 'character', 1), n1='인물 칸')]
    relations = [link('r1', 'A', 'E1'), link('r2', 'B', 'E3'), link('r3', 'A', 'E4', 'denied'), tie('t1', 'L', 'E1'), tie('t2', 'M', 'E3'), tie('t3', 'N', 'E4'), tie('t4', 'P', 'E1'),
                 tie('t5', 'C2', 'E1')]
    snap = WorldSnapshot(worldId='w', episode=3, cards=cards, relations=relations)
    assert linked_cells(snap, 'A', 2) == {'card:L#cell01': ('L', 'L 1화 칸')}                                         # M은 B의 사건에만, N은 부정 관계 너머, P는 빈 칸, 인물 카드의 칸은 넣지 않는다, 3화 칸은 질문 시점 뒤
    assert set(linked_cells(snap, 'A', 3)) == {'card:L#cell01', 'card:L#cell03'} and set(linked_cells(snap, 'B', 3)) == {'card:M#cell01'}
    assert linked_cells(snap, 'C', 3) == {}                                                                          # 사건과 이어지지 않은 인물은 후보가 없다


def test_link_cells_adds_only_the_cells_of_cards_tied_to_the_characters_events_and_leaves_link_bm25_as_it_was():
    np = pytest.importorskip('numpy')
    from kt_context import contexts_for

    cards = [Card(id='c001', cardType='character', title='영희', text='마을 처녀', revealFromEpisode=1),
             Card(id='e01-1', cardType='event', title='칼의 전달', text='철수가 영희에게 칼을 건넸다.', revealFromEpisode=1),
             Card(id='x001', cardType='location', title='장터', text='장터', revealFromEpisode=1, episodes={1: '장터에는 대장간이 있다.', 3: '장터가 불탔다.'})]
    relations = [Relation(id='a', source='c001', target='e01-1', label='겪음', direction='directed'), tie('b', 'x001', 'e01-1')]

    def world(cs):
        return {'series': 'w', 'cards': cs, 'relations': relations, 'when': {'a': 1, 'b': 1}, 'character_id': {'영희': 'c001'}, 'title': {c.id: c.title for c in cs},
                'cell_quotes': {'x001': {'1': ['그날 밤 철수는 영희에게 오래된 칼을 조용히 건넸다 그리고 떠났다']}}}

    chunks = [{'id': 'w:1:0', 'episode': 1, 'text': '장터에는 대장간이 있다.'}]
    row = {'idx': 0, 'work': 'w', 'character': '영희', 'cutoff': 2, 'question': '장터에 대장간이 있나요?', 'event_episode': 1}

    def run(cs):
        data = {'chunks': chunks, 'vectors': np.array([[1.0, 0.0]], dtype=np.float32), 'world': world(cs)}
        return contexts_for(row, data, knowledge(), np.array([1.0, 0.0], dtype=np.float32))

    cells, plain = run(cards), run([c.model_copy(update={'episodes': {}}) if c.id == 'x001' else c for c in cards])
    refs = {name: {c: [i['ref'] for i in out[c]['items']] for c in ALL_CONFIGS} for name, out in (('cells', cells), ('plain', plain))}
    assert 'card:x001#cell01' in refs['cells']['link_cells'] and 'card:x001#cell03' not in refs['cells']['link_cells']       # 3화 칸은 질문 시점(2화) 뒤
    assert [i['text'] for i in cells['link_cells']['items'] if i['ref'] == 'card:x001#cell01'] == ['장터: 장터에는 대장간이 있다.']   # 칸 글 앞에 카드 이름을 붙인다
    assert not any('#cell' in ref for c in ALL_CONFIGS if c != 'link_cells' for ref in refs['cells'][c])                      # 다른 구성은 칸을 보지 않는다
    assert refs['cells']['link_bm25'] == refs['plain']['link_bm25'] == refs['plain']['link_cells']                            # 칸이 없으면 link_cells = link_bm25
    assert not cells['link_cells']['future'] and not cells['link_cells']['foreign'] and cells['link_cells']['unseen']        # 칸의 근거 인용이 영희가 모를 1화 사건의 근거 문장과 겹친다(누설 지표가 잡는다)
    assert not cells['link_bm25']['unseen']


def test_known_cells_keep_only_the_cell_sentences_whose_quote_is_inside_a_quote_of_an_event_the_character_is_linked_to():
    cards = [card('A', 'character', 1), card('E1', 'event', 1), card('E2', 'event', 1),
             card('L', 'location', 1).model_copy(update={'episodes': {1: '첫 문장이다. 둘째 문장이다. 셋째 문장이다.', 2: '다른 회차 문장이다.'}})]
    relations = [link('r1', 'A', 'E1'), tie('t1', 'L', 'E1'), tie('t2', 'L', 'E2')]
    snap = WorldSnapshot(worldId='w', episode=2, cards=cards, relations=relations)
    world = {'events': {'E1': {'quote': '철수는 영희에게 오래된 칼을 조용히 건넸다.'}, 'E2': {'quote': '아무도 모르는 다른 사건의 문장이다 정말로.'}},
             'cell_sentences': {'L': {'1': ['첫 문장이다.', '둘째 문장이다.', '셋째 문장이다.'], '2': ['다른 회차 문장이다.']}},
             'cell_quotes': {'L': {'1': ['영희에게 오래된 칼을 조용히', '아무도 모르는 다른 사건의 문장이다 정말로', '철수는 영희에게 오래된 칼을 조용히 건넸다. 그리고 떠났다'], '2': ['철수는 영희에게 오래된 칼을 조용히 건넸다.']}}}
    quotes = world['cell_quotes']['L']
    assert known_cells(world, snap, 'A', 2) == {'card:L#cell01': ('L', ['첫 문장이다.', '셋째 문장이다.'], [quotes['1'][0], quotes['1'][2]]),
                                                'card:L#cell02': ('L', ['다른 회차 문장이다.'], quotes['2'])}      # 인용이 아는 사건(E1)의 인용 안에 있거나 그 인용을 품은 문장만(E2는 인물이 모르는 사건)
    assert set(linked_cells(snap, 'A', 2)) == {'card:L#cell01', 'card:L#cell02'} and set(known_cells(world, snap, 'A', 1)) == {'card:L#cell01'}   # 후보 규칙은 link_cells와 같다(기준 회차 뒤 칸 없음)
    assert known_cells({**world, 'cell_sentences': {}}, snap, 'A', 2) == {} and known_cells({'events': {}}, snap, 'A', 2) == {}               # 문장·인용 기록이 없으면 후보가 없다


def test_link_known_shows_only_the_cell_sentences_the_character_can_know_and_its_unseen_check_uses_only_their_quotes():
    np = pytest.importorskip('numpy')
    from kt_context import contexts_for

    cards = [Card(id='c001', cardType='character', title='영희', text='마을 처녀', revealFromEpisode=1),
             Card(id='e01-1', cardType='event', title='칼의 전달', text='철수가 영희에게 칼을 건넸다.', revealFromEpisode=1),
             Card(id='x001', cardType='location', title='장터', text='장터', revealFromEpisode=1, episodes={1: '장터에는 대장간이 있다. 장터에서 아무도 모를 일이 있었다.'})]
    relations = [Relation(id='a', source='c001', target='e01-1', label='겪음', direction='directed'), tie('b', 'x001', 'e01-1')]
    seen_quote, unseen_quote = '장터에는 대장간이 있다 그리고 사람이 많다', '그날 밤 철수는 영희에게 오래된 칼을 조용히 건넸다 그리고 떠났다'
    world = {'series': 'w', 'cards': cards, 'relations': relations, 'when': {'a': 1, 'b': 1}, 'character_id': {'영희': 'c001'}, 'title': {c.id: c.title for c in cards},
             'events': {'e01-1': {'quote': seen_quote}},
             'cell_sentences': {'x001': {'1': ['장터에는 대장간이 있다.', '장터에서 아무도 모를 일이 있었다.']}}, 'cell_quotes': {'x001': {'1': [seen_quote, unseen_quote]}}}
    data = {'chunks': [{'id': 'w:1:0', 'episode': 1, 'text': '장터에는 대장간이 있다.'}], 'vectors': np.array([[1.0, 0.0]], dtype=np.float32), 'world': world}
    row = {'idx': 0, 'work': 'w', 'character': '영희', 'cutoff': 2, 'question': '장터에 대장간이 있나요?', 'event_episode': 1}
    out = contexts_for(row, data, knowledge(), np.array([1.0, 0.0], dtype=np.float32))
    text = {c: [i['text'] for i in out[c]['items'] if i['ref'] == 'card:x001#cell01'] for c in ('link_cells', 'link_known')}
    assert text['link_cells'] == ['장터: 장터에는 대장간이 있다. 장터에서 아무도 모를 일이 있었다.'] and text['link_known'] == ['장터: 장터에는 대장간이 있다.']   # 아는 사건의 인용에 기댄 문장만
    assert out['link_cells']['unseen'] and not out['link_known']['unseen']                                           # link_cells는 영희가 모를 1화 사건의 근거 문장과 겹치는 인용이 있고 link_known은 그 문장을 뺐다
    assert not out['link_known']['future'] and not out['link_known']['foreign']
