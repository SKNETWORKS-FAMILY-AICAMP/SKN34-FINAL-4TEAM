import unicodedata

import pytest
from pydantic import ValidationError

from app.manuscript.models import Excerpt
from app.novelbrain.models import Card, Gap, RecallItem, Relation, WorldSnapshot
from app.novelbrain.service import bm25_rank, filter_for_character, ppr, recall, rrf, seed_cards, tokenize

KAEL = Card(id='kael', cardType='character', title='카엘', text='성문 수비대장이다.', soul='말투는 건조하고 짧다.', memory='리라의 오빠다.',
            episodes={1: '1화: 성문에서 리라를 만났다.', 3: '3화: 왕의 비밀을 알게 되었다.'}, revealFromEpisode=1)
LIRA = Card(id='lira', cardType='character', title='리라', text='마법사 견습생이다.', soul='활달하게 말한다.',
            memory='카엘의 동생이다. 왕의 사생아라는 비밀이 있다.', episodes={2: '2화: 비밀 문서를 훔쳤다.'}, revealFromEpisode=1)
SERA = Card(id='sera', cardType='character', title='세라', text='떠돌이 상인이다.', soul='능글맞게 말한다.', memory='리라와 거래한다.',
            revealFromEpisode=2)
GATE = Card(id='gate', cardType='location', title='성문', text='북쪽 성문이다. 밤에는 닫힌다.')
CROWN = Card(id='crown', cardType='object', title='왕관', text='왕의 비밀과 얽힌 왕관이다.', revealFromEpisode=5)
RELATIONS = [Relation(id='r-kl', source='kael', target='lira', label='남매', direction='symmetric'),
             Relation(id='r-kg', source='kael', target='gate', label='근무지', direction='directed'),
             Relation(id='r-ls', source='lira', target='sera', label='거래', direction='directed'),
             Relation(id='r-lc', source='lira', target='crown', label='훔침', direction='directed')]
WORLD = WorldSnapshot(worldId='w1', episode=2, cards=[KAEL, LIRA, SERA, GATE, CROWN], relations=RELATIONS)
M1 = Excerpt(id='m1', episode=1, quote='카엘이 성문 앞에서 리라를 불러 세웠다.')
M2 = Excerpt(id='m2', episode=2, quote='리라가 비밀 문서를 품에 숨겼다.')
M3 = Excerpt(id='m3', episode=3, quote='카엘은 왕의 비밀을 알아챘다.')


def item(ref, text='x', rank=1, source='bm25'):
    return RecallItem(ref=ref, source=source, text=text, rank=rank, score=1.0)


def refs(items):
    return [i.ref for i in items]


def with_card(world, id, **update):
    return world.model_copy(update={'cards': [c.model_copy(update=update) if c.id == id else c for c in world.cards]})


# --- tokenize -----------------------------------------------------------------------------------------------------------

def test_tokenize_lowercases_english_words_and_drops_punctuation():
    assert tokenize('Kael met LIRA, again!') == ['kael', 'met', 'lira', 'again']


def test_tokenize_keeps_each_korean_word_and_adds_syllable_bigrams_for_particles():
    assert tokenize('카엘이 말했다') == ['카엘이', '카엘', '엘이', '말했다', '말했', '했다']
    assert tokenize('카엘') == ['카엘']
    assert tokenize('왕') == ['왕']


def test_tokenize_splits_latin_from_hangul_and_normalizes_decomposed_hangul():
    assert tokenize('Kael이 왔다') == ['kael', '이', '왔다']
    assert tokenize(unicodedata.normalize('NFD', '카엘이')) == ['카엘이', '카엘', '엘이']


def test_tokenize_of_blank_text_is_empty():
    assert tokenize('  \n ') == []


# --- bm25_rank ----------------------------------------------------------------------------------------------------------

def test_bm25_ranks_an_exact_proper_noun_first_and_leaves_out_non_matches():
    docs = [('a', '리라는 마법사 견습생이다.'), ('b', '카엘은 성문을 지키는 수비대장이다.'), ('c', '성문 앞에 눈이 내린다.')]

    assert [ref for ref, _ in bm25_rank('카엘', docs)] == ['b']


def test_bm25_matches_a_korean_name_followed_by_particles():
    docs = [('a', '카엘이 칼을 들었다.'), ('b', '카엘에게 편지가 왔다.'), ('c', '리라가 웃었다.')]

    ranked = bm25_rank('카엘의 편지', docs)

    assert [ref for ref, _ in ranked] == ['b', 'a']
    assert ranked[0][1] > ranked[1][1] > 0


def test_bm25_weights_a_rare_term_above_a_term_most_documents_have():
    # 흔한 낱말을 네 번 되풀이한 문서보다 희귀한 낱말이 한 번 나온 문서가 앞선다(idf가 상수면 뒤집힌다).
    docs = [('a', '성문 성문 성문 성문'), ('b', '용사 마을'), ('c', '성문 마을'), ('d', '성문 검')]

    assert bm25_rank('성문 용사', docs)[0][0] == 'b'


def test_bm25_prefers_the_shorter_document_for_the_same_term_frequency():
    docs = [('long', '카엘 ' + '리라 ' * 30), ('short', '카엘')]

    assert [ref for ref, _ in bm25_rank('카엘', docs)] == ['short', 'long']


def test_bm25_keeps_input_order_for_equal_scores_and_returns_descending_scores():
    docs = [('a', '카엘'), ('b', '카엘'), ('c', '카엘 카엘 카엘 성문')]

    ranked = bm25_rank('카엘', docs)

    assert [s for _, s in ranked] == sorted((s for _, s in ranked), reverse=True)
    assert [ref for ref, _ in ranked if ref != 'c'] == ['a', 'b']


@pytest.mark.parametrize('query,docs', [('', [('a', '카엘')]), ('카엘', []), ('카엘', [('a', ''), ('b', '  ')])])
def test_bm25_with_nothing_to_match_is_empty(query, docs):
    assert bm25_rank(query, docs) == []


# --- ppr ----------------------------------------------------------------------------------------------------------------

CHAIN = ['a', 'b', 'c', 'd']
CHAIN_EDGES = [('a', 'b'), ('b', 'c'), ('c', 'd')]


def test_ppr_scores_fall_with_distance_from_the_seed_and_sum_to_one():
    scores = ppr(CHAIN, CHAIN_EDGES, {'a': 1})

    assert scores['a'] > scores['b'] > scores['c'] > scores['d'] > 0
    assert sum(scores.values()) == pytest.approx(1)


def test_ppr_a_node_two_relations_away_beats_a_node_with_no_relation_at_all():
    scores = ppr(['a', 'b', 'c', 'x'], [('a', 'b'), ('b', 'c')], {'a': 1})

    assert scores['c'] > scores['x'] == 0


def test_ppr_damping_is_the_chance_of_following_a_relation():
    near = ppr(CHAIN, CHAIN_EDGES, {'a': 1}, damping=0.5)
    far = ppr(CHAIN, CHAIN_EDGES, {'a': 1}, damping=0.9)

    assert far['d'] > near['d'] and far['a'] < near['a']


def test_ppr_walks_a_directed_relation_in_both_directions():
    assert ppr(['a', 'b'], [('a', 'b')], {'b': 1})['a'] > 0


def test_ppr_normalizes_seed_weights():
    scores = ppr(['a', 'b'], [('a', 'b')], {'a': 3, 'b': 1})

    assert scores['a'] > scores['b']
    assert sum(scores.values()) == pytest.approx(1)


def test_ppr_keeps_probability_mass_when_the_seed_has_no_relations():
    scores = ppr(['a', 'x'], [], {'a': 1})

    assert scores == {'a': pytest.approx(1), 'x': 0}


@pytest.mark.parametrize('nodes,edges,seeds', [
    (['a', 'b'], [('a', 'b')], {}),
    (['a', 'b'], [('a', 'b')], {'zz': 1}),
    (['a', 'b'], [('a', 'b')], {'a': 0}),
    ([], [], {'a': 1}),
])
def test_ppr_without_a_usable_seed_is_empty(nodes, edges, seeds):
    assert ppr(nodes, edges, seeds) == {}


def test_ppr_ignores_relations_to_unknown_nodes_and_self_loops():
    plain = ppr(CHAIN, CHAIN_EDGES, {'a': 1})
    noisy = ppr(CHAIN, CHAIN_EDGES + [('a', 'zz'), ('b', 'b'), ('zz', 'zz')], {'a': 1, 'zz': 5})

    assert noisy == pytest.approx(plain)
    assert sum(noisy.values()) == pytest.approx(1)


def test_signature_defaults_follow_the_contract():
    docs = [('a', '카엘이 칼을 들었다'), ('b', '카엘에게 편지가 왔다 카엘')]

    assert ppr(CHAIN, CHAIN_EDGES, {'a': 1}) == ppr(CHAIN, CHAIN_EDGES, {'a': 1}, damping=0.5, iters=50, tol=1e-8)
    assert bm25_rank('카엘', docs) == bm25_rank('카엘', docs, k1=1.5, b=0.75)
    assert rrf([['a', 'b']]) == rrf([['a', 'b']], k=60)


# --- seed_cards ---------------------------------------------------------------------------------------------------------

def test_seed_cards_uses_every_title_the_query_mentions_with_weight_one():
    assert seed_cards('카엘이 리라에게 뭐라고 했어?', WORLD.cards) == {'kael': 1.0, 'lira': 1.0}


def test_seed_cards_falls_back_to_the_top_three_bm25_cards_when_no_title_is_mentioned():
    bodies = ['왕국 지도', '왕국 지도 와 성', '왕국 지도 와 성 그리고 숲 과 강',
              '왕국 지도 와 성 그리고 숲 과 강 그리고 산 과 바다 와 사막', '바다 이야기']
    cards = [Card(id=f'c{i}', cardType='other', title=f'T{i}', text=text) for i, text in enumerate(bodies, 1)]

    assert seed_cards('왕국은 어떤 곳인가', cards) == {'c1': 1.0, 'c2': 1.0, 'c3': 1.0}


def test_seed_cards_without_any_match_is_empty():
    assert seed_cards('전혀 상관없는 질문', WORLD.cards) == {}


def test_seed_cards_ignores_blank_titles_and_ignores_latin_case():
    cards = [Card(id='a', cardType='other', title='', text='x'), Card(id='k', cardType='character', title='Kael', text='y')]

    assert seed_cards('Where is KAEL now?', cards) == {'k': 1.0}


# --- rrf ----------------------------------------------------------------------------------------------------------------

def test_rrf_ranks_an_item_first_that_is_near_the_top_of_every_list():
    fused = rrf([['a', 'b', 'c'], ['a', 'c', 'd']])

    assert [ref for ref, _ in fused] == ['a', 'c', 'b', 'd']


def test_rrf_score_is_the_sum_of_one_over_k_plus_rank():
    assert rrf([['a', 'b'], ['b']]) == [('b', pytest.approx(1 / 62 + 1 / 61)), ('a', pytest.approx(1 / 61))]
    assert rrf([['a']], k=10) == [('a', pytest.approx(1 / 11))]


def test_rrf_counts_a_repeated_item_once_per_list_and_handles_no_lists():
    assert rrf([['a', 'a', 'b']]) == [('a', pytest.approx(1 / 61)), ('b', pytest.approx(1 / 62))]
    assert rrf([]) == [] and rrf([[]]) == []


# --- filter_for_character -----------------------------------------------------------------------------------------------

def test_filter_without_a_character_keeps_everything():
    items = [item('card:lira#soul'), item('relation:r-ls'), item('whatever')]

    assert filter_for_character(items, WORLD, None, 2) == (items, [])


def test_filter_keeps_the_characters_own_identity_soul_memory_and_episodes_up_to_the_base_episode():
    items = [item('card:kael#identity'), item('card:kael#soul'), item('card:kael#memory'), item('card:kael#ep01'),
             item('card:kael#ep03')]

    kept, gaps = filter_for_character(items, WORLD, 'kael', 2)

    assert refs(kept) == ['card:kael#identity', 'card:kael#soul', 'card:kael#memory', 'card:kael#ep01']
    assert gaps == []  # 미래 회차 기억은 '모르는 것'이지 '확인할 수 없는 것'이 아니다.
    assert 'card:kael#ep03' in refs(filter_for_character(items, WORLD, 'kael', 3)[0])


def test_filter_never_lets_another_characters_soul_memory_or_episodes_through():
    items = [item('card:lira#soul'), item('card:lira#memory'), item('card:lira#ep02'), item('card:lira#ep00')]

    assert filter_for_character(items, WORLD, 'kael', 99) == ([], [])


def test_filter_keeps_an_unrevealed_character_only_when_a_relation_links_them_to_the_character():
    items = [item('card:lira#identity'), item('card:sera#identity')]

    kept, gaps = filter_for_character(items, WORLD, 'kael', 2)

    assert refs(kept) == ['card:lira#identity']
    assert [g.ref for g in gaps] == ['card:sera#identity'] and gaps[0].reason
    assert refs(filter_for_character(items, WORLD, 'lira', 2)[0]) == ['card:lira#identity', 'card:sera#identity']


def test_filter_allows_a_card_that_needs_no_link_unless_it_is_revealed_later():
    world = with_card(WORLD, 'gate', revealFromEpisode=5)  # 성문(장소)은 5화부터 공개한다.
    items = [item('card:gate')]

    assert filter_for_character(items, WORLD, 'sera', 4) == (items, [])  # 공개 회차가 없는 장소는 누구나 안다.
    assert filter_for_character(items, world, 'sera', 4) == ([], [])
    assert filter_for_character(items, world, 'sera', 5) == (items, [])


HERO = Card(id='hero', cardType='character', title='가이', text='주인공', revealFromEpisode=1)


@pytest.mark.parametrize('card_type,needs_link', [('character', True), ('event', True), ('object', True), ('location', False),
                                                  ('rule', False), ('organization', False), ('ability', False), ('other', False)])
@pytest.mark.parametrize('link', [None, 'asserted', 'denied'])
def test_filter_asks_for_a_relation_only_for_character_event_and_object_cards(card_type, needs_link, link):
    # 사건·물건도 인물이 겪거나 가진 것이 아니면 아는지 확인할 수 없다. 관계 이름은 자유이고 연결돼 있으면 아는 것으로 본다. 부정 관계는 연결이 아니다.
    other = Card(id='x', cardType=card_type, title='대상', text='본문')
    relations = [] if link is None else [Relation(id='r', source='hero', target='x', label='아는 사이', polarity=link)]
    world = WorldSnapshot(worldId='w', episode=3, cards=[HERO, other], relations=relations)
    target = item('card:x#identity' if card_type == 'character' else 'card:x')

    kept, gaps = filter_for_character([target], world, 'hero', 3)

    allowed = not needs_link or link == 'asserted'
    assert (kept == [target]) is allowed
    assert gaps == ([] if allowed else [Gap(ref=target.ref, reason='연결된 관계가 없어 이 인물이 아는지 확인할 수 없음')])


@pytest.mark.parametrize('card_type', ['event', 'object'])
@pytest.mark.parametrize('linked', [False, True])
def test_filter_silently_drops_a_future_event_or_object_whether_or_not_it_is_linked(card_type, linked):
    other = Card(id='x', cardType=card_type, title='대상', text='본문', revealFromEpisode=9)
    relations = [Relation(id='r', source='hero', target='x', label='아는 사이')] if linked else []
    world = WorldSnapshot(worldId='w', episode=3, cards=[HERO, other], relations=relations)

    assert filter_for_character([item('card:x')], world, 'hero', 3) == ([], [])


def test_filter_blocks_a_card_revealed_in_the_future_even_when_linked():
    world = with_card(WORLD, 'lira', revealFromEpisode=4)

    assert filter_for_character([item('card:lira#identity')], world, 'kael', 3) == ([], [])
    assert refs(filter_for_character([item('card:lira#identity')], world, 'kael', 4)[0]) == ['card:lira#identity']


def test_filter_keeps_only_relations_that_have_the_character_as_an_endpoint():
    items = [item(f'relation:{r.id}') for r in RELATIONS]

    kept, gaps = filter_for_character(items, WORLD, 'kael', 2)

    assert refs(kept) == ['relation:r-kl', 'relation:r-kg']
    assert [g.ref for g in gaps] == ['relation:r-ls', 'relation:r-lc']
    assert refs(filter_for_character(items, WORLD, 'lira', 5)[0]) == ['relation:r-kl', 'relation:r-ls', 'relation:r-lc']


def test_filter_holds_back_a_relation_whose_other_card_is_not_revealed_yet():
    # 관계 문장에 상대 카드의 제목이 드러난다: 리라–왕관(5화부터)은 2화의 리라에게 쓰지 않고 gap으로 남긴다.
    items = [item('relation:r-lc'), item('relation:r-ls')]

    kept, gaps = filter_for_character(items, WORLD, 'lira', 2)

    assert refs(kept) == ['relation:r-ls']
    assert [g.ref for g in gaps] == ['relation:r-lc'] and gaps[0].reason
    assert refs(filter_for_character(items, WORLD, 'lira', 5)[0]) == ['relation:r-lc', 'relation:r-ls']
    # 인물 자신의 공개 회차는 관계를 막지 않는다(세라는 2화부터 공개지만 1화의 세라에게 리라와의 관계는 보인다).
    assert refs(filter_for_character([item('relation:r-ls')], WORLD, 'sera', 1)[0]) == ['relation:r-ls']


def test_filter_fails_closed_on_a_relation_whose_other_card_is_not_in_the_snapshot():
    ghost = Relation(id='r-ghost', source='kael', target='ghost', label='?', direction=None)
    world = WORLD.model_copy(update={'relations': RELATIONS + [ghost]})

    kept, gaps = filter_for_character([item('relation:r-ghost')], world, 'kael', 2)

    assert kept == [] and [g.ref for g in gaps] == ['relation:r-ghost']


def test_filter_keeps_only_excerpts_that_name_the_character():
    items = [item('manuscript:m1', M1.quote), item('manuscript:m2', M2.quote)]

    kept, gaps = filter_for_character(items, WORLD, 'kael', 2)

    assert refs(kept) == ['manuscript:m1']
    assert [g.ref for g in gaps] == ['manuscript:m2']


@pytest.mark.parametrize('ref', ['card:ghost#identity', 'card:kael#nonsense', 'card:kael#ep', 'card:kael#epx1',
                                 'relation:ghost', 'weird:1', 'no-colon', ''])
def test_filter_fails_closed_on_a_reference_it_cannot_resolve(ref):
    kept, gaps = filter_for_character([item(ref, '카엘')], WORLD, 'kael', 2)

    assert kept == [] and [g.ref for g in gaps] == [ref]


def test_filter_gaps_keep_item_order_and_the_input_is_not_changed():
    items = [item('relation:r-lc'), item('card:kael#identity'), item('card:sera#identity'), item('manuscript:m2', M2.quote)]

    kept, gaps = filter_for_character(items, WORLD, 'kael', 2)

    assert refs(items) == ['relation:r-lc', 'card:kael#identity', 'card:sera#identity', 'manuscript:m2']
    assert refs(kept) == ['card:kael#identity']
    assert [g.ref for g in gaps] == ['relation:r-lc', 'card:sera#identity', 'manuscript:m2']
    assert all(isinstance(g, Gap) for g in gaps)


def test_filter_for_an_unknown_character_is_an_error():
    with pytest.raises(ValueError):
        filter_for_character([item('card:gate')], WORLD, 'nobody', 2)


# --- recall -------------------------------------------------------------------------------------------------------------

QUERY = '세라와 리라는 왕의 비밀을 아는가'


def test_stage_0_is_the_ppr_graph_only_with_cards_and_relations():
    result = recall(WORLD, None, 2, '카엘이 성문에서 뭘 했나', stage=0, manuscript=[M1], k=100)

    by_ref = {i.ref: i for i in result.items}
    assert result.stage == 0 and result.gaps == []
    assert {i.source for i in result.items} == {'graph'}
    assert [i.rank for i in result.items] == list(range(1, len(result.items) + 1))
    assert [i.score for i in result.items] == sorted((i.score for i in result.items), reverse=True)
    assert by_ref['card:kael#identity'].text == KAEL.text  # 인물 카드의 본문은 #identity 문서이며 본문 그대로다.
    assert by_ref['card:gate'].text == GATE.text
    assert by_ref['relation:r-kl'].text == '카엘 ↔ 리라: 남매'
    assert by_ref['relation:r-kg'].text == '카엘 → 성문: 근무지'
    assert not [r for r in by_ref if '#soul' in r or '#memory' in r or '#ep' in r or r.startswith('manuscript:')]
    assert result.items[0].score > 1 / 61  # 0단계 점수는 RRF가 아니라 PPR 점수 그대로다.


def test_recall_defaults_are_stage_3_no_manuscript_and_eight_items():
    result = recall(WORLD, None, 2, '카엘 리라 세라 왕관 성문 왕의 비밀')

    assert result.stage == 3 and len(result.items) == 8 and result.gaps == []
    assert {i.source for i in result.items} <= {'graph', 'bm25'}


def test_stage_0_ranks_the_seed_card_first_and_cuts_to_k():
    result = recall(WORLD, None, 2, '카엘이 성문에서 뭘 했나', stage=0, k=3)

    assert len(result.items) == 3 and result.items[0].ref in {'card:kael#identity', 'card:gate'}


def test_stage_1_adds_the_manuscript_excerpts_in_the_order_given():
    stage0 = recall(WORLD, None, 2, '카엘이 성문에서 뭘 했나', stage=0, k=100)
    stage1 = recall(WORLD, None, 2, '카엘이 성문에서 뭘 했나', stage=1, manuscript=[M2, M1], k=100)

    manuscript = [i for i in stage1.items if i.source == 'manuscript']
    assert [(i.ref, i.text) for i in manuscript] == [('manuscript:m2', M2.quote), ('manuscript:m1', M1.quote)]
    assert set(refs(stage0.items)) <= set(refs(stage1.items))


def test_stage_2_adds_bm25_documents_the_graph_cannot_reach_and_rewards_agreement():
    kwargs = dict(manuscript=[M2], k=100)
    stage1 = {i.ref: i for i in recall(WORLD, None, 2, '왕의 비밀', stage=1, **kwargs).items}
    stage2 = {i.ref: i for i in recall(WORLD, None, 2, '왕의 비밀', stage=2, **kwargs).items}

    assert 'card:lira#memory' not in stage1 and stage2['card:lira#memory'].source == 'bm25'
    assert stage2['card:kael#ep03'].text == KAEL.episodes[3]
    assert stage2['card:crown'].source == 'graph'  # 처음 찾은 방식으로 표시한다.
    assert stage2['card:crown'].score > stage1['card:crown'].score  # 그래프와 BM25가 함께 올린 항목은 점수가 높다.


def test_stages_accumulate_and_stage_3_only_removes():
    kwargs = dict(manuscript=[M1, M2, M3], k=100)
    stage = [set(refs(recall(WORLD, 'kael', 2, QUERY, stage=n, **kwargs).items)) for n in range(4)]

    assert stage[0] < stage[1] < stage[2]
    assert stage[3] < stage[2]


def test_stage_3_filters_for_the_character_and_reports_what_it_could_not_confirm():
    result = recall(WORLD, 'kael', 2, QUERY, stage=3, manuscript=[M1, M2, M3], k=100)

    kept, gap_refs = set(refs(result.items)), [g.ref for g in result.gaps]
    assert {'card:kael#identity', 'card:lira#identity', 'relation:r-kl', 'manuscript:m1'} <= kept
    assert not kept & {'card:lira#soul', 'card:lira#memory', 'card:lira#ep02', 'card:sera#identity', 'card:sera#soul',
                       'card:crown', 'card:kael#ep03', 'relation:r-ls', 'relation:r-lc', 'manuscript:m2', 'manuscript:m3'}
    # 확인할 수 없어 뺀 것만 gap이다. 다른 인물의 문서·미래 항목·미래 회차 발췌는 gap도 아니다.
    assert {'card:sera#identity', 'relation:r-ls', 'relation:r-lc', 'manuscript:m2'} <= set(gap_refs)
    assert not set(gap_refs) & {'card:lira#soul', 'card:lira#memory', 'card:crown', 'card:kael#ep03', 'manuscript:m3'}
    assert all(g.reason for g in result.gaps) and len(gap_refs) == len(set(gap_refs))


def test_stage_3_fills_k_with_allowed_items_after_filtering_and_renumbers_ranks():
    result = recall(WORLD, 'kael', 2, QUERY, stage=3, manuscript=[M1, M2], k=3)

    assert [i.rank for i in result.items] == [1, 2, 3]
    assert not {i.ref for i in result.items} & {'card:lira#memory', 'card:sera#identity', 'relation:r-ls', 'manuscript:m2'}
    assert [i.score for i in result.items] == sorted((i.score for i in result.items), reverse=True)


def test_stage_3_gaps_only_cover_items_that_would_have_made_the_top_k():
    top1 = recall(WORLD, 'kael', 2, '카엘', k=1)
    everything = recall(WORLD, 'kael', 2, '카엘', k=100)

    assert refs(top1.items) == ['card:kael#identity'] and top1.gaps == []
    assert 'card:sera#identity' in [g.ref for g in everything.gaps]


def test_stage_3_drops_excerpts_from_after_the_base_episode_for_a_character_but_not_for_the_main_agent():
    character = recall(WORLD, 'kael', 2, '카엘 왕의 비밀', manuscript=[M3], k=100)
    main = recall(WORLD, None, 2, '카엘 왕의 비밀', manuscript=[M3], k=100)

    assert 'manuscript:m3' not in refs(character.items) and 'manuscript:m3' not in [g.ref for g in character.gaps]
    assert 'manuscript:m3' in refs(main.items)


@pytest.mark.parametrize('kind,reason', [('relationship', 'relationship_current_not_episode'), ('setting', 'setting_via_retrieval')])
@pytest.mark.parametrize('excerpt_episode', [1, 3, 9])
def test_stage_3_uses_only_manuscript_excerpts_and_leaves_the_others_as_gaps(kind, reason, excerpt_episode):
    # Retrieval은 현재 Neo4j 관계(relationship)·설정(setting) 발췌도 돌려주고 episode에는 기준 회차를 적는다. 시점을 보증할 수 없어 쓰지 않는다.
    leaked = Excerpt(id='r', episode=excerpt_episode, kind=kind, quote='카엘 → 리라: 10화의 배신')

    result = recall(WORLD, 'kael', 3, '카엘과 리라의 관계', manuscript=[leaked, M1], k=100)

    assert 'manuscript:r' not in refs(result.items)
    assert '10화의 배신' not in ' '.join(i.text for i in result.items)
    assert 'manuscript:m1' in refs(result.items)  # 원고 발췌는 그대로 쓴다.
    assert Gap(ref='manuscript:r', reason=reason) in result.gaps
    # 순위에 들지 않은 발췌라 k로 자르는 윈도우와 무관하게 늘 gap으로 남는다.
    assert Gap(ref='manuscript:r', reason=reason) in recall(WORLD, 'kael', 3, '카엘과 리라의 관계', manuscript=[leaked, M1], k=1).gaps


def test_non_manuscript_excerpts_stay_in_the_stages_that_do_not_filter_for_a_character():
    relationship = Excerpt(id='r', episode=3, kind='relationship', quote='카엘 → 리라: 10화의 배신')

    assert 'manuscript:r' in refs(recall(WORLD, 'kael', 3, '카엘', stage=2, manuscript=[relationship], k=100).items)
    assert 'manuscript:r' in refs(recall(WORLD, None, 3, '카엘', manuscript=[relationship], k=100).items)


def test_stage_3_does_not_show_the_title_of_an_unrevealed_card_through_a_relation():
    result = recall(WORLD, 'lira', 2, '리라가 훔친 것', k=100)

    assert 'relation:r-lc' not in refs(result.items)
    assert '왕관' not in ' '.join(i.text for i in result.items)
    assert 'relation:r-lc' in [g.ref for g in result.gaps]
    assert 'relation:r-ls' in refs(result.items)  # 이미 공개된 상대(세라)와의 관계는 그대로 쓴다.


def test_stage_3_does_not_treat_a_denied_relation_as_a_connection_but_still_shows_it_as_denied():
    denied = Relation(id='r-ks', source='kael', target='sera', label='동료', direction='symmetric', polarity='denied')
    world = WORLD.model_copy(update={'relations': RELATIONS + [denied]})

    result = recall(world, 'kael', 2, '세라는 카엘의 동료인가', k=100)

    assert 'card:sera#identity' not in refs(result.items)
    assert 'card:sera#identity' in [g.ref for g in result.gaps]
    assert {i.ref: i.text for i in result.items}['relation:r-ks'] == '카엘 ↮ 세라 (아님): 동료'


@pytest.mark.parametrize('direction,label,expected', [('directed', '스승', '카엘 ↛ 리라 (아님): 스승'),
                                                      ('symmetric', '남매', '카엘 ↮ 리라 (아님): 남매'),
                                                      (None, '', '카엘 — 리라 (아님)')])
def test_a_denied_relation_item_shows_the_negation(direction, label, expected):
    world = WorldSnapshot(worldId='w', episode=1, cards=[KAEL, LIRA], relations=[
        Relation(id='r', source='kael', target='lira', label=label, direction=direction, polarity='denied')])

    assert {i.ref: i.text for i in recall(world, None, 1, '카엘', stage=0, k=100).items}['relation:r'] == expected


def test_a_denied_relation_carries_no_ppr_mass_but_stays_a_relation_item():
    cards = [Card(id='a', cardType='character', title='가이', text='가이 소개'),
             Card(id='b', cardType='character', title='나이', text='나이 소개')]

    def stage0(polarity):
        world = WorldSnapshot(worldId='w', episode=1, cards=cards, relations=[
            Relation(id='r', source='a', target='b', label='스승', direction='directed', polarity=polarity)])
        return {i.ref: i.text for i in recall(world, None, 1, '가이', stage=0, k=100).items}

    assert 'card:b#identity' in stage0('asserted')
    denied = stage0('denied')
    assert 'card:b#identity' not in denied  # 부정 관계로는 이웃에 닿지 않는다.
    assert denied['relation:r'] == '가이 ↛ 나이 (아님): 스승'


def test_stage_3_without_a_character_is_the_main_agent_view_and_filters_nothing():
    kwargs = dict(manuscript=[M1, M2, M3], k=100)

    main = recall(WORLD, None, 2, '왕의 비밀', **kwargs)

    assert main.stage == 3 and main.gaps == []
    assert main.items == recall(WORLD, None, 2, '왕의 비밀', stage=2, **kwargs).items


def test_stage_3_refuses_a_snapshot_whose_relations_are_newer_than_the_character_episode():
    later = WORLD.model_copy(update={'episode': 5})

    with pytest.raises(ValueError):
        recall(later, 'kael', 2, '카엘')
    recall(later, None, 2, '카엘')
    recall(later, 'kael', 2, '카엘', stage=2)
    recall(WORLD.model_copy(update={'episode': 1}), 'kael', 2, '카엘')  # 더 이른 시점의 관계는 덜 알려 줄 뿐이라 허용한다.


def test_recall_for_an_unknown_character_or_an_unknown_stage_is_an_error():
    with pytest.raises(ValueError):
        recall(WORLD, 'nobody', 2, '카엘')
    with pytest.raises(ValidationError):
        recall(WORLD, None, 2, '카엘', stage=4)


def test_blank_query_has_no_graph_or_bm25_hits_but_keeps_the_manuscript_ranking():
    assert recall(WORLD, None, 2, '   ', stage=0).items == []
    assert refs(recall(WORLD, None, 2, '   ', stage=2, manuscript=[M1], k=100).items) == ['manuscript:m1']


def test_episode_documents_are_named_with_a_two_digit_episode_number():
    world = WorldSnapshot(worldId='w', episode=1, cards=[
        Card(id='c', cardType='character', title='가이', text='소개', episodes={5: '다섯 번째 기억 용사', 100: '백 번째 기억 용사'})], relations=[])

    assert set(refs(recall(world, None, 1, '용사', stage=2, k=100).items)) == {'card:c#ep05', 'card:c#ep100'}


def test_blank_documents_and_relations_to_unknown_cards_are_not_items():
    world = WorldSnapshot(worldId='w', episode=1, cards=[
        Card(id='a', cardType='character', title='가이', text='', soul='  ', memory='기억 용사'),
        Card(id='b', cardType='location', title='성', text='성 용사')],
        relations=[Relation(id='r1', source='a', target='b', label='살다', direction=None),
                   Relation(id='r2', source='a', target='ghost', label='?', direction='directed')])

    result = recall(world, None, 1, '가이 용사', stage=2, k=100)

    assert set(refs(result.items)) == {'card:a#memory', 'card:b', 'relation:r1'}
    assert {i.ref: i.text for i in result.items}['relation:r1'] == '가이 — 성: 살다'
