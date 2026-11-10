# 구현 순서와 수용 기준

첫 PR의 목표는 **합성 작품 한 편에서 권한이 있는 1~3화의 질문에만 근거를 반환하는 것**이다. 원고·템플릿 Vector DB나 새 Wiki 저장소가 없어도 진행할 수 있다. 다음은 설계 이후의 개발 순서이며 각 행은 독립 배포·권한 부여를 의미하지 않는다.

| 순서 / 난이도 | 선행 조건과 개발 단위 | 다음 단계로 넘어갈 증거 |
|---|---|---|
| 1 · 중 | Content 인증·작품/Fork manifest·시점·인물 지식 계약 합의 → Scope/Evidence DTO와 fixture → 네 RetrievalPort 계약 | 동일 본문이라도 다른 Fork·미래 회차·비공개 인용이 0건. 누락과 장애를 구분 |
| 2 · 중 | 규칙 Router → 고정 Registry와 DAG → Q&A·기계 검수·템플릿 검색. 인증된 run/상태/SSE의 최소 수직 흐름 | 정확 조회 모델 0회, 조회 실패가 빈 성공으로 바뀌지 않고 단절 후 같은 run 표시 |
| 3 · 높음 | 인물별 투영 → Simulation reducer → 의미 검수 → Development의 insight/plan. 권리 확인 평가 세트 마련 | 인물 비밀 최소 대조쌍, 무효 행동·취소·한도, 근거 있는 지적/추론 구별 |
| 4 · 높음 | 고정 제안·승인 영수증 및 재개 → Writing/말투 → 다음 화·콘티 확장 → World/Plot 다중 문서 | 서버 재시작·중복 승인·동시 수정·다중 대상 하나 실패 모두에서 원고 일관성 확인 |
| 5 · 운영 전 | 한국어 분류기 비교·보관 정책 확정, 실제 검색 adapter 하나씩 및 인덱스 동기화 | Mock 공통 계약 외 실제 recall·ACL prefilter·재색인/삭제·부하·복구 평가. 제품/예산 결정 후 운영 전환 |

MVP 기능은 위 1~4의 모든 Agent를 합성 자료로 조합할 수 있는 범위다. 실제 사용자 대상 출시는 필요한 데이터 공급자가 준비된 기능별로 판단한다. “DB 없이 개발 가능”은 전 작품을 검색할 수 있다는 보장이 아니다.

## 프로젝트 루트 기준 파일 배치안

TASK 18은 `agents/writing.py`에 생성문·콘티 확장·선택 문단의 문체/말투 편집과 run별 adapter를 구현했다.
시나리오 D는 모델 대역 1회·Patch 하나로 처리하며 선택 밖 원문 보존·span/hash/revision·화자 지식·출력 후 Content 재검증을
선택 단위로 확인한다. 기존 이어쓰기 API는 보존하며 실제 모델·Content 불변 제안 준비/승인·저장은 연결하지 않았다.
[DTO·검증·품질 한계](task18-handoff.md).

TASK 17은 `ChangeProposalService`에 PG 원고의 불변 ChangeSet 판·멱등 결정·적용 영수증과 별도 실패 시도를 구현했다.
다중 PG 대상의 전검증과 기존 EpisodeVersion 저장을 재사용하며 V18은 코드만 작성했다. 실제 DB rollback·동시 승인과
HTTP 수용은 CI 대기다. 기존 accept는 유지하고 실제 Writing/모델·자동 준비·재개·설정/플롯 writer는 연결하지 않는다.
[계약·단위 검증·제한](task17-handoff.md).

TASK 16은 `agents/development.py`에 네 모드의 가상 인사이트·장면 계획과 run별 adapter를 구현했다. 시나리오 G와 선택 Simulation·개수·근거·무저장을 단위로 검증했다. 원고 생성·승인·적용·실 인덱스는 제외한다. [계약·검증](task16-handoff.md).

TASK 15는 `agents/semantic_review.py`에 지식·인과·감정·규칙·복선·대사 시점·행동 검수 DTO와 run별 adapter를 합성 자료로 구현했다. 시나리오 A의 지식 충돌·문제 없음·확정 수치 불일치·의도적 변경·근거 부족을 대조하며 선택적 Simulation은 별도 고정 Task로 호출한다. 수정 요청과 확정 지적이 함께 있을 때만 editing 후속을 등록한다. 실제 Writing·원문 반영·의미 모델 품질·공개 API 자동 연결은 후속 범위다. [호출·검증·인수](task15-handoff.md).

TASK 13은 `agents/template_recommendation.py`의 Recommendations·Registry·TaskRunner 명시 주입을 구현했다. 기존 합성 TemplateVectorRetriever에 keyword-only 태그 필터와 선택적 목적·예상 변경·충돌 태그 metadata를 추가했으며 기본 검색 호출은 보존했다. 검사 E의 단순 추천은 모델 0회다. 실제 Vector DB·구매·적용·공개 API 조립은 범위 밖이다. [입력·검증·인수](task13-handoff.md).

TASK 12는 `agents/review.py`에 선택된 수치·명칭 기준 비교, 인접 중복 어절, 명시 표기 쌍의 제한 맞춤법 검사와 `Findings.v1` adapter를 구현했다. 검사 F는 수치·명칭만 수행하고 모델·Simulation은 0회다. 자동 추출·의미 검수·원고 수정·실제 API 조립은 추가하지 않았다. [DTO·검증·인수](task12-handoff.md).

TASK 14는 `agents/simulation.py`에 인물별 투영·순차 LangGraph·행동/물리 제약 검증·임시 reducer·결정적 분석과 `SimulationReport.v1` adapter를 합성 자료로 구현했다. A/B/G에서 재사용할 내부 구성요소이며 의미 Review·Development·Writing의 후속 조립이나 공개 Run의 실행 예산 변경은 이번 범위가 아니다. [DTO·호출 상한·단위 결과](task14-handoff.md).

TASK 11은 `agents/story_context.py`의 정확 조회·근거별 Q&A와 고정 `qa` Registry·TaskRunner adapter를 합성 자료로 구현했다. 기존 graph 입력 검증을 `retrieval/validation.py`로 옮겨 재사용하며 함수 AST는 보존했다. 실제 공개 Run의 원문/모델 연결과 후속 Agent는 미구현이다. [입출력·TDD·검증·인수](task11-handoff.md).

TASK 10은 Content의 `proposal` 기능 안에 공개 Run/thread·멱등 영속 기록·HMAC 위임 검증·AI 전송을 추가했다. AI는 실제 Content 위임을 재확인하지만 전문 Agent/실 검색이 미연결이어서 실패 상태를 반환한다. 공개 SSE·승인·적용·자동 재개는 미구현이다. [계약](task10-api-contract.md) · [검증과 인수](task10-handoff.md).

2026-11-09 TASK 09에서 `runs/{router,schemas,service}.py`와 앱 등록을 추가했다. FixtureContent의 작업별 위임 확인 후 메모리 MainGraph로 실행하며 상태·취소·중복 차단을 제공한다. 선택 단위 166개·HTTP/그래프 통합 40개 통과. 새 production 의존성·실제 Content·공개 URL·원고 저장·SSE 연결은 없으며 [TASK 09 인수 기록](task09-handoff.md)을 따른다.

2026-11-09 TASK 08에서 `runs/state.py`·`graph.py`를 추가해 실제 메모리 StateGraph를 조립했다. 요청된 그래프 조립 통합 21개와 직접 영향 단위 152개가 Python 3.11.15·lock 버전에서 통과했다. 공개 run API·실제 모델·Saver·승인 연결은 이 증거에 포함하지 않는다. [TASK 08 인수 기록](task08-handoff.md).

표의 `{a,b}`는 같은 위치에 둘 구체적인 파일 이름의 열거다. 신규 경로는 제안이며 이 설계에서 생성하지 않는다. 작은 capability는 같은 파일 안 함수로 시작한다.

| 경로 | 책임 | 신규/기존 확장 | 주요 의존 컴포넌트 |
|---|---|---|---|
| `backend/ai-service/app/main.py` | 내부 run router 등록·풀 수명 관리 | 기존 확장 | FastAPI, saver |
| `backend/ai-service/app/generation/router.py` | 기존 단일 이어쓰기와 OpenAI 실패 처리 유지 | 기존 재사용 | Content GenerationClient |
| `backend/ai-service/app/runs/{router,schemas}.py` | 내부 API, 입출력·이벤트 DTO | 신규 | Content 위임, Pydantic |
| `backend/ai-service/app/runs/{graph,state}.py` | Main Graph·상태·결과 병합 | 신규 | StateGraph, task 참조 |
| `backend/ai-service/app/runs/{routing,orchestrator}.py` | 규칙/분류 교체점, registry 상수·검증·Send·예산 | 신규 | 허용 capability와 task DTO |
| `backend/ai-service/app/runs/{checkpoints,progress,approval}.py` | saver 연결, 고정 이벤트, interrupt/resume | 신규 | serve lifecycle, Content receipt |
| `backend/ai-service/app/retrieval/{contracts,coordinator}.py` | 범위·Evidence·Coverage, 선택 검색·정규화·context 조립 | 신규 | 서버 승인 manifest |
| `backend/ai-service/app/retrieval/{relationships,episode_wiki,manuscript,templates}.py` | 네 공급자의 타입·읽기 구현, 실제 adapter는 연결 시 추가 | 신규 | 각각 Content 관계, Wiki, 원고 Vector, 템플릿 Vector |
| `backend/ai-service/app/retrieval/content_client.py` | 정본 manifest·버전·span 읽기 | 신규 | Content 내부 read API 또는 MCP |
| `backend/ai-service/app/agents/{story_context,review,writing,development,world_plot,simulation,template_recommendation}.py` | 기능별 handler와 필요한 subgraph. 기계 검수는 review 안에 둔다 | 신규 | Registry, ContextPacket |
| `backend/ai-service/app/agents/prompts.py` | 모델별 역할 지시·자료와 지시 분리 | 신규 | scoped 입력 DTO |
| `backend/ai-service/app/runs/model_client.py` | Responses·선정된 분류기 호출, timeout·usage | 신규 | 기존 OpenAI 사용 방식, JEV는 선정 시만 |
| `backend/ai-service/pyproject.toml`, `backend/ai-service/uv.lock`, `.env.example` | 채택 후 runtime 의존성과 비밀 없는 설정 계약 | 기존 확장 후보 | LangGraph, AsyncPostgresSaver, DB pool |
| `backend/content-service/src/main/kotlin/ai/storyfork/content/context/service/ContextService.kt` | 허용 판본 manifest와 원문 확인 | 기존 확장 | WorkAccessService, publication, world |
| `backend/content-service/src/main/kotlin/ai/storyfork/content/proposal/service/ProposalService.kt` | 기존 이어쓰기 보존, 적용 검증·이력 재사용 | 기존 확장 | episode version, proposal repositories |
| `backend/content-service/src/main/kotlin/ai/storyfork/content/proposal/controller/AiRunController.kt` | 새 공개 run·대화·결정·SSE 라우트 | 신규 | Content 인증, run 서비스 |
| `backend/content-service/src/main/resources/db/migration/proposal/` | job 상태 제약·thread/run, 불변 제안 판·영수증·진행 커서. 다음 미사용 버전 선정 | 기존 경로 확장 후보 | Content Flyway, 기존 V7 보존 |
| `frontend/src/data/api/aiRuns.ts` | 인증된 요청, fetch SSE, cursor·취소 | 신규 | 기존 auth 및 notificationStream 패턴 |
| `backend/ai-service/tests/{test_retrieval_contract,test_task_graph,test_simulation,test_approval_resume}.py` | 선택 단위/TDD, 동일한 mock/real 계약 | 신규 | FakeContent·provider spy |
| `backend/ai-service/tests/{test_run_api,test_checkpoint_integration}.py` | HTTP/Saver 통합, CI 전용 | 신규 | 임시 DB, 모델 대역 |
| `backend/ai-service/tests/fixtures/{retrievers.py,story.json}`, `backend/ai-service/tests/evaluation/scenarios.jsonl` | 네 Mock adapter·seed와 정답/비노출 항목 | 신규 | 합성/사용권 확인 자료 |
| `infrastructure/system/` | 웹 공개 경유 요청·재개·승인 HTTP 검증 | 기존 경로 확장 후보 | 격리된 CI 서비스 |

Kotlin 안에서 직접 Orchestration하면 네트워크 한 홉이 줄지만 기존 Python SDK·LangGraph와 이중 런타임 통합이 필요하다. 현재 Python 서비스에 넣으면 직렬화·분산 실패를 계약으로 다뤄야 하지만 권한과 정본 쓰기를 Content 안에 유지하고 기존 테스트·배포 단위를 재사용한다. 따라서 Python 확장을 추천한다.

## GitHub 작업 연결

2026-11-08 저장소 GitHub 검색에서 열린 이슈 61건을 확인했다. 아래는 구현 의존성에 해당하는 이슈다. 열려 있다는 사실과 코드 반영·운영 검증은 따로 판단한다.

| 주제 | 확인한 이슈 | 의존성 또는 중복 처리 |
|---|---|---|
| 총괄·인가·API | [#53](https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/issues/53) · [#54](https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/issues/54) · [#157](https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/issues/157) · [#163](https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/issues/163) | #53 아래 #54 scope가 선행. #163 읽기 도구와 같은 데이터를 별도 무인가 API로 열지 않는다. #157은 HTTP/업무 계층 책임 |
| 도메인·DB·버전 | [#48](https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/issues/48) · [#49](https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/issues/49) · [#50](https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/issues/50) · [#109](https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/issues/109) · [#123](https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/issues/123) · [#124](https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/issues/124) · [#132](https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/issues/132) | 작품-세계관 실제 연결, 허용 원고·Fork 기준 확인. #123/#124의 관계 과거 복원 요구는 최신 #132 예외를 적용 |
| Graph·문맥·평가 | [#55](https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/issues/55) · [#56](https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/issues/56) · [#57](https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/issues/57) · [#125](https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/issues/125) | #55 router, #56 retrieval, #57 멀티턴, #125 데이터·평가. Wiki/벡터 후보 색인은 #56의 계약 이후 |
| 전문 기능·승인 | [#58](https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/issues/58) · [#59](https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/issues/59) · [#60](https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/issues/60) · [#61](https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/issues/61) · [#62](https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/issues/62) · [#122](https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/issues/122) | #58 simulation → #59 조건 검수, #60 적용 → #61 콘티/다중 문서·#62 말투. #122의 설정 추출은 검수 후보로 연결 |
| 스트림·화면 | [#145](https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/issues/145) · [#146](https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/issues/146) · [#28](https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/issues/28) · [#32](https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/issues/32) | 회원 알림 SSE 이슈는 역순 응답 회귀 참고. AI SSE 개발은 별개. 화면 선택 초기화·반영 실패 표시 재사용 |

신규 이슈 **제안만** 한다. “AI run 진행 커서와 재연결”은 #54/#57 하위, “템플릿 카탈로그 권리·추천 평가”는 #56/#125 하위, “Wiki revision별 coverage 및 삭제 전파”는 #56/#124 하위가 적절하다. 별도 등록 전에 기존 이슈의 수용 기준에 포함할 수 있는지 확인한다.

## A~G 기능 수용 시나리오

2026-11-10 TASK 20: C의 하루 3회→1회 설정 후보와 3·5화 Wiki 역참조, 5화 충돌 시 교체문 보류,
유지/미연결 추측·권한/판본 실패를 합성 단위로 확인했다. 설정/플롯 writer가 없어 실제 단일 PG ChangeSet
준비/승인 연결은 미수용이다. 둘째 원고 저장 실패의 rollback은 기존 Content 단위로 별도 검증하며 실제 PG
rollback과 구분한다. [TASK 20 인수](task20-handoff.md).

2026-11-10 TASK 19: B의 1~10화 판본 10/10·현재 관계 CAS·두 인물 세 행동→Development→Writing→연속성
검사를 합성 단위로 수용했다(모델 대역 3+1+1=5). 콘티 전용 BeatPlan 종료와 콘티→본문 확장,
필수 문구 누락·Simulation 실패/미동의/예산 0·현재 관계 변경·판본 변경의 실패 전파를 확인했다.
실제 문서 저장은 0건이며 자유 생성문의 의미 품질·실 모델·공개 Run 자동 조립은 미수용이다.
[TASK 19 입력·검증 결과·제한](task19-handoff.md).

2026-11-09 TASK 06에서 아래 A~G를 테스트 전용 Task DAG로 표현하고 타입·위상·범위·예산 검증을 추가했다. 이는 시나리오의 실제 Agent 결과·모델 호출 수·쓰기 성공 검증이 아니다. [구현 범위와 선택 단위 결과](task06-handoff.md).

아래 수치는 **계획된 테스트의 예상 모델 호출 수**다. 규칙/UI로 작업이 분류되고, 정상 provider와 단일 시나리오·세 턴·재시도 없음이 전제다. 자유문 분류 대역을 쓰는 variant는 별도로 +1. Retrieval 호출은 모델 호출과 별도 집계한다. R=현재 관계, W=회차 Wiki, M=원고 Vector, T=템플릿 Vector, C=Content 정확 조회다.

| 요청 | 실행 순서·Backend와 조건 | 모델 기대값 | 근거·결과 및 승인 판정 |
|---|---|---|---|
| A. 3화 카이의 행동을 검수하고 문제 시 수정 | C/W/M → Review. 시점 허용 R만 사용. 행동 재현 필요 시 Simulation → Review 판단 → confirmed이고 수정 요청이면 Writing | Review 1 + 선택 Simulation 3 + 조건부 편집 1. 문제 없으면 편집 0 | 지식 습득 장면·원문 span이 있는 Findings. 의심만 있으면 대안 설명. Patch만 승인 대상 |
| B. 1~10화·현재 관계로 두 인물 시뮬레이션 후 11화 초안 | C/W/M/R → 범위 확인 → Simulation → Development → Writing → 연속성 규칙 | 3+1+1=5. 필수 근거 부재 시 생성 전 차단 | 10판 manifest, 분리된 지식, 현재 관계의 관측 버전, BeatPlan과 가상 표시 초안. 저장 시 승인 |
| C. 마법 체계 변경 및 플롯 영향 | C/W, 관련 때 R → World/Plot 영향 분석 → 변경 문서 준비, 실제 문장 편집 필요 시 Writing | 1 또는 2 | 설정 버전·사건 경로·대상별 baseVersion. 같은 Content 트랜잭션 범위의 ChangeSet만 일괄 승인 |
| D. 한 문단의 문체와 인물 말투 수정 | C/M와 인물별 W → Writing 한 번 → span 검증 | 1 | 허용 예문, 같은 문단 before/after, 외부 문단 동일. Patch 승인 |
| E. 빠진 세계관 설정의 템플릿 추천 | C의 허용 태그 → T → Recommendation 고정 랭킹, 맞춤 설명 시만 모델 | 0 또는 1 | 카탈로그 ID·버전·권리·추천 이유·충돌 가능성. 조회로 종료 |
| F. 5화 수치·고유명사만 검사 | C 원문·사전 → Mechanical. 의미 검수 및 Simulation 생략 | 0 | 원문 위치, 기준 숫자·표준명, 확정/의심. 읽기 요청은 승인 없음 |
| G. 직전 사건과 인물 반응에서 다음 화 아이디어 3개 | C/W 및 허용된 R, 필요한 M → 선택 Simulation → Development(insight) | 1, 반응 시뮬레이션 포함 시 4 | 직전 사건과 가상 예측을 구분한 3개 대안·위험. 승인 없음 |

기초 회귀에는 인물 나이(정확 조회 0회), 회차 직접 인용(문자열·판본·UTF-16 일치), 맞춤법/중복어(오경고 분리), 콘티→원고 확장(계획과 확정 사건 구분), 어조만 수정(나머지 문장 동일)을 둔다. A의 문제 있음/없음, B의 중요한 누락, F의 무관한 비평 0건은 같은 요청으로 입력만 바꾸는 대조쌍이다.

## 실패·품질 시험과 관측

2026-11-09 TASK 07에서 의존 실행·동시 2개 상한·조건부 무호출·예산·취소·중복/늦은 결과·partial·순서 안정성을 메모리 합성 실행으로 확인했다. TASK 05·06 직접 회귀와 함께 선택 단위 125개 통과이며 실제 모델/DB·영속 재개 검증은 아니다. [TASK 07 인수 기록](task07-handoff.md).

| 계층 | 입력 또는 장애 주입 | 검증할 결과 |
|---|---|---|
| Scope·보안 | 비소유 작품·다른 Fork, 검색문서 내 악의적 지시, 독자만 아는 정보, 지식 습득 직전/직후 | 권한 밖 payload가 **모델 입력에도** 0건, 임의 도구·쓰기 0회, 경계 내 원문만 인용 |
| 검색·실행 | 회차 누락/삭제·stale revision·timeout, 잘못된 router enum/cycle, 동시 예산 소진, 무효 행동 반복 | 빈 성공과 구분, 필수 단계 중단, 호출 상한과 stop_reason 확인, 독립 성공분만 partial |
| HITL | 같은 승인 병렬 전송, 승인 전 동시 편집, Content 커밋 직후 서버 재시작, 두 번째 문서 저장 실패 | 동일 영수증/1회 적용, 409 무변경, 복원 대조, 같은 트랜잭션 전체 롤백 |
| 통신·복원 | SSE 단절·순서 역전·만료 cursor, 취소 후 같은 키 재전송, 다른 회원/작품으로 thread 재개 | UI 중복·역행 0, 새 호출 없음, 새 작업은 새 키, stale 요약·근거 재검증 |
| 평가 | 사용권 있는 원고를 작품·Fork 계열로 묶어 train/eval 분리. 정답 사건·필수 근거·금지 사실·허용 대안 라벨 | gold context 주입 실험과 검색→생성 전체 실험 분리, 창작 대안은 작가 평가 및 실패 예시 기록 |

`run_id/task_id/attempt/agent/provider/model` 기준으로 호출·토큰·실패·시간만 계측한다. `ai_model_call`과 연계해 실제 usage와 미보고를 구분한다. 비용은 요청 시점 단가판과 입력/출력 토큰으로 산정하고 미확인 금액은 null이다. 요청당 호출 수·토큰 비용, agent 선택 precision/recall, Router 정답률, 복합 완료율(필수 단계 전부 성공/대상 요청)을 산출한다.

검색별 latency, 필수 evidence recall과 인용 판본·span 일치율, 회차 verified/expected, 판단별 근거 충실도, 잘못된 정본 사용률을 측정한다. Simulation 처리시간과 지식 누설률(금지 사실 포함 턴/검토 턴), 첫 progress 지연, 요청 전체 p50/p95(승인 대기 별도), 적용 실패율·충돌률의 분모는 각각 완료된 실행 또는 시도된 적용으로 고정한다. 원문·대화·키를 메트릭 라벨에 담지 않는다. 목표 지연·품질 수치는 측정 후 결정한다.

로컬 구현은 순수 단위 회귀를 먼저 실패시킨 후 통과시킨다. FastAPI HTTP·Spring context·PostgreSQL·SSE 및 시스템 검증은 CI에서 대역과 격리된 DB로 수행한다. 모델 실측·실제 검색 품질·브라우저 검증은 별도의 승인·환경이 필요한 단계다. 이번 문서에서는 수용 기준을 설계했다.
