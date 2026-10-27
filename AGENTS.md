# STORYFORK 공통 지침

## 적용 범위

이 파일은 저장소 전체에 적용한다. 파일을 변경하기 전에 해당 서비스의 `AGENTS.md`를 읽고 함께 따른다.
여러 서비스를 변경하면 관련 지침을 모두 확인한다. 하위 지침은 해당 경로의 세부 규칙이며 공통 보안·책임 경계를 약화하지 않는다.

- `frontend/**` → [Frontend 지침](frontend/AGENTS.md)
- `backend/core-api/**` → [Core API 지침](backend/core-api/AGENTS.md)
- `backend/ai-service/**` → [AI Service 지침](backend/ai-service/AGENTS.md)

제품 목표·사용자 흐름·미정 정책은 [README](README.md), 현재 실행 구조는 [아키텍처 문서](docs/architecture.md)를 참고한다.
서비스별 구현 규칙은 이 파일에 복제하지 않는다.

## 제품과 현재 상태

- STORYFORK는 다중 AI 에이전트 기반 독자 참여형 스토리 창작·피드백 플랫폼이다.
- 현재는 시작 화면과 Core·AI Health만 제공하는 개발 기반이다. STORYFORK 업무 기능은 아직 미구현이다.
- 기획 목표·확정 계약·미정 사항·실제 구현을 구분한다. 기획에 있다는 이유만으로 기능·정책을 선제 구현하지 않는다.

## 서비스 책임

- 기존 MSA 서비스 경계와 기능 중심 레이어드 구조를 발전시킨다. 전면 Clean Architecture 전환을 전제하지 않는다.
- **Frontend:** 화면·사용자 상호작용을 담당하고 공개 Core API만 호출한다.
- **Core API:** 작품·세계관·회차 버전·Fork의 정본과 권한·승인·발행·크레딧의 최종 판단·저장을 소유한다.
- **AI Service:** 허용된 문맥에서 생성·시뮬레이션·검토 제안을 반환한다. 정본 직접 수정이나 권한·과금 확정을 하지 않는다.
- 기본 AI 호출 방향은 `Frontend → Core API → AI Service → OpenAI`다. Agent 역할마다 서버를 만들지 않는다.
- 원작·Fork·초안·시뮬레이션 상태를 구분한다. Fork의 기준 버전과 허용 문맥을 고정하고 원작 후속 변경을 자동 유입하지 않는다.
- AI 제안과 사용자 승인·실제 반영을 구분한다. 작가 비공개 정보·독자 공개 범위·캐릭터 지식을 혼합하지 않는다.

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
- 기능 추가·버그 수정은 `test-driven-development` 스킬을 로드하고 TDD의 Red → Green → Refactor 순서를 따른다.
  먼저 기존 테스트 환경에 작은 동작·회귀 테스트를 작성하고 의도한 이유로 실패하는 것을 확인한 뒤 최소 구현으로 통과시킨다.
  리팩터링은 실제 중복·복잡성을 줄일 때만 수행하고 관련 테스트를 다시 확인한다.
  문서·설정만 변경하는 경우에는 억지 동작 테스트 대신 내용·구문·링크 등 변경에 맞는 검증을 수행한다.
- 개발 완료 후 완료 보고 전에 반드시 `/ponytail-review` 스킬로 이번 변경분의 과잉 설계를 리뷰한다.
  불필요한 의존성·추상화·미사용 코드·미래 대비 기능을 점검하고, 범위 내 유효한 지적은 수정한 뒤 영향받은 검증을 재실행한다.
  이 리뷰는 기능 정확성·보안 검증을 대체하지 않는다. 최종 보고에 테스트 결과와 리뷰 반영·미반영 사유를 구분한다.
- TDD 개발과 `/ponytail-review` 리뷰·필요 수정 후에는 Aside로 변경한 사용자 흐름의 E2E 테스트를 수행한다.
  `aside-browser` 스킬을 로드하고 `aside guide`를 확인한 뒤, 실행 중인 앱에서 실제 입력·클릭·API 결과·화면 상태를 검증한다.
  단순 페이지 열기나 스크린샷만으로 E2E 통과를 선언하지 않는다. 변경 영향에 맞는 정상·실패 경로를 확인하고,
  문제를 수정하면 영향받은 테스트만 다시 실행한다. 기존 사용자 데이터·탭은 보존하고 파괴적 동작·유료 호출은 별도 승인을 따른다.
  문서만 변경하거나 브라우저 사용자 흐름에 영향이 없는 변경은 E2E 제외 사유와 해당 계층의 검증 결과를 보고한다.
  최종 보고에는 실행 URL·확인 시나리오·실제 결과·증거 위치 또는 미실행 사유를 기록한다.
- 필수 스킬이나 도구를 사용할 수 없으면 적용했다고 주장하지 않는다. 제한 사항과 가능한 대체 확인을 알리고,
  필수 절차를 충족할 수 없는 상태를 임의로 완료 처리하지 않는다.

## 변경 원칙

- 기존 코드와 계약을 먼저 확인하고 요청한 현재 기능만 가장 단순한 방식으로 구현한다.
- 필요한 사용자 흐름·권한·입출력·실패 경로·수용 기준을 확인한다. 미정인 화면·정책·저장 방식은 임의로 확정하지 않는다.
- 불필요한 계층·추상화·빈 기능 폴더를 만들지 않는다. 한 줄 전달 Facade나 중복 UseCase를 추가하지 않는다.
- DB·Redis·큐·worker·K8s·cloud 등 미래 인프라를 미리 추가하지 않는다. 새 production 의존성·외부 서비스·실행 계층은 사전에 알린다.
- 요청 밖의 리팩터링·이동·삭제를 하지 않는다. 사용자 수정, 기존 API·모델·lockfile·패키지명을 임의로 변경하지 않는다.

## 환경설정 관리

- 개발 설정은 저장소 루트 `.env` 한 곳에서 관리하고 루트 `.env.example`만 공유한다. 서비스별 `.env`를 새로 만들지 않는다.
- Compose는 루트에서 `--env-file .env`를 명시한다. 네이티브 실행은
  `python3 infrastructure/scripts/run-native.py web|core-api|ai-service`로 서비스별 허용 설정만 전달한다.
- 루트 `.env` 전체를 Frontend·Core에 주입하거나 이미지에 복사하지 않는다. OpenAI 키는 AI 런타임에만 전달한다.
- 실제 `.env`는 덮어쓰거나 커밋하지 않는다. 기존 서비스별 개인 설정은 확인 없이 삭제·이동하지 않는다.

## 커밋과 Pull Request

- 커밋 메시지와 PR 제목은 `<type>: <한국어 설명>` 형식을 사용한다.
  type은 `feat`, `fix`, `docs`, `refactor`, `test`, `chore`, `style`, `perf`, `build`, `ci`, `revert` 중 변경 목적에 맞게 선택한다.
  예: `feat: 작품 등록 기능 추가`, `fix: 중복 요청 처리 오류 수정`, `docs: 루트 환경설정 실행 방법 정리`.
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

- 코드 변경은 해당 서비스 지침의 필수 검증을 따른다. 작은 수정에 관계없는 빌드·반복 리뷰·새 환경을 추가하지 않는다.
- 문서만 변경하면 내용·로컬 링크·공백을 확인한다. 코드·실행 설정이 그대로면 이미지 빌드·서비스 전체 테스트를 반복하지 않는다.
- 실행하지 않은 검증을 통과했다고 쓰지 않는다. 완료 보고는 변경 범위·실행한 확인·남은 한계를 구분한다.

## graphify

This project has a knowledge graph at graphify-out/ with god nodes, community structure, and cross-file relationships.

When the user types `/graphify`, use the installed graphify skill or instructions before doing anything else.

Rules:
- For codebase questions, first run `graphify query "<question>"` when graphify-out/graph.json exists. Use `graphify path "<A>" "<B>"` for relationships and `graphify explain "<concept>"` for focused concepts. These return a scoped subgraph, usually much smaller than GRAPH_REPORT.md or raw grep output.
- Dirty graphify-out/ files are expected after hooks or incremental updates; dirty graph files are not a reason to skip graphify. Only skip graphify if the task is about stale or incorrect graph output, or the user explicitly says not to use it.
- If graphify-out/wiki/index.md exists, use it for broad navigation instead of raw source browsing.
- Read graphify-out/GRAPH_REPORT.md only for broad architecture review or when query/path/explain do not surface enough context.
- After modifying code, run `graphify update .` to keep the graph current (AST-only, no API cost).
