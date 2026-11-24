"""검색 품질 평가(#825): 고정 스냅샷으로 NovelBrain `_recall`의 단계별 순위가 임계값 아래로 내려가지 않는지 본다.

스냅샷(`fixtures/`)은 한국어 62문항(저장소 샘플 3편)의 recall 입력을 `eval/novelbrain/ko.py snapshot`이 그대로 얼린 것이다: Content MCP 응답 모양의 세계관,
질문마다 인물·기준 회차·질문·E5 상위 10 발췌(모델이 필요한 유일한 단계라 그 결과만 고정). 그래서 모델·네트워크 없이 PPR·BM25·RRF·인물 시점 필터만 결정적으로 돈다.
단계별 수치는 `eval/novelbrain/results/ko-retrieval.json`과 같고, 임계값은 그 값을 소수 둘째 자리 아래로 내린 것이라 문항을 하나 잃으면(Recall 1/24·1/14, 누설 1/13) 깨진다.
값을 올리는 변경은 임계값도 올린다. 고정 입력이 달라지는 변경(샘플·질문·인코더)은 `ko.py run`과 `ko.py snapshot`을 다시 돌려 둘을 함께 갱신한다.
"""

import json
from collections import Counter
from pathlib import Path
from statistics import mean

import pytest

from app.novelbrain.models import world_snapshot
from app.novelbrain.service import _recall
from app.story_qa.models import Excerpt
from eval.novelbrain.metrics import dedupe, recall_at_k, reciprocal_rank

RESULTS = Path(__file__).resolve().parents[2] / 'eval/novelbrain/results/ko-retrieval.json'
K, ALL = 5, 10 ** 6  # 지표는 상위 5 근거만 센다. 관계 항목은 근거가 아니라 빼야 하므로 순위 전체를 받아 같은 규칙으로 자른다.


def evidence_ids(refs: list[str]) -> list[str]:
    """recall 항목 ref → 근거 id(문단·카드). 관계는 근거가 아니다(`eval/novelbrain/ko.py`의 `evidence_ids`와 같은 규칙)."""
    return dedupe(rest.partition('#')[0] for kind, _, rest in (ref.partition(':') for ref in refs) if kind in ('manuscript', 'card'))


def top5(worlds: dict, q: dict, stage: int) -> list[str]:
    world = world_snapshot(worlds[q['work']], q['episode'])
    manuscript = [Excerpt(id=id_, episode=episode, quote=quote) for id_, episode, quote in q['manuscript']]
    items = _recall(world, q['character'], q['episode'], q['question'], stage, manuscript, ALL).items
    return evidence_ids([i.ref for i in items])[:K]


def measure(worlds: dict, questions: list[dict], stage: int) -> dict:
    """종류별 지표. known·setting은 Recall@5·MRR@5 평균, future·unwitnessed는 누설(상위 5에 막아야 할 근거가 든 질문의 비율)."""
    out = {}
    for kind in ('known', 'setting', 'future', 'unwitnessed'):
        rows = [(q, top5(worlds, q, stage)) for q in questions if q['kind'] == kind]
        if kind in ('known', 'setting'):
            out[kind] = {f'recall@{K}': mean(recall_at_k(ids, set(q['gold']), K) for q, ids in rows),
                         f'mrr@{K}': mean(reciprocal_rank(ids, set(q['gold']), K) for q, ids in rows)}
        else:
            out[kind] = {'leak': mean(float(bool(set(ids) & set(q['banned']))) for q, ids in rows)}
    return out


@pytest.fixture(scope='module')
def measured(worlds, questions):
    # 2단계는 필터 없는 나레이션 쪽, 3단계는 인물 턴 쪽(운영이 쓰는 두 단계)이다.
    return {stage: measure(worlds, questions, stage) for stage in (2, 3)}


def test_snapshot_keeps_every_kind_of_question(questions):
    # 한 종류라도 빠진 스냅샷이면 평균이 다른 문항 수로 계산돼 임계값이 뜻을 잃는다.
    assert Counter(q['kind'] for q in questions) == {'known': 24, 'setting': 14, 'future': 13, 'unwitnessed': 11}


FLOORS = [(2, 'known', 'recall@5', 0.95), (2, 'known', 'mrr@5', 0.41), (2, 'setting', 'recall@5', 1.0), (2, 'setting', 'mrr@5', 0.52),
          (3, 'known', 'recall@5', 0.95), (3, 'known', 'mrr@5', 0.50), (3, 'setting', 'recall@5', 0.85), (3, 'setting', 'mrr@5', 0.65)]


@pytest.mark.parametrize('stage, kind, metric, floor', FLOORS, ids=[f'stage{s}-{k}-{m}' for s, k, m, _ in FLOORS])
def test_ranking_stays_above_the_frozen_floor(measured, stage, kind, metric, floor):
    assert measured[stage][kind][metric] >= floor


@pytest.mark.parametrize('kind, ceiling', [('future', 0.08), ('unwitnessed', 0.0)])
def test_stage_3_filter_keeps_leaks_under_the_frozen_ceiling(measured, kind, ceiling):
    assert measured[3][kind]['leak'] <= ceiling
    # 필터 없는 2단계는 이 샘플에서 거의 다 새므로(지표가 누설을 실제로 센다는 대조군) 낮은 누설은 필터가 만든 값이다.
    assert measured[2][kind]['leak'] >= 0.9


def test_snapshot_reproduces_the_recorded_ko_results(measured):
    # 문서 표(docs/evaluation/retrieval.md)의 값은 results/ko-retrieval.json이고, 이 테스트의 임계값은 그 값에서 나왔다. 둘이 어긋나면(한쪽만 다시 돌렸다면) 여기서 깨진다.
    recorded = json.loads(RESULTS.read_text(encoding='utf-8'))['configs']
    for stage in (2, 3):
        for kind, got in measured[stage].items():
            for metric, value in got.items():
                assert value == pytest.approx(recorded[f's{stage}'][kind][metric]), (stage, kind, metric)
