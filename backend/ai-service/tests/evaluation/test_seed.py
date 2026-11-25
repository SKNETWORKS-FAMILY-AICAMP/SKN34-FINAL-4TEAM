import json
from collections import Counter
from types import SimpleNamespace

import pytest

from app.evaluation import extraction, seed
from app.optimization import service

PUBLIC = {'qa.grounding', 'world.conflict', 'writing.fix', 'leak.spoiler'}
SIMULATION = {'simulation.act', 'simulation.narrate'}
EXTRACTION = {'extraction.extract'}
POOLS = {'optimize.simulation.act', 'optimize.simulation.narrate', 'optimize.extraction.extract'}   # 최적화 풀(#868): Langfuse에는 optimize.<게이트 세트 이름>으로 올라간다
NAMES = PUBLIC | SIMULATION | EXTRACTION | POOLS


@pytest.fixture(autouse=True)
def offline(monkeypatch):
    """Langfuse 키가 주입된 셸에서도 풀 읽기(service.load_pool)는 저장소 파일이다."""
    monkeypatch.delenv('LANGFUSE_PUBLIC_KEY', raising=False)
    monkeypatch.delenv('LANGFUSE_SECRET_KEY', raising=False)


class Langfuse:
    """Langfuse upsert 대역: dataset은 이름, 항목은 id가 같으면 덮어쓴다. get_dataset은 SDK처럼 그 세트의 항목을 한 번에 돌려주고(id·input·expected_output·metadata),
    읽은 세트 이름(reads)과 올린 항목 id(writes)를 순서대로 남긴다. 지우는 메서드는 없다(지우려 하면 AttributeError)."""

    def __init__(self):
        self.datasets, self.items, self.reads, self.writes = {}, {}, [], []

    def create_dataset(self, *, name):
        self.datasets[name] = name

    def get_dataset(self, name):
        self.reads.append(name)
        return SimpleNamespace(items=[SimpleNamespace(id=id, input=input, expected_output=expected, metadata=metadata)
                                      for id, (dataset, input, expected, metadata) in self.items.items() if dataset == name])

    def create_dataset_item(self, *, dataset_name, id, input, expected_output, metadata):
        self.writes.append(id)
        self.items[id] = (dataset_name, input, expected_output, metadata)


def test_the_optimization_pools_are_seeded_as_datasets_named_optimize_dot_the_gate_set():
    data = seed.load()

    assert {name: len(data[name]) for name in POOLS} == {'optimize.simulation.act': 126, 'optimize.simulation.narrate': 54, 'optimize.extraction.extract': 157}
    for name in POOLS:   # 파일 하나가 Dataset 하나다: 항목 id는 풀 규칙(<게이트 세트>.opt-NNN), 풀이라 모두 train 또는 val이다
        assert all(it['id'].startswith(name.removeprefix('optimize.') + '.opt-') and it['metadata']['split'] in ('train', 'val') for it in data[name])


def test_no_pool_input_is_also_an_input_of_its_gate_set():
    """업로드가 같은 input을 거절하는 규칙(시험 문제를 학습에 섞지 않는다)의 바탕: 올라가는 기본 세트부터 게이트와 풀이 같은 input을 갖지 않는다."""
    data = seed.load()
    canonical = lambda it: json.dumps(it['input'], ensure_ascii=False, sort_keys=True)  # noqa: E731

    for gate in ('simulation.act', 'simulation.narrate', 'extraction.extract'):
        assert not {canonical(it) for it in data[gate]} & {canonical(it) for it in data[f'optimize.{gate}']}


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


POOL = seed.DATASETS / 'optimize' / 'extraction.extract.jsonl'   # 최적화 풀: seed가 optimize.extraction.extract Dataset으로 올린다
HARRY_POTTER = ('해리 포터', '호그와트', '덤블도어', '헤르미온느', '볼드모트')   # 번역본은 저작권이 있어 로컬 오프라인 평가 전용이다


def pool():
    return [json.loads(line) for line in POOL.read_text(encoding='utf-8').splitlines()]


def check_extraction_items(items, prefix):
    """게이트 세트·최적화 풀 공통: 저작권 만료 회차 + 채점 코드가 읽는 모양의 정답표. id는 prefix로 시작한다."""
    assert len({it['input']['body'] for it in items}) == len(items) and len({it['id'] for it in items}) == len(items)   # 같은 회차를 두 번 싣지 않는다(평균에 두 배 가중치가 붙는다)
    for it in items:
        source, gold, body = it['metadata']['source'], it['metadata']['gold'], it['input']['body']
        assert it['id'].startswith(prefix) and set(it['input']) == {'number', 'title', 'body'} and body.strip()   # 운영이 모델에 보내는 값 그대로
        assert {'work', 'author', 'origin', 'license', 'episode'} <= set(source) and source['license'].startswith('저작권 만료') and it['metadata']['license'] == source['license']
        assert gold['model'] == 'gpt-6.2-sol' and gold['runs'] == ['A', 'B'] and set(gold['agreement']) == {'mentions', 'statements', 'relationships'}
        table = extraction.Gold.model_validate(it['expectedOutput'])
        assert any(m.core for m in table.mentions) and all(body.count(s.quote) == 1 for s in table.statements)   # 정답 인용은 원문에 정확히 한 번 있다
        assert [m.name for m in table.mentions] and all(m.name.strip() for m in table.mentions)


def test_the_extraction_gate_set_is_about_thirty_episodes_stratified_over_works_and_authors():
    items = seed.load()['extraction.extract']
    check_extraction_items(items, 'extraction.extract-')

    works = Counter((it['metadata']['source']['author'], it['metadata']['source']['work']) for it in items)
    authors = Counter(it['metadata']['source']['author'] for it in items)
    assert [it['id'] for it in items] == [f'extraction.extract-{n:02d}' for n in range(1, 31)]   # 평가 1회 = 운영 모델 호출 30회
    assert len(works) >= 15 and max(works.values()) <= 3 and len(authors) >= 8 and max(authors.values()) / len(items) <= 0.25   # 한 작품·한 작가가 점수를 좌우하지 않는다


def test_the_extraction_optimization_pool_is_the_rest_of_the_public_episodes_in_the_shape_the_optimizer_reads():
    items = pool()
    check_extraction_items(items, 'extraction.extract.opt-')

    assert len(items) >= 30 and len(items) + len(seed.load()['extraction.extract']) >= 60   # 게이트와 합쳐 60회차 이상
    train, val = service.load_pool('extraction.extract')   # 자동 개선이 풀 파일 이름(게이트 세트 이름)으로 읽는다: metadata.split이 train·val
    assert len(val) == 20 and len(train) == len(items) - 20 and {it['metadata']['split'] for it in items} == {'train', 'val'}   # val 상한 20(시뮬레이션 풀과 같은 규칙)


def test_the_extraction_gate_set_and_the_pool_share_no_episode_and_no_text():
    gate, rest = seed.load()['extraction.extract'], pool()
    episode = lambda it: (it['metadata']['source']['work'], it['metadata']['source']['episode'])  # noqa: E731

    def shingles(items, size=40):   # 회차 본문의 size글자 조각(공백 제외): 한 조각이라도 겹치면 원문이 겹친 것이다
        texts = [''.join(it['input']['body'].split()) for it in items]
        return {text[k:k + size] for text in texts for k in range(len(text) - size + 1)}

    assert not ({it['id'] for it in gate} & {it['id'] for it in rest}) and not ({episode(it) for it in gate} & {episode(it) for it in rest})
    assert not (shingles(gate) & shingles(rest))   # 게이트가 손대지 않은 검증 세트로 남는다


def test_the_extraction_sets_have_nothing_of_the_local_only_harry_potter_text():
    for path in (seed.DATASETS / 'extraction.extract.jsonl', POOL):
        text = path.read_text(encoding='utf-8')

        assert not any(word in text for word in HARRY_POTTER)


def totals(stats):
    return {name: total for name, (total, _) in stats.items()}


def test_register_is_idempotent():
    langfuse = Langfuse()

    first = seed.register(langfuse)
    state = (dict(langfuse.datasets), dict(langfuse.items))
    second = seed.register(langfuse)

    assert set(first) == NAMES and totals(first) == totals(second)
    assert (langfuse.datasets, langfuse.items) == state and len(langfuse.items) == sum(totals(first).values())


def test_the_first_register_writes_every_item_and_a_second_one_writes_none():
    langfuse = Langfuse()

    first = seed.register(langfuse)
    written = list(langfuse.writes)
    second = seed.register(langfuse)

    assert all(total == done for total, done in first.values()) and len(written) == sum(totals(first).values())
    # 같은 id·input·expectedOutput·metadata는 다시 올리지 않는다: 올릴 때 Langfuse가 문항 시각을 바꾸면 배포마다 기준 Run이 무효가 되어 production을 다시 평가하게 된다.
    assert langfuse.writes == written and all(done == 0 for _, done in second.values())


def test_each_dataset_is_read_once_not_once_per_item():
    langfuse = Langfuse()

    seed.register(langfuse)

    assert Counter(langfuse.reads) == {name: 1 for name in NAMES}


@pytest.mark.parametrize('field', ['input', 'expected_output', 'metadata'])
def test_an_item_whose_content_differs_is_written_again_and_the_others_are_left(field):
    langfuse = Langfuse()
    seed.register(langfuse)
    target = 'simulation.act-01'
    dataset, input, expected, metadata = langfuse.items[target]
    fresh = {'input': input, 'expected_output': expected, 'metadata': metadata}
    stale = {**fresh, field: {'input': {**input, 'stale': True}, 'expected_output': 'stale', 'metadata': {**metadata, 'stale': True}}[field]}
    langfuse.items[target] = (dataset, stale['input'], stale['expected_output'], stale['metadata'])
    langfuse.writes.clear()

    stats = seed.register(langfuse)

    assert langfuse.writes == [target] and stats['simulation.act'][1] == 1   # 바뀐 문항만 올린다(내용이 바뀐 게이트 문항은 올려야 하고 그러면 기준 Run이 무효가 되는 것이 맞다)
    assert langfuse.items[target] == (dataset, input, expected, metadata)


def test_a_missing_item_is_written_and_items_that_only_langfuse_has_are_left_alone():
    langfuse = Langfuse()
    seed.register(langfuse)
    del langfuse.items['simulation.act-01']   # 아직 없거나 지워진 문항
    langfuse.items['simulation.act-uploaded'] = ('simulation.act', {'set': 'dialogue', 'data': {}}, '정답', {'uploaded': True})   # 운영 화면 업로드로 생긴 문항: 파일에 없다
    langfuse.writes.clear()

    seed.register(langfuse)

    assert langfuse.writes == ['simulation.act-01']
    assert 'simulation.act-uploaded' in langfuse.items   # 파일에 없는 문항은 지우지도 고치지도 않는다


def test_the_order_of_keys_is_not_a_difference():
    langfuse = Langfuse()
    seed.register(langfuse)
    target = 'simulation.act-01'
    dataset, input, expected, metadata = langfuse.items[target]
    reversed_keys = lambda value: json.loads(json.dumps(value), object_pairs_hook=lambda pairs: dict(reversed(pairs)))  # noqa: E731
    langfuse.items[target] = (dataset, reversed_keys(input), expected, reversed_keys(metadata))
    langfuse.writes.clear()

    seed.register(langfuse)

    assert langfuse.writes == []


def test_a_failure_reading_the_existing_items_is_not_hidden_and_nothing_is_written():
    class Down(Langfuse):
        def get_dataset(self, name):
            raise ConnectionError('Langfuse down')

    langfuse = Down()

    with pytest.raises(ConnectionError):
        seed.register(langfuse)

    assert langfuse.writes == []   # 같은지 알 수 없으면 올리지도 않는다


def test_register_puts_each_pool_item_in_its_own_optimize_dataset():
    langfuse = Langfuse()

    seed.register(langfuse)

    assert POOLS <= set(langfuse.datasets)
    name, input, expected, metadata = langfuse.items['simulation.act.opt-001']
    assert name == 'optimize.simulation.act' and metadata['split'] in ('train', 'val') and metadata['judge']['facts'] is not None
    assert langfuse.items['extraction.extract.opt-001'][0] == 'optimize.extraction.extract' and langfuse.items['extraction.extract-01'][0] == 'extraction.extract'


def test_register_sends_the_fixed_item_id_input_expected_output_and_metadata():
    langfuse = Langfuse()

    seed.register(langfuse)

    name, input, expected, metadata = langfuse.items['qa.grounding-01']
    assert (name, expected) == ('qa.grounding', seed.load()['qa.grounding'][0]['expectedOutput'])
    assert input['question'] and metadata['source']['work'] == '홍길동전'
    name, input, expected, metadata = langfuse.items['simulation.act-01']
    assert (name, input['set'], expected) == ('simulation.act', 'dialogue', seed.load()['simulation.act'][0]['expectedOutput']) and metadata['judge']['facts'] is not None


def test_main_prints_how_many_items_each_dataset_has_and_how_many_were_written(monkeypatch, capsys):
    langfuse = Langfuse()
    monkeypatch.setenv('LANGFUSE_PUBLIC_KEY', 'pk')
    monkeypatch.setenv('LANGFUSE_SECRET_KEY', 'sk')
    monkeypatch.setattr(seed.tracing, 'client', lambda: langfuse)

    seed.main()
    first = capsys.readouterr().out
    seed.main()
    second = capsys.readouterr().out

    total = len(seed.load()['simulation.act'])
    assert f'simulation.act: 항목 {total}개 중 {total}개 올림' in first
    assert f'simulation.act: 항목 {total}개 중 0개 올림' in second   # 두 번째 실행은 올린 것이 없다


def test_main_needs_langfuse_keys(monkeypatch):
    monkeypatch.delenv('LANGFUSE_PUBLIC_KEY', raising=False)
    monkeypatch.delenv('LANGFUSE_SECRET_KEY', raising=False)

    with pytest.raises(SystemExit) as error:
        seed.main()

    assert 'LANGFUSE_PUBLIC_KEY' in str(error.value)
