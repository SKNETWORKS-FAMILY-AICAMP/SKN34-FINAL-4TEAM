"""추적 테스트 공용 도구: 회원 Bearer 토큰과 span 속성 읽기."""

import base64
import json

MEMBER = '5d1c4fbe-8b0a-4fd0-a8f4-0d6a2f9a1c77'


def bearer(sub=MEMBER) -> str:
    body = base64.urlsafe_b64encode(json.dumps({'sub': sub, 'iat': 1}).encode()).rstrip(b'=').decode()
    return f'Bearer header.{body}.signature'


def attrs(span) -> dict:
    """span 속성. 태그는 튜플로 나오므로 list로 바꾼다."""
    return {key: list(value) if isinstance(value, tuple) else value for key, value in span.attributes.items()}


def status_of(span):
    """루트 관측의 metadata status(DEC-55 v4: 상태는 끝나야 알 수 있어 루트에만, metadata로 남긴다)."""
    return span.attributes.get('langfuse.observation.metadata.status')
