"""추출 평가 실행기(ex_cli): 정답표 만들기·내보내기·오프라인 채점의 흐름과 안전 장치를 가짜 호출로 확인한다. 호출 없음."""

import json
import os

import pytest

import ex_cli
import ex_gold
import ex_sources
from app.evaluation import extraction
from app.manuscript_extraction.errors import PreprocessingFailure

Q1, Q2 = '김 첨지는 새벽부터 인력거를 끌고 나갔다.', '치삼이는 김 첨지의 오랜 친구였다.'
BODY = '\n'.join((Q1, Q2))
GOLD = {'mentions': [{'name': '김 첨지', 'kind': 'character', 'aliases': [], 'core': True}, {'name': '치삼', 'kind': 'character', 'aliases': [], 'core': True}],
        'statements': [{'kind': 'event', 'quote': Q1, 'core': True}], 'relationships': []}
FULL = {'mentions': [{'id': 'a', 'name': '김 첨지', 'kind': 'character', 'quote': Q1}, {'id': 'b', 'name': '치삼', 'kind': 'character', 'quote': Q2}],
        'statements': [{'id': 's', 'kind': 'event', 'quote': Q1}], 'relationships': [], 'skipped': {}}
HALF = {**FULL, 'mentions': FULL['mentions'][:1]}


def item(n, license='저작권 만료(시험)', id=None, author='현진건', work='운수 좋은 날', episode=1):
    return {'id': id or f'extraction.extract-{n:02d}', 'input': {'number': episode, 'title': work, 'body': BODY + str(n)}, 'expectedOutput': GOLD,
            'metadata': {'license': license, 'source': {'work': work, 'author': author, 'episode': episode, 'license': license},
                         'gold': {'model': 'gpt-6.2-sol', 'runs': ['A', 'B'], 'agreement': {'mentions': 1.0, 'statements': 0.5, 'relationships': None}}}}


@pytest.fixture
def home(tmp_path, monkeypatch):
    monkeypatch.setattr(ex_cli, 'SETS', tmp_path / 'sets')
    monkeypatch.setattr(ex_cli, 'GOLD', tmp_path / 'gold')
    monkeypatch.setattr(ex_cli, 'RESULTS', tmp_path / 'results')
    monkeypatch.setattr(ex_cli, 'DATASET', tmp_path / 'datasets' / 'extraction.extract.jsonl')
    monkeypatch.setattr(ex_cli, 'POOL', tmp_path / 'datasets' / 'optimize' / 'extraction.extract.jsonl')
    return tmp_path


def test_no_langfuse_removes_the_keys_so_the_manuscript_never_reaches_langfuse(monkeypatch):
    monkeypatch.setenv('LANGFUSE_PUBLIC_KEY', 'pk')
    monkeypatch.setenv('LANGFUSE_SECRET_KEY', 'sk')

    ex_cli.no_langfuse()

    assert 'LANGFUSE_PUBLIC_KEY' not in os.environ and 'LANGFUSE_SECRET_KEY' not in os.environ


def test_gold_routes_the_calls_to_ocx_before_building_and_writes_the_items(home, monkeypatch):
    order = []
    monkeypatch.setattr(ex_gold, 'use_ocx', lambda *a, **k: order.append('ocx'))
    monkeypatch.setattr(ex_sources, 'fetch_public', lambda raw_dir: order.append(('fetch', str(raw_dir))))
    monkeypatch.setattr(ex_sources, 'public_episodes', lambda raw_dir: order.append(('episodes', str(raw_dir))) or [{'id': 'extraction.extract-01'}, {'id': 'extraction.extract-02'}])
    monkeypatch.setattr(ex_gold, 'build', lambda episodes, cache, workers=4, model=ex_gold.MODEL: order.append(('build', [e['id'] for e in episodes], cache, workers)) or ([item(1)], []))

    code = ex_cli.main(['gold', '--source', 'public', '--raw-dir', '/raw', '--workers', '3', '--limit', '1'])

    assert code == 0 and order == ['ocx', ('fetch', '/raw'), ('episodes', '/raw'), ('build', ['extraction.extract-01'], home / 'gold' / 'public', 3)]   # 없는 원문만 낮은 속도로 받은 뒤 만든다
    assert [json.loads(line) for line in (home / 'sets' / 'public.jsonl').read_text(encoding='utf-8').splitlines()] == [item(1)]


def test_gold_fails_loudly_when_an_episode_failed_but_keeps_the_items_that_worked(home, monkeypatch, capsys):
    monkeypatch.setattr(ex_gold, 'use_ocx', lambda *a, **k: None)
    monkeypatch.setattr(ex_sources, 'fetch_public', lambda raw_dir: None)
    monkeypatch.setattr(ex_sources, 'public_episodes', lambda raw_dir: [{'id': 'x'}])
    monkeypatch.setattr(ex_gold, 'build', lambda *a, **k: ([item(1)], [('extraction.extract-02', 'B', 'MODEL_TIMEOUT')]))

    code = ex_cli.main(['gold', '--source', 'public', '--raw-dir', '/raw'])

    assert code == 1 and 'MODEL_TIMEOUT' in capsys.readouterr().out and (home / 'sets' / 'public.jsonl').exists()   # 같은 명령을 다시 치면 캐시로 이어 간다


def test_the_hp_source_reads_the_local_folder_and_never_the_dataset_file(home, monkeypatch):
    seen = []
    monkeypatch.setattr(ex_gold, 'use_ocx', lambda *a, **k: None)
    monkeypatch.setattr(ex_sources, 'hp_episodes', lambda folder, per_book: seen.append((str(folder), per_book)) or [{'id': 'hp-b1-01-1'}])
    monkeypatch.setattr(ex_gold, 'build', lambda *a, **k: ([item(1, license='저작권 있음(번역본): 로컬', id='hp-b1-01-1')], []))

    assert ex_cli.main(['gold', '--source', 'hp', '--hp-dir', '/hp', '--per-book', '3']) == 0

    assert seen == [('/hp', 3)] and (home / 'sets' / 'hp.jsonl').exists() and not ex_cli.DATASET.exists()   # 해리 포터는 세트 파일을 만들지 않는다


def work_items(author, work, count, start):
    """한 작품의 회차 항목들(회차 번호 1..count, id 번호는 start부터)."""
    return [item(start + k, author=author, work=work, episode=k + 1) for k in range(count)]


def catalog():
    """작가 가(작품 a1 4회차·a2 2회차)·나(b1 3회차)·다(c1 1회차)의 10회차. 작가를 번갈아 도는 작품 순서는 a1 b1 c1 a2다."""
    return work_items('가', 'a1', 4, 1) + work_items('가', 'a2', 2, 5) + work_items('나', 'b1', 3, 7) + work_items('다', 'c1', 1, 10)


def ids(items):
    return [int(i['id'].rsplit('-', 1)[1]) for i in items]


def test_split_takes_one_episode_per_work_in_turn_across_authors_and_spreads_the_picks_inside_a_work():
    gate, pool = ex_cli.split(catalog(), 6)

    # 1바퀴: a1 b1 c1 a2에서 하나씩(4), 2바퀴: a1 b1(2) = a1 2·b1 2·c1 1·a2 1. 작품 안에서는 회차를 고르게(4회차 중 둘째·넷째, 3회차 중 첫째·셋째)
    assert ids(gate) == [2, 4, 6, 7, 9, 10] and ids(pool) == [1, 3, 5, 8]


def test_split_is_a_partition_that_keeps_the_input_order_and_is_deterministic():
    items = catalog()

    gate, pool = ex_cli.split(items, 5)

    assert len(gate) == 5 and len(pool) == 5 and sorted(ids(gate) + ids(pool)) == ids(items)   # 겹치지도 빠지지도 않는다
    assert ids(gate) == sorted(ids(gate)) and ids(pool) == sorted(ids(pool)) and (gate, pool) == ex_cli.split(items, 5)


def test_split_lets_every_author_in_before_one_author_gets_a_second_work():
    items = work_items('가', 'x1', 2, 1) + work_items('가', 'x2', 2, 3) + work_items('가', 'x3', 2, 5) + work_items('나', 'y1', 2, 7)

    gate, _ = ex_cli.split(items, 2)

    assert {i['metadata']['source']['author'] for i in gate} == {'가', '나'}   # 작가를 번갈아 돌아 한 작가가 몰리지 않는다


def test_split_with_a_gate_larger_than_the_set_or_zero_has_an_empty_side():
    items = catalog()

    assert ex_cli.split(items, 99) == (items, []) and ex_cli.split(items, 0) == ([], items)


def episode_of(items):
    return [(i['metadata']['source']['work'], i['metadata']['source']['episode']) for i in items]


def test_export_splits_the_public_items_into_the_gate_set_and_the_optimization_pool(home):
    items = catalog()
    ex_cli.write_items(home / 'sets' / 'public.jsonl', items)

    ex_cli.main(['export', '--gate', '6'])

    gate, pool = ex_cli.read_items(ex_cli.DATASET), ex_cli.read_items(ex_cli.POOL)
    by_id = {i['id']: i for i in items}
    assert episode_of(gate) == episode_of([by_id[f'extraction.extract-{n:02d}'] for n in (2, 4, 6, 7, 9, 10)])   # 어느 회차가 어디로 가는지는 split이 정한다
    assert episode_of(pool) == episode_of([by_id[f'extraction.extract-{n:02d}'] for n in (1, 3, 5, 8)])
    assert ex_cli.POOL.parent.name == 'optimize' and ex_cli.POOL.name == ex_cli.DATASET.name   # seed가 올리지 않는 하위 폴더에 같은 세트 이름으로(자동 개선이 읽는 위치)
    assert [i['id'] for i in gate] == [f'extraction.extract-{n:02d}' for n in range(1, 7)] and [i['id'] for i in pool] == [f'extraction.extract.opt-{n:03d}' for n in range(1, 5)]   # 파일에 쓰는 id는 번호를 새로 맨 것
    assert all('split' not in i['metadata'] for i in gate) and {i['metadata']['split'] for i in pool} == {'train', 'val'}


def test_numbered_gives_the_gate_contiguous_ids_and_the_pool_opt_ids_with_an_even_val_split():
    pool = work_items('가', 'a', 10, 100)   # 풀이 작으면 val은 풀의 40%(4개)

    gate, numbered_pool = ex_cli.numbered(work_items('나', 'b', 3, 1), pool)

    assert [i['id'] for i in gate] == ['extraction.extract-01', 'extraction.extract-02', 'extraction.extract-03']
    assert [i['id'] for i in numbered_pool] == [f'extraction.extract.opt-{n:03d}' for n in range(1, 11)]   # 시뮬레이션 풀과 같은 id 규칙
    assert [n for n, i in enumerate(numbered_pool) if i['metadata']['split'] == 'val'] == [0, 2, 5, 7]   # 같은 간격: n * 10 // 4
    assert {i['metadata']['split'] for i in numbered_pool} == {'train', 'val'}
    assert 'split' not in gate[0]['metadata']   # 게이트 세트는 split이 없다


def test_the_val_split_is_twenty_for_a_large_pool_and_spread_over_it():
    _, pool = ex_cli.numbered([], work_items('가', 'a', 157, 1))

    val = [n for n, i in enumerate(pool) if i['metadata']['split'] == 'val']
    assert len(val) == ex_cli.VAL == 20 and sum(i['metadata']['split'] == 'train' for i in pool) == 137   # 상한 20: 기본 호출 상한 150에서 val 평가가 호출의 큰 몫을 쓰지 않게
    assert val[0] == 0 and val[-1] >= 140 and max(b - a for a, b in zip(val, val[1:])) <= 8   # 풀 전체에서 같은 간격(157 // 20 = 7~8칸)



def test_the_default_gate_is_about_thirty_episodes():
    assert ex_cli.GATE_SIZE == 30


@pytest.mark.parametrize('bad', [item(1, license='저작권 있음(번역본): 로컬'), item(1, id='hp-b1-01-1'), item(1, license='CC BY-SA 3.0')])
def test_export_refuses_anything_but_expired_copyright_public_items_and_writes_nothing(home, bad):
    ex_cli.write_items(home / 'sets' / 'public.jsonl', [item(2), bad])

    with pytest.raises(SystemExit):
        ex_cli.main(['export'])

    assert not ex_cli.DATASET.exists() and not ex_cli.POOL.exists()


def test_score_items_scores_each_item_with_the_code_and_keeps_failures_out_of_the_means(monkeypatch):
    outputs = {1: FULL, 2: HALF}

    def generate(instructions, item_input, model=None):
        if item_input['number'] == 3:
            raise PreprocessingFailure('MODEL_TIMEOUT', 504)
        return outputs[item_input['number']]
    monkeypatch.setattr(extraction, 'generate', generate)

    result = ex_cli.score_items([item(1, episode=1), item(2, episode=2), item(3, episode=3)], '지시문', 'gpt-test', workers=2)

    assert result['items'] == 3 and result['failed'] == {'extraction.extract-03': 'MODEL_TIMEOUT'}   # 실패는 0점으로 평균에 섞지 않는다
    assert result['recall'] == pytest.approx((1.0 + 0.75) / 2) and result['quote_ok'] == 1.0
    assert result['rows'][0]['id'] == 'extraction.extract-01' and result['rows'][0]['recall'] == 1.0


def test_the_score_result_has_numbers_and_ids_only_so_it_can_be_committed_for_the_local_set(monkeypatch):
    monkeypatch.setattr(extraction, 'generate', lambda instructions, item_input, model=None: FULL)

    result = ex_cli.score_items([item(1)], '지시문', 'gpt-test', workers=1)

    assert Q1 not in json.dumps(result, ensure_ascii=False) and '운수 좋은 날' not in json.dumps(result, ensure_ascii=False)   # 원문·제목은 집계에 없다


def test_score_writes_the_aggregate_file_with_the_model_and_the_instruction_source(home, monkeypatch):
    ex_cli.write_items(home / 'hp.jsonl', [item(1)])
    monkeypatch.setenv('OPENAI_API_KEY', 'sk-test')
    monkeypatch.setenv('OPENAI_MODEL', 'gpt-env')
    seen = []
    monkeypatch.setattr(extraction, 'generate', lambda instructions, item_input, model=None: seen.append((instructions, model)) or FULL)
    (home / 'mine.txt').write_text('내 지시문', encoding='utf-8')

    assert ex_cli.main(['score', str(home / 'hp.jsonl'), '--instructions', str(home / 'mine.txt'), '--tag', 'v2']) == 0

    assert seen == [('내 지시문', 'gpt-env')]
    saved = json.loads((home / 'results' / 'extraction-hp-v2.json').read_text(encoding='utf-8'))
    assert saved['model'] == 'gpt-env' and saved['instructions'] == 'mine.txt' and saved['recall'] == 1.0


def test_score_needs_the_openai_key_before_reading_anything(home, monkeypatch):
    monkeypatch.delenv('OPENAI_API_KEY', raising=False)

    with pytest.raises(SystemExit):
        ex_cli.main(['score', str(home / 'missing.jsonl')])
