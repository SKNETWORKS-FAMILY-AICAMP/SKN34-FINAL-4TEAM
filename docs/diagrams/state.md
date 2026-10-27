# STORYFORK 상태 다이어그램
> [다이어그램 목차](./README.md) · [유스케이스 문서](../usecase.md) · [명세 0.4 처리 상태 이름](../usecase-spec/README.md#04-처리-상태-이름)
유스케이스 명세에서 쓰는 처리 상태와 그 전이를 정리합니다. 상태 이름은 명세 0.4절과 같습니다. 상태 코드·저장 방식은 구현 설계에서 정합니다.
## 1. 피드백(제보)
댓글은 AI 분석 없이 `등록됨` 하나로 끝나므로 그리지 않습니다. 제보는 질문·오류 제보·제안입니다(UC-14·15).
```mermaid
stateDiagram-v2
  state "접수됨" as RECEIVED
  state "분석 중" as ANALYZING
  state "응답 완료" as ANSWERED
  state "작가 검토 대기" as AUTHOR_REVIEW
  state "수정 진행 중" as FIXING
  state "처리 완료" as DONE
  state "보류" as HOLD
  state "처리 실패" as FAILED
  [*] --> RECEIVED: 제보 등록 (분석 크레딧 동의)
  RECEIVED --> ANALYZING: UC-15 시작
  ANALYZING --> ANSWERED: 근거 기반 응답
  ANALYZING --> AUTHOR_REVIEW: 근거 부족·창작 판단 필요
  ANALYZING --> FIXING: 표기 오류 수정안 생성
  ANALYZING --> FAILED: AI 실패·시간 초과 (즉시 고지)
  AUTHOR_REVIEW --> ANSWERED: 작가 답변
  AUTHOR_REVIEW --> HOLD: 작가 보류
  HOLD --> AUTHOR_REVIEW: 작가 재검토
  FIXING --> DONE: 수정안 발행 완료
  FIXING --> ANSWERED: 수정안 거절 (사유 안내)
  ANSWERED --> [*]
  DONE --> [*]
  FAILED --> [*]
```
- `처리 실패`는 기다리게 두지 않고 바로 독자에게 알리며, 운영자에게 경고를 보냅니다(UC-21). 자동 재처리는 하지 않고 독자가 다시 제보할 수 있습니다.
- `수정 진행 중`의 세부 진행은 아래 수정안 상태를 따릅니다.
- **미정:** 보류의 최대 기간, 실패한 제보의 크레딧 복구 기준(UC-17).
## 2. 수정안(PR)
작품 설정의 표기 오류 처리 방식에 따라 작가 검토와 자동 승인·발행이 갈립니다(UC-16).
```mermaid
stateDiagram-v2
  state "검토 대기" as PENDING
  state "승인됨" as APPROVED
  state "거절됨" as REJECTED
  state "보류" as HOLD
  state "초안 반영됨" as DRAFTED
  state "반영 실패" as APPLY_FAILED
  state "발행 대기" as WAIT_PUBLISH
  state "발행 완료" as PUBLISHED
  state "발행 실패" as PUBLISH_FAILED
  [*] --> PENDING: UC-15가 수정안 생성
  PENDING --> APPROVED: 작가 승인 또는 자동 승인(표기 오류만)
  PENDING --> REJECTED: 작가 거절
  PENDING --> HOLD: 작가 보류
  HOLD --> PENDING: 재검토
  APPROVED --> PENDING: 기준 버전 변경 (재검토)
  APPROVED --> DRAFTED: 승인 범위만 초안 반영
  APPROVED --> APPLY_FAILED: 초안 반영 실패
  DRAFTED --> WAIT_PUBLISH: 작가 검토 모드 (발행 선택 대기)
  DRAFTED --> PUBLISHED: 자동 모드 (UC-13 자동 재발행)
  WAIT_PUBLISH --> PUBLISHED: 작가가 UC-13 발행
  DRAFTED --> PUBLISH_FAILED: 발행 확인 실패
  WAIT_PUBLISH --> PUBLISH_FAILED: 발행 확인 실패
  PUBLISH_FAILED --> PENDING: 자동 모드였으면 작가 검토로 전환
  REJECTED --> [*]
  PUBLISHED --> [*]
  APPLY_FAILED --> [*]
```
- 수정안 반영에 따른 재발행은 세계관 자동 업데이트를 실행하지 않습니다(BR-11).
- **미정:** 보완된 수정안의 재승인 절차, 자동 처리 결과를 되돌리는 절차.
## 3. 회차
```mermaid
stateDiagram-v2
  state "초안" as DRAFT
  state "발행됨" as LIVE
  state "공개 중단" as UNPUBLISHED
  state "신고 조치 중" as REPORTED
  [*] --> DRAFT: 회차 추가·원고 등록
  DRAFT --> LIVE: UC-13 발행 (작가) 또는 UC-18 자동 발행
  LIVE --> LIVE: 새 초안 버전으로 재발행
  LIVE --> UNPUBLISHED: 소유자가 공개 중단
  UNPUBLISHED --> LIVE: 소유자가 다시 발행
  LIVE --> REPORTED: 권리 신고 후 운영자 조치
  REPORTED --> LIVE: 소명 인정 (재공개)
  REPORTED --> UNPUBLISHED: 비공개 유지 결정
```
- 초안은 회차 안에서 버전으로 계속 쌓이며, 독자는 `발행됨` 상태의 발행본만 봅니다.
- **미정:** 공개 중단·신고 조치가 기존 Fork에 미치는 영향, 신고 조치의 상세 절차(검토 예정).
## 4. AI 자율 연재
```mermaid
stateDiagram-v2
  state "꺼짐" as OFF
  state "실행 중" as RUNNING
  state "일시 중지" as PAUSED
  state "중단됨" as STOPPED
  [*] --> OFF
  OFF --> RUNNING: 작품 설정에서 켬 (회당 비용 동의)
  RUNNING --> PAUSED: 소유자 일시 중지
  PAUSED --> RUNNING: 소유자 재개
  RUNNING --> STOPPED: 한도 도달·크레딧 부족
  STOPPED --> RUNNING: 크레딧 확보 후 재개
  RUNNING --> OFF: 소유자 종료
  PAUSED --> OFF: 소유자 종료
```
- 회차 하나의 생성이 실패해도 상태는 `실행 중`을 유지하고, 그 회차만 발행하지 않습니다(UC-18 E2).
- **미정:** 실행 주기·트리거, 연속 실패 시 자동 중지 조건.
## 5. AI 작업 (공통)
추출·시뮬레이션·집필·검토·피드백 분석·자율 연재가 공통으로 따릅니다(UC-17, CE-04).
```mermaid
stateDiagram-v2
  state "비용 확인" as QUOTE
  state "실행 중" as RUN
  state "완료" as OK
  state "실패" as FAIL
  [*] --> QUOTE: AI 작업 요청
  QUOTE --> RUN: 동의 (자동 실행은 설정 시 사전 동의)
  QUOTE --> [*]: 취소·크레딧 부족
  RUN --> OK: 결과 반환
  RUN --> FAIL: 오류·시간 초과
  OK --> [*]
  FAIL --> [*]: 즉시 고지 · 운영자 경고 · 오류 로그
```
- **미정:** 크레딧 차감 시점(선차감·후정산), 실패 시 복구, 시간 초과 기준.
