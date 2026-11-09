"""초기 세계관 계약만 검증한다. 모델·HTTP·DB를 실행하지 않는다."""
import copy
import json
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[3] / 'docs/design/initial-world-preprocessing'


def test_contract_artifacts_exist():
    assert (ROOT / 'contract.schema.json').is_file()
    assert (ROOT / 'honggildong.json').is_file()


def test_schema_matches_executable_contract():
    from initial_world_contract import Contract
    assert json.loads((ROOT / 'contract.schema.json').read_text(encoding='utf-8')) == Contract.model_json_schema()


def test_honggildong_valid():
    from initial_world_contract import Contract
    fixture = json.loads((ROOT / 'honggildong.json').read_text(encoding='utf-8'))
    Contract.model_validate(fixture['valid'])


@pytest.mark.parametrize('case', json.loads((ROOT / 'honggildong.json').read_text(encoding='utf-8'))['invalid'], ids=lambda c: c['name'])
def test_honggildong_invalid(case):
    from initial_world_contract import Contract
    value = copy.deepcopy(json.loads((ROOT / 'honggildong.json').read_text(encoding='utf-8'))['valid'])
    for change in case['changes']:
        target = value
        for key in change['path'][:-1]:
            target = target[key]
        target[change['path'][-1]] = change['value']
    with pytest.raises(ValueError, match=case['error']):
        Contract.model_validate(value)


def test_utf16_boundaries_and_no_normalization():
    from initial_world_contract import quote_utf16
    assert quote_utf16('홍😀\r\n길동', 1, 3) == '😀'
    assert quote_utf16('홍😀\r\n길동', 3, 5) == '\r\n'
    for start, end in [(1, 2), (2, 3), (-1, 1), (0, 99), (2, 2)]:
        with pytest.raises(ValueError):
            quote_utf16('홍😀\r\n길동', start, end)


@pytest.mark.parametrize('status', ['running', 'failed', 'unknown'])
def test_noncompleted_analysis_has_no_candidates(status):
    from initial_world_contract import AnalysisResponse
    value = json.loads((ROOT / 'honggildong.json').read_text(encoding='utf-8'))['valid']['analysisResponse']
    value['executionStatus'] = status
    with pytest.raises(ValueError, match='OUTPUT_STATE'):
        AnalysisResponse.model_validate(value)
    value['output'] = None
    value['candidateIds'] = {}
    value['decisions'] = []
    AnalysisResponse.model_validate(value)


@pytest.mark.parametrize('provenance', ['author_revision', 'author_addition'])
def test_author_content_keeps_original_evidence_separate(provenance):
    from initial_world_contract import Contract, DecisionRequest
    value = json.loads((ROOT / 'honggildong.json').read_text(encoding='utf-8'))['valid']
    edited = value['decisions'][0]['content']
    edited.update(provenance=provenance, evidence=[], text='작가가 새로 정한 설정')
    value['decisionRequest'].update(action='edit', editedCandidate=edited)
    DecisionRequest.model_validate(value['decisionRequest'])
    # 반영 검증은 별도의 후속 승인 기록을 대상으로 한다.
    Contract.model_validate(value)
    assert value['output']['candidates'][0]['evidence']


def test_edit_requires_separate_approval():
    from initial_world_contract import DecisionRequest
    value = json.loads((ROOT / 'honggildong.json').read_text(encoding='utf-8'))['valid']
    request = value['decisionRequest']
    request['editedCandidate'] = value['decisions'][0]['content']
    with pytest.raises(ValueError, match='EDIT_REQUIRED'):
        DecisionRequest.model_validate(request)
    request['action'] = 'edit'
    with pytest.raises(ValueError, match='AUTHOR_PROVENANCE'):
        DecisionRequest.model_validate(request)
