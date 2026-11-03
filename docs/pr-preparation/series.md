# 세계관 작업실 PR 준비 목록

현재 승인 범위는 기존 개인 브랜치에 커밋·push하고 PR은 준비만 하는 것입니다. 실제 PR 생성·변경·병합·develop 직접 push는 하지 않습니다. 첫 PR은 직접 작성·저장·재조회이며 AI·확정 읽기·전체 지도·관계 편집을 섞지 않습니다.

원격 develop 확인: 7e6f7a0 (2026-11-03). 기존 01~04 패치와 SHA는 그대로 보존했습니다. 01~06은 최신 기준에 순차 적용 검사를 통과했고 기능 코드 78개 파일이 현재 구현과 일치합니다. 단계별 독립 테스트 기록은 2026-11-02의 09f3c9b 기준이며 최신 적용 검사와 구분합니다. 최신 develop에는 홈 원작 숨김 및 CI/CD 변경이 있어 검토/병합 전 원격 Required CI를 실제 확인해야 합니다. 브랜치를 reset/rebase/force push하지 않았습니다.

## 제안 순서

| 순서 | 제목 | 선행 | 검증/남은 조건 |
|---|---|---|---|
| 01 | [feat: 세계관 직접 작성·저장·재조회 추가](01-direct.md) | 없음 | 당시 독립 프런트36/Core61·타입·린트·빌드 통과, 최신 기준은 적용 검사 |
| 02 | [fix: 세계관 조회·소유권·복원 상태 보호](02-guardrails.md) | 01까지 | 당시 독립 프런트43/Core61·타입·린트·빌드 통과 |
| 03 | [feat: 선택적 세계관 분석과 후보 승인 분리](03-ai-review.md) | 02까지 | 당시 독립 프런트43/Core67/AI13·타입·린트·빌드 통과 |
| 04 | [feat: 확정 세계관 설정집·관계·시간선 표시](04-confirmed-views.md) | 03까지 | 당시 독립 프런트44/Core67/AI13·타입·린트·빌드 통과 |
| 05 | [feat: 저장된 세계관 전체 지도 탐색 추가](05-world-map.md) | 04까지 | 8964296 탐색 회귀/Aside 기록, 최신 적용 검사 |
| 06 | [feat: 인물 카드·자유 관계 편집과 안전한 삭제 추가](06-relationship-editor.md) | 05까지 | 로컬 관련 프런트25/Core13 통과, 카드 전체 반응형 E2E 미완료 |

PR 02~06은 각각 develop에서 독립 적용하는 기능이 아닙니다. 선행 PR 반영 뒤 develop 대상으로 준비하거나 의존 base를 분명히 해야 합니다. 실제 PR/브랜치는 여기서 생성하지 않았습니다.

패치·SHA-256·순차 적용·소스 일치 기록은 로컬 `output/share-ready/manifest-20261103.json`에 작성했습니다. 01~04의 기존 패치를 재생성하지 않습니다. 사용자 DB·환경 파일·로그·키·node_modules와 graphify-out은 제외합니다. 기존 통합 브랜치에서 일부 커밋만 골라 첫 PR로 만들지 말고 01 패치를 사용해야 합니다.

## 단위별 포함 파일

### 01 01-direct

```text
.env.example
.gitignore
README.md
backend/ai-service/README.md
backend/core-api/README.md
backend/core-api/build.gradle
backend/core-api/src/main/kotlin/ai/storyfork/core/_common/config/WebCorsConfig.kt
backend/core-api/src/main/kotlin/ai/storyfork/core/world/controller/WorldStudioAccessFilter.kt
backend/core-api/src/main/kotlin/ai/storyfork/core/world/controller/WorldStudioController.kt
backend/core-api/src/main/kotlin/ai/storyfork/core/world/domain/StudioWorld.kt
backend/core-api/src/main/kotlin/ai/storyfork/core/world/repository/WorldStudioStore.kt
backend/core-api/src/main/kotlin/ai/storyfork/core/world/service/WorldStudioService.kt
backend/core-api/src/main/resources/application.properties
backend/core-api/src/test/kotlin/ai/storyfork/core/_common/config/WebCorsConfigTest.kt
backend/core-api/src/test/kotlin/ai/storyfork/core/world/controller/WorldStudioAccessFilterTest.kt
backend/core-api/src/test/kotlin/ai/storyfork/core/world/service/WorldStudioServiceTest.kt
docs/architecture.md
docs/pr-preparation/01-direct.md
docs/pr-preparation/02-guardrails.md
docs/pr-preparation/03-ai-review.md
docs/pr-preparation/04-confirmed-views.md
docs/world-studio-direct.md
docs/world-studio-integration.md
docs/world-studio-sharing.md
docs/world-studio-validation.md
frontend/README.md
frontend/src/App.create-flows.test.tsx
frontend/src/App.library.test.tsx
frontend/src/App.tsx
frontend/src/App.world-studio.test.tsx
frontend/src/app/di/registerAppServices.ts
frontend/src/app/di/types.ts
frontend/src/data/world-studio/HttpWorldStudioRepository.test.ts
frontend/src/data/world-studio/HttpWorldStudioRepository.ts
frontend/src/domain/entities/studioSections.test.ts
frontend/src/domain/entities/studioSections.ts
frontend/src/domain/entities/studioWorld.ts
frontend/src/domain/repositories/WorldStudioRepository.ts
frontend/src/domain/usecases/LibraryUseCase.ts
frontend/src/domain/usecases/WorldStudioUseCase.ts
frontend/src/presentation/features/library/view/LibraryPage.tsx
frontend/src/presentation/features/library/view/NewWorkPage.tsx
frontend/src/presentation/features/library/viewmodel/useNewWorkViewModel.ts
frontend/src/presentation/features/studio/view/StudioPage.tsx
frontend/src/presentation/features/studio/view/WorldStudioPage.tsx
frontend/src/presentation/features/studio/view/world-studio.css
frontend/src/presentation/features/studio/viewmodel/useWorldStudioViewModel.test.tsx
frontend/src/presentation/features/studio/viewmodel/useWorldStudioViewModel.ts
frontend/src/presentation/shared/screenIds.ts
frontend/src/presentation/shared/shell/GlobalChrome.tsx
frontend/src/presentation/shared/shell/Gnb.tsx
frontend/src/styles/storyfork.css
frontend/src/test/worldStudioFetch.ts
infrastructure/scripts/run-native.py
```

### 02 02-issues

```text
frontend/src/domain/__tests__/LibraryUseCase.test.ts
frontend/src/domain/__tests__/StudioUseCase.test.ts
frontend/src/domain/usecases/LibraryUseCase.ts
frontend/src/domain/usecases/StudioUseCase.ts
frontend/src/presentation/features/library/viewmodel/useNewWorkViewModel.test.tsx
frontend/src/presentation/features/library/viewmodel/useNewWorkViewModel.ts
frontend/src/presentation/shared/useAsyncData.test.tsx
frontend/src/presentation/shared/useAsyncData.ts
```

### 03 03-ai-review

```text
.env.example
backend/ai-service/app/main.py
backend/ai-service/app/world_wiki/__init__.py
backend/ai-service/app/world_wiki/knowledge.py
backend/ai-service/app/world_wiki/minimal.py
backend/ai-service/app/world_wiki/minimal_validation.py
backend/ai-service/app/world_wiki/semantic.py
backend/ai-service/tests/test_initial_minimal.py
backend/ai-service/tests/test_world_studio_route.py
backend/core-api/src/main/kotlin/ai/storyfork/core/world/client/InitialWorldClient.kt
backend/core-api/src/main/kotlin/ai/storyfork/core/world/client/exception/InitialValidationException.kt
backend/core-api/src/main/kotlin/ai/storyfork/core/world/controller/WorldStudioController.kt
backend/core-api/src/main/kotlin/ai/storyfork/core/world/domain/InitialWorld.kt
backend/core-api/src/main/kotlin/ai/storyfork/core/world/domain/StudioWorld.kt
backend/core-api/src/main/kotlin/ai/storyfork/core/world/repository/WorldStudioStore.kt
backend/core-api/src/main/kotlin/ai/storyfork/core/world/service/WorldStudioService.kt
backend/core-api/src/test/fixtures/world-studio-ai-stub.py
backend/core-api/src/test/kotlin/ai/storyfork/core/world/domain/InitialMinimalTest.kt
backend/core-api/src/test/kotlin/ai/storyfork/core/world/service/WorldStudioServiceTest.kt
frontend/src/App.world-studio.test.tsx
frontend/src/data/api/initial-topics.json
frontend/src/data/api/initialWorld.ts
frontend/src/data/world-studio/HttpWorldStudioRepository.ts
frontend/src/domain/entities/studioWorld.ts
frontend/src/domain/repositories/WorldStudioRepository.ts
frontend/src/domain/usecases/WorldStudioUseCase.ts
frontend/src/presentation/features/studio/view/WorldStudioPage.tsx
frontend/src/presentation/features/studio/view/world-studio.css
frontend/src/presentation/features/studio/viewmodel/useWorldStudioViewModel.test.tsx
frontend/src/presentation/features/studio/viewmodel/useWorldStudioViewModel.ts
infrastructure/scripts/run-native.py
```

### 04 04-confirmed-views

```text
frontend/src/App.world-studio-confirmed.test.tsx
frontend/src/presentation/features/studio/view/WorldStudioPage.tsx
frontend/src/presentation/features/studio/view/world-studio.css
```

### 05 05-world-map

```text
docs/world-map.md
frontend/package.json
frontend/pnpm-lock.yaml
frontend/src/App.world-map.test.tsx
frontend/src/presentation/features/studio/view/WorldMap.test.tsx
frontend/src/presentation/features/studio/view/WorldMap.tsx
frontend/src/presentation/features/studio/view/WorldMapCanvas.test.tsx
frontend/src/presentation/features/studio/view/WorldMapCanvas.tsx
frontend/src/presentation/features/studio/view/WorldStudioPage.tsx
frontend/src/presentation/features/studio/view/world-map.css
frontend/src/presentation/features/studio/viewmodel/useWorldMapViewModel.test.tsx
frontend/src/presentation/features/studio/viewmodel/useWorldMapViewModel.ts
```

### 06 06-relationship-editor

```text
backend/core-api/src/main/kotlin/ai/storyfork/core/world/domain/InitialWorld.kt
backend/core-api/src/main/kotlin/ai/storyfork/core/world/service/WorldStudioService.kt
backend/core-api/src/test/kotlin/ai/storyfork/core/world/service/WorldStudioServiceTest.kt
docs/pr-preparation/01-direct.md
docs/pr-preparation/05-world-map.md
docs/pr-preparation/06-relationship-editor.md
docs/pr-preparation/series.md
docs/world-map.md
docs/world-relationship-edit.md
frontend/src/App.character-delete.test.tsx
frontend/src/App.character-registration.test.tsx
frontend/src/App.relationship-edit.test.tsx
frontend/src/App.relationship-prose.test.tsx
frontend/src/domain/entities/studioRelations.test.ts
frontend/src/domain/entities/studioRelations.ts
frontend/src/presentation/features/studio/view/CharacterCards.test.tsx
frontend/src/presentation/features/studio/view/CharacterCards.tsx
frontend/src/presentation/features/studio/view/WorldMap.tsx
frontend/src/presentation/features/studio/view/WorldRelationshipEditor.tsx
frontend/src/presentation/features/studio/view/WorldStudioPage.tsx
frontend/src/presentation/features/studio/view/world-map.css
frontend/src/presentation/features/studio/viewmodel/characterMap.test.ts
frontend/src/presentation/features/studio/viewmodel/characterMap.ts
frontend/src/presentation/features/studio/viewmodel/useWorldMapViewModel.ts
frontend/src/presentation/features/studio/viewmodel/useWorldStudioViewModel.test.tsx
frontend/src/presentation/features/studio/viewmodel/useWorldStudioViewModel.ts
```

## 상태와 제한

원격 Required CI는 미실행입니다. 기존 목업 전체 테스트 4개 실패는 당시 기준에서 재현한 별도 문제로 기록되어 있으며 최신 기준 전체 테스트 통과로 표현하지 않습니다. #48 전체 해결, 실제 인증/PostgreSQL/공개 정책 완성, #49 작품 생성 정책 구현으로 표시하지 않습니다. 최종 UI는 인물 카드·명시적 연결·자유 관계/방향별 감정 입력으로 구현했습니다. 최신 카드의 실제 1440/800/390px 전체 흐름과 저장·재조회·삭제 참조 보호 브라우저 통합 검증은 미완료이며 자동 테스트와 구분합니다. 서버 계약의 자유 타입 3종과 인물·관계 삭제 허용은 06에 포함합니다. DB 마이그레이션은 없습니다.

## 전달 전 최종 확인

2026-11-03 현재 소스에서 관련 프런트 14파일·25테스트와 타입 검사·oxlint·Vite 빌드를 다시 통과했습니다. Core 최근 로컬 결과 XML은 서비스 10개·minimal 계약 3개, 실패 0개입니다. Vite 메인 번들 500kB 초과 경고는 남습니다.

Ponytail 리뷰로 공통 편집본→원자적 적용→기존 저장 경로, 자유 원문과 기존 항목 보존, 삭제 참조 검사·되돌리기 무효화를 확인했습니다. 별도 의존성·그래프 저장소·DB 마이그레이션을 추가하지 않았습니다. 독립 검토의 카드 연결·입력·취소 Aside 확인과 전체 반응형 E2E 미완료를 구분합니다. 최신 develop 누적 패치 소스는 적용·일치만 검사했으며 그 소스에서 전체 테스트나 원격 CI를 실행한 것은 아닙니다.
