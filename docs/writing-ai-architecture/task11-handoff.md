# TASK 11 — Story Context / Q&A 인수 계약

> **2026-11-11 현행:** 실제 연결 여부와 남은 선행 조건은 최신 표를 따른다. [실연동 인수보고](live-rag-handoff.md) 참조. 아래 TASK별 결과는 당시 기록이다.

2026-11-10 현재 코드 기준으로 누락 링크를 보완했다. 최초 구현은 `bc1026e`이며 과거 인수 원문을 복원한 문서가 아니다.
연결 이슈는 [#56](https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/issues/56)·[#57](https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/issues/57)이다. 이번 작업에서 이슈 상태를 변경하지 않았다.

## 호출·반환

`app/agents/story_context.py`의 `StoryContextRequest(query, kind, exact?, question)`를 `story_context(request, content=..., coordinator=..., model=...)`에 전달한다.
`kind=attribute/quote`는 `ExactSource(version, span, source_hash)`가 필수이며 attribute는 setting만 허용한다.
`span`은 UTF-16 `[start,end)`, hash는 선택 원문의 UTF-8 SHA-256이다. 정확 조회는 검색·모델 0회다.

`kind=interpretation`은 `full_context` 조회·재검증 후 충분한 근거가 있을 때만 주입 모델의 `interpret(InterpretationRequest)`를 호출한다.
`Interpretation`은 `claims`, `input_tokens`, `output_tokens`를 반환한다. 모델 주장은 `inferred`이고 refs가 선택 근거의 부분집합이어야 한다.
`Answer`에는 주장별 `text/status/refs`, 전체 coverage·gaps·sources·상태·`is_mock`를 담는다.
공백만 선택한 정확 조회는 처리되지 않은 예외 대신 `insufficient_evidence`와 unverified gap을 반환한다.

## Run·상태·권한

고정 `REGISTRY['qa']`와 run별 `StoryContextHandler`를 사용한다. handler의 `answer`는 메모리에 두고 TaskRunner에는 `answer:{run_id}:{task_id}` 참조만 반환한다.
Content의 scope·manifest·revision·span·hash를 조회 전후 확인한다. denied 응답은 본문·인용을 제거한다.
부족·partial·stale·timeout·unsupported를 빈 성공으로 바꾸지 않는다. 실제 Content 원문 전송·모델·공개 Run 자동 조립·쓰기는 미연결이다.

## 검증

`tests/test_story_context.py`의 정확 조회·주장 출처·권한 철회·인물 지식·실행기 예산 대조쌍을 사용한다.
이번 공백 선택 수정은 quote/attribute 두 테스트의 `ValidationError` Red를 확인한 뒤 Green으로 바꿨다.
현재 잠금 환경의 선택 단위 명령·결과는 [TASK 14 검증 기록](task14-handoff.md#검증)에 기록한다. 과거 실행 결과와 현재 재실행 결과를 구분한다.

설계 근거: [03 §7](03-rag-simulation-design.md#7-story-context--qa), [07 검색 계약](07-retrieval-contract-and-mocks.md), DEC-36·37·41.
