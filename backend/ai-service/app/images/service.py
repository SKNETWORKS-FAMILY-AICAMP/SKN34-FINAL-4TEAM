"""생성 이미지의 실제 규격을 검사하고 비공개 객체로 보관한다."""
import io
import os
from contextlib import closing
import boto3
from botocore.config import Config
from PIL import Image
from app.images.models import ImageInput

MAX_REFERENCE_BYTES = 5 * 1024 * 1024

def reference_file(raw: bytes) -> tuple[str, bytes, str]:
    """참조를 실제 디코딩한 후 제공사 multipart 파일을 만든다."""
    if not raw or len(raw) > MAX_REFERENCE_BYTES:
        raise ValueError("IMAGE_REFERENCE_SIZE")
    formats = {"PNG": ("png", "image/png"), "JPEG": ("jpg", "image/jpeg"), "WEBP": ("webp", "image/webp")}
    with Image.open(io.BytesIO(raw)) as image:
        if (image.format not in formats or max(image.size) > 4096
                or image.width * image.height > 16_000_000 or getattr(image, "n_frames", 1) != 1):
            raise ValueError("IMAGE_REFERENCE_FORMAT")
        extension, media_type = formats[image.format]
        image.load()
    return f"reference.{extension}", raw, media_type

def validate_image(raw: bytes, data: ImageInput) -> None:
    """표지의 기존 5MiB 상한을 모든 생성 결과에 적용한다."""
    if not raw or len(raw) > 5 * 1024 * 1024:
        raise ValueError("IMAGE_SIZE_LIMIT")
    with Image.open(io.BytesIO(raw)) as image:
        if image.format != "PNG" or image.size != tuple(map(int, data.size.split("x"))):
            raise ValueError("IMAGE_FORMAT_INVALID")
        image.verify()
    with Image.open(io.BytesIO(raw)) as image:
        image.load()

def upload(job_id: str, raw: bytes) -> str:
    """jobId로 고정된 키에 업로드한다. 버킷 준비는 기존 Content가 담당한다."""
    key = f"image-generations/{job_id}.png"
    with closing(boto3.client("s3", endpoint_url=os.getenv("ATTACHMENT_S3_ENDPOINT") or None,
        region_name=os.getenv("ATTACHMENT_S3_REGION", "us-east-1"),
        config=Config(connect_timeout=5, read_timeout=30, retries={"total_max_attempts": 1}, s3={"addressing_style": "path"}))) as s3:
        s3.put_object(Bucket=os.environ["ATTACHMENT_S3_BUCKET"], Key=key, Body=raw, ContentType="image/png")
    return key
