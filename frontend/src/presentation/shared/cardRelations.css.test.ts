import { readFileSync } from 'node:fs'
import { expect, it } from 'vitest'

const css = readFileSync(new URL('./cardRelations.css', import.meta.url), 'utf8')
const esc = (s: string) => s.replace(/[\\^$.*+?()[\]{}|]/g, '\\$&')
const rule = (selector: string) => css.match(new RegExp(esc(selector) + '\\{([^}]*)\\}'))?.[1] ?? ''

it('카드별 관계도 그림은 상자 폭(최대 640px)을 그대로 쓰고(고정 좌표 SVG, 축소 없음) 선은 확대·축소와 상관없이 1px다', () => {
  expect(rule('.card-relmap-svg')).toMatch(/width:100%;max-width:640px;height:auto/)
  expect(rule('.card-relmap-svg line')).toMatch(/stroke-width:1;vector-effect:non-scaling-stroke/)
  expect(rule('.card-relmap-svg line')).not.toMatch(/opacity/) // 흐리면 3:1 아래라 쓰지 않는다
})

it('그림 안 글자는 화면 기준 최소 크기다: 이름 12px·선 이름 11px이고 viewBox 가로가 화면 폭 그대로라(최대 640px) 축소가 없다', () => {
  expect(rule('.card-relmap-svg text')).toMatch(/font-size:12px/)
  expect(rule('.card-relmap-svg .card-relmap-edge')).toMatch(/font-size:11px/)
  expect(rule('.card-relmap-svg')).toMatch(/width:100%;max-width:640px;height:auto/) // 상자 폭을 그대로 viewBox 가로로 그리는 CardRelationMap과 짝이다
})

it('회차 탭은 고른 탭만 보라 글자·테두리이고, 이웃 링크 버튼은 밑줄 글자다', () => {
  expect(rule('.card-relmap-tabs button[role=tab][aria-selected=true]')).toMatch(/border-color:var\(--pri\);color:var\(--pri-ink\);font-weight:700/)
  expect(rule('.card-relmap-tabs')).toMatch(/flex-wrap:wrap/) // 좁은 화면에서 줄바꿈
  expect(rule('.card-relmap-link')).toMatch(/text-decoration:underline/)
})

it('터치 기기에서는 전역 터치 보정(누르는 칸 44px·입력 16px)을 이 화면이 직접 다시 정한다', () => {
  expect(css).toMatch(/@media\(pointer:coarse\)\{[\s\S]*\.card-relmap-tabs button\[role=tab\][^{]*\{min-height:44px\}/)
  expect(css).toMatch(/@media\(pointer:coarse\)\{[\s\S]*\.card-relmap-tabs select\{font-size:16px\}/)
})
