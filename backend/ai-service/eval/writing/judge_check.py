"""채점기 점검: 채점 모델(OPENAI_MODEL, 생성과 같은 gpt-6-luna)이 한국어 사람 채점과 얼마나 맞는지 KUDGE로 잰다(결과는 집계만).

    cd backend/ai-service
    EVAL_DATA=<...>/.data/v2 uv run --locked --extra dev python eval/writing/judge_check.py --n 150

KUDGE(HAERAE-HUB/KUDGE, arXiv 2409.11239)는 `.data/v2/web/kudge/`에 사용자가 내려받아 둔다(라이선스 표기가 없어 자동으로 받지 않는다).
pointwise는 judge_query를 그대로 보내 [[1~5]] 점수를 받고 사람 점수와의 정확 일치·±1 일치·κ를, pairwise는 [[A]]/[[B]] 선택과 사람 선호의 일치율을 낸다.
같은 κ 함수를 심의 등급·채점기의 사람 라벨 일치에도 쓴다.
"""

import argparse
import csv
import json
import os
import random
import re
import sys
from collections import Counter
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import common  # noqa: E402

KUDGE = common.DATA / 'web' / 'kudge'
RESULT = common.HERE / 'results' / 'judge-kudge.json'


def kappa(a: list, b: list) -> float | None:
    """Cohen's κ. 표본이 없으면 None, 우연 일치가 1(한 범주뿐)이면 일치 여부로 1 또는 0."""
    n = len(a)
    if not n:
        return None
    observed = sum(x == y for x, y in zip(a, b)) / n
    ca, cb = Counter(a), Counter(b)
    expected = sum(ca[k] * cb[k] for k in ca) / (n * n)
    if expected == 1:
        return 1.0 if observed == 1 else 0.0
    return round((observed - expected) / (1 - expected), 4)


def parse_score(text: str) -> int | None:
    found = re.findall(r'\[\[\s*([1-5])\s*\]\]', text)
    return int(found[-1]) if found else None


def parse_choice(text: str) -> str | None:
    found = re.findall(r'\[\[\s*([AB])\s*\]\]', text)
    return found[-1] if found else None


def pointwise(rows: list[dict]) -> dict:
    return {'exact': common.rate(sum(r['human'] == r['judge'] for r in rows), len(rows)),
            'within_one': common.rate(sum(abs(r['human'] - r['judge']) <= 1 for r in rows), len(rows)),
            'kappa': kappa([r['human'] for r in rows], [r['judge'] for r in rows])}


def pairwise(rows: list[dict]) -> dict:
    decided = [r for r in rows if r['human'] in ('A', 'B')]
    return {'accuracy': common.rate(sum(r['human'] == r['judge'] for r in decided), len(decided))}


def _ask_text(query: str) -> str:
    from openai import OpenAI
    with OpenAI(timeout=180, max_retries=0) as client:
        response = client.responses.create(model=os.environ['OPENAI_MODEL'], store=False, max_output_tokens=1500, input=query)
    return response.output_text or ''


def _load(name: str, human_cols: tuple[str, ...]) -> list[dict]:
    # shortcut: 사람 점수 열 이름을 후보 중 처음 있는 것으로 읽는다, 받은 파일의 열을 확인하면 하나로 고정한다
    with (KUDGE / name).open(encoding='utf-8') as file:
        rows = list(csv.DictReader(file))
    col = next((c for c in human_cols if rows and c in rows[0]), None)
    if col is None:
        raise SystemExit(f'{name}: 사람 점수 열을 찾지 못했다(열: {list(rows[0]) if rows else []})')
    return [{'query': r['judge_query'], 'human': r[col]} for r in rows if r.get('judge_query')]


def main(argv=None) -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument('--n', type=int, default=150, help='세트마다 무작위로 뽑는 문항 수(pointwise·pairwise 각각)')
    args = parser.parse_args(argv)
    common.load_env()
    ledger = common.Ledger(common.DATA / 'cost.jsonl')
    rnd = random.Random(20261125)
    point = rnd.sample(_load('kudge-pointwise.csv', ('human_score', 'score', 'label')), args.n)
    pair = rnd.sample(_load('kudge-pairwise.csv', ('human_preference', 'winner', 'label')), args.n)
    out_point, out_pair, failed = [], [], 0
    with common.metered(ledger):
        ledger.tag = 'judge:kudge'
        for r in point:
            s = parse_score(_ask_text(r['query']))
            if s is None or not str(r['human']).strip().isdigit():
                failed += 1
                continue
            out_point.append({'human': int(r['human']), 'judge': s})
        for r in pair:
            c = parse_choice(_ask_text(r['query']))
            if c is None:
                failed += 1
                continue
            out_pair.append({'human': str(r['human']).strip().upper().replace('TIE', 'tie'), 'judge': c})
    result = {'model': os.environ['OPENAI_MODEL'], 'pointwise': pointwise(out_point), 'pairwise': pairwise(out_pair),
              'unparsed': failed, 'sampled': {'pointwise': len(point), 'pairwise': len(pair)}}
    RESULT.write_text(json.dumps(result, ensure_ascii=False, indent=1), encoding='utf-8')
    print(json.dumps(result, ensure_ascii=False, indent=1), f'\n장부 누적 {ledger.spent():.4f}달러')
    return 0


if __name__ == '__main__':
    sys.exit(main())
