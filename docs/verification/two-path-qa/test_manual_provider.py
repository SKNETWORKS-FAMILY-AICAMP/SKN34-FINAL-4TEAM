"""수동 QA 대역만 검증한다. 저장/모델 호출 없음."""
import pytest
from manual_provider import propose, fixture
from app.initial_world.models import Input
from app.initial_world.service import checked_output
from app.initial_world.errors import ExtractionFailure

def test_fixture_and_runtime_ids():
    data=Input.model_validate(fixture['input'])
    assert len(checked_output(data,propose(data)).candidates)==7
    updated=data.model_copy(deep=True)
    mapping={str(e.cardId): f'11111111-1111-4111-8111-{i:012d}' for i,e in enumerate(updated.entities,1)}
    # 생성된 사용자 카드 ID를 사용해야 하며 fixture 정본 ID를 반환하지 않는다.
    from uuid import UUID
    for e in updated.entities:e.cardId=UUID(mapping[str(e.cardId)])
    result=checked_output(updated,propose(updated))
    assert str(result.candidates[0].subjectId) in mapping.values()

def test_other_text_is_not_fabricated():
    data=Input.model_validate(fixture['input']).model_copy(deep=True)
    data.sources[0].text='이 문장은 QA 예시가 아니다.'
    with pytest.raises(ExtractionFailure):propose(data)

def test_ambiguous_name_is_not_merged():
    data=Input.model_validate(fixture['input']).model_copy(deep=True)
    data.entities.append(data.entities[0].model_copy(deep=True))
    with pytest.raises(ExtractionFailure):propose(data)
