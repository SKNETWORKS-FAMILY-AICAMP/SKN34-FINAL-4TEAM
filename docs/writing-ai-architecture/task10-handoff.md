# TASK 10 — Content 공개 Run·실제 위임 전송 인수 기록

> **2026-11-11 현행:** 실제 연결 여부와 남은 선행 조건은 최신 표를 따른다. [실연동 인수보고](live-rag-handoff.md) 참조. 아래 TASK별 결과는 당시 기록이다.

2026-11-09. **소스 구현과 선택 단위/HTTP 검증을 마쳤다. PostgreSQL 수용·hosted CI 검증은 대기다.** Content 공개 Run·상태·thread 참조와 영속 멱등성, 실제 5분 위임의 Content↔AI HTTP 재확인을 연결했다. 전문 Agent가 없으므로 실제 run은 명시적인 실행기 미연결 실패로 종료한다. 성공하는 실제 RAG/모델 기능을 완성했다는 의미가 아니다.

## 기준·범위

| 항목 | 확인 |
|---|---|
| 시작 브랜치·HEAD·dirty | `feat/55-main-stategraph`, `ce5e4925f1aeb4319939527fc5b892bab92023c3`, dirty 없음. develop fetch·병합·브랜치 강제 전환 없음. |
| 사용자 입력 | Downloads의 `00_COMMON_RULES.md`, `11_TASK_10_content_public_run_api.md`, 저장소의 [TASK 09 인수](task09-handoff.md). |
| 추가 결정 | 미연결 경계를 확인한 질문에 사용자가 **“실제 grant·AI 전송 계약도 이번에 확정해 연결”**을 선택했다. 그에 따라 HMAC 위임·내부 검증·양쪽 HTTP 전송과 설정을 추가했다. 유료 모델·운영 DB 적용·원고 쓰기를 승인한 것으로 해석하지 않았다. |
| 수행 | 공개 접수/상태/thread 참조, Core 인증/기존 CSRF/owner/work/Fork/revision, 멱등 키/hash, run+dispatch 의도 영속 소스, 실제 서명 위임 재확인, 상태/실패 처리. |
| 제외 | 실제 전문 Agent/검색·모델, 원문/프롬프트 전송·보관, 승인/적용, SSE/UI, MCP 읽기, 영속 AI 재개·자동 재전송·운영 배포. |

현재 계약은 [TASK 10 API 계약](task10-api-contract.md)에 정리했다. 기본 서비스 키/위임 키가 비어 있으면 실패 상태를 보존한다. 자동 fixture·개발용 키·성공 fallback은 없다.

## 변경 파일과 설계 근거

| 파일 묶음 | 핵심 변경 |
|---|---|
| Content `proposal/controller/{AiRunController,AiRunGrantController}.kt`, `service/{AiRunService,AiRunGrantService}.kt` | 공개 세 경로 및 내부 위임 확인. 기존 작품 잠금과 TransactionTemplate로 멱등 접수, 커밋 후 전송, 잠금 밖 상태 조회. HMAC-SHA256·5분 만료·현재 Scope 재인가. |
| Content `proposal/{entity,repository}/Ai{Run,Thread}*`, `service/dto/AiRun{Request,Response}.kt`, `client/{AiRunClient, dto/AiRunDispatchRequest}.kt` | thread·run·요청/문맥/키 hash·source tuple·예산/동의 버전·만료·dispatch 상태. 실제 TASK 09 DTO와 상태 응답을 검증하고 Mock/잘못된 run 응답 거부. |
| Content `auth/config/{ContentSecurityConfig,AiRunServiceTokenFilter}.kt`, `proposal/config/GenerationClientConfig.kt`, `proposal/V17__ai_run_thread.sql` | 좁은 내부 인증 체인과 기존 RestClient 재사용. 신규 CREATE-only 마이그레이션, 복합 unique/FK·활성 thread unique. 공개 CSRF와 운영 서비스 인증 유지. |
| AI `runs/{remote_content,service,schemas}.py`, `app/main.py`; `.env.example`, Compose base | 표준 urllib로 Content에 위임 재확인, timeout/redirect/proxy 제한, 실제 run의 명시적 dependency_unavailable. HMAC 키는 Content에만 전달. 새 production 의존성 없음. |
| 관련 신규/회귀 테스트·AI/Content AGENTS/README·설계/기능표/인수 문서 | 단위·HTTP·CI용 PostgreSQL 동시 접수 검증, V17 목록 갱신. 기존 SQL을 바꾸지 않고 기능표 제품 행 ❌ 유지. |

필수 설계는 실제 `docs/writing-ai-architecture/`의 [01 현행 분석](01-current-system-analysis.md), [04 API/위임/동의/멱등 계약](04-infrastructure-integration.md), [05 구현 배치/검증](05-implementation-roadmap.md)을 확인했다. [06 서비스 결정](06-design-decisions.md), 루트/AI/Content/Core AGENTS, 프로젝트 설계·결정·유스케이스·DEC-41·[Content 이관 계약](../design/content-service-migration-contract.md)도 대조했다. 새 패키지/범용 추상화/worker 없이 기존 proposal 기능·인가·문맥·트랜잭션·HTTP helper를 재사용했다.

GitHub 재조회 결과 [#54](https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/issues/54)·[#57](https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/issues/57)은 open, 담당 `kyo-135`다. 요청 계약·thread 소유/참조의 부분 구현이며 전체 멀티턴/재개 완료가 아니다. [#157](https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/issues/157)은 closed/completed, 담당 `yerin816`의 Core/Content 계층 정리라 추가 구현하지 않았다. [#163](https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/issues/163)은 open/미할당이며 MCP 원문 읽기 도구는 계속 별도 범위다. 이번 plain HTTP 위임 재확인은 MCP 구현을 뜻하지 않는다.

## TDD와 실제 검증

새 단위/HTTP 테스트를 먼저 작성했고 미구현 AiRunService/Controller/DTO 참조의 compileTestKotlin Red를 확인했다. 실제 위임 확장도 AiRunGrantService 부재와 Python remote_content 모듈 부재 Red 후 구현했다. 추가로 늦은 pending 응답이 종료 상태를 되돌리는 실패를 단위로 재현하고, 작품 잠금 안에서 종료 상태를 보존하는 한 줄 guard로 통과시켰다. Content 앱은 Hibernate 자동 구성을 제외하고 명시 TransactionTemplate을 사용하므로 외부 HTTP를 DB 트랜잭션 밖에 두었다.

초기 환경은 JDK 17만 있었고 Gradle 캐시 쓰기도 샌드박스에서 거부됐다. 공식 Adoptium API의 JDK 21.0.13+9 ZIP을 Git-ignore `.gradle/task10-tools`에 내려받아 SHA-256 `a4dbaa05fca4bd89d84584e58c459bd732efebb1722af80ab13c6516832004f9`를 확인했다. 시스템 Java 설정은 바꾸지 않고 테스트 명령에만 JAVA_HOME을 지정했다. Gradle은 저장소 wrapper 9.5.1, Kotlin 2.4.10, Spring Boot 4.1.0이다. 초기 Mockito의 Kotlin non-null matcher 설정과 반복 stubbing 오류는 저장소의 기존 Elvis 대역/`doThrow` 방식으로 수정했다. 중단·실패한 시도를 통과로 집계하지 않았다.

Content 디렉터리에서 최종 실행:

```powershell
$env:JAVA_HOME='C:/SKN_project/SKN34-FINAL-4TEAM/.gradle/task10-tools/jdk-21.0.13+9'
.\gradlew.bat unitTest --tests 'ai.storyfork.content.proposal.AiRunServiceTest' --tests 'ai.storyfork.content.proposal.AiRunGrantServiceTest' --tests 'ai.storyfork.content.auth.AiRunServiceTokenFilterTest' --tests 'ai.storyfork.content.auth.OperationsServiceTokenFilterTest' --tests 'ai.storyfork.content.episode.ContentBoundaryTest' --tests 'ai.storyfork.content.regression.ContentServiceTest' integrationTest --tests 'ai.storyfork.content.proposal.AiRunHttpIntegrationTest' --tests 'ai.storyfork.content.proposal.AiRunClientIntegrationTest' --tests 'ai.storyfork.content.proposal.GenerationClientConfigIntegrationTest' --tests 'ai.storyfork.content.regression.ContentAuthorizationTest' --no-daemon
```

**단위 26개·HTTP 통합 26개 통과**. 새 Run 단위 11개·서명 2개·서비스 인증 1개와 기존 단위 12개, 새 MVC/전송 HTTP 8개와 기존 인증/생성 HTTP 18개다. Core 인증/CSRF·401/403/404/409/422·멱등 중복 방지·위조 work/target/budget·만료·거부/timeout·판본·기존 proposal/accept URL을 확인했다. 실제 DB가 없는 MVC는 업무 Service 대역이며 멱등 로직은 별도 순수 단위로 확인했다. 이 결과를 DB 동시성 수용으로 표현하지 않는다.

AI 디렉터리에서 실행:

```powershell
.venv/Scripts/python.exe -m pytest -p no:cacheprovider -o addopts= -q -m 'not integration' tests/test_run_service.py tests/test_remote_content.py tests/test_task_runner.py tests/test_task_graph.py tests/test_routing.py tests/test_retrieval_coordinator.py tests/test_generation.py
.venv/Scripts/python.exe -m pytest -p no:cacheprovider -o addopts= -q -m integration tests/test_remote_run_api.py tests/test_run_api.py tests/test_main_graph.py tests/test_generation.py tests/test_health.py
```

**단위 172 passed, 1 deselected**, **HTTP/메모리 그래프 41 passed, 2 deselected**. 새 원격 위임 단위 6개·실제 loopback HTTP 통합 1개와 TASK 09 직접 영향 회귀다. Content 권한 재확인·철회·잘못된 범위·전송 실패와 실제 실행기 미연결을 확인했다. 상대 HTTP는 합성 대역이며 실제 Content DB·유료 모델은 쓰지 않았다. Python 3.11.15의 기존 잠금 .venv를 사용했고 새 Python 의존성/lockfile 변경은 없다.

factory의 `CONTENT_AI_RUN_BASE_URL` 자동 연결과 미설정 환경 격리는 최종 선택 HTTP 2개를 재실행해 통과했다. `uv --cache-dir .uv-task09-cache lock --check --offline`, `git diff --check`, 새 문서의 로컬 링크 검사도 통과했다.

루트의 CI 선택/콘텐츠 계약 검사 전체 28개는 Windows 기본 cp949 문제 때문에 `-X utf8`로 재실행했다. V17 목록을 갱신했고 **27개 선택 검사는 통과**했다. 기존 byte 보호 검사 한 메서드의 3개 SQL subcase는 CRLF 체크아웃 때문에 로컬 raw hash가 달라 실패한다. 해당 파일을 수정하거나 검사를 약화하지 않았다. `git show HEAD:<path>`의 원본 SHA-256은 baseline과 모두 같고 로컬 CRLF→LF 변환 바이트도 Git 원본과 같음을 확인했다. LF 체크아웃 hosted CI에서 원래 byte 검사를 재확인해야 한다.

격리 DB 전용 `AiRunPostgresTest`에는 동시 동일 키의 한 run/한 dispatch와 커밋된 pending 의도 검증을 작성했다. 기존 ContentMigrationTest/StoryPlanMigrationPostgresTest의 V17 개수도 갱신했다. `TEST_CONTENT_DATABASE_URL`이 제공되지 않아 PostgreSQL/Flyway/기존 accept 저장 회귀는 **미실행**이며 격리 DB/hosted CI에서 실행해야 한다. 실제 운영 DB 적용·전체 suite·빌드·컨테이너/앱 기동·브라우저·모델 호출은 실행하지 않았다.

완료 전 ponytail-review 기준의 과잉 설계와 정확성 자체 점검을 수행했다. 새 라이브러리·범용 provider·별도 큐/worker·자동 재시도·SSE·미래 Agent는 추가하지 않았다. CodeRabbit은 공식 설치 출처를 확인하지 못해 외부 리뷰를 실행하지 않았으며 자체 점검과 구분한다.

## 영향·미결·Git 인수

| 항목 | 결과·추천/대안 |
|---|---|
| 보안/권한/비용 | 실제 grant를 Content에서 발급·현재 범위로 재검증한다. 서명 키는 AI/Core/브라우저에 전달하지 않는다. 원고·프롬프트·grant를 DB/체크포인트/로그에 추가하지 않고 유료 모델 호출은 0회다. 실제 `.env`는 변경하지 않았다. |
| 버전/저장 | V17 신규 소스만 추가했고 기존 V1~V16·Auth·첨부·Studio SQL의 Git 바이트는 보존했다. 원본 데이터 삭제/repair/DDL 실행 없음. 기존 ai_job FK 정책 때문에 실패한 run도 작품 삭제를 막을 수 있으며, 자동 삭제 대신 보존 정책의 별도 결정을 권장한다. |
| 실제 실행 | Content↔AI의 제한된 HTTP와 위임은 연결했다. 전문 Agent/실 검색/프롬프트 payload 읽기는 미연결이라 실제 run은 실패한다. 다음 연결은 보호된 payload 참조·현재 source/knownBy·모델 동의/과금 계약을 먼저 검증하는 방향을 권장한다. 대안은 현재 metadata/명시 실패 모드를 유지하는 것이다. |
| 재시작/성능 | Content 멱등/dispatch 의도는 DB 소스에 보존하지만 자동 재전송/복구는 없고 AI claim은 단일 프로세스 메모리다. grant 자동 갱신·대규모 부하/p95는 미검증이다. 모델 실행 전에 영속 lease/재개 정책을 별도 확정해야 한다. |
| Git/다음 단계 | #54·#57 범위 로컬 커밋 제목 `feat: 공개 Run API와 Content 위임 전송 연결`. push·PR 생성/갱신·병합·배포는 실행하지 않는다. 이전 PR 설명 미갱신 상태도 유지된다. 다음 TASK는 새 요청에서만 시작하며 PostgreSQL/Flyway/동시 접수·hosted Required CI가 최종 수용의 남은 조건이다. |
