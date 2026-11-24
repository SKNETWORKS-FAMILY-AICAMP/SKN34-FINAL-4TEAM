import json
from collections import Counter

import pytest

from app.evaluation import extraction, seed

PUBLIC = {'qa.grounding', 'world.conflict', 'writing.fix', 'leak.spoiler'}
SIMULATION = {'simulation.act', 'simulation.narrate'}
EXTRACTION = {'extraction.extract'}
NAMES = PUBLIC | SIMULATION | EXTRACTION


class Langfuse:
    """Langfuse upsert 대역: dataset은 이름, 항목은 id가 같으면 덮어쓴다."""

    def __init__(self):
        self.datasets, self.items = {}, {}

    def create_dataset(self, *, name):
        self.datasets[name] = name

    def create_dataset_item(self, *, dataset_name, id, input, expected_output, metadata):
        self.items[id] = (dataset_name, input, expected_output, metadata)


def test_the_four_fixed_sets_are_small_and_sourced_from_expired_copyright_works():
    data = seed.load()

    assert set(data) == NAMES
    assert len({i['id'] for items in data.values() for i in items}) == sum(len(items) for items in data.values())  # id는 Langfuse에서 전역 고유다
    for name in PUBLIC:
        items = data[name]
        assert 5 <= len(items) <= 10
        for it in items:
            source = it['metadata']['source']
            assert it['id'].startswith(name + '-') and isinstance(it['input'], dict)
            assert {'work', 'author', 'origin', 'sample'} <= set(source) and '저작권 만료' in source['origin']
            if name == 'qa.grounding':
                assert it['input']['question'] and it['input']['contexts'] and all(isinstance(c, str) and c for c in it['input']['contexts'])
            else:
                assert it['metadata']['criteria'].strip()


def test_the_simulation_sets_are_the_public_original_eval_items_one_set_per_instruction():
    data = seed.load()

    assert Counter(i['input']['set'] for i in data['simulation.act']) == {'dialogue': 24}   # character_simulation.act
    assert Counter(i['input']['set'] for i in data['simulation.narrate']) == {'narration': 24, 'monologue': 22}   # character_simulation.narrate
    for name in SIMULATION:
        for it in data[name]:
            source, judge = it['metadata']['source'], it['metadata']['judge']
            assert it['id'].startswith(name + '-') and isinstance(it['input']['data'], dict) and it['expectedOutput'].strip()
            assert {'work', 'author', 'origin', 'license', 'episode'} <= set(source) and (source['license'].startswith('저작권 만료') or source['license'] == 'CC BY-SA 3.0')
            assert '해리 포터' not in source['work']   # 해리 포터 문항은 저작권이 있어 저장소에 없다
            ids = [f['id'] for f in judge['facts']]   # 채점 입력: 인물·직전 장면·시점 위반 정답표(원문 평가와 같다)
            assert isinstance(judge['character'], str) and (judge['character'] or it['input']['set'] == 'narration')
            assert all(isinstance(line['by'], str) and isinstance(line['text'], str) for line in judge['scene']) and len(ids) == len(set(ids))
            assert all(isinstance(f['text'], str) and f['text'] for f in judge['facts'])
        contents = [(json.dumps(it['input'], ensure_ascii=False, sort_keys=True), it['expectedOutput']) for it in data[name]]
        assert len(set(contents)) == len(contents)   # 같은 문항을 두 번 싣지 않는다(평균에 두 배 가중치가 붙는다)


def test_the_extraction_set_is_expired_copyright_episodes_with_the_answer_table_the_code_scoring_reads():
    items = seed.load()['extraction.extract']

    assert len(items) >= 8 and len({it['input']['body'] for it in items}) == len(items)   # 같은 회차를 두 번 싣지 않는다(평균에 두 배 가중치가 붙는다)
    for it in items:
        source, gold, body = it['metadata']['source'], it['metadata']['gold'], it['input']['body']
        assert it['id'].startswith('extraction.extract-') and set(it['input']) == {'number', 'title', 'body'} and body.strip()   # 운영이 모델에 보내는 값 그대로
        assert {'work', 'author', 'origin', 'license', 'episode'} <= set(source) and source['license'].startswith('저작권 만료') and it['metadata']['license'] == source['license']
        assert gold['model'] == 'gpt-6.2-sol' and gold['runs'] == ['A', 'B'] and set(gold['agreement']) == {'mentions', 'statements', 'relationships'}
        table = extraction.Gold.model_validate(it['expectedOutput'])
        assert any(m.core for m in table.mentions) and all(body.count(s.quote) == 1 for s in table.statements)   # 정답 인용은 원문에 정확히 한 번 있다
        assert [m.name for m in table.mentions] and all(m.name.strip() for m in table.mentions)


def test_the_extraction_set_has_nothing_of_the_local_only_harry_potter_text():
    text = (seed.DATASETS / 'extraction.extract.jsonl').read_text(encoding='utf-8')

    assert not any(word in text for word in ('해리 포터', '호그와트', '덤블도어', '헤르미온느', '볼드모트'))   # 번역본은 저작권이 있어 로컬 오프라인 평가 전용이다


def test_register_is_idempotent():
    langfuse = Langfuse()

    first = seed.register(langfuse)
    state = (dict(langfuse.datasets), dict(langfuse.items))
    second = seed.register(langfuse)

    assert first == second and set(first) == NAMES
    assert (langfuse.datasets, langfuse.items) == state and len(langfuse.items) == sum(first.values())


def test_register_sends_the_fixed_item_id_input_expected_output_and_metadata():
    langfuse = Langfuse()

    seed.register(langfuse)

    name, input, expected, metadata = langfuse.items['qa.grounding-01']
    assert (name, expected) == ('qa.grounding', seed.load()['qa.grounding'][0]['expectedOutput'])
    assert input['question'] and metadata['source']['work'] == '홍길동전'
    name, input, expected, metadata = langfuse.items['simulation.act-01']
    assert (name, input['set'], expected) == ('simulation.act', 'dialogue', seed.load()['simulation.act'][0]['expectedOutput']) and metadata['judge']['facts'] is not None


def test_main_needs_langfuse_keys(monkeypatch):
    monkeypatch.delenv('LANGFUSE_PUBLIC_KEY', raising=False)
    monkeypatch.delenv('LANGFUSE_SECRET_KEY', raising=False)

    with pytest.raises(SystemExit) as error:
        seed.main()

    assert 'LANGFUSE_PUBLIC_KEY' in str(error.value)
