import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const css = readFileSync(new URL('../../../styles/storyfork.css', import.meta.url), 'utf8')
const rule = (selector: string) => css.match(new RegExp(`${selector.replace(/[.[\]]/g, '\\$&')}\\{([^}]*)\\}`))?.[1] ?? ''

describe('독서 화면(.cms) 안의 제보 행 테마', () => {
  // 전역 .rp는 --surface·--line·--ink2처럼 밝은 화면용 토큰이라, 밤 테마 독서 화면에서는 독서 테마 글자색(--tfg)과 겹쳐 읽히지 않는다.
  it('행 구분선과 보조 글자는 댓글(.cm)처럼 독서 테마 토큰(--tline·--tsub)을 쓴다', () => {
    expect(rule('.cms .rp')).toMatch(/border-bottom:\s*1px solid var\(--tline\)/)
    expect(rule('.cms .rp .muted')).toMatch(/color:\s*var\(--tsub\)/)
  })

  it('작가 답변·정정 상자는 독서 테마 강조색 위에 얹고 글자색은 독서 화면 것을 물려받는다', () => {
    const box = rule('.cms .rp .a')
    expect(box).toMatch(/background:[^;]*var\(--tacc/)
    expect(box).toMatch(/color:\s*inherit/)
    expect(box).not.toMatch(/var\(--(surface|line|muted-bg|ink2)\)/)
  })

  it('행 배경은 칠하지 않아 카드(--tcard) 색을 그대로 쓴다', () => {
    expect(rule('.cms .rp')).not.toMatch(/background/)
  })
})

describe('처리 뒤 포커스를 받는 제보 행 카드', () => {
  // 전역 포커스 링은 outline-offset:2px라 .list(overflow:hidden) 안의 전체 폭 행에서는 좌우가 잘린다. 안쪽으로 그려 키보드 위치가 보이게 한다.
  it('포커스 링을 안쪽으로 그려 .list 안에서도 잘리지 않는다', () => {
    expect(rule('.rp:focus-visible')).toMatch(/outline-offset:\s*-\d+px/)
  })
})
