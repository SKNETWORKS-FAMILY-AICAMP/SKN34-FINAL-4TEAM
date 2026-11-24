import pytest
from pydantic import ValidationError
from app.images.models import ImageInput
from app.images.prompt import build_prompt


@pytest.mark.parametrize('purpose,composition', [
    ('work_cover', '작품의 핵심 인물'),
    ('world_cover', '전경·중경·배경'),
])
def test_cover_template_separates_fixed_settings_from_scene(purpose, composition):
    data = ImageInput(purpose=purpose, prompt='새벽 항구에서 출항한다.',
                      visualSettings='남청색 하늘과 황동 천문탑.', templateVersion='cover-v2')
    prompt = build_prompt(data)
    assert '[승인된 시각 설정]' in prompt and data.visualSettings in prompt
    assert '[이번 장면]' in prompt and data.prompt in prompt
    assert prompt.index(data.visualSettings) < prompt.index('[이번 장면]')
    assert composition in prompt and '3:4' in prompt and '20%' in prompt
    assert '워터마크' in prompt and '제목' in prompt


@pytest.mark.parametrize('purpose', ['work_cover', 'world_cover', 'character_profile', 'illustration'])
def test_existing_v1_jobs_keep_their_original_prompt(purpose):
    assert build_prompt(ImageInput(purpose=purpose, prompt='원래 입력')) == '원래 입력'


def test_scene_change_does_not_change_fixed_settings_block():
    first = ImageInput(purpose='world_cover', prompt='새벽', visualSettings='황동 탑', templateVersion='cover-v2')
    second = first.model_copy(update={'prompt': '한밤중'})
    assert build_prompt(first).split('[이번 장면]')[0] == build_prompt(second).split('[이번 장면]')[0]


def test_cover_template_is_not_accepted_for_other_purposes():
    with pytest.raises(ValidationError):
        ImageInput(purpose='illustration', prompt='장면', templateVersion='cover-v2')


def test_fixed_settings_have_a_boundary_and_cannot_be_silently_ignored():
    with pytest.raises(ValidationError):
        ImageInput(purpose='work_cover', prompt='장면', visualSettings='x' * 6001, templateVersion='cover-v2')
    with pytest.raises(ValidationError):
        ImageInput(purpose='work_cover', prompt='장면', visualSettings='새 설정', templateVersion='v1')
