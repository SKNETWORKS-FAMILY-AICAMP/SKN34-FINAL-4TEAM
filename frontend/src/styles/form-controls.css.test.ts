import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const css = readFileSync(new URL('./storyfork.css', import.meta.url), 'utf8')

type Rule = { media: string; selectors: string[]; body: string }
/** 중첩 @media를 펼쳐 규칙 목록으로 만든다. 다른 at-rule(@keyframes 등)은 건너뛴다. */
function parse(source: string, media = ''): Rule[] {
  const text = source.replace(/\/\*[\s\S]*?\*\//g, '')
  const rules: Rule[] = []
  for (let i = 0; i < text.length;) {
    const open = text.indexOf('{', i)
    if (open < 0) break
    let depth = 1
    let end = open + 1
    for (; end < text.length && depth; end++) depth += text[end] === '{' ? 1 : text[end] === '}' ? -1 : 0
    const head = text.slice(i, open).trim()
    const body = text.slice(open + 1, end - 1)
    if (head.startsWith('@media')) rules.push(...parse(body, head.slice(6).trim()))
    else if (!head.startsWith('@')) rules.push({ media, selectors: head.split(/,(?![^()]*\))/).map((s) => s.trim()), body })
    i = end
  }
  return rules
}
const sheet = parse(css)
const mobile = '(max-width:600px),(pointer:coarse)'
/** selector가 그대로 든 규칙들의 prop 값을 선언 순서대로 돌려준다(media가 없으면 미디어 쿼리 밖). */
const values = (selector: string, prop: string, media = '') => sheet
  .filter((r) => r.media === media && r.selectors.includes(selector))
  .flatMap((r) => [...r.body.matchAll(new RegExp('(?:^|;)\\s*' + prop + '\\s*:\\s*([^;]*)', 'g'))].map((m) => m[1].trim()))
const value = (selector: string, prop: string, media = '') => values(selector, prop, media).at(-1)

describe('storyfork.css 콤보박스(select) 전역 규칙', () => {
  const chevron = 'select:not([multiple],[size])'

  it('OS 기본 모양을 끄고 오른쪽에 셰브런을 그린다(multiple·size 목록 상자는 제외)', () => {
    expect(value(chevron, 'appearance')).toBe('none')
    expect(value(chevron, '-webkit-appearance')).toBe('none')
    expect(value(chevron, 'background-repeat')).toBe('no-repeat')
    expect(value(chevron, 'background-position')).toMatch(/^right \d+px center,right \d+px center$/)
  })

  it('셰브런은 그림 파일이 아니라 현재 글자색 그라디언트 두 줄이라 라이트·다크·독서 테마에서 모두 보인다', () => {
    const image = value(chevron, 'background-image') ?? ''
    expect(image.match(/linear-gradient\(/g)).toHaveLength(2)
    expect(image).toContain('currentColor')
    expect(image).not.toMatch(/url\(|#[0-9a-f]{3,8}\b|rgb/i)
  })

  it('테두리·표면·글자는 입력 칸과 같은 토큰이고 셰브런 자리(padding-right)를 둔다', () => {
    expect(value('select', 'border')).toBe('1px solid var(--line3)')
    expect(value('select', 'background-color')).toBe('var(--surface)')
    expect(value('select', 'color')).toBe('var(--ink)')
    expect(parseInt(value(chevron, 'padding-right') ?? '0')).toBeGreaterThanOrEqual(30)
  })

  it('초점은 focus-visible 링, 비활성은 흐리게 not-allowed, 호버는 테두리만 짙게 한다', () => {
    expect(value('select:enabled:focus-visible', 'outline')).toBe('2px solid var(--pri)')
    expect(value('select:enabled:focus-visible', 'border-color')).toBe('var(--pri)')
    expect(value('select:disabled', 'cursor')).toBe('not-allowed')
    expect(parseFloat(value('select:disabled', 'opacity') ?? '1')).toBeLessThan(1)
    expect(value('select:enabled:hover', 'border-color')).toBe('var(--sub)')
  })

  it('옵션 목록은 표면·글자 토큰이라 다크 테마에서도 읽힌다', () => {
    expect(value('option', 'background-color')).toBe('var(--surface)')
    expect(value('option', 'color')).toBe('var(--ink)')
  })

  it('작은 입력(.inp.sm)·알약형(.pc select)·공개 범위(.wprops select)도 셰브런 자리를 뺏기지 않는다', () => {
    // .inp.sm은 padding:0 10px(0,2,0)이라 전역 규칙(0,1,1)을 이기므로 select.inp.sm이 오른쪽을 다시 정한다.
    // 셰브런은 오른쪽 끝에서 14~24px를 차지하므로 기본 select(34px)와 같은 34px여야 글자와 10px 떨어진다(30·28·26px면 6·4·2px로 붙는다).
    expect(parseInt(value('select.inp.sm', 'padding-right') ?? '0')).toBeGreaterThanOrEqual(34)
    // 뒤에 오는 같은 명시도 규칙은 padding 줄임 표기의 오른쪽(둘째 값)으로 맞춘다.
    for (const selector of ['.pc select', '.wprops select', '.visibility-mock select']) {
      expect(parseInt(value(selector, 'padding')?.split(/\s+/)[1] ?? '0'), selector).toBeGreaterThanOrEqual(34)
    }
  })

  it('select를 다시 꾸미는 규칙은 background 줄임 표기로 셰브런(background-image)을 지우지 않는다', () => {
    const touching = sheet.filter((r) => r.selectors.some((s) => /\bselect\b/.test(s)))
    expect(touching.length).toBeGreaterThan(5)
    for (const r of touching) expect(r.body, r.selectors.join(',')).not.toMatch(/(?:^|;)\s*background\s*:/)
  })

  it('손가락이 주 입력인 화면에서도 select는 44px 이상이다(16px 글자는 기존 규칙)', () => {
    expect(value('select', 'min-height', mobile)).toBe('44px')
    expect(value('select', 'font-size', '(pointer:coarse)')).toBe('16px')
  })
})

describe('storyfork.css 체크박스·라디오 전역 규칙', () => {
  const box = 'input[type=checkbox]'
  const radio = 'input[type=radio]'

  it('OS 기본 모양을 끄고 18px 칸에 입력 칸과 같은 테두리·표면 토큰을 쓴다', () => {
    for (const selector of [box, radio]) {
      expect(value(selector, 'appearance'), selector).toBe('none')
      expect(value(selector, '-webkit-appearance'), selector).toBe('none')
      expect([value(selector, 'width'), value(selector, 'height')], selector).toEqual(['18px', '18px'])
      expect(value(selector, 'border'), selector).toBe('1.5px solid var(--line3)')
      expect(value(selector, 'background-color'), selector).toBe('var(--surface)')
      // 칸이 flex 줄에서 찌그러지지 않는다.
      expect(value(selector, 'flex'), selector).toBe('none')
    }
    expect(value(box, 'border-radius')).toBe('5px')
    expect(value(radio, 'border-radius')).toBe('50%')
  })

  it('선택하면 --pri로 채우고(체크박스) 테두리를 칠하며(라디오), 표시는 ::before로 그린다', () => {
    expect(value(box + ':checked', 'background-color')).toBe('var(--pri)')
    expect(value(box + ':checked', 'border-color')).toBe('var(--pri)')
    expect(value(box + ':indeterminate', 'background-color')).toBe('var(--pri)')
    expect(value(radio + ':checked', 'border-color')).toBe('var(--pri)')
    // 체크·가로줄은 채움(--pri) 위 글자색 짝인 --on-pri(currentColor), 라디오 점은 --pri.
    expect(value(box, 'color')).toBe('var(--on-pri)')
    expect(value(box + ':checked::before', 'background')).toBe('currentColor')
    expect(value(box + ':indeterminate::before', 'clip-path')).toMatch(/^inset\(/)
    expect(value(radio + ':checked::before', 'background')).toBe('var(--pri)')
  })

  it('표시는 position:relative 없이 ::before의 % 크기·여백으로 가운데에 둔다(sticky 머리글 위로 올라오지 않게, 기능 CSS가 칸 크기를 바꿔도 비율로 맞게)', () => {
    expect(value(box, 'position')).toBeUndefined()
    for (const prop of ['width', 'height', 'margin']) expect(value(box + ':checked::before', prop), prop).toMatch(/%$/)
  })

  it('비활성은 흐리게 not-allowed로 둔다', () => {
    expect(value(box + ':disabled', 'cursor')).toBe('not-allowed')
    expect(value(radio + ':disabled', 'cursor')).toBe('not-allowed')
    expect(parseFloat(value(box + ':disabled', 'opacity') ?? '1')).toBeLessThan(1)
  })

  it('손가락이 주 입력인 화면에서는 체크박스와 라디오 모두 24px 칸이고 체크박스의 기존 보정은 그대로다', () => {
    expect(value('input[type="checkbox"]', 'width', mobile)).toBe('24px')
    expect(value('input[type="radio"]', 'width', mobile)).toBe('24px')
    expect(value('input[type="radio"]', 'height', mobile)).toBe('24px')
    expect(value('input[type="checkbox"]', 'accent-color', mobile)).toBe('var(--pri)')
  })
})
