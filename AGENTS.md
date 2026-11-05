# STORYFORK 공통 지침

## 적용 범위

이 파일은 저장소 전체에 적용한다. 파일을 변경하기 전에 해당 서비스의 `AGENTS.md`를 읽고 함께 따른다.
여러 서비스를 변경하면 관련 지침을 모두 확인한다. 하위 지침은 해당 경로의 세부 규칙이며 공통 보안·책임 경계를 약화하지 않는다.

- `frontend/**` → [Frontend 지침](frontend/AGENTS.md)
- `backend/core-api/**` → [Core Service 구현 지침](backend/core-api/AGENTS.md) (`core-api`는 현행 모듈명)
- `backend/content-service/**` → [Content Service 구현 지침](backend/content-service/AGENTS.md)
- `backend/ai-service/**` → [AI Service 지침](backend/ai-service/AGENTS.md)

제품 목표·사용자 흐름·미정 정책은 [README](README.md), 현재 실행 구조는 [아키텍처 문서](docs/architecture.md)를 참고한다.
서비스별 구현 규칙은 이 파일에 복제하지 않는다.

## 제품과 현재 상태

- STORYFORK는 다중 AI 에이전트 기반 독자 참여형 스토리 창작·피드백 플랫폼이다.
- Core는 회원·인증·세션·Health를 유지하고 기존 콘텐츠·첨부·WorldStudio 코드/테스트는 content-service로 추출했다. 인증 확인·공개 라우팅·이미지/CI 연결은 소스 구현 상태이며 hosted CI·실제 DB 전환·배포는 확인 대기다. 운영은 골격 그대로다. Frontend의 `/content`와 UUID `/studio/{id}`는 기존 URL의 Content API를 사용하며 서재·열람·Fork 메모리 데모의 실제 인증 연결과 전체 세계관 체크포인트 등은 후속 작업이다. 실행·검증 범위는 현재 아키텍처와 기능표를 확인한다.
- 기획 목표·확정 계약·미정 사항·실제 구현을 구분한다. 기획에 있다는 이유만으로 기능·정책을 선제 구현하지 않는다.

## 서비스 책임

- 기존 MSA 서비스 경계를 발전시킨다. Frontend는 TypeScript로 Clean Architecture·MVVM을 따르고,
  백엔드는 기능 중심 레이어드 구조를 유지한다. 세부 규칙은 [Frontend 지침](frontend/AGENTS.md)을 따른다.
- 서비스 경계는 [DEC-41 및 서비스 구조](docs/design/service-boundaries.md)와 [이관 계약](docs/design/content-service-migration-contract.md)을 따른다. 코드 추출·같은 DB의 writer/migration 소유 분리·실제 DB/배포 전환은 구분한다. 개발용 Content fresh 이력 재작성만 승인됐으며 Auth·첨부·WorldStudio 이력은 유지한다. 정확한 대상·보존/복구 범위의 별도 승인 없이 실제 DB를 폐기하지 않는다.
- **Frontend:** 독자·작가 전체 화면. 단일 공개 진입점을 통해 Core·콘텐츠·운영의 공개 API를 사용하며 AI·DB·외부 모델을 직접 호출하지 않는다. 현재 라우트·인증 계약은 이전 전 보존한다.
- **Core:** 회원·인증·세션·크레딧·정산·회원 알림의 정본과 최종 판단. 기존 core-api를 재사용한다.
- **콘텐츠:** 작품·세계관·회차·원고·버전·Fork·발행·독서·검색·작품 피드백·첨부와 콘텐츠 인가·채택·반영의 정본. 별도 Kotlin/Spring Boot 앱으로 분리한다.
- **운영:** 고객지원·공지·이벤트·신고 사건·소명·운영 결정·감사·작업 감시. 별도 Kotlin/Spring Boot 앱으로 분리한다. 회원·콘텐츠의 실제 조치는 소유 서비스에 요청한다.
- **LLMOps:** 운영 영역으로 분류한다. Langfuse는 도입 시 별도 제품 서비스로 배포하며, 자체 UI 또는 운영 화면 API 통합은 미정이다. Spring으로 전체 제품 기능을 재구현하지 않는다.
- **AI:** 허용 문맥에서 요청된 생성·시뮬레이션·검토 결과를 반환한다. 정본 수정·권한·발행·정산의 최종 판단을 하지 않는다. 업무별 호출·인증·알림 계약은 후속 설계하며 Agent 역할마다 서버를 만들지 않는다.
- 원작·Fork·초안·시뮬레이션 상태를 구분한다. Fork 기준 회차·버전은 보존한다. 기준 회차에 공개된 세계관 전체는 인물 상태·지식·관계까지 포함한다. 수정 전에는 해당 회차에 영향을 주는 원본 변경을 따라가고, 최초 수정으로 독립한 뒤에는 알림과 사용자 선택으로 반영한다(DEC-37).
- 설정은 항목별 공개·비공개와 회차별 공개 범위를 둔다. 기본은 비공개며 미발행 원고·권한 밖 정보·캐릭터 지식을 혼합하지 않는다. AI 제안과 사용자 승인·실제 반영은 구분한다(DEC-36).
- MVP 저장 방향은 PostgreSQL의 원문·버전·체크포인트·Fork와 그래프 DB의 관계 저장·조회다. `pg_git`은 MVP에 적용하지 않는다. #132의 최신 사용자 결정으로 관계는 Neo4j 현재 상태 하나만 정본으로 두고 이력·과거 snapshot·복원을 만들지 않는다(DEC-27·33의 관계만의 MVP 예외). PG에는 관계 내용 대신 UUID·CAS/요청 완료 메타데이터만 둔다. 기존 SQL·데이터와 인물·설정·원고 버전 기능은 보존하고, 관계를 포함한 과거 세계관 복원은 명시적 미지원으로 처리한다. 실제 이관·운영 복구/백업은 별도 승인 대상이며 [현재 계약](docs/design/worldstudio-independent-schema.md#현재-관계-mvp-계약--132)을 따른다.

## 필수 개발 워크플로

- 이 규칙은 Hermes·Codex·Claude 등 도구와 관계없이 모든 개발 에이전트에 적용한다.
  `/graphify`, `/impeccable`, `/ponytail full`, `/ponytail-review`는 해당 스킬·작업 방식을 뜻한다.
  사용하는 도구에서 지원하는 방식으로 스킬을 로드하고 아래 규칙을 따른다. Hermes 개인 설정에 의존하지 않는다.
  규칙 전달을 위한 지침이며 별도 CI 차단이나 자동 설치는 요구하지 않는다.

- 모든 기여자와 개발 에이전트는 개발 착수 전 `/graphify` 스킬을 반드시 로드·적용하여 관련 코드·호출 관계와 변경 영향 범위를 확인한다.
  Graphify는 저장소 루트에서 실행하여 공유 설정 [`.graphifyrc`](.graphifyrc)를 적용한다.
  이 파일은 실행 시 설정이며 설치·실행 강제나 GitHub 병합 차단 장치가 아니다.
  기존 그래프가 있으면 우선 활용하고 실제 소스와 대조한다. 그래프가 없거나 오래되었으면 해당 스킬의 범위 규칙에 따라
  관련 소스를 직접 확인하고 한계를 보고한다. 이 지침만으로 전체 그래프 생성·도구 설치를 자동 수행하지 않는다.
- 구현은 반드시 `/ponytail full` 모드로 진행한다. 기존 코드·표준 라이브러리·플랫폼 기능을 우선 재사용하고,
  요청한 동작을 만족하는 가장 단순한 구현에서 멈춘다. 보안·권한·데이터 무결성·접근성 검증은 단순화를 이유로 생략하지 않는다.
- 기능 추가·버그 수정은 반드시 TDD(테스트 주도 개발)로 진행한다. 특정 TDD 스킬의 설치·로드 여부와 관계없이
  구현 코드보다 테스트를 먼저 작성하고 Red → Green → Refactor 순서를 따른다.
  먼저 기존 테스트 환경에 작은 동작·회귀 테스트를 작성하고 의도한 이유로 실패하는 것을 확인한 뒤 최소 구현으로 통과시킨다.
  리팩터링은 실제 중복·복잡성을 줄일 때만 수행하고 관련 테스트를 다시 확인한다.
  문서·설정만 변경하는 경우에는 억지 동작 테스트 대신 내용·구문·링크 등 변경에 맞는 검증을 수행한다.
- 개발 완료 후 완료 보고 전에 반드시 `/ponytail-review` 스킬로 이번 변경분의 과잉 설계를 리뷰한다.
  불필요한 의존성·추상화·미사용 코드·미래 대비 기능을 점검하고, 범위 내 유효한 지적은 수정한 뒤 영향받은 검증을 재실행한다.
  이 리뷰는 기능 정확성·보안 검증을 대체하지 않는다. 최종 보고에 테스트 결과와 리뷰 반영·미반영 사유를 구분한다.
- 로컬 개발의 자동 검증은 변경 동작·직접 영향 범위의 **선택 단위 테스트만** 실행한다.
  통합·DB·시스템·브라우저 E2E·컨테이너·전체 테스트·빌드는 로컬 개발 완료 조건으로 실행하지 않는다.
  통합·HTTP 시스템 검증은 CI에서 실행하고, HTTP 시스템 테스트를 브라우저 E2E 통과로 표현하지 않는다.
  Aside 브라우저 검증은 사용자가 별도로 요청·승인한 경우에만 `aside-browser`와 `aside guide`를 적용한다.
  실제 입력·클릭·API 결과·화면 상태를 검증하고 기존 데이터·탭을 보존하며 파괴적 동작·유료 호출은 별도 승인한다.
  최종 보고는 로컬 단위 테스트·CI 실행 결과·브라우저 미실행 등 제외 범위를 구분한다.
- 필수 스킬이나 도구를 사용할 수 없으면 적용했다고 주장하지 않는다. 제한 사항과 가능한 대체 확인을 알리고,
  필수 절차를 충족할 수 없는 상태를 임의로 완료 처리하지 않는다.

## 기능표 관리

- [개발 기능표](docs/feature-roadmap.md)는 기능별 개발 완료 여부를 확인하는 목록이다.
- 개발 완료 시 기존 세부 기능 행의 체크를 갱신한다. 실제 구현·검증 상태와 다르게 완료 표시하지 않는다.
- 기존 기능 행·병합 구조·다른 기능의 체크를 보존하고 같은 기능을 중복 등록하지 않는다.
- 관련 이슈·PR은 실제 존재하는 링크만 적고, 없으면 `—`로 둔다. 별도 관리 번호·추적 표·작업 기록을 추가하지 않는다.
- 테스트 결과·구현 과정·남은 일은 PR 본문에 기록하고 기능표에 누적하지 않는다.
- 기능표만 변경하면 내용·링크·공백만 확인하고 앱 테스트·빌드를 실행하지 않는다.

## 변경 원칙

- 기존 코드와 계약을 먼저 확인하고 요청한 현재 기능만 가장 단순한 방식으로 구현한다.
- 필요한 사용자 흐름·권한·입출력·실패 경로·수용 기준을 확인한다. 미정인 화면·정책·저장 방식은 임의로 확정하지 않는다.
- 불필요한 계층·추상화·빈 기능 폴더를 만들지 않는다. 한 줄 전달 Facade나 중복 UseCase를 추가하지 않는다.
- DB·Redis·큐·worker·K8s·cloud 등 미래 인프라를 미리 추가하지 않는다. 새 production 의존성·외부 서비스·실행 계층은 사전에 알린다.
- 요청 밖의 리팩터링·이동·삭제를 하지 않는다. 사용자 수정, 기존 API·모델·lockfile·패키지명을 임의로 변경하지 않는다.

## 환경설정 관리

- 개발 설정은 저장소 루트 `.env` 한 곳에서 관리하고 루트 `.env.example`만 공유한다. 서비스별 `.env`를 새로 만들지 않는다.
- Compose는 루트에서 `--env-file .env`를 명시하고 서비스별 필요한 설정만 전달한다.
  네이티브 실행은 각 서비스의 기본 명령을 사용하며 필요한 환경변수만 해당 프로세스에 설정한다. 루트 `.env` 전체를 source하지 않는다.
- 루트 `.env` 전체를 Frontend·Core에 주입하거나 이미지에 복사하지 않는다. OpenAI 키는 AI 런타임에만 전달한다.
- 실제 `.env`는 덮어쓰거나 커밋하지 않는다. 기존 서비스별 개인 설정은 확인 없이 삭제·이동하지 않는다.

## 브랜치, 커밋과 Pull Request

- 브랜치·커밋·PR에는 변경 목적에 맞는 공통 type을 사용한다.
  - `feat`: 기능 추가, `fix`: 버그 수정, `docs`: 문서, `refactor`: 동작 변경 없는 구조 개선
  - `test`: 테스트, `style`: 동작 변경 없는 코드 스타일, `perf`: 성능 개선
  - `build`: 빌드·의존성, `ci`: CI 설정, `chore`: 그 밖의 개발 환경·유지보수, `revert`: 이전 변경 되돌리기
- 작업 브랜치는 `<type>/<영문-설명>` 형식으로 만든다. 설명은 소문자·숫자와 하이픈으로 짧게 작성한다.
  예: `feat/work-registration`, `fix/duplicate-request`, `docs/git-workflow`. 이슈 번호가 있으면 `feat/42-work-registration`처럼 포함할 수 있다.
- 커밋 메시지와 PR 제목은 `<type>: <한국어 설명>` 형식을 사용한다.
  예: `feat: 작품 등록 기능 추가`, `fix: 중복 요청 처리 오류 수정`, `docs: Git 작업 규칙 정리`.
  각각 실제 변경 목적에 맞게 type을 선택한다. 하나의 브랜치에 서로 다른 type의 커밋이 있을 수 있다.
- 커밋 본문과 PR 본문도 한국어로 작성한다. 코드 식별자·명령어·제품명은 원문을 유지한다.
- 변경 전달은 작업 브랜치에 커밋·푸시한 뒤 PR을 생성한다. `main`·`develop`에 직접 푸시하거나
  브랜치 푸시만 하고 완료 처리하지 않는다. 사용자의 명시적인 예외 요청이 있을 때만 직접 푸시한다.
- PR 대상 브랜치는 작업 지시·저장소 정책을 확인하고, 불명확하면 질문한다. PR 생성과 병합은 구분하며 임의 병합하지 않는다.
- PR 본문은 변경 → 동작 → 결정 → 한계 → 남은 일 → 검증 → 한 줄 요약 순서로 작성하고 실제 검증 결과를 기록한다.
- 이 지침은 커밋·푸시·PR의 자동 실행 승인이 아니다. 요청받은 전달 범위에서만 수행하고 비밀값·무관한 수정은 제외한다.

## 보안과 데이터

- 비공개 원고·개인정보·키를 공개 응답·브라우저 번들·로그에 노출하지 않는다. AI에는 작업에 허용된 최소 문맥만 보낸다.
- 비밀값은 해당 백엔드 런타임에만 주입한다(OpenAI→AI). `VITE_*`와 build ARG에 키를 넣지 않는다.
- `.env.example`만 공유하고 실제 `.env`를 덮어쓰거나 커밋하지 않는다.
- 외부 실패를 성공 응답이나 임의 fallback으로 숨기지 않는다. 실패·취소·미완료와 실제 처리 상태를 구분한다.
- 작품 등록·공개만으로 이용 권한을 가정하지 않는다. 외부 IP·데이터셋의 수집·AI 처리·학습·공개는 권리와 이용 조건을 확인한다.
- 배포 이미지 Compose는 인증·TLS 없는 로컬 검증용이다. 인터넷 운영 준비 완료로 표현하지 않는다.

## 검증과 보고

- 로컬 개발에서는 변경 동작과 직접 영향 범위의 단위 테스트만 선택 실행한다. 단위 테스트는 외부 의존성을 대역으로 격리한다.
  Spring context·HTTP·DB·FastAPI TestClient·React 화면 조립 테스트는 CI의 통합 계층에서 실행한다.
  DB·API·화면 변경도 관련 순수 단위 회귀를 먼저 작성하고 통합·시스템 실행은 GitHub Actions에 맡긴다.
- 설정 변경은 로컬 구문·계약 검사와 `docker compose config --quiet`까지 허용한다. 앱·DB·컨테이너 기동,
  전체 서비스 테스트·빌드·의존성 환경 추가는 로컬 검증을 위해 실행하지 않는다.
- 로컬 선택 단위 테스트는 CI 검증을 대체하지 않는다. 명령은 서비스 지침을 따르며 반복 리뷰·불필요한 환경을 추가하지 않는다.
- 문서만 변경하면 내용·로컬 링크와 `git diff --check`를 확인한다. 실행 설정·의존성·프롬프트 변경은 문서 변경으로 보지 않는다.
- 변경한 동작의 테스트는 계속 추가·갱신한다. 실행 장소를 CI로 옮긴다는 이유로 테스트를 삭제·무력화하지 않는다.
- CI는 `develop`·`main` push와 PR에서 [`infrastructure/ci/ci.py`](infrastructure/ci/ci.py)로 변경·영향 범위를 보수적으로 선택한다.
  워크플로가 Vitest·Gradle·pytest를 직접 호출하며 별도 runner·계층별 shell wrapper는 만들지 않는다.
  단위·통합 테스트 본문은 각 서비스에, pytest HTTP 시스템 테스트는 `infrastructure/system`에 둔다.
  PR은 head와 base의 merge-base, push는 before SHA와 비교한다. 수동 실행·기준선 부재는 전체 범위로 안전하게 확장한다.
  삭제·이름 변경의 이전 경로도 포함한다. 공통·설정·의존성·알 수 없는 실행 경로는 서비스 전체 또는 전체 서비스,
  Core 공개 계약·Core-AI 변경은 소비 서비스와 시스템 시나리오도 선택한다. 정확한 의존 그래프 분석이라고 주장하지 않는다.
  문서만 변경하면 runtime job을 생략하며, 영향받는 runtime 범위의 빈 테스트 선택은 성공으로 처리하지 않는다.
- 코드·실행 설정 변경의 검증 완료는 최신 커밋에서 `Required CI`가 실제로 통과했을 때만 선언한다.
  실행 중·실패·취소는 통과가 아니며, 결과를 확인할 수 없으면 검증 대기로 알린다. CI 실패는 원인을 확인해 관련 범위부터 고친다.
- CI의 구현 구성은 변경 선택 → 단위·통합 테스트·설정 검사 병렬 → 선택 HTTP 시스템 테스트 → `Required CI`다.
  단위·통합 서비스 행렬과 설정 검사는 독립 실행하고, 필요한 선행 검사가 실패·취소되면 시스템 테스트는 생략한다.
  계층별 범위·현재 구현과 남은 작업은 [README 검증](README.md#검증)을 따른다. job 이름만 나누어 같은 테스트를 중복 실행하지 않는다.
- CI는 격리된 임시 테스트 DB와 테스트용 SMTP를 사용할 수 있다. 운영·공유 개발 DB 접근, 실제 메일 발송,
  유료 OpenAI 호출과 서버 배포는 하지 않는다. AI 제공사는 테스트 대역을 사용하고 테스트 자원은 실행 후 정리한다.
  실패 시 테스트 결과·컨테이너 로그를 비밀값·개인정보 없이 보관하도록 구성한다.
- Core 통합 job은 임시 PostgreSQL·Mailpit으로 Auth를 확인하고 Content 통합 job은 임시 PostgreSQL·`TEST_CONTENT_DATABASE_URL`로 콘텐츠/Flyway를 확인한다.
  Content 테스트의 `content_test`/빈 비밀번호 계약은 격리된 CI service container의 trust 인증으로만 맞춘다.
  시스템 job은 실행별 `storyfork-ci-<run>-<attempt>` Compose 프로젝트와 임시 DB를 사용하고 항상 해당 프로젝트만 정리한다.
  배포 volume·서버·실제 `.env`에는 접근하지 않는다. 실제 Actions 결과를 확인하기 전에는 hosted CI 검증 대기이며,
  워크플로 파일 변경만으로 브랜치 보호·병합 차단이 설정됐다고 간주하지 않는다.
- 실행하지 않은 검증을 통과했다고 쓰지 않는다. 완료 보고는 로컬에서 실행한 확인·CI에 맡긴 범위·남은 한계를 구분한다.

## graphify

This project has a knowledge graph at graphify-out/ with god nodes, community structure, and cross-file relationships.

When the user types `/graphify`, use the installed graphify skill or instructions before doing anything else.

Rules:
- For codebase questions, first run `graphify query "<question>"` when graphify-out/graph.json exists. Use `graphify path "<A>" "<B>"` for relationships and `graphify explain "<concept>"` for focused concepts. These return a scoped subgraph, usually much smaller than GRAPH_REPORT.md or raw grep output.
- Dirty graphify-out/ files are expected after hooks or incremental updates; dirty graph files are not a reason to skip graphify. Only skip graphify if the task is about stale or incorrect graph output, or the user explicitly says not to use it.
- If graphify-out/wiki/index.md exists, use it for broad navigation instead of raw source browsing.
- Read graphify-out/GRAPH_REPORT.md only for broad architecture review or when query/path/explain do not surface enough context.
- After modifying code, run `graphify update .` to keep the graph current (AST-only, no API cost).
