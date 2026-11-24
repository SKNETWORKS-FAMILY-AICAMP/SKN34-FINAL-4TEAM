"""추출 평가 세트 실행기. 설계·규칙은 docs/evaluation/extraction-set.md.

    cd backend/ai-service
    uv run --locked --extra dev python eval/extraction/ex_cli.py gold --source public [--raw-dir 위키문헌 원문 폴더] [--workers 4] [--limit N]   # ocx gpt-6.2-sol 정답표(금액 0) → .data/sets/public.jsonl
    uv run --locked --extra dev python eval/extraction/ex_cli.py export                                                                      # → app/evaluation/datasets/extraction.extract.jsonl(공개 항목만)
    uv run --locked --extra dev python eval/extraction/ex_cli.py gold --source hp [--hp-dir <.data/hp>] [--per-book 2]                       # 로컬 전용 → .data/sets/hp.jsonl(커밋·Langfuse 금지)
    set -a; . <키 파일>; set +a                                                                                                               # 이하 OpenAI 호출(유료): 유료 명령마다 같은 명령 안에서 불러온다(키 값은 출력하지 않는다)
    uv run --locked --extra dev python eval/extraction/ex_cli.py score .data/sets/hp.jsonl [--instructions 파일] [--model M] [--tag T] [--limit N]   # 오프라인 채점 → results/extraction-<세트>-<태그>.json(집계만)

시작 때 Langfuse 키를 지워 원문이 Langfuse로 가지 않게 한다. gold는 호출을 ocx로 돌리고 실제 OpenAI 키를 쓰지 않는다. 원문·정답표·응답은 .data(git 무시)에만 두고 results에는 숫자와 항목 id만 둔다.
"""

import argparse
import json
import os
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from statistics import fmean

import ex_gold
import ex_sources
from app.evaluation import extraction
from app.evaluation.errors import EvaluationFailure
from app.manuscript_extraction import prompt
from app.manuscript_extraction.errors import PreprocessingFailure

HERE = Path(__file__).resolve().parent
DATA = HERE / '.data'
SETS, GOLD, RESULTS = DATA / 'sets', DATA / 'gold', HERE / 'results'
DATASET = HERE.parents[1] / 'app' / 'evaluation' / 'datasets' / 'extraction.extract.jsonl'
SIMULATION_DATA = HERE.parent / 'simulation' / '.data'


def no_langfuse() -> None:
    for key in ('LANGFUSE_PUBLIC_KEY', 'LANGFUSE_SECRET_KEY'):
        os.environ.pop(key, None)


def write_items(path: Path, items: list[dict]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(''.join(json.dumps(item, ensure_ascii=False) + '\n' for item in items), encoding='utf-8')


def read_items(path: Path) -> list[dict]:
    return [json.loads(line) for line in path.read_text(encoding='utf-8').splitlines() if line.strip()]


def cmd_gold(args) -> int:
    """회차 원천 → 정답표 → .data/sets/<source>.jsonl. 호출은 ocx(금액 0)다. 실패한 회차가 있으면 코드를 보이고 1로 끝낸다(된 항목은 쓰고, 같은 명령을 다시 치면 캐시로 이어 간다)."""
    ex_gold.use_ocx()
    episodes = ex_sources.public_episodes(args.raw_dir) if args.source == 'public' else ex_sources.hp_episodes(args.hp_dir, args.per_book)
    items, failures = ex_gold.build(episodes[:args.limit], GOLD / args.source, args.workers)
    write_items(SETS / f'{args.source}.jsonl', items)
    for item in items:
        agreement = item['metadata']['gold']['agreement']
        print(f"{item['id']}: " + ' · '.join(f"{extraction.KINDS[kind]} {'-' if value is None else format(value, '.2f')}" for kind, value in agreement.items()) + ' (일치도)')
    for episode, label, code in failures:
        print(f'실패 {episode} {label}: {code}')
    print(f'항목 {len(items)}개 → {SETS / (args.source + ".jsonl")}')
    return 1 if failures else 0


def cmd_export(args) -> int:
    """공개 세트(.data/sets/public.jsonl)를 저장소 세트 파일로 내보낸다. 저작권 만료 공개 항목이 아니면 아무것도 쓰지 않고 멈춘다(해리 포터가 저장소·Langfuse로 가지 않게)."""
    items = read_items(SETS / 'public.jsonl')
    bad = [item['id'] for item in items if not (item['id'].startswith('extraction.extract-') and item['metadata']['license'].startswith('저작권 만료'))]
    if bad:
        raise SystemExit(f'저작권 만료 공개 항목만 내보낼 수 있다: {", ".join(bad)}')
    write_items(DATASET, items)
    print(f'항목 {len(items)}개 → {DATASET}')
    return 0


def score_items(items: list[dict], instructions: str, model: str, workers: int) -> dict:
    """항목마다 운영 호출(extraction.generate)로 뽑아 정답표와 코드(extraction.score)로 채점한다. 집계는 숫자와 항목 id뿐이다. 실패한 항목은 0점이 아니라 failed(id → 고정 코드)로 두고 평균에 섞지 않는다."""
    def one(item):
        try:
            output = extraction.generate(instructions, item['input'], model)
            return item['id'], extraction.score(item['input']['body'], output, item['expectedOutput']), None
        except (PreprocessingFailure, EvaluationFailure) as error:
            return item['id'], None, str(error)

    with ThreadPoolExecutor(workers) as pool:
        done = list(pool.map(one, items))
    rows = [{'id': id, 'recall': got['recall'], 'quote_ok': got['quote_ok'], 'recalls': got['recalls'], 'reference': got['reference']} for id, got, _ in done if got]
    mean = lambda values: fmean(v for v in values if v is not None) if any(v is not None for v in values) else None  # noqa: E731
    return {'items': len(items), 'failed': {id: code for id, _, code in done if code}, 'recall': mean([r['recall'] for r in rows]), 'quote_ok': mean([r['quote_ok'] for r in rows]),
            'recalls': {kind: mean([r['recalls'][kind] for r in rows]) for kind in extraction.KINDS},
            'reference': {'precision': {kind: mean([r['reference']['precision'][kind] for r in rows]) for kind in extraction.KINDS},
                          **{name: mean([r['reference'][name] for r in rows]) for name in ('kind_match', 'direction', 'label')}}, 'rows': rows}


def cmd_score(args) -> int:
    """오프라인 채점: 운영 지시문(코드 시드 또는 --instructions 파일)을 운영 모델(OPENAI_MODEL 또는 --model)로 돌려 채점한다. 유료 OpenAI 호출이다."""
    model = args.model or os.environ.get('OPENAI_MODEL')
    if not os.environ.get('OPENAI_API_KEY') or not model:
        raise SystemExit('OPENAI_API_KEY와 모델(OPENAI_MODEL 또는 --model)이 필요하다. 키 파일을 같은 명령 안에서 불러온 뒤 실행한다(값은 출력하지 않는다).')
    items = read_items(args.items)[:args.limit]
    instructions = args.instructions.read_text(encoding='utf-8') if args.instructions else prompt.EXTRACT
    result = {'set': args.items.stem, 'model': model, 'instructions': args.instructions.name if args.instructions else '코드 시드', **score_items(items, instructions, model, args.workers)}
    path = RESULTS / f'extraction-{args.items.stem}-{args.tag}.json'
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(result, ensure_ascii=False, indent=1) + '\n', encoding='utf-8')
    for row in result['rows']:
        print(f"{row['id']}: recall {row['recall']:.2f} quote_ok {row['quote_ok']:.2f}")
    for id, code in result['failed'].items():
        print(f'실패 {id}: {code}')
    print(f"recall {result['recall']} quote_ok {result['quote_ok']} (항목 {result['items']}개, 실패 {len(result['failed'])}개) → {path}")
    return 1 if result['failed'] else 0


def main(argv=None) -> int:
    no_langfuse()
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    commands = parser.add_subparsers(dest='command', required=True)
    gold = commands.add_parser('gold', help='정답표 만들기(ocx gpt-6.2-sol)')
    gold.add_argument('--source', choices=('public', 'hp'), required=True)
    gold.add_argument('--raw-dir', type=Path, default=SIMULATION_DATA / 'orig' / 'raw' / 'wikisource')
    gold.add_argument('--hp-dir', type=Path, default=SIMULATION_DATA / 'hp')
    gold.add_argument('--per-book', type=int, default=2)
    gold.add_argument('--limit', type=int)
    gold.add_argument('--workers', type=int, default=4)
    gold.set_defaults(run=cmd_gold)
    commands.add_parser('export', help='공개 세트를 저장소 세트 파일로').set_defaults(run=cmd_export)
    score = commands.add_parser('score', help='오프라인 채점(유료 OpenAI 호출)')
    score.add_argument('items', type=Path)
    score.add_argument('--instructions', type=Path)
    score.add_argument('--model')
    score.add_argument('--tag', default='base')
    score.add_argument('--limit', type=int)
    score.add_argument('--workers', type=int, default=4)
    score.set_defaults(run=cmd_score)
    args = parser.parse_args(argv)
    return args.run(args)


if __name__ == '__main__':
    raise SystemExit(main())
