"""Langfuse 기반 집필 AI 추적(#302). 단계·근거 참조·판본·모델·사용량·실패 여부와 허용된 본문을 보낸다.

팀 결정(2026-11-13)으로 질문·원고·답변 본문은 observation의 input/output에 남긴다. 결정 범위 밖인 설정·현재 관계
발췌 본문은 참조(id·회차·종류)만 남기고(`excerpts`), 키·회원 계정 정보는 어떤 속성에도 넣지 않는다.
예외는 span 밖으로 넘겨 예외 이벤트(메시지·입력값)가 기록되지 않게 하고, 기능 실패의 고정 메시지만 남긴다.
LANGFUSE_PUBLIC_KEY·LANGFUSE_SECRET_KEY가 없으면 추적과 프롬프트 관리를 끈다. 전송은 SDK가 백그라운드로 하므로
Langfuse 장애가 작업 결과를 바꾸지 않는다(프롬프트를 읽지 못해 기능이 실패하는 경우만 예외다). 서버 주소는 SDK가 LANGFUSE_BASE_URL에서 읽는다.

DEC-55 계측 규칙(Langfuse v4): AI 요청 하나가 trace 하나이고 요청 루트 관측 하나가 요청 전체를 덮는다. `request`가 그 루트를 열어
회원(user_id=회원 UUID)·세션·trace 이름·기능 태그·metadata를 루트와 안의 모든 observation에 붙이고, 끝나면 상태(success·failed·timeout)를
루트의 metadata `status`로 남긴다. 지시문은 `prompt`가 Langfuse Prompt Management의 production 버전을 읽어 주고(코드 문자열은
최초 등록용), generation에 연결한다.
"""

import base64
import json
import logging
import os
from contextlib import contextmanager
from dataclasses import dataclass
from functools import lru_cache
from types import SimpleNamespace
from typing import Any
from uuid import UUID, uuid4

from langfuse import Langfuse, propagate_attributes
from langfuse.api import NotFoundError

_OFF = '0' * 32
logger = logging.getLogger(__name__)


def enabled() -> bool:
    """LANGFUSE 키가 둘 다 있을 때만 추적과 프롬프트 관리를 켠다."""
    return bool(os.environ.get('LANGFUSE_PUBLIC_KEY') and os.environ.get('LANGFUSE_SECRET_KEY'))


@lru_cache(maxsize=1)
def client() -> Langfuse:
    return Langfuse(tracing_enabled=enabled(), timeout=2)


@contextmanager
def observe(name: str, **fields):
    """현재 문맥의 하위 observation. 실패하면 level=ERROR와 안전한 메시지를 남기고 예외를 그대로 올린다."""
    error = None
    with client().start_as_current_observation(name=name, **fields) as span:
        try:
            yield span
        except Exception as exc:  # span 밖에서 다시 올린다.
            error = exc
            # 기능 실패(status가 있는 예외)의 메시지는 고정 문구다. 그 밖의 예외는 입력값을 담을 수 있어 이름만 남긴다.
            span.update(level='ERROR', status_message=str(exc) if hasattr(exc, 'status') else type(exc).__name__)
    if error is not None:
        raise error


def excerpts(items) -> list[dict]:
    """근거 발췌의 추적용 표현. 원고(manuscript) 인용만 본문을 담고 설정·현재 관계는 참조만 남긴다."""
    return [{'id': e.id, 'episode': e.episode, 'kind': e.kind, **({'quote': e.quote} if e.kind == 'manuscript' else {})}
            for e in items]


def context(run_id: str | None, parent_id: str | None) -> dict | None:
    """저장해 둔 trace(요청 루트의 id)에 이어 붙는 trace_context. 추적이 꺼져 있으면 None."""
    return {'trace_id': run_id, 'parent_span_id': parent_id} if run_id else None


def timed_out(error: BaseException | None) -> bool:
    """예외 사슬(__cause__·__context__)에 시간 초과가 있는지. 기능이 `from None`으로 고정 문구 실패로 바꿔도 __context__는 남는다.

    제공사·HTTP 라이브러리마다 시간 초과 예외 클래스가 달라(openai APITimeoutError, httpx·httpx2 TimeoutException, TimeoutError) 이름으로 본다.
    """
    while error is not None:
        if any('Timeout' in cls.__name__ for cls in type(error).__mro__):
            return True
        error = error.__cause__ or error.__context__
    return False


@contextmanager
def request(feature: str, *, user_id: str | None = None, session_id: str | None = None, trace_context: dict | None = None,
            fork: bool = False, **metadata):
    """AI 요청 하나 = trace 하나 = 요청 루트 관측 하나(DEC-55 v4). 루트는 이 안의 요청 전체(SSE 끝까지)를 덮고 가장 마지막에 끝난다.

    루트와 안의 모든 observation에 회원·세션·trace 이름(=기능 키)·태그 `feature:<키>`·metadata(request_id·fork·work_id 등)를
    propagate_attributes로 붙인다(v4는 observation별로 거르므로 하위 generation 비용도 기능·회원별로 모을 수 있어야 한다).
    상태는 끝나야 알 수 있어 **루트에만** metadata `status`로 남기고(이미 내보낸 하위 observation은 고칠 수 없다) 실패·시간 초과면 level ERROR다.
    예외는 failed(시간 초과면 timeout)로 남기고 그대로 올린다. 예외 없이 끝난 요청의 상태는 내주는 run.status(기본 success, 응답을 보고 바꾼다.
    None이면 남기지 않는다)다. run.trace_id·span_id는 루트의 id다(추적이 꺼져 있으면 None). fork는 항상 'true'/'false', 나머지 metadata는
    문자열 값이고 비어 있으면 뺀다. trace_context를 주면 그 trace에 새 루트로 붙는다(대화에서 멈췄던 턴을 이어 가는 요청).
    """
    meta = {'request_id': uuid4().hex, 'fork': 'true' if fork else 'false', **{k: v for k, v in metadata.items() if v}}
    run = SimpleNamespace(status='success', trace_id=None, span_id=None)
    with propagate_attributes(user_id=user_id, session_id=session_id, trace_name=feature, tags=[f'feature:{feature}'], metadata=meta):
        with observe(feature, trace_context=trace_context) as span:
            if span.trace_id != _OFF:
                run.trace_id, run.span_id = span.trace_id, span.id
            try:
                yield run
            except Exception as error:
                run.status = 'timeout' if timed_out(error) else 'failed'
                raise
            except BaseException:  # 취소·SSE 연결 끊김: 끝나지 않은 요청이라 상태를 남기지 않는다
                run.status = None
                raise
            finally:
                if run.status:
                    span.update(metadata={'status': run.status}, **({'level': 'ERROR'} if run.status != 'success' else {}))


def member_id(authorization: str) -> str | None:
    """Bearer 토큰(JWT)의 sub(회원 UUID). 서명은 검증하지 않는다: 추적 태그 전용이며 인가에 쓰지 않는다(Content MCP가 같은 토큰을 검증한다)."""
    try:
        payload = authorization.split('.')[1]
        return str(UUID(json.loads(base64.urlsafe_b64decode(payload + '=' * (-len(payload) % 4)))['sub']))
    except (AttributeError, IndexError, KeyError, TypeError, ValueError):
        return None


def feedback(trace_id: str, value: str | None) -> None:
    """작가의 답변 평가(#560)를 그 턴 trace의 user_feedback 점수(1/0)로 맞춘다. 턴마다 점수 id가 하나라 바꾸면 덮어쓰고 취소(None)하면 지운다.

    정본은 대화 체크포인터라 Langfuse 실패는 기록만 하고 저장을 실패시키지 않는다.
    """
    if not enabled():
        return
    score_id = f'{trace_id}-user-feedback'
    try:
        if value is None:
            client().flush()  # 아직 보내지 않은 점수가 삭제 뒤에 도착해 되살아나지 않게 먼저 보낸다
            # shortcut: 서버가 점수를 비동기로 적재해 누르자마자 취소하면 삭제가 먼저 닿아(404) 점수가 남을 수 있다. 분석이 어긋나면 취소를 늦게 지우는 작업으로 바꾼다.
            client().api.legacy.score_v1.delete(score_id)
        else:
            client().create_score(score_id=score_id, trace_id=trace_id, name='user_feedback', value=1.0 if value == 'up' else 0.0,
                                  data_type='BOOLEAN')
    except Exception as error:  # 없는 점수 삭제(404)·연결 실패 모두 분석 데이터만 어긋난다
        logger.warning('user_feedback 점수를 맞추지 못했습니다: %s', type(error).__name__)


class PromptUnavailable(Exception):
    """Langfuse 키가 있는데 프롬프트를 읽거나 등록할 수 없고 SDK 캐시에도 없다. 기능은 고정 문구의 503으로 끝낸다."""


@dataclass(frozen=True)
class Prompt:
    """text는 모델에 보낼 지시, client는 generation에 연결할 Langfuse 프롬프트(키가 없으면 None),
    model은 운영 화면이 그 버전에 고른 모델(버전 config.model, #705). None이면 호출이 환경 변수 기본 모델을 쓴다."""
    text: str
    client: Any = None
    model: str | None = None


SEED = 'seed'  # 지금 코드 시드와 본문이 같은 버전의 라벨(#705). production과 다르면 운영 화면이 '코드 시드 대기'로 보인다


def prompt(name: str, default: str) -> Prompt:
    """Langfuse Prompt Management의 production 버전 지시와 모델. 키가 없으면 코드 문자열(default)을 그대로 쓴다.

    없는 프롬프트(404)는 default를 버전 1(production·seed)로 등록해 쓴다. 읽기에 실패하면 SDK가 캐시(마지막 성공 값)를 주고,
    캐시도 없으면 default로 바꾸지 않고 PromptUnavailable이다. 읽을 때마다 코드 시드를 `seed` 라벨 버전으로 맞춘다(_sync_seed).
    shortcut: 서버가 막 뜬 직후 같은 프롬프트를 동시에 처음 쓰면 같은 내용의 버전이 둘 생길 수 있고, 프롬프트마다 첫 읽기는 동기 HTTP다
    (이후는 SDK 캐시). 문제 되면 시작 때 한 번 등록·예열한다.
    """
    if not enabled():
        return Prompt(default)
    try:
        try:
            managed = client().get_prompt(name, label='production', cache_ttl_seconds=60)
        except NotFoundError:
            managed = client().create_prompt(name=name, prompt=default, labels=['production', SEED], type='text')
    except Exception:
        raise PromptUnavailable from None
    _sync_seed(name, default, managed)
    return Prompt(managed.prompt, managed, model_of(managed.config))


def model_of(config: dict | None) -> str | None:
    """프롬프트 버전 config의 model(운영 화면에서 고른 모델, #705). 이름(문자열)이 아니면 없는 것으로 보고 호출이 환경 변수 기본 모델을 쓴다."""
    model = (config or {}).get('model')
    return model.strip() or None if isinstance(model, str) else None


def _seed_text(name: str, cache_ttl_seconds: int) -> str | None:
    try:
        return client().get_prompt(name, label=SEED, cache_ttl_seconds=cache_ttl_seconds).prompt
    except NotFoundError:
        return None


def _sync_seed(name: str, default: str, cached) -> None:
    """코드 시드(default)를 `seed` 라벨 버전으로 맞춘다(#705, 시드를 바꿀 때마다 손으로 새 버전을 올리던 일을 없앤다).

    production 본문이 시드와 같으면 그 버전에 seed 라벨만 단다(시드 본문으로 모델만 바꾼 버전을 승격해도 seed가 따라온다). 다르면 seed 버전이
    이미 시드면 그대로 두고, 아니면 시드를 라벨 seed의 새 버전(production의 모델 config를 이어받는다)으로 등록한다. production은 옮기지 않는다:
    운영 화면에서 회귀 평가를 통과해야 승격된다. 호출마다 돌지만 맞춰진 상태는 SDK 캐시 읽기뿐이고, 쓰기 직전에만 캐시 없이 다시 읽는다
    (캐시의 지난 라벨로 쓰면 그 사이 승격된 production을 되돌리거나 같은 시드를 두 번 등록할 수 있다).
    실패는 기록만 한다: 화면에 시드가 늦게 보일 뿐 기능은 production 버전으로 돌고 다음 호출이 다시 맞춘다.
    """
    try:
        if SEED in cached.labels if cached.prompt == default else _seed_text(name, 60) == default:
            return
        production = client().get_prompt(name, label='production', cache_ttl_seconds=0)
        if production.prompt == default:
            if SEED not in production.labels:  # Langfuse가 라벨을 버전 사이에서 하나로 유지하므로 다른 버전의 seed는 여기로 옮겨진다
                client().update_prompt(name=name, version=production.version, new_labels=[*(label for label in production.labels if label != 'latest'), SEED])
        elif _seed_text(name, 0) != default:
            client().create_prompt(name=name, prompt=default, labels=[SEED], type='text', config=production.config)
    except Exception as error:
        logger.warning('%s 코드 시드를 Langfuse에 맞추지 못했습니다: %s', name, type(error).__name__)
