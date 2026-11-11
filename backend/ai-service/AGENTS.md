# AI Service 구현 지침

> **현행 집필 Run:** [실연동·기동·제한](../../docs/writing-ai-architecture/live-rag-handoff.md). 아래의 TASK별 미연결 설명은 당시 경계다.

`backend/ai-service/**`에 적용한다. [루트 공통 지침](../../AGENTS.md)을 함께 따른다.
현재 내부 Health·이어쓰기 제안과 Run API가 있다. Run은 명시적인 FixtureContent 또는 `CONTENT_AI_RUN_BASE_URL`의 Content 재검증을 사용한다. 실제 위임은 연결됐지만 전문 Agent·원고 읽기·모델 실행은 미연결이므로 실제 run은 `dependency_unavailable`로 종료한다. 콘텐츠 정본·인가·발행은 Content, 크레딧·알림은 Core가 판단한다.

## 구조

- TASK 23의 `runs/progress.py`는 고정 code/task/attempt/phase/step만 custom stream으로 내보낸다.
  messages/debug/추론·원문·토큰을 스트림에 넣지 않는다. Content가 seq와 결과 참조를 영속화한다.
  모델 예약 checkpoint 뒤에도 취소를 재확인하고 늦은 결과를 버린다. 실제 전문 실행·결과 resolver는 미연결이다.
  [TASK 23 계약](../../docs/writing-ai-architecture/task23-contract.md)을 따른다.

- TASK 22의 `runs/approval.py`는 신뢰된 Content prepare/read/receipt 함수만 주입받는다.
  Main의 별도 준비 노드 뒤 읽기 전용 interrupt를 두고 정확한 결정/interrupt와 커밋된 영수증으로 재개한다.
  자연어 승인·AI 원고 쓰기·Mock real 승격은 금지한다. 준비 후 취소는 Content 결정으로 처리한다.
  재수정은 사용자 결정으로 revision_requested 영수증까지다. 실제 준비 transport/결과 resolver·자동 생성은 미연결이다.
  [TASK 22 계약](../../docs/writing-ai-architecture/task22-contract.md)과 [검증](../../docs/writing-ai-architecture/task22-handoff.md)을 따른다.

- TASK 21의 `runs/checkpoints.py`는 기본 비활성인 전용 풀·고정 AsyncPostgresSaver 3.2.0을 제공한다.
  runtime DDL/setup 금지, 분리 schema/권한·migration 0~9 사전 검사, 별도 관리 setup을 따른다.
  Main 재개/ahistory와 RunnerJournal의 완료 결과·호출 전 예약을 복원하고 불명 호출은 재호출하지 않는다.
  [관리·재개·미결](docs/checkpoints.md)과 [수용 결과](../../docs/writing-ai-architecture/task21-handoff.md)를 따른다.
  RemoteGrant 전문 실행·운영 DB·자동 복구·보존/삭제·TASK 20 실제 적용은 계속 미완료다.

- TASK 20의 `agents/world_plot.py`는 검증한 Wiki 역참조의 영향 대상·모델 추측·유지 대상을 분리한다.
  `world_plot_tasks`/run별 `WorldPlotHandler`를 명시 주입한다. 설정·플롯 writer는 TASK 17에서 미지원이므로
  결과는 Mock 분석/후보이며 `can_apply=false`, `unsupported_atomic_scope`다. 원고와 Neo4j/Studio를 묶지 않는다.
  [수용 범위·무효화 이벤트 설계·제한](../../docs/writing-ai-architecture/task20-handoff.md)을 따른다.

- TASK 19의 `agents/next_draft.py`는 `next_draft_tasks`와 run별 `NextDraftHandler`로
  전체 Coverage→선택 Simulation→Development→Writing→모델 0회 연속성 검사를 연결한다.
  `draft_requested=false`는 BeatPlan에서 종료하고, `result`는 연속성 검사 뒤에만 성공 후보를 공개한다.
  Main이 context를 소유할 때는 첫 전문 Task에서 동일 준비를 검증하며, 명시적 plan_factory/handler 주입을 사용한다.
  현재 관계는 작가 문맥의 현재 CAS 자료이며 인물의 지식이나 과거 snapshot으로 승격하지 않는다.
  연속성은 필수 문구의 보수적 일치 검사이고 자유 의역·의미 품질 검증은 아니다.
  실제 모델·공개 Run 자동 조립·Content 저장은 연결하지 않는다([수용·한계](../../docs/writing-ai-architecture/task19-handoff.md)).

- TASK 18의 `agents/writing.py`는 생성문·콘티 확장과 선택 문단 편집 후보만 반환한다.
  `writing_tasks`와 run별 `WritingHandler`를 주입하며 writing/editing은 동일 DTO handler·모델 대역 최대 1회를 사용한다.
  Content 예약/승인/저장 transport와 실제 모델은 연결하지 않는다([DTO·지식 투영·검증](../../docs/writing-ai-architecture/task18-handoff.md)).

- TASK 16의 `agents/development.py`는 인사이트·대안·다음 회차 계획·콘티 확장의 가상 계획만 반환한다.
  `development_tasks`와 run별 `DevelopmentHandler`를 주입한다. 선택 Simulation은 별도 Task이며 Writing·저장은 호출하지 않는다.
  [입력·검증·제약](../../docs/writing-ai-architecture/task16-handoff.md).

- TASK 15의 `agents/semantic_review.py`는 선택 원문·Wiki·반대 근거를 재검증하는 의미 검수다.
  모델 해석·가상 반응은 suspected, 기존 기계 검사의 입증된 수치 차이만 confirmed 후보로 유지한다.
  `semantic_review_tasks`와 run별 `SemanticReviewHandler`를 명시 주입한다. 재현 필요·opt-in에만 별도 Simulation Task를 사용한다.
  수정 요청·완전한 검수·확정 지적이 모두 있을 때만 조건부 editing Task를 등록한다. [DTO·검증·제한](../../docs/writing-ai-architecture/task15-handoff.md).

- TASK 14의 `agents/simulation.py`는 인물별 Content knownBy와 선택된 근거를 투영하는 메모리 전용 LangGraph다.
  기본 두 인물·3개 행동은 순차 실행하고, 비교는 독립 상태·공유 호출 한도를 사용한다. run별 `SimulationHandler`를 명시 주입한다.
  실제 Character 모델·Content 구조화 상태·공개 Run 자동 조립은 미연결이다. [계약·검증·원문 발화 제한](../../docs/writing-ai-architecture/task14-handoff.md).

- TASK 13의 `agents/template_recommendation.py`는 공개 설정에서 읽은 장르·언어·태그와 합성 카탈로그만 사용한다.
  단순 추천은 모델 0회, 명시적인 맞춤 설명만 주입한 모델 대역을 사용한다. 실제 구매·권리 확정·설정 반영은 없다.
  실행기에는 run별 `TemplateRecommendationHandler`를 주입한다. [계약·검증](../../docs/writing-ai-architecture/task13-handoff.md).

- TASK 12의 `agents/review.py`는 선택된 원문·설정 기준을 읽는 기계 검사만 제공한다.
  `checkTypes`로 명칭·수치·중복·제한 맞춤법을 선택하며 모델·Simulation·원문 쓰기를 호출하지 않는다.
  실행기에는 run별 `MechanicalReviewHandler`를 주입한다. [입력·검증·한계](../../docs/writing-ai-architecture/task12-handoff.md).

- TASK 11의 `agents/story_context.py`는 명시 주입한 합성 Content·검색·모델 대역만 지원한다.
  정확 조회 DTO handler는 Registry에 등록하고, TaskRunner에는 run별 `StoryContextHandler`를 주입한다.
  실제 Run/API의 원문 읽기·모델 조립은 미연결이다. [계약·검증](../../docs/writing-ai-architecture/task11-handoff.md).

- FastAPI Router는 입력 검증, 업무 함수 호출, 응답 변환만 한다. 모듈·엔드포인트에 한국어 docstring을 단다.
- 요청·응답은 Pydantic DTO(`Request`·`Payload`·`Response`·`Result`)로 정의한다. 임의 `dict`·외부 SDK 응답을 계약으로 노출하지 않는다.
- 구체 클래스와 직접 함수 호출을 기본으로 한다. production 구현체가 둘 이상이거나 사용자가 요청하지 않으면
  `Protocol`·ABC·provider·registry·factory 추상화를 만들지 않는다. 테스트 편의를 위해 production 추상화를 추가하지 않는다.
- 2026-11-09 사용자 결정: 모델 호출은 OpenAI API, TASK 05 분류는 Decisions(`gpt-6-luna`)를 사용한다.
  TASK 08의 Main 실행 조립은 LangGraph StateGraph를 사용한다. 개별 Agent 구성·운영 연결은 후속 범위다.
  요청된 단계에 필요한 경우 외에는 의존성·lockfile을 미리 바꾸지 않는다.
- 장애는 명시적 오류로 반환하고 fallback으로 숨기지 않는다. 역할·인물마다 서버나 클래스를 만들지 않는다.

## 생성 경계

- 허용 문맥과 작업 범위로만 조회하고 정본 수정·권한·승인·과금을 확정하지 않는다. 결과는 제안으로 반환한다.
- 캐릭터별 허용 기억·관찰 정보를 분리하고 다른 인물의 비밀이나 미래 사건을 누출하지 않는다.
- 피드백 유형은 독자가 고르며 AI로 분류하지 않는다(BR-15). 오류 수정도 수정안까지만 생성한다.

## 변경 범위와 검증

- 로컬: `backend/ai-service`에서 `uv run --locked --extra dev python -m pytest -m 'not integration' <대상 파일> -k '<대상>'`로 단위만 실행한다.
  제공사는 monkeypatch 대역을 쓰고 FastAPI TestClient는 통합(`integration` marker)으로 분류해 CI에서 실행한다.
- 유료 OpenAI 호출은 하지 않는다. 상세는 [AI README](README.md)와 [Agent 구조](docs/agent-structure.md)를 본다.

- TASK 24 RunRequest/MainRequest는 prompt와 선택 UTF-16/hash/원고 판을 결합한다. selection 없는 기존 checkpoint bytes는 보존한다.
  실제 RemoteGrant 전문 실행 조립은 미연결이며 Mock fallback은 금지한다([계약](../../docs/writing-ai-architecture/task24-contract.md)).
