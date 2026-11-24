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


def item(n, license='저작권 만료(시험)', id=None):
    return {'id': id or f'extraction.extract-{n:02d}', 'input': {'number': n, 'title': '운수 좋은 날', 'body': BODY}, 'expectedOutput': GOLD,
            'metadata': {'license': license, 'source': {'work': '운수 좋은 날', 'license': license},
                         'gold': {'model': 'gpt-6.2-sol', 'runs': ['A', 'B'], 'agreement': {'mentions': 1.0, 'statements': 0.5, 'relationships': None}}}}


@pytest.fixture
def home(tmp_path, monkeypatch):
    monkeypatch.setattr(ex_cli, 'SETS', tmp_path / 'sets')
    monkeypatch.setattr(ex_cli, 'GOLD', tmp_path / 'gold')
    monkeypatch.setattr(ex_cli, 'RESULTS', tmp_path / 'results')
    monkeypatch.setattr(ex_cli, 'DATASET', tmp_path / 'datasets' / 'extraction.extract.jsonl')
    return tmp_path


def test_no_langfuse_removes_the_keys_so_the_manuscript_never_reaches_langfuse(monkeypatch):
    monkeypatch.setenv('LANGFUSE_PUBLIC_KEY', 'pk')
    monkeypatch.setenv('LANGFUSE_SECRET_KEY', 'sk')

    ex_cli.no_langfuse()

    assert 'LANGFUSE_PUBLIC_KEY' not in os.environ and 'LANGFUSE_SECRET_KEY' not in os.environ


def test_gold_routes_the_calls_to_ocx_before_building_and_writes_the_items(home, monkeypatch):
    order = []
    monkeypatch.setattr(ex_gold, 'use_ocx', lambda *a, **k: order.append('ocx'))
    monkeypatch.setattr(ex_sources, 'public_episodes', lambda raw_dir: order.append(('episodes', str(raw_dir))) or [{'id': 'extraction.extract-01'}, {'id': 'extraction.extract-02'}])
    monkeypatch.setattr(ex_gold, 'build', lambda episodes, cache, workers=4, model=ex_gold.MODEL: order.append(('build', [e['id'] for e in episodes], cache, workers)) or ([item(1)], []))

    code = ex_cli.main(['gold', '--source', 'public', '--raw-dir', '/raw', '--workers', '3', '--limit', '1'])

    assert code == 0 and order == ['ocx', ('episodes', '/raw'), ('build', ['extraction.extract-01'], home / 'gold' / 'public', 3)]
    assert [json.loads(line) for line in (home / 'sets' / 'public.jsonl').read_text(encoding='utf-8').splitlines()] == [item(1)]


def test_gold_fails_loudly_when_an_episode_failed_but_keeps_the_items_that_worked(home, monkeypatch, capsys):
    monkeypatch.setattr(ex_gold, 'use_ocx', lambda *a, **k: None)
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


def test_export_copies_the_public_items_to_the_dataset_file(home):
    ex_cli.write_items(home / 'sets' / 'public.jsonl', [item(1), item(2)])

    ex_cli.main(['export'])

    assert ex_cli.read_items(ex_cli.DATASET) == [item(1), item(2)]


@pytest.mark.parametrize('bad', [item(1, license='저작권 있음(번역본): 로컬'), item(1, id='hp-b1-01-1'), item(1, license='CC BY-SA 3.0')])
def test_export_refuses_anything_but_expired_copyright_public_items_and_writes_nothing(home, bad):
    ex_cli.write_items(home / 'sets' / 'public.jsonl', [item(2), bad])

    with pytest.raises(SystemExit):
        ex_cli.main(['export'])

    assert not ex_cli.DATASET.exists()


def test_score_items_scores_each_item_with_the_code_and_keeps_failures_out_of_the_means(monkeypatch):
    outputs = {1: FULL, 2: HALF}

    def generate(instructions, item_input, model=None):
        if item_input['number'] == 3:
            raise PreprocessingFailure('MODEL_TIMEOUT', 504)
        return outputs[item_input['number']]
    monkeypatch.setattr(extraction, 'generate', generate)

    result = ex_cli.score_items([item(1), item(2), item(3)], '지시문', 'gpt-test', workers=2)

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
