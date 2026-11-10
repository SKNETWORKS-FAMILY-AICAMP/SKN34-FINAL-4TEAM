import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const css = readFileSync(new URL('../../../../styles/storyfork.css', import.meta.url), 'utf8')
const rule = (selector: string) => css.match(new RegExp(`${selector.replace(/[.[\]]/g, '\\$&')}\\{([^}]*)\\}`))?.[1] ?? ''

describe('포크 준비 화면의 공개 자료 미리보기 목록(ul.carry)', () => {
  // jsdom은 CSS를 적용하지 않아 렌더 테스트로는 목록이 브라우저 기본 글머리 기호로 보이는지 알 수 없다.
  it('li가 가져가는 것 칩(.carry span)과 같은 칩 규칙을 쓴다', () => {
    expect(css).toMatch(/\.carry span,\.carry li\{[^}]*border:1px solid var\(--tline\)[^}]*border-radius:999px/)
  })

  it('ul은 브라우저 기본 글머리 기호와 들여쓰기를 지운다', () => {
    const list = rule('ul.carry')
    expect(list).toMatch(/list-style:\s*none/)
    expect(list).toMatch(/padding:\s*0/)
  })

  it('긴 제목은 칩 안에서 줄을 바꿔 칩 목록이 화면 밖으로 넘치지 않는다', () => {
    expect(css).toMatch(/\.carry li\{[^}]*overflow-wrap:\s*anywhere/)
  })
})
