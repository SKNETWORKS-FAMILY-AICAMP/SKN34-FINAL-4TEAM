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
