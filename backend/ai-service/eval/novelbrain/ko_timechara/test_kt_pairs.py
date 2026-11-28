"""시점 쌍 정확도 단위 테스트: 쌍 고르기 규칙·문항·응답 채점·집계·실행 흐름(합성 지식표와 대역 클라이언트, 소설 원문 없음)."""

import json
import random
from collections import Counter
from types import SimpleNamespace

import pytest

import kt_pairs
from app.novelbrain.models import Card
from batch import SyncExecutor, run_rounds
from cost import CostLog
from kt_context import ALL_CONFIGS, ITEM_KINDS
from kt_label import appearances
from kt_questions import pick_specs
from kt_run import ko_system_prompt
from llm import Ledger, Llm
from metrics import wilson_interval


def person(name):
    return {'name': name, 'evidence': f'{name}가 있었다.'}


def event(number, index, who, seen=()):
    return {'id': f'E{number}.{index}', 'episode': number, 'summary': f'{number}화의 {index}번째 사건이 일어났다.',
            'evidence': f'{number}화 {index}번 근거 문장입니다.', 'participants': [person(n) for n in who], 'witnesses': [person(n) for n in seen]}


PEOPLE = {1: ['철수', '영희'], 2: ['철수', '민수'], 3: ['영희', '민수'], 4: ['철수', '영희'], 5: ['철수', '민수'], 6: ['영희', '철수'], 7: ['철수', '민수'], 8: ['영희', '민수']}
MAINS = ['철수', '영희', '민수']


def knowledge():
    return [{'episode': n, 'events': [event(n, i, PEOPLE[n]) for i in (1, 2)], 'learned': []} for n in range(1, 9)]


def present_at(e):
    return {p['name'] for p in e['participants'] + e['witnesses']}


# ---- 쌍 고르기: 시간 쌍·자리 쌍 ----

def test_time_pairs_keep_the_character_and_event_and_move_only_the_cutoff():
    k = knowledge()
    events, seen = {e['id']: e for r in k for e in r['events']}, appearances(k)
    specs = kt_pairs.pick_pairs(k, MAINS, 'time', 6, random.Random(1))
    assert specs and len(specs) <= 6
    for spec in specs:
        before, after = spec['members']
        assert (before['side'], after['side']) == ('before', 'after') and before['character'] == after['character']
        who, e = before['character'], events[spec['event']]
        assert who in present_at(e)
        assert max(min(seen[who]), e['episode'] - 6) <= before['cutoff'] < e['episode']        # 이미 등장했고 사건은 1~6회 뒤
        assert e['episode'] <= after['cutoff'] <= min(e['episode'] + 3, 8)                     # 사건 뒤 0~3회
    assert len({s['event'] for s in specs}) == len(specs)                                      # 한 종류 안에서 같은 사건은 한 번만
    assert specs == kt_pairs.pick_pairs(k, MAINS, 'time', 6, random.Random(1))                 # 고정 시드면 같은 쌍
    assert specs != kt_pairs.pick_pairs(k, MAINS, 'time', 6, random.Random(2))


def test_place_pairs_keep_the_event_and_cutoff_and_swap_only_the_character():
    k = knowledge()
    events, seen = {e['id']: e for r in k for e in r['events']}, appearances(k)
    specs = kt_pairs.pick_pairs(k, MAINS, 'place', 6, random.Random(2))
    assert specs and len(specs) <= 6
    for spec in specs:
        here, away = spec['members']
        e = events[spec['event']]
        assert (here['side'], away['side']) == ('present', 'absent') and here['cutoff'] == away['cutoff']
        assert e['episode'] <= here['cutoff'] <= min(e['episode'] + 3, 8)                      # 사건 뒤 0~3회, 두 인물이 같은 기준 회차
        assert here['character'] in present_at(e) and away['character'] not in present_at(e)
        assert min(seen[away['character']]) <= e['episode']                                    # 없던 쪽도 사건 회차까지 이미 등장했다
    assert len({s['event'] for s in specs}) == len(specs) and specs == kt_pairs.pick_pairs(k, MAINS, 'place', 6, random.Random(2))


def test_a_witness_counts_as_present_for_both_pair_kinds():
    k = knowledge()
    for number in (2, 3, 4, 5):
        k[number - 1]['events'][0]['witnesses'] = [person('길동')]                               # 길동은 2~5화 첫 사건을 곁에서 보았다
    witnessed = {e['id'] for r in k for e in r['events'] if '길동' in present_at(e)}
    time_pairs = kt_pairs.pick_pairs(k, ['길동'], 'time', 9, random.Random(1))
    assert time_pairs and {s['event'] for s in time_pairs} <= witnessed                         # 목격한 사건으로 시간 쌍을 만든다
    everyone = ['철수', '영희', '민수', '길동']
    place_pairs = [s for seed in range(10) for s in kt_pairs.pick_pairs(k, everyone, 'place', 99, random.Random(seed))]
    for spec in place_pairs:
        here, away = spec['members']
        assert here['character'] != '길동' or spec['event'] in witnessed                       # 길동이 '있던' 쪽이면 그가 목격한 사건이다
        assert not (away['character'] == '길동' and spec['event'] in witnessed)                # 목격한 사건에서 길동은 '없던' 쪽이 될 수 없다
    assert any(s['members'][0]['character'] == '길동' for s in place_pairs)


def test_absent_ok_rejects_present_learned_not_yet_seen_and_unknown_gap_cases():
    k = knowledge()
    seen, events = appearances(k), {e['id']: e for r in k for e in r['events']}
    e = events['E2.1']                                                                         # 철수·민수가 2화에 겪은 사건
    assert kt_pairs.absent_ok(k, seen, '영희', e, 2)                                            # 영희: 1화에 이미 등장했고 2화 사건엔 없었다
    assert not kt_pairs.absent_ok(k, seen, '철수', e, 2)                                        # 참여한 인물은 아니다
    assert not kt_pairs.absent_ok(k, seen, '민수', events['E1.1'], 2)                           # 민수는 1화 사건 회차까지 아직 등장하지 않았다
    k[2]['learned'] = [{'event': 'E2.1', 'learner': '영희', 'episode': 3, 'evidence': 'x'}]    # 영희는 3화에 이 사건을 전해 들었다
    assert kt_pairs.absent_ok(k, seen, '영희', e, 2) and not kt_pairs.absent_ok(k, seen, '영희', e, 3)
    k = knowledge()
    k[3]['learn_failed'] = True                                                                # 4화의 '전해 들은 인물' 추출이 실패했다
    assert kt_pairs.absent_ok(k, seen, '영희', e, 3) and not kt_pairs.absent_ok(k, seen, '영희', e, 4)   # 사건~기준 회차 사이에 4화가 끼면 알 수 없어 제외


def test_the_absent_side_accepts_only_what_the_past_absence_rule_of_the_question_generator_accepts():
    k = knowledge()
    k[2]['learned'] = [{'event': 'E2.1', 'learner': '영희', 'episode': 3, 'evidence': 'x'}]
    k[5]['learn_failed'] = True
    accepted = {}
    for name in MAINS:                                                                         # 질문 생성기의 규칙이 받아들이는 (사건, 기준 회차): 시드를 바꿔 모두 모은다
        accepted[name] = {(s['event'], s['cutoff']) for seed in range(80)
                          for s in pick_specs(k, [name], {('past-absence', 'fact-structured'): 99}, random.Random(seed))}
    specs = kt_pairs.pick_pairs(k, MAINS, 'place', 99, random.Random(3))
    assert specs
    for spec in specs:
        away = spec['members'][1]
        assert (spec['event'], away['cutoff']) in accepted[away['character']]


def test_a_short_work_gives_only_the_pairs_that_exist():
    k = knowledge()
    few = kt_pairs.pick_pairs(k[:3], MAINS, 'time', 16, random.Random(1))
    assert 0 < len(few) < 16                                                                   # 있는 만큼만(철수의 2화 사건과 영희·민수의 3화 사건)
    assert kt_pairs.pick_pairs(k[:1], MAINS, 'time', 16, random.Random(1)) == []               # 사건 전에 이미 등장한 회차가 없으면 시간 쌍이 없다
    two = kt_pairs.pick_pairs(k[:2], MAINS, 'place', 16, random.Random(1))                      # 1·2화: 2화 사건의 '없던' 쪽은 1화에 이미 나온 영희뿐, 1화 사건엔 없던 인물이 없다
    assert len(two) == 2 and {s['members'][1]['character'] for s in two} == {'영희'} and {s['event'][:2] for s in two} == {'E2'}
    assert kt_pairs.pick_pairs(k, [], 'place', 16, random.Random(1)) == [] and kt_pairs.pick_pairs(k, [], 'time', 16, random.Random(1)) == []   # 질문 대상 인물이 없으면 빈 목록


# ---- 문항·문장·통계 ----

def make_rows(meta=None, count=4):
    k = knowledge()
    meta = meta or {'id': 'w00', 'kind': 'web', 'genre': '무협'}
    specs = {'time': kt_pairs.pick_pairs(k, MAINS, 'time', count, random.Random(1)), 'place': kt_pairs.pick_pairs(k, MAINS, 'place', count, random.Random(2))}
    return kt_pairs.pair_rows(meta, k, specs), specs


def test_pair_rows_carry_the_gold_the_recorded_order_and_a_question_without_the_options():
    rows, specs = make_rows()
    assert len(rows) == 2 * (len(specs['time']) + len(specs['place']))
    first, second = rows[0], rows[1]
    assert (first['pair_id'], first['kind'], first['side'], first['gold']) == ('w00-t01', 'time', 'before', 'unknown')       # 사건 전: 모른다
    assert (second['pair_id'], second['kind'], second['side'], second['gold']) == ('w00-t01', 'time', 'after', 'direct')   # 사건 후: 직접
    place = [r for r in rows if r['kind'] == 'place']
    assert [(r['side'], r['gold']) for r in place[:2]] == [('present', 'direct'), ('absent', 'unknown')] and place[0]['pair_id'] == 'w00-p01'
    events = {e['id']: e for r in knowledge() for e in r['events']}
    for r in rows:
        assert sorted(r['options']) == ['direct', 'hearsay', 'unknown'] and r['gold'] in ('direct', 'unknown')               # hearsay는 늘 오답 선택지
        assert (r['work'], r['work_kind'], r['genre']) == ('w00', 'web', '무협') and r['id'] == f"{r['pair_id']}-{r['side']}"
        assert events[r['event_id']]['summary'] in r['question'] and r['event_episode'] == events[r['event_id']]['episode']
        assert not any(label in r['question'] for label in kt_pairs.LABELS.values())                                        # 선택지 문장은 질문(검색 질의)에 없다
    by_pair = Counter(r['pair_id'] for r in rows)
    assert set(by_pair.values()) == {2} and len({r['id'] for r in rows}) == len(rows)
    assert rows == make_rows()[0] and len({tuple(r['options']) for r in rows}) > 1                                          # 고정 시드, 순서는 문항마다 섞인다
    assert all(r['options'] == kt_pairs.shuffled(r['id']) for r in rows)


def test_option_order_is_shuffled_per_question_with_a_fixed_seed_and_the_gold_position_is_not_always_the_same():
    orders = [kt_pairs.shuffled(f'w00-t{n:02d}-before') for n in range(60)]
    assert orders == [kt_pairs.shuffled(f'w00-t{n:02d}-before') for n in range(60)]
    assert all(sorted(o) == sorted(kt_pairs.KEYS) for o in orders) and len({tuple(o) for o in orders}) == 6                    # 가능한 여섯 순서가 모두 나온다
    assert {o.index('unknown') for o in orders} == {0, 1, 2}


def test_the_prompt_lists_the_numbered_options_in_the_recorded_order_after_the_question():
    r = {'question': '질문 S', 'options': ['unknown', 'direct', 'hearsay']}
    lines = kt_pairs.prompt_text(r).splitlines()
    assert lines[0] == '질문 S' and lines[1:4] == [f'1. {kt_pairs.LABELS["unknown"]}', f'2. {kt_pairs.LABELS["direct"]}', f'3. {kt_pairs.LABELS["hearsay"]}']
    assert len(lines) == 5 and '번호' in lines[4]


def qrow(idx, pair, side, gold, options=('unknown', 'direct', 'hearsay'), kind='time', work='w', work_kind='web', **kw):
    return {'idx': idx, 'id': f'{pair}-{side}', 'pair_id': pair, 'kind': kind, 'side': side, 'work': work, 'work_kind': work_kind, 'genre': '무협',
            'character': '철수', 'cutoff': 3, 'event_id': 'E1.1', 'event_episode': 2, 'question': f'다음 사건을 당신은 어떻게 알고 있나요? 사건 {pair}',
            'options': list(options), 'gold': gold, **kw}


def test_pair_stats_count_pairs_per_work_list_short_works_and_gold_positions():
    rows = [qrow(0, 'w00-t01', 'before', 'unknown', work='w00'), qrow(1, 'w00-t01', 'after', 'direct', ('direct', 'unknown', 'hearsay'), work='w00'),
            qrow(2, 'w00-p01', 'present', 'direct', kind='place', work='w00'), qrow(3, 'w00-p01', 'absent', 'unknown', kind='place', work='w00'),
            qrow(4, 'c01-t01', 'before', 'unknown', work='c01', work_kind='classic'), qrow(5, 'c01-t01', 'after', 'direct', work='c01', work_kind='classic')]
    stats = kt_pairs.pair_stats(rows, ['w00', 'c01', 'w99'], per_kind=1)
    assert stats['per_kind'] == 1 and stats['works'] == 3 and stats['questions'] == 6 and stats['pairs'] == {'time': 2, 'place': 1}
    assert stats['by_work'] == {'w00': {'time': 1, 'place': 1}, 'c01': {'time': 1, 'place': 0}, 'w99': {'time': 0, 'place': 0}}
    assert stats['short'] == {'c01': {'time': 1, 'place': 0}, 'w99': {'time': 0, 'place': 0}}                                    # 목표(per_kind)에 모자란 작품은 있는 수를 남긴다
    assert stats['gold'] == {'unknown': 3, 'direct': 3} and stats['gold_position'] == {'1': 4, '2': 2}                           # 정답 위치 분포(위치 편향 점검)


def test_pilot_keeps_both_questions_of_every_picked_pair_in_the_kind_ratio_and_file_order():
    rows, idx = [], 0
    for kind, tag in (('time', 't'), ('place', 'p')):
        for n in range(1, 11):
            for side, gold in ((('before', 'unknown'), ('after', 'direct')) if kind == 'time' else (('present', 'direct'), ('absent', 'unknown'))):
                rows.append(qrow(idx, f'w-{tag}{n:02d}', side, gold, kind=kind))
                idx += 1
    picked = kt_pairs.pilot(rows, 6)
    assert Counter(r['kind'] for r in picked) == {'time': 6, 'place': 6} and set(Counter(r['pair_id'] for r in picked).values()) == {2}   # 쌍 6개 = 시간 3·자리 3
    assert [r['idx'] for r in picked] == sorted(r['idx'] for r in picked) and kt_pairs.pilot(rows, 6) == picked
    assert kt_pairs.pilot(rows, None) is rows and kt_pairs.pilot(rows, 99) is rows
    with pytest.raises(SystemExit):
        kt_pairs.pilot(rows, 0)


# ---- 응답과 채점(코드) ----

class Chooser:
    """responses.parse 대역(게이트웨이의 구조화 출력): pick(입력)이 돌려준 번호를 고르고, None이면 응답이 잘린(incomplete) 것으로 한다."""

    def __init__(self, pick):
        self.pick, self.requests = pick, []
        self.responses = SimpleNamespace(parse=self._parse)

    def _parse(self, **kw):
        self.requests.append(kw)
        answer = self.pick(kw['input'])
        usage = SimpleNamespace(input_tokens=10, output_tokens=5, input_tokens_details=SimpleNamespace(cached_tokens=0))
        if answer is None:
            return SimpleNamespace(status='incomplete', usage=usage, model='m', output_parsed=None)
        return SimpleNamespace(status='completed', usage=usage, model='m', output_parsed=kw['text_format'](answer=answer))


def number_of(text, key):
    return next(line[0] for line in text.splitlines() if line[1:3] == '. ' and line[3:] == kt_pairs.LABELS[key])


def gen_llm(tmp_path, client, tag='gen'):
    llm = Llm(Ledger(tmp_path / f'{tag}-ledger.jsonl', 10 ** 6), tmp_path / f'cache-{tag}', model='gpt-6-luna@low', client=client, backoff=0, cost=CostLog(tmp_path / f'cost-{tag}.jsonl'))
    llm.via = 'ocx'
    return llm


def contexts_for(rows, configs=('zero', 's3')):
    return {r['idx']: {c: {'items': [] if c == 'zero' else [{'ref': 'card:c1', 'text': '문맥'}], 'future': c == 'zero', 'foreign': False, 'unseen': c == 's3',
                           'asked_ep': c == 's3'} for c in configs} for r in rows}


def run_pairs(tmp_path, rows, pick, configs=('zero', 's3')):
    client = Chooser(pick)
    llm = gen_llm(tmp_path, client)
    records = run_rounds([(r, c) for r in rows for c in configs], kt_pairs.make_work(contexts_for(rows, configs)), llm, SyncExecutor(llm))
    return records, client


def test_make_work_maps_the_picked_number_back_to_the_key_and_scores_it_by_code(tmp_path):
    rows = [qrow(0, 'w-t01', 'before', 'unknown', ('hearsay', 'unknown', 'direct')), qrow(1, 'w-t01', 'after', 'direct', ('direct', 'hearsay', 'unknown'))]
    records, client = run_pairs(tmp_path, rows, lambda text: number_of(text, 'unknown'))                            # 늘 '모른다'를 고르는 응답
    by = {(r['idx'], r['config']): r for r in records}
    assert [by[0, 'zero'][k] for k in ('choice', 'picked', 'correct', 'gold')] == ['2', 'unknown', True, 'unknown']     # 번호 2 = 섞인 순서의 둘째 = unknown
    assert [by[1, 's3'][k] for k in ('choice', 'picked', 'correct', 'gold')] == ['3', 'unknown', False, 'direct']       # 정답은 direct라 오답
    assert (by[0, 'zero']['pair_id'], by[0, 'zero']['kind'], by[0, 'zero']['side'], by[0, 'zero']['work_kind']) == ('w-t01', 'time', 'before', 'web')
    assert (by[0, 'zero']['future_ctx'], by[0, 'zero']['foreign_ctx'], by[0, 'zero']['unseen_ctx'], by[0, 's3']['unseen_ctx']) == (True, False, False, True)
    assert (by[0, 'zero']['asked_ep_ctx'], by[0, 's3']['asked_ep_ctx']) == (False, True)                                  # 같은 회차 사건 카드·발췌가 문맥에 있는가
    assert (by[0, 'zero']['kinds_ctx'], by[0, 's3']['kinds_ctx']) == ({}, {'event': 1})                                    # 문맥 항목 종류별 개수(card:c1은 인물 아닌 카드 = 사건 카드)
    zero_inputs = [q['input'] for q in client.requests if 'Context:' not in q['input']]
    s3_inputs = [q['input'] for q in client.requests if 'Context:' in q['input']]
    assert len(zero_inputs) == 2 and len(s3_inputs) == 2 and all(i.startswith('Context: 문맥\n***\n다음 사건을') for i in s3_inputs)   # 기존 context_message 형식 + 선택지
    assert all(any(kt_pairs.prompt_text(rows[0]) in i for i in group) for group in (zero_inputs, s3_inputs))     # 12개 스레드라 요청 도착 순서는 정해져 있지 않다
    assert {q['instructions'] for q in client.requests} == {ko_system_prompt('철수', 3)} and {q['text_format'] for q in client.requests} == {kt_pairs.Pick}


def test_an_unreadable_or_cut_off_response_is_a_failure_not_a_wrong_answer(tmp_path):
    rows = [qrow(0, 'w-t01', 'before', 'unknown'), qrow(1, 'w-t01', 'after', 'direct')]
    rows[1]['question'] += ' 둘째'                                                                                   # 두 문항의 요청이 서로 다르게
    records, _ = run_pairs(tmp_path, rows, lambda text: None if '둘째' not in text and 'Context:' in text else number_of(text, 'direct'), configs=('zero', 's3'))
    by = {(r['idx'], r['config']): r for r in records}
    assert (by[0, 's3']['picked'], by[0, 's3']['correct'], by[0, 's3']['choice']) == (None, None, None)                  # 잘린 응답: 실패(오답이 아니다)
    assert (by[1, 's3']['picked'], by[1, 's3']['correct']) == ('direct', True)                                            # 같은 구성의 다른 문항은 그대로 채점된다
    assert (by[0, 'zero']['correct'], by[1, 'zero']['correct']) == (False, True)                                          # 다른 구성도 그대로


def test_a_malformed_structured_answer_is_a_failure_too(tmp_path):
    from pydantic import ValidationError

    class Malformed:
        def __init__(self):
            self.responses = SimpleNamespace(parse=self._parse)

        def _parse(self, **kw):
            kw['text_format'].model_validate_json('{"answer": "9"}')                                                      # 1~3이 아닌 번호: SDK의 parse가 ValidationError를 던진다

    llm = gen_llm(tmp_path, Malformed())
    rows = [qrow(0, 'w-t01', 'before', 'unknown')]
    (record,) = run_rounds([(rows[0], 'zero')], kt_pairs.make_work(contexts_for(rows, ('zero',))), llm, SyncExecutor(llm))
    assert record['picked'] is None and record['correct'] is None
    with pytest.raises(ValidationError):
        kt_pairs.Pick.model_validate_json('{"answer": "9"}')


# ---- 집계 ----

def rec(idx, pair, side, config, correct, kind='time', picked='unknown', work_kind='web', **kw):
    return {'idx': idx, 'id': f'{pair}-{side}', 'pair_id': pair, 'kind': kind, 'side': side, 'work': 'w', 'work_kind': work_kind, 'config': config,
            'gold': 'unknown', 'choice': None if correct is None else '1', 'picked': None if correct is None else picked, 'correct': correct,
            'future_ctx': config == 'zero', 'foreign_ctx': False, 'unseen_ctx': False, 'asked_ep_ctx': config == 's3',
            'kinds_ctx': {} if config == 'zero' else {'identity': 1, 'event': 2}, **kw}


def pair_records(pair, kind, config, first, second, first_pick='unknown', second_pick='direct', work_kind='web', idx=0, **kw):
    sides = ('before', 'after') if kind == 'time' else ('present', 'absent')
    return [rec(idx, pair, sides[0], config, first, kind, first_pick, work_kind, **kw), rec(idx + 1, pair, sides[1], config, second, kind, second_pick, work_kind, **kw)]


def test_aggregate_counts_questions_and_pairs_apart_and_keeps_failures_out_of_the_denominators():
    records = (pair_records('p1', 'time', 'zero', True, True, idx=0) + pair_records('p2', 'time', 'zero', False, True, 'direct', idx=2)
               + pair_records('p3', 'place', 'zero', None, True, idx=4) + pair_records('p4', 'place', 'zero', False, None, 'hearsay', idx=6, work_kind='classic')
               + pair_records('p1', 'time', 's3', True, True, idx=0) + pair_records('p2', 'time', 's3', True, True, idx=2)
               + pair_records('p3', 'place', 's3', True, True, idx=4) + pair_records('p4', 'place', 's3', True, False, 'direct', idx=6, work_kind='classic'))
    out = kt_pairs.aggregate(records)
    assert out['questions'] == 8 and out['pairs'] == 4
    zero, s3 = out['configs']['zero'], out['configs']['s3']
    assert (zero['questions']['n'], zero['questions']['correct'], zero['questions']['failed']) == (6, 4, 2) and zero['questions']['accuracy'] == pytest.approx(4 / 6)
    assert zero['questions']['ci'] == list(wilson_interval(4, 6))
    assert (zero['pairs']['n'], zero['pairs']['correct'], zero['pairs']['failed']) == (3, 1, 1)                          # p3은 실패(오답 없이 응답 없음)라 분모에서 빠지고, p4는 오답이 있어 오답 쌍
    assert zero['pairs']['accuracy'] == pytest.approx(1 / 3) and zero['pairs']['ci'] == list(wilson_interval(1, 3))
    assert (s3['questions']['n'], s3['questions']['correct'], s3['questions']['failed']) == (8, 7, 0) and (s3['pairs']['n'], s3['pairs']['correct']) == (4, 3)
    assert (zero['by_kind']['time']['pairs']['n'], zero['by_kind']['time']['pairs']['correct']) == (2, 1) and (zero['by_kind']['place']['pairs']['n'], zero['by_kind']['place']['pairs']['failed']) == (1, 1)
    assert zero['by_kind']['place']['questions']['n'] == 2 and s3['by_kind']['place']['pairs']['correct'] == 1
    assert zero['by_side']['before']['n'] == 2 and zero['by_side']['before']['correct'] == 1 and zero['by_side']['after']['correct'] == 2
    assert zero['by_side']['present']['n'] == 1 and zero['by_side']['present']['correct'] == 0 and zero['by_side']['absent']['n'] == 1 and zero['by_side']['absent']['correct'] == 1
    assert zero['by_work_kind']['classic']['questions']['n'] == 1 and zero['by_work_kind']['web']['pairs']['n'] == 2
    assert zero['picked'] == {'direct': 4, 'hearsay': 1, 'unknown': 1} and s3['picked'] == {'direct': 5, 'hearsay': 0, 'unknown': 3}   # 고른 키 분포(실패는 세지 않는다)
    assert out['leak']['zero'] == {'future_ctx': 1.0, 'unseen_ctx': 0.0, 'foreign_ctx': 0.0, 'asked_ep_ctx': 0.0}
    assert out['leak']['s3'] == {'future_ctx': 0.0, 'unseen_ctx': 0.0, 'foreign_ctx': 0.0, 'asked_ep_ctx': 1.0}          # asked_ep는 unseen과 나란히
    assert zero['context'] == {'n': 8, 'items': 0.0, 'kinds': {kind: 0 for kind in ITEM_KINDS}}                       # 구성별 문맥 항목: 기록 수·평균 항목 수·종류별 개수 합
    assert s3['context'] == {'n': 8, 'items': 3.0, 'kinds': {'identity': 8, 'memory': 0, 'event': 16, 'relation': 0, 'manuscript': 0, 'cell': 0}}
    assert 'models' not in out


def test_aggregate_signs_pairs_between_configs_and_skips_pairs_a_config_could_not_score():
    records = []
    for n in range(9):                                                                                                 # s3만 맞히는 쌍 9개
        records += pair_records(f'w-t{n:02d}', 'time', 'zero', False, True, 'direct', idx=2 * n) + pair_records(f'w-t{n:02d}', 'time', 's3', True, True, idx=2 * n)
    records += pair_records('w-p01', 'place', 'zero', None, True, idx=20, ) + pair_records('w-p01', 'place', 's3', True, True, idx=20)   # zero가 못 채점한 쌍은 검정에서 뺀다
    records += pair_records('w-p02', 'place', 'zero', True, True, idx=22) + pair_records('w-p02', 'place', 's3', True, True, idx=22)       # 비긴 쌍은 검정에 세지 않는다
    out = kt_pairs.aggregate(records)
    assert set(out['paired']) == {'s3|zero'}                                                                           # 기록에 없는 구성(s2)이 낀 짝은 건너뛴다
    assert out['paired']['s3|zero'] == {'n': 10, 'a_only': 9, 'b_only': 0, 'p': pytest.approx(2 / 2 ** 9)}
    assert out['paired_by_kind']['time']['s3|zero']['a_only'] == 9 and out['paired_by_kind']['place']['s3|zero'] == {'n': 1, 'a_only': 0, 'b_only': 0, 'p': 1.0}
    assert set(out['paired_by_work_kind']['web']) == {'s3|zero'}
    both = kt_pairs.aggregate(records + pair_records('w-t00', 'time', 's2', True, False, idx=0))                      # s2가 기록에 있으면 s3|s2도 낸다
    assert set(both['paired']) == {'s3|zero', 's3|s2', 's2|zero'} and both['paired']['s3|s2'] == {'n': 1, 'a_only': 1, 'b_only': 0, 'p': 1.0}
    assert both['paired']['s2|zero'] == {'n': 1, 'a_only': 0, 'b_only': 0, 'p': 1.0}                                  # 각 구성 대 zero도 낸다(둘 다 오답 쌍이라 비김)


def test_aggregate_reports_the_models_of_stamped_records():
    stamp = {'gen_model': 'gpt-6-luna@low', 'gen_via': 'ocx'}
    out = kt_pairs.aggregate(pair_records('w-t01', 'time', 'zero', True, True, **stamp) + pair_records('w-t01', 'time', 's3', True, True, **stamp))
    assert out['models'] == {'gen_model': ['gpt-6-luna@low'], 'gen_via': ['ocx']}


def test_aggregate_compares_every_config_with_zero_and_with_s3_and_keeps_the_original_two_keys():
    outcomes = {'zero': (False, True), 's2': (True, True), 's3': (True, True), 'no_vector': (True, False), 'link_bm25': (False, False)}   # 쌍 정확: 아니오·예·예·아니오·아니오
    records = [r for n in range(3) for config, (first, second) in outcomes.items() for r in pair_records(f'w-t{n}', 'time', config, first, second, 'direct', idx=2 * n)]
    out = kt_pairs.aggregate(records)
    assert list(out['paired']) == ['s3|zero', 's3|s2', 's2|zero', 'no_vector|zero', 'no_vector|s3', 'link_bm25|zero', 'link_bm25|s3']   # 거울(zero|s3·s2|s3)은 없다
    assert out['paired']['s2|zero'] == {'n': 3, 'a_only': 3, 'b_only': 0, 'p': pytest.approx(0.25)}
    assert out['paired']['no_vector|s3'] == {'n': 3, 'a_only': 0, 'b_only': 3, 'p': pytest.approx(0.25)}
    assert out['paired']['link_bm25|zero'] == {'n': 3, 'a_only': 0, 'b_only': 0, 'p': 1.0}                                                  # 둘 다 틀린 쌍은 비김
    assert list(out['paired_by_kind']['time']) == list(out['paired']) and list(out['paired_by_work_kind']['web']) == list(out['paired'])


def test_run_takes_the_link_variants_and_records_the_context_metrics_of_every_record(tmp_path, monkeypatch):
    rows = two_works()
    kt, _ = sandbox(tmp_path, monkeypatch, rows)
    client = Chooser(lambda text: number_of(text, 'direct'))
    monkeypatch.setattr(kt_pairs, 'make_gen_llm', lambda model, name, limit_usd, effort: gen_llm(tmp_path, client))
    configs = ('zero', 'no_vector', 'link_bm25', 'link_ppr', 'link2_bm25')
    kt_pairs.run(configs, gen_model='gpt-6-luna', name='v1', limit_usd=1.0, limit=1)
    out = json.loads((kt / 'runs' / 'pairs-rows-v1.json').read_text())
    assert {r['config'] for r in out} == set(configs) and len(out) == 2 * len(configs)                                 # 쌍 1개 × 문항 2 × 구성 5


def test_run_can_pick_works_and_another_world_and_ties_the_gold_names_to_that_worlds_cards(tmp_path, monkeypatch):
    rows = two_works()
    kt, loaded = sandbox(tmp_path, monkeypatch, rows)
    cards = [Card(id='c1', cardType='character', title='이철수', text='', episodes={1: 'a'}), Card(id='c2', cardType='character', title='철수', text='', episodes={1: 'a', 2: 'b'})]
    monkeypatch.setattr(kt_pairs, 'build_data', lambda wids, world='world': loaded.append(('data', list(wids), world)) or {w: {'world': {'cards': cards, 'character_id': {'철수': 'c9'}}} for w in wids})
    seen = {}
    monkeypatch.setattr(kt_pairs, 'build_contexts', lambda every, data, only=None: seen.update(data) or contexts_for(rows, ALL_CONFIGS))
    client = Chooser(lambda text: number_of(text, 'direct'))
    monkeypatch.setattr(kt_pairs, 'make_gen_llm', lambda model, name, limit_usd, effort: gen_llm(tmp_path, client))
    kt_pairs.run(('zero',), gen_model='gpt-6-luna', name='w2', limit_usd=1.0, works=('w01',), world='world2')
    assert ('data', ['w01'], 'world2') in loaded                                                                       # 고른 작품·세계관만 읽는다
    out = json.loads((kt / 'runs' / 'pairs-rows-w2.json').read_text())
    assert {r['work'] for r in out} == {'w01'} and {r['world'] for r in out} == {'world2'}
    assert seen['w01']['world']['character_id']['철수'] == 'c2'                                                         # 정답표 이름 → 회차 기억이 가장 많은 카드(기존 연결을 덮는다)


# ---- 실행·집계 명령(임시 폴더, 대역 입력) ----

def sandbox(tmp_path, monkeypatch, rows):
    """kt_pairs를 임시 폴더와 대역 입력으로 돌린다(실제 데이터·임베딩·게이트웨이 없이). 불러온 것을 기록해 두 번째 값으로 돌려준다."""
    kt, loaded = tmp_path / 'kt', []
    (kt / 'runs').mkdir(parents=True)
    monkeypatch.setattr(kt_pairs, 'KT', kt)
    monkeypatch.setattr(kt_pairs, 'RESULTS', tmp_path / 'results')
    monkeypatch.setattr(kt_pairs, 'load_pairs', lambda: loaded.append('pairs') or rows)
    monkeypatch.setattr(kt_pairs, 'build_data', lambda wids, world='world': loaded.append(('data', list(wids), world)) or {w: {} for w in wids})
    monkeypatch.setattr(kt_pairs, 'build_contexts', lambda every, data, only=None: loaded.append(('contexts', sorted(only or []))) or {
        i: c for i, c in contexts_for(rows, ALL_CONFIGS).items() if only is None or i in only})
    return kt, loaded


def two_works():
    rows, idx = [], 0
    for work in ('w00', 'w01'):
        for n in (1, 2):
            rows += [qrow(idx, f'{work}-t{n:02d}', 'before', 'unknown', work=work),
                     qrow(idx + 1, f'{work}-t{n:02d}', 'after', 'direct', ('direct', 'hearsay', 'unknown'), work=work)]
            idx += 2
    return rows


def test_run_picks_pairs_builds_only_their_contexts_and_writes_the_named_rows(tmp_path, monkeypatch):
    rows = two_works()
    kt, loaded = sandbox(tmp_path, monkeypatch, rows)
    client, made = Chooser(lambda text: number_of(text, 'direct')), []
    monkeypatch.setattr(kt_pairs, 'make_gen_llm', lambda model, name, limit_usd, effort: made.append((model, name, limit_usd, effort)) or gen_llm(tmp_path, client))
    kt_pairs.run(('zero', 's3'), gen_model='gpt-6-luna', gen_effort='low', name='p1', limit_usd=1.0, limit=2)
    assert made == [('gpt-6-luna', 'p1', 1.0, 'low')]
    picked_pairs = {r['pair_id'] for r in json.loads((kt / 'runs' / 'pairs-rows-p1.json').read_text())}
    out = json.loads((kt / 'runs' / 'pairs-rows-p1.json').read_text())
    assert len(picked_pairs) == 2 and len(out) == 2 * 2 * 2                                                           # 쌍 2개 × 문항 2 × 구성 2
    assert ('contexts', sorted(r['idx'] for r in rows if r['pair_id'] in picked_pairs)) in loaded                   # 고른 쌍의 문맥만 만든다(임베딩은 전체 묶음)
    assert {(r['gen_model'], r['gen_via']) for r in out} == {('gpt-6-luna@low', 'ocx')} and 'judge_model' not in out[0]  # 응답 모델·경로만 남긴다(채점 모델 없음)
    assert {(r['picked'], r['config']) for r in out if r['side'] == 'after'} == {('direct', 'zero'), ('direct', 's3')}
    assert len(client.requests) == 8                                                                                  # 서로 다른 요청 8건(쌍 2 × 문항 2 × 구성 2)


def test_run_stops_before_loading_anything_on_a_bad_name_config_cap_or_price(tmp_path, monkeypatch):
    rows = two_works()
    kt, loaded = sandbox(tmp_path, monkeypatch, rows)
    for kwargs in ({'name': '../x'}, {'name': 'sample'}, {'configs': ('zero', 's9')}, {'limit_usd': None}, {'gen_model': 'mystery-9'}, {'world': 'nope'}, {'configs': ()}, {'limit_usd': float('nan')}):
        options = {'configs': ('zero',), 'gen_model': 'gpt-6-luna', 'gen_effort': None, 'name': 'g', 'limit_usd': 1.0, 'limit': None} | kwargs
        configs = options.pop('configs')
        with pytest.raises(SystemExit):
            kt_pairs.run(configs, **options)
    assert loaded == [] and not list(kt.glob('cost-*')) and not list(kt.glob('cache-*'))


def test_report_writes_the_named_result_and_leaves_other_results_alone(tmp_path, monkeypatch, capsys):
    kt, _ = sandbox(tmp_path, monkeypatch, [])
    stamp = {'gen_model': 'gpt-6-luna@low', 'gen_via': 'ocx'}
    records = [r for n in range(3) for c, a, b in (('zero', False, True), ('s3', True, True)) for r in pair_records(f'w-t{n}', 'time', c, a, b, idx=2 * n, **stamp)]
    (kt / 'runs' / 'pairs-rows-x.json').write_text(json.dumps(records))
    (tmp_path / 'results').mkdir()
    (tmp_path / 'results' / 'ko-timechara.json').write_text('KEEP')
    kt_pairs.report('x')
    result = json.loads((tmp_path / 'results' / 'ko_timechara-pairs-x.json').read_text())
    assert (tmp_path / 'results' / 'ko-timechara.json').read_text() == 'KEEP' and set(result['configs']) == {'zero', 's3'} and set(result['paired']) == {'s3|zero'}
    assert result['configs']['s3']['pairs']['accuracy'] == 1.0 and result['configs']['zero']['pairs']['accuracy'] == 0.0 and result['models']['gen_model'] == ['gpt-6-luna@low']
    out = capsys.readouterr().out
    assert 'zero' in out and 's3' in out and 's3|zero' in out and 'asked_ep' in out
    for bad in ('../x', 'data'):
        with pytest.raises(SystemExit):
            kt_pairs.report(bad)


def test_report_prints_a_table_even_when_every_response_failed(tmp_path, monkeypatch, capsys):
    kt, _ = sandbox(tmp_path, monkeypatch, [])
    records = [r for c in ('zero', 's3') for r in pair_records('w-t01', 'time', c, None, None)]
    (kt / 'runs' / 'pairs-rows-none.json').write_text(json.dumps(records))
    kt_pairs.report('none')
    result = json.loads((tmp_path / 'results' / 'ko_timechara-pairs-none.json').read_text())
    assert result['configs']['s3']['questions'] == {'n': 0, 'correct': 0, 'accuracy': None, 'ci': None, 'failed': 2}
    assert 's3' in capsys.readouterr().out


def test_build_writes_pairs_and_stats_only_for_the_asked_files_and_is_repeatable(tmp_path, monkeypatch):
    kt = tmp_path / 'kt'
    kt.mkdir()
    (kt / 'questions.jsonl').write_text('KEEP')
    monkeypatch.setattr(kt_pairs, 'KT', kt)
    metas = {'w00': {'id': 'w00', 'kind': 'web', 'genre': '무협'}, 'c01': {'id': 'c01', 'kind': 'classic', 'genre': '고전'}}
    monkeypatch.setattr(kt_pairs, 'load_works', lambda ids=None: metas)
    monkeypatch.setattr(kt_pairs, 'load_knowledge', lambda wid: knowledge() if wid == 'w00' else knowledge()[:1])      # c01은 한 회차뿐이라 쌍이 없다
    monkeypatch.setattr(kt_pairs, 'load_world', lambda path: {'character_id': {n: f'c{i}' for i, n in enumerate(MAINS)}})
    kt_pairs.build()
    rows = [json.loads(line) for line in (kt / 'pairs.jsonl').read_text().splitlines()]
    stats = json.loads((kt / 'pairs_stats.json').read_text())
    assert (kt / 'questions.jsonl').read_text() == 'KEEP'                                                              # 기존 질문 파일은 그대로
    assert [r['idx'] for r in rows] == list(range(len(rows))) and {r['work'] for r in rows} == {'w00'} and rows == sorted(rows, key=lambda r: r['work'])
    assert stats['questions'] == len(rows) and stats['by_work']['c01'] == {'time': 0, 'place': 0} and 'c01' in stats['short']   # 모자란 작품의 수를 통계에 남긴다
    assert stats['pairs']['time'] == stats['by_work']['w00']['time'] and stats['per_kind'] == 16 and stats['pairs']['time'] <= 16
    assert Counter(r['pair_id'] for r in rows).most_common(1)[0][1] == 2
    first = (kt / 'pairs.jsonl').read_text()
    kt_pairs.build()
    assert (kt / 'pairs.jsonl').read_text() == first                                                                   # 고정 시드라 다시 만들어도 같다


def test_main_dispatches_each_command_and_refuses_unknown_options(monkeypatch):
    calls = []
    monkeypatch.setattr(kt_pairs, 'build', lambda *args: calls.append(('build', args)))
    monkeypatch.setattr(kt_pairs, 'run', lambda *args, **kw: calls.append(('run', args, kw)))
    monkeypatch.setattr(kt_pairs, 'report', lambda *args: calls.append(('report', args)))
    kt_pairs.main(['build'])
    kt_pairs.main(['run', '--gen-model=gpt-6-luna', '--gen-effort=low', '--name=p1', '--limit-usd=1', '--limit=8', '--configs=zero,s3'])
    kt_pairs.main(['run', '--gen-model=gpt-6-luna', '--name=p2', '--limit-usd=2.5'])
    kt_pairs.main(['run', '--gen-model=gpt-6-luna', '--name=p3', '--limit-usd=2', '--works=w01,c01', '--world=world2'])
    kt_pairs.main(['report', '--name=p1'])
    base = {'works': (), 'world': 'world'}                                                                             # 기본은 모든 작품·기존 세계관
    assert calls == [('build', ()),
                     ('run', (('zero', 's3'),), {'gen_model': 'gpt-6-luna', 'gen_effort': 'low', 'name': 'p1', 'limit_usd': 1.0, 'limit': 8, **base}),
                     ('run', (('zero', 's2', 's3'),), {'gen_model': 'gpt-6-luna', 'gen_effort': None, 'name': 'p2', 'limit_usd': 2.5, 'limit': None, **base}),   # 기본 구성 zero,s2,s3
                     ('run', (('zero', 's2', 's3'),), {'gen_model': 'gpt-6-luna', 'gen_effort': None, 'name': 'p3', 'limit_usd': 2.0, 'limit': None, 'works': ('w01', 'c01'), 'world': 'world2'}),
                     ('report', ('p1',))]
    calls.clear()
    for argv in (['run', '--name=p', '--limit-usd=1'], ['run', '--gen-model=gpt-6-luna', '--limit-usd=1'], ['run', '--gen-model=gpt-6-luna', '--name=p'],
                 ['run', '--gen_model=x', '--name=p', '--limit-usd=1'], ['run', '--gen-model=x', '--name=p', '--limit-usd=1', '--gen-effort=extreme'],
                 ['run', '--gen-model=x', '--name=p', '--limit-usd=1', '--limit=x'], ['run', '--gen-model=x', '--name=p', '--limit-usd=1', '--judge-model=y'],
                 ['report'], ['bogus'], []):
        with pytest.raises(SystemExit):
            kt_pairs.main(argv)                                                                                        # 철자 틀린 옵션이 조용히 무시돼 엉뚱한 모델로 도는 일을 막는다
    assert calls == []


def test_run_refuses_a_work_filter_that_picks_no_question_and_keeps_the_rows_already_written(tmp_path, monkeypatch):
    kt, _ = sandbox(tmp_path, monkeypatch, two_works())
    written = kt / 'runs' / 'pairs-rows-p1.json'
    written.write_text('[{"keep": 1}]')
    monkeypatch.setattr(kt_pairs, 'make_gen_llm', lambda model, name, limit_usd, effort: gen_llm(tmp_path, Chooser(lambda text: number_of(text, 'direct'))))
    with pytest.raises(SystemExit):
        kt_pairs.run(('zero',), gen_model='gpt-6-luna', name='p1', limit_usd=1.0, works=('w99',))                   # pairs.jsonl에 없는 작품 id
    assert written.read_text() == '[{"keep": 1}]'                                                                  # 빈 결과가 같은 이름의 기록을 덮지 않는다


def test_run_runs_a_config_given_twice_only_once(tmp_path, monkeypatch):
    kt, _ = sandbox(tmp_path, monkeypatch, two_works())
    monkeypatch.setattr(kt_pairs, 'make_gen_llm', lambda model, name, limit_usd, effort: gen_llm(tmp_path, Chooser(lambda text: number_of(text, 'direct'))))
    kt_pairs.run(('zero', 'zero', 's3'), gen_model='gpt-6-luna', name='d1', limit_usd=1.0, limit=1)
    out = json.loads((kt / 'runs' / 'pairs-rows-d1.json').read_text())
    assert len(out) == 1 * 2 * 2 and sorted(Counter(r['config'] for r in out).values()) == [2, 2]                  # 쌍 1개 × 문항 2 × 구성 2: 같은 문항이 두 번 기록돼 쌍이 집계에서 빠지지 않는다
