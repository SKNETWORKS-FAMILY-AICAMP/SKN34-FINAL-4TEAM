"""자동 개선 테스트 대역. gepa·모델·Langfuse·Postgres는 부르지 않는다."""

import sys
import types
from dataclasses import dataclass

from app.simulation.prompt import SAFETY


@dataclass
class Batch:
    """gepa.EvaluationBatch 대역(어댑터는 속성만 채운다)."""
    outputs: list
    scores: list
    trajectories: list | None = None


def install_gepa(monkeypatch, optimize=None):
    """설치하지 않은 gepa를 sys.modules 대역으로 둔다(단위 테스트는 --extra eval 없이 통과해야 한다)."""
    fake = types.SimpleNamespace(EvaluationBatch=Batch, optimize=optimize)
    monkeypatch.setitem(sys.modules, 'gepa', fake)
    return fake


FACTS = [{'id': 'f1', 'text': '곧 일어날 미래 사건'}, {'id': 'f2', 'text': '다른 인물만 아는 비밀'}]


def row(n, kind='act', split='train'):
    """최적화 풀 한 줄(평가 세트 항목과 같은 모양 + metadata.split)."""
    data = {'self': {'id': 'c1', 'name': '길동'}, 'scene': [{'ref': 'scene:0', 'by': '길동', 'text': f'"{n}번 장면."'}]}
    return {'id': f'simulation.{kind}.opt-{n:03d}', 'input': {'set': 'dialogue' if kind == 'act' else 'narration', 'data': data}, 'expectedOutput': f'정답 {n}',
            'metadata': {'split': split, 'license': '저작권 만료', 'judge': {'character': '길동', 'scene': [{'by': '길동', 'text': '"가자."'}], 'facts': FACTS}}}


BASE = '기준 지시문입니다. ' + SAFETY
