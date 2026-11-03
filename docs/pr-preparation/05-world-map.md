# feat: 저장된 세계관 전체 지도 탐색 추가

저장된 승인 설정의 인물·장소·조직·규칙·사건·관계를 react-force-graph-2d로 탐색합니다. 검색·필터·목록·상세와 움직임/확대 제어를 제공하고 Canvas 위치 객체를 정본에서 분리합니다.

01~04 이후 적용하는 순차 제안입니다. 읽기 전용이며 관계 편집은 06입니다. 회차별 공개·실제 인증·그래프 DB·배치 저장은 포함하지 않습니다.

커밋 8964296의 검증 기록은 [전체 지도](../world-map.md)를 참고합니다. 초기 ref null과 사건 순서 방향 회귀를 보존합니다. 현재 06 통합본 관련 테스트에서도 탐색 회귀는 통과했습니다. 원격 Required CI 미실행, PR 미생성입니다.

최신 develop 7e6f7a0에 01~05 순차 적용 검사를 통과했습니다. 적용 검사는 이 단계의 최신 기준 독립 빌드/동작 검증을 대체하지 않습니다.

## 포함 파일

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
