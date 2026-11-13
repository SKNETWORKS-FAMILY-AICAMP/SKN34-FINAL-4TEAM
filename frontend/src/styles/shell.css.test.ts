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
/** 미디어 쿼리 밖 규칙 중 selector가 그대로 든 규칙들의 prop 값을 선언 순서대로 돌려준다. */
const values = (selector: string, prop: string) => sheet
  .filter((r) => !r.media && r.selectors.includes(selector))
  .flatMap((r) => [...r.body.matchAll(new RegExp(`(?:^|;)\\s*${prop}\\s*:\\s*([^;]*)`, 'g'))].map((m) => m[1].trim()))
const value = (selector: string, prop: string) => values(selector, prop).at(-1)

describe('storyfork.css 푸터 위치 계약', () => {
  it('푸터가 있는 화면은 #root를 세로 flex로 두고 본문이 남는 높이를 채워 푸터를 맨 아래에 붙인다', () => {
    const root = '#root:has(>.foot)'
    expect(value(root, 'display')).toBe('flex')
    expect(value(root, 'flex-direction')).toBe('column')
    // dvh를 모르는 브라우저는 앞의 100vh를 쓴다.
    expect(values(root, 'min-height')).toEqual(['100vh', '100dvh'])
    const body = `${root}>:is(main,.episode-app)`
    expect(value(body, 'flex')).toBe('1 0 auto')
    // 세로 flex에서는 .wrap·.fork의 자동 가로 여백이 본문 폭을 내용 폭으로 줄인다.
    expect(value(body, 'width')).toBe('100%')
  })

  it('본문과 푸터 사이 간격(푸터의 위 여백 20px)과 푸터 없는 화면(집필실·리더·로그인·관리자)은 건드리지 않는다', () => {
    // main.wrap의 padding(0 24px)이 main{padding}을 이겨 본문 아래 간격은 이 여백 하나뿐이다. margin-top:auto로 바꾸면 긴 화면에서 0이 된다.
    expect(value('.foot', 'margin-top')).toBe('20px')
    expect(values('#root', 'display')).toEqual([])
  })

  it('자체 전체 높이 틀(.lg 인증 화면·.adm 관리자)은 푸터가 있으면 남는 높이만 채워 푸터를 첫 화면 맨 아래에 둔다', () => {
    // .lg·.adm은 min-height:100vh라 그대로 두면 틀 + 푸터가 한 화면을 넘는다. 아래 규칙이 (1,2,0)으로 더 높아 min-height를 푼다.
    const frame = '#root:has(>.foot)>:is(.lg,.adm)'
    expect([value(frame, 'flex'), value(frame, 'min-height')]).toEqual(['1 0 auto', '0'])
    // 카드는 .lg-r 안에서 세로 가운데를 지킨다.
    expect([value('.lg-r', 'display'), value('.lg-r', 'place-items')]).toEqual(['grid', 'center'])
  })

  it('인증 화면의 좌우 두 단 틀 바로 아래 푸터는 위 여백 없이 붙는다', () => {
    expect(value('.lg+.foot', 'margin-top')).toBe('0')
  })
})

describe('storyfork.css 계정 메뉴 계약', () => {
  it('옛 목업 인물 칩용 .who 규칙을 계정 메뉴(.pop.acctm) 밖에 두지 않는다 — 새어 들어가 아바타 글자가 사라지고 이름 묶음이 알약이 됐다', () => {
    const outside = sheet.flatMap((r) => r.selectors).filter((s) => /(?:^|[\s>+~])\.who(?![\w-])/.test(s) && !s.startsWith('.pop.acctm'))
    expect(outside).toEqual([])
  })

  it('프로필 줄은 아바타·이름과 이메일·프로필 링크를 한 줄에 두고 이름·이메일은 한 줄로 줄인다', () => {
    const row = '.pop.acctm .who'
    expect([value(row, 'display'), value(row, 'align-items')]).toEqual(['flex', 'center'])
    expect([value('.pop.acctm .who-text', 'flex'), value('.pop.acctm .who-text', 'min-width')]).toEqual(['1', '0'])
    for (const tag of ['b', 'small']) {
      const text = `${row} ${tag}`
      expect([value(text, 'overflow'), value(text, 'text-overflow'), value(text, 'white-space')], text).toEqual(['hidden', 'ellipsis', 'nowrap'])
    }
    // 이름은 굵게, 이메일은 보통 굵기로 — 단추의 굵은 글씨(700)를 이메일이 물려받지 않게 한다.
    expect([value(`${row} b`, 'font-weight'), value(`${row} small`, 'font-weight')]).toEqual(['800', '400'])
    expect([value(`${row} em`, 'white-space'), value(`${row} em`, 'flex')]).toEqual(['nowrap', 'none'])
    // 메뉴를 버튼 아래에 맞추는 AccountMenu가 이 폭(240)을 가정한다.
    expect(value('.pop.acctm', 'width')).toBe('240px')
  })

  it('보유 크레딧 줄(.acct-credit)은 상단 크레딧 칩과 같은 색 계열·고정폭 숫자이고 일반 항목 규칙에 덮이지 않는다', () => {
    const row = '.pop.acctm .acct-credit'
    expect([value(row, 'display'), value(row, 'justify-content')]).toEqual(['flex', 'space-between'])
    expect([value(row, 'background'), value(row, 'color')]).toEqual(['var(--pri-soft)', 'var(--pri-ink)'])
    expect(value(row, 'font-variant-numeric')).toBe('tabular-nums')
    expect(value(`${row}:hover`, 'background')).toMatch(/^color-mix\(/)
    // 일반 항목 규칙(padding·글꼴)은 명시도 (0,3,1)이라 .acct-credit (0,3,0)을 이긴다 → 대상에서 뺀다.
    expect(sheet.some((r) => r.selectors.includes('.pop.acctm>button:not(.who,.acct-credit)'))).toBe(true)
    expect(sheet.some((r) => r.selectors.includes('.pop.acctm>button:not(.who)'))).toBe(false)
    // 색은 토큰만(라이트·다크 자동), 한쪽 테두리 장식은 쓰지 않는다.
    const creditCss = sheet.filter((r) => r.selectors.some((s) => s.startsWith(row))).map((r) => r.body).join(';')
    expect(creditCss).not.toMatch(/#[0-9a-fA-F]{3,8}\b|border-(?:left|right)/)
  })
})
