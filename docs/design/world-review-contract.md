# 설정집 AI 검토 계약 (world review)

상태: `확정`(2026-11-16 사용자 결정), 구현 중(#394). 브랜치 `feat/world-review-agent`(스택: `feat/world-relation-graph` 위). 원고 검수 `review`(#368)와 다른 기능이다: 그것은 회차 원고를 설정에 비춰 보고, 이것은 설정집 자체를 본다.

## 결정

| 항목 | 결정 |
|---|---|
| 목적 | 세계관 설정에 **오류가 없는지** AI가 판단한다: 규칙·사건·인물 설정끼리의 모순, 인물 문서(DEC-47)가 제 역할대로 쓰였는지(SOUL=말투·사고, GOAL=목표, 회차 문서=그 회차의 경험·비밀), 사건 카드에 회차·참여 인물 같은 필수 정보가 빠졌는지. |
| 결과 표시 | 따로 보고서 화면을 두지 않고 **설정집 게시판의 카드 줄 상태 칸**에 기존 `정리 필요`와 함께 보인다. |
| 화면 계산 상태(요청 없음) | `정리 필요`(인물 IDENTITY·SOUL·GOAL 중 빈 문서, 기존) · `연결 필요`(사건·사물 카드가 어느 인물과도 승인된 관계로 이어지지 않음 → 시뮬레이션에서 아무도 기억하지 못함, [시뮬레이션 계약](character-simulation-contract.md) 3단계) · 왼쪽 분류 메뉴의 빈 영역 `비어 있음`. AI를 부르지 않는다. |
| AI 상태 | `AI 의견 N`: 마지막 AI 검토가 그 카드에 남긴 지적 수. 누르면 편집 화면 위에 지적 문장이 보인다. |
| 소설 연결 | **필요 없다.** 세계관만으로 검토한다. |
| 반영 | 지적마다 AI가 **수정안**(카드 하나의 한 칸을 바꿀 새 글)을 낼 수 있다. 작가가 `초안에 반영`을 눌러 승인한 것만 편집 초안에 들어가고, 기존 `세계관 저장`으로 서버에 반영한다(DEC-36: 제안·승인·반영 구분). AI·Content가 카드를 직접 고치지 않는다. |
| 저장 | 검토 결과는 저장하지 않는다(화면 상태, 다시 요청하면 새로 받는다). |
| 화면 이름 | 관리 화면 `AI 후보 검토` → **`AI 검토`**. 시트 맨 위 '설정집 검토'(요청 버튼·OpenAI 전송 동의·결과 요약), 그 아래 기존 후보 검토. |

## 실행 경로

1. **검토 요청(소설 연결 없이)**: 화면 → Content `POST /api/v1/world-studios/{worldId}/reviews` → AI `POST /internal/v1/world-reviews` → 결과 그대로 응답.
2. **집필 채팅(소설이 연결된 경우)**: 오케스트레이션 그래프에 `world_review` 기능(노드)을 등록한다. `operation:'world_review'`이면 의도 분류를 건너뛰고, 자유 입력("설정에 오류 없는지 봐줘")은 Intent Router가 이 기능으로 분류한다. 노드는 Content MCP `world_studio_read`(작가 토큰)로 연결 세계관을 읽어 **1과 같은 `app/world_review` 서비스 함수**를 부르고 지적을 채팅 답으로 돌려준다(승인 단계 없음).

## Content 공개 API

`POST /api/v1/world-studios/{worldId}/reviews` (Bearer, 소유자만, 기존 `/api/v1/world-studios/**` 라우팅·보안 아래라 nginx·Security 변경 없음)

요청: `{ "consent": true }` — `consent`가 true가 아니면 422 `AI_CONSENT_REQUIRED`.

동작: 소유자 확인(아니면 404, 기존 세계관 조회와 같은 규칙) → 저장된 현재 초안(활성 카드 + 최신 관계, 회차 지정 없음)을 읽어 AI 요청 DTO를 만든다 → AI 호출(동기) → 응답 검증 후 반환. DB 쓰기 없음.

응답 200:
```json
{
  "draftRevision": 12,
  "reviewedCards": 40, "totalCards": 40,
  "findings": [ { "cardIds": ["<uuid>", "<uuid>"], "kind": "contradiction|doc_role|missing_info|other", "message": "300자 이하",
                  "fix": { "cardId": "<uuid>", "target": "body|soul|goal|episode", "episode": 0, "text": "바꿀 새 글 전체" } } ],
  "model": "gpt-6-luna"
}
```
- `findings[].cardIds`는 1~3개, 모두 요청에 보낸 카드 id여야 한다(Content가 다시 검사, 어긋나면 502 `AI_OUTPUT_INVALID`).
- `fix`는 선택이다. `fix.cardId`는 그 지적의 `cardIds` 중 하나, `soul|goal|episode`는 인물 카드에만, `episode`는 `target=episode`일 때만(0 이상 정수), `text`는 그 칸의 **바꾼 뒤 전체 글**(인물 문서 3,000자 이하, 본문은 기존 카드 본문 한도). 어긋나면 502.
- 실패: AI 미설정 503 `AI_NOT_CONFIGURED`, 시간 초과 504 `AI_TIMEOUT`, 출력 오류 502 `AI_OUTPUT_INVALID`, 그 밖 502. 기존 `InitialWorldExtractionClient`의 오류 변환 규칙을 따른다. 임의 성공·빈 결과로 숨기지 않는다.
- 카드가 0장이면 AI를 부르지 않고 `findings: []`, `reviewedCards: 0`.

## AI 내부 API

`POST /internal/v1/world-reviews` (`X-Internal-Token`)

요청 DTO(Content가 만든다):
```json
{ "worldName": "…", "worldDescription": "…",
  "cards": [ { "id": "<uuid>", "cardType": "character|location|organization|ability|object|rule|event|other",
               "areaCode": "basic|space|history|society|culture|special|conflict", "title": "…", "body": "…",
               "characterDocs": { "soul": "…", "goal": "…", "episodes": { "0": "…" } } } ],
  "relationships": [ { "id": "<uuid>", "sourceCardId": "…", "targetCardId": "…", "label": "…", "polarity": "asserted|denied" } ] }
```
- `characterDocs`는 인물 카드에만, 옛 `memory`는 Content가 넣지 않고 AI가 받으면 DEC-47 이전 규칙(00회차 앞에 이어 붙임)으로 읽는다.
- 응답: `{ "findings": [...], "reviewedCards": n, "model": "…" }`(위와 같은 모양). 서비스가 `cardIds`가 입력에 있는지, 1~3개, 메시지 길이를 검증하고 어긋나면 502.
- 모델 `gpt-6-luna`(AGENTS 결정), 기존 agent 규칙(`store=False`, timeout, `max_retries=0`). 프롬프트는 자료 속 명령을 따르지 않는 안전 지시 포함.
- 추적: `tracing.observe('world_review')`, 설정 본문은 참조만(기존 규칙).

## 화면 연결

- `presentation/features/worldstudio`: `WorldAiReview` 버튼 이름 `AI 검토`, 시트에 '설정집 검토' 절(동의 체크 → `설정집 검토 요청`, 진행·실패(서버 문구, 다시 시도)·완료 요약 `AI 의견 N건 · 카드 M장 · HH:mm 검토`). 저장하지 않은 변경이 있으면 이유와 함께 잠근다(서버는 저장된 초안을 검토한다). 데모(`--mode mockup`)는 지원하지 않음 안내.
- 게시판 상태 칸: `정리 필요` · `연결 필요` · `AI 의견 N`을 함께 보인다. 상태가 있는 카드만 보는 `보완 필요` 분류 필터. 빈 영역은 분류 메뉴에 `비어 있음`.
- 편집 화면: 그 카드의 AI 지적 문장 목록(검토 시점 표시). 수정안이 있으면 `수정안 보기`(지금 글 / 바꿀 글) → `초안에 반영` · `반영하지 않기`. 반영은 편집 초안만 바꾸고 '저장하지 않은 변경 있음'이 되며, 세계관 저장 전까지 서버에 닿지 않는다.
  - 검토 시점의 그 칸 글(요청 때 화면이 가진 저장본)과 지금 글이 다르면 `검토 뒤 바뀐 설정이라 반영할 수 없어요`로 잠근다(덮어쓰기 방지). 반영한 지적은 `반영함`으로 표시한다.
  - 집필 채팅의 `world_review` 결과는 지적·수정안을 글로만 보이고, 반영은 세계관 관리 화면의 AI 검토에서 한다(ponytail: 채팅 승인 카드는 후속).
- 판정 규칙(`연결 필요`, 빈 영역)은 Domain 순수 함수, 요청은 `WorldStudioUseCase`(또는 새 UseCase) → `HttpWorldReviewRepository`(새 파일).

## ponytail 한계

- 검토 결과는 저장하지 않는다. 새로 고치면 사라지고, 검토 뒤 카드를 고쳐도 지적은 다음 검토 전까지 그대로 남는다(검토 시점을 표시).
- 한 번에 보내는 양: 카드 300장·카드당 본문과 문서 합계 4,000자까지 보낸다. 넘는 카드는 보내지 않고 `reviewedCards < totalCards`로 화면에 알린다(긴 세계관의 분할 검토는 후속).
- 크레딧 차감 없음(기존 채팅·초기 분석과 같음).
- 관계의 회차 기록(DEC-51)은 최신 시점만 본다.
