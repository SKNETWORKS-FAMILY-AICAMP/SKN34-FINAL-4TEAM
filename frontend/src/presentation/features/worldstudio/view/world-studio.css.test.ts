import { readFileSync } from 'node:fs'
import { expect, it } from 'vitest'

const css = readFileSync(new URL('./world-studio.css', import.meta.url), 'utf8')

it('편집 화면의 파일 선택은 기본 입력을 시각적으로만 숨기고(초점·스크린리더는 유지) 라벨 버튼에 초점 링을 그린다', () => {
  const input = css.match(/\.world-card-studio \.ep-file-pick input\[type=file\]\{([^}]*)\}/)?.[1] ?? ''
  expect(input).toMatch(/position:\s*absolute/)
  expect(input).toMatch(/opacity:\s*0/)
  expect(input).not.toMatch(/display:\s*none|visibility:\s*hidden/)
  expect(css).toMatch(/\.world-card-studio \.ep-file-pick:has\(input:focus-visible\)\{[^}]*outline:/)
})

it('고른 인물 문서 버튼(aria-current)은 레일의 고른 분류 칩(aria-pressed)과 같은 모양으로 드러난다', () => {
  expect(css).toMatch(/\.world-rail-kinds button:is\(\[aria-pressed=true\],\[aria-current=true\]\)\{[^}]*border-color:[^}]*background:/)
})
