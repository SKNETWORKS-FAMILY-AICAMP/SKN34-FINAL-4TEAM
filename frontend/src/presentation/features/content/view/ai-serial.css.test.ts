import { readFileSync } from 'node:fs'
import { expect, it } from 'vitest'

// jsdom은 CSS를 적용하지 않아 CSS 글자로 확인한다.
const css = readFileSync(new URL('./ai-serial.css', import.meta.url), 'utf8')

it('[F3] 버튼과 이유 문구(.ep-form-actions)는 간격을 두고 한 줄에 나란히 놓인다 — 운영 설정과 같은 값', () => {
  expect(css).toMatch(/\.ep-serial \.ep-form-actions\{display:flex;flex-wrap:wrap;align-items:center;gap:8px 12px/)
})

it('[F4] 잠긴 .pri 버튼은 채운 보라가 아니라 윤곽선이라 눌러도 되는 버튼처럼 보이지 않는다 — 운영 설정의 잠긴 저장 버튼과 같은 모양', () => {
  expect(css).toMatch(/\.episode-app \.ep-serial \.btn\.pri:disabled\{background:none;border-color:var\(--line2\);color:var\(--ink\)\}/)
})
