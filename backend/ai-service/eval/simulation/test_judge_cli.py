"""채점 보강 실행기(judge_cli): 재채점이 채점 방식마다 따로 기록하고 원본 기록은 건드리지 않는 것, 이어 받기, 말투 기준 제한을 가짜 채점 모델·작은 작품으로 확인한다."""

import argparse
import json

import pytest

import judge_cli as jc
import orig_judge as oj
import orig_run as rn
import sim_via
from test_orig_judge import ITEM, Many, FakeLlm, dialogue_record


@pytest.fixture
def home(tmp_path, monkeypatch):
    """hp 폴더에 문항 둘과 P1 실행 기록 둘(하나는 생성 실패)을 두고, 경로·세계관·채점 모델을 가짜로 바꾼다."""
    items = [ITEM, {**ITEM, 'id': 'hp-1-0008'}]
    (tmp_path / 'hp' / 'runs').mkdir(parents=True)
    records = [dialogue_record(), {**dialogue_record(id='hp-1-0008'), 'error': 503, 'generated': None, 'grade': None}]
    (tmp_path / 'hp' / 'runs' / '1-P1.jsonl').write_text('\n'.join(json.dumps(r, ensure_ascii=False) for r in records) + '\n')
    llm = FakeLlm(rn.DialogueGrade(voice=5, intent=1, leaked=[]))
    made = []
    monkeypatch.setattr(jc, 'ORIG', tmp_path)
    monkeypatch.setattr(jc, 'COST', tmp_path / 'cost.jsonl')
    monkeypatch.setattr(jc, 'RESULTS', tmp_path / 'results')   # 집계 파일도 임시 폴더에 쓴다(실제 results를 덮어쓰지 않는다)
    monkeypatch.setattr(jc, 'corpus_of', lambda name: Many())
    monkeypatch.setattr(jc, 'load_items', lambda corpus, key: items)
    monkeypatch.setattr(sim_via, 'ocx_llm', lambda cache, cost, model: made.append((cache, model)) or llm)
    return tmp_path, llm, made


def args(**changes):
    return argparse.Namespace(**{'corpus': 'hp', 'dev': False, 'sets': '1', 'tags': None, 'judge_model': 'gpt-6.2-sol', 'voice_ref': False, 'name': None, 'workers': 2, 'source': oj.LUNA, **changes})


def test_a_regrade_writes_the_new_graders_folder_with_its_own_cache_and_leaves_the_source_runs_alone(home):
    root, llm, made = home
    before = (root / 'hp' / 'runs' / '1-P1.jsonl').read_text()
    jc.cmd_regrade(args())
    out = rn.load_done(root / 'hp' / 'runs-gpt-6.2-sol' / '1-P1.jsonl')
    assert out['hp-1-0007']['grade'] == {'voice': 5, 'intent': 1, 'leaked': []} and out['hp-1-0007']['via']['judgeModel'] == 'gpt-6.2-sol'
    assert out['hp-1-0008']['error'] == 503 and out['hp-1-0008']['grade'] is None and len(llm.asked) == 1   # 생성이 없는 기록은 부르지 않고 그대로
    assert (root / 'hp' / 'runs' / '1-P1.jsonl').read_text() == before and made == [(root / 'cache-judge-gpt-6.2-sol', 'gpt-6.2-sol')]
    jc.cmd_regrade(args())   # 이어 받기: 이미 있는 문항은 다시 채점하지 않는다
    assert len(llm.asked) == 1


def test_a_regrade_never_targets_the_source_folder_and_the_voice_ref_pass_is_for_dialogue_only(home):
    for bad in (args(judge_model=oj.LUNA), args(voice_ref=True, sets='1,3n')):
        with pytest.raises(SystemExit):
            jc.cmd_regrade(bad)
    jc.cmd_regrade(args(judge_model=oj.LUNA, name='luna-retest'))   # 같은 모델의 재채점은 다른 이름이면 된다
    assert (home[0] / 'hp' / 'runs-luna-retest' / '1-P1.jsonl').exists() and home[2][-1][0] == home[0] / 'cache-judge-luna-retest'



def test_a_regrade_that_failed_is_redone_on_the_next_run_and_good_or_error_records_are_kept(home):
    root, llm, made = home
    jc.cmd_regrade(args())
    target = root / 'hp' / 'runs-gpt-6.2-sol' / '1-P1.jsonl'
    rows = [json.loads(line) for line in target.read_text().splitlines()]
    target.write_text('\n'.join(json.dumps({**r, 'grade': None} if r['id'] == 'hp-1-0007' else r, ensure_ascii=False) for r in rows) + '\n')   # 첫 문항의 채점이 실패했던 것으로
    llm.answer = rn.DialogueGrade(voice=2, intent=2, leaked=[])
    jc.cmd_regrade(args())
    again = rn.load_done(target)
    assert again['hp-1-0007']['grade'] == {'voice': 2, 'intent': 2, 'leaked': []} and again['hp-1-0008']['error'] == 503 and len(llm.asked) == 2


def test_a_pair_judged_with_a_failed_call_is_asked_again_on_the_next_run(home, monkeypatch):
    root, llm, made = home
    other = [{**dialogue_record(), 'generated': '"기준 글."'}, {**dialogue_record(id='hp-1-0008'), 'generated': '"기준 글 둘."'}]
    (root / 'hp' / 'runs' / '1-base2.jsonl').write_text('\n'.join(json.dumps(r, ensure_ascii=False) for r in other) + '\n')
    act = {'provider': 'hemmingway.io', 'model': 'hemmingway-1', 'thinking': 'off'}
    via = {'sut': 'openai', 'judge': 'ocx', 'act': act}   # 후보(P1)는 act 제공사로 만든 기록이다
    (root / 'hp' / 'runs' / '1-P1.jsonl').write_text('\n'.join(json.dumps(r, ensure_ascii=False) for r in [dialogue_record(via=via), {**dialogue_record(id='hp-1-0008', via=via), 'generated': '"후보 글 둘."'}]) + '\n')
    calls = []

    def answer(payload):
        calls.append(payload['A'])
        if len(calls) <= 2:   # 첫 문항의 두 호출이 모두 실패한다
            raise oj.LlmFailure('호출 실패')
        return oj.PairChoice(winner='A' if payload['A'] in ('"열쇠를 찾았어."', '"후보 글 둘."') else 'B')   # 후보 글이 있는 쪽을 고른다

    llm.answer = answer
    pair = argparse.Namespace(corpus='hp', dev=False, set='1', pairs=['P1:base2'], judge_model='gpt-6.2-sol', name=None, workers=1, source=oj.LUNA)
    jc.cmd_judge_pair(pair)
    done = rn.load_done(root / 'hp' / 'pairs-gpt-6.2-sol' / '1-P1-vs-base2.jsonl')
    assert done['hp-1-0007']['outcome'] is None and done['hp-1-0008']['outcome'] == 1
    jc.cmd_judge_pair(pair)
    done = rn.load_done(root / 'hp' / 'pairs-gpt-6.2-sol' / '1-P1-vs-base2.jsonl')
    assert done['hp-1-0007']['outcome'] == 1 and done['hp-1-0008']['outcome'] == 1 and len(calls) == 6   # 실패한 문항만 다시(두 호출), 끝낸 문항은 그대로
    saved = json.loads((root / 'results' / 'orig-hp-pairwise-gpt-6.2-sol.json').read_text())
    tally = saved['pairs']['P1 vs base2']
    assert tally['wins'] == 2 and saved['refItems'] == 2 and tally['withRef']['wins'] == 2 and tally['noRef']['n'] == 0   # 말투 기준 줄이 있는 문항과 없는 문항을 따로도 센다
    assert saved['acts'] == {'P1': act}   # act 제공사로 만든 후보는 provider·model을 결과에 남긴다(OpenAI 기본 경로의 기준은 표기가 없다)



def test_generations_stored_under_another_graders_folder_are_read_through_source(home):
    root, llm, made = home
    sol = root / 'hp' / 'runs-gpt-6.2-sol'
    sol.mkdir()
    (root / 'hp' / 'runs' / '1-P1.jsonl').rename(sol / '1-P1.jsonl')   # run --judge-model gpt-6.2-sol이 만든 후보는 그 채점 폴더에만 있다
    jc.cmd_regrade(args(judge_model=oj.LUNA, name='luna-regrade', source='gpt-6.2-sol'))
    assert rn.load_done(root / 'hp' / 'runs-luna-regrade' / '1-P1.jsonl')['hp-1-0007']['grade'] == {'voice': 5, 'intent': 1, 'leaked': []}
    with pytest.raises(SystemExit):   # 읽는 폴더에 다시 쓰면 생성 기록을 덮어쓴다
        jc.cmd_regrade(args(judge_model='gpt-6.2-sol', source='gpt-6.2-sol'))
    for tag, text in (('P1', '"소스 후보."'), ('base2', '"소스 기준."')):
        (sol / f'1-{tag}.jsonl').write_text(json.dumps({**dialogue_record(), 'generated': text}, ensure_ascii=False) + '\n')
    llm.answer = lambda payload: oj.PairChoice(winner='A')
    jc.cmd_judge_pair(argparse.Namespace(corpus='hp', dev=False, set='1', pairs=['P1:base2'], judge_model='gpt-6.2-sol', name=None, workers=1, source='gpt-6.2-sol'))
    assert {(p['A'], p['B']) for _, _, p, _ in llm.asked[-2:]} == {('"소스 후보."', '"소스 기준."'), ('"소스 기준."', '"소스 후보."')}


def test_agree_compares_each_named_pair_of_graders_on_the_same_runs_and_writes_one_file(home, monkeypatch):
    root, llm, made = home

    def write_runs(folder, voices):
        (root / 'hp' / folder).mkdir(exist_ok=True)
        for tag, voice in voices.items():
            rows = [{**dialogue_record(id=f'hp-1-000{i}', variant=tag), 'grade': {'voice': voice[i], 'intent': 3, 'leaked': []}} for i in range(4)]
            (root / 'hp' / folder / f'1-{tag}.jsonl').write_text('\n'.join(json.dumps(r, ensure_ascii=False) for r in rows) + '\n')

    write_runs('runs', {'base2': [2, 3, 3, 4], 'P1': [3, 4, 4, 5]})
    write_runs('runs-gpt-6.2-sol', {'base2': [3, 3, 4, 5], 'P1': [4, 4, 5, 5]})
    write_runs('runs-luna-retest', {'base2': [2, 3, 4, 4], 'P1': [3, 4, 4, 4]})
    jc.cmd_agree(argparse.Namespace(corpus='hp', dev=False, pairs=['gpt-6-luna:gpt-6.2-sol', 'gpt-6-luna:luna-retest'], base='base2', sets='1'))
    saved = json.loads((root / 'results' / 'orig-hp-agreement.json').read_text())
    assert saved['base'] == 'base2' and set(saved['pairs']) == {'gpt-6-luna vs gpt-6.2-sol', 'gpt-6-luna vs luna-retest'}
    sol = saved['pairs']['gpt-6-luna vs gpt-6.2-sol']['1']
    assert sol['items']['voice']['n'] == 8 and sol['pairs']['P1']['voice']['sameDirection'] is True and sol['ranking']['voice']['rankA'] == {'P1': 1, 'base2': 2}
