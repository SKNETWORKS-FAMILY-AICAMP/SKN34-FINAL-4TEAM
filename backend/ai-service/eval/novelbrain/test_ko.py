"""한국어 적용성 세트 단위 테스트: 샘플 로더(저장소 CSV)·후보 선정·규칙 검증·누설/적중 판정."""

import pytest

from app.manuscript.models import Excerpt
from app.novelbrain.service import _documents, bm25_rank, recall
from ko import WORKS, candidates, evidence_ids, ko_world, load_works, valid_question
from run import filtered, fuse

PARAGRAPH = '문을 지키던 기사 카엘은 서한을 흘끗 보더니 고개를 저었다. “해가 진 뒤에는 문이 열리지 않소.”'


@pytest.fixture(scope='module')
def works():
    return load_works()


def test_loader_reads_the_repository_sample(works):
    assert set(works) == set(WORKS)
    star = works['별빛 서약의 탑']
    assert sorted(star['episodes']) == [1, 2, 3] and [len(star['episodes'][n]) for n in (1, 2, 3)] == [5, 5, 5]
    assert star['episodes'][1][2].startswith('문을 지키던 기사 카엘')
    names = {c['name']: c['category'] for c in star['cards']}
    assert names['카엘'] == '인물' and names['별빛 탑'] == '장소'
    assert ('탑 앞에서 밤을 지새우다', ['리안', '카엘']) in star['participants']


def test_candidates_cover_the_four_kinds_deterministically(works):
    first = candidates(works, seed=58)
    assert first == candidates(works, seed=58)
    assert {c['kind'] for c in first} == {'known', 'future', 'unwitnessed', 'setting'}
    for c in first:
        work = works[c['work']]
        if c['kind'] == 'future':
            assert c['episode'] == c['source']['episode'] - 1 and c['character'] in c['source']['text']
        elif c['kind'] == 'unwitnessed':
            assert c['character'] not in c['source']['text'] and c['episode'] == max(work['episodes'])
        elif c['kind'] == 'known':
            assert c['character'] in c['source']['text'] and c['episode'] >= c['source']['episode']
        else:
            assert c['source']['category'] != '인물' and c['source']['text'].strip() and c['episode'] == max(work['episodes'])


def test_valid_question_accepts_a_grounded_question_and_rejects_the_rest():
    ok = {'question': '카엘은 밤에 찾아온 리안을 왜 들여보내지 않았나요?', 'quote': '해가 진 뒤에는 문이 열리지 않소'}
    assert valid_question(PARAGRAPH, ok, seen=set()) is None
    assert valid_question(PARAGRAPH, dict(ok, quote='없는 구절'), seen=set()) == 'quote_not_in_text'
    assert valid_question(PARAGRAPH, dict(ok, question='해가 진 뒤에는 문이 열리지 않소 라는 말이 맞나요?'), seen=set()) == 'answer_in_question'
    assert valid_question(PARAGRAPH, dict(ok, question='?'), seen=set()) == 'bad_length'
    assert valid_question(PARAGRAPH, dict(ok, question='완전히 다른 이야기를 해 주세요 제발요 지금 바로'), seen=set()) == 'no_overlap'
    assert valid_question(PARAGRAPH, ok, seen={ok['question']}) == 'duplicate'


def test_evidence_ids_map_items_to_paragraphs_and_cards_but_not_relations():
    refs = ['manuscript:p1', 'card:k3', 'card:k4#identity', 'relation:r1', 'manuscript:p2']
    assert evidence_ids(refs) == ['p1', 'k3', 'k4', 'p2']
    assert evidence_ids(['card:k3', 'manuscript:k3']) == ['k3']  # 같은 id는 처음 순위에서 한 번만


def test_filtered_fusion_reproduces_recall_stage_3(works):
    # 하나씩 빼기의 근거: 같은 목록을 RRF로 합친 뒤 필터를 걸면 recall(3단계)과 순위가 같다.
    title = '별빛 서약의 탑'
    paragraphs = [(e, i, t) for e, ps in sorted(works[title]['episodes'].items()) for i, t in enumerate(ps)]
    manuscript = [Excerpt(id=f'{e}.{i}', episode=e, quote=t[:256]) for e, i, t in paragraphs]
    question, episode = '카엘은 해가 진 뒤 문을 열었나요?', 2
    world = ko_world(works, title, episode)
    character_id = next(c.id for c in world.cards if c.title == '카엘')
    expected = [i.ref for i in recall(world, character_id, episode, question, stage=3, manuscript=manuscript, k=1000).items]
    graph = [i.ref for i in recall(world, character_id, episode, question, stage=0, k=1000).items]
    vector = [f'manuscript:{e.id}' for e in manuscript if e.episode <= episode]
    docs = _documents(world.cards)
    bm25 = [ref for ref, _ in bm25_rank(question, [(ref, f'{t} {x}') for ref, (t, x) in docs.items()])]
    texts = {f'manuscript:{e.id}': e.quote for e in manuscript}
    assert filtered(fuse([graph, vector, bm25]), texts, world, character_id, episode) == expected
