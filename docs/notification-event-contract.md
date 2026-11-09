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
  "type": "content.world.changed",
  "occurredAt": "2026-11-05T06:15:08Z",
  "recipientId": "<알림을 받을 회원 UUID>",
  "target": { "type": "work", "id": "<작품 id>" }
}
```

- `schemaVersion`: 정수 1만 받는다. 호환되지 않게 바뀌면 올린다.
- `eventId`: 사건마다 고유한 UUID. **같은 사건을 다시 보낼 때는 같은 값**을 쓴다. Core는 이 값으로 중복을 한 번만 반영한다.
- `type`: 아래 표의 값. 알 수 없는 값은 DLQ로 간다.
- `occurredAt`: 발생 시각(ISO-8601 UTC). 알림 정렬은 Core가 저장한 시각을 쓴다.
- `recipientId`: 받는 회원 한 명. 여러 명에게 보낼 때는 회원마다 별도 메시지(고유 `eventId`)를 발행한다.
- `target`: 사건 종류가 요구하는 대상. `type`이 표와 같아야 하고 `id`는 1~100자.
- 알림 문구는 Core가 사건 종류별로 정한다. 메시지에 개인 정보·본문 내용을 넣지 않는다.

## 사건 종류

| type | 알림 분류 | target.type | 비고 |
| --- | --- | --- | --- |
| `content.world.changed` | 읽기(끌 수 있음) | `work` | 후보. 수신자 결정 규칙은 Content 쪽 확인 필요 |

새 종류는 `NoticeEventType`에 추가하고 이 표도 같이 고친다.

## Core의 처리 규칙

- 같은 `eventId`는 한 번만 알림이 된다. 회원이 삭제한 알림도 다시 살아나지 않는다.
- 회원이 해당 분류 수신을 꺼 두었으면 알림을 만들지 않고 정상 처리(ack)한다.
- 없는 회원 대상 사건은 버리고 정상 처리한다.
- 형식·계약 위반은 재시도 없이 DLQ로 보낸다. DB 등 일시 오류는 3회 재시도 후 DLQ로 간다.
- 알림이 DB에 저장된 뒤에만 열려 있는 알림 스트림(SSE)에 변경 신호가 간다.

## 발행 쪽 약속

- 사건은 업무 변경과 같은 트랜잭션에서 Outbox 테이블에 기록하고 별도 발행기가 브로커로 보낸다(변경은 됐는데 사건이 사라지는 일을 막는다). 재전송이 일어나므로 `eventId`는 Outbox 행에서 고정한다.
