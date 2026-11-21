import { readFileSync } from 'node:fs'
import { expect, it } from 'vitest'

const css = readFileSync(new URL('./cardRelations.css', import.meta.url), 'utf8')
const esc = (s: string) => s.replace(/[\\^$.*+?()[\]{}|]/g, '\\$&')
const rule = (selector: string) => css.match(new RegExp(esc(selector) + '\\{([^}]*)\\}'))?.[1] ?? ''

it('카드별 관계도 그림은 상자 폭에 맞춰 줄고(고정 좌표 SVG) 선은 확대·축소와 상관없이 1px다', () => {
  expect(rule('.card-relmap-svg')).toMatch(/width:100%;max-width:560px;height:auto/)
  expect(rule('.card-relmap-svg line')).toMatch(/stroke-width:1;vector-effect:non-scaling-stroke/)
  expect(rule('.card-relmap-svg line')).not.toMatch(/opacity/) // 흐리면 3:1 아래라 쓰지 않는다
})

it('회차 탭은 고른 탭만 보라 글자·테두리이고, 이웃 링크 버튼은 밑줄 글자다', () => {
  expect(rule('.card-relmap-tabs button[role=tab][aria-selected=true]')).toMatch(/border-color:var\(--pri\);color:var\(--pri-ink\);font-weight:700/)
  expect(rule('.card-relmap-tabs')).toMatch(/flex-wrap:wrap/) // 좁은 화면에서 줄바꿈
  expect(rule('.card-relmap-link')).toMatch(/text-decoration:underline/)
})
