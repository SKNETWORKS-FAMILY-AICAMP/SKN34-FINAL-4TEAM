# TASK 22 — 승인·중단·재개 계약

2026-11-10. Content의 TASK 17 준비/결정/영수증과 TASK 21 Saver를 재사용한다.
사용자 결정으로 **재수정은 revision_requested 영수증 반환까지** 구현한다. 새 run/판 자동 생성은 하지 않는다.
아래 공개 경로는 구현됐으며 실제 AI 후보의 Content 준비 전송·원고/결과 resolver는 여전히 미연결이다.
Main의 현재 검색 경로는 Mock 전용이며 Mock 제안을 실제 Content 원고에 적용하지 않는다.

## Content 공개 경로

`B=/api/v1/works/{workId}/ai`. 기존 Bearer·CSRF·소유권·Fork 검사와 Content transaction을 재사용한다.

| 경로 | 요청·응답 |
|---|---|
| GET B/proposals/{pid}?version=N | 기존 ChangeSetResponse. 현재/보존된 불변 판·hash·상태·허용 필드 |
| POST B/proposals/{pid}/approve | 명시적 판·hash·전체 baseVersions와 Idempotency-Key → 200 ChangeReceipt |
| POST B/proposals/{pid}/reject | 같은 고정 입력 → 200 rejected 영수증, 원고 무변경 |
| POST B/proposals/{pid}/revise | 같은 고정 입력 → 200 revision_requested 영수증, 원고 무변경 |

```json
{
  "proposalVersion": 1,
  "proposalHash": "64자리 SHA-256",
  "baseVersions": [{"targetId": "Content 대상 ID", "baseVersion": 3}]
}
```

새 회차 create의 baseVersion은 null이다. 경로가 approved/rejected/revision_requested를 정하며
클라이언트가 변경 payload·저장 필드·자연어 결정을 지정하지 않는다. 재수정 instruction/자동 생성은 지원하지 않는다.
취소는 기존 `/change-proposals/{pid}/decisions`의 decision=cancelled를 사용한다.
영수증 재조회도 기존 `GET /change-proposals/{pid}/versions/{N}/receipt`를 사용한다.
기존 `/proposals/{pid}/accept`와 `/change-proposals` 경로·JSON은 유지한다.

새 action은 전체 대상 ID·baseVersion 목록을 고정 manifest와 대조한다. 누락/중복/추가/다른 판은 409다.
입력 목록의 순서도 멱등 payload의 일부다. 같은 key/payload는 현재 소유권 확인 후 같은 영수증이며,
같은 key/다른 payload는 409다. 다른 키의 같은 판 최종 결정은 unique와 작품 잠금으로 한 건만 성공한다.
알려진 제안의 없는/이전 판은 409, 소유 범위 밖 또는 모르는 제안은 404다.
알려진 판 충돌도 실패 시도로 기록해 그 키를 다른 승인에 재사용하지 못한다.

원고/근거 hash·UTF-16 span·현재 권한/원본/작품·Fork와 모든 대상은 기존 writer에서 첫 쓰기 전에 재검증한다.
PG 원고 저장·결정·영수증은 같은 transaction이며 둘째 대상 실패 시 전부 rollback한다.
설정/플롯·Neo4j 혼합 writer는 추가하지 않았다. Mock 플래그나 Mock 근거가 하나라도 있으면 실제 승인을 거부한다.
새 migration은 없고 V1~V18과 기존 불변 trigger/unique/이력을 유지한다.
기존 ChangeDecisionRequest에 baseVersions가 없으면 해당 JSON 필드를 생략해 과거 requestHash의 바이트를 유지한다.

## AI의 준비와 읽기 전용 중단

서버가 MainGraph에 선택적으로 ApprovalCoordinator를 주입한다. 다음 함수는 신뢰된 Content seam이어야 한다.

| 주입 함수 | 책임 |
|---|---|
| prepare(scope,run_id,thread_id,task_id,output_ref,is_mock,key) | 소유한 후보 참조를 해석·검증해 Content 내부 prepare에 멱등 등록 |
| read(scope,proposal) | 현재 권한과 정확한 불변 판/해시·run/task/후보 참조를 재확인 |
| receipt(scope,proposal) | 현재 권한으로 커밋된 ChangeReceipt만 반환. 미결정만 None, 장애/거부는 오류 |

prepare key는 SHA-256(run_id:task_id)다. 원문·grant·provider key를 key나 checkpoint에 넣지 않는다.
준비 DTO는 proposalId/version/hash, run/thread/task, scope digest, output ref, 전체 기준 판, is_mock만 담는다.
task 결과의 Mock 표시를 real로 바꾸면 준비를 거부한다. **실제 Content 준비 HTTP adapter나 후보 resolver를
구현한 것은 아니다.** 모델/공개 요청에서 이 함수를 조립하거나 real 표시를 지정하는 준비 endpoint도 없다.

prepare는 모델 Task와 비용 실행이 끝난 다음, 별도 proposal 노드에서 수행한다.
그 다음 await_decision 노드는 현재 판 조회→interrupt→결정 참조로 영수증 조회만 한다.
노드가 재실행돼도 준비/모델/원고 쓰기를 실행하지 않는다. 실제 적용은 사용자 Content 결정 API에서만 일어난다.
준비 commit 후 checkpoint 전 중단은 같은 key로 재등록해 같은 판을 받는다.
interrupt 저장 직후에도 영수증을 조회하므로 일찍 도착한 결정을 callback 없이 발견한다.
GraphInterrupt는 정상 중단으로 전달하고 LangGraph 반환의 __interrupt__ envelope만 업무 상태에서 분리한다.
다른 노드 예외는 기존 graph_node_failed로 바꿔 자동 ERROR write에 원문이 저장되지 않게 한다.

## 재개와 충돌

`POST /internal/v1/ai/runs/{runId}/resume`는 기존 X-Internal-Token·X-Grant-Ref·X-Thread-Ref를 요구한다.

```json
{"decision_ref":"Content decisionId","interrupt_ref":"현재 대기의 interrupt ID"}
```

decision_ref는 필수이고 interrupt_ref는 선택적 추가 대조다. 둘 다 원문이 아닌 제한된 참조다.
현재 단일 interrupt ID와 제안 판/hash·actor·전체 before/after 결과 버전을 대조한 뒤
`Command(resume={interruptId: decisionId})`를 사용한다. 임의 state update나 변경 payload는 입력받지 않는다.
직접 호출은 MainGraph.run(original_request,resume=True,decision_ref=...,interrupt_ref=...)다.
신호가 유실됐으면 resume=True의 읽기 전용 영수증 확인으로도 수렴한다.

같은 종료 신호는 같은 결과를 반환한다. 잘못된 ID/판·미커밋 신호는 409이며 기존 Run 결과를 덮어쓰지 않는다.
현재 인가 거부는 403, 필수 의존 장애/재개 시간 초과는 503이다. 기존 요청의 timeout 한도를 재사용한다.
긴 사용자 대기에서 모델 Task/deadline을 다시 실행하거나 새 비용을 예약하지 않는다.
커밋한 승인으로 manifest가 바뀌어도 현재 인가와 정확한 Content 영수증이 확인되면 완료 상태로 수렴한다.
이 경로에서는 오래된 검색/원문 인용을 재사용하지 않고 영수증만 반환한다.

상태는 awaiting_approval → applied/rejected/revision_requested/cancelled다.
GraphResponse에는 사용자가 필요한 proposalId/version/hash·interrupt ref와 검증한 receipt만 추가한다.
승인 준비 시작 이후 내부 `/cancel`은 409 decision_requires_content로 차단한다. 이 시점부터 취소도
Content 최종 결정으로 직렬화해야 하며, 준비 전 생성 취소는 기존 동작을 유지한다.
awaiting_approval 동안 같은 thread에 새 메모리 Run을 접수하지 않는다.

## 검증 경계·미연결

AI의 실제 LangGraph/PG interrupt·HTTP는 Content 대역으로 검증했다. 실제 Content PG transaction의
정확히 한 번 적용·동시 결정·다중 대상 rollback은 Kotlin 테스트에서 별도로 검증했다.
비 Mock 영수증 소비의 PG Graph 시험도 Content가 소유한 합성 정본 계약 자료이며 실제 생성물이 아니다.
현재 Main의 Mock 후보를 real로 승격하거나 양 서비스의 실 AI 생성→Content 적용 E2E를 검증한 것이 아니다.

RemoteGrant 전문 Agent·준비 전송·후보/결과 resolver·Content 자동 재전달은 계속 미연결이다.
기존 Content 공개 Run의 상태 제약과 real 응답 검증을 바꾸지 않았으며 실제 요청은 dependency_unavailable다.
오래된 grant 갱신·안정된 인가 binding, 보존/삭제/암호화·운영 배치는 TASK 21의 미결을 유지한다.
TASK 20 설정/플롯 실제 적용과 TASK 23 이후는 진행하지 않는다. [수용 결과·남은 조건](task22-handoff.md).
