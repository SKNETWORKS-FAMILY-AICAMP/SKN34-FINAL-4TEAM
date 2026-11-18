"""설정 카드 본문 링크 `[글자](card:<uuid>)`(DEC-53)를 글자로 벗기는 AI 입력 경계의 규칙이다.

모델 입력·BM25 색인에 카드 id(UUID)가 섞이지 않도록 Content MCP 응답을 스냅샷·요청으로 바꾸는 곳(novelbrain.world_snapshot, world_review)이 쓴다.
링크의 문법은 서버(Kotlin)·화면(TypeScript)과 같은 정규식 하나이고(docs/design/worldstudio-independent-schema.md '카드 본문 링크'),
줄·코드·이스케이프 같은 마크다운 문맥을 보지 않고 본문을 통째로 훑는다. 글자 길이는 JavaScript가 UTF-16 단위로, 여기서는 코드 포인트로 센다
(이쪽이 링크로 보는 범위가 같거나 더 넓어 id가 남지 않는 쪽이다).
"""

import re

_CARD_LINK = re.compile(r'\[([^\[\]\r\n]{1,200})\]\(card:[0-9A-Fa-f]{8}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{12}\)')


def strip_card_links(text: str) -> str:
    """링크를 모두 글자로 바꾼다. 대상이 보이든 아니든 id를 지운다."""
    return _CARD_LINK.sub(r'\1', text)
