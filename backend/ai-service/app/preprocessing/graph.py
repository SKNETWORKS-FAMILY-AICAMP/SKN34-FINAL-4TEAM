"""회차 원고 전처리 그래프(LangGraph StateGraph, 체크포인터 없음). Celery task 하나가 접수 1건의 그래프를 `invoke`한다.

    start ─(Send)→ extract × 회차 → collect ─┬─ 실패 회차가 있으면 → fail → END
                                              └─ resolve → organize → load → END

- `extract`: 회차마다 독립 노드가 병렬로 돌고(`max_concurrency`는 `PREPROCESSING_MAX_CONCURRENCY`, 기본 4) 원문을 읽어 추출하고
  인용을 원문과 대조한다. 한 회차의 실패는 예외가 아니라 실패 회차로 모은다.
- `collect`: 병렬 노드가 모두 끝난 지점이다. 분기는 이 시점에 합쳐진 state를 보고 정한다.
- 정리 단계(`resolve`·`organize`·`load`)는 state에 모인 추출 결과만 읽고, 단계 진입을 Content에 알린다.
- 단계가 실패하면 `StageFailure`로 올라가고 Content 작업 상태에 `failed`로 남기는 일은 task가 한다.
"""
import logging
import os
from functools import wraps
from typing import Annotated, TypedDict

from langgraph.graph import END, START, StateGraph
from langgraph.types import Send

from app.preprocessing import content, service
from app.preprocessing.errors import REASONS, START_FAILED, PreprocessingFailure, StageFailure, error_code
from app.preprocessing.models import LoadPayload

log = logging.getLogger(__name__)


def _merge(left: dict[int, object], right: dict[int, object]) -> dict[int, object]:
    return {**left, **right}


def _numbers(left: list[int], right: list[int]) -> list[int]:
    return sorted({*left, *right})


# ponytail: 같은 jobId 재접수는 받은 회차만 정리한다(앞선 성공 회차의 추출 결과 보관 없음). 진행은 단계 진입만 알린다.
class State(TypedDict, total=False):
    job_id: str
    episodes: list[int]                                            # 이번 접수에서 받은 회차
    extractions: Annotated[dict[int, object], _merge]              # 병렬 추출 노드가 합치는 회차별 추출 결과
    failed: Annotated[list[int], _numbers]                         # 추출에 실패한 회차
    identities: object
    payload: LoadPayload


def guarded(stage: str, reason: str | None = None):
    """노드의 어떤 오류든 단계 이름을 붙여 StageFailure로 올린다. 예외 메시지(원고가 섞일 수 있다)는 버리고 코드만 남긴다."""
    def decorate(node):
        @wraps(node)
        def run(state):
            try:
                return node(state)
            except Exception as error:
                raise StageFailure(stage, reason or REASONS[stage], error_code(error)) from None
        return run
    return decorate


def report(job_id: str, stage: str, done: int, total: int, failed_episodes=(), failed: str | None = None) -> None:
    """진행·실패를 알린다. 알리지 못해도 이미 하던 일은 멈추지 않으므로 고정 코드만 기록한다."""
    try:
        content.progress(job_id, stage, done, total, failed_episodes, failed)
    except PreprocessingFailure as error:
        log.warning('progress update failed: job=%s stage=%s code=%s', job_id, stage, error)


@guarded('extracting', START_FAILED)
def start(state: State) -> dict:
    content.progress(state['job_id'], 'extracting', 0, len(state['episodes']))
    return {}


def fan_out(state: State) -> list[Send]:
    return [Send('extract', {'job_id': state['job_id'], 'number': number}) for number in state['episodes']]


def extract(task: dict) -> dict:
    """회차 하나를 읽고 추출·인용 검증을 거친다. 어떤 오류든 그 회차의 실패로 모은다."""
    try:
        return {'extractions': {task['number']: service.extract(content.read_episode(task['job_id'], task['number']))}}
    except Exception as error:
        log.warning('episode failed: job=%s episode=%s code=%s', task['job_id'], task['number'], error_code(error))
        return {'failed': [task['number']]}


def collect(state: State) -> dict:
    return {}


def route(state: State) -> str:
    return 'fail' if state.get('failed') else 'resolve'


@guarded('extracting')
def fail(state: State) -> dict:
    """추출 실패 회차가 하나라도 있으면 정리 단계 없이 작업을 실패로 닫는다."""
    report(state['job_id'], 'extracting', len(state.get('extractions', {})), len(state['episodes']), state['failed'], REASONS['extracting'])
    return {}


@guarded('resolving')
def resolve(state: State) -> dict:
    content.progress(state['job_id'], 'resolving', 0, 1)
    return {'identities': service.resolve(state['extractions'])}


@guarded('organizing')
def organize(state: State) -> dict:
    content.progress(state['job_id'], 'organizing', 0, 1)
    return {'payload': service.organize(state['identities'], state['extractions'])}


@guarded('loading')
def load(state: State) -> dict:
    content.progress(state['job_id'], 'loading', 0, 1)
    content.load(state['job_id'], state['payload'])
    return {}


def _build():
    builder = StateGraph(State)
    for name, node in (('start', start), ('extract', extract), ('collect', collect), ('fail', fail), ('resolve', resolve),
                       ('organize', organize), ('load', load)):
        builder.add_node(name, node)
    builder.add_edge(START, 'start')
    builder.add_conditional_edges('start', fan_out, ['extract'])
    builder.add_edge('extract', 'collect')
    builder.add_conditional_edges('collect', route, ['fail', 'resolve'])
    for before, after in (('fail', END), ('resolve', 'organize'), ('organize', 'load'), ('load', END)):
        builder.add_edge(before, after)
    return builder.compile()


pipeline = _build()


def run(job_id: str, episodes: list[int]) -> State:
    """접수 1건의 그래프를 끝까지 실행한다. 단계 실패는 StageFailure로 올라간다."""
    return pipeline.invoke({'job_id': job_id, 'episodes': episodes},
                           config={'max_concurrency': int(os.environ.get('PREPROCESSING_MAX_CONCURRENCY') or 4)})
