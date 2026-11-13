# STORYFORK 공통 지침

이 파일은 저장소 전체에 적용한다. 서비스 파일을 바꾸면 해당 `AGENTS.md`도 함께 따른다.

- `frontend/**` → [Frontend](frontend/AGENTS.md)
- `backend/core-api/**` → [Core](backend/core-api/AGENTS.md)
- `backend/content-service/**` → [Content](backend/content-service/AGENTS.md)
- `backend/ai-service/**` → [AI](backend/ai-service/AGENTS.md)

## 목표

STORYFORK는 다중 AI 에이전트 기반 독자 참여형 스토리 창작·피드백 플랫폼이다.
이번 프로젝트의 목표는 상용 서비스가 아니라 **빠른 완성과 시연**이다. 화면의 버튼·흐름이 실제로 동작하는 것을 우선하며
보안 하드닝·운영 대비는 범위 밖이다. 제품 흐름은 [README](README.md), 실행 구조는 [아키텍처](docs/architecture.md)를 본다.

## 강제 지침

1. **TDD**: 로직 변경은 실패하는 단위 테스트를 먼저 작성하고 최소 구현으로 통과시킨다(Red → Green → Refactor).
   화면·버튼 연결만 바꾼 경우는 사유를 남기고, 문서·설정 변경은 테스트하지 않는다.
2. **아키텍처·설계 문서대로 개발**: 개발 전에 관련 설계 문서([설계](docs/design/design.md), [결정](docs/design/decisions.md),
   [서비스 경계](docs/design/service-boundaries.md), [유스케이스](docs/usecase.md))와 서비스 지침을 확인한다.
   구현 중 문서와 다르거나 빠진 부분이 생기면 같은 작업에서 문서를 보완한다. 문서에 없는 정책은 임의로 확정하지 않고 묻는다.
3. **로컬은 단위 테스트만**: 변경 범위의 단위 테스트만 실행한다. 통합·시스템·브라우저·전체 테스트와 빌드는 CI가 실행하며,
   로컬에서는 사용자가 요청할 때만 실행한다. 명령은 [개발 문서](docs/development.md#검증)와 서비스 지침을 따른다.
4. **Git workflow**: 브랜치 `<type>/<영문-소문자-설명>`, 커밋·PR 제목 `<type>: <한국어 설명>`
   (type: feat, fix, docs, refactor, test, style, perf, build, ci, chore, revert). 작업 브랜치에서 PR을 만들고
   `main`·`develop` 직접 푸시와 PR 병합은 사용자 확인 없이 하지 않는다. 커밋·PR 본문은 한국어로 쓰고,
   PR 본문은 변경 → 동작 → 결정 → 한계 → 남은 일 → 검증 → 한 줄 요약 순서로 실제 검증 결과를 적는다.
   `gh`가 설치돼 있으면 흐름은 이슈 → 작업 브랜치 → PR(본문에 `Closes #<이슈>`) → 사용자 확인 후 병합이다. '남은 일' 중 독립적으로 실행할 수 있는
   항목은 기존 이슈 중복을 확인한 뒤 후속 이슈로 만든다(보류·이슈화 금지로 정한 항목은 제외).
5. **최소 안전**: 실제 `.env`·키를 커밋하거나 `VITE_*`·프론트 번들에 넣지 않는다(설정은 루트 `.env` 하나, 공유는 `.env.example`).
   공유 DB 데이터를 승인 없이 삭제하지 않는다.

[`.agent-hooks/guard.py`](.agent-hooks/guard.py)가 Claude Code·Codex·Hermes에서 Git workflow·`.env` 커밋을 검사하고,
작업 종료 시 코드 변경마다 한 번 TDD·아키텍처·단위 테스트·이슈/PR 점검을 요청한다.

## 아키텍처

- **Frontend**: TypeScript, Clean Architecture·MVVM. 단일 공개 진입점의 `/api`로 백엔드 공개 API만 호출한다(AI·DB 직접 호출 금지).
- **Core**(`core-api`): 회원·인증·세션·크레딧·정산·회원 알림의 정본.
- **Content**(`content-service`): 작품·세계관·회차·원고·버전·Fork·발행·독서·검색·피드백·첨부와 콘텐츠 인가.
- **운영**(`operations-service`): 고객지원·공지·신고·감사. 회원·콘텐츠 실제 조치는 소유 서비스에 요청한다. 현재 골격만 있다.
- **AI**(`ai-service`): 허용 문맥에서 요청받은 생성·시뮬레이션·검토 결과만 반환한다. 정본 수정·권한·발행·정산을 판단하지 않는다.
  Agent 역할마다 서버를 만들지 않는다.
- 백엔드는 기능 중심 레이어드 구조다. 서비스 경계는 [DEC-41](docs/design/service-boundaries.md)과
  [이관 계약](docs/design/content-service-migration-contract.md)을 따른다.
- 요청한 기능만 가장 단순하게 구현한다. 미래 대비 계층·추상화·인프라, 요청 밖 리팩터링·이동·삭제,
  기존 API·lockfile 임의 변경을 하지 않는다. 새 production 의존성·외부 서비스는 먼저 알린다.
- 실패를 성공 응답이나 임의 fallback으로 숨기지 않는다. 화면의 로딩·실패·완료는 실제 API 결과와 일치시킨다.

## 도메인 핵심

- 원작·Fork·초안·시뮬레이션 상태를 구분한다. Fork는 기준 회차·버전을 보존하고, 최초 수정 전에는 원본 변경을 따라가며
  독립 후에는 알림과 사용자 선택으로만 반영한다(DEC-37).
- 설정은 항목별 공개·비공개와 회차별 공개 범위를 두며 기본은 비공개다. AI 제안과 사용자 승인·실제 반영을 구분한다(DEC-36).
- 저장: PostgreSQL은 원문·버전·체크포인트·Fork, 관계는 Neo4j 현재 상태 하나만 정본이다(관계 이력·과거 복원 없음,
  [#132 계약](docs/design/worldstudio-independent-schema.md#현재-관계-mvp-계약--132)). `pg_git`은 쓰지 않는다.
- 기능을 완료하면 [기능표](docs/feature-roadmap.md)의 해당 행 체크를 실제 상태대로 갱신한다.

## 권장 스킬·도구

설치되어 있으면 사용하고 없으면 건너뛴다. 강제가 아니다.

| 스킬·도구 | 사용 시점 |
|---|---|
| `ponytail` (저장소 `.agents/skills`에 포함) | 구현 시 full 모드, 완료 전 `ponytail-review`로 과잉 설계 점검 |
| `graphify` | 코드 탐색 시 grep·파일 전체 읽기 전에 `graphify query/explain/path` |
| `code-review` (CodeRabbit CLI) | 완료 전 변경분 리뷰 |
| `aside-browser` | 사용자가 요청할 때 화면 버튼 동작 확인 |
| `impeccable` | 화면 디자인·UI 개선 |

훅·스킬 설정 방법은 [개발 문서](docs/development.md#에이전트-훅스킬)를 본다.
