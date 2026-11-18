# 설정집 AI 검토 계약 (world review)

상태: `확정`(2026-11-16 사용자 결정), 구현 중(#394). 브랜치 `feat/world-review-agent`(스택: `feat/world-relation-graph` 위). 원고 검수 `review`(#368)와 다른 기능이다: 그것은 회차 원고를 설정에 비춰 보고, 이것은 설정집 자체를 본다.

## 결정

| 항목 | 결정 |
|---|---|
| 목적 | 세계관 설정에 **오류가 없는지** AI가 판단한다: 규칙·사건·인물 설정끼리의 모순, 인물 문서(DEC-47)가 제 역할대로 쓰였는지(SOUL=말투·사고, GOAL=목표, 회차 문서=그 회차의 경험·비밀), 사건 카드에 회차·참여 인물 같은 필수 정보가 빠졌는지. |
| 결과 표시 | 따로 보고서 화면을 두지 않고 **설정집 게시판의 카드 줄 상태 칸**에 기존 `정리 필요`와 함께 보인다. |
| 화면 계산 상태(요청 없음) | `정리 필요`(인물 IDENTITY·SOUL·GOAL 중 빈 문서, 기존) · `연결 필요`(사건·사물 카드가 어느 인물과도 승인된 관계로 이어지지 않음 → 시뮬레이션에서 아무도 기억하지 못함, [시뮬레이션 계약](character-simulation-contract.md) 3단계) · `공개 순서 확인`(이른 카드의 본문·관계 문구·링크 글자에 늦은 카드의 제목·별칭이 나옴, [공개 순서 규칙](#공개-순서-규칙--dec-53)) · 왼쪽 분류 메뉴의 빈 영역 `비어 있음`. AI를 부르지 않는다. |
| AI 상태 | `AI 의견 N`: 마지막 AI 검토가 그 카드에 남긴 지적 수. 누르면 편집 화면 위에 지적 문장이 보인다. |
| 소설 연결 | **필요 없다.** 세계관만으로 검토한다. |
| 반영 | 지적마다 AI가 **수정안**(카드 하나의 한 칸을 바꿀 새 글)을 낼 수 있다. 작가가 `초안에 반영`을 눌러 승인한 것만 편집 초안에 들어가고, 기존 `세계관 저장`으로 서버에 반영한다(DEC-36: 제안·승인·반영 구분). AI·Content가 카드를 직접 고치지 않는다. |
| 저장 | 검토 결과는 저장하지 않는다(화면 상태, 다시 요청하면 새로 받는다). |
| 화면 이름 | 관리 화면 `AI 후보 검토` → **`AI 검토`**. 시트 맨 위 '설정집 검토'(요청 버튼·OpenAI 전송 동의·결과 요약), 그 아래 기존 후보 검토. |

## 실행 경로

1. **검토 요청(소설 연결 없이)**: 화면 → Content `POST /api/v1/world-studios/{worldId}/reviews` → AI `POST /internal/v1/world-reviews` → 결과 그대로 응답.
2. **집필 채팅(소설이 연결된 경우)**: 메인 에이전트의 `ask_world_review` 도구로 부른다(#473). `operation:'world_review'`이면 Decision Guard가 가드레일만 판정하고, 자유 입력("설정에 오류 없는지 봐줘")은 Decision Guard가 이 기능을 판정한다. 도구는 Content MCP `world_studio_read`(작가 토큰)로 연결 세계관을 읽어 **1과 같은 `app/world_review` 서비스 함수**를 부르고 지적을 채팅 답으로 돌려준다(승인 단계 없음).

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
- 실패(오류 본문 `{ "detail": "<사람이 읽을 문장>", "code": "<코드>" }`): Content의 AI 토큰 미설정 503 `AI_NOT_CONFIGURED`, Content read timeout 초과 504 `AI_TIMEOUT`, 출력 검증 실패 502 `AI_OUTPUT_INVALID`, AI의 403·422는 502 `AI_REQUEST_REJECTED`, AI의 503(키 미설정·제공사 실패를 구분하지 않음)과 그 밖 502 `AI_RESPONSE_UNCONFIRMED`. 시간 기준: Content는 기존 초기 분석 클라이언트의 read timeout 75초를 쓰고 그 초과만 504, AI의 모델 timeout은 60초라 제공사 시간 초과는 AI 503 → Content 502로 먼저 끝난다. 기존 `InitialWorldExtractionClient`의 오류 변환 규칙을 따른다. 임의 성공·빈 결과로 숨기지 않는다.
- 카드가 0장이면 AI를 부르지 않고 `findings: []`, `reviewedCards: 0`, `model: ""`. `fix`·`fix.episode`는 없으면 키를 생략한다.

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
- `body`·`characterDocs`의 본문 링크(`[글자](card:<uuid>)`)는 Content가 글자로 벗겨 보낸다. 모델 입력에 UUID가 섞이지 않게 하는 DEC-53 규칙이고, AI도 받은 글에 링크가 남아 있으면 같은 정규식으로 벗긴다([문법](worldstudio-independent-schema.md#카드-본문-링크--dec-53)).
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

## 공개 순서 규칙 — DEC-53

**상태: 설계 확정(2026-11-18 사용자 결정, [#485](https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/issues/485)), 3단계 소스 구현·로컬 단위 테스트 통과, hosted CI 통합 테스트·렌더 테스트·브라우저 육안 확인 미확인.** 카드를 나눈 뒤에도 이른 카드의 글에 늦은 카드의 이름이 쓰이면 독자가 먼저 보게 된다. 모델 없이 화면 Domain 함수(`연결 필요`와 같은 자리)가 저장 전 초안에서 계산한다.

- 대상: 유효 공개 회차가 있는 카드(`N화부터 공개`, 값이 없는 기존 공개 카드는 1화). 작가 전용 카드의 제목·별칭이 공개 카드의 글에 나와도 경고한다(작가 전용은 가장 늦은 회차로 본다, 2026-11-18 사용자 결정: 비밀 인물 이름이 새는 대표 경우).
- 규칙: 카드 C의 **본문**·**링크 글자**·C를 끝점으로 하는 **관계의 `label`·`body`**에 다른 카드 D의 제목·별칭이 나오고, D의 유효 공개 회차가 C가 독자에게 보이기 시작하는 회차보다 크면 경고한다. 관계 문구는 두 끝 카드와 기록 회차 중 가장 늦은 회차부터 보이는 것으로 본다.
- 표시: 게시판 상태 칸에 `공개 순서 확인`, 편집 화면에는 어느 카드의 어느 글에 어떤 이름이 나오는지. 경고일 뿐 저장·확정을 막지 않는다.
- 한계: 제목·별칭의 부분 문자열 일치라 짧은 이름은 잘못 잡힐 수 있다(비어 있는 이름만 건너뛰고 한 글자 이름도 본다).
- 구현: `domain/entities/worldReview.ts`의 `publicationOrderIssues`(경고 `OrderIssue`: 글이 있는 카드·본문/관계·나온 이름·그 카드의 공개 회차·이 글이 보이는 회차)와 `cardStatuses`의 `order`다. 본문은 링크의 id를 뺀 글자로 비교한다(링크 글자는 글로 본다). 관계는 초안의 관계 행에서 `title`을 label, `text`를 body로 보고 두 끝 카드마다 한 건이며, 관계의 기록 회차(DEC-51)는 초안에 없어 두 끝 카드 가운데 늦은 쪽의 공개 회차만 본다(끝점 하나라도 작가 전용이면 독자에게 보이지 않는 관계라 점검하지 않는다). 같은 글에서 같은 카드는 한 번만(제목이 별칭보다 먼저) 알린다. 카드 수의 제곱 번 비교라 수백 장까지는 입력할 때마다 계산한다(천 장을 넘어 밀리면 본문이 바뀐 카드만 다시 센다). 게시판 `공개 순서 확인`은 누르면 그 카드의 편집 화면을 열고 `보완 필요` 필터에 든다. 편집 화면의 '공개 순서 확인' 절은 어느 글(본문·관계 이름)에 어떤 이름이 나오는지와 그 카드가 공개되는 회차(작가 전용이면 그렇게)를 알리고 그 카드로 옮겨 갈 수 있다.
- 발표 뒤 확장(계획): 끊긴 링크·고아 카드·별칭 겹침·관계 문구의 비밀 노출은 이 규칙처럼 모델 없이, 모순·인물 문서 역할은 기존 AI 검토로 점검한다. 링크를 관계로 올리는 후보는 AI가 내고 작가가 승인한다(DEC-36).

## ponytail 한계

- 검토 결과는 저장하지 않는다. 새로 고치면 사라지고, 검토 뒤 카드를 고쳐도 지적은 다음 검토 전까지 그대로 남는다(검토 시점을 표시).
- 한 번에 보내는 양: 카드 300장·카드당 본문과 문서 합계 4,000자까지 보낸다. 넘는 카드는 보내지 않고 `reviewedCards < totalCards`로 화면에 알린다(긴 세계관의 분할 검토는 후속).
- 크레딧 차감 없음(기존 채팅·초기 분석과 같음).
- 집필 채팅 경로는 MCP로 읽은 인물 `characterDocs` 모양이 어긋나면 검토 전체를 502로 실패한다(Content 경로는 그 문서만 빼고 계속). 실패를 숨기지는 않는다.
- Intent Router 선택 질문이 11개로 늘었다. OpenAI Decisions 질문 수 상한은 실제 호출로 확인하지 않았다.
- 관계의 회차 기록(DEC-51)은 최신 시점만 본다.
