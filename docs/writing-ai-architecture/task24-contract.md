# TASK 24 — 집필실 Run 소비 계약

2026-11-10. 사용자가 TASK 24에 필요한 최소 Content·AI 계약 보완을 승인했다.
기존 TASK 22 결정·TASK 23 진행 계약과 이어쓰기 API는 유지한다.

## 요청과 선택

Frontend는 기존 인증 fetch/CSRF를 통해 `/api/v1/works/{workId}/ai`만 호출한다.
`POST /runs`는 operation, prompt, target(basisEpisode/forkId/character/baseRevision), options와 Idempotency-Key를 보낸다.
target.selection은 선택 시에만 `{start,end,revision,sourceHash}`이며 UTF-16 반열린 구간과 선택 문자열 UTF-8 SHA-256이다.
baseRevision은 작품 revision, selection.revision은 저장된 원고 editRevision으로 서로 다르다.
Content는 현재 판·범위·서로게이트 경계·hash를 검증한다. 선택 원문 자체는 selection에 넣지 않는다.
미저장/상속 원고는 요청을 비활성화한다. 모호한 접수 실패 재시도는 원래 body와 같은 키를 유지한다.

V20은 Content ai_run에 nullable input_json만 추가한다. 원래 prompt/selection을 내부 dispatch에서 복원하기 위한
Content 업무 입력이며 SSE·checkpoint·로그에 복제하지 않는다. 이전 행과 선택 없는 요청은 호환한다.
AI RunRequest/MainRequest는 prompt/selection을 명시적으로 결합한다. selection=None일 때 기존 checkpoint digest를 보존한다.

## 결과와 결정

`GET /runs/{runId}/result`는 Content가 조회 전후 현재 권한과 작품 revision을 확인한 뒤 제한된
`{status,text,isMock,citations:[{quote,episode}],coverage:{expectedCount,verifiedCount,gaps}|null}`를 반환한다.
본문은 40,000 UTF-16 단위, 인용은 100개 이내다. 인용은 run의 sourceRef와 현재 허용 원고 excerpt의
판본·구간·원문·hash를 다시 대조한다. 현재 resolver는 원고 excerpt만 지원하며 설정/초안 인용은 거부한다.
Coverage/gaps는 정해진 코드만 노출한다. 결과 원문을 진행 이벤트에 싣거나 브라우저 저장소에 저장하지 않는다.

제안은 기존 판 조회를 사용하며 현재 원고와 diff로 표시한다. 승인에는 proposalVersion/proposalHash와 전체 baseVersions를
그대로 보내고 같은 결정의 재시도 키를 유지한다. Mock 근거는 승인하지 않는다. Content 적용 영수증 이후에만 원고를 재조회한다.
거절/재수정은 기존 결정 영수증이며 새 Run 자동 생성은 하지 않는다. 충돌 409는 결과를 숨기고 재확인을 요구한다.

## 구독과 개인정보

SSE는 인증 fetch, Last-Event-ID, 중복 무시·seq gap 감지, 연결 종료 재시도와 410 상태 cursor 재조회로 이어간다.
구독 단절은 취소가 아니다. 2초 상태 조회를 병행하며 새 Run을 만들지 않는다. 취소는 명시적인 cancel API만 호출한다.
진행 메시지는 허용 코드의 고정 문구로 표시한다. 45초 idle 연결은 재접속한다.
작품/회차/선택/본문/판/회원/인증 세대가 바뀌면 이전 결과를 즉시 가리고 요청을 abort한다.
권한 실패에는 원고도 비우고 늦은 저장 응답을 무시한다. 기존 이어쓰기 UI는 보존한다.

## 실제 연결 한계

실제 RemoteGrant 전문 실행 조립과 AI 후보 자동 준비 transport는 기존대로 미연결이다.
실행 장애를 Mock 성공으로 바꾸지 않는다. UI·HTTP 계약 검증과 실제 모델 기반 전체 흐름 완료를 구분한다.
모델 동의는 OpenAI/최대 1회 요청이며 실제 유료 호출은 수행하지 않았다. 새 의존성·인덱스·환경 설정은 없다.
