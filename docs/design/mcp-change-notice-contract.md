# MCP 변경 알림·화면 자동 새로고침 계약 (#553)

[서비스 경계](service-boundaries.md) · [알림 사건 계약](../notification-event-contract.md) · [Content MCP 계약](content-mcp-contract.md)

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
| `content.mcp.world-changed` | `ai-tool` | `world` | WorldStudio 세계관 id | AI가 MCP로 세계관을 수정했어요 |
| `content.mcp.work-changed` | `ai-tool` | `work` | 작품 id | AI가 MCP로 작품을 수정했어요 |

- 수신자(`recipientId`)는 MCP 도구를 부른 회원(`callerUuid()`)이다. 이 도구들은 모두 소유자만 성공하므로 곧 그 대상의 작가 본인이다.
- 회차·플롯·작품 공지·작품에 딸린 설정 변경도 `work` 대상이다. 집필실은 작품 단위로 열리므로 회차 번호는 싣지 않는다.
- 생성·삭제도 같은 두 종류다(작업 종류 필드를 두지 않는다). 생성은 새 id가 대상이고, 삭제된 대상을 열어 둔 화면은 다시 불러오면서 기존 '없음' 처리를 그대로 보인다.

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

- `NoticeKind.AI_TOOL("ai-tool", mutable = true)`, `NoticeEventType`에 위 두 종류를 추가한다. 분류 칸은 `varchar(40)`이라 마이그레이션은 없다. 수신 설정 API는 분류 목록을 그대로 돌려주므로 새 분류가 자동으로 실린다.
- 묶음 규칙(결정 5)은 `ai-tool` 분류에만 적용한다. 묶은 사건의 `eventId`는 저장하지 않는다(알림 행의 `source_event_id`는 처음 사건 그대로).

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
- 묶음 뒤 알림 시각만 바뀌므로 알림함에서 '몇 번 바뀌었는지'는 보이지 않는다.
