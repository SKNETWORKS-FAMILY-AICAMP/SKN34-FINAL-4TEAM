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
    if provenance == 'author_revision':
        DecisionRequest.model_validate(value['decisionRequest'])
    else:
        with pytest.raises(ValueError, match='AUTHOR_PROVENANCE'):
            DecisionRequest.model_validate(value['decisionRequest'])
        value['decisionRequest'].update(action='approve', editedCandidate=None)
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


def test_application_cannot_substitute_candidate_identity():
    from initial_world_contract import Contract
    value = json.loads((ROOT / 'honggildong.json').read_text(encoding='utf-8'))['valid']
    forged_id = '00000000-0000-4000-8000-000000000999'
    # 검토와 반영 요청을 함께 바꿔도 분석이 발급한 후보 UUID와 일치해야 한다.
    value['decisions'][0]['candidateId'] = forged_id
    value['applicationRequest']['candidates'][0]['candidateId'] = forged_id
    with pytest.raises(ValueError, match='CANDIDATE_BINDING'):
        Contract.model_validate(value)


def history_fixture():
    value = json.loads((ROOT / 'honggildong.json').read_text(encoding='utf-8'))['valid']
    first = value['decisions'][0]
    edited = copy.deepcopy(first)
    edited.update(sequence=2, state='pending')
    edited['content'].update(provenance='author_revision', evidence=[], text='작가 수정')
    approved = copy.deepcopy(edited)
    approved.update(sequence=3, state='approved')
    # 조회 정렬 순서에 의존하지 않고 최대 순번을 선택한다.
    value['decisions'] = [approved, *value['decisions'], edited]
    value['analysisResponse']['decisions'] = copy.deepcopy(value['decisions'])
    value['applicationRequest']['candidates'][0]['decisionSequence'] = 3
    return value


def test_same_candidate_can_have_multiple_review_records():
    from initial_world_contract import Contract
    Contract.model_validate(history_fixture())


@pytest.mark.parametrize('failure', ['duplicate', 'old_approval', 'latest_held', 'response_binding'])
def test_review_history_rejects_invalid_selection(failure):
    from initial_world_contract import Contract
    value = history_fixture()
    if failure == 'duplicate':
        value['decisions'].append(copy.deepcopy(value['decisions'][0]))
    elif failure == 'old_approval':
        value['applicationRequest']['candidates'][0]['decisionSequence'] = 1
    elif failure == 'latest_held':
        value['decisions'][0]['state'] = 'held'
    else:
        value['analysisResponse']['decisions'][0]['content']['localRef'] = 'forged'
    error = {'duplicate': 'DUPLICATE', 'old_approval': 'NOT_APPROVED',
             'latest_held': 'NOT_APPROVED', 'response_binding': 'CANDIDATE_BINDING'}[failure]
    with pytest.raises(ValueError, match=error):
        Contract.model_validate(value)


def test_rule_card_is_a_valid_source_without_being_an_entity():
    from initial_world_contract import Input
    data = json.loads((ROOT / 'honggildong.json').read_text(encoding='utf-8'))['valid']['input']
    data['sources'][0]['ownerId'] = '00000000-0000-4000-8000-000000000999'
    data['sources'][0]['sourceId'] = f"card:{data['sources'][0]['ownerId']}:body"
    Input.model_validate(data)  # 실제 저장 카드의 소속·원문 비교는 Content에서 별도로 수행한다.


@pytest.mark.parametrize('field,value', [
    ('ownerId', '00000000-0000-4000-8000-000000000999'),
    ('field', 'title'), ('sourceId', 'world:00000000-0000-4000-8000-000000000002:body'),
])
def test_source_identity_rejected_even_with_recomputed_input_hash(field, value):
    from initial_world_contract import Contract, Input, input_hash
    data = json.loads((ROOT / 'honggildong.json').read_text(encoding='utf-8'))['valid']
    data['input']['sources'][0][field] = value
    with pytest.raises(ValueError, match='SOURCE_IDENTITY'):
        parsed = Input.model_validate(data['input'])
        data['input']['basis']['inputHash'] = input_hash(parsed)
        data['analysisResponse']['basis'] = copy.deepcopy(data['input']['basis'])
        Contract.model_validate(data)


def test_world_description_source_cannot_claim_another_world():
    from initial_world_contract import Input
    data = json.loads((ROOT / 'honggildong.json').read_text(encoding='utf-8'))['valid']['input']
    source = data['sources'][0]
    source['field'] = 'description'
    source['sourceId'] = f"world:{source['ownerId']}:description"
    with pytest.raises(ValueError, match='SOURCE_IDENTITY'):
        Input.model_validate(data)
