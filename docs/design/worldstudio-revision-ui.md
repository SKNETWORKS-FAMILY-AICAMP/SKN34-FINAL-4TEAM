# WorldStudio 확정 버전 UI — 8단계

## 기준과 의존성

#286 HEAD 354555b5e166f98768afb017640c56ed4f1e9060 위에 별도 Draft로 구성한다. #219/#225/#235/#262/#266/#270/#284/#285/#286은 미병합 의존성이다. 최신 develop b0398b691dd95c79ae04705aea386cf7bd8e2245를 대조했다. develop의 ad109bbc가 추가한 GET revisions 목록 계약/DTO/repository query만 가져오며 회차 기능이나 다른 변경은 이식하지 않는다. 기존 POST revisions, GET revisions/{id}, 6-B application 보호는 유지한다. 최종 통합 때 선행 PR과 develop을 반영해 diff/CI를 재검증한다.

## 동작

초안 저장(PUT draft), AI 승인(decisions), 초안 반영(applications), 명시적 확정(POST revisions), 작품 발행은 별개다. 확정은 세계관 카드/설정의 불변 버전을 생성하며 공개·발행하지 않는다. 같은 내용의 반복 확정도 사용자가 새 요청으로 실행하면 새 버전이다.

POST 요청은 expectedDraftRevision/key다. 계정/세계관별로 localStorage에 전송 전에 보존한다. 통신 실패/503에서 같은 key/입력을 재사용하며 재조회/재로그인 뒤에도 유지한다. POST 응답, 버전 상세, 최신 초안의 currentRevisionId/draftRevision, 버전 목록을 확인한 뒤 완료로 표시하고 요청 기록을 정리한다. 409/422 확정 거절은 PG save transaction이 완료되지 않은 명확한 거절이므로 기존 요청을 정리하고 최신 상태 확인 뒤 새 요청을 허용한다. 일반 draft 저장의 미확인 충돌 처리는 변경하지 않는다.

미저장 입력 또는 미확인 AI 요청이 있으면 새 확정을 제한하고 서버의 미완료 application 보호도 그대로 유지한다. 중복 클릭은 ViewModel 요청 ref, 탭 간 동시 전송은 기존 Web Locks로 차단한다. 화면 전환 시 요청을 취소하고 늦은 응답을 무시한다. 확정 뒤 초안 재조회와 AI 검토 화면 재진입 조회로 stale 상태를 확인한다.

## 과거 버전

목록은 revisionNo 내림차순이다. 상세는 saved card의 title/body/aliases/tags를 읽기 전용으로 표시한다. relationships=null/relationshipStatus=not_recorded만 허용하며 현재 Neo4j 관계를 합성하지 않는다. 복원 API/버튼은 제공하지 않는다. UUID/hash/draftRevision을 작가 기본 화면에 노출하지 않는다.

## 검증 및 한계

TDD HTTP 저장소의 미구현 메서드 실패 후 구현, 저장 응답 유실·재생성·키 보존·과거 관계 거부·stale 409 단위 검사. React 통합은 명시적 확정/초안 저장 분리, 미저장 차단, 재조회 실패 시 미확인 유지. 격리 HTTP 시스템에 AI 적용 후 최초 확정/같은 key 재전송/초안 수정/두 번째 확정/과거 버전 불변/재로그인/목록·상세/stale 검증을 추가한다.

실제 개발 DB·유료 모델·Neo4j 이력·Fork·MCP·복원 구현은 제외한다. 로컬 단위 검사 외 통합/시스템/빌드는 격리 CI에서 수행한다. 배포 서버에서의 실제 동작은 별도 검증이다.
