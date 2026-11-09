# WorldStudio 후속 이슈 재평가 — 2026-11-09

기준: `origin/develop` **7b36709c0208a4133e753d00de470fe70179fde5**. GitHub의 배정 이슈·PR 상태와 이 SHA의 소스를 대조했다. 실행 결과가 아닌 항목은 소스 확인으로 표시한다. 이 문서는 버그 수정이나 이슈 종료를 의미하지 않는다.

## 작업 경계

- [PR #160](https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/pull/160)은 사용자 결정에 따라 **발표용으로 보존**한다. 현행 서비스 이관·충돌 해결·병합·삭제 대상에서 제외한다.
- [#118](https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/issues/118)과 [#130](https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/issues/130)의 기존 수정 이관은 별도 구현 작업에서 진행한다. #118 보완은 [PR #185](https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/pull/185)로 제출됐다. 문서 작성 시점 열린 상태다.
- [#138](https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/issues/138)은 [PR #183](https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/pull/183), HEAD `1207c7c1770b021fb79f968ba0a440b92ee1f2b7`의 Required CI 성공을 확인했다. 로컬 순수 단위 9건, CI Web 단위·통합·선택 HTTP 시스템 검증 통과. 실제 브라우저 확인과 병합이 남아 있어 이슈는 열린 상태다.
- #7/#10/#30/#33은 기존 지시대로 최신 상태만 재평가한다. 구형 데모를 위한 임시 구조나 새로운 권한·버전 정책을 구현하지 않는다. #48은 에픽으로 유지한다.

## 서로 다른 세 경로

| 경로 | 실제 연결 | 판단 |
|---|---|---|
| `/worldstudio/:worldId?` | 일반 모드: `WorldStudioUseCase → HttpWorldStudioRepository → /api/v1/world-studios`. `mockup` 모드: `WorldStudioUseCase → InMemoryWorldStudioRepository` | 일반 모드만 Content HTTP API에 연결됨. 발표용 `mockup` 모드는 서버에 저장하지 않으며 새로고침하면 데이터가 초기화됨 |
| `/new` 및 `/worlds → /new` | `LibraryUseCase → InMemoryWorldRepository` | 구형 세계관 관리가 여전히 존재. 서버 저장 화면과 구분하는 안내가 있음 |
| 구형 집필실 사전 | `StudioUseCase`, `useStudioViewModel` | 메모리 목업의 사전 수정 흐름. 정본 작품에 대한 통째 쓰기는 차단됨 |

근거: [DI](../frontend/src/app/di/registerAppServices.ts), [목업 DI](../frontend/src/app/di/registerMockupServices.ts), [라우트](../frontend/src/App.tsx), [새 소설 화면](../frontend/src/presentation/features/library/view/NewWorkPage.tsx), [HttpWorkRepository](../frontend/src/data/content/HttpWorkRepository.ts).

일반 모드의 `workRepository`는 `HttpWorkRepository`이며 `listWorlds()`는 빈 목록, `saveWork()`는 명시적 미지원 오류를 반환한다. `worldRepository`는 여전히 메모리 구현이다. 목업 모드와 일반 모드의 호출 결과를 같다고 가정하면 안 된다.

## 후속 이슈별 판정

| 이슈 | 최신 소스 확인 | 현재 유효성·처리 | 부족한 검증 |
|---|---|---|---|
| [#7](https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/issues/7) | `StudioUseCase.open/worldRules/savePublishSettings`는 `workRepository.listWorlds`, `ownedWorld`는 `worldRepository.list` 사용 | 분기는 남아 있음. 일반 모드에서는 두 구현이 이미 다르지만 정본 집필실이 별도 경로이고 구형 통째 쓰기는 차단됨. 구형 사전의 실제 API 이관 계약에서 조회 경로를 통일할 후보로 유지 | 화면별 잘못된 세계관 표시의 실제 재현은 미실행 |
| [#10](https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/issues/10) | `queue`는 `sync.current`에 자신을 연결하지만 `run`은 앞선 작업만 기다림. `addDocProp/toggleWho/addLink` 등은 여전히 `run` 사용 | 비동기 수정의 경쟁 가능성은 남음. 현재 WorldStudio HTTP 저장과 다른 사전 경로이므로 API 연결 시 순서/충돌 계약과 함께 처리. 메모리 데모용 큐 구조를 추가하지 않음 | 실제 HTTP 사전 동시 저장 경로 없음. 데이터 손실 실행 재현 미실행 |
| [#30](https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/issues/30) | `combineWorlds`가 선택 규칙을 직접 읽고 `editWorld/restoreWorld/deleteWorld`의 소유자 검사가 빠져 있음. `getWorlds`와 UI는 공개 규칙·내 세계관을 필터함 | 도메인 경계의 결함 후보로 유지. `/new`가 남아 있으므로 도달 불가능·폐기 완료로 처리할 수 없음. 현재 Content WorldStudio의 소유권 검사와 혼동하지 않음 | 정상 UI로 타인 비공개 규칙에 접근하거나 변경하는 사례는 미재현 |
| [#33](https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/issues/33) | `restoreWorld`의 false를 확인 필요로 취급하고 재호출 결과를 검사하지 않은 채 성공 안내. `MyWorld`의 빈 이력은 선택값 -1이고 복원 버튼은 존재 | 구형 데모의 실패 표시 결함 후보로 유지. 현재 WorldStudio 전체 복원은 별도 계약상 미지원이며 이 경로를 재사용하지 않음 | 일반 UI만으로 빈 이력을 만드는 정상 경로와 실제 클릭 재현 미확인 |
| [#48](https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/issues/48) | PostgreSQL·Neo4j·Content HTTP 및 프런트 연결이 추가됨 | 과거의 ‘Core API 없음·메모리뿐’ 설명은 갱신 필요. 아래 수용 기준별로 부분 구현과 미구현을 분리하고 열린 상태 유지 | 실제 배포·브라우저 전체 수용 검증은 이번 점검 범위 밖 |

근거: [StudioUseCase](../frontend/src/domain/usecases/StudioUseCase.ts), [사전 ViewModel](../frontend/src/presentation/features/studio/viewmodel/useStudioViewModel.ts), [LibraryUseCase](../frontend/src/domain/usecases/LibraryUseCase.ts), [복원 ViewModel](../frontend/src/presentation/features/library/viewmodel/useNewWorkViewModel.ts).

## #48 수용 기준 매핑

‘구현 확인’은 소스·병합·CI 근거이며 운영 배포 또는 전체 수용 완료를 뜻하지 않는다. 아래 번호는 이슈 본문의 체크리스트 순서다. 이슈 전체를 완료 처리하지 않는다.

| 번호 | 수용 기준 | 현재 근거 | 남은 범위 |
|---|---|---|---|
| 1 | 소유 세계관 생성·목록·상세 | #142의 인증된 Content HTTP와 소유자 검증, 프런트 생성·조회 연결 | 실제 계정·배포 브라우저 수용 확인 |
| 2 | 설정 문서 등록·조회·편집·분류·태그 | #112~#115 UI, 카드 8종·영역 7종 및 #142 HTTP 직렬화 | 미병합 #118/#130 수정, 사용자 수용 확인 |
| 3 | 이미지 10개·참고 URL·접근 권한 | 현재 WorldStudio 카드 DTO/프런트에서 이 전체 흐름 확인되지 않음 | 별도 기능·권한·참조 안전성 계약 및 연결 |
| 4 | 기본 비공개·항목 및 회차별 공개 설정 | 프런트 HTTP 저장은 `visibility: private`, 서버 소유권 검증 | 작업실에서의 공개 변경 UI·회차 공개 연결. 일반 공개 작품 wiki 구현과 구분 |
| 5 | 자동저장 초안과 명시 확정 버전 분리 | 초안 PUT와 카드 revision POST는 서버에 존재 | 프런트 저장 버튼은 현재 초안 PUT만 호출. 자동저장/명시 revision 생성 UX 미연결 |
| 6 | 이전 버전 조회·복원·이력 보존 | 카드 revision 조회와 내부 불변 버전 계층 존재 | 현재 관계 이력 없음. 전체 restore는 명시적 미지원이며 작업실 복원 UI/API를 완료로 볼 수 없음 |
| 7 | 기존 UI와 공개 API 연결·실패 표시 | #142에서 `/api/v1/world-studios` 연결, 실패·응답 검증 및 재시도 입력 보존 | 이슈의 ‘Core’는 현재 소유 서비스인 Content로 구분. 구형 사전의 서버 연결은 별도 |
| 8 | 소유권·수정권한·회차공개 검증 | Content 서비스 `owned`/`lockOwned`, 소유자 아닌 접근 거부 | 이력·이미지·회차별 공개 전체 경계 수용 확인 |
| 9 | PostgreSQL 원문·버전·초안과 그래프 관계 | #97/#98 내부 저장·이력, #142 현재 Neo4j 관계 연결 | 현재 관계만 정본이며 과거 관계 버전·전체 시점 복원을 구현한 것은 아님 |
| 10 | 작품·회차·Fork·AI 경계 | #142 계약은 현재 관계/카드와 실패 상태를 분리 | 관계 포함 체크포인트·Fork·AI 승인 연결은 후속. 새 정책 자동 구현 금지 |
| 11 | 재조회 후 저장 유지·실패 비성공 표시 | HTTP 재조회·입력 검증·버전 검사·재시도 코드와 CI | 실제 배포/새로고침 브라우저 검증 별도 |
| 12 | 본인·타인·기본비공개·회차 공개 거부 검증 | HTTP 소유권 테스트 존재 | 항목 이미지·회차 공개까지 포함한 전체 수용 미완료 |
| 13 | 자동/확정 구분·반복 확정·복원·실패 보존 | 카드 불변 버전 서버 계층과 실패 보호 | 프런트 자동/확정/복원 미연결, 관계 이력 미지원 |
| 14 | 이미지 제한·권한·참조 안전성 | WorldStudio 전용 전체 흐름은 미확인 | 이미지 등록 기능 및 수용 검증 후속 |
| 15 | 자동화·브라우저·접근성 전체 검증 | 기존 기능 PR의 Required CI 성공 확인 | 브라우저 생성→작성→확정→재조회 및 권한·실패 수용 미실행 |

현재 계약상 가장 중요한 구분: **일반 모드 작업실의 ‘저장’은 현재 초안 PUT이며 카드 revision POST·공개·발행을 자동 실행하지 않는다.** 현재 관계는 Neo4j 상태 하나이며 과거 관계로 복원하지 않는다. 발표용 `mockup` 모드의 저장은 메모리에만 반영되므로 이 서버 저장 설명에 포함하지 않는다. 과거 #97의 내부 버전 구현만 보고 현행 전체 복원 완료로 표시하면 안 된다.

근거: [현재 관계 MVP 계약](design/worldstudio-independent-schema.md), [HTTP Controller](../backend/content-service/src/main/kotlin/ai/storyfork/content/world/controller/WorldStudioController.kt), [서비스](../backend/content-service/src/main/kotlin/ai/storyfork/content/world/service/WorldStudioService.kt), [프런트 HTTP 저장소](../frontend/src/data/world-studio/HttpWorldStudioRepository.ts).

## 병합·검증 근거

GitHub에서 다음 PR이 MERGED이고 각 PR 최신 head의 Required CI가 SUCCESS인 것을 확인했다. #114처럼 중간 브랜치에 병합된 PR은 최종 작업실의 develop 반영과 PR 상태를 구분한다.

| PR | HEAD |
|---|---|
| [#97](https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/pull/97) | `3ded47e00f374c708a78f7d5b9718cc6e20fd79c` |
| [#98](https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/pull/98) | `d961a7af97ece581d4136adcc75cc80171cd5863` |
| [#112](https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/pull/112) | `7e971f68f8063c9b59f1cc54a33721a31b23747c` |
| [#113](https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/pull/113) | `5400a896ebd856b1d5449dbd251cf658e7cdd736` |
| [#114](https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/pull/114) | `62ff9e64b10c345c52572ebb9682ef9ee14716b4` |
| [#115](https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/pull/115) | `d8ce22af3869fabcba654b4551107705c34b9705` |
| [#133](https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/pull/133) | `34076e61831f7c0f8f9578ce90bf802d1ab66769` |
| [#137](https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/pull/137) | `4b1cdb42077aeb504ffc3f2583a58e0bb7adc79a` |
| [#142](https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/pull/142) | `f40d1f55b075fd7e2a2cf6c579c52fdcdc5a8361` |

#116 및 #126~#128의 기존 수정은 소스에 남아 있다. `editStudioSetting`의 라벨 메타데이터 처리, `mapConnectionLabel`의 방향·원문 표시와 Canvas 연결을 확인했다. 이 문서에서는 기능을 다시 구현하거나 이슈를 닫지 않는다.

이번 변경은 문서뿐이며 로컬 링크·내용·공백을 확인한다. 앱 테스트·빌드·DB·브라우저는 실행하지 않는다. Graphify CLI와 graph.json이 없어 관련 호출을 실제 소스로 대조했다. 기능표의 완료 체크는 변경하지 않는다.
