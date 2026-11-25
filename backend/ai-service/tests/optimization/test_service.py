"""프롬프트 자동 개선(app/optimization/service.py): 접수 확인·잠금·풀·저장 조건·실행 흐름. gepa·Langfuse·Postgres·평가 서비스는 대역이다."""

import contextlib
import json
import logging
import re
from types import SimpleNamespace

import pytest
from langfuse.api import NotFoundError

from app import tracing
from app.evaluation import service as evaluation
from app.evaluation.errors import EvaluationFailure
from app.optimization import agent, service
from app.optimization.errors import OptimizationFailure
from app.optimization.models import OptimizationRequest
from app.simulation.prompt import SAFETY
from traced import attrs, status_of

from .stubs import BASE, install_gepa, row

REQUEST = OptimizationRequest(prompt='character_simulation.act', version=2, maxMetricCalls=150)


# ---- 접수 확인 ----

@pytest.fixture
def configured(monkeypatch):
    for name, value in {'LANGFUSE_PUBLIC_KEY': 'pk', 'LANGFUSE_SECRET_KEY': 'sk', 'OPENAI_API_KEY': 'k', 'OPENAI_MODEL': 'm'}.items():
        monkeypatch.setenv(name, value)
    monkeypatch.setattr(service, 'running', lambda prompt: False)


@pytest.mark.parametrize('prompt_name', ['character_simulation.act', 'character_simulation.narrate'])
def test_accept_lets_a_configured_idle_request_for_either_simulation_prompt_through(configured, prompt_name):
    assert service.accept(REQUEST.model_copy(update={'prompt': prompt_name})) is None


def test_an_unsupported_prompt_is_422_before_anything_else_is_looked_at(configured, monkeypatch):
    monkeypatch.setattr(service, 'running', lambda prompt: pytest.fail('잠금을 보면 안 된다'))

    with pytest.raises(OptimizationFailure) as error:
        service.accept(REQUEST.model_copy(update={'prompt': 'story_context.answer'}))

    assert error.value.status == 422


def test_a_prompt_whose_optimization_is_running_is_409(configured, monkeypatch):
    monkeypatch.setattr(service, 'running', lambda prompt: True)

    with pytest.raises(OptimizationFailure) as error:
        service.accept(REQUEST)

    assert error.value.status == 409


@pytest.mark.parametrize('missing', ['LANGFUSE_PUBLIC_KEY', 'OPENAI_API_KEY'])
def test_a_missing_setting_is_503_instead_of_a_job_that_cannot_run(configured, monkeypatch, missing):
    monkeypatch.delenv(missing)

    with pytest.raises((OptimizationFailure, EvaluationFailure)) as error:
        service.accept(REQUEST)

    assert error.value.status == 503


# ---- 잠금(Postgres advisory lock) ----

class FakeConnection:
    def __init__(self, got=True):
        self.got, self.sql, self.closed = got, [], False

    def execute(self, sql, params=()):
        self.sql.append((sql, params))
        return SimpleNamespace(fetchone=lambda: (self.got,))

    def close(self):
        self.closed = True

    def __enter__(self):
        return self

    def __exit__(self, *_):
        self.close()


@pytest.fixture
def database(monkeypatch):
    monkeypatch.setenv('AI_CHECKPOINT_DATABASE_URL', 'postgresql://x')
    made = []

    def connect(url, **options):
        made.append((url, options))
        return connect.connection
    connect.connection = FakeConnection()
    monkeypatch.setattr(service.psycopg, 'connect', connect)
    return SimpleNamespace(connect=connect, made=made)


def test_running_takes_the_lock_to_look_and_gives_it_back_when_it_was_free(database):
    assert service.running('character_simulation.act') is False

    connection = database.connect.connection
    assert [sql.split('(')[0] for sql, _ in connection.sql] == ['SELECT pg_try_advisory_lock', 'SELECT pg_advisory_unlock']
    assert connection.sql[0][1] == ('prompt_optimization:character_simulation.act',) and connection.closed
    assert database.made == [('postgresql://x', {'autocommit': True})]


def test_running_is_true_when_somebody_else_holds_the_lock_and_gives_nothing_back(database):
    database.connect.connection = FakeConnection(got=False)

    assert service.running('character_simulation.act') is True
    assert len(database.connect.connection.sql) == 1


def test_hold_keeps_the_lock_until_its_connection_closes(database):
    with service.hold('character_simulation.act') as acquired:
        assert acquired is True and not database.connect.connection.closed   # 세션 잠금은 연결이 열려 있는 동안 유지된다
    assert database.connect.connection.closed


def test_hold_says_so_when_the_lock_is_taken(database):
    database.connect.connection = FakeConnection(got=False)

    with service.hold('character_simulation.act') as acquired:
        assert acquired is False
    assert database.connect.connection.closed


def test_without_the_database_setting_or_with_a_failed_connection_the_lock_is_a_fixed_503(database, monkeypatch):
    monkeypatch.setattr(service.psycopg, 'connect', lambda *_, **__: (_ for _ in ()).throw(service.psycopg.OperationalError('비밀번호 포함 원문')))
    with pytest.raises(OptimizationFailure) as failed:
        service.running('p')
    assert failed.value.status == 503 and '비밀번호' not in str(failed.value)

    monkeypatch.delenv('AI_CHECKPOINT_DATABASE_URL')
    with pytest.raises(OptimizationFailure) as unset:
        service.running('p')
    assert unset.value.status == 503


# ---- 풀·저장 조건 ----

def write_pool(tmp_path, monkeypatch, rows):
    (tmp_path / 'simulation.act.jsonl').write_text('\n'.join(json.dumps(r, ensure_ascii=False) for r in rows) + '\n', encoding='utf-8')
    monkeypatch.setattr(service, 'POOLS', tmp_path)


def test_the_pool_is_split_by_the_split_in_each_items_metadata(tmp_path, monkeypatch):
    write_pool(tmp_path, monkeypatch, [row(1), row(2, split='val'), row(3)])

    train, val = service.load_pool('simulation.act')

    assert [r['id'][-3:] for r in train] == ['001', '003'] and [r['id'][-3:] for r in val] == ['002']


@pytest.mark.parametrize('rows', [[], [row(1)], [row(1, split='val')], [row(1), {**row(2), 'metadata': {}}]])
def test_a_missing_empty_or_one_sided_pool_is_a_fixed_failure_not_a_run_on_nothing(tmp_path, monkeypatch, rows):
    write_pool(tmp_path, monkeypatch, rows)

    with pytest.raises(OptimizationFailure):
        service.load_pool('simulation.act')

    monkeypatch.setattr(service, 'POOLS', tmp_path / 'nowhere')
    with pytest.raises(OptimizationFailure):
        service.load_pool('simulation.act')


def test_a_candidate_must_keep_the_safety_sentence_and_stay_within_twice_the_base_length():
    assert service.rejection(BASE + ' 더하기', BASE) is None
    assert 'SAFETY' in service.rejection('안전 문장이 없는 지시문', BASE) or '안전' in service.rejection('안전 문장이 없는 지시문', BASE)
    assert service.rejection(BASE + 'ㄱ' * (len(BASE) + 1), BASE) is not None   # 기준의 2배를 넘는다
    assert service.rejection(BASE * 2, BASE) is None   # 2배까지는 허용


# ---- 실행 흐름 ----

@pytest.fixture
def world(monkeypatch, spans):
    """run_job의 협력자: Langfuse 프롬프트(기준 v2·production v1·최신 v5)·평가 서비스·잠금·풀·GEPA."""
    w = SimpleNamespace(created=[], prepared=[], ran=[], optimized=[], acquired=True, no_production=False, baseline=object(), created_version=6,
                        scores=[0.50, 0.62], best=BASE + ' 고쳐 쓴 문장', chat=False)
    client = tracing.client()

    def get_prompt(name, *, version=None, label=None, **_):
        if label == 'production' and w.no_production:
            raise NotFoundError(body='missing')
        number = version if version is not None else {'production': 1, 'latest': 5}[label]
        text = ['메시지'] if w.chat else BASE if number == 2 else '운영 중 지시문'
        return SimpleNamespace(prompt=text, version=number, config={'model': 'gpt-6.1-terra'})

    def create_prompt(**options):
        w.created.append(options)
        return SimpleNamespace(version=w.created_version)

    def prepare(request, run_name=None):
        w.prepared.append((request, run_name))
        return SimpleNamespace(request=request, run_name=run_name or f'{request.prompt}@v{request.version}-base', baseline=w.baseline if request.version == 1 else 'compared')

    def optimize(**options):
        w.optimized.append(options)
        return SimpleNamespace(candidates=[{'instructions': BASE}, {'instructions': w.best}], val_aggregate_scores=w.scores, best_idx=1 if w.scores[1] >= w.scores[0] else 0)

    monkeypatch.setattr(client, 'get_prompt', get_prompt)
    monkeypatch.setattr(client, 'create_prompt', create_prompt)
    monkeypatch.setattr(evaluation, 'prepare', prepare)
    monkeypatch.setattr(evaluation, '_run', w.ran.append)
    monkeypatch.setattr(service, 'hold', lambda prompt: contextlib.nullcontext(w.acquired))
    monkeypatch.setattr(service, 'load_pool', lambda dataset: ([row(1), row(2)], [row(3)]))
    monkeypatch.setattr(agent, 'reflect', lambda text: '새 지시문')
    install_gepa(monkeypatch, optimize)
    w.spans = spans
    return w


def root_of(w):
    [root] = [s for s in w.spans() if s.name == 'prompt_optimization']
    return root


def meta(span, key):
    """루트 관측의 metadata 값. SDK는 문자열·정수는 그대로, 실수는 JSON 문자열로 남긴다."""
    value = attrs(span)[f'langfuse.observation.metadata.{key}']
    return json.loads(value) if isinstance(value, str) and re.fullmatch(r'-?[\d.]+', value) else value


def test_a_good_candidate_is_saved_as_a_new_unlabelled_version_and_evaluated_once_on_the_gate_set(world):
    service.run_job(REQUEST.model_dump())

    [created] = world.created
    assert (created['name'], created['prompt'], created['labels'], created['type'], created['config']) == (
        'character_simulation.act', world.best, [], 'text', {'model': 'gpt-6.1-terra'})   # 라벨 없음, 기준 버전의 모델 설정을 이어받는다
    saved_run = world.prepared[-1][1]
    assert created['commit_message'] == f'GEPA 자동 개선: 기준 v2, val 0.5→0.62, 평가 Run {saved_run}'
    assert re.fullmatch(r'character_simulation\.act@v6-\d{8}T\d{6}Z-[0-9a-f]{6}', saved_run)   # 예상 버전(최신 5 + 1)의 Run 이름을 저장 전에 만들었다
    final = world.prepared[-1][0]
    assert (final.dataset, final.prompt, final.version) == ('simulation.act', 'character_simulation.act', 6)
    assert world.ran[-1].run_name == saved_run


def test_the_trace_records_the_scores_the_saved_version_and_the_run(world):
    service.run_job(REQUEST.model_dump())

    root = root_of(world)
    assert status_of(root) == 'success' and attrs(root)['langfuse.trace.name'] == 'prompt_optimization'
    assert {k: meta(root, k) for k in ('seedScore', 'bestScore', 'savedVersion', 'outcome')} == {'seedScore': 0.5, 'bestScore': 0.62, 'savedVersion': 6, 'outcome': 'saved'}
    assert meta(root, 'evaluationRun') == world.prepared[-1][1]
    assert (attrs(root)['langfuse.trace.metadata.prompt'], attrs(root)['langfuse.trace.metadata.baseVersion'], attrs(root)['langfuse.trace.metadata.maxMetricCalls']) == (
        'character_simulation.act', '2', '150')


def test_gepa_gets_the_base_text_as_the_seed_the_pool_the_budget_and_the_reflection_through_the_gateway(world):
    service.run_job(REQUEST.model_dump())

    [options] = world.optimized
    assert options['seed_candidate'] == {'instructions': BASE} and options['max_metric_calls'] == 150
    assert [r['id'][-3:] for r in options['trainset']] == ['001', '002'] and [r['id'][-3:] for r in options['valset']] == ['003']
    assert options['reflection_lm']('반성 입력') == '새 지시문' and options['raise_on_exception'] is True   # 반성은 agent.reflect(게이트웨이)로 간다
    assert '<curr_param>' in options['reflection_prompt_template'] and '<side_info>' in options['reflection_prompt_template'] and SAFETY in options['reflection_prompt_template']
    assert (options['adapter'].kind, options['adapter'].model) == ('act', 'gpt-6.1-terra')


# GEPA 0.1.4가 logger.log(message)로 내는 줄(logging/utils.py·core/engine.py·proposer/reflective_mutation). 점수 줄은 숫자만 싣고, 나머지는 반성 모델이 쓴 새 지시문·예외 메시지·스택처럼 본문이 실릴 수 있다.
GEPA_SCORE_LINES = [
    'Iteration 0: Base program full valset score: 0.5 over 20 / 20 examples',
    'Iteration 1: Selected program 0 score: 0.5',
    'Iteration 1: New subsample score 2.5 is not better than old score 2.7, skipping',
    'Iteration 2: Accepted candidate (subsample score 1.5 -> 2.5); running full eval.',
    'Iteration 2: Valset score for new program: 0.62 (coverage 20 / 20)',
    'Iteration 2: Individual valset scores for new program: {0: 1.0, 1: 0.25}',
    'Iteration 2: Best score on valset: 0.62',
]
GEPA_TEXT_LINES = [
    'Iteration 2: Proposed new text for instructions: 비밀 지시문 첫 줄\n비밀 지시문 둘째 줄',
    'Iteration 3: Exception during optimization: 비밀 응답이 든 메시지',
    'Traceback (most recent call last):\n  File "x.py", line 1, in f\nValueError: 비밀 응답이 든 메시지',
    'Batched reflection failed (비밀 응답); retrying per task.',
    'Per-task reflection failed: 비밀 응답',
    'Iteration 4: Exception building reflective dataset: 비밀 응답',
]


def test_gepa_gets_a_logger_that_keeps_the_score_lines_and_drops_every_line_that_can_carry_text(world, caplog, capsys):
    """#852: GEPA 기본 로거는 반복마다 반성 모델이 쓴 새 지시문 전체를 print해 워커 로그에 남겼다. 점수 줄만 로그로 남기고 표준 출력에는 아무것도 찍지 않는다."""
    service.run_job(REQUEST.model_dump())
    [options] = world.optimized

    with caplog.at_level(logging.INFO):
        for line in GEPA_SCORE_LINES + GEPA_TEXT_LINES:
            options['logger'].log(line)

    assert all(line in caplog.text for line in GEPA_SCORE_LINES)
    assert '비밀' not in caplog.text and 'Traceback' not in caplog.text
    assert capsys.readouterr() == ('', '')   # print로도 새지 않는다


def test_a_missing_baseline_run_is_made_first_so_the_gate_has_something_to_compare_with(world):
    world.baseline = None

    service.run_job(REQUEST.model_dump())

    assert [request.version for request, _ in world.prepared] == [1, 6]   # production(v1)의 기준 평가가 먼저, 새 버전(v6)의 평가가 마지막
    assert [plan.request.version for plan in world.ran] == [1, 6]


def test_an_existing_baseline_run_is_not_made_again(world):
    service.run_job(REQUEST.model_dump())

    assert [plan.request.version for plan in world.ran] == [6]


def test_without_a_production_label_there_is_no_baseline_to_make_and_the_run_goes_on(world):
    world.no_production = True

    service.run_job(REQUEST.model_dump())

    assert [plan.request.version for plan in world.ran] == [6] and len(world.created) == 1


def test_too_little_improvement_saves_nothing_and_the_trace_says_so(world):
    world.scores = [0.50, 0.54]   # 0.04 < 0.05

    service.run_job(REQUEST.model_dump())

    root = root_of(world)
    assert world.created == [] and world.ran == [] and status_of(root) == 'success'
    assert (meta(root, 'outcome'), meta(root, 'reason'), meta(root, 'seedScore'), meta(root, 'bestScore')) == ('no_improvement', '개선 없음', 0.5, 0.54)


def test_the_gain_needed_is_inclusive_at_five_hundredths(world):
    world.scores = [0.50, 0.55]

    service.run_job(REQUEST.model_dump())

    assert len(world.created) == 1


@pytest.mark.parametrize('best', ['안전 문장이 없는 새 지시문', BASE * 3], ids=['no-safety', 'too-long'])
def test_a_candidate_that_fails_the_safety_or_length_check_is_not_saved(world, best):
    world.best = best

    service.run_job(REQUEST.model_dump())

    root = root_of(world)
    assert world.created == [] and world.ran == [] and meta(root, 'outcome') == 'rejected' and meta(root, 'reason')


def test_a_saved_version_number_that_is_not_the_expected_one_ends_in_error_without_an_evaluation(world):
    world.created_version = 9   # 그사이 다른 새 버전이 생겼다

    service.run_job(REQUEST.model_dump())

    root = root_of(world)
    assert world.ran == [] and status_of(root) == 'failed' and attrs(root)['langfuse.observation.level'] == 'ERROR'
    assert meta(root, 'savedVersion') == 9   # 저장된 버전은 trace에 남는다


def test_a_failure_inside_the_optimization_is_an_error_trace_with_the_fixed_reason_and_does_not_reach_the_worker(world, caplog, monkeypatch):
    def broken(**options):
        raise OptimizationFailure(502, '생성·채점 실패가 20%를 넘어 중단했어요.')
    install_gepa(monkeypatch, broken)

    with caplog.at_level(logging.ERROR):
        service.run_job(REQUEST.model_dump())

    root = root_of(world)
    assert status_of(root) == 'failed' and attrs(root)['langfuse.observation.level'] == 'ERROR'
    assert attrs(root)['langfuse.observation.status_message'] == '생성·채점 실패가 20%를 넘어 중단했어요.'
    assert world.created == [] and '20%' in caplog.text


def test_a_run_that_cannot_take_the_lock_ends_in_error_before_spending_anything(world):
    world.acquired = False

    service.run_job(REQUEST.model_dump())

    root = root_of(world)
    assert status_of(root) == 'failed' and world.optimized == [] and world.prepared == [] and world.created == []


@pytest.mark.parametrize('case, status', [('missing', 404), ('chat', 422)])
def test_a_base_version_that_does_not_exist_or_is_a_chat_prompt_fails_before_any_spending(world, monkeypatch, case, status):
    if case == 'chat':
        world.chat = True
    else:
        monkeypatch.setattr(tracing.client(), 'get_prompt', lambda *a, **k: (_ for _ in ()).throw(NotFoundError(body='missing')))

    service.run_job(REQUEST.model_dump())

    root = root_of(world)
    assert status_of(root) == 'failed' and world.optimized == [] and world.prepared == []
    assert attrs(root)['langfuse.observation.status_message']


def test_an_unexpected_error_is_logged_by_class_and_place_only(world, caplog, monkeypatch):
    """#841 첫 실행: 클래스 이름(TypeError)만으로는 원인을 찾지 못했다. 난 곳(파일:줄 함수)은 코드 위치라 본문이 섞이지 않는다."""
    def broken(**options):
        raise RuntimeError('입력 원문이 든 메시지')
    install_gepa(monkeypatch, broken)

    with caplog.at_level(logging.ERROR):
        service.run_job(REQUEST.model_dump())

    assert 'RuntimeError' in caplog.text and 'test_service.py:' in caplog.text and ' broken' in caplog.text
    assert '원문' not in caplog.text and status_of(root_of(world)) == 'failed'


def test_a_failing_reflection_ends_the_run_at_once_even_though_gepa_swallows_exceptions_of_its_reflection_calls(world, monkeypatch):
    """GEPA는 반성 호출의 Exception을 삼키고 반복을 이어 가 매번 평가 호출(OpenAI 비용)을 쓴다(0.1.4 실측). 그래서 Exception이 아닌 예외로 gepa 밖까지 올린다."""
    swallowed = []

    def optimize(**options):
        try:
            options['reflection_lm']('반성 입력')
        except Exception as error:   # GEPA의 _propose_texts_batch_safe처럼
            swallowed.append(error)
        pytest.fail('반성이 실패했는데 GEPA가 다음 반복으로 넘어갔다')
    install_gepa(monkeypatch, optimize)
    answers = []

    def reflect(text):
        answers.append(text)
        if len(answers) > 1:   # 첫 호출은 게이트웨이 확인이라 통과하고 GEPA 안의 반성 호출부터 실패한다
            raise OptimizationFailure(502, '프롬프트 개선 모델 호출에 실패했어요.')
        return 'OK'
    monkeypatch.setattr(agent, 'reflect', reflect)

    service.run_job(REQUEST.model_dump())

    root = root_of(world)
    assert swallowed == [] and len(answers) == 2 and status_of(root) == 'failed' and world.created == [] and world.ran == []
    assert attrs(root)['langfuse.observation.status_message'] == '프롬프트 개선 모델 호출에 실패했어요.'


def test_a_missing_pool_ends_the_run_before_the_baseline_evaluation_spends_anything(world, monkeypatch):
    world.baseline = None   # 기준 평가가 필요한 상태에서도

    def missing(dataset):
        raise OptimizationFailure(503, '최적화 풀을 읽을 수 없어요.')
    monkeypatch.setattr(service, 'load_pool', missing)

    service.run_job(REQUEST.model_dump())

    root = root_of(world)
    assert status_of(root) == 'failed' and world.prepared == [] and world.ran == [] and world.optimized == []


def test_the_evaluation_runs_start_their_own_traces_instead_of_hanging_under_the_optimization_trace(world, monkeypatch):
    world.baseline = None   # 기준 평가와 최종 평가가 모두 돈다
    plans = []

    def run(plan):   # 정식 평가의 항목 span처럼 현재 추적 문맥 아래에 span을 연다
        plans.append(plan)
        with tracing.observe('experiment-item-run'):
            pass
    monkeypatch.setattr(evaluation, '_run', run)

    service.run_job(REQUEST.model_dump())

    root = root_of(world)
    items = [s for s in world.spans() if s.name == 'experiment-item-run']
    assert len(items) == 2 and status_of(root) == 'success'
    assert all(s.parent is None and s.context.trace_id != root.context.trace_id for s in items)   # 최적화 trace에 붙지 않고 각자 루트다
    assert all('feature:prompt_optimization' not in (attrs(s).get('langfuse.trace.tags') or []) for s in items)   # 전파 속성도 따라가지 않는다
    assert (meta(root, 'baselineRun'), meta(root, 'evaluationRun')) == (plans[0].run_name, plans[1].run_name)   # trace에는 Run 이름만 남는다


def test_a_failing_regression_evaluation_still_ends_the_optimization_in_error(world, monkeypatch):
    def broken(plan):
        raise EvaluationFailure(502, 'Langfuse에서 평가 Run을 찾지 못해 결과를 기록하지 못했습니다.')
    monkeypatch.setattr(evaluation, '_run', broken)

    service.run_job(REQUEST.model_dump())

    root = root_of(world)
    assert status_of(root) == 'failed' and attrs(root)['langfuse.observation.status_message'] == 'Langfuse에서 평가 Run을 찾지 못해 결과를 기록하지 못했습니다.'
    assert meta(root, 'savedVersion') == 6   # 저장은 이미 됐고 trace에 남는다


def test_the_gateway_is_checked_before_the_baseline_evaluation_spends_anything(world, monkeypatch):
    world.baseline = None
    events = []
    prepare = evaluation.prepare
    monkeypatch.setattr(evaluation, 'prepare', lambda request, run_name=None: events.append('prepare') or prepare(request, run_name))
    monkeypatch.setattr(agent, 'reflect', lambda text: events.append('reflect') or 'OK')

    service.run_job(REQUEST.model_dump())

    assert events[:2] == ['reflect', 'prepare']   # 게이트웨이 확인이 OpenAI 호출을 쓰는 기준 평가보다 먼저다


def test_an_unreachable_gateway_ends_the_run_in_error_before_any_openai_call(world, monkeypatch):
    world.baseline = None
    monkeypatch.setattr(agent, 'reflect', lambda text: (_ for _ in ()).throw(OptimizationFailure(502, '프롬프트 개선 모델 호출에 실패했어요.')))

    service.run_job(REQUEST.model_dump())

    root = root_of(world)
    assert status_of(root) == 'failed' and attrs(root)['langfuse.observation.status_message'] == '프롬프트 개선 모델 호출에 실패했어요.'
    assert world.prepared == [] and world.ran == [] and world.optimized == [] and world.created == []   # 평가(OpenAI)도 GEPA도 저장도 없다


class BrokenConnection(FakeConnection):
    """연결은 됐지만 질의가 실패하는 연결. fail_on은 몇 번째 질의부터 실패하는지(1 = 첫 질의)다."""

    def __init__(self, fail_on):
        super().__init__(got=True)
        self.fail_on = fail_on

    def execute(self, sql, params=()):
        if len(self.sql) + 1 >= self.fail_on:
            raise service.psycopg.OperationalError('server closed the connection: postgresql://user:비밀번호@postgres')
        return super().execute(sql, params)


@pytest.mark.parametrize('fail_on', [1, 2], ids=['lock-query', 'unlock-query'])
def test_a_query_failure_after_connecting_is_the_same_fixed_503_and_the_connection_is_closed(database, fail_on):
    database.connect.connection = BrokenConnection(fail_on)

    with pytest.raises(OptimizationFailure) as error:
        service.running('character_simulation.act')

    assert error.value.status == 503 and '비밀번호' not in str(error.value) and database.connect.connection.closed


def test_hold_fails_with_the_fixed_503_when_the_lock_query_fails_and_still_closes_the_connection(database):
    database.connect.connection = BrokenConnection(1)

    with pytest.raises(OptimizationFailure) as error:
        with service.hold('character_simulation.act'):
            pytest.fail('잠금을 못 잡았는데 실행으로 넘어갔다')

    assert error.value.status == 503 and '비밀번호' not in str(error.value) and database.connect.connection.closed