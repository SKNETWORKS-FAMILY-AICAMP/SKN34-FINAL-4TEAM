"""층별 점수표(kt_layers) 단위 테스트: 문맥 겹침·전처리 상한 대 검색·시뮬레이션 문항 나눔·기록 고르기·쌍 부호 검정·작품 묶음·열 대응표. 합성 입력만 쓴다(소설 원문 없음, 호출 없음)."""

import pytest

import kt_layers as ly


def test_best_overlap_counts_the_share_of_the_summary_bigrams_in_the_best_window_with_names_dropped():
    summary = '철수가 영희에게 칼을 건넸다.'
    assert ly.best_overlap(summary, ['철수는 영희에게 칼을 건넸다.'], drop=['철수', '영희']) == pytest.approx(1.0, abs=0.35)   # '가'·'는'처럼 조사만 다른 2-gram 몫은 빠진다
    exact = ly.best_overlap('칼을 건넸다.', ['철수는 영희에게 칼을 건넸다.'], drop=['철수', '영희'])
    assert exact == 1.0 and ly.best_overlap('칼을 건넸다.', ['전혀 다른 이야기가 여기에 있었음'], drop=[]) < 0.2
    assert ly.best_overlap('', ['아무 글'], drop=[]) == 0.0 and ly.best_overlap(summary, [], drop=[]) == 0.0


def test_layer_row_separates_the_visible_card_pool_from_the_retrieved_top_items():
    row = {'id': 'w00-t01-after', 'pair_id': 'w00-t01', 'work': 'w00', 'side': 'after'}
    contexts = {'link_bm25': {'items': [], 'future': False, 'foreign': False, 'unseen': False, 'asked_ep': False},
                'no_vector': {'items': [{'ref': 'card:c1#ep01', 'text': '칼을 건넸다.'}], 'future': False, 'foreign': True, 'unseen': False, 'asked_ep': True}}
    out = ly.layer_row(row, '칼을 건넸다.', [], ['칼을 건넸다.', '다른 글'], contexts)
    assert out['pool'] == 1.0 and out['cfg']['link_bm25']['top'] == 0.0 and out['cfg']['link_bm25']['n'] == 0
    assert out['cfg']['no_vector']['top'] == 1.0 and out['cfg']['no_vector']['foreign'] is True and out['cfg']['no_vector']['asked_ep'] is True
    assert out['id'] == 'w00-t01-after' and out['side'] == 'after'


def cfg(top, **flags):
    return {'link_bm25': {'top': top, 'n': 6, 'future': False, 'foreign': False, 'unseen': False, 'asked_ep': False, **flags}}


ROWS = [
    {'id': 'a1', 'side': 'after', 'pool': 1.0, 'cfg': cfg(0.9)},                  # 문맥에 있다
    {'id': 'a2', 'side': 'present', 'pool': 0.8, 'cfg': cfg(0.1)},                # 카드에는 있으나 상위 문맥에 못 들었다 = 검색 손실
    {'id': 'a3', 'side': 'after', 'pool': 0.3, 'cfg': cfg(0.3)},                  # 흔적만
    {'id': 'a4', 'side': 'present', 'pool': 0.1, 'cfg': cfg(0.7)},                # 상한은 상위 문맥도 품는다(상한 0.7)
    {'id': 'a5', 'side': 'after', 'pool': 0.0, 'cfg': cfg(0.0)},                  # 전처리에 없다
    {'id': 'n1', 'side': 'before', 'pool': 0.9, 'cfg': cfg(0.6, future=True)},    # 몰라야 하는 사건이 문맥에 드러났다
    {'id': 'n2', 'side': 'absent', 'pool': 0.0, 'cfg': cfg(0.0, foreign=True)},
]


def test_retrieval_block_counts_recall_upper_bound_loss_and_exposure_at_both_thresholds():
    block = ly.retrieval_block(ROWS, 'link_bm25')
    assert block['know_n'] == 5 and block['not_n'] == 2
    assert [block['recall'][t]['k'] for t in ('50', '20')] == [2, 3]            # a1 a4 / a1 a3 a4
    assert [block['upper'][t]['k'] for t in ('50', '20')] == [3, 4]             # a1 a2 a4 / a1 a2 a3 a4
    assert [block['loss'][t]['k'] for t in ('50', '20')] == [1, 1]              # a2
    assert [block['exposed'][t]['k'] for t in ('50', '20')] == [1, 1] and block['exposed']['50']['n'] == 2
    assert block['leak'] == {'future': 1, 'foreign': 1, 'unseen': 0, 'asked_ep': 0, 'n': 7}
    assert block['recall']['50']['rate'] == pytest.approx(0.4)


def rec(qid, side, correct, pair='p1', config='link_bm25', work='w00', world=None):
    return {'id': qid, 'pair_id': pair, 'side': side, 'work': work, 'config': config, 'correct': correct, 'world': world}


def test_simulation_block_splits_the_know_side_by_how_much_context_there_was():
    records = [rec('a1', 'after', True), rec('a2', 'present', False), rec('a3', 'after', True), rec('a4', 'present', True), rec('a5', 'after', False),
               rec('n1', 'before', False), rec('n2', 'absent', True)]
    block = ly.simulation_block(records, ROWS, 'link_bm25')
    assert (block['enough']['n'], block['enough']['correct']) == (2, 2)          # a1(0.9)·a4(0.7)
    assert (block['partial']['n'], block['partial']['correct']) == (1, 1)        # a3(0.3)
    assert (block['empty']['n'], block['empty']['correct']) == (2, 0)            # a2(0.1)·a5(0.0)
    assert (block['exposed']['n'], block['exposed']['correct']) == (1, 0) and (block['clean']['n'], block['clean']['correct']) == (1, 1)   # 몰라야 하는 쪽
    assert block['sides']['before']['n'] == 1 and block['sides']['after']['correct'] == 2


def test_attribution_splits_the_wrong_know_side_answers_into_preprocessing_search_and_response():
    records = [rec('a1', 'after', True), rec('a2', 'present', False), rec('a3', 'after', False), rec('a4', 'present', True), rec('a5', 'after', False), rec('n1', 'before', False)]
    out = ly.attribution(records, ROWS, 'link_bm25')
    assert out == {'n': 5, 'correct': 2, 'pre': 1, 'search': 1, 'response': 1}      # a5 카드 전체에 없음 · a2 카드에는 있으나 상위 문맥에 못 듦 · a3 문맥에 흔적이 있었는데 틀림(몰라야 하는 쪽 n1은 세지 않는다)


def test_merge_layer_rows_replaces_the_rows_of_the_recomputed_works_and_keeps_the_others():
    old = [{'id': 'a', 'work': 'w01'}, {'id': 'b', 'work': 'w02'}, {'id': 'c', 'work': 'w02'}]
    new = [{'id': 'b2', 'work': 'w02'}, {'id': 'd', 'work': 'w03'}]
    assert [r['id'] for r in ly.merge_layer_rows(old, new)] == ['a', 'b2', 'd']
    assert ly.merge_layer_rows([], new) == new


def test_select_records_keeps_one_record_per_question_for_the_world_works_and_config():
    pool = [rec('q1', 'after', True, world=None), rec('q1', 'after', False, world=None), rec('q2', 'after', True, world='sv-x'),
            rec('q3', 'after', True, work='w99'), rec('q4', 'after', True, config='zero')]
    assert [r['id'] for r in ly.select_records(pool, 'world', {'w00'}, 'link_bm25')] == ['q1']     # 세계관 표기가 없는 기록은 기존 world, 같은 질문은 앞의 것 하나
    assert [r['id'] for r in ly.select_records(pool, 'sv-x', {'w00'}, 'link_bm25')] == ['q2']
    assert [r['id'] for r in ly.select_records(pool, 'world', {'w00'}, 'zero')] == ['q4']


def test_compare_pairs_counts_only_the_pairs_scored_in_both_and_runs_the_exact_sign_test():
    def pair(prefix, outcomes):
        return [rec(f'{prefix}{n}{s}', s, ok, pair=f'p{n}') for n, ok in enumerate(outcomes, 1) for s in ('after', 'present')]
    a = pair('x', [True, True, False, False, None])
    b = pair('x', [True, False, True, True, True])
    out = ly.compare_pairs(a, b)
    assert (out['n'], out['a_only'], out['b_only']) == (4, 1, 2) and out['p'] == pytest.approx(1.0)
    wins = ly.compare_pairs(pair('x', [True] * 10), pair('x', [False] * 10))
    assert (wins['a_only'], wins['b_only']) == (10, 0) and wins['p'] < 0.01


def test_compare_questions_pairs_the_same_question_ids_on_the_chosen_sides():
    a = [rec('q1', 'after', True), rec('q2', 'after', False), rec('q3', 'before', True)]
    b = [rec('q1', 'after', False), rec('q2', 'after', False), rec('q3', 'before', False)]
    out = ly.compare_questions(a, b, ('after', 'present'))
    assert (out['n'], out['a_only'], out['b_only']) == (2, 1, 0)


def test_compare_values_counts_the_works_where_each_side_is_higher_and_skips_ties_in_the_test():
    out = ly.compare_values({'w1': 0.5, 'w2': 0.9, 'w3': 0.4, 'w9': 1.0}, {'w1': 0.7, 'w2': 0.9, 'w3': 0.1})   # w9는 한쪽에만 있어 센다
    assert (out['n'], out['a_only'], out['b_only']) == (3, 1, 1) and out['p'] == pytest.approx(1.0)
    more = ly.compare_values({f'w{i}': 0.1 for i in range(8)}, {f'w{i}': 0.5 for i in range(8)})
    assert (more['a_only'], more['b_only']) == (0, 8) and more['p'] < 0.01


def test_common_works_are_the_works_every_version_covers_in_order():
    coverage = {'svc': {'w01', 'w03', 'c01'}, 'old': {'w01', 'w03', 'c01', 'w05'}, 'v04': {'c01', 'w03', 'w05'}}
    assert ly.common_works(coverage) == ['c01', 'w03']
    assert ly.common_works({}) == []


def test_the_version_table_names_one_world_per_work_and_the_groups_partition_the_25_works():
    assert sorted(w for ws in ly.GROUPS.values() for w in ws) == sorted(set(w for ws in ly.GROUPS.values() for w in ws)) and len(ly.GROUP_OF) == 25
    assert ly.world_of('v04', 'w03') == 'sv-n-v4' and ly.world_of('v04', 'c05') == 'sv-x-r2' and ly.world_of('old', 'c05') == 'world'
    assert ly.world_of('v00', 'w01') == 'world2' and ly.world_of('v03', 'w07') == 'sv-h-final' and ly.world_of('svc', 'w47') == 'world_svc'
    assert ly.GROUP_OF['c04'] == 'new' and ly.GROUP_OF['w01'] == 'dev'
    with pytest.raises(KeyError):
        ly.world_of('v09', 'w01')


def row_for(side, top, pair='p1', work='w00', rid=None, **extra):
    return {'id': rid or f'{pair}-{side}', 'pair_id': pair, 'work': work, 'side': side, 'pool': 1.0, 'cfg': {'c': {'top': top, 'n': 4, 'kinds': {'memory': 3, 'event': 1}, 'future': False, 'foreign': False, 'unseen': False, 'asked_ep': False, **extra}}}


def test_items_block_averages_the_item_count_and_the_item_kinds_per_question():
    rows = [row_for('after', 0.9, 'p1'), row_for('before', 0.0, 'p1')]
    rows[1]['cfg']['c'].update(n=2, kinds={'relation': 2})
    out = ly.items_block(rows, 'c')
    assert out['n'] == 2 and out['items'] == 3.0 and out['kinds'] == {'memory': 1.5, 'event': 0.5, 'relation': 1.0}
    assert ly.items_block([], 'c') == {'n': 0, 'items': None, 'kinds': {}}


def test_pearson_and_spearman_measure_linear_and_rank_agreement_with_average_ranks_for_ties():
    assert ly.pearson([1, 2, 3, 4], [2, 4, 6, 8]) == pytest.approx(1.0) and ly.pearson([1, 2, 3], [3, 2, 1]) == pytest.approx(-1.0)
    assert ly.pearson([1, 1, 1], [1, 2, 3]) is None and ly.pearson([], []) is None and ly.pearson([1], [2]) is None
    assert ly.spearman([1, 2, 3, 4], [1, 4, 9, 16]) == pytest.approx(1.0)
    assert ly.spearman([1, 2, 2, 4], [1, 2, 2, 4]) == pytest.approx(1.0)
    assert ly.spearman([1, 2, 3], [1, 3, 2]) == pytest.approx(0.5)


def test_bin_counts_split_the_scored_questions_by_side_group_and_context_level():
    rows = [row_for('after', 0.9, 'p1'), row_for('present', 0.3, 'p2'), row_for('before', 0.6, 'p1'), row_for('absent', 0.0, 'p2')]
    records = [rec('p1-after', 'after', True, pair='p1'), rec('p2-present', 'present', False, pair='p2'), rec('p1-before', 'before', False, pair='p1'), rec('p2-absent', 'absent', True, pair='p2')]
    assert ly.bin_counts(rows, records, 'c') == {('know', 'enough'): [1, 1], ('know', 'partial'): [0, 1], ('not', 'exposed'): [0, 1], ('not', 'clean'): [1, 1]}


def test_predicted_accuracy_uses_the_bin_model_per_question_and_multiplies_the_two_questions_of_a_pair():
    rows = [row_for('after', 0.9, 'p1'), row_for('before', 0.0, 'p1'), row_for('after', 0.0, 'p2'), row_for('before', 0.0, 'p2')]
    model = {('know', 'enough'): 0.9, ('know', 'empty'): 0.3, ('not', 'clean'): 0.8}
    out = ly.predict_accuracy(model, rows, 'c')
    assert out['questions'] == pytest.approx((0.9 + 0.8 + 0.3 + 0.8) / 4)
    assert out['pairs'] == pytest.approx((0.9 * 0.8 + 0.3 * 0.8) / 2)
    assert ly.predict_accuracy(model, [], 'c') == {'questions': None, 'pairs': None}


def test_leave_one_out_model_pools_every_other_cells_counts():
    cells = [{('know', 'enough'): [9, 10]}, {('know', 'enough'): [1, 10], ('not', 'clean'): [5, 5]}, {('know', 'enough'): [2, 10]}]
    model = ly.loo_model(cells, 1)
    assert model == {('know', 'enough'): pytest.approx(11 / 20)}
    assert ly.loo_model(cells, 0) == {('know', 'enough'): pytest.approx(3 / 20), ('not', 'clean'): pytest.approx(1.0)}


def test_a_report_needs_the_context_rows_of_every_question_of_its_works_and_names_the_command_to_make_them():
    questions = [{'id': 'q1', 'work': 'w01'}, {'id': 'q2', 'work': 'w01'}, {'id': 'q3', 'work': 'c01'}, {'id': 'q4', 'work': 'w99'}]
    rows = [{'id': 'q1', 'work': 'w01'}, {'id': 'q2', 'work': 'w01'}]
    ly.check_layer_rows('v04', {'w01'}, questions, rows)                                                             # 요청 작품의 문항이 모두 있으면 통과(다른 작품의 문항은 보지 않는다)
    with pytest.raises(SystemExit) as stop:
        ly.check_layer_rows('v04', {'w01', 'c01'}, questions, rows)                                                  # c01의 문맥 행이 없다: 검색 지표가 문항 0개로 나오고 응답은 전체로 나오는 일을 막는다
    assert 'v04' in str(stop.value) and 'c01' in str(stop.value) and 'contexts' in str(stop.value) and '--groups=dev' in str(stop.value)


def test_a_cell_whose_every_response_failed_is_left_out_of_the_correlation_cells_but_keeps_its_failure_count():
    ok = {'simulation': {'pairs': {'accuracy': 0.5}, 'questions': {'accuracy': 0.6}}, 'retrieval': {'recall': {'50': {'rate': 0.4}, '20': {'rate': 0.8}}, 'upper': {'50': {'rate': 0.5}}, 'exposed': {'20': {'rate': 0.1}}}, 'items': {'items': 3.0}}
    failed = {**ok, 'simulation': {'pairs': {'accuracy': None, 'failed': 8}, 'questions': {'accuracy': None, 'failed': 16}}}
    cell = ly.usable_cell('v2', 'link_bm25', ok, {}, [])
    assert (cell['pairs'], cell['questions'], cell['recall50'], cell['recall20'], cell['upper50'], cell['exposed20'], cell['items']) == (0.5, 0.6, 0.4, 0.8, 0.5, 0.1, 3.0)
    assert ly.usable_cell('v2', 'link_bm25', failed, {}, []) is None                                               # 상관·예측 계산에서 뺀다(미실행 칸으로 바꾸지는 않는다: 실패 수는 칸에 남는다)
