"""수동 QA 홍길동전 입력 전용 대역. 실제 모델 호출이나 저장은 하지 않는다."""
import copy
import json
import sys
from pathlib import Path

root = Path(__file__).resolve().parents[3]
sys.path.insert(0, str(root / 'backend/ai-service'))
sys.meta_path[:] = [f for f in sys.meta_path if '__editable__' not in getattr(f, '__module__', '')]
from app.initial_world.models import ProposedOutput
from app.initial_world.errors import ExtractionFailure

fixture = json.loads((root / 'backend/ai-service/tests/fixtures/initial_world/honggildong.json').read_text(encoding='utf-8'))['valid']


def propose(data):
    mapping = {}
    for original in fixture['input']['entities']:
        matches = [e for e in data.entities if e.name == original['name'] and e.entityType == original['entityType']]
        if len(matches) != 1:
            raise ExtractionFailure('QA_FIXTURE_ENTITIES_REQUIRED', 422)
        mapping[original['cardId']] = str(matches[0].cardId)
    output = copy.deepcopy(fixture['output'])
    for candidate in output['candidates']:
        if candidate['subjectId']:
            candidate['subjectId'] = mapping[candidate['subjectId']]
        candidate['relatedEntityIds'] = [mapping[key] for key in candidate['relatedEntityIds']]
        if candidate['relation']:
            for key in ('sourceCardId', 'targetCardId'):
                candidate['relation'][key] = mapping[candidate['relation'][key]]
        evidence = []
        for item in candidate['evidence']:
            quote = item['quote']
            matches = [s for s in data.sources if quote in s.text]
            if len(matches) != 1 or matches[0].text.count(quote) != 1:
                raise ExtractionFailure('QA_FIXTURE_SOURCE_REQUIRED', 422)
            evidence.append({'sourceId': matches[0].sourceId, 'quote': quote})
        candidate['evidence'] = evidence
    return ProposedOutput.model_validate(output)
