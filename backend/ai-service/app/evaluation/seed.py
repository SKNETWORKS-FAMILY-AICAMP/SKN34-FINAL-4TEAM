"""평가 세트(app/evaluation/datasets/*.jsonl)와 최적화 풀(datasets/optimize/*.jsonl)을 Langfuse Dataset으로 멱등 등록한다: python -m app.evaluation.seed

파일 이름이 Dataset 이름이고 한 줄이 항목 하나(id·input·expectedOutput·metadata)다. 최적화 풀(자동 개선 #823, 게이트 세트와 겹치지 않는 나머지 문항, metadata.split train·val)은
Dataset optimize.<게이트 세트 이름>이 된다(#868: 운영 화면에서 풀에 문항을 더하고 자동 개선이 Langfuse에서 풀을 읽는다). Dataset은 이름으로, 항목은 파일의 고정 id로 upsert하고
Langfuse에 같은 id·input·expectedOutput·metadata의 항목이 이미 있으면 건너뛰므로 몇 번 실행해도 같은 상태가 된다(올리지 않은 항목의 시각은 그대로다). 내용은 저작권이 만료된 작품(저장소 infrastructure/sample-data의 홍길동전·구운몽)과 시뮬레이션 세트(simulation.act·simulation.narrate: 원문 평가 공개 세트의 저작권 만료 고전·근대 소설과
CC BY-SA 3.0 SCP 이야기)만 쓰고 출처·라이선스는 항목 metadata.source에 있다.
"""

import json
import os
import sys
from pathlib import Path

from app import tracing

DATASETS = Path(__file__).parent / 'datasets'
POOLS = DATASETS / 'optimize'   # 최적화 풀: Dataset 이름은 optimize.<파일 이름 = 게이트 세트 이름>


def load() -> dict[str, list[dict]]:
    """Dataset 이름 → 항목. 평가 세트는 파일 이름 그대로, 최적화 풀은 optimize.<파일 이름>이다."""
    def rows(path):
        return [json.loads(line) for line in path.read_text(encoding='utf-8').splitlines()]
    return {**{path.stem: rows(path) for path in sorted(DATASETS.glob('*.jsonl'))}, **{f'optimize.{path.stem}': rows(path) for path in sorted(POOLS.glob('*.jsonl'))}}


def register(client) -> dict[str, tuple[int, int]]:
    """모든 평가 세트를 등록하고 세트별 (파일의 항목 수, 올린 항목 수)를 돌려준다.

    Langfuse에 같은 id·input·expectedOutput·metadata의 항목이 이미 있으면 올리지 않는다. 올리면 Langfuse가 문항 시각(createdAt·updatedAt)을 바꿀 수 있고, 평가는 세트의
    마지막 문항 시각 뒤에 시작한 기준 Run만 유효로 보므로(#868) 바뀌지 않은 문항을 다시 올리면 배포마다 production을 다시 평가하게 된다. 없거나 내용이 다른 항목만 upsert한다
    (내용이 바뀐 게이트 문항은 올려야 하고, 그러면 기준 Run이 무효가 되는 것이 맞다). 세트의 기존 항목은 한 번에 읽어 비교하고 파일에 없는 항목은 건드리지 않는다.
    """
    data = load()
    stats = {}
    for name, items in data.items():
        client.create_dataset(name=name)
        stored = {item.id: item for item in client.get_dataset(name).items}
        changed = [item for item in items if not _same(stored.get(item['id']), item)]
        for item in changed:
            client.create_dataset_item(dataset_name=name, id=item['id'], input=item['input'], expected_output=item.get('expectedOutput'),
                                       metadata=item['metadata'])
        stats[name] = (len(items), len(changed))
    return stats


def _same(stored, item: dict) -> bool:
    """Langfuse의 항목(없으면 None)이 파일의 항목과 같은 내용인가. 객체는 키 순서와 상관없이 값으로 견준다."""
    return stored is not None and (stored.input, stored.expected_output, stored.metadata) == (item['input'], item.get('expectedOutput'), item['metadata'])


def main() -> None:
    if not (os.environ.get('LANGFUSE_PUBLIC_KEY') and os.environ.get('LANGFUSE_SECRET_KEY')):
        sys.exit('LANGFUSE_PUBLIC_KEY와 LANGFUSE_SECRET_KEY가 필요합니다.')
    for name, (total, written) in register(tracing.client()).items():
        print(f'{name}: 항목 {total}개 중 {written}개 올림')


if __name__ == '__main__':
    main()
