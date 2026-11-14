"""추출 실행 단위 테스트: 라벨·세계관·전해 들은 인물이 라운드로 이어지고 검증을 거쳐 지식표·세계관이 만들어지는지(대역 클라이언트, 네트워크 없음)."""

import json
from types import SimpleNamespace

from batch import SyncExecutor, run_rounds
from cost import CostLog
from kt_extract import extractor, finish, summarize_extraction
from kt_label import EpisodeLabel, Ev, Learn, LearnedLabel, Ref
from kt_world import WChar, WEvent, WorldOut, load_world
from llm import Ledger, Llm

EP1 = '철수는 영희에게 칼을 건넸다. 민수는 멀리서 그 모습을 지켜보았다.'
EP2 = '길동은 철수가 칼을 건넸다는 소문을 들었다. 철수는 먼 길을 떠났다.'
WORKS = {'w00': {'id': 'w00', 'episodes': [{'number': 1, 'title': '', 'text': EP1}, {'number': 2, 'title': '', 'text': EP2}]}}


class Fake:
    """responses.parse 대역: 입력과 스키마에 따라 정해진 출력을 낸다."""

    def __init__(self):
        self.calls = []
        self.responses = SimpleNamespace(parse=self._parse)

    def _parse(self, **kw):
        schema, text = kw['text_format'], kw['input']
        self.calls.append(schema.__name__)
        if schema is LearnedLabel:
            out = LearnedLabel(learned=[Learn(event='E1.1', learner='길동', evidence='길동은 철수가 칼을 건넸다는 소문을 들었다.')])
        elif schema is EpisodeLabel and text == EP1:
            out = EpisodeLabel(events=[Ev(summary='철수가 영희에게 칼을 건넸다.', evidence='철수는 영희에게 칼을 건넸다.',
                                          participants=[Ref(name='철수', evidence='철수는 영희에게 칼을 건넸다.')],
                                          witnesses=[Ref(name='민수', evidence='민수는 멀리서 그 모습을 지켜보았다.')])])
        elif schema is EpisodeLabel:
            out = EpisodeLabel(events=[Ev(summary='철수가 먼 길을 떠났다.', evidence='철수는 먼 길을 떠났다.',
                                          participants=[Ref(name='철수', evidence='철수는 먼 길을 떠났다.')], witnesses=[])])
        else:
            out = WorldOut(characters=[WChar(name='철수', role='검객', memory='행동했다.'), WChar(name='영희', role='처녀', memory='')]
                           if text == EP1 else [WChar(name='철수', role='', memory='떠났다.')],
                           events=[WEvent(title='사건', summary='철수가 무언가를 했다는 사건.', participants=['철수'])], relations=[])
        usage = SimpleNamespace(input_tokens=10, output_tokens=5, input_tokens_details=SimpleNamespace(cached_tokens=0))
        return SimpleNamespace(status='completed', usage=usage, model='m', output_parsed=out)


def run(tmp_path):
    fake = Fake()
    llm = Llm(Ledger(tmp_path / 'ledger.jsonl', 10 ** 6), tmp_path / 'cache', model='m', client=fake, backoff=0, cost=CostLog(tmp_path / 'cost.jsonl'))
    tasks = [('w00', 1), ('w00', 2)]
    return run_rounds(tasks, extractor(WORKS), llm, SyncExecutor(llm)), fake, llm


def test_extractor_runs_labels_and_world_first_then_learned_with_verified_results(tmp_path):
    records, fake, _ = run(tmp_path)
    assert fake.calls.count('EpisodeLabel') == 2 and fake.calls.count('WorldOut') == 2 and fake.calls.count('LearnedLabel') == 1
    first, second = records
    assert [e['id'] for e in first['events']] == ['E1.1'] and first['learned'] == []
    assert second['learned'] == [{'event': 'E1.1', 'learner': '길동', 'episode': 2, 'evidence': '길동은 철수가 칼을 건넸다는 소문을 들었다.'}]
    assert list(first['world']['characters']) == ['철수', '영희'] and second['stats']['learn']['learned_kept'] == 1
    assert not any(first['failed'].values()) and not any(second['failed'].values())


def test_finish_writes_knowledge_world_and_stats_per_work(tmp_path):
    records, _, _ = run(tmp_path)
    finish(WORKS, records, tmp_path / 'out')
    folder = tmp_path / 'out' / 'w00'
    knowledge = [json.loads(line) for line in (folder / 'knowledge.jsonl').read_text().splitlines()]
    assert [k['episode'] for k in knowledge] == [1, 2] and knowledge[1]['learned'][0]['learner'] == '길동'
    assert {c.title for c in load_world(folder / 'world.json')['cards'] if c.cardType == 'character'} == {'철수', '영희'}
    stats = json.loads((folder / 'extract_stats.json').read_text())
    assert stats['label']['events'] == 2 and stats['label']['kept'] == 2


def test_summarize_extraction_reports_evidence_pass_rate_and_failures():
    records = [{'stats': {'label': {'evidence_checked': 8, 'evidence_ok': 6, 'events': 3, 'kept': 2, 'refs': 5, 'refs_kept': 4},
                          'learn': {'evidence_checked': 2, 'evidence_ok': 1, 'learned': 2, 'learned_kept': 1}, 'world': {'characters': 4}},
                'failed': {'label': False, 'learn': True, 'world': False}}]
    summary = summarize_extraction(records)
    assert summary['evidence_pass_rate'] == 7 / 10 and summary['failed'] == {'label': 0, 'learn': 1, 'world': 0}
    assert summary['label']['events'] == 3 and summary['world']['characters'] == 4
