# feat: 인물 카드·자유 관계 편집과 안전한 삭제 추가

기존 세계관 작업실의 인물 입력과 모든 비인물 메뉴를 유지하면서 같은 ID의 인물 카드를 제공합니다. 이름만 입력해도 카드가 생기며 관계를 자동 생성하지 않습니다. 카드의 정보 편집·관계 연결 버튼을 분리하고, 카드 본문 드래그는 위치만 옮깁니다.

관계 연결 → 상대 선택 → 실제 관계와 양방향 감정 자유 입력 → 편집본 적용 → 공통 저장 순서입니다. 같은 두 사람 사이의 여러 관계·감정과 기존 항목 ID·원문을 유지하고, 패널 적용은 전체 검증 후 한 번에 반영합니다. 저장 실패 시 편집본은 유지됩니다. 인물 삭제는 함께 제거할 연결을 먼저 보여주고 다른 설정의 참조가 있으면 막으며, 후속 수정이나 저장 전에는 되돌릴 수 있습니다.

## 서버 계약과 호환

DB 마이그레이션과 별도 그래프 저장소는 없습니다. 기존 PUT 저장 계약에 `custom_relation`, `custom_relation_directed`, `custom_emotion` 타입을 추가합니다. 자유 문구는 원문 그대로 보존하며 기존 타입을 자동 변환하지 않습니다. 인물·관계 항목의 명시적 제거를 허용하되 남은 참조를 검증하고 기존 revision 이력을 유지합니다. 다른 종류의 설정 삭제는 허용하지 않습니다.

기존 자동 이름·설명과 정확히 같은 필드만 구조 변경에 맞춥니다. 별도 작가 서술과 자유 입력 본문은 유지합니다. 자동 형식과 완전히 같은 기존 enum 수동 문구는 구분할 수 없어 동기화되며, 이미 어긋난 과거 문구는 추측해 일괄 변경하지 않습니다.

## 검증과 제한

로컬 관련 프런트 14파일 25테스트, Core 서비스 10개·minimal 계약 3개 테스트 통과. 타입 검사·변경 영역 oxlint·Vite/Core JAR 빌드 결과는 [구현 기록](../world-relationship-edit.md)에 구분합니다. 독립 검토에서 관련 4파일 8테스트를 재실행했고, Aside로 5181 작업실의 기존 메뉴 유지·카드 연결·상대 선택·자유 감정 입력·취소를 확인했습니다.

현재 카드 화면의 실제 1440/800/390px 전체 흐름, 최종 저장·재조회와 삭제 참조 보호의 브라우저 통합 검증은 아직 완료하지 않았습니다. 해당 동작의 자동 테스트와 이전 노드 실험 기록을 최신 카드 E2E 완료로 대신하지 않습니다. 실제 모델 호출·운영 환경·원격 Required CI는 미실행입니다.

01~05 이후 적용하는 후속 단위이며 첫 PR에 포함하지 않습니다. Refs #48 부분 구현, #49 범위 밖입니다. 개인 브랜치 commit/push와 분리 패치 준비만 수행하며 실제 PR 생성·변경·병합·develop 직접 push는 하지 않습니다.

## 포함 파일

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
