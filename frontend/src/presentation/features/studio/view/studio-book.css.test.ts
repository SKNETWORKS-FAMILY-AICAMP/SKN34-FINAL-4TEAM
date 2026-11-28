import { readFileSync } from 'node:fs'
import { expect, it } from 'vitest'

const css = readFileSync(new URL('./studio-book.css', import.meta.url), 'utf8')

it('안 고른 왼쪽 패널은 지우지 않고 숨기기만 하므로 .writing-rail의 display를 hidden이 이기게 한다(#986)', () => {
  expect(css).toMatch(/\.writing-rail\[hidden\] \{\s*display:\s*none;?\s*\}/)
})

it('왼쪽 메뉴 폭은 이 집필실의 --writing-rail에만 더하고 세계관 설정 편집 화면(world-card-studio)의 틀은 건드리지 않는다', () => {
  expect(css).toMatch(/\.writing-studio:not\(\.world-card-studio\) \{[^}]*--writing-rail:\s*calc\(var\(--writing-panel\) \+ 64px\);/)
  expect(css).not.toMatch(/\.world-card-studio \{[^}]*--writing-rail/)
})

it('900px 이하에서는 메뉴가 가로 줄이 되고 설정 카드 목록은 한 줄 띠가 아닌 높이를 묶은 세로 목록이다', () => {
  const narrow = [...css.matchAll(/@media \(max-width: 900px\) \{([\s\S]*?)\n\}/g)].map((m) => m[1]).join('')
  expect(narrow).toMatch(/\.writing-menu \{[^}]*flex-direction:\s*row;/)
  expect(narrow).toMatch(/\.writing-book-list \{[^}]*flex-direction:\s*column;[^}]*max-height:/)
})

it('고급 모드(901~1200px)에서 플롯 패널이 아래로 내려가도 왼쪽 묶음(메뉴 + 패널)이 두 줄을 차지한다', () => {
  expect(css).toMatch(/@media \(min-width: 901px\) and \(max-width: 1200px\) \{ \.writing-with-plans \.writing-side \{ grid-row: 1 \/ 3; \} \}/)
})
