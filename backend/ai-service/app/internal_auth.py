"""Content·Core가 호출하는 내부 API의 공용 토큰 검증."""

import os
import secrets

from fastapi import HTTPException


def require_internal_token(x_internal_token: str) -> None:
    token = os.environ.get('INTERNAL_TOKEN', '')
    if not token or not secrets.compare_digest(token, x_internal_token):
        raise HTTPException(403, '내부 인증이 필요합니다.')
