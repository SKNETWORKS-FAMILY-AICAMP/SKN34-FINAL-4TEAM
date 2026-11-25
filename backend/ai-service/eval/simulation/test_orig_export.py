"""운영 LLMOps 등록 형식 내보내기(orig_export): 라이선스별 분리, 지시문별 평가 세트 줄(채점 입력 metadata.judge 포함)."""

import orig_export as oe

PD = {'id': 'public-1-0001', 'kind': 'dialogue', 'speaker': '길동', 'n': 3, 'gold': '"가자."', 'context': [{'by': '길동', 'text': '"어디로?"', 'kind': 'dialogue', 'speaker': '길동'}],
      'source': {'title': '홍길동전', 'author': '작자 미상', 'license': '저작권 만료', 'source': 'https://ko.wikisource.org/wiki/x', 'kind': 'classic'}}
SCP = {**PD, 'id': 'public-1-0002', 'source': {'title': '이야기', 'author': 'Raihorizon', 'license': 'CC BY-SA 3.0', 'source': 'https://scpko.wikidot.com/babel', 'kind': 'scp'}}
FACTS = [{'id': 'f1', 'text': '미래 사건', 'body': '내부 필드'}]


def test_split_by_license_separates_scp_from_expired_works():
    free, scp = oe.split_by_license([PD, SCP, {**PD, 'source': {**PD['source'], 'kind': 'modern'}}])
    assert len(free) == 2 and all(i['source']['kind'] != 'scp' for i in free)
    assert [i['id'] for i in scp] == ['public-1-0002']


def test_the_two_sets_are_one_per_instruction_with_dialogue_and_narration_monologue_inputs():
    assert oe.SETS == {'simulation.act': ('1',), 'simulation.narrate': ('3n', '3m')}   # 지시문 character_simulation.act·narrate마다 하나


def test_record_has_the_dataset_shape_and_the_judge_inputs_the_regression_evaluation_reads():
    rec = oe.record(SCP, 'simulation.act-13', {'set': 'dialogue', 'data': {'x': 1}}, FACTS)
    assert set(rec) == {'id', 'input', 'expectedOutput', 'metadata'} and rec['id'] == 'simulation.act-13' and rec['expectedOutput'] == '"가자."'
    assert rec['metadata']['judge'] == {'character': '길동', 'scene': [{'by': '길동', 'text': '"어디로?"'}], 'facts': [{'id': 'f1', 'text': '미래 사건'}]}   # 채점 입력만(id·text·by)
    assert rec['metadata']['license'] == 'CC BY-SA 3.0' and 'criteria' not in rec['metadata']   # G-Eval 기준이 아니라 원문 평가 루브릭으로 채점한다
    assert rec['metadata']['source'] == {'work': '이야기', 'author': 'Raihorizon', 'origin': 'https://scpko.wikidot.com/babel', 'license': 'CC BY-SA 3.0', 'episode': 3}


def test_dataset_rows_number_the_items_in_order_under_the_set_name():
    rows = oe.dataset_rows('simulation.narrate', [(PD, {'set': 'narration', 'data': {}}, []), (SCP, {'set': 'monologue', 'data': {}}, FACTS)])
    assert [r['id'] for r in rows] == ['simulation.narrate-01', 'simulation.narrate-02'] and [r['input']['set'] for r in rows] == ['narration', 'monologue']


def test_pick_is_even_and_takes_each_item_once_when_fewer_are_left_than_asked():
    items = [{'id': str(i)} for i in range(10)]
    assert [i['id'] for i in oe.pick(items, 4)] == ['0', '2', '5', '7']
    assert [i['id'] for i in oe.pick(items[:3], 5)] == ['0', '1', '2']   # 모자라면 전부, 한 번씩(같은 문항이 두 번 실리면 평균에 두 배 가중치가 붙는다)
    assert [i['id'] for i in oe.pick(items, 12)] == [str(i) for i in range(10)]


def make(n, kind='classic'):
    return {**PD, 'id': f'public-1-{n:04d}', 'source': {**PD['source'], 'kind': kind}}


def test_the_leftover_is_exactly_what_the_gate_set_did_not_pick_free_items_first_then_scp():
    free = [make(n) for n in range(1, 11)]
    scp = [make(n, 'scp') for n in range(11, 16)]
    gate = {i['id'] for i in [*oe.pick(free, 4), *oe.pick(scp, 4)]}

    left = oe.leftover(free, scp, 4)

    assert not gate & {i['id'] for i in left}   # 게이트 세트와 한 문항도 겹치지 않는다(겹치면 최적화가 게이트 세트를 본 셈이 된다)
    assert gate | {i['id'] for i in left} == {i['id'] for i in [*free, *scp]}   # 나머지는 전부 풀이다
    assert [i['source']['kind'] for i in left] == ['classic'] * 6 + ['scp']


def test_pool_rows_split_train_and_val_evenly_with_val_capped_at_twenty():
    picked = [(make(n), {'set': 'dialogue', 'data': {}}, []) for n in range(1, 127)]

    rows = oe.pool_rows('simulation.act', picked)

    assert [r['id'] for r in rows[:2]] == ['simulation.act.opt-001', 'simulation.act.opt-002'] and len(rows) == 126
    val = [n for n, r in enumerate(rows) if r['metadata']['split'] == 'val']
    assert len(val) == 20 and {r['metadata']['split'] for r in rows} == {'train', 'val'}
    gaps = [b - a for a, b in zip(val, val[1:])]
    assert max(gaps) - min(gaps) <= 1   # 풀 전체에서 같은 간격이라 묶음이 비율대로 섞인다


def test_a_small_pool_keeps_most_of_its_items_for_training():
    picked = [(make(n), {'set': 'narration', 'data': {}}, []) for n in range(1, 55)]

    rows = oe.pool_rows('simulation.narrate', picked)

    assert sum(r['metadata']['split'] == 'val' for r in rows) == 20   # 54개의 40%(22)가 아니라 상한 20
    assert sum(r['metadata']['split'] == 'train' for r in rows) == 34
    few = oe.pool_rows('simulation.narrate', picked[:10])
    assert sum(r['metadata']['split'] == 'val' for r in few) == 4   # 10개의 40%


def test_a_pool_row_is_a_gate_row_plus_the_split_and_nothing_else():
    [row] = oe.pool_rows('simulation.act', [(PD, {'set': 'dialogue', 'data': {'x': 1}}, FACTS)])
    gate = oe.record(PD, row['id'], {'set': 'dialogue', 'data': {'x': 1}}, FACTS)

    assert row['metadata'].pop('split') in ('train', 'val') and row == gate
