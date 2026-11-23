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


def named(spans, name: str) -> list:
    """이름이 name인 끝난 span을 시작 순서대로."""
    return sorted((s for s in spans() if s.name == name), key=lambda s: s.start_time)


def shown(span, field: str):
    """span의 input·output(Langfuse가 JSON 문자열로 남긴 값)."""
    return json.loads(attrs(span)[f'langfuse.observation.{field}'])


def status_of(span):
    """루트 관측의 metadata status(DEC-55 v4: 상태는 끝나야 알 수 있어 루트에만, metadata로 남긴다)."""
    return span.attributes.get('langfuse.observation.metadata.status')
