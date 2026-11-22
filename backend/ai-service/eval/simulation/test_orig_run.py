"""원문 기반 실행기(orig_run)의 순수 부분: 장면 조립, 채점 응답 검증, 연출·검사 판정, 집계, 짝 비교."""

import orig_run as orr
from app.simulation import service
from app.simulation.models import Decision, SimulationPlan, Verdict


def plan_of(*ids):
    return SimulationPlan(mode='flow', beats=[], characterIds=list(ids))


LINES = [{'kind': 'narration', 'by': '나레이션', 'text': '비가 왔다.', 'speaker': ''}, {'kind': 'dialogue', 'by': '해리', 'text': '"안녕."', 'speaker': '해리'},
         {'kind': 'dialogue', 'by': '화자 미상', 'text': '"응."', 'speaker': ''}, {'kind': 'monologue', 'by': '나레이션', 'text': '해리는 불안했다.', 'speaker': '해리'}]


def test_scene_of_builds_turns_and_hides_monologue():
    scene = orr.scene_of(plan_of('H'), LINES, {'해리': 'H'})
    assert [(t.kind, t.characterName, t.characterId) for t in scene.result.turns] == [('narration', '나레이션', None), ('character', '해리', 'H'), ('character', '화자 미상', None), ('monologue', '해리', 'H')]
    assert scene.result.turns[1].pov == 'limited:H' and scene.result.turns[0].pov == 'omniscient'
    assert [s['text'] for s in service.seen_lines(scene)] == ['비가 왔다.', '"안녕."', '"응."']   # 독백은 다른 인물에게 보이지 않는다
    assert scene.result.status == 'paused'


def test_parse_grade_validates_range_and_fact_ids():
    ok = orr.DialogueGrade(voice=4, intent=2, leaked=['f1'])
    assert orr.parse_grade(ok, ['f1', 'f2']) == {'voice': 4, 'intent': 2, 'leaked': ['f1']}
    assert orr.parse_grade(orr.DialogueGrade(voice=6, intent=2, leaked=[]), ['f1']) is None   # 범위 밖
    assert orr.parse_grade(orr.DialogueGrade(voice=3, intent=0, leaked=[]), ['f1']) is None
    assert orr.parse_grade(orr.DialogueGrade(voice=3, intent=3, leaked=['zzz']), ['f1']) is None   # 입력에 없는 id
    assert orr.parse_grade(orr.NarrationGrade(style=5, info=1, leaked=[]), []) == {'style': 5, 'info': 1, 'leaked': []}


CAST = [{'id': 'H', 'name': '해리'}, {'id': 'R', 'name': '론'}]


def test_direct_outcome_matches_kind_and_speaker():
    assert orr.direct_outcome({'kind': 'dialogue', 'speaker': '론'}, Decision(turn='speech', speaker='R', pov='limited:R'), CAST) == {'kind': 'dialogue', 'speaker': '론', 'ok': True}
    assert orr.direct_outcome({'kind': 'dialogue', 'speaker': '론'}, Decision(turn='speech', speaker='H', pov='limited:H'), CAST)['ok'] is False
    assert orr.direct_outcome({'kind': 'narration', 'speaker': ''}, Decision(turn='narration', speaker='H', pov='omniscient'), CAST) == {'kind': 'narration', 'speaker': '', 'ok': True}
    assert orr.direct_outcome({'kind': 'monologue', 'speaker': '해리'}, Decision(turn='monologue', pov='limited:H'), CAST) == {'kind': 'monologue', 'speaker': '해리', 'ok': True}
    assert orr.direct_outcome({'kind': 'monologue', 'speaker': '해리'}, Decision(turn='speech', speaker='H', pov='limited:H'), CAST)['ok'] is False


def test_check_outcome_rejects_on_any_failed_check_and_marks_leak():
    verdict = Verdict(checks=[{'kind': 'knowledge_leak', 'passed': False, 'detail': 'x', 'refs': []}, {'kind': 'voice_mix', 'passed': True, 'detail': 'y', 'refs': []}], beatDone=False, sceneComplete=False)
    assert orr.check_outcome(verdict) == {'rejected': True, 'failed': ['knowledge_leak'], 'leak': True}
    ok = Verdict(checks=[{'kind': 'relation', 'passed': True, 'detail': 'y', 'refs': []}], beatDone=False, sceneComplete=False)
    assert orr.check_outcome(ok) == {'rejected': False, 'failed': [], 'leak': False}


def act(i, voice, intent, leaked=(), work='a', tokens=100):
    return {'id': f'x{i}', 'kind': 'dialogue', 'work': work, 'workKind': 'modern', 'error': None, 'skipped': None, 'grade': {'voice': voice, 'intent': intent, 'leaked': list(leaked)},
            'usage': [{'name': 'act', 'ms': 1000 + i, 'failed': False, 'inputTokens': tokens, 'outputTokens': 10}]}


def test_summarize_dialogue_means_leak_rate_and_costs():
    records = [act(0, 4, 3), act(1, 2, 3, ['f']), {**act(2, 1, 1), 'grade': None}, {**act(3, 1, 1), 'skipped': 'leak', 'grade': None}, {**act(4, 1, 1), 'error': 502, 'grade': None}]
    got = orr.summarize_dialogue(records)
    assert got['n'] == 5 and got['skipped'] == 1 and got['errors'] == 1 and got['failedJudge'] == 1
    assert got['voice']['mean'] == 3.0 and got['intent']['mean'] == 3.0 and got['voice']['n'] == 2
    assert got['leak'] == {'n': 2, 'rate': 0.5, 'ci': got['leak']['ci']}
    assert got['inputTokens'] == 100 and got['callMs']['p50'] == 1001   # 호출당 입력 토큰 평균·지연 중앙값(채점된 문항의 act 호출)


def test_summarize_direct_confusion_and_accuracy():
    records = [{'id': 'a', 'gold': {'kind': 'dialogue', 'speaker': '해리'}, 'pred': {'kind': 'dialogue', 'speaker': '해리', 'ok': True}, 'error': None},
               {'id': 'b', 'gold': {'kind': 'dialogue', 'speaker': '해리'}, 'pred': {'kind': 'dialogue', 'speaker': '론', 'ok': False}, 'error': None},
               {'id': 'c', 'gold': {'kind': 'narration', 'speaker': ''}, 'pred': {'kind': 'dialogue', 'speaker': '론', 'ok': False}, 'error': None},
               {'id': 'd', 'gold': {'kind': 'monologue', 'speaker': '해리'}, 'pred': None, 'error': 503}]
    got = orr.summarize_direct(records)
    assert got['n'] == 4 and got['errors'] == 1 and got['exact']['rate'] == 1 / 3 and got['kind']['rate'] == 2 / 3
    assert got['speaker'] == {'n': 2, 'rate': 0.5, 'ci': got['speaker']['ci']}   # 정답이 대사·독백이고 종류를 맞춘 문항 중 화자
    assert got['confusion'] == {'dialogue>dialogue': 2, 'narration>dialogue': 1}


def check(i, label, rejected, leak=False, covered=True):
    return {'id': f'k{i}', 'label': label, 'error': None, 'verdict': {'rejected': rejected, 'failed': ['knowledge_leak'] if leak else [], 'leak': leak}, 'covered': covered, 'usage': []}


def test_summarize_check_accuracy_false_alarm_and_miss():
    records = [check(0, 'pass', False), check(1, 'pass', True), check(2, 'reject', True, True), check(3, 'reject', False), check(4, 'reject', True, False, covered=False)]
    got = orr.summarize_check(records)
    assert got['accuracy']['rate'] == 3 / 5 and got['falseAlarm'] == {'n': 2, 'rate': 0.5, 'ci': got['falseAlarm']['ci']} and got['miss']['rate'] == 1 / 3
    assert got['missLeakOnly']['rate'] == 2 / 3 and got['covered']['miss']['rate'] == 1 / 2   # 누설 항목만 본 놓침률, 금지 목록에 근거가 있던 주입만 본 놓침률
    assert got['falseAlarmLeakOnly'] == {'n': 2, 'rate': 0.0, 'ci': got['falseAlarmLeakOnly']['ci']} and got['accuracyLeakOnly']['rate'] == 3 / 5   # 누설 검사만 본 오경보율·정확도(말투 같은 다른 검사 때문에 거절된 것을 빼고 본다)


def test_paired_signs_per_item_and_skips_missing():
    a = {'x': 3, 'y': 5, 'z': None, 'w': 2}
    b = {'x': 4, 'y': 4, 'z': 1, 'w': 2}
    got = orr.paired(a, b)
    assert got == {'n': 3, 'up': 1, 'down': 1, 'tie': 1, 'p': 1.0, 'meanDiff': 0.0}   # a(후보)가 높으면 up


def test_metrics_of_and_compare_runs_pair_same_items():
    base = [act(0, 3, 3), act(1, 2, 2, ['f']), act(2, 4, 4)]
    cand = [act(0, 4, 3, tokens=60), act(1, 2, 3, tokens=60), {**act(2, 4, 4), 'error': 502, 'grade': None}]
    got = orr.compare_runs('1', base, cand)
    assert got['metrics']['voice'] == {'n': 2, 'up': 1, 'down': 0, 'tie': 1, 'p': 1.0, 'meanDiff': 0.5}   # 에러 난 문항은 짝에서 뺀다
    assert got['metrics']['intent']['up'] == 1 and got['metrics']['clean']['up'] == 1 and got['metrics']['clean']['down'] == 0   # 문항 1은 후보가 누설 없음(기준선은 누설)
    assert got['tokens'] == {'base': 100.0, 'cand': 60.0, 'ratio': 0.6}
    checks_base = [check(0, 'pass', False), check(1, 'reject', False), check(2, 'reject', True)]
    checks_cand = [check(0, 'pass', True), check(1, 'reject', True), check(2, 'reject', True)]
    got = orr.compare_runs('4', checks_base, checks_cand)
    assert got['metrics']['correct']['up'] == 1 and got['metrics']['correct']['down'] == 1 and got['metrics']['caught']['up'] == 1 and got['metrics']['passOk']['down'] == 1


def test_compare_runs_also_pairs_only_items_whose_input_changed():
    base = [{**act(0, 3, 3), 'inChars': 100}, {**act(1, 2, 2), 'inChars': 100}, {**act(2, 4, 4), 'inChars': 100}]
    cand = [{**act(0, 5, 3), 'inChars': 100}, {**act(1, 3, 2), 'inChars': 150}, {**act(2, 2, 4), 'inChars': 150}]   # 문항 0은 후보가 입력을 바꾸지 못해 같은 입력이다
    got = orr.compare_runs('1', base, cand)
    assert got['metrics']['voice']['n'] == 3 and got['metrics']['voice']['up'] == 2
    assert got['applied']['n'] == 2 and got['applied']['metrics']['voice'] == {'n': 2, 'up': 1, 'down': 1, 'tie': 0, 'p': 1.0, 'meanDiff': -0.5}   # 입력이 바뀐 문항만(1: +1, 2: -2)
