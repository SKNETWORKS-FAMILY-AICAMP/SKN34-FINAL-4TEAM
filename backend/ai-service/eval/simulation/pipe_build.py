"""파이프라인 평가 ①(평가 전용): 원문 회차 → 서비스의 extract → resolve → organize를 실제 코드·프롬프트로 돌려 LoadPayload를 만든다. Content·Neo4j는 부르지 않는다.

모델 호출은 서비스 그대로(app/manuscript_extraction의 production 프롬프트 코드 시드, Langfuse 키가 없으면 코드 문자열)이고, 이 모듈은 단계마다 응답을 .data에 캐시한다.
캐시 열쇠 = 단계 이름 + 지시문 + 모델 + 입력(원문 또는 앞 단계 결과)의 해시라 원문·지시문·모델이 바뀔 때만 다시 부른다. 실패한 회차는 캐시하지 않는다(일시 오류가 영구 기록이 되지 않게).
운영과 다른 점: 회차 하나가 실패해도 나머지 회차로 세계관을 만들고 실패를 결과에 센다(운영은 그 작업을 실패로 끝내고 이어 받는다). 모든 회차가 실패하거나 정체 정리·구성이 실패하면 그 작품의 세계관은 없다(WorldFailed).
"""

import hashlib
import json
import os
from concurrent.futures import ThreadPoolExecutor
from dataclasses import dataclass
from pathlib import Path
from types import SimpleNamespace

from orig_common import SEED  # noqa: F401,I001  경로 설정(eval/novelbrain)이 아래 import보다 먼저여야 한다
from httpx import Timeout

import sim_via
from cost import usd
from llm import CallCapExceeded
from pipe_world import relation_quotes

from app.manuscript_extraction import agent, prompt, service
from app.manuscript_extraction.errors import PreprocessingFailure
from app.manuscript_extraction.models import EpisodeExtraction, EpisodeText, IdentityResolution, LoadPayload

RESERVE_USD = 0.05          # 진행 중인 호출이 상한을 넘기지 않게 남겨 두는 여유(llm.RESERVE_USD와 같다)
CALL_MAX_USD = 0.03         # 추출 호출 하나가 쓸 수 있는 최대 금액 어림(입력 12만 자 제한 + 출력 16,000토큰, luna 단가): 동시 호출 수만큼 여유를 둔다
READ_TIMEOUT = 300          # ocx 게이트웨이는 지연이 OpenAI API와 달라 운영의 읽기 70초를 늘린다
CHARS_PER_TOKEN = 1.3       # 지시문 + 회차 JSON의 글자/토큰 비: 유료 실행 실측(공개 세트 14편 92회차, 입력 평균 5,297토큰)에서 1.30(고어체가 많아 근대 소설만이면 1.35~1.5)
# 호출당 토큰은 유료 실행 실측(OpenAI gpt-6-luna, 2026-11-24, 공개 세트 14편): 추출 입력 평균 5,297·출력 평균 5,083(ocx 스모크 m01은 출력 859~2,258이었다), 정체 정리 입력 평균 7,184(회차당 약 1,100)·출력 평균 1,120.
# ponytail: 작품·모델이 달라지면 장부(cost-pipeline.jsonl)의 호출당 토큰으로 다시 고친다.
EXTRACT_OUT, RESOLVE_OUT, RESOLVE_IN_PER_EPISODE = 5100, 1100, 1100


class CacheMiss(RuntimeError):
    """오프라인(모델 호출 없이)으로 읽는데 캐시에 없다."""


class WorldFailed(RuntimeError):
    """작품의 ①이 끝까지 가지 못했다. 메시지는 고정 코드다(원문·모델 응답 없음)."""


@dataclass
class Built:
    """한 작품의 ① 결과: 회차별 검증된 추출·적재 payload·관계 근거 인용·실패한 회차(번호, 코드)·이번에 실제로 부른 모델 호출 수."""
    extractions: dict[int, EpisodeExtraction]
    payload: LoadPayload
    quotes: dict
    failures: list[tuple[int, str]]
    calls: int


def stage_key(stage: str, instructions: str, model: str, data) -> str:
    return hashlib.sha256(json.dumps([stage, instructions, model, data], ensure_ascii=False, sort_keys=True).encode()).hexdigest()


def episodes_of(work: dict) -> list[EpisodeText]:
    """작품의 회차 원문 → 운영이 extract에 넘기는 EpisodeText(제목이 없으면 'N화')."""
    return [EpisodeText(number=e['number'], title=e.get('title') or f"{e['number']}화", body=e['text']) for e in work['episodes']]


def _extract_path(folder: Path, episode: EpisodeText, model: str) -> Path:
    return folder / f"extract-{episode.number:03d}.{stage_key('extract', prompt.EXTRACT, model, episode.model_dump())[:12]}.json"


def _resolve_path(folder: Path, model: str, extractions: dict) -> Path:
    return folder / f"resolve.{stage_key('resolve', prompt.RESOLVE, model, [extractions[n].model_dump() for n in sorted(extractions)])[:12]}.json"


def build_world(work: dict, cache: Path, model: str, offline: bool = False, workers: int = 4) -> Built:
    """한 작품을 ①로 돌려 캐시와 함께 Built를 돌려준다. offline이면 캐시에 없는 단계에서 CacheMiss다(모델을 부르지 않는다). 운영처럼 회차는 workers개씩 동시에 뽑는다."""
    folder = Path(cache) / work['id']
    calls = 0

    def one(episode: EpisodeText):
        path = _extract_path(folder, episode, model)
        failed = path.with_suffix('.failed')   # 실패 표시: 다시 하면 그 회차를 다시 부르고(캐시하지 않는다), 오프라인 읽기는 추출 파일이 없을 때만 이것으로 실패를 알아본다
        if path.exists():
            return episode.number, EpisodeExtraction.model_validate_json(path.read_text(encoding='utf-8')), None, 0
        if offline:
            if failed.exists():
                return episode.number, None, failed.read_text(encoding='utf-8'), 0
            raise CacheMiss(f"{work['id']} {episode.number}화 추출이 캐시에 없다")
        path.parent.mkdir(parents=True, exist_ok=True)
        try:
            row = service.extract(episode)
        except PreprocessingFailure as error:   # 코드는 고정 문자열이다
            failed.write_text(str(error), encoding='utf-8')
            return episode.number, None, str(error), 1
        path.write_text(row.model_dump_json(), encoding='utf-8')
        return episode.number, row, None, 1

    with ThreadPoolExecutor(workers) as pool:
        done = list(pool.map(one, episodes_of(work)))
    ok = {n: row for n, row, _, _ in done if row}
    failures = [(n, code) for n, _, code, _ in done if code]
    calls += sum(made for *_, made in done)
    if not ok:
        raise WorldFailed('NO_EXTRACTION')
    path = _resolve_path(folder, model, ok)
    failed = path.with_suffix('.failed')
    if path.exists():
        identity = IdentityResolution.model_validate_json(path.read_text(encoding='utf-8'))
    elif offline:
        if failed.exists():
            raise WorldFailed(failed.read_text(encoding='utf-8'))
        raise CacheMiss(f"{work['id']} 정체 정리가 캐시에 없다")
    else:
        try:
            identity = service.resolve(ok)
        except PreprocessingFailure as error:
            failed.write_text(str(error), encoding='utf-8')
            raise WorldFailed(str(error)) from None
        path.write_text(identity.model_dump_json(), encoding='utf-8')
        calls += 1
    try:
        payload = service.organize(identity, ok)   # 모델 호출 없는 결정적 구성이라 캐시하지 않는다
    except PreprocessingFailure as error:
        raise WorldFailed(str(error)) from None
    path.with_name(path.name.replace('resolve.', 'payload.')).write_text(payload.model_dump_json(indent=1), encoding='utf-8')
    return Built(ok, payload, relation_quotes(ok, identity), sorted(failures), calls)


def estimate_build(works: dict[str, dict], cache: Path, model: str) -> dict:
    """호출 없이 캐시에 없는 ① 호출 수·토큰·금액(gpt-5.6-luna 단가 어림, cost.py)을 센다. 추출은 회차마다 한 번, 정체 정리는 작품마다 한 번(추출이 하나라도 바뀌면 다시)이다."""
    out = {'extract': 0, 'resolve': 0, 'tokensIn': 0, 'tokensOut': 0}
    for wid, work in works.items():
        folder, cached, episodes = Path(cache) / wid, {}, episodes_of(work)
        for episode in episodes:
            path = _extract_path(folder, episode, model)
            if path.exists():
                cached[episode.number] = EpisodeExtraction.model_validate_json(path.read_text(encoding='utf-8'))
                continue
            out['extract'] += 1
            out['tokensIn'] += int((len(prompt.EXTRACT) + len(json.dumps(episode.model_dump(), ensure_ascii=False))) / CHARS_PER_TOKEN)
            out['tokensOut'] += EXTRACT_OUT
        if len(cached) < len(episodes) or not _resolve_path(folder, model, cached).exists():
            out['resolve'] += 1
            out['tokensIn'] += int(len(prompt.RESOLVE) / CHARS_PER_TOKEN) + RESOLVE_IN_PER_EPISODE * len(episodes)
            out['tokensOut'] += RESOLVE_OUT
    return {**out, 'usd': usd(out['tokensIn'], out['tokensOut'])}


def chat_factory(real, cost, limit_usd: float | None = None, overrides: dict | None = None, backoff=None, reserve: float = RESERVE_USD):
    """manuscript_extraction.agent.ChatOpenAI 자리에 끼우는 생성자. 서비스가 정한 인자는 그대로 두고(overrides만 덮는다) 구조화 호출마다 사용량을 장부에 남긴다.
    장부 합계 + reserve가 limit_usd를 넘으면 모델을 부르기 전에 CallCapExceeded다. backoff가 있으면 호출을 그 함수로 감싼다(ocx의 429 대기)."""
    def chat(**options):
        llm = real(**{**options, **(overrides or {})})

        def structured(schema, **kwargs):
            runnable = llm.with_structured_output(schema, **kwargs)

            def invoke(messages):
                if limit_usd is not None and cost.spent() + reserve > limit_usd:
                    raise CallCapExceeded(f'비용 상한 {limit_usd:.2f}달러에 도달했다.')
                result = backoff(lambda: runnable.invoke(messages)) if backoff else runnable.invoke(messages)
                usage = getattr(result.get('raw'), 'usage_metadata', None) or {}
                cost.record(schema.__name__, usage.get('input_tokens', 0), usage.get('output_tokens', 0), (usage.get('input_token_details') or {}).get('cache_read', 0))
                return result
            return SimpleNamespace(invoke=invoke)
        return SimpleNamespace(with_structured_output=structured)
    return chat


def install(via: str, cost, limit_usd: float | None = None, reserve: float = RESERVE_USD) -> None:
    """이 프로세스의 추출 호출을 장부에 남기게 바꾼다. via='ocx'면 로컬 게이트웨이(금액 0, gpt-6-luna)로 보낸다: 환경변수·시뮬레이션 agent도 게이트웨이로 바뀌어 실제 키가 어디로도 가지 않는다. 되돌리지 않는다."""
    if via == 'ocx':
        sim_via.use_ocx()
        os.environ.setdefault('OPENAI_MODEL', sim_via.MODEL)
        agent.ChatOpenAI = chat_factory(agent.ChatOpenAI, cost, overrides={'model': sim_via.MODEL, 'api_key': 'ocx', 'base_url': sim_via.GATEWAY,
                                                                          'timeout': Timeout(60, read=READ_TIMEOUT)}, backoff=sim_via.backoff)
    else:
        agent.ChatOpenAI = chat_factory(agent.ChatOpenAI, cost, limit_usd, reserve=reserve)
