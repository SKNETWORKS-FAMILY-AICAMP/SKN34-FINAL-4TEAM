# 설정집 AI 검토 계약 (world review)

상태: `확정`(2026-11-16 사용자 결정), 구현 중(#394). 브랜치 `feat/world-review-agent`(스택: `feat/world-relation-graph` 위). 원고 검수 `review`(#368)와 다른 기능이다: 그것은 회차 원고를 설정에 비춰 보고, 이것은 설정집 자체를 본다. 2026-11-19 사용자 결정으로 World Agent의 `check` 작업이 된다(같은 Agent의 `enrich` 설정 보강·`impact` 변경 영향 분석과 함께, [목표 구조](../writing-ai-architecture/02-ai-architecture.md#목표-구조-여섯-업무-agent-2026-11-19)). 기능 키·도구 이름 변경은 #545, 사건 카드끼리의 시간 모순(연대기) 지적 추가는 #546에서 이 계약에 반영한다. 그 전까지 이 계약은 그대로다. 세계관 화면의 빈 인물 문서(IDENTITY·SOUL)를 연결된 소설의 저장 원고 문장으로 채우는 제안(`fill`, #847)은 [아래 절](#인물-문서-채우기-원고-근거-제안-847-사용자-결정-2026-11-25)이다.

## 결정

| 항목 | 결정 |
|---|---|
| 목적 | 세계관 설정에 **오류가 없는지** AI가 판단한다: 규칙·사건·인물 설정끼리의 모순, 인물 문서(DEC-47)가 제 역할대로 쓰였는지(SOUL=말투·사고, GOAL=목표, 회차 문서=그 회차의 경험·비밀), 사건 카드에 회차·참여 인물 같은 필수 정보가 빠졌는지. |
| 결과 표시 | 따로 보고서 화면을 두지 않고 **설정집 게시판의 카드 줄 상태 칸**에 기존 `정리 필요`와 함께 보인다. |
| 화면 계산 상태(요청 없음) | `정리 필요`(인물 필수 문서 IDENTITY·SOUL 중 빈 문서, 기존. GOAL은 선택이라 비어도 아니다, DEC-47) · `연결 필요`(사건·사물 카드가 어느 인물과도 승인된 관계로 이어지지 않음 → 시뮬레이션에서 아무도 기억하지 못함, [시뮬레이션 계약](character-simulation-contract.md) 3단계) · `공개 순서 확인`(이른 카드의 본문·관계 문구·링크 글자에 늦은 카드의 제목·별칭이 나옴, [공개 순서 규칙](#공개-순서-규칙--dec-53)) · 왼쪽 분류 메뉴의 빈 영역 `비어 있음`. AI를 부르지 않는다. |
| AI 상태 | `AI 의견 N`: 마지막 AI 검토가 그 카드에 남긴 지적 수. 누르면 편집 화면 위에 지적 문장이 보인다. |
| 소설 연결 | **필요 없다.** 세계관만으로 검토한다(`check`에 한한다. 인물 문서 채우기는 연결된 소설의 원고가 필요하다). |
| 반영 | 지적마다 AI가 **수정안**(카드 하나의 한 칸을 바꿀 새 글)을 낼 수 있다. 작가가 `초안에 반영`을 눌러 승인한 것만 편집 초안에 들어가고, 기존 `세계관 저장`으로 서버에 반영한다(DEC-36: 제안·승인·반영 구분). AI·Content가 카드를 직접 고치지 않는다. |
| 저장 | 세계관마다 마지막 검토 결과 하나를 DB에 저장한다(#555, 아래 '검토 결과 저장'). 다시 요청하면 덮어쓴다. |
| 화면 이름 | 관리 화면 `AI 후보 검토` → **`AI 검토`**. 시트 맨 위 '설정집 검토'(요청 버튼·OpenAI 전송 동의·결과 요약), 그 아래 기존 후보 검토. |

## 실행 경로

1. **검토 요청(소설 연결 없이)**: 화면 → Content `POST /api/v1/world-studios/{worldId}/reviews` → AI `POST /internal/v1/world-reviews` → 결과 그대로 응답.
2. **집필 채팅(소설이 연결된 경우)**: 메인 에이전트의 `ask_world(task=check)` 도구로 부른다(#473·#546). `operation:'world'`이면 Decision Guard가 가드레일만 판정하고, 자유 입력("설정에 오류 없는지 봐줘")은 Decision Guard가 이 기능을 판정한다. 도구는 Content MCP `world_studio_read`(작가 토큰)로 연결 세계관을 읽어 **1과 같은 `app/world_review` 서비스 함수**를 부르고 지적을 채팅 답으로 돌려준다(승인 단계 없음).

## Content 공개 API

`POST /api/v1/world-studios/{worldId}/reviews` (Bearer, 소유자만, 기존 `/api/v1/world-studios/**` 라우팅·보안 아래라 nginx·Security 변경 없음)

요청: `{ "consent": true }` — `consent`가 true가 아니면 422 `AI_CONSENT_REQUIRED`.

동작: 소유자 확인(아니면 404, 기존 세계관 조회와 같은 규칙) → 저장된 현재 초안(활성 카드 + 최신 관계, 회차 지정 없음)을 읽어 AI 요청 DTO를 만든다 → AI 호출(동기) → 응답 검증 후 마지막 검토 결과로 저장(아래 '검토 결과 저장')하고 반환한다.

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
- 게시판 `상태` 칸(제목 옆이 아니라 별도 칸): `정리 필요` · `연결 필요` · `공개 순서 N`(그 카드의 경고 건수) · `AI 의견 N` 칩을 함께 보이고(없으면 —) 칩을 누르면 미리보기를 거치지 않고 그 카드의 편집 화면이 칩에 맞는 화면(정리 필요·AI 의견은 문서, 연결 필요는 관계, 공개 순서는 공개 순서 탭)으로 열린다. 정렬에 `보완 필요 많은 순`이 있다. 상태가 있는 카드만 보는 `보완 필요` 분류 필터. 빈 영역은 분류 메뉴에 `비어 있음`. 원고 구축·업데이트가 이름이 같은 카드를 둘 이상 만나 남긴 카드(`semanticMetadata.manuscriptBuild.needsReview`)는 같은 칸에 `확인 필요` 칩(누르면 문서)을 더 보인다. 보완 상태가 아니라 카드 표시값이라 `보완 필요` 필터·정렬에는 들어가지 않는다([계약](initial-build-storage-contract.md#발행-회차로-세계관-업데이트-2026-11-22-사용자-결정)).
- 편집 화면: 그 카드의 AI 지적 문장 목록(검토 시점 표시). 수정안이 있으면 `수정안 보기`(지금 글 / 바꿀 글) → `초안에 반영` · `반영하지 않기`. 반영은 편집 초안만 바꾸고 '저장하지 않은 변경 있음'이 되며, 세계관 저장 전까지 서버에 닿지 않는다.
  - 검토 시점의 그 칸 글(요청 때 화면이 가진 저장본)과 지금 글이 다르면 `검토 뒤 바뀐 설정이라 반영할 수 없어요`로 잠근다(덮어쓰기 방지). 반영한 지적은 `반영함`으로 표시한다.
  - 집필 채팅의 `check` 결과는 지적·수정안을 글로만 보이고, 반영은 세계관 관리 화면의 AI 검토에서 한다. `enrich` 제안은 채팅의 승인 카드(`설정집 초안에 반영`)로 반영하며, 세계관 관리 화면은 반영 뒤 저장하지 않은 변경이 없을 때만 초안을 다시 읽고 있으면 안내만 한다.
- 판정 규칙(`연결 필요`, 빈 영역)은 Domain 순수 함수, 요청은 `WorldStudioUseCase`(또는 새 UseCase) → `HttpWorldReviewRepository`(새 파일).

## 공개 순서 규칙 — DEC-53

**상태: 설계 확정(2026-11-18 사용자 결정, [#485](https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/issues/485)), 3단계 소스 구현·로컬 단위 테스트 통과, hosted CI 통합 테스트·렌더 테스트·브라우저 육안 확인 미확인. 관계의 기록 회차를 반영한 계산(DEC-54 2단계, [#519](https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/issues/519))은 소스 구현·로컬 단위·렌더 테스트 통과, hosted CI·브라우저 육안 확인은 미확인.** 카드를 나눈 뒤에도 이른 카드의 글에 늦은 카드의 이름이 쓰이면 독자가 먼저 보게 된다. 모델 없이 화면 Domain 함수(`연결 필요`와 같은 자리)가 저장 전 초안에서 계산한다.

- 대상: 유효 공개 회차가 있는 카드(`N화부터 공개`, 값이 없는 기존 공개 카드는 1화). 작가 전용 카드의 제목·별칭이 공개 카드의 글에 나와도 경고한다(작가 전용은 가장 늦은 회차로 본다, 2026-11-18 사용자 결정: 비밀 인물 이름이 새는 대표 경우).
- 규칙: 카드 C의 **본문**·**링크 글자**·C를 끝점으로 하는 **관계의 `label`·`body`**에 다른 카드 D의 제목·별칭이 나오고, D의 유효 공개 회차가 C가 독자에게 보이기 시작하는 회차보다 크면 경고한다. 관계 문구는 두 끝 카드와 관계의 기록 회차(관계 행의 'N화부터') 가운데 가장 늦은 회차부터 보이는 것으로 본다(기록 회차가 없으면 1화: 소설을 연결하지 않은 세계관과 아직 회차를 정하지 않은 새 관계). 이미 기록된 시작 회차보다 늦춘 N화부터는 기존 연결이 남아 기록된 회차부터 보이므로 둘 중 이른 회차를 쓴다(아래 '한계').
- 표시: 게시판 상태 칸에 `공개 순서 N`(그 카드의 경고 건수), 편집 화면에는 어느 카드의 어느 글에 어떤 이름이 나오는지(활동 막대의 공개 순서 탭: 같은 카드 이름이 되풀이되는 경고는 카드별 한 줄 `이름 — N화부터 공개 · 본문 1 · 관계 글 5곳 (17·20화)`로 묶고 `자세히`에 경고마다, 문서 탭 이름 아래 `공개 순서 확인 N` 배지가 그 탭으로 간다). 경고일 뿐 저장·확정을 막지 않는다.
- 한계: 제목·별칭의 부분 문자열 일치라 짧은 이름은 잘못 잡힐 수 있다(비어 있는 이름만 건너뛰고 한 글자 이름도 본다). 관계는 지금 초안에 있는 글(보는 회차 시점의 label·body)만 보고, 이전 회차에 기록한 지난 글은 초안에 없어 점검하지 않는다. 이미 기록된 시작 회차보다 늦춘 N화부터(예: 3화로 기록된 관계를 5화로)는 서버가 그 회차의 연결만 새로 쓰고 기존 연결은 남아(DEC-51) 독자에게는 계속 기록된 회차부터 보이므로, 편집 행이 입력 아래에서 그 사실을 알리고(막지는 않는다, 늦추려면 관계를 끝내고 다시 만든다) 경고는 `min(기록된 시작 회차, 입력한 N화부터)`로 계산한다. 글을 함께 고쳤다면 새 글은 입력한 회차부터 보이므로 경고가 과할 수 있다. 이 안내와 계산은 저장 전 입력에만 있다: 저장하면 서버가 가장 최근 연결의 회차(늦춘 값)를 시작 회차로 돌려주므로 화면에는 늦춘 회차가 보이지만 독자에게는 처음 기록한 회차부터 보인다.
- 구현: `domain/entities/worldReview.ts`의 `publicationOrderIssues`(경고 `OrderIssue`: 글이 있는 카드·본문/관계·나온 이름·그 카드의 공개 회차·이 글이 보이는 회차)와 `cardStatuses`의 `order`다. 본문은 링크의 id를 뺀 글자로 비교한다(링크 글자는 글로 본다). 관계는 초안의 관계 행에서 `title`을 label, `text`를 body로 보고 두 끝 카드마다 한 건이다. 관계의 기록 회차(DEC-51 `fromEpisode`)는 관계 행의 `SettingItem.fromEpisode`(관계 편집 행의 'N화부터')다. 서버가 준 그 관계의 시작 회차(소유자 응답의 `relationshipEpisodes`)를 읽을 때 행의 `fromEpisode`와 읽은 그대로 두는 `recordedFrom`(기록된 시작 회차)에 채우고, 작가가 고치면 `fromEpisode`만 바뀐다. 관계 글이 독자에게 보이는 회차는 `max(두 끝 카드의 공개 회차, min(fromEpisode, recordedFrom))`다(끝점 하나라도 작가 전용이면 독자에게 보이지 않는 관계라 점검하지 않고, 기록 회차가 없으면 1화로 본다). 관계별 회차를 비우면 요청의 `episode`(없으면 마지막 연결 회차)로 기록하는 폴백은 API·MCP에만 있고, 작가 화면은 소설을 연결한 세계관에서 N화부터를 필수로 받으며 연결하지 않은 세계관은 1화로 저장한다. 그래서 편집 화면은 본문과 같은 문구('이 글은 N화부터 독자에게 보여요')로 알린다(예: 시연 세계관 `kael-lian`의 '보호'는 3화에 기록돼 있고 '세라핀'이 3화부터 공개라 경고가 없다). 같은 글에서 같은 카드는 한 번만(제목이 별칭보다 먼저) 알린다. 카드 수의 제곱 번 비교라 수백 장까지는 입력할 때마다 계산한다(천 장을 넘어 밀리면 본문이 바뀐 카드만 다시 센다). 게시판 `공개 순서 N`은 누르면 그 카드의 편집 화면을 공개 순서 탭으로 열고 `보완 필요` 필터에 든다. 편집 화면의 '공개 순서 확인' 절은 어느 글(본문·관계 이름)에 어떤 이름이 나오는지와 그 카드가 공개되는 회차(작가 전용이면 그렇게)를 알리고 그 카드로 옮겨 갈 수 있다.
- 발표 뒤 확장(계획): 끊긴 링크·고아 카드·별칭 겹침·관계 문구의 비밀 노출은 이 규칙처럼 모델 없이, 모순·인물 문서 역할은 기존 AI 검토로 점검한다. 링크를 관계로 올리는 후보는 AI가 내고 작가가 승인한다(DEC-36).

## 검토 결과 저장 (2026-11-19 사용자 결정)

설정집 화면의 `AI 검토` 결과를 새로 고침해도 남게 DB에 저장한다(이전의 '저장하지 않는 화면 상태'를 대체). 세계관마다 **마지막 검토 하나**만 둔다.

- 테이블(WorldStudio 이력, `db/migration/worldstudio/V12__world_review_result.sql`): `world_review_result(world_id uuid PK → world(id), result jsonb not null, reviewed_at timestamptz not null)`. 성공한 검토마다 같은 행을 덮어쓴다(upsert). AI 호출 실패·검증 실패는 저장하지 않고 이전 결과를 그대로 둔다. AI 호출은 지금처럼 DB 트랜잭션 밖이고 저장만 짧은 WorldStudio 트랜잭션이다.
- `result`는 응답 본문 전체(`draftRevision`·`reviewedCards`·`totalCards`·`findings`·`model`)에 `basis`를 더한 것이다. `basis`는 수정안(`fix`)이 가리킨 카드마다 검토한 초안의 그 카드 글 `{body, characterDocs?}`(본문 링크를 벗기기 전 원문)이며, 화면이 '검토 뒤 바뀐 칸' 잠금을 새로 고침 뒤에도 같은 기준으로 계산하는 데 쓴다.
- `POST …/reviews` 응답은 기존 필드 + `reviewedAt` + `basis`다(기존 필드는 그대로).
- `GET /api/v1/world-studios/{worldId}/reviews/latest`(Bearer, 소유자만, POST와 같은 소유자·삭제 규칙): 저장된 결과를 POST 응답과 같은 모양으로 200. 저장된 검토가 없으면 404 `WORLD_REVIEW_NOT_FOUND`(세계관 자체가 없거나 남의 것이면 기존 404 규칙).
- 화면: 세계관 관리 화면이 열릴 때 `latest`를 읽어 검토 직후와 같은 상태(게시판 `AI 의견 N`, 편집 화면 지적·`수정안 보기`, 시트 요약 `HH:mm 검토`)로 채운다. 404는 '검토 없음'이고, 그 밖의 실패는 시트에 '지난 검토 결과를 불러오지 못했어요'를 알리되 화면 사용은 막지 않는다(빈 결과로 바꾸지 않는다). 잠금은 `basis`의 그 칸 글과 지금 글을 비교한다. 지금 초안에 없는 카드를 가리킨 지적은 보이지 않는다.
- 범위 밖: 검토 이력(여러 개), 집필 채팅 `check` 결과의 저장(채팅은 대화 기록에 이미 남는다).
- ponytail 한계: 옛 `memory` 키가 남은 인물 카드는 화면이 그 글을 00회차 앞에 붙여 읽는데 `basis`에는 `memory`가 없어, 그 카드의 00회차 수정안은 늘 '검토 뒤 바뀐 칸'으로 잠긴다(덮어쓰지 않는 안전한 쪽). 필요하면 `basis`에 원본 `memory`를 싣는다.

## World Agent 채팅 작업 (#546·#291, 2026-11-19 사용자 결정)

집필 채팅의 기능 키 `world_review`를 `world`로, 도구 `ask_world_review`를 `ask_world(request, task)`로 바꾼다. `task`는 `check`·`enrich`·`impact`이고 단계(`steps[]`)의 `task`에 남는다. 기능 키 `world_plot`은 없앤다(미구현 판정·`unsupported`가 사라진다). 저장된 대화의 옛 단계 `world_review`는 계속 읽는다. 설정집 화면의 `POST /world-studios/{id}/reviews`와 이 계약의 HTTP 경로, `app/world_review/` 패키지 이름은 그대로다.

세 작업 모두 작품에 연결된 세계관을 작가 권한(Content MCP `world_studio_list`·`world_studio_read`)으로 읽고 카드 본문 링크를 벗긴 같은 스냅샷(`linked_request`)을 쓴다. 연결된 세계관이 없으면 409다. 집필 채팅은 이 409를 실패 단계로 두지 않고 세계관 탭으로 안내하는 되묻기로 끝낸다(#910, [집필 AI 아키텍처](../writing-ai-architecture/02-ai-architecture.md)의 되묻기 선택지).

| task | 하는 일 | 결과(`step.result`) | 반영 |
|---|---|---|---|
| `check` | 위 설정집 검토. 사건 카드끼리의 시간 순서·선후 모순(연대기)도 `contradiction`으로 지적한다(지적 종류는 늘리지 않는다) | `WorldReviewResponse` 그대로 | 없음(화면에서 수정안 반영) |
| `enrich` | 작가 요청이 가리킨 기존 카드의 본문·인물 문서를 세계관과 어긋나지 않게 자세히 쓴 제안 | `{worldId, revision, fixes: [{cardId, cardTitle, target, episode, text}] (1~5), note(300자 이하), model}`. `target`·`episode`·`text` 규칙은 위 `Fix`와 같고 `cardTitle`은 service가 입력에서 채운다 | 작가 승인 뒤에만(`awaitingApproval: world`) `world_studio_read` → 그 칸만 바꿔 `world_studio_edit_draft`(같은 `revision`). 읽은 초안 revision이 제안 때와 다르면 409로 반영하지 않는다. 확정 버전은 작가가 남긴다 |
| `impact` | 바꾸려는 설정·사건이 영향을 주는 곳 분석(옛 World & Plot) | `{affected: [{kind, ref, title, reason, certainty}], conflicts: [문장], gaps: [문장], model}`. `kind`는 `card`·`relationship`·`episode`·`scene`, `certainty`는 `confirmed`·`inferred` | 없음(읽기만, 조건부 수정과 잇지 않음) |

- `enrich`·`impact`의 `ref`·`cardId`는 입력에 있던 카드 id·관계 id·회차 번호·장면 계획 id만 허용하고, 어긋나면 보정하지 않고 502다.
- `impact` 입력은 스냅샷에 더해 Content MCP `work_context_read`(Content가 허용한 원고 발췌)와 `story_plan_list`(계획된 장면, 정본 아님)다. 공통 Retrieval scope 토큰을 쓰지 않는다.
- 구현 해석(#546): 단계 `applied`는 Writing과 같은 `{episode, revision}` 모양이며 world에서 `revision`은 반영 뒤 세계관 초안 revision이다(`episode`는 채팅 대상 회차라 의미 없음). 본문을 바꿀 때 화면용 사본 `semanticMetadata.studio.item.text`가 있으면 같은 글로 맞춘다(관리 화면은 둘이 다르면 세계관을 읽지 못한다, 사본이 없으면 새 키를 만들지 않는다). 연결 세계관에 카드가 0장이면 `enrich`는 409, 같은 칸을 두 번 고치는 제안은 502다. `impact`의 `ref`는 문자열이며 회차는 번호 글(`"3"`)이다. `ask_world`는 기능당 1회 한도라 한 턴에 작업 하나만 실행한다. `operation`으로 옛 값 `world_review`는 받지 않는다(422).
- `enrich`는 작가 승인이 필요하므로 한 모델 턴의 병렬 묶음에 끼지 않는다(`ask_writing`과 같다). `check`·`impact`는 조회형이라 병렬로 실행할 수 있다.
- ponytail 한계: `enrich`·`impact`는 관련 카드만 고르지 않고 `check`와 같은 스냅샷(카드 300장·카드당 4,000자 한도) 전체를 보낸다. 반영은 칸 전체를 바꾸므로, 모델에 보내기 전에 벗긴 본문 링크(`card:<id>`)는 바꾼 칸에서 글자만 남는다(화면의 수정안 반영과 같다).

## 인물 문서 채우기: 원고 근거 제안 (#847, 사용자 결정 2026-11-25)

**상태: 사용자 결정(2026-11-25)으로 확정, 소스 구현·로컬 단위 테스트 통과(AI·Content·프런트 domain/data). 프런트 훅·화면·페이지 테스트와 hosted CI·브라우저 육안 확인은 미확인.** 원고 전처리(#839)는 정체 진술이 없는 인물의 IDENTITY(카드 본문)를 이름으로 채우지 않고 비워 두므로(전처리 정책 6) 조연의 IDENTITY·SOUL이 비고, 확정 버전은 모든 카드에 본문을 요구해(Content `validate`, 화면 `worldSealIssues`) 작가가 채우기 전에는 확정할 수 없다. 세계관 관리 화면이 그 빈 문서를 **연결된 소설의 저장 원고에서 찾은 문장**으로 채우는 제안을 낸다. 제안이 도착한 것은 저장도 반영도 아니고, 작가가 승인해 초안에 반영한 뒤 기존 `세계관 저장`으로 서버에 닿는다(DEC-36).

기존 `enrich`를 그대로 쓰지 않는다: 채팅(MCP·승인 카드) 전용이고 입력에 원고가 없으며 출력에 근거가 없어 '지어내지 않기'를 코드로 보장할 수 없다. `app/world_review` 패키지·Content의 AI 클라이언트·'초안에 반영 → 세계관 저장' 흐름은 재사용하고 원고 발췌를 입력으로 받는 새 작업 `fill`을 더했다.

| 항목 | 결정(2026-11-25) |
|---|---|
| 원고 범위·권한 | 세계관 **소유자만**. 연결된 작품의 **저장 버전**(미발행 포함, 이어받은 회차 제외, 최초 구축 입력과 같은 범위) 가운데 그 인물의 이름·별칭이 나온 곳의 **앞 150자·뒤 350자 발췌**(합계 12,000자, 앞 회차부터)만 OpenAI로 보낸다. **IDENTITY는 첫 등장 회차(발췌 가운데 가장 작은 회차)의 발췌에서만, SOUL은 전 회차**에서 고른다(전처리 정책 6과 같은 규칙: IDENTITY는 독자 공개 문서라 뒤 회차에서 드러나는 정체가 새지 않게). OpenAI 전송·비용 동의 필수(`consent:true`, 아니면 422 `AI_CONSENT_REQUIRED`), 크레딧 차감 없음(기존 검토와 같음). |
| 제안 형태 | 원고 문장 그대로의 줄 `[표지] 문장`(전처리 표기 계약과 같은 형식, 표지는 `[사실]`·`[묘사]`)과 회차. 글을 새로 쓰지 않으니 근거 없는 서술이 없다. 발췌에 글자 그대로 없는 줄은 AI가 빼서 `skipped`로 세고, Content가 보낸 발췌와 다시 대조해 어긋나면 502 `AI_OUTPUT_INVALID`. **근거가 없으면 제안하지 않고 그 사실을 보인다**(오류 아님). |
| API | Content `POST /api/v1/world-studios/{worldId}/cards/{cardId}/doc-suggestions` → AI `POST /internal/v1/world-reviews/fill`. 카드 1장·모델 1회 동기 호출. 결과는 **저장하지 않는다**(화면 상태). |
| 화면 | 편집 화면 `인물 문서`의 비어 있는(`정리 필요`) 정체성·성격·말투 탭에 `원고로 채우기 제안` → 제안(줄·회차) → `초안에 반영`(그 문서가 비어 있어 제안이 보이는 동안만)·`반영하지 않기`. 반영은 편집 초안만 바꾸고 기존 `세계관 저장`으로 서버에 닿는다. |

### Content 공개 API

`POST /api/v1/world-studios/{worldId}/cards/{cardId}/doc-suggestions` (Bearer, 소유자만, 기존 `/api/v1/world-studios/**` 라우팅·보안 아래라 nginx·Security 변경 없음)

요청: `{ "consent": true }` — `consent`가 true가 아니면 422 `AI_CONSENT_REQUIRED`.

동작(위에서부터 처음 걸리는 것이 응답이다): 남의·없는 세계관 404(기존 규칙) → 활성 카드가 아니면 404 `CARD_NOT_FOUND` → 인물 카드가 아니면 422 `CARD_NOT_CHARACTER` → 채울 문서(저장된 카드의 비어 있는 IDENTITY·SOUL, 공백뿐이면 빈 것, GOAL은 보지 않고 문서 모양이 어긋나면 SOUL은 없는 것)가 없으면 409 `DOCS_NOT_EMPTY` → 연결된 소설이 없으면 409 `WORLD_NOT_LINKED` → 연결된 소설의 저장 원고(회차마다 마지막 저장 버전, 저장한 버전이 없는 회차와 이어받은 회차는 제외)에서 이름(제목과 별칭을 다듬은 두 글자 이상, 중복 없음)이 나온 곳의 발췌를 만든다(앞 발췌가 덮은 곳의 이름은 건너뛰고, 서로게이트 쌍 가운데서 자르지 않으며, 합계 12,000자에서 앞 회차부터 멈춘다) → 발췌가 없으면 **AI를 부르지 않고** 줄이 없는 응답 → AI 호출(DB 트랜잭션 밖) → 응답 검증.

응답 200(저장하지 않으며 `Cache-Control: no-store`):
```json
{ "lines": [ { "target": "body|soul", "kind": "fact|description", "episode": 2, "quote": "원고에 글자 그대로 있는 문장" } ], "skipped": 0, "model": "gpt-6-luna" }
```
- `target`은 IDENTITY(카드 본문)=`body`·`soul`, `lines`가 비면 원고에서 근거를 찾지 못한 것이다(AI를 부르지 않은 때는 `model: ""`).
- Content가 AI 응답을 보낸 발췌와 다시 대조한다: `target`은 채우라고 한 문서, `kind`는 `fact|description`, `quote`는 비어 있지 않은 300자 이하이고 보낸 그 회차의 한 발췌 안에 글자 그대로 있으며, `body` 줄은 첫 등장 회차의 것이고, 문서마다 8줄 이하다. 어긋나면 502 `AI_OUTPUT_INVALID`.
- 실패(오류 본문 `{ "detail", "code" }`): AI 토큰 미설정 503 `AI_NOT_CONFIGURED`, 시간 초과 504 `AI_TIMEOUT`, AI의 403·422·그 밖 502 `AI_REQUEST_REJECTED`·`AI_RESPONSE_UNCONFIRMED` (설정집 검토와 같은 변환, 시간 기준도 같다). 임의 성공·빈 결과로 숨기지 않는다.

### AI 내부 API

`POST /internal/v1/world-reviews/fill` (`X-Internal-Token`, 선택 `X-User-Authorization`은 추적의 회원 식별에만)

요청 DTO(Content가 만든다): `{ "cardId": "<uuid>", "title": "…", "aliases": ["…"], "targets": ["body", "soul"], "passages": [ { "episode": 2, "text": "발췌" } ] }` — `targets` 1~2개, `passages` 1개 이상·회차 1 이상·글자 합계 12,000자 이하(넘으면 422).

응답: `{ "lines": [ { "target", "kind", "episode", "quote" } ], "skipped": n, "model": "…" }`.
- 모델은 발췌의 문장을 `quote`에 옮긴다(요약·바꿔 쓰기·이어 붙이기 금지, 이 인물에 대한 문장만). service가 줄마다 다시 검증한다: 앞뒤 공백을 다듬은 `quote`가 1~300자이고, 채우라고 한 문서이며, `body`는 첫 등장 회차(발췌 가운데 가장 작은 회차)이고, 그 회차의 **한 발췌 안에 글자 그대로** 있어야 한다(두 발췌를 이은 문장은 원문이 아니다). 같은 줄의 되풀이는 한 번만 싣고(세지 않는다), 문서마다 8줄을 넘는 줄은 뺀다. 어긋난 줄은 고쳐 쓰지 않고 빼서 `skipped`로 센다.
- **제안은 있었는데 하나도 확인하지 못했을 때만** 502이고(모델 출력을 믿을 수 없다), 근거가 없어 아무것도 제안하지 않은 것은 빈 결과다.
- 모델 `gpt-6-luna`(AGENTS 결정), 기존 agent 규칙(`store=False`, timeout 60초, `max_retries=0`). 지시문 `world_review.fill`은 Langfuse Prompt Management의 코드 시드이고 자료 속 명령을 따르지 않는 안전 지시를 포함한다.
- 추적: 기능 키 `world_review`(설정집 검토와 같은 요청 키라 운영 파이프라인의 단독 노드 '설정집 검토'가 `world_review.fill`·`world_review.fill.generation`을 센다). 추적 input에는 **카드 id·대상·회차 번호만** 남기고 원고 발췌·인물 이름은 남기지 않는다.

### 화면 연결

- `presentation/features/worldstudio`: `DocFill`(편집기 위, 문서 안내 줄 아래)·`useDocFill`(동의·요청·제안, 세계관 ViewModel이 하나 갖고 카드 한 장의 제안만 화면 상태로 둔다)·`useCharacterDocs.fill`(선택한 문서의 반영·반영하지 않기). 요청은 `WorldReviewUseCase.suggestDocs` → `HttpWorldReviewRepository`(같은 UseCase·Repository에 더했다: 같은 동의·인증·오류 규칙). 문서 규칙(화면 문서 ↔ 서버 문서 이름, 줄 모양)은 `domain/entities/characterDocs.ts`의 순수 함수다.
- 동의 체크(`원고 중 이 인물이 나온 부분을 OpenAI로 보내고 API 비용이 드는 데 동의해요.`)는 설정집 검토 시트의 동의와 따로이고 이 화면에 머무는 동안 유지한다. 소설이 연결되지 않았거나(작품 관리에서 연결) 저장하지 않은 변경이 있거나(서버는 저장한 카드와 원고를 읽는다) 세계관을 아직 못 읽었거나 다른 요청 중이거나 데모(서버 기능 없음)면 이유와 함께 잠근다.
- 진행(`role="status"`)·실패(서버 문구 그대로, `role="alert"`, 버튼은 `다시 시도`)·근거 없음(`원고에서 근거가 되는 문장을 찾지 못했어요. 직접 써 주세요.`)·제안(회차 `N화` 칩과 `[표지] 문장` 줄, 서버가 뺀 줄이 있으면 그 수)을 실제 결과대로 알린다. 제안이 도착한 것을 저장·반영 완료로 보이지 않는다.
- `초안에 반영`은 그 문서의 글을 줄들(줄바꿈으로 이은 것)로 바꾸고 편집기를 다시 만들며 '원고에서 찾은 N줄을 초안에 반영했어요. 세계관을 저장해야 서버에 반영돼요.'를 알린다. 제안은 문서가 비어 있을 때만 보이므로 작가가 쓴 글을 덮어쓰지 않는다. `반영하지 않기`는 그 문서의 제안만 지운다(다른 문서의 제안은 남는다). 저장 중에는 반영할 수 없다. GOAL·회차 기억에는 제안이 없다.

### ponytail 한계(인물 문서 채우기)

- 이름·별칭의 부분 문자열 일치다(두 글자 이상, 호칭 변형 `치삼이`는 별칭에 있어야 걸린다). 자주 나오는 인물은 앞 회차 발췌 12,000자만 가서 뒤 회차의 성격은 빠진다(그런 인물은 대개 전처리가 이미 채웠다).
- 첫 등장 회차는 이름 일치로 계산해 전처리의 `firstEpisode`와 다를 수 있다. IDENTITY는 그 회차의 발췌에서만 고르므로 근거가 없어 제안이 비는 인물이 있을 수 있다(그때는 작가가 직접 쓴다).
- 요청마다 연결된 소설의 모든 저장 버전을 읽어 회차마다 마지막 것만 쓴다(최초 구축 입력과 같은 읽기). 버전이 아주 많은 작품은 느려질 수 있다.
- 카드 한 장씩만 요청한다(세계관 전체 일괄 채우기 없음). 제안은 저장하지 않고 카드 한 장의 하나만 화면 상태로 두며 크레딧을 차감하지 않는다.
- 새 API의 HTTP 통합 시나리오(CI)는 아직 없다(Content는 서비스·입력·출력 검증·컨트롤러 바인딩 단위 테스트, AI는 단위·라우터 테스트와 `test_http.py`의 경계 시험).

## ponytail 한계

- 마지막 검토 하나만 저장한다(이력 없음). 검토 뒤 카드를 고쳐도 지적은 다음 검토 전까지 그대로 남는다(검토 시점을 표시, 바뀐 칸의 수정안은 잠금).
- 한 번에 보내는 양: 카드 300장·카드당 본문과 문서 합계 4,000자까지 보낸다. 넘는 카드는 보내지 않고 `reviewedCards < totalCards`로 화면에 알린다(긴 세계관의 분할 검토는 후속).
- 크레딧 차감 없음(기존 채팅·초기 분석과 같음).
- 집필 채팅 경로는 MCP로 읽은 인물 `characterDocs` 모양이 어긋나면 검토 전체를 502로 실패한다(Content 경로는 그 문서만 빼고 계속). 실패를 숨기지는 않는다.
- Intent Router 선택 질문이 11개로 늘었다. OpenAI Decisions 질문 수 상한은 실제 호출로 확인하지 않았다.
- 관계의 회차 기록(DEC-51)은 최신 시점만 본다.
