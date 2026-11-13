# 콘텐츠 MCP 창구 계약 (#163)

[결정 목록](decisions.md#결정-목록) DEC-49 · [서비스 경계](service-boundaries.md)

## 목적과 범위

AI가 사용자가 프론트에서 할 수 있는 세계관·작품·회차 작업을 똑같이 하도록, Content 서비스 안에 MCP(Model Context Protocol) 서버 창구를 둔다.
창구는 `ai.storyfork.content.mcp` 패키지 하나이며 기존 기능 패키지의 Service 함수를 그대로 호출하는 어댑터다. 새 비즈니스 로직·인가 규칙·저장소는 두지 않는다.

- 이번 범위: Content MCP 서버와 도구. ai-service 연결은 아래 [집필 AI 연결](#집필-ai-연결)만 있다.
- 제외: 댓글·좋아요·관심·독서 기록·조회수·피드백 신고·문장 수정 제안(독자 피드백 계열), 파일 업로드·다운로드(작품·세계관 표지, 회차 이미지, 설정 첨부, 원고 가져오기·내보내기), `Internal*` 내부 API.

## 전송·인증

| 항목 | 계약 |
|---|---|
| 라이브러리 | Spring AI MCP Server(`spring-ai-starter-mcp-server-webmvc`, 공식 MCP Java SDK 기반). 도구는 `@McpTool` |
| 전송 | Stateless Streamable HTTP, 경로 `/mcp`. 공개 진입점(Nginx)에 노출하지 않는 내부 전용 |
| 공개 도구 | 인증 없이 호출된다. 대응 Controller가 쓰는 공개 조회 Service 함수(공개 작품·발행 회차·공개 카드 필터 포함)를 그대로 쓴다 |
| 사용자 도구 | AI를 호출한 사용자의 `Authorization: Bearer <토큰>`을 그대로 전달받는다. 기존 `ContentAuthenticationFilter`(Core 검증)가 만든 회원 UUID·운영자 권한을 owner로 Service에 넘긴다. 토큰이 없으면 도구 오류(인증 필요)다 |
| 신뢰 경계 | 회원 ID는 검증된 토큰에서만 얻는다. 도구 인자로 회원 ID를 받지 않으며 모델이 준 작품·세계관 ID는 Service의 소유권 검사를 거친다 |
| CSRF | 브라우저 쿠키가 아닌 Bearer 서비스 간 호출이라 `/mcp` 체인에서만 끈다. 기존 `/api/v1/**` CSRF는 그대로다 |
| 오류 | Service 예외는 성공으로 바꾸지 않고 도구 오류(`isError`)로 반환한다. 기존 HTTP 상태·코드·`detail`을 메시지에 담는다. 입력·원고 본문을 오류·로그에 넣지 않는다 |

## 도구 목록

이름은 `<영역>_<동작>`이다. 각 도구는 표의 기존 API와 같은 Service 함수·입력 DTO·응답 DTO를 쓴다(공개=인증 없음).

### 작품

| 도구 | 기존 API |
|---|---|
| `work_list_mine` | `GET /api/v1/works` |
| `work_create` | `POST /api/v1/works` |
| `work_read` | `GET /api/v1/works/{id}` |
| `work_update` | `PUT /api/v1/works/{id}` |
| `work_delete` | `DELETE /api/v1/works/{id}` |
| `work_stop_fork_publication` | `DELETE /api/v1/works/{id}/fork-publication` |
| `work_history` | `GET /api/v1/works/{id}/history` |
| `work_update_policy` | `PUT /api/v1/works/{id}/policy` |
| `work_public_list` (공개) | `GET /api/v1/public/works` |
| `work_public_ranking` (공개) | `GET /api/v1/public/works/ranking` |
| `work_public_rankings` (공개) | `GET /api/v1/public/works/rankings` |
| `work_public_read` (공개) | `GET /api/v1/public/works/{id}` |
| `work_link_world_studio` | `PUT /api/v1/works/{id}/world-studio` |
| `work_public_world_cards` (공개) | `GET /api/v1/public/works/{id}/world-cards` |
| `work_notice_public_list` (공개) | `GET /api/v1/public/works/{id}/notices` |
| `work_notice_create` | `POST /api/v1/works/{id}/notices` |
| `work_notice_update` | `PUT /api/v1/works/{id}/notices/{noticeId}` |
| `work_notice_delete` | `DELETE /api/v1/works/{id}/notices/{noticeId}` |
| `work_fork_create` | `POST /api/v1/works/{id}/forks` |
| `work_fork_world_change` | `POST /api/v1/works/{id}/world/changes` |
| `work_context_read` | `GET /api/v1/works/{id}/context` |
| `work_context_public_read` (공개) | `GET /api/v1/public/works/{id}/context` |
| `work_proposal_create` | `POST /api/v1/works/{id}/proposals` |
| `work_proposal_accept` | `POST /api/v1/works/{id}/proposals/{pid}/accept` |
| `story_plan_list` | `GET /api/v1/works/{workId}/story-plans` |
| `story_plan_read` | `GET /api/v1/works/{workId}/story-plans/{id}` |
| `story_plan_create` | `POST /api/v1/works/{workId}/story-plans` |
| `story_plan_update` | `PUT /api/v1/works/{workId}/story-plans/{id}` |
| `story_plan_delete` | `DELETE /api/v1/works/{workId}/story-plans/{id}` |

### 회차

| 도구 | 기존 API |
|---|---|
| `episode_list` | `GET /api/v1/works/{id}/episodes` |
| `episode_create` | `POST /api/v1/works/{id}/episodes` |
| `episode_read` | `GET /api/v1/works/{id}/episodes/{number}` |
| `episode_update_draft` | `PUT /api/v1/works/{id}/episodes/{number}/draft` |
| `episode_order_scope` | `GET /api/v1/works/{id}/episodes/{number}/order-scope` |
| `episode_delete_draft` | `DELETE /api/v1/works/{id}/episodes/{number}/draft` |
| `episode_delete` | `DELETE /api/v1/works/{id}/episodes/{number}` |
| `episode_world_basis_read` | `GET /api/v1/works/{id}/episodes/{number}/world-basis` |
| `episode_world_basis_choose` | `PUT /api/v1/works/{id}/episodes/{number}/world-basis` |
| `episode_version_save` | `POST /api/v1/works/{id}/episodes/{number}/versions` |
| `episode_version_restore` | `POST /api/v1/works/{id}/episodes/{number}/restore` |
| `episode_save_current_draft` | `PUT /api/v1/works/{id}/draft` |
| `episode_publish` | `POST /api/v1/works/{id}/episodes/{number}/publish` |
| `episode_update_visibility` | `PUT /api/v1/works/{id}/episodes/{number}/visibility` |
| `episode_publish_current` | `POST /api/v1/works/{id}/publish` |
| `episode_schedule_list` | `GET …/episodes/{number}/publication-schedules` |
| `episode_schedule_create` | `POST …/episodes/{number}/publication-schedules` |
| `episode_schedule_update` | `PUT …/publication-schedules/{scheduleId}` |
| `episode_schedule_cancel` | `DELETE …/publication-schedules/{scheduleId}` |

### 세계관

| 도구 | 기존 API |
|---|---|
| `work_world_read` | `GET /api/v1/works/{id}/world` |
| `work_world_public_read` (공개) | `GET /api/v1/public/works/{id}/world` |
| `work_setting_draft` | `PUT /api/v1/works/{id}/settings/{sid}/draft` |
| `work_setting_commit` | `POST /api/v1/works/{id}/settings/{sid}/commit` |
| `work_setting_revert` | `POST /api/v1/works/{id}/settings/{sid}/revert` |
| `world_checkpoint_create` | `POST /api/v1/works/{id}/world/checkpoints` |
| `world_checkpoint_list` | `GET /api/v1/works/{id}/world/checkpoints` |
| `world_checkpoint_read` | `GET /api/v1/works/{id}/world/checkpoints/{checkpointId}` |
| `world_studio_list` | `GET /api/v1/world-studios` |
| `world_studio_create` | `POST /api/v1/world-studios` |
| `world_studio_read` | `GET /api/v1/world-studios/{id}` |
| `world_studio_edit_draft` | `PUT /api/v1/world-studios/{id}/draft` |
| `world_studio_save_revision` | `POST /api/v1/world-studios/{id}/revisions` |
| `world_studio_update_publication` | `PUT /api/v1/world-studios/{id}/publication` |
| `world_studio_revisions` | `GET /api/v1/world-studios/{id}/revisions` |
| `world_studio_revision_read` | `GET /api/v1/world-studios/{id}/revisions/{revisionId}` |
| `world_studio_public_list` (공개) | `GET /api/v1/public/world-studios` |
| `world_studio_public_read` (공개) | `GET /api/v1/public/world-studios/{id}` |
| `world_analysis_create` | `POST /api/v1/world-studios/{worldId}/analyses` |
| `world_analysis_list` | `GET /api/v1/world-studios/{worldId}/analyses` |
| `world_analysis_read` | `GET …/analyses/{analysisId}` |
| `world_analysis_candidates` | `GET …/analyses/{analysisId}/candidates` |
| `world_analysis_decide` | `POST …/candidates/{candidateId}/decisions` |
| `world_analysis_apply` | `POST …/analyses/{analysisId}/applications` |
| `world_analysis_application_read` | `GET …/applications/{applicationId}` |

`world_studio_read`·`world_studio_edit_draft`는 선택 인자 `episode`(관계의 회차 시점, 1 이상, 생략하면 최신 회차, [DEC-51](worldstudio-independent-schema.md#회차별-관계--dec-51))를 받는다. `world_studio_read`는 HTTP `?episode=`처럼 문자열로 받아 값 오류를 422로 낸다. 설정(카드) 삭제는 `episode`를 생략한 편집에서만 허용되며 지정하면 422다.

## 오류 형식

- 도구 오류 텍스트는 첫 줄 `HTTP <상태>[ <코드>]`, 둘째 줄 detail이다. `ContentFailure`·`CoreAuthException`·WorldStudio 예외는 기존 HTTP API와 같은 상태·코드로 옮기고, 그 밖의 예외는 내용 없이 `HTTP 500`이다.
- Controller의 `@Valid` 검사는 도구에서 `validated()`로 같은 422를 낸다. UUID 형식 오류는 400이다.
- `world_analysis_create`는 실행 상태 `failed`를 502, `unknown`을 503 도구 오류로 낸다(HTTP API가 본문과 함께 같은 상태로 답하는 경우). `world_analysis_apply`의 `failed`·`unknown`은 503이다.
- 본문 없는 성공(204)은 Spring AI 기본 완료 문구(`Done`)다. `Location`·`Retry-After` 같은 응답 헤더는 전달하지 않는다.

## 집필 AI 연결

ai-service `app/content_mcp/`가 `openai-agents`의 `MCPServerStreamableHttp`로 `{CONTENT_SERVICE_BASE_URL}/mcp`를 호출한다(2026-11-13 사용자 결정).

| 항목 | 계약 |
|---|---|
| 호출 시점 | 집필 AI 대화에서 Writing & Editing 결과를 작가가 resume으로 승인했을 때만. 승인 전·거절·대화 밖 요청은 호출하지 않는다 |
| 도구 | `episode_read`(최신 초안·revision) → `episode_update_draft`. 버전 저장·발행·삭제 등 그 밖의 도구는 부르지 않는다 |
| 대상 | Content `WritingAiService`가 새 턴에 보낸 `target {workId, episode}`. 모델이 만든 ID는 쓰지 않는다 |
| 토큰 | Content가 작가의 `Authorization`을 AI에 `X-User-Authorization`으로 넘기고, AI는 그 요청의 MCP 호출에만 쓴다. 그래프 상태·체크포인트·추적에 넣지 않는다. resume 요청마다 새 토큰을 쓴다 |
| 반영 | Text는 기존 초안 뒤에 잇고, Patch는 선택 문장이 초안에 정확히 한 번 있을 때만 바꾼다(없거나 여러 곳이면 쓰지 않고 409) |
| 오류 | 도구 오류의 401·403·404·409·422는 Content detail 그대로, 그 밖은 502, 연결 실패는 503으로 Writing 단계를 실패시킨다 |

## 한계

- JSON 타입이 틀린 인자처럼 도구 함수에 들어오기 전 실패는 Spring AI 기본 오류 문구로 나가며 HTTP 상태 줄이 없고, 호출자가 보낸 값 조각이 되돌아갈 수 있다(입력 스키마 검증이 먼저 막는 경우가 대부분).

- 사용자 권한 그대로 정본을 바꾸므로 삭제·발행도 즉시 반영된다. 화면 확인 단계는 두지 않는다(시연 범위).
- 사용자 토큰이 AI 작업 중 만료되면 도구가 인증 오류를 낸다. 갱신은 호출 측(ai-service) 몫이다. 회차 원고 전처리(DEC-50)의 백그라운드 적재 인증과 사건·기억·회차별 상태 적재 도구는 [전처리 계약](manuscript-preprocessing-contract.md#전처리-mcp-도구-content-jobid-인증)의 `jobId` 인증 도구로 정했다(미구현).
- 기존 API가 바뀌면 같은 작업에서 도구도 맞춘다.
