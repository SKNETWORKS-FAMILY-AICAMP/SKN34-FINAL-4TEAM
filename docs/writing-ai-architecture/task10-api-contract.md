# TASK 10 — 공개 Run 및 실제 위임 HTTP 계약

2026-11-09. 사용자 요청으로 TASK 10 범위를 **실제 grant·AI 전송 계약 확정 및 연결**까지 확장했다. Core 인증·Content 인가·JPA·기존 `/proposals` 및 `/accept`를 유지한다. 실제 전문 Agent·실 검색·유료 모델·승인·저장·SSE·자동 재개는 이 계약에 포함하지 않는다.

## 공개 경계

`B=/api/v1/works/{id}/ai`. Core가 확인한 Bearer 주체만 사용하며 회원 ID를 body로 받지 않는다. 변경 요청은 기존 CSRF 쿠키와 XOR 처리된 `X-CSRF-TOKEN`을 함께 보낸다.

| 경로 | 계약 |
|---|---|
| `POST B/runs` | `Idempotency-Key` 한 개(1~200자, 공백 없는 ASCII)와 아래 DTO. `202 {runId,threadId,workId,status,dispatchStatus,error?,statusUrl}`. 접수 후 실패도 실제 상태로 반환한다. |
| `GET B/runs/{runId}` | 매번 작품·주체·thread/Fork·현재 revision/문맥을 재인가. 실행이 접수됐으면 DB 잠금 밖에서 AI 상태를 조회하고 종료 상태를 보존한다. 원문·질문·grant를 반환하지 않는다. |
| `GET B/threads/{threadId}?cursor=0&limit=20` | 같은 주체·작품·Fork의 실행 참조 목록. cursor는 0부터 시작하는 페이지 번호, limit은 1~50. `{threadId,workId,forkId,runs,nextCursor}`. 대화 전문·요약·재개 기능은 없다. |

```json
{
  "threadId": null,
  "operation": "ask",
  "prompt": "이 회차의 사건을 확인해 주세요.",
  "target": {"basisEpisode": 1, "baseRevision": 0, "forkId": null, "character": ""},
  "options": {"modelConsent": {
    "providers": ["openai"], "purpose": "ask", "maxCalls": 1, "noticeVersion": "화면에서-확인한-안내-버전"
  }}
}
```

operation은 설계 04의 `ask/simulate/next_draft/next_insights/review/edit/expand_conti/world_plot_change/recommend_template/auto`만 받는다. 각 전문 Agent의 세부 작업 DTO와 출력은 아직 실행하지 않는다. target은 이번 단계에서 기존 ContextService가 지원하는 기준 회차·현재 작품 revision·Fork·인물 이름 범위만 사용한다. Fork 작품의 `forkId`는 해당 작품 자신의 ID이며 원작은 null이다. 잘못된 회차·동의·대상은 422, 현재 revision 불일치는 409다. 요청문은 최대 2,000자이며 서버의 인가·분류·승인 명령으로 취급하지 않는다.

동의는 OpenAI·같은 operation의 purpose·1~20회 maxCalls·비어 있지 않은 안내 버전을 요구한다. 구조가 유효해도 이번 Run 경로의 유료 호출은 0회다. 실제 모델 호출 전에는 화면 안내 버전 정본·과금·보관 정책을 추가 확정해야 한다. `ContextService`의 기존 최근 3화 발췌·인물별 설정 제한을 그대로 사용하며 전체 회차 coverage를 주장하지 않는다. 인물 범위에 허용된 설정 참조가 없으면 422로 중단한다.

Content는 기존 작품 행 잠금 안에서 `(subject,work,operation,SHA256(key))`를 조회한다. 받아들인 DTO의 정규 직렬화 SHA-256을 비교해 같은 요청이면 기존 run, 다른 요청이면 409다. 새 thread·ai_job·ai_run과 pending dispatch 의도를 한 트랜잭션으로 기록하고 커밋 뒤 외부 호출한다. DB unique와 thread당 pending/running 한 건의 부분 unique index를 함께 둔다. 재요청/상태 조회는 새 dispatch를 만들지 않는다.

기존 `ai_job.status`는 running/failed를 유지하고 `ai_run.status`를 pending/running/failed/denied로 분리한다. 이 단계의 실제 AI가 성공 결과를 만들지 않으므로 완료/제안 상태를 새 SQL에 선제 추가하지 않았다. request/문맥/키는 해시만 저장하고 허용 source tuple·동의 버전·예산·위임 만료를 보존한다. 원고·프롬프트 전문·실제 grant·서비스 비밀은 저장하지 않는다.

## 실제 내부 전송과 위임

Content → AI는 기존 TASK 09 `POST /internal/v1/ai/runs`와 상태 GET을 사용한다. body는 `runId/threadRef/grantRef/workId/forkId/basisEpisode/operation/targetRefs/budget`이며 `targetRefs`의 필드는 기존 `work_id/kind/document_id/revision`이다. 원고는 현재 draft/발행판의 논리 문서 및 버전 참조, 설정은 Content가 허용한 논리 항목/버전 참조로 고정한다. 참조는 Content 소유 해석이며 AI가 DB ID나 다른 작품의 판본을 추측해 조회할 수 없다. 허용 목록은 1~100개로 제한하고 초과/참조 누락은 422로 거부한다.

예산은 maxCalls와 기존 설계 상한(입력 48,000·출력 12,000·120,000ms)으로 만든다. AI는 원격 승인 결과만으로 실제 검색·Agent가 구성됐다고 판단하지 않는다. `isMock=false`인 실제 실행은 현재 `failed / dependency_unavailable`로 끝나고 Content는 이를 `AI_RUN_EXECUTOR_UNAVAILABLE`로 표시한다. 실제 장애를 FixtureContent/Mock 결과로 바꾸지 않는다. 기존 FixtureContent 경로와 합성 StateGraph 테스트는 별도로 유지한다.

`grantRef`는 Content 전용 `AI_RUN_GRANT_SECRET`으로 HMAC-SHA256 서명한다. domain·run·thread·주체·work·operation·request hash·scope hash·허용 참조·maxCalls·만료를 결합하고 5분 뒤 만료한다. DB에는 토큰이 아닌 서명 재생성에 필요한 참조/해시/만료만 둔다. 자동 갱신은 없다. 키 교체는 기존 위임을 무효화하며 AI에는 서명 키를 전달하지 않는다.

AI → Content는 **내부 읽기 전용** `POST /internal/v1/ai/runs/{runId}/verify`로 같은 DTO를 보낸다. Content의 좁은 보안 체인이 `X-Internal-Token`을 먼저 확인하고 업무 Service가 서명·만료·모든 DTO 바인딩·현재 owner/Fork·revision·문맥 해시를 다시 검사한다. `{runId,threadRef,scopeRef,expiresAt}`만 반환하며 원문 읽기·쓰기·승인을 노출하지 않는다. 서비스 토큰만으로 특정 작품을 임의 조회하거나 Scope를 만들 수 없다. 공개 CSRF 예외를 넓히지 않는다.

양쪽 HTTP는 redirect·애플리케이션 재시도를 사용하지 않고 timeout을 둔다. Python은 표준 urllib로 환경 proxy를 사용하지 않고 응답을 16KiB로 제한한다. Content의 HTTP 상태 조회/dispatch 동안 DB 트랜잭션·작품 잠금을 유지하지 않는다. 늦은 pending 응답이 이미 종료된 상태를 되돌리지 않아야 한다.

## 오류·설정·한계

| 조건 | 결과 |
|---|---|
| 미인증·권한 밖 객체·CSRF 실패 | 기존 401/404/403. POST도 유효한 CSRF를 갖춘 미인증 요청은 401이며 CSRF 자체 누락은 기존 403이다. |
| 멱등 충돌·thread 활성 실행·stale revision/문맥 | 409. 기존 실행/원고를 덮어쓰지 않는다. |
| 잘못된 범위·동의·입력 | 422. 외부 AI 호출 0회. |
| 내부 위임 위조/만료/타 work/Fork/target/budget | Content 403 또는 현재 문맥 충돌 409, AI는 invalid_scope 거부. |
| 접수 뒤 설정/연결/timeout/거절/실행기 미연결 | 공개 상태 failed 또는 denied, `AI_RUN_UNCONFIGURED/UNAVAILABLE/TIMEOUT/REFUSED/GRANT_EXPIRED/INVALID_RESPONSE/EXECUTOR_UNAVAILABLE`. 원본 오류/토큰은 노출하지 않는다. |

루트 `.env.example`의 `INTERNAL_TOKEN`은 Content와 AI에 같은 무작위 32자 이상을 설정한다. `AI_RUN_GRANT_SECRET`은 별도의 32자 이상 값으로 Content에만 주입한다. 네이티브 AI의 `CONTENT_AI_RUN_BASE_URL`은 Content origin, Compose에서는 `http://content-service:8081`이다. 키가 없으면 dispatch가 명시적으로 차단되며 자동 개발 키를 발급하지 않는다. 실제 `.env`는 변경하지 않았다.

V32(초기 미병합 V17을 develop V31 이후로 재번호)는 신규 마이그레이션 소스만 작성했다. 기존 Flyway SQL·체크섬을 변경하거나 실제 운영 DB에 적용하지 않았다. 기존 ai_job의 참조/삭제 정책을 유지하므로 실패한 run도 업무 이력으로 남고 작품 삭제가 참조 때문에 거부될 수 있다. 실제 사용 전 보존/정리 정책은 별도 결정이 필요하다.

Content 접수·의도는 영속하지만 자동 dispatcher/재전송·장애 재개는 없다. 커밋 직후 프로세스가 죽으면 pending 의도가 남는다. 원문/프롬프트의 보호된 durable payload 저장도 미구현이므로 실제 전문 Agent 연결 전에 안전한 payload 참조 계약이 필요하다. AI claim/상태는 TASK 09의 단일 프로세스 메모리이며 여러 worker·재시작을 넘어선 중복 실행 보장은 없다. 이번 연결에서 그 한계를 숨기거나 실제 모델을 연결하지 않는다.

MCP의 실제 원고/세계관 읽기 도구(#163), 승인/reject/revise, SSE, 사용자 UI, 정본 적용은 별도 단계다. 이 단계에서 해당 경로를 등록하지 않으며 안전한 404로 남긴다. [실행한 검증 및 인수 기록](task10-handoff.md).
