"""최적화 풀 데이터(app/evaluation/datasets/optimize/*.jsonl) 불변식: 게이트 세트와 겹치지 않고, 공개 작품만이며, train·val이 있고, seed가 올리지 않는다."""

import json
from pathlib import Path

import pytest

from app.evaluation import seed
from app.optimization import service

GATES = Path(seed.DATASETS)
CASES = [('simulation.act', 126, {'dialogue'}), ('simulation.narrate', 54, {'narration', 'monologue'})]


def rows(path: Path) -> list[dict]:
    return [json.loads(line) for line in path.read_text(encoding='utf-8').splitlines() if line.strip()]


def identity(row: dict) -> tuple:
    """같은 원문 문항인지 보는 열쇠: 작품·회차·정답(원작의 다음 글)."""
    source = row['metadata']['source']
    return source['work'], source['episode'], row['expectedOutput']


@pytest.mark.parametrize('name, size, sets', CASES)
def test_the_pool_has_the_expected_items_and_a_train_val_split(name, size, sets):
    pool = rows(service.POOLS / f'{name}.jsonl')
    train, val = service.load_pool(name)

    assert len(pool) == size and len(val) == 20 and len(train) == size - 20   # val은 상한 20(기본 호출 상한 150에 맞춘다)
    assert len({row['id'] for row in pool}) == size and all(row['id'].startswith(f'{name}.opt-') for row in pool)
    assert {row['input']['set'] for row in pool} <= sets


@pytest.mark.parametrize('name, size, sets', CASES)
def test_not_one_pool_item_is_in_the_gate_set(name, size, sets):
    gate = {identity(row) for row in rows(GATES / f'{name}.jsonl')}
    pool = {identity(row) for row in rows(service.POOLS / f'{name}.jsonl')}

    assert gate and not gate & pool   # 겹치면 최적화가 게이트 세트를 본 셈이라 게이트 세트가 검증 세트가 아니게 된다


@pytest.mark.parametrize('name, size, sets', CASES)
def test_only_public_works_with_the_judge_inputs_the_regression_evaluation_reads(name, size, sets):
    for row in rows(service.POOLS / f'{name}.jsonl'):
        license = row['metadata']['license']   # 고전·근대 소설(저작권 만료, 사유가 뒤에 붙는다)과 SCP 이야기(CC BY-SA 3.0). 해리 포터는 없다
        assert (license.startswith('저작권 만료') or license == 'CC BY-SA 3.0') and '해리' not in row['metadata']['source']['work']
        assert set(row['metadata']['judge']) == {'character', 'scene', 'facts'} and row['expectedOutput'].strip()


def test_the_pool_folder_is_not_seeded_into_langfuse():
    loaded = seed.load()
    pool_ids = {row['id'] for name, *_ in CASES for row in rows(service.POOLS / f'{name}.jsonl')}

    assert not any(name.startswith('optimize') for name in loaded)
    assert not pool_ids & {item['id'] for items in loaded.values() for item in items}
