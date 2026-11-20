import pytest

from app.evaluation import seed

NAMES = {'qa.grounding', 'world.conflict', 'writing.fix', 'leak.spoiler'}


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
    for name, items in data.items():
        assert 5 <= len(items) <= 10
        for it in items:
            source = it['metadata']['source']
            assert it['id'].startswith(name + '-') and isinstance(it['input'], dict)
            assert {'work', 'author', 'origin', 'sample'} <= set(source) and '저작권 만료' in source['origin']
            if name == 'qa.grounding':
                assert it['input']['question'] and it['input']['contexts'] and all(isinstance(c, str) and c for c in it['input']['contexts'])
            else:
                assert it['metadata']['criteria'].strip()


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


def test_main_needs_langfuse_keys(monkeypatch):
    monkeypatch.delenv('LANGFUSE_PUBLIC_KEY', raising=False)
    monkeypatch.delenv('LANGFUSE_SECRET_KEY', raising=False)

    with pytest.raises(SystemExit) as error:
        seed.main()

    assert 'LANGFUSE_PUBLIC_KEY' in str(error.value)
