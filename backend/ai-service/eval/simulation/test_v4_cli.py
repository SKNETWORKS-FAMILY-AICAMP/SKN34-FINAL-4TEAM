"""V4 실행기 단위 테스트: 장부(연출만 셈)·기록 경로·장면 묶음(순수 부분). 모델·ocx 호출은 없다."""

import json

import v4_cli as c


class Cost:
    def __init__(self):
        self.rows = []

    def record(self, kind, tokens_in, tokens_out, **kwargs):
        self.rows.append((kind, tokens_in, tokens_out, kwargs))
        return 0.5

    def spent(self):
        return 1.25


def test_the_ocx_cost_counts_only_the_director_calls_that_still_go_to_openai():
    cost = Cost()
    ocx = c.OcxCost(cost)
    assert ocx.record('director', 300, 5, failed=False) == 0.5 and ocx.record('act', 7000, 100, failed=False) == 0.0 and ocx.record('check', 9000, 100) == 0.0
    assert cost.rows == [('director', 300, 5, {'failed': False})] and ocx.spent() == 1.25


def test_records_and_grades_live_side_by_side_per_condition_and_route_and_plus_is_a_safe_file_name():
    assert c.records_path('P1+N3', 'ocx').name == 'P1_N3-ocx.jsonl' and c.grades_path('P1+N3', 'ocx').name == 'P1_N3-ocx.grades.jsonl'
    assert c.records_path('v4', 'openai').parent == c.records_path('base', 'ocx').parent


def test_read_jsonl_keys_the_lines_by_id_and_a_missing_file_is_empty(tmp_path):
    path = tmp_path / 'a.jsonl'
    path.write_text('\n'.join(json.dumps({'id': i, 'n': k}) for k, i in enumerate(['x', 'y'])) + '\n')
    assert c.read_jsonl(path) == {'x': {'id': 'x', 'n': 0}, 'y': {'id': 'y', 'n': 1}} and c.read_jsonl(tmp_path / 'none.jsonl') == {}


def test_the_scene_bundle_repeats_the_eight_fixed_scenes_and_numbers_the_later_rounds():
    specs = c.scene_specs(c.IDS, 3)
    assert len(specs) == 24 and [s['id'] for s in specs[:8]] == list(c.IDS) and specs[8]['id'] == 'hp-1-if#2' and specs[-1]['id'] == 'hp-5-flow#3'
    assert [s['id'] for s in c.scene_specs(['hp-1-flow'], 2)] == ['hp-1-flow', 'hp-1-flow#2']



def test_a_selection_keeps_only_the_named_scenes_and_the_first_n_rounds():
    records = {i: {'id': i} for i in ['hp-1-if', 'hp-1-if#2', 'hp-1-if#11', 'hp-3-flow', 'hp-3-flow#30', 'hp-5-if#3']}
    assert c.round_of('hp-1-if') == 1 and c.round_of('hp-1-if#11') == 11
    assert sorted(c.select(records, ['hp-1-if', 'hp-5-if'], 10)) == ['hp-1-if', 'hp-1-if#2', 'hp-5-if#3']
    assert sorted(c.select(records, ['hp-3-flow'], 30)) == ['hp-3-flow', 'hp-3-flow#30']
