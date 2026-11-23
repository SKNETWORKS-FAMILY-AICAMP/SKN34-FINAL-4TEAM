"""평가 세트(app/evaluation/datasets/*.jsonl)를 Langfuse Dataset으로 멱등 등록한다: python -m app.evaluation.seed

파일 이름이 Dataset 이름이고 한 줄이 항목 하나(id·input·expectedOutput·metadata)다. Dataset은 이름으로, 항목은 파일의 고정 id로 upsert하므로
몇 번 실행해도 같은 상태가 된다. 내용은 저작권이 만료된 작품(저장소 infrastructure/sample-data의 홍길동전·구운몽)과 시뮬레이션 세트(simulation.act·simulation.narrate: 원문 평가 공개 세트의 저작권 만료 고전·근대 소설과
CC BY-SA 3.0 SCP 이야기)만 쓰고 출처·라이선스는 항목 metadata.source에 있다.
"""

import json
import os
import sys
from pathlib import Path

from app import tracing

DATASETS = Path(__file__).parent / 'datasets'


def load() -> dict[str, list[dict]]:
    return {path.stem: [json.loads(line) for line in path.read_text(encoding='utf-8').splitlines()] for path in sorted(DATASETS.glob('*.jsonl'))}


def register(client) -> dict[str, int]:
    """모든 평가 세트를 등록하고 세트별 항목 수를 돌려준다."""
    data = load()
    for name, items in data.items():
        client.create_dataset(name=name)
        for item in items:
            client.create_dataset_item(dataset_name=name, id=item['id'], input=item['input'], expected_output=item.get('expectedOutput'),
                                       metadata=item['metadata'])
    return {name: len(items) for name, items in data.items()}


def main() -> None:
    if not (os.environ.get('LANGFUSE_PUBLIC_KEY') and os.environ.get('LANGFUSE_SECRET_KEY')):
        sys.exit('LANGFUSE_PUBLIC_KEY와 LANGFUSE_SECRET_KEY가 필요합니다.')
    for name, count in register(tracing.client()).items():
        print(f'{name}: 항목 {count}개 등록')


if __name__ == '__main__':
    main()
