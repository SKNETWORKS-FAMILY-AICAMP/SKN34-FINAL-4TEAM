"""집필 AI 기준선 평가 실행기(모드 G·R·S). 대상 모듈은 cases()·generate(case, mode)·score(case, capture)·summary(cases, scored)를 두고,
채점 모델이 필요하면 judge(case, capture)를 둔다.

    cd backend/ai-service
    uv run --locked --extra dev --extra eval python eval/writing/run.py guard --mode G --reps 3
    uv run --locked --extra dev python eval/writing/run.py guard --mode R          # 저장한 캡처만 다시 채점(생성·채점 모델 호출 0)

- G(고정 근거로 새 답변): 대상의 실제 서비스 함수를 부르고 캡처 `.data/runs/<대상>-G.jsonl`에 남긴다. 끝낸 (사례, 반복)은 건너뛰어 이어 받는다.
- S(고정 원문으로 검색만): 검색 단계만 부른다(답변 생성 0회). 검색이 없는 대상은 모듈이 S를 거절한다.
- R(저장 응답 재평가): 캡처의 응답과 저장된 채점 결과로 지표만 다시 계산한다. `--rejudge`면 의미 채점만 다시 받는다(채점 비용).
모든 OpenAI 호출은 common.metered가 장부 `.data/cost.jsonl`에 남기고 상한(기본 10달러)에서 호출 전에 멈춘다. 실패·미측정은 0점이 아니라 measured로 따로 센다.
결과 `results/<대상>-<모드>.json`에는 집계와 사례 id만 있다(원문·문항·응답 본문 없음).
"""

import argparse
import importlib
import os
import json
import sys
import time
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
sys.path.insert(0, os.environ.get('EVAL_APP_ROOT', str(HERE.parents[1])))   # app 패키지: 기본은 이 워크트리, v2는 develop+#826 실행 트리

import common  # noqa: E402
from common import rate  # noqa: E402,F401  대상 모듈이 run.rate로도 쓴다

RESULTS = HERE / 'results' / ('v2' if os.environ.get('EVAL_DATA') else '')   # v2 차수는 기준선 결과를 덮지 않는다


def capture_path(target: str, mode: str) -> Path:
    return common.DATA / 'runs' / f'{target}-{"G" if mode == "R" else mode}.jsonl'


def _append(path: Path, row: dict) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open('a', encoding='utf-8') as file:
        file.write(json.dumps(row, ensure_ascii=False) + '\n')


def _judge(module, case: dict, capture: dict) -> None:
    try:
        capture['judge'] = module.judge(case, capture)
        capture.pop('judge_error', None)
    except common.BudgetExceeded:
        raise
    except Exception as error:  # 채점 실패는 점수를 꾸미지 않고 남긴다
        capture['judge'], capture['judge_error'] = None, f'{type(error).__name__}: {str(error)[:200]}'


def generate(module, target: str, mode: str, cases: dict, reps: int, ledger: common.Ledger) -> None:
    path = capture_path(target, mode)
    done = {(r['id'], r['rep']) for r in common.jsonl(path) if r['error'] is None} if path.exists() else set()   # 실패한 사례는 다시 시도한다
    if hasattr(module, 'prepare'):
        module.prepare(mode)
    with common.metered(ledger):
        for cid, case in cases.items():
            for rep in range(reps):
                if (cid, rep) in done:
                    continue
                ledger.tag, before, started = f'{target}:{mode}:{cid}', ledger.spent(), time.time()
                try:
                    output, error = module.generate(case, mode), None
                except common.BudgetExceeded:
                    raise
                except Exception as exc:  # 대상 실패는 미측정으로 남긴다(본문은 넣지 않는다)
                    output, error = None, f'{type(exc).__name__}: {str(exc)[:200]}'
                capture = {'id': cid, 'rep': rep, 'mode': mode, 'output': output, 'error': error, 'ms': round((time.time() - started) * 1000)}
                capture['usd_generate'] = round(ledger.spent() - before, 6)
                if output is not None and hasattr(module, 'judge'):
                    mark = ledger.spent()
                    _judge(module, case, capture)
                    capture['usd_judge'] = round(ledger.spent() - mark, 6)
                _append(path, capture)
                print(f'{cid} rep{rep} {"ok" if error is None else "fail"} {capture["ms"]}ms', flush=True)


def main(argv=None) -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument('target')
    parser.add_argument('--mode', choices=['G', 'R', 'S'], default='G')
    parser.add_argument('--reps', type=int, default=1)
    parser.add_argument('--rejudge', action='store_true', help='R 모드에서 의미 채점을 다시 받는다(채점 비용 발생)')
    parser.add_argument('--limit-usd', type=float, default=common.LIMIT_USD)
    parser.add_argument('--ids', default='', help='쉼표로 나눈 사례 id만 돌린다(스모크)')
    args = parser.parse_args(argv)
    common.load_env()
    module = importlib.import_module(args.target)
    cases = {c['id']: c for c in module.cases() if not args.ids or c['id'] in args.ids.split(',')}
    ledger = common.Ledger(common.DATA / 'cost.jsonl', args.limit_usd)
    print(f'장부 누적 {ledger.spent():.4f}달러 / 상한 {ledger.limit}달러', flush=True)
    if args.mode != 'R':
        generate(module, args.target, args.mode, cases, args.reps, ledger)
    path = capture_path(args.target, args.mode)
    latest = {(r['id'], r['rep']): r for r in common.jsonl(path) if r['id'] in cases and r['mode'] == ('G' if args.mode == 'R' else args.mode)}
    rows = list(latest.values())   # (사례, 반복)마다 마지막 캡처
    if args.mode == 'R' and args.rejudge and hasattr(module, 'judge'):
        with common.metered(ledger):
            for r in rows:
                if r['output'] is not None:
                    _judge(module, cases[r['id']], r)
    scored = [(r['id'], r['rep'], r, module.score(cases[r['id']], r)) for r in rows]
    result = {'target': args.target, 'mode': args.mode, 'source': path.name, 'cases': len(cases), 'captures': len(rows),
              'usd': {'generate': round(sum(r.get('usd_generate', 0) for r in rows), 4), 'judge': round(sum(r.get('usd_judge', 0) for r in rows), 4)},
              'ms_p50': sorted(r['ms'] for r in rows)[len(rows) // 2] if rows else None,
              'summary': module.summary(cases, scored),
              'failed_cases': sorted({cid for cid, _, _, s in scored if not s.get('measured') or s.get('correct') == 0 or s.get('pass') == 0})}
    RESULTS.mkdir(parents=True, exist_ok=True)
    (RESULTS / f'{args.target}-{args.mode}.json').write_text(json.dumps(result, ensure_ascii=False, indent=1), encoding='utf-8')
    print(json.dumps(result['summary'], ensure_ascii=False, indent=1))
    print(f'장부 누적 {ledger.spent():.4f}달러', flush=True)
    return 0


if __name__ == '__main__':
    sys.exit(main())
