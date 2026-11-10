# TASK 20 — World/Plot 영향 분석과 다중 문서 후보

2026-11-10. **Mock 영향 분석·검토 후보 범위 완료, 실제 승인 가능한 설정/플롯 다중 문서 적용은 미완료**다.
TASK 17의 Content writer가 PG draft만 지원하므로 설계 03 §12의 “지원 불명 시 분석만” 규칙을 적용했다.
새 설정/플롯 writer나 원자성 정책을 임의로 만들지 않았다. TASK 21 이후는 시작하지 않는다.

## 시작·근거·이슈

시작 브랜치 `feat/61-next-draft-conti`, 기준 커밋 `c61ba62`, 작업 트리 clean에서
`feat/61-world-plot-management`를 생성했다. develop 강제 변경·rebase·fetch는 하지 않았다.
사용자가 지정한 Downloads의 `00_COMMON_RULES.md`, `21_TASK_20_world_plot_management.md`와
[TASK 19](task19-handoff.md), 실제 `docs/writing-ai-architecture`의 01·03·04·05·06 문서를 확인했다.
설계 근거는 [01 현행 저장소](01-current-system-analysis.md), [03 §12](03-rag-simulation-design.md),
[04 §15](04-infrastructure-integration.md), [05 C](05-implementation-roadmap.md),
[06 결정 12·14·15](06-design-decisions.md), 프로젝트 DEC-36·37·41·서비스 경계·AGENTS다.
Graphify 탐색은 관련 새 Agent의 연결을 충분히 제공하지 않아 실제 소스·호출자·단위 테스트로 대조했다.

2026-11-10 GitHub 도구 확인: [#61](https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/issues/61),
[#60](https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/issues/60)은 open/kyo-135,
[#48](https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/issues/48)은 open/MoonSungHo-D,
[#50](https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/issues/50)은 open/masquerade0425-hash다.
구형 이슈의 Core 정본 문구 대신 최신 Content 소유 경계를 따른다. 이슈 변경·댓글·자동 종료는 없다.

## 파일·동작

`backend/ai-service/app/agents/world_plot.py`에 WorldPlotRequest/Input/Reply/Result, Impact,
world_plot, world_plot_tasks, run별 WorldPlotHandler를 추가했다. `runs/orchestrator.py`의 world_plot을 연결하고
`tests/test_task_graph.py`의 stub 기대를 갱신했다. `tests/test_world_plot.py`는 신규 19개 합성 단위다.
AI AGENTS·기능표와 설계 03·04·05 및 이 인수보고를 갱신했다. Content 운영 코드는 수정하지 않았다.

호출자는 허용 Query, 설정/플롯/콘티의 정확 원문 rule, 변경할 규칙 문구, 명시적 대상 ExactSource 목록을 준다.
동일 작품의 owner 문맥만 허용한다. manifest·판본·UTF-16 span·원문 hash와 전체 Coverage를 기존
CanonicalAdapter/Coordinator/validate_packet으로 확인한다. 대상과 규칙은 실제 검색 근거에도 있어야 한다.
현재 관계는 필요한 요청에서만 기존 Mock 관계 검색기로 조회하고, 모델 완료 뒤 현재 CAS 자료를 다시 비교한다.
과거 관계 snapshot·외부 그래프 쓰기·인물의 자동 지식 갱신은 없다.

검증된 Wiki evidence_refs를 역방향으로 추적한다. 모델 대역 `analyze`는 대상마다 이유·근거·교체문 또는 유지,
충돌 설명만 반환한다. 대상 누락/중복·모르는 ref·추가 실행 명령·상한 초과·제공사 장애는 후보 전체를 폐기한다.
모델 완료 뒤 현재 권한·모든 원문/판본·manifest·관계 CAS·deadline을 재확인한다.

`confirmed`는 정확 대상 원문과 rule의 **구조적 Wiki 연결 확인**이며 의미적 수정 정답 확정이 아니다.
미연결 모델 추측은 `unconfirmed`에 두고 Patch를 만들지 않는다. `unchanged`는 유지 이유만 반환한다.
충돌이 있는 연결 대상도 이유·근거는 보존하되 Patch는 만들지 않는다. 후보는 대상별 reason/evidence/source_refs/
base_version과 before/after/hash를 가진다. 원문 전체 기준 UTF-16 길이 제한을 유지한다.

설정/플롯과 원고를 묶는 현재 요청은 Content에서 지원되지 않으므로 항상 `can_apply=false`,
`change_set=null`, `application_blocker=unsupported_atomic_scope`다. 종속된 규칙/회차 변경을 독립 제안으로
분리해 승인 경계를 우회하지 않는다. 기존 draft-only Content의 검증/트랜잭션은 그대로다.
Registry의 기존 ChangeSet.v1 출력 이름은 호환 유지하지만 여기서 전달하는 것은 비적용 Mock 분석 참조다.
실제 Content manifest나 승인 가능한 변경 집합을 발급한 것이 아니다. 성공 분석과 실제 적용 가능 여부를 구분한다.
TaskRunner는 모델 1회를 예약하며 본문은 handler 메모리에만 남긴다. 실제 공개 Run 자동 조립은 미연결이다.

## 무효화·검증

설계 04에 `ContentChangeCommitted.v1`의 영수증/application ID, 대상별 before/after revision 계약을 추가했다.
Content의 실제 적용 커밋 이후에만 처리하며 rollback·Mock 후보에는 발행하지 않는다. 소비자는 역참조
Wiki/원고 Vector/문맥 캐시를 먼저 차단하고 현재 manifest로 검증한 새 세대를 공개한다. 중복/역순/처리 실패는
과거 자료를 되살리지 않고 unverified/partial로 유지한다. 실제 outbox·전송·consumer·인덱스 구축은 미구현이다.

TDD: 신규 모듈 부재의 collection Red→구현 Green을 확인했다. C fixture는 하루 3회→1회 규칙 후보,
3·5화 역참조와 2화 유지, 5화 충돌 시 교체문 없음, 미연결 추측·잘못된 ref/대상·추가 필드·동시 변경·철회·
현재 관계 CAS·잘못된 hash·타 작품·근거 부족·기한·그래프 대상·동일 대상·예산 초과를 검증한다.

AI 서비스에서 실행:

```powershell
uv run --offline --locked --extra dev python -m pytest -m 'not integration' tests/test_world_plot.py tests/test_next_draft.py tests/test_writing.py tests/test_development.py tests/test_task_graph.py tests/test_task_runner.py tests/test_retrieval_coordinator.py tests/test_mock_retrievers.py --tb=short
```

결과 **228 passed in 8.64s**. 신규 19개와 기존 생성·DAG·검색의 직접 회귀다. uv 캐시 접근을 위해 명령 단위 host 실행,
offline/locked를 유지했다. 실제 모델·DB·사용자 원고를 사용하지 않았다.

Content에서는 기존 `ChangeProposalServiceTest`만 offline unitTest로 실행했다. 최초 시도는 JDK 21 부재로
테스트 실행 전 중단됐고, 기존 `.gradle/task10-tools/jdk-21.0.13+9`를 프로세스 JAVA_HOME으로 지정해 재시도했다.
최종 Content 결과는 **12 tests, failures=0, errors=0, skipped=0**, `BUILD SUCCESSFUL in 2m 5s`다.
실행 명령은 Content 디렉터리의 `./gradlew.bat unitTest --tests 'ai.storyfork.content.proposal.ChangeProposalServiceTest' --no-daemon --offline`이다.
둘째 문서 실패의 rollback manager 호출 및 영수증 없음과 미지원 저장소/Mock/버전·권한 거부를 포함한다.
단위의 rollback manager 요청 확인은 실제 PostgreSQL rollback 증거가 아니다.
통합·실 PG·HTTP·브라우저·전체 suite·빌드·hosted CI는 로컬 규칙에 따라 미실행이다.

ponytail-review와 로컬 diff 점검으로 기존 검색·정확 읽기·Patch·TaskRunner·Content rollback 단위를 재사용하는지
확인했다. 새 provider·의존성·lockfile·migration·범용 writer는 만들지 않았다. CodeRabbit 외부 리뷰는 이번 변경의
외부 전송 승인이 없어 미실행이며 과거 다른 파일의 승인을 확대하지 않았다.

## 영향·남은 결정·종료

모든 후보와 근거는 is_mock=true, 실제 적용·DB 변경·유료 호출·실 사용자 원고 전송은 0건이다.
`.env`·키·기존 API는 변경하지 않았다. 현재 관계 재조회와 Wiki 순회 비용만 합성 환경에서 발생하며 실제 latency/
검색 품질·자유문 의미 품질은 미평가다. 영향 범위는 명시한 대상과 검증된 검색 결과 내이며 전체 작품의 숨은 영향을 보증하지 않는다.

추천은 현재의 분석/Mock 후보와 적용 차단 유지다. 실제 승인 가능한 설정·플롯 묶음이 필요하면 Content의
지원 writer·동일 transaction manager·대상 소유권·baseVersion 변환과 prepare 계약을 먼저 확정해야 한다.
대안인 다중 저장소 saga는 이번 범위에서 제외하며 PG+Neo4j/Studio 원자성을 주장하지 않는다.
TASK 20 전체의 실 적용 수용은 미완료다. 후속 Mock 단계는 새 요청에서 착수 가능하나 실제 저장의 선행 조건으로
이번 분석 테스트만 사용하면 안 된다. 제품 기능표의 관련 ❌는 유지했다.

로컬 커밋 메시지: `feat: 세계관과 플롯 변경 영향 후보 분석 구현` (Refs #61, #60; 경계 참고 #48, #50).
push·PR 생성/병합·배포는 하지 않았다. 다음 TASK는 새 사용자 요청 전 시작하지 않는다.
