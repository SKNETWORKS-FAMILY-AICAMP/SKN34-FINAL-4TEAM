import { readFileSync } from 'node:fs'
import { expect, it } from 'vitest'

// jsdom은 CSS를 적용하지 않아 CSS 글자로 확인한다.
const css = readFileSync(new URL('./ai-serial.css', import.meta.url), 'utf8')
// 요일 라벨의 터치 높이 44px는 공용 episode.css가 준다(ai-serial.css는 높이를 건드리지 않는다).
const episodeCss = readFileSync(new URL('../../../shared/episode.css', import.meta.url), 'utf8')

it('[F3] 버튼과 이유 문구(.ep-form-actions)는 간격을 두고 한 줄에 나란히 놓인다 — 운영 설정과 같은 값', () => {
  expect(css).toMatch(/\.ep-serial \.ep-form-actions\{display:flex;flex-wrap:wrap;align-items:center;gap:8px 12px/)
})

it('[D3] 650px 이하에서 요일 일곱이 한 줄이다(7칸 균등 격자) — 390px에서 일요일만 둘째 줄로 떨어지던 것. 라벨 터치 높이 44px는 그대로다', () => {
  expect(css).toMatch(/@media\(max-width:650px\)\{\.ep-serial fieldset\{display:grid;grid-template-columns:repeat\(7,1fr\);gap:0\}\}/)
  expect(episodeCss).toMatch(/\.episode-app \.ep-check\{min-height:44px/)
})

it('[F4] 잠긴 .pri 버튼은 채운 보라가 아니라 윤곽선이라 눌러도 되는 버튼처럼 보이지 않는다 — 운영 설정의 잠긴 저장 버튼과 같은 모양', () => {
  expect(css).toMatch(/\.episode-app \.ep-serial \.btn\.pri:disabled\{background:none;border-color:var\(--line2\);color:var\(--ink\)\}/)
})

it('[Q2] 하위 탭은 14px·600이다 — 페이지 탭용 전역 15px·700이 탭 제목 h2(17px·700)와 겨루던 것. 선택 색·밑줄·높이 44px는 전역 .libtabs 규칙 그대로다', () => {
  expect(css).toMatch(/\.ep-serial \.libtabs :is\(button,a\)\{font-size:14px;font-weight:600\}/)
})
