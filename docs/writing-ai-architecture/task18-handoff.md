# TASK 18 — Writing/Editing·선택 범위 ChangeSet

> **2026-11-11 현행:** 실제 연결 여부와 남은 선행 조건은 최신 표를 따른다. [실연동 인수보고](live-rag-handoff.md) 참조. 아래 TASK별 결과는 당시 기록이다.

2026-11-10. **합성 Content·모델 대역의 내부 수용**이며 실제 모델·창작 품질·제품 저장 연결 완료를 뜻하지 않는다.

## 시작과 TASK 17 마무리

사용자의 새 TASK 18 요청에 앞서 TASK 17 잔여 로컬 커밋을 완료했다.
기준 HEAD는 `5471bbe feat: Content 불변 제안과 멱등 적용 영수증 구현`이다.
선행 수정 `bf5edc6`을 포함하며 TASK 17 Content 선택 단위는 39개 통과, CodeRabbit 16파일 지적 0건이다.
실제 PG rollback/경합·HTTP/Flyway 수용은 기존 지침대로 CI에 남겼다. 운영 DB나 모델을 연결하지 않았다.
`feat/60-immutable-proposals`의 clean HEAD에서 `feat/62-writing-editing`을 만들었다.
로컬 develop 참조는 `79855bf`이며 fetch·강제 재기반은 하지 않았다.
이번 범위는 새 글/콘티 확장·선택 범위 편집의 Mock 제안과 Registry/TaskRunner seam, 테스트·설계·기능표다.
TASK 19 이후는 시작하지 않는다.

## 변경 파일과 DTO

`app/agents/writing.py`에 WritingRequest/Input/Reply/Result, WritingSource, GeneratedText,
Patch/WritingChangeSet, CreateTarget/DocumentCreateProposal, writing/writing_tasks/WritingHandler를 추가했다.
별도 prompts 모듈·provider·의존성은 필요 없어 만들지 않았다.
`runs/orchestrator.py`의 writing/editing 두 capability는 같은 DTO handler를 사용하고 기존 출력 schema·model_cap=1을 유지한다.
`tests/test_task_graph.py`는 두 구현을 더 이상 stub으로 기대하지 않는다. 신규 테스트는 `tests/test_writing.py`다.
기존 `generation/router.py`와 이어쓰기 단일 HTTP 계약은 수정하지 않았다.

WritingRequest는 query, mode(draft/expand_conti/edit), prompt, 선택 target:ExactSource,
edit_types(sentence/dialogue/style/voice/emotion), speaker_id, style_examples/context_refs,
선택 conti, save_requested/create_target, 입출력 토큰 상한을 받는다.
query의 grant·Scope 전체나 선택 밖 원문은 모델 입력에 넣지 않는다.
모델 seam은 `await model.write(WritingInput) -> WritingReply`이며 text·used_refs·사용량만 받는다.
모델이 target/span/hash/patches/승인/저장 명령을 추가하면 extra=forbid로 차단한다.

## 선택과 지식 투영

Content 대역의 manifest·pinned 판·현재 권한을 CanonicalAdapter로 검증한다.
명시 화자 ID는 허용된 Content 행의 knownBy에 있어야 하고 character scope와 다르면 막는다.
선택 원문·말투 예문·콘티는 해당 화자의 knownBy 또는 '*'가 있어야 한다.
문맥 후보는 미래/다른 작품 등 manifest 밖과 화자가 모르는 행을 제외한다.
style_examples와 편집 대상·콘티는 같은 작품의 허용 판본만 사용한다.
Fork에 Content가 명시 승인한 상속 자료는 문맥으로만 읽을 수 있고 다른 작품의 말투 자료로 쓰지 않는다.
잘못된 hash·판본·UTF-16 구간은 거부한다. 같은 판본의 중복 행도 거부한다.
Query의 document_ids/source_kinds/episode_range와 편집 대상이 충돌하거나,
선택 원문이 공백이거나 여러 문단에 걸치거나 화자·말투 예문·콘티·예약 대상이 빠지면
blocked와 clarification(source_selection/speaker/voice_example/conti/create_target)을 반환한다.

화자와 예문의 귀속은 합성 호출자의 명시 입력이며 자유문 화자 자동 판별 기능은 없다.
knownBy는 현재 MockRow 단위다. 한 행 안에 다른 화자의 비밀 문장이 섞이지 않도록 Content가 구간을 나눠 제공해야 한다.
실제 fine-grained Content 화자/지식 transport를 구현했다는 뜻은 아니다.
아무 작품 문맥이 없는 독립 문장 생성은 정확 원문 읽기·검색 없이 모델 대역 1회로 처리할 수 있다.
전체 작품 검색·전 회차 검수 완료를 주장하거나 불필요한 검색을 만들지 않는다.

## 결과와 무저장 경계

edit는 선택한 한 문단/그 안의 한 구간을 고정한 Patch 하나다.
같은 문단의 문체+말투 요청은 하나의 모델 입력·호출·Patch로 묶으므로 겹치는 patch가 생기지 않는다.
Patch의 target은 검증한 ExactSource(version/span/source_hash)이고 before/after와 각각의 hash,
speaker_id, 허용 evidence_refs를 서버가 만든다. 선택 밖 문단 전체를 모델에 보내거나 결과에 복제하지 않는다.
여러 편집 Task의 겹침은 기존 DAG PatchTarget 검증을 그대로 사용한다.
생성문과 편집 후 전체 원고는 Content와 같은 UTF-16 40,000자, 생성 제목은 120자 한도를 확인한다.

draft/expand_conti는 generated_text이며 hypothetical=true·is_mock=true다.
save_requested가 명시되고 합성 Content 호출자가 준 CreateTarget이 있으면 document_create_proposal도 반환한다.
CreateTarget에는 work/document/다음 episode/title/work_revision이 들어간다.
같은 ID 또는 같은 번호의 원고가 이미 있거나 다른 작품·잘못된 제목이면 생성 전에 중단한다.
이는 실제 Content의 예약 API가 아니며 모델이 ID·작품 revision을 만들지 않는다.

모델 완료 뒤 현재 권한·manifest·모든 행의 판본/본문/knownBy/공개 범위와 사용한 정확 span/hash를 재검증한다.
변경되면 stale, 철회되면 denied, 시간 초과는 timeout으로 결과 본문을 폐기한다.
provider 장애·빈 출력·추가 필드·알 수 없는 refs·사용량 상한 초과는 blocked이며 재호출·fallback을 하지 않는다.
WritingHandler는 본문을 run별 메모리에만 보관하고 Main/checkpoint에는 참조·실제 상태만 전달한다.
TaskRunner의 기존 모델 예약·사용량·취소 검사를 사용한다. 기존 wants_change 정책도 바꾸지 않았다.

이 Python ChangeSet.v1은 **AI 후보**이며 TASK 17의 Content 불변 manifest가 아니다.
실제 전달 전에 Content가 대상 ID·현재 draft revision·작품 revision·제목+본문 beforeHash,
허용 근거와 전체 제안을 확인해 prepare해야 한다. 그 변환·실 transport·승인 API 실행은 이번 단계에서 연결하지 않았다.
Mock 후보를 real로 바꾸거나 실제 Content에 적용하지 않는다.
DB 쓰기·발행·Neo4j·크레딧·승인·장애 복구 호출은 0건이다.

## TDD와 검증

신규 모듈 부재의 collection Red → 최소 구현 후 Registry 미연결 2건 Red → 두 Registry 연결 Green을 확인했다.
UTF-16 원고 길이·예약 회차 부재·긴 제목·말투 예문 전제 5건과 clarification 5건도 assertion Red 뒤 Green으로 보완했다.
추가 로컬 점검에서 Query의 문서 종류·회차 필터와 편집 대상의 충돌 2건도 Red→Green으로 확인했다.
예약 테스트에서 미래 행을 제거한 뒤 남아 있던 fixture 참조의 StopIteration은 테스트 데이터 구성에서 수정했다.

AI 서비스 디렉터리에서 다음 선택 단위만 실행했다.

```powershell
uv run --offline --locked --extra dev python -m pytest -m 'not integration' tests/test_writing.py tests/test_development.py tests/test_semantic_review.py tests/test_simulation.py tests/test_story_context.py tests/test_mechanical_review.py tests/test_template_recommendation.py tests/test_task_graph.py tests/test_task_runner.py tests/test_main_graph.py tests/test_retrieval_coordinator.py tests/test_mock_retrievers.py tests/test_retrieval_contract.py tests/test_canonical_read.py tests/test_generation.py --tb=short
```

최종 결과: **474 passed, 22 deselected in 12.43s**, 신규 Writing 39개 포함.
기존 이어쓰기 제공사 대역·키 누락 회귀가 포함되며 HTTP 22개는 실행하지 않았다.
uv 캐시 권한 제한 때문에 명령 단위 host 실행을 사용했고 offline/locked를 유지했다.
모든 자료는 합성 Content와 AsyncMock/monkeypatch이며 실제 모델·DB·외부 검색은 없다.
모델 1회, 시나리오 D의 before/after/hash/revision·선택 밖 UTF-16 원문 보존,
비밀/미래/타 작품의 모델 입력 0건, 상태 철회·동시 변경·기한·예산·checkpoint 본문 없음 등을 검사했다.

CodeRabbit은 처음 자동 승인 검토에서 외부 전송의 명시 승인 부재로 거절됐다.
사용자가 이 채팅에서 코드·합성 테스트 4개 파일의 전송을 명시 승인한 뒤 해당 범위만 검토했고,
`review_completed`, **findings=0**으로 종료했다. 리뷰 뒤의 Query 필터 전제 2건과 중복 guard/UTF-8 왕복 비교 제거는
로컬 단위로 확인했다. 문서는 외부로 전송하지 않았다.
ponytail-review로 같은 handler·기존 정확 읽기·예약/취소/patch 검증을 재사용하는지 점검했다.
모듈 분할·새 provider/registry·불필요한 의존성을 만들지 않았고 중복 Unicode 왕복 검사는 삭제했다.

## 근거·이슈·영향·종료

[02 Registry·고정 작업/예산](02-ai-architecture.md), [03 §9 Writing/Editing](03-rag-simulation-design.md),
[04 §15 Content 불변 제안](04-infrastructure-integration.md), [05 시나리오 D·실패 수용](05-implementation-roadmap.md),
[선행 TASK 17](task17-handoff.md), 프로젝트 DEC-36·37·41, 서비스 경계·유스케이스·AI 지침을 따랐다.
2026-11-10 조회: [#62](https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/issues/62)와
[#60](https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/issues/60)는 open·kyo-135다.
이슈 변경·댓글·자동 종료는 하지 않았다.

새 production 의존성·lockfile·기존 API·.env는 바꾸지 않았다. 실제 API 비용·모델 호출·사용자 원고 전송·DB 변경은 0건이다.
모델 입력 투영과 구조적 편집 범위를 확인했지만 자유 생성문의 모든 의미적 사실·지식·문체 품질을 입증하지 않는다.
권리 확인 corpus·실제 Content의 화자/예문 귀속과 구간별 지식·실 모델 품질 평가는 후속 결정이다.
추천은 현재 Mock/read-only 제안 seam 유지다. 대안인 실제 공급자·Content prepare 연결은 허용 payload·동의·비용·품질 계약 후 별도 단계로 진행한다.

로컬 커밋 예정: `feat: 선택 범위 집필과 편집 제안 구현` (Refs #62, #60).
push·PR 생성/변경·병합·배포는 하지 않는다.
통합·브라우저·전체 테스트·빌드·hosted CI·실 모델/DB·실제 승인/저장 검증은 미실행이다.
TASK 19는 새 사용자 요청과 해당 md를 받기 전 착수하지 않는다.
