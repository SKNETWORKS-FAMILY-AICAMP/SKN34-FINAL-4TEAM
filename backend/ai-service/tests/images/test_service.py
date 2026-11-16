import io
import pytest
from PIL import Image
from app.images.models import ImageInput
from app.images.service import validate_image

@pytest.mark.parametrize("purpose,size", [("character_profile", (1024,1024)), ("world_cover", (1152,1536)), ("work_cover", (1152,1536)), ("illustration", (1536,1024))])
def test_exact_size(purpose, size):
    data = ImageInput(purpose=purpose, prompt="scene")
    assert data.size == f"{size[0]}x{size[1]}"
    stream = io.BytesIO()
    Image.new("RGB", size).save(stream, format="PNG")
    validate_image(stream.getvalue(), data)

def test_wrong_dimensions_rejected():
    stream = io.BytesIO()
    Image.new("RGB", (64,64)).save(stream, format="PNG")
    with pytest.raises(ValueError):
        validate_image(stream.getvalue(), ImageInput(purpose="work_cover", prompt="scene"))
