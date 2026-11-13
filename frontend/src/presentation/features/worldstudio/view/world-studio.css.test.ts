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

/** 규칙(선택자 { 본문 }) 목록: 쉼표로 이어진 선택자도 한 규칙으로 읽어 선택자 글자 안에서 찾는다. 주석은 지워 앞 주석이 선택자에 붙거나 주석 속 `{}`가 규칙으로 읽히지 않게 한다. */
const rules = [...css.replace(/\/\*[\s\S]*?\*\//g, '').matchAll(/([^{}]+)\{([^}]*)\}/g)].map(([, selector, body]) => ({ selector: selector.trim(), body }))
const rule = (matches: (selector: string) => boolean) => rules.find((r) => matches(r.selector))

it('관계 기준 회차 입력은 독자 공개 회차 입력과 같은 크기·숫자 폭이고, 잠기면 같은 비활성 모양이라 편집할 수 있어 보이지 않는다', () => {
  const size = rule((s) => s.endsWith('.inp') && s.includes('.world-reveal') && s.includes('.relationship-episode'))
  expect(size?.body).toMatch(/min-height:\s*44px/)
  expect(size?.body).toMatch(/tabular-nums/)
  const disabled = rule((s) => s.endsWith('.inp:disabled') && s.includes('.world-reveal') && s.includes('.relationship-episode'))
  expect(disabled?.body).toMatch(/opacity:\s*\.55/)
  expect(disabled?.body).toMatch(/cursor:\s*not-allowed/)
  expect(rule((s) => s === '.relationship-episode .inp')).toBeUndefined() // 크기를 따로 덮어쓰지 않는다
})

// .episode-app 틀의 form(grid)·label(block)·input(폭 100%) 규칙을 순서와 무관하게 이기려면 `.episode-app`을 붙인 선택자여야 한다(이유는 world-studio.css 주석).
const scoped = (tail: string) => rule((s) => s === `.episode-app .relationship-episode ${tail}`)?.body

it('관계 기준 회차 폼은 .episode-app의 grid를 이기고 한 줄 flex로 줄바꿈만 하며, 접두어 없는 규칙은 남기지 않는다', () => {
  const form = scoped('form')
  expect(form).toMatch(/display:\s*flex/)
  expect(form).toMatch(/flex-wrap:\s*wrap/)
  expect(rule((s) => s === '.relationship-episode form')).toBeUndefined() // .episode-app form과 비겨 순서에 지는 규칙
})

it('관계 기준 회차 라벨은 .episode-app의 block을 이기고 "관계 기준 [입력] 화"를 한 덩어리 inline-flex로 묶는다', () => {
  expect(scoped('label')).toMatch(/display:\s*inline-flex/)
  expect(rule((s) => s === '.relationship-episode label')).toBeUndefined()
})

it('관계 기준 회차 입력은 .episode-app의 큰 입력 규칙(폭 100%·패딩·위 여백)을 이기고 독자 공개 회차 입력의 폭·패딩으로 줄인다', () => {
  const input = scoped('input:not([type=checkbox]):not([type=radio])') // 이 규칙의 :not()까지 베껴야 특이도가 위(0,4,1)다
  expect(input).toMatch(/width:\s*88px/)
  expect(input).toMatch(/padding:\s*8px 10px/)
  expect(input).toMatch(/margin-top:\s*0/) // 위 여백이 남으면 라벨 안에서 입력이 글자보다 아래로 처진다
  expect(input).not.toMatch(/font/) // 터치 기기의 16px(확대 방지) 보정은 .episode-app 규칙이 계속 맡는다
})
