# 알림 사건 계약 (RabbitMQ, schemaVersion 1)

[메인 README](../README.md) · [문서 목록](README.md)

사건을 만든 서비스(예: Content)가 브로커에 사건을 발행하면 Core가 소비해 회원의 알림함에 한 건을 만든다.
이 문서는 발행·소비 양쪽이 지켜야 할 메시지 형식이다. 처음 연결할 사건(`content.world.changed`)은 팀 확인 전의 후보다.

## 경로

| 항목 | 값 |
| --- | --- |
| 교환기 | `storyfork.events` (topic, durable) |
| 큐 | `core.notification.events` (durable) |
| 실패 보관 | `storyfork.events.dlx` → `core.notification.events.dlq` |
| routing key | 사건 `type`과 같은 값 |
| 소비 | 항상 켜짐. local·개발 배포 compose의 `rabbitmq` 컨테이너에 연결(`CORE_RABBITMQ_PASSWORD` 필요) |

Core가 켜질 때 교환기·큐·DLQ를 선언한다. 발행 쪽이 먼저 선언해도 되지만 같은 설정이어야 한다.

## 메시지 본문 (JSON, UTF-8)

```json
{
  "schemaVersion": 1,
  "eventId": "0b9f0f3e-6c7a-4a39-9d0e-6f3d2a8f2a11",
  "type": "content.mcp.work-changed",
  "occurredAt": "2026-11-05T06:15:08Z",
  "recipientId": "<알림을 받을 회원 UUID>",
  "target": { "type": "work", "id": "<작품 id>" },
  "detail": { "title": "별의 숲", "episodeNumber": 3, "subject": "원고" }
}
```

- `schemaVersion`: 정수 1만 받는다. 호환되지 않게 바뀌면 올린다.
- `eventId`: 사건마다 고유한 UUID. **같은 사건을 다시 보낼 때는 같은 값**을 쓴다. Core는 이 값으로 중복을 한 번만 반영한다.
- `type`: 아래 표의 값. 알 수 없는 값은 DLQ로 간다.
- `occurredAt`: 발생 시각(ISO-8601 UTC). 알림 정렬은 Core가 저장한 시각을 쓴다.
- `recipientId`: 받는 회원 한 명. 여러 명에게 보낼 때는 회원마다 별도 메시지(고유 `eventId`)를 발행한다.
- `target`: 사건 종류가 요구하는 대상. `type`이 표와 같아야 하고 `id`는 1~100자.
- `detail`(선택, #941): 알림 문구를 구체화하는 재료. 없거나 `title`이 비면 Core는 사건 종류의 기본 문구를 쓴다(이전 발행자와 호환).
  - `title`: 작품명(`target.type`이 `work`) 또는 세계관명(`world`). 공백·줄바꿈은 한 칸으로 접고 40자에서 자른다.
  - `episodeNumber`: 회차 단위 사건의 회차 번호(1 이상, 0 이하는 계약 위반). `work` 대상만 저장하며 알림을 누르면 그 회차로 간다. 작품 제한·해제는 이 값이 있으면 그 회차의 제한이다.
  - `subject`: AI 변경 사건에서 바뀐 것을 가리키는 짧은 구절(예: `원고`, `플롯`, `설정 카드 「카드명」`). 60자에서 자른다.
  - `reason`: 운영자 제한 사유(신고 처리로 제한한 경우의 신고 사유 등). 신고자가 쓴 원문·신고자 식별 정보는 싣지 않고 신고 분류명이나 운영자가 정리한 사유를 싣는다. 있으면 제한 알림 끝에 붙이고, 100자에서 자른다.
  - 형식이 틀린 `detail`은 계약 위반이라 알림 없이 DLQ로 간다. `episodeNumber`는 Jackson이 `"3"`·`3.9` 같은 값도 정수로 읽으므로, 정수로 읽을 수 없거나(예: `"abc"`, 객체) 0 이하일 때 DLQ로 간다.
- 알림 문구는 Core가 사건 종류와 `detail`로 만든다(예시는 아래 표, 문구 규칙은 `NoticeSummary`). 메시지에 비공개 원고 본문·개인정보를 넣지 않고 제목·회차 번호·짧은 대상 구절만 싣는다.

## 사건 종류

| type | 알림 분류 | target.type | 비고 |
| --- | --- | --- | --- |
| `content.world.changed` | 읽기(끌 수 있음) | `work` | 후보. 수신자 결정 규칙은 Content 쪽 확인 필요 |
| `operations.alert.raised` | 처리 결과(끌 수 없음) | `alert` | 운영 서비스가 경고를 만들 때 `llm`·`jobs` 권한 운영자마다 발행([계약](design/operations-llmops-contract.md#사이트-안-알림)). 화면은 `/admin?tab=llm&view=alerts`(LLM Ops 경고·누설 감시)로 이동 |
| `content.episode.published` | 읽기(끌 수 있음) | `work` | 관심 작품에 새 회차(처음 발행한 회차 번호)가 올라왔을 때. 수신자는 그 작품을 관심 작품으로 담은 회원(작가 본인 제외), `target.id`는 작품 id, `detail`의 `title`·`episodeNumber`로 "관심 작품 「작품명」에 4화가 올라왔어요" |
| `content.mcp.world-changed` | AI·외부 도구 변경(`ai-tool`, 끌 수 있음) | `world` | MCP 쓰기 도구가 세계관 내용·설정을 바꿨을 때 도구를 부른 회원(작가 본인)에게. 같은 대상의 읽지 않은 알림이 있으면 그 알림에 묶는다([계약](design/mcp-change-notice-contract.md)). `detail` 예: "AI가 MCP로 「세계관명」의 설정 카드 「카드명」을 수정했어요" |
| `content.mcp.work-changed` | AI·외부 도구 변경(`ai-tool`, 끌 수 있음) | `work` | MCP 쓰기 도구가 작품·회차·플롯·공지·작품 설정을 바꿨을 때. 수신·묶음 규칙은 위와 같다. `detail` 예: "AI가 MCP로 「작품명」 3화 원고를 수정했어요" |
| `content.operator.work-restricted`·`content.operator.work-unrestricted` | 처리 결과(끌 수 없음) | `work` | 운영자가 작품을(`detail.episodeNumber`가 있으면 그 회차를) 제한·해제했을 때 작품 소유자에게([계약](design/mcp-change-notice-contract.md#운영자-조치-알림)). `detail` 예: "운영자가 「작품명」 3화를 제한했어요 · 사유: 신고 사유" |
| `content.operator.world-restricted`·`content.operator.world-unrestricted` | 처리 결과(끌 수 없음) | `world` | 운영자가 세계관을 제한·해제했을 때 세계관 소유자에게(#941), `target.id`는 WorldStudio 세계관 id. `detail` 예: "운영자가 「세계관명」 세계관을 제한했어요" |
| `content.operator.comment-hidden`·`content.operator.comment-restored` | 처리 결과(끌 수 없음) | `work` | 운영자가 댓글을 숨김·다시 게시했을 때 댓글 작성자에게, `target.id`는 댓글이 달린 작품 id. `detail` 예: "운영자가 「작품명」 3화에 남긴 내 댓글을 숨겼어요" |
| `core.credit.expiring` | 크레딧(끌 수 없음) | `credit-expiry` | Core가 발행. 남은 크레딧이 `app.credit.expiry-notice.lead-time`(기본 3일, 임시) 안에 소멸하는 회원에게 소멸 날짜마다 한 번. `target.id`는 소멸 날짜(KST, `yyyy-MM-dd`), `eventId`는 회원·날짜로 고정 |
| `core.member.withdrawal-requested` | 권리·보안(끌 수 없음) | `withdrawal` | Core가 발행. 탈퇴를 요청한 회원 본인에게, `target.id`는 탈퇴 요청 id. 유예 중 로그인하면 볼 수 있다 |

새 종류는 `NoticeEventType`에 추가하고 이 표도 같이 고친다.

## Core의 처리 규칙

- 같은 `eventId`는 한 번만 알림이 된다. 회원이 삭제한 알림도 다시 살아나지 않는다.
- 예외: `ai-tool` 분류는 같은 수신자·대상의 읽지 않은 알림이 있으면 새 알림 없이 그 알림에 묶는다: 시각을 올리고, 묶인 수를 하나 늘리고, 마지막 사건에 `detail`(대상 구절)이 있으면 이동 회차를 그 사건의 값으로, 요약을 "AI가 MCP로 「작품명」 3화 원고 외 2건을 수정했어요"(마지막 대상 외 묶인 수)로 바꾼다(#941). `detail`이 없는 사건은 수만 세고 요약·회차를 그대로 둔다(그동안은 "외 n건"이 실제보다 적을 수 있다). 묶은 사건의 `eventId`는 저장하지 않으므로 읽거나 삭제한 뒤 같은 사건이 다시 전달되면 새 알림이 생길 수 있다.
- 회원이 해당 분류 수신을 꺼 두었으면 알림을 만들지 않고 정상 처리(ack)한다.
- 없는 회원 대상 사건은 버리고 정상 처리한다.
- 형식·계약 위반은 재시도 없이 DLQ로 보낸다. DB 등 일시 오류는 3회 재시도 후 DLQ로 간다.
- 알림이 DB에 저장된 뒤에만 열려 있는 알림 스트림(SSE)에 변경 신호가 간다.
- 모바일 앱(`mobile/`, #943)은 웹을 WebView로 보이므로 이 SSE도 웹이 그대로 받는다(앱이 따로 연결하지 않는다). 앱 안에서 웹이 알림 목록을 읽을 때마다 앱에 알리는 방식은 아래 '모바일 앱 WebView 브리지 메시지'를 본다.
- 웹은 `ready`·`changed`를 받으면 알림을 다시 조회한다. 스트림 종료·유휴 타임아웃·연결 오류는 지수 백오프로 재연결하며, `ready` 뒤 20초 이상 지난 시점에도 데이터를 받으면 재시도 횟수를 초기화한다(#419).

## 모바일 앱 WebView 브리지 메시지

모바일 앱(`mobile/`, #943)은 웹을 WebView로 보이고 알림만 맡는다. 앱은 SSE에 연결하거나 Core API를 부르지 않고, 웹이 `window.ReactNativeWebView.postMessage(JSON 문자열)`로 보낸 메시지만 받는다. 웹은 앱 안에서만(`window.ReactNativeWebView`가 있을 때) 보내며 브라우저에서는 아무것도 바뀌지 않는다. 형식은 웹 `frontend/src/domain/entities/nativeBridge.ts`가 만들고 앱 `mobile/src/bridge.ts`가 zod로 검증하며 두 쪽의 시험이 같은 JSON을 쓴다. 형식을 바꾸면 이 표와 두 파일을 함께 고친다.

| type | 보내는 때 | 필드 |
| --- | --- | --- |
| `storyfork.notifications` | 로그인한 회원의 알림 목록 첫 쪽(`GET /api/v1/me/notifications`, 20개)을 읽은 직후: 로그인·세션 복구 직후와 알림 스트림 신호(`ready`·`changed`)마다. 새 요청 종류는 없고 웹의 기존 목록 조회(`ShellUseCase.listNotifications`)다 | `userId`(Core 회원 id), `items[]`: `id`·`kind`·`targetType`·`targetId`(없으면 `null`)·`summary`·`read`·`createdAt`(ISO 8601). 알림 API 응답의 항목과 같은 값이다 |
| `storyfork.logout` | 로그아웃하거나 로그인한 회원이 바뀔 때(계정 전환) | 없음 |

```json
{"type":"storyfork.notifications","userId":"00000000-0000-4000-8000-000000000001","items":[{"id":"…","kind":"credit","targetType":"credit-expiry","targetId":"2026-12-01","summary":"곧 소멸되는 크레딧이 있어요","read":false,"createdAt":"2026-11-26T04:14:26.947303Z"}]}
```

- 항목은 알림함의 `summary`뿐이고 비공개 원고 본문·개인정보는 싣지 않는다(알림 문구 규칙은 위와 같다). 앱은 정해진 필드만 쓰고 모르는 필드는 버리며, 형식이 다른 메시지나 `kind`를 모르는 항목이 든 메시지는 통째로 무시한다.
- 앱은 회원별 기준선(`id`+`createdAt`)을 메모리에만 둔다. 앱을 켠 뒤·로그아웃 뒤·다른 회원으로 바뀐 뒤 처음 받은 목록은 기준선만 만들고 알리지 않으며, 그다음 목록에서 기준선에 없던 읽지 않은 알림만 `expo-notifications` 로컬 알림(제목은 분류 이름, 본문은 `summary`)으로 띄운다. `ai-tool`은 같은 알림의 시각만 올라가므로 `createdAt`이 바뀌면 새 알림으로 본다. 알림 권한은 처음 알림 목록을 받을 때(로그인한 걸 안 뒤) 한 번 묻는다.
- 알림(로컬 알림·`xcrun simctl push` 알림)을 누르면 앱은 알림 데이터(`kind`·`targetType`·`targetId`)에서 웹 `noticeTarget`과 같은 규칙의 경로를 만들어 WebView를 같은 origin의 그 경로로 옮긴다(이동 대상이 없으면 옮기지 않는다). 원격 알림 payload는 expo-notifications 규칙대로 최상위 `body` 객체에 이 값들을 둔다.
- 앱을 내려 두면(백그라운드) 웹의 SSE도 멈춰 그동안은 알림이 오지 않는다. 돌아오면 웹이 SSE를 다시 연결하고(`ready`) 목록을 다시 읽어 보내므로 그동안 생긴 알림이 그때 로컬 알림이 된다(iOS 시뮬레이터에서 확인, 재연결은 웹의 유휴 감시 시간만큼 걸릴 수 있다). 앱을 완전히 종료했다가 다시 켠 경우에는 처음 받은 목록이 기준선이라 그동안 생긴 알림은 띄우지 않는다(웹 알림함·배지에는 그대로 있다). iOS APNs 원격 푸시는 이번 범위 밖이다(Android FCM은 별도).

## 발행 쪽 약속

- 사건은 업무 변경과 같은 트랜잭션에서 **발행하는 서비스 자신의** Outbox 테이블에 기록하고 별도 발행기가 브로커로 보낸다(변경은 됐는데 사건이 사라지는 일을 막는다). 재전송이 일어나므로 `eventId`는 Outbox 행에서 고정한다.
- Core가 만드는 사건은 Core의 `notification_outbox`(V11)를 쓴다. 사건을 만드는 코드는 업무 트랜잭션 안에서 `NoticeOutboxService.enqueue(type, recipientId, targetId)`만 호출한다(열린 트랜잭션이 없으면 예외).
  `NoticeOutboxRelay`가 2초마다 `sent_at`이 빈 행을 오래된 순으로(최대 50개) 발행하고 브로커 확인(publisher confirm)을 받은 행만 `sent_at`을 채운다.
  발행이 실패하면 Content와 같이 그 주기를 멈추고 다음 주기에 같은 `eventId`로 다시 보낸다. 실패는 브로커 장애이지 사건 하나의 문제가 아니므로 시도 횟수 한도를 두지 않는다(장애가 길어도 사건을 버리지 않는다).
  같은 사건이 두 번 나가도 위 `eventId` 규칙으로 알림은 한 건만 생긴다. 1차는 Core 한 대 기준이다.
  Core 사건은 `core.` 접두사를 쓴다(`core.credit.expiring`, `core.member.withdrawal-requested`). 정기 작업처럼 같은 사건을 여러 번 만들 수 있으면 `enqueueOnce`로 사건 id를 직접 정해 한 번만 기록한다.
- Content는 `content_event_outbox`(`id`=`eventId`)에 쓰고, 단일 인스턴스의 스케줄 발행기가 5초마다 `published_at`이 빈 행을 오래된 순으로 `storyfork.events`(routing key=`type`)에 보낸다. 보낸 행만 `published_at`을 채우고, 실패하면 그 주기를 멈춰 다음 주기에 같은 `eventId`로 다시 보낸다. Content는 교환기·큐를 선언하지 않는다. 교환기·큐·바인딩은 Core가 처음 연결할 때 선언하므로, Core가 한 번도 연결하지 않은 브로커로 보낸 사건은 어디에도 보관되지 않는다(발행기는 보낸 것으로 기록한다).
