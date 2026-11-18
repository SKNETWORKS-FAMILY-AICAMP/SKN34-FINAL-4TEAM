import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const read = (path: string) => readFileSync(new URL(path, import.meta.url), 'utf8')
const escape = (text: string) => text.replace(/[.*+?^${}()|[\]\\>~]/g, '\\$&')
/** 첫 번째 `selector { … }` 블록의 선언부 */
const rule = (css: string, selector: string) => css.match(new RegExp(`${escape(selector)}\\s*\\{([^}]*)\\}`))?.[1] ?? ''

// jsdom은 CSS를 적용하지 않아 렌더 테스트로는 크기·배치를 알 수 없다.
describe('검색·랭킹 카드의 더보기 메뉴 (#507)', () => {
  it('메뉴 버튼은 터치 영역 44px 이상이다', () => {
    const button = rule(read('./explore.css'), '.rg-more .pop-menu-btn')
    expect(button).toMatch(/width:\s*44px/)
    expect(button).toMatch(/height:\s*44px/)
  })

  it('메뉴는 카드 위 모서리에 떠 있어 카드의 높이·배치를 바꾸지 않는다', () => {
    const css = read('./explore.css')
    expect(rule(css, '.rg-item')).toMatch(/position:\s*relative/)
    expect(rule(css, '.rg-item .rg-more')).toMatch(/position:\s*absolute/)
  })
})

describe('검색 대상 탭 줄 (#505)', () => {
  it('좁은 화면에서 넘치지 않도록 이 줄만 가로로 스크롤하고 탭은 줄바꿈·축소 없이 한 줄을 지킨다', () => {
    const css = read('./explore.css')
    expect(rule(css, '.libtabs.search-tabs')).toMatch(/overflow-x:\s*auto/)
    const tab = rule(css, '.libtabs.search-tabs a')
    expect(tab).toMatch(/flex:\s*none/)
    expect(tab).toMatch(/white-space:\s*nowrap/)
  })

  it('다른 화면의 .libtabs에는 번지지 않는다(.libtabs를 고르는 규칙은 모두 .search-tabs 한정)', () => {
    const noComments = read('./explore.css').replace(/\/\*[\s\S]*?\*\//g, '')
    const selectors = [...noComments.matchAll(/([^{}]+)\{/g)].map((m) => m[1].trim()).filter((s) => s.includes('libtabs'))
    expect(selectors.length).toBeGreaterThan(0)
    expect(selectors.every((s) => s.split(',').every((part) => part.includes('.search-tabs')))).toBe(true)
  })
})
