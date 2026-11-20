"""품질 실행기 단위 테스트: 모델·채점 대역으로 인물 턴 경로의 시도·검사·재생성·채점·장부·이어 받기를 확인한다. OpenAI 호출이 없다."""

import json
import threading
import time
from types import SimpleNamespace

import pytest

import sim_quality as q
import sim_worlds as w
from app.simulation import agent, service
from app.simulation.errors import SimulationFailure
from app.simulation.models import Action, CheckItem, Verdict
from app.simulation.prompt import FEEDBACK
from cost import CostLog, usd
from llm import CallCapExceeded, LlmFailure
from timechara import parse_tables

UTILS = """
character_period_harry_potter = {"at the end of the scene": ['1-17', '2-18', '3-22', '4-37', '5-38', '6-30', '7-36']}
character_period_the_lord_of_the_rings = {}
character_period_twilight = {}
character_period_hunger_games = {}
"""


def row(summary, qp, data_type, question, participants="['Harry Potter']"):
    return {'series': 'harry_potter', 'character': 'Harry Potter', 'character_period': '3rd-year', 'question_period': qp, 'event_summary': summary,
            'participants': participants, 'question_generation': 'fact-structured', 'data_type': data_type, 'question': question,
            'temporal_label': 't-fact', 'spatial_label': 's-fact'}


ROWS = [dict(r, idx=i) for i, r in enumerate([
    row('Harry met Sirius.', 'Book3-chapter19', 'past-presence', 'What did you do in the Shack?'),
    row('Harry fought Umbridge.', 'Book5-chapter2', 'future', 'Who is Umbridge?'),
    row('Harry flew a broom.', 'Book1-chapter9', 'past-only', 'Can you fly?'),
])]
TEMPLATES = {'spatiotemporal': 'ST:{agent_name}|{question_0}|{answer_0}|{agent_fact_0}', 'personality': 'PE:{agent_name}|{question_0}|{response_0}|{agent_personality}'}


@pytest.fixture
def worlds():
    return w.Worlds(ROWS, parse_tables(UTILS))


class Judge:
    """채점 모델 대역(Llm 모양): 답에 LEAK이 들어 있으면 시공간 0, 아니면 1이고 성격은 5다. 호출한 입력을 모은다."""

    def __init__(self, cost, fail=False):
        self.cost, self.calls, self.fail = cost, [], fail

    def ask(self, kind, instructions, input, max_output_tokens):
        self.calls.append(input)
        if self.fail:
            raise LlmFailure('transient')
        return 'reasoning\n5' if input.startswith('PE:') else f"reasoning\n{0 if 'LEAK' in input else 1}"


@pytest.fixture
def judge(tmp_path):
    return Judge(CostLog(tmp_path / 'cost.jsonl'))


def act_returns(monkeypatch, *proses):
    """agent.act 대역: 호출마다 다음 문장(마지막은 반복)을 돌려주고 입력을 모으며 호출 하나의 사용량을 MODEL_EVENT로 알린다."""
    seen, queue = [], list(proses)

    def act(data):
        seen.append(data)
        agent._report('act', time.monotonic(), SimpleNamespace(input_tokens=1000, output_tokens=200), failed=False)
        return Action(prose=queue.pop(0) if len(queue) > 1 else queue[0], observed='he spoke', refusesBeat=False, refusalReason=None)

    monkeypatch.setattr(agent, 'act', act)
    return seen


def check_returns(monkeypatch, *fails):
    """agent.check 대역: 호출마다 다음 위반 종류 튜플(마지막은 반복)로 요청된 검사마다 한 항목씩 판정한다."""
    seen, queue = [], list(fails)

    def check(payload):
        seen.append(payload)
        agent._report('check', time.monotonic(), SimpleNamespace(input_tokens=3000, output_tokens=100), failed=False)
        failed = queue.pop(0) if len(queue) > 1 else queue[0]
        return Verdict(checks=[CheckItem(kind=k, passed=k not in failed, detail='d', refs=[]) for k in payload['checks']], beatDone=False, sceneComplete=False)

    monkeypatch.setattr(agent, 'check', check)
    return seen


# --- 한 질문의 인물 턴: 운영과 같은 순서의 시도·검사·재생성 ---------------------------------------------------------------------

def test_an_answer_that_passes_the_check_is_the_only_attempt_and_the_input_is_what_production_builds(monkeypatch, worlds):
    acts, checks = act_returns(monkeypatch, 'Harry shrugged. "I went there with Sirius."'), check_returns(monkeypatch, ())
    attempts = q.generate(*worlds.interview(ROWS[0]))
    assert attempts == [{'prose': 'Harry shrugged. "I went there with Sirius."', 'failed': []}] and len(acts) == len(checks) == 1
    assert 'feedback' not in acts[0] and acts[0]['actionStyle']['person'] == 'third' and acts[0]['scene'][0]['text'] == ROWS[0]['question']
    assert checks[0]['checks'] == ['knowledge_leak', 'voice_mix', 'relation', 'premise'] and checks[0]['paragraph'] == attempts[0]['prose']
    assert 'Umbridge' in json.dumps(checks[0]['forbidden']) and 'Umbridge' not in json.dumps(acts[0])  # 금지 목록(기준 회차 뒤 기억)은 검사에만 간다


def test_a_violation_is_rewritten_with_the_fixed_notice_at_most_twice(monkeypatch, worlds):
    acts = act_returns(monkeypatch, 'A.', 'B.', 'C.')
    check_returns(monkeypatch, ('knowledge_leak',), ('voice_mix', 'relation'), ())
    attempts = q.generate(*worlds.interview(ROWS[0]))
    assert [(a['prose'], a['failed']) for a in attempts] == [('A.', ['knowledge_leak']), ('B.', ['voice_mix', 'relation']), ('C.', [])]
    assert 'feedback' not in acts[0] and acts[1]['feedback'] == [FEEDBACK['knowledge_leak']]
    assert acts[2]['feedback'] == [FEEDBACK['voice_mix'], FEEDBACK['relation']]


def test_an_answer_the_check_never_accepts_stops_after_the_regeneration_limit(monkeypatch, worlds):
    act_returns(monkeypatch, 'X.')
    check_returns(monkeypatch, ('knowledge_leak',))
    attempts = q.generate(*worlds.interview(ROWS[0]))
    assert len(attempts) == service.REGENERATIONS + 1 and all(a['failed'] == ['knowledge_leak'] for a in attempts)


def test_the_server_rules_catch_a_first_person_action_before_the_check_model_is_asked(monkeypatch, worlds):
    acts, checks = act_returns(monkeypatch, '저는 그곳에 갔다.', 'He went there.'), check_returns(monkeypatch, ())
    attempts = q.generate(*worlds.interview(ROWS[0]))
    assert [a['failed'] for a in attempts] == [['voice_mix'], []] and len(acts) == 2 and len(checks) == 1
    assert acts[1]['feedback'] == [FEEDBACK['voice_mix']]


def test_a_verdict_that_does_not_fit_the_request_is_an_error_not_a_pass(monkeypatch, worlds):
    act_returns(monkeypatch, 'A.')
    monkeypatch.setattr(agent, 'check', lambda payload: Verdict(checks=[], beatDone=False, sceneComplete=False))
    with pytest.raises(SimulationFailure) as error:
        q.generate(*worlds.interview(ROWS[0]))
    assert error.value.status == 502


# --- 한 질문의 기록: 채점·장부 ---------------------------------------------------------------------------------------------

def test_a_record_grades_the_first_answer_and_the_final_one_and_keeps_what_the_check_did(monkeypatch, worlds, judge):
    act_returns(monkeypatch, 'LEAK Harry told everything.', 'Harry kept quiet.')
    check_returns(monkeypatch, ('knowledge_leak',), ())
    record = q.evaluate(ROWS[0], worlds, judge, TEMPLATES, {'Harry Potter': 'brave'})
    assert (record['idx'], record['data_type'], record['attempts'], record['flagged'], record['leakFlagged'], record['blocked'], record['error']) == (
        0, 'past-presence', 2, True, True, False, None)
    assert record['first'] == {'score': 0, 'personality': 5} and record['final'] == {'score': 1, 'personality': 5}
    assert record['responses'] == {'first': 'LEAK Harry told everything.', 'final': 'Harry kept quiet.'}
    assert len(judge.calls) == 2 + 3  # 첫 응답: 공간 0이라 시간은 안 묻고 성격 1 / 최종 응답: 공간·시간·성격
    assert all('Harry' in call for call in judge.calls) and any('brave' in call for call in judge.calls)


def test_a_record_says_which_path_the_model_calls_went_through(monkeypatch, worlds, judge):
    act_returns(monkeypatch, 'Harry shrugged.')
    check_returns(monkeypatch, ())
    assert q.evaluate(ROWS[0], worlds, judge, TEMPLATES, {})['via'] == 'openai'   # via가 없는 Llm은 OpenAI
    judge.via = 'ocx'
    assert q.evaluate(ROWS[0], worlds, judge, TEMPLATES, {})['via'] == 'ocx'


def test_an_answer_that_needs_no_rewrite_is_graded_once(monkeypatch, worlds, judge):
    act_returns(monkeypatch, 'Harry shrugged.')
    check_returns(monkeypatch, ())
    record = q.evaluate(ROWS[1], worlds, judge, TEMPLATES, {'Harry Potter': 'brave'})
    assert (record['attempts'], record['flagged'], record['blocked']) == (1, False, False) and record['first'] == record['final']
    assert len(judge.calls) == 2  # future 유형: 시간 1번 + 성격 1번


def test_no_personality_text_means_no_personality_score_and_a_blocked_answer_is_marked(monkeypatch, worlds, judge):
    act_returns(monkeypatch, 'X.')
    check_returns(monkeypatch, ('knowledge_leak',))
    record = q.evaluate(ROWS[2], worlds, judge, TEMPLATES, {})
    assert record['blocked'] and record['attempts'] == 3 and record['first']['personality'] is None and record['final']['score'] == 1


def test_every_model_call_of_the_run_goes_to_the_cost_ledger(monkeypatch, worlds, judge):
    act_returns(monkeypatch, 'A.', 'B.')
    check_returns(monkeypatch, ('relation',), ())
    record = q.evaluate(ROWS[0], worlds, judge, TEMPLATES, {})
    assert record['flagged'] and not record['leakFlagged']  # 호칭 위반은 위반이지만 누설 적발이 아니다
    rows = judge.cost.rows()
    assert [r['kind'] for r in rows] == ['act', 'check', 'act', 'check'] and judge.cost.spent() == pytest.approx(2 * usd(1000, 200) + 2 * usd(3000, 100))


def test_a_failing_model_call_is_a_recorded_error_and_not_graded(monkeypatch, worlds, judge):
    def act(data):
        raise SimulationFailure(503, '고정 문구')

    monkeypatch.setattr(agent, 'act', act)
    record = q.evaluate(ROWS[0], worlds, judge, TEMPLATES, {})
    assert (record['error'], 'first' in record, judge.calls) == (503, False, [])


def test_a_judge_failure_leaves_the_score_empty_instead_of_inventing_one(monkeypatch, worlds, tmp_path):
    act_returns(monkeypatch, 'A.')
    check_returns(monkeypatch, ())
    record = q.evaluate(ROWS[1], worlds, Judge(CostLog(tmp_path / 'c.jsonl'), fail=True), TEMPLATES, {'Harry Potter': 'brave'})
    assert record['first'] == {'score': None, 'personality': None}


# --- 실행: 이어 받기·금액 상한 -----------------------------------------------------------------------------------------------

def test_a_run_appends_each_finished_question_and_resumes_without_generating_them_again(monkeypatch, worlds, judge, tmp_path):
    acts = act_returns(monkeypatch, 'ok.')
    check_returns(monkeypatch, ())
    out = tmp_path / 'runs' / 'quality-A.jsonl'
    first = q.run_quality(ROWS[:2], worlds, judge, TEMPLATES, {}, limit_usd=10, workers=2, out=out, question_usd=0.05)
    assert [r['idx'] for r in first] == [0, 1] and len(out.read_text().splitlines()) == 2 and len(acts) == 2
    again = q.run_quality(ROWS[:3], worlds, judge, TEMPLATES, {}, limit_usd=10, workers=2, out=out, question_usd=0.05)
    assert [r['idx'] for r in again] == [0, 1, 2] and len(acts) == 3 and len(out.read_text().splitlines()) == 3  # 새 질문 하나만 돌렸다


def test_a_run_stops_before_starting_a_question_once_the_cost_limit_is_reached(monkeypatch, worlds, judge, tmp_path):
    acts = act_returns(monkeypatch, 'ok.')
    check_returns(monkeypatch, ())
    judge.cost.record('earlier', 10_000_000, 0)  # 이미 $2를 썼다
    with pytest.raises(CallCapExceeded):
        q.run_quality(ROWS[:2], worlds, judge, TEMPLATES, {}, limit_usd=1, workers=1, out=tmp_path / 'q.jsonl', question_usd=0.05)
    assert acts == []


def test_a_run_starts_a_question_only_if_the_ones_already_in_flight_cannot_push_the_total_over_the_limit(monkeypatch, worlds, judge, tmp_path):
    # 진행 중인 질문의 비용은 끝나야 장부에 남는다: 새 질문은 '장부 + 동시 수 × 질문당 최대 금액'이 상한 안일 때만 시작한다.
    together = threading.Barrier(4)

    def evaluate(row, worlds, llm, templates, personalities):
        if row['idx'] < 4:
            together.wait(timeout=10)  # 처음 네 질문이 모두 진행 중인 채로 비용이 남는다
        llm.cost.record('act', 0, 250_000)  # 질문마다 정확히 $0.30(질문당 최대 금액과 같다)
        return {'idx': row['idx'], 'data_type': row['data_type'], 'error': None}

    monkeypatch.setattr(q, 'evaluate', evaluate)
    rows = [dict(ROWS[0], idx=i) for i in range(8)]
    with pytest.raises(CallCapExceeded):
        q.run_quality(rows, worlds, judge, TEMPLATES, {}, limit_usd=2.0, workers=4, out=tmp_path / 'q.jsonl', question_usd=0.30)
    assert judge.cost.spent() <= 2.0  # 동시에 진행하던 질문이 끝나도 상한 안이다(여유가 없으면 여덟 질문이 모두 시작해 2.4가 된다)
    assert len((tmp_path / 'q.jsonl').read_text().splitlines()) < 8
