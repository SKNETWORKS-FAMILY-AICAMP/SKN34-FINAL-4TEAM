import io
from unittest.mock import Mock
import boto3
from botocore.exceptions import ClientError
from botocore.stub import Stubber
import pytest
from PIL import Image
from app.images import service
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


@pytest.mark.parametrize("failed", [False, True])
def test_upload_uses_sdk_client_and_closes_it_on_success_or_failure(monkeypatch, failed):
    client = boto3.client("s3", region_name="us-east-1", aws_access_key_id="test", aws_secret_access_key="test")
    close = Mock(wraps=client.close)
    monkeypatch.setattr(client, "close", close)
    monkeypatch.setattr(service.boto3, "client", lambda *args, **kwargs: client)
    monkeypatch.setenv("ATTACHMENT_S3_BUCKET", "image-test")
    expected = dict(Bucket="image-test", Key="image-generations/job.png", Body=b"png", ContentType="image/png")
    with Stubber(client) as stub:
        if failed:
            stub.add_client_error("put_object", service_error_code="AccessDenied", expected_params=expected)
            with pytest.raises(ClientError):
                service.upload("job", b"png")
        else:
            stub.add_response("put_object", {}, expected)
            assert service.upload("job", b"png") == "image-generations/job.png"
        stub.assert_no_pending_responses()
    close.assert_called_once_with()
