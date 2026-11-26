# 남이 바꾼 변경 알림·화면 자동 새로고침 계약 (#553)

[서비스 경계](service-boundaries.md) · [알림 사건 계약](../notification-event-contract.md) · [Content MCP 계약](content-mcp-contract.md)

원칙: **회원 자신이 화면에서 직접 바꾼 것은 알리지 않고, 다른 주체(AI·운영자)가 그 회원의 콘텐츠를 바꾸면 알린다**(2026-11-19 사용자).
지금 다른 주체의 쓰기 경로는 AI의 Content MCP 쓰기와 운영자 조치(작품 제한·해제, 댓글 숨김·해제) 두 가지다.

AI 에이전트(집필 AI 채팅 밖의 외부 MCP 클라이언트 포함)가 Content MCP로 내용·설정을 바꾸면 그 회원의 알림함에 "AI가 MCP로 수정했어요"가 남고,
그 대상을 열어 둔 화면은 다시 불러온다. 화면에서 직접 저장한 변경은 알리지 않는다(이미 화면에 반영돼 있다).

## 결정 (2026-11-19 사용자)

1. 보내는 주체는 서버 코드다. MCP 어댑터(`ai.storyfork.content.mcp`)의 쓰기 도구가 성공한 뒤 사건을 남긴다. 모델이 부르는 '새로고침 도구'는 두지 않는다.
2. 대상은 **내용이나 설정이 실제로 바뀌는 쓰기**뿐이다(아래 표). 조회·목록 도구와, 정본을 바꾸지 않는 쓰기(분석 요청·후보 결정·체크포인트·발행 예약·다른 작품에 보내는 제안)는 사건을 남기지 않는다.
3. 알림함에 남긴다. 새 분류 `ai-tool`("AI·외부 도구 변경", 끌 수 있음). 분류를 끈 회원에게는 알림도 새로고침 신호도 가지 않는다(Core는 알림을 저장한 뒤에만 신호를 보낸다).
4. 받은 화면은 지금 그 대상을 열고 있을 때만 다시 불러온다. 저장하지 않은 수정이 있으면 덮지 않고 "다른 곳에서 바뀌었어요 · 다시 불러오기" 배너를 띄운다.
5. 연속 저장은 Core가 묶는다: `ai-tool` 분류에 같은 대상의 **읽지 않은** 알림이 있으면 새 알림을 만들지 않고 그 알림의 시각(`createdAt`)만 지금으로 올린 뒤 신호를 보낸다.
   알림함 도배를 막으면서 저장마다 새로고침 신호는 그대로 간다.

## 사건 종류 (알림 사건 계약 schemaVersion 1에 추가)

| type | 알림 분류 | target.type | target.id | 문구(Core) |
| --- | --- | --- | --- | --- |
| `content.mcp.world-changed` | `ai-tool` | `world` | WorldStudio 세계관 id | AI가 MCP로 「세계관명」의 설정 카드 「카드명」을 수정했어요 |
| `content.mcp.work-changed` | `ai-tool` | `work` | 작품 id | AI가 MCP로 「작품명」 3화 원고를 수정했어요 |

- 문구는 사건의 선택 필드 `detail`(`title`·`episodeNumber`·`subject`)로 Core가 만든다(#941, [알림 사건 계약](../notification-event-contract.md#메시지-본문-json-utf-8)). `detail`이 없으면 이전 고정 문구("AI가 MCP로 작품을 수정했어요")다.

- 수신자(`recipientId`)는 그 콘텐츠의 주인(작가)이다. 대부분의 도구는 소유자만 성공하므로 호출자가 곧 주인이고, 운영자도 부를 수 있는 `work_notice_*`는 작품 소유자를 조회해 보낸다.
- 회차·플롯·작품 공지·작품에 딸린 설정 변경도 `work` 대상이다(묶음 단위는 작품). 회차 번호는 `detail.episodeNumber`에 실어 문구와 이동 회차에 쓴다(#941).
- 생성·삭제도 같은 두 종류다(작업 종류 필드를 두지 않는다). 생성은 새 id가 대상이고, 삭제된 대상을 열어 둔 화면은 다시 불러오면서 기존 '없음' 처리를 그대로 보인다.

## 운영자 조치 알림

| type | 알림 분류 | target.type | target.id | 수신자 | 문구(Core) |
| --- | --- | --- | --- | --- | --- |
| `content.operator.work-restricted` | `result`(처리 결과, 끌 수 없음) | `work` | 작품 id | 작품 소유자 | 운영자가 「작품명」 3화를 제한했어요 · 사유: 신고 사유 |
| `content.operator.work-unrestricted` | `result` | `work` | 작품 id | 작품 소유자 | 운영자가 「작품명」 3화 제한을 해제했어요 |
| `content.operator.world-restricted` | `result` | `world` | WorldStudio 세계관 id | 세계관 소유자 | 운영자가 「세계관명」 세계관을 제한했어요 · 사유: 신고 사유 |
| `content.operator.world-unrestricted` | `result` | `world` | WorldStudio 세계관 id | 세계관 소유자 | 운영자가 「세계관명」 세계관 제한을 해제했어요 |
| `content.operator.comment-hidden` | `result` | `work` | 댓글이 달린 작품 id | 댓글 작성자 | 운영자가 「작품명」 3화에 남긴 내 댓글을 숨겼어요 |
| `content.operator.comment-restored` | `result` | `work` | 댓글이 달린 작품 id | 댓글 작성자 | 운영자가 숨긴 「작품명」 3화의 내 댓글을 다시 게시했어요 |

- 문구 예시는 `detail`이 있을 때다(#941). 회차 단위 제한·댓글은 `detail.episodeNumber`, 작품 전체 제한은 회차 없이 "운영자가 「작품명」을 제한했어요"다. 사유는 있을 때만 붙인다(결정 2026-11-26: 운영자가 바로 제한하는 API에는 사유 입력이 없고, 신고 처리로 제한한 경우에만 신고 사유가 있다). `detail`이 없으면 이전 고정 문구다.
- 세계관 제한·해제 사건은 Core에 종류만 추가했고, Content 발행은 #941 후속 작업이다.

- Content 내부 API(`InternalWorkService.restrict`, `InternalCommentService.hide`·`restore`)가 **상태가 실제로 바뀔 때만**(멱등 재요청은 제외) 같은 트랜잭션에서 `content_event_outbox`에 쓴다.
- 운영자 알림은 묶지 않고(결정 5는 `ai-tool`만) 화면 자동 새로고침도 하지 않는다. 알림을 누르면 기존처럼 `/work/{id}`로 간다.

## Content: 사건을 남기는 도구

| 대상 | 도구 |
| --- | --- |
| `world` | `world_studio_create`·`world_studio_edit_draft`·`world_studio_save_revision`·`world_studio_update_publication`·`world_analysis_apply` |
| `work` | `work_create`·`work_update`·`work_delete`·`work_update_policy`·`work_link_world_studio`·`work_stop_fork_publication`·`work_fork_create`(새 Fork 작품)·`work_fork_world_change`·`work_notice_create`·`work_notice_update`·`work_notice_delete`·`work_proposal_accept`·`work_setting_draft`·`work_setting_commit`·`work_setting_revert` |
| `work` | `episode_create`·`episode_update_draft`·`episode_save_current_draft`·`episode_delete`·`episode_delete_draft`·`episode_version_save`·`episode_version_restore`·`episode_publish`·`episode_publish_current`·`episode_update_visibility`·`episode_world_basis_choose` |
| `work` | `story_plan_create`·`story_plan_update`·`story_plan_delete` |

사건을 남기지 않는 쓰기: `world_analysis_create`·`world_analysis_decide`·`world_checkpoint_create`·`episode_schedule_create`·`episode_schedule_update`·`episode_schedule_cancel`·`work_proposal_create`.

- 기록은 기존 `content_event_outbox`(`ContentEventOutboxEntity`·`ContentEventOutboxRepository`)에 한 행이다. 발행은 기존 `ContentEventOutboxPublisher`가 그대로 한다. 새 테이블·마이그레이션은 없다.
- 도구가 예외로 끝나면(검증 실패·409·404 등) 기록하지 않는다. 같은 key로 재시도해 이미 반영된 결과를 다시 받은 경우도 성공이므로 기록한다(Core 묶음 규칙으로 알림은 늘지 않는다).
- 집필 AI 채팅이 작가 승인 뒤 `episode_update_draft`로 반영하는 것도 MCP 쓰기라 사건이 남는다. 집필실은 채팅의 `applied` 신호로 이미 다시 불러오므로 같은 내용을 한 번 더 읽을 뿐이다.

## Core

- `NoticeKind.AI_TOOL("ai-tool", mutable = true)`, `NoticeEventType`에 위 두 종류와 운영자 조치 4종(`RESULT` 분류, #941에서 세계관 제한·해제 2종 추가)을 추가한다. 분류 칸은 `varchar(40)`이라 마이그레이션은 없다. 수신 설정 API는 분류 목록을 그대로 돌려주므로 새 분류가 자동으로 실린다.
- 묶음 규칙(결정 5)은 `ai-tool` 분류에만 적용한다. 묶은 사건의 `eventId`는 저장하지 않는다(알림 행의 `source_event_id`는 처음 사건 그대로). 묶을 때 `bundled_count`를 하나 늘리고, 그 사건에 `detail`이 있으면 이동 회차(`target_episode`)와 요약을 그 사건으로 바꾼다(V15, #941).

## Frontend

- 알림 분류 `ai-tool` 표시 이름은 "AI·외부 도구 변경". 알림 설정에 이 분류의 켬·끔을 둔다.
- 알림을 누르면 `ai-tool` + `world`는 `/worldstudio/{id}`, `ai-tool` + `work`는 `/studio/{id}`로 간다(다른 분류의 `work`는 기존대로 `/work/{id}`).
- 실서버 집필실(`/studio/{UUID}`)과 세계관 관리(`/worldstudio/:id`)는 알림 스트림 신호(`noticeVersion`)를 받을 때마다 최근 알림을 한 번 읽어,
  열린 대상과 같은 `ai-tool` 알림의 `createdAt`이 화면을 열 때(처음 읽은 값) 또는 마지막으로 처리한 값보다 뒤면 다시 불러온다(서버 시각끼리만 비교한다).
  저장하지 않은 수정이 있으면 다시 불러오지 않고 배너를 띄우며, 배너의 `다시 불러오기`는 확인 없이 서버 값으로 바꾼다.

## ponytail 한계

- 사건은 업무 트랜잭션 뒤 별도 저장이라 그 사이 장애가 나면 변경은 됐는데 알림이 빠질 수 있다. 업그레이드는 각 Service 트랜잭션 안에서 Outbox를 쓰는 것이다.
- 묶은 사건은 `eventId`를 남기지 않으므로, 이미 읽은 뒤 같은 사건이 브로커에서 다시 오면 새 알림이 하나 더 생길 수 있다.
- 화면은 신호마다 최근 알림 한 쪽(20개)만 본다. 그 사이 다른 알림이 20개 넘게 쌓이면 새로고침을 놓칠 수 있다.
- 묶음 요약은 마지막 대상과 묶인 수("외 n건")만 보인다. 묶인 사건 각각의 대상은 남기지 않는다(#941). `detail` 없는 사건이 마지막이면 "외 n건"이 실제보다 적다(발행자가 모두 `detail`을 보내면 생기지 않는다).
- 집필실 플롯 패널은 자동 새로고침에 넣지 않았다(패널 다시 읽기가 입력이 있으면 확인창을 띄운다). 플롯 변경은 패널의 '다시 불러오기'나 재진입으로 반영된다.
- 배너의 '다시 불러오기'는 확인 없이 저장하지 않은 수정을 버린다(문구로 경고하지 않는다).
