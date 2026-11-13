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

/** 규칙(선택자 { 본문 }) 목록: 쉼표로 이어진 선택자도 한 규칙으로 읽어 선택자 글자 안에서 찾는다. */
const rules = [...css.matchAll(/([^{}]+)\{([^}]*)\}/g)].map(([, selector, body]) => ({ selector: selector.trim(), body }))
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

it('관계 기준 회차 라벨은 한 줄 flex라 "관계 기준 [입력] 화"가 줄바꿈으로 떨어지지 않는다', () => {
  expect(rule((s) => s === '.relationship-episode label')?.body).toMatch(/display:\s*flex/)
})
