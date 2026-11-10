# TASK 23 — 진행 기록·SSE·취소 계약

2026-11-10. B=`/api/v1/works/{workId}/ai`. Content가 소유하는 별도 Run 리소스이며 Core 회원 알림과 합치지 않는다.
실제 전문 Agent·후보/결과 본문 resolver·준비 transport는 TASK 22의 미연결을 유지한다.
이 문서는 진행/결정 기록 계약이며 실 모델 생성부터 화면 적용까지의 완료 선언이 아니다.

## 공개 경로

| 경로 | 동작 |
|---|---|
| `POST B/runs` | 기존 접수·Idempotency-Key 유지. `eventsUrl`, `lastEventId`, 선택 `result` 참조 추가 |
| `GET B/runs/{runId}` | SSE 없이 같은 Run의 최종 상태·오류·결과 참조 조회. active 상태만 기존 AI 상태를 재조회 |
| `GET B/runs/{runId}/events` | 인증된 fetch SSE. `Last-Event-ID` 또는 `?cursor` 이후 기록만 순서대로 반환. 실행을 생성하지 않음 |
| `POST B/runs/{runId}/cancel` | 기존 Bearer·CSRF 필요. body/새 멱등 키 없이 Run ID 자체로 멱등 취소. 이미 적용은 409 |

각 조회는 현재 회원·작품·Fork·thread 결합을 확인한다. 진행/결과에는 본문이 없으며 종료 후에는 적용으로 바뀐
기준 revision 때문에 영수증 참조 조회를 막지 않는다. active 상태의 일반 조회는 기존 manifest 검증을 유지한다.
취소는 현재 소유권으로 허용해 수동 편집으로 기준 판이 달라진 실행도 멈출 수 있다.
`result`는 `responseRef`, `proposalId`, `decisionId`, `applicationId`, `isMock`뿐이다.
후보 본문은 기존 proposal 판 조회를 사용하고, 답변 본문 resolver는 계속 미연결이다.

## 이벤트와 재연결

```text
id: 17
event: progress
data: {"runId":"example-run","seq":17,"taskId":"simulation","attempt":1,"phase":"task","step":2,"code":"SIMULATING","status":"succeeded","message":"인물의 행동을 시뮬레이션하고 있습니다."}
```

`phase`는 run/task, `taskId`는 결정적 계획이 만든 `[a-z][a-z0-9_-]{0,63}` 참조다.
모델이 Task 이름·진행 문구를 만들지 않는다. task의 attempt별 시작/종료 step은 1/2이며,
Content는 같은 task/attempt/phase의 중복·역순 step을 버린다. 독립 Task의 도착 순서는 보존한다.
run 상태 변화도 증가하는 step으로 기록하며 같은 상태의 반복 polling은 이벤트를 만들지 않는다.
DB는 `(run_id,seq)`와 `(run_id,task_id,attempt,phase,step)`를 각각 unique로 보장한다.

AI는 LangGraph 1.2.12의 custom writer로 고정 DTO만 출력한다. values는 그래프 결과 조립에만 사용하며,
messages/debug/LLM token/reasoning 모드는 구독하지 않는다. 내부 상태 응답의 `progress`에 안전한 이벤트를 담고
Content가 기존 상태 조회를 통해 받아 자기 transaction으로 영속화한다. AI custom stream을 공개 프록시하지 않는다.
모델 텍스트·원고·인용·grant·비밀은 이벤트 입력/저장/공개 DTO에 없다. 한국어 문구는 04 §14의 고정 표다.

초기 cursor는 0이다. 두 cursor가 다르거나 형식이 잘못됐거나 미래 번호이면 422다.
다음 기록이 cursor+1이 아니거나 배치 안에 gap이 있으면 410이며 **같은 run의 상태 GET**에서 `lastEventId`를
읽고 그 이후로 재연결한다. 새 `POST /runs`를 보내지 않는다. 배치당 100개를 읽는다.
소비자는 이미 본 seq 이하를 버리고 gap이면 마지막 연속 cursor로 다시 연결한다. UI 소비자 연결은 후속 범위다.

사용자 결정: **이벤트 자동 삭제 없음**. 없는 과거 기록의 410 경로만 구현한다. 보관 기간·삭제 작업은 추가하지 않는다.
SSE는 15초 heartbeat, 55초마다 정상 종료/재접속, servlet timeout 60초다.
개발·배포 nginx는 Content의 `X-Accel-Buffering: no`로 해당 SSE 응답의 buffering을 끈다.
별도 proxy cache는 없으며 idle timeout 90초보다 heartbeat가 짧다. 일반 작품 응답의 buffering 설정은 바꾸지 않는다.
현재 프로세스당 동시 스트림 8개이며 초과는 503 후 polling을 사용한다. 배치마다 현재 작품 인가를 재검증한다.
연결 단절은 취소가 아니며, 스트림만 닫힌다. 로그인 수명·로그아웃 AbortController는 후속 UI 소비자 책임이다.

## 원자 기록과 취소 경합

V19는 Content Run에 cursor/결과 참조/취소 전달 확인을 추가하고 진행 테이블을 만든다.
V1~V18과 Saver schema는 변경하지 않는다. 기존 작품 행 잠금 아래 Run 결과·terminal event가 같은 PG transaction으로
커밋된다. proposal 준비/결정도 기존 transaction 안에서 Run과 `PROPOSAL_PENDING`/`APPLIED` 등을 함께 기록한다.
둘째 원고 저장 실패 시 원고·영수증·결과 참조·terminal event가 모두 rollback된다.

취소도 같은 작품 잠금 아래 active/proposal→cancelled CAS로 결정한다. 승인 적용이 먼저 커밋됐으면 409,
취소가 먼저면 승인 writer의 기존 Scope 검사에서 409다. 취소 후 prepare와 늦은 polling 결과를 반영하지 않는다.
동시 상태 조회도 기준 `lastEventId`가 달라졌으면 늦은 응답을 버려 진행을 되돌리지 않는다.

Content는 취소를 먼저 커밋한 뒤 내부 취소를 전달한다. 재인가 응답의 `cancelled`는 Content가 확인한 상태이며
AI가 HITL 대기 취소에도 이 확정을 사용한다. 클라이언트가 임의로 이 플래그를 보내는 입력은 없다.
위임/통신 장애로 실행 중단 확인에 실패하면 **503**을 반환한다. 취소 상태는 유지하고 같은 Run 취소로 전달만
재시도한다. 확인 후의 반복 취소는 AI를 다시 호출하지 않는다. 5분 grant 만료 후의 갱신은 여전히 미지원이다.

AI는 예약 checkpoint 저장을 기다린 직후와 실제 모델 호출 직전에 취소를 재확인한다.
취소를 무시한 handler의 늦은 결과/이벤트를 버리고, 이미 applied인 AI 상태의 직접 취소도 409다.
승인 대기 중인 합성 FixtureGrant는 기존처럼 Content 결정 없이 내부 취소할 수 없다.

## 검증 한계

현재 RemoteGrant 실행은 전문 Agent 미연결로 `dependency_unavailable`이다. 실제 유료 모델 호출은 0회다.
AI 메모리의 미전송 진행 이력은 재시작으로 잃을 수 있다. 이미 Content에 커밋한 기록만 durable replay를 보장한다.
Content 자동 dispatcher/lease·AI 재시작 자동 복구·실제 원문 resolver·브라우저 UI·실 프록시 네트워크 검증은 추가하지 않았다.
[실행한 검증과 남은 조건](task23-handoff.md)을 따른다. TASK 24는 새 사용자 요청 전 시작하지 않는다.
