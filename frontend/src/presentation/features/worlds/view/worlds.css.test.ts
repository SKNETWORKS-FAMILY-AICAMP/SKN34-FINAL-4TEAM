import { readFileSync } from 'node:fs'
import { expect, it } from 'vitest'

// 렌더 없이 지키는 worlds.css의 터치 규칙. 같은 특이도의 규칙은 뒤에 온 것이 이기므로 순서까지 본다.
const css = readFileSync(new URL('./worlds.css', import.meta.url), 'utf8')

it('터치 기기에서는 캔버스가 페이지 스크롤을 막지 않게 d3-drag가 넣는 인라인 touch-action을 되돌린다', () => {
  expect(css).toMatch(/@media \(pointer: coarse\) \{\s*\.atlas-canvas canvas \{ touch-action: manipulation !important; \}/)
})

it('방향 이동 버튼은 기본으로 숨기고 터치 기기와 키보드로 컨트롤에 들어온 동안에만 보인다', () => {
  const hidden = css.indexOf('.atlas-foot .map-pan { display: none;')
  const coarse = css.search(/@media \(pointer: coarse\) \{\s*\.atlas-foot \.map-pan \{ display: flex; \}/)
  expect(hidden).toBeGreaterThan(-1)
  expect(coarse).toBeGreaterThan(hidden) // 숨김 규칙과 특이도가 같아 뒤에 와야 터치 기기에서 보인다
  expect(css).toContain('.atlas-foot .world-map-controls:has(:focus-visible) .map-pan { display: flex; }')
})

it('방향 이동 버튼은 좁은 화면과 터치 기기에서 44px 정사각이고 기본 크기 규칙보다 뒤에 온다', () => {
  const base = css.indexOf('.atlas-foot .map-pan .btn { width: 36px;')
  const touch = css.search(/@media \(max-width: 600px\), \(pointer: coarse\) \{[^@]*\.atlas-foot \.map-pan \.btn \{ width: 44px; height: 44px; \}/)
  expect(base).toBeGreaterThan(-1)
  expect(touch).toBeGreaterThan(base)
})

it('개요 탭의 구성 요약 알약은 좁은 화면과 터치 기기에서 44px이고 기본(36px) 규칙보다 뒤에 온다', () => {
  const base = css.indexOf('.worlds-overview-links a { display: inline-flex; min-height: 36px;')
  const touch = css.search(/@media \(max-width: 600px\), \(pointer: coarse\) \{[^@]*\.worlds-overview-links a \{ min-height: 44px; \}/)
  expect(base).toBeGreaterThan(-1)
  expect(touch).toBeGreaterThan(base)
})

it('범례는 좁은 화면에서도 숨은 가로 스크롤 없이 줄바꿈한다(390px에서 마지막 장르가 잘려 없는 것처럼 보이던 문제)', () => {
  expect(css).not.toMatch(/\.atlas-legend \{[^}]*overflow-x:/)
  expect(css).not.toMatch(/\.atlas-legend ul \{ flex: none; \}/) // 묶음이 줄어들지 않고 한 줄을 고집하지 않는다
  expect(css).toMatch(/\.atlas-legend ul \{[^}]*flex-wrap: wrap; gap: 4px 12px/) // 묶음 안의 항목도 줄바꿈한다(1440px의 한 줄은 그대로)
})

it('지도 카드(.worlds-atlas)는 홈 .hero의 가운데 정렬(align-items: center)을 이어받지 않고 칸 폭을 채운다 — 가운데면 .atlas-stage가 캔버스 폭(처음 500px)만큼 줄고 ResizeObserver가 그 폭을 다시 읽어 500px에 갇힌다. .hero의 flex-wrap: wrap도 끊는다 — 여러 줄 flex는 줄 폭을 가장 넓은 항목(캔버스 500px)으로 잡아 stretch가 그 폭까지만 늘린다(390px에서 126px 넘침)', () => {
  expect(css).toMatch(/\.worlds-atlas \{ display: flex; flex-direction: column; flex-wrap: nowrap; align-items: stretch; \}/)
})

it('지도 컨트롤 다섯은 같은 옅은 윤곽선(.atlas-foot .btn)이고 채운 보라 규칙(.btn.pri)은 없다 — 가끔 쓰는 다시 배치가 어두운 지도에서 가장 진한 면이던 것을 거뒀다(quieter)', () => {
  expect(css).toContain('.atlas-foot .btn { background: color-mix(')
  expect(css).not.toMatch(/\.atlas-foot \.btn\.pri/)
})
