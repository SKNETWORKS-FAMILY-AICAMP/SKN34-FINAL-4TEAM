"""문맥 구성 단위 테스트: 원고 조각 나누기·근거 겹침·독립 누설 지표·구성별 문맥(작은 합성 세계관). 소설 원문 없음."""

import pytest

from kt_context import CONFIGS, K_CTX, chunk_episode, item_episode, overlaps, unseen_exposure


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
    assert set(out) == set(CONFIGS) and out['zero']['items'] == []
    assert all(len(c['items']) <= K_CTX for c in out.values())
    assert out['vector']['future'] and any('먼 길을 떠났다' in i['text'] for i in out['vector']['items'])    # 벡터만: 미래 발췌가 그대로 들어온다
    assert not out['s3']['future'] and all('이별' not in i['text'] for i in out['s3']['items'])             # 필터: 기준 회차 뒤는 없다
