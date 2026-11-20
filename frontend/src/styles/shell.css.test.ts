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

describe('storyfork.css GNB 검색 버튼 계약 (#505)', () => {
  // 긴 안내(소설·세계관·설정 카드·캐릭터챗 검색)는 1100px 아래에서 GNB 한 줄에 다 들어가지 않아 짧은 표시(검색)로 바꾼다. 600px 이하는 돋보기 아이콘만(font-size:0)이다.
  const narrow = (selector: string) => sheet.filter((r) => r.media === '(max-width:1100px)' && r.selectors.includes(selector)).map((r) => r.body.trim())

  it('짧은 표시(.ls)는 기본으로 숨기고 1100px 이하에서 긴 표시(.lf)와 서로 바꿔 보인다', () => {
    expect(value('.search .ls', 'display')).toBe('none')
    expect(narrow('.search .lf')).toEqual(['display:none'])
    expect(narrow('.search .ls')).toEqual(['display:inline'])
  })
})

describe('storyfork.css 셸·읽기 화면 정리 계약 (impeccable 그룹 1)', () => {
  it('상단바(.gnb)가 있는 화면은 떠 있는 테마 버튼을 숨겨 같은 버튼이 두 개 보이지 않는다', () => {
    expect(value('body:has(.gnb) .thm-float', 'display')).toBe('none')
  })

  it('푸터가 있는 소설 상세·위키 틀(.calm)은 남는 높이를 채워 짧은 화면에서도 푸터를 맨 아래에 둔다', () => {
    const calm = '#root:has(>.foot)>.calm'
    expect([value(calm, 'flex'), value(calm, 'width')]).toEqual(['1 0 auto', '100%'])
  })

  it('빠른 이동 검색 입력은 지운 기본 윤곽선 대신 키보드 포커스 표시(아래 보라 선)를 둔다', () => {
    expect(value('.qk input:focus-visible', 'box-shadow')).toBe('inset 0 -2px 0 var(--pri)')
  })

  it('뒤로 가기 버튼은 긴 작품 제목을 한 줄 말줄임으로 줄여 좁은 화면에서 넘치지 않는다', () => {
    expect(value('.back', 'max-width')).toBe('100%')
    const title = '.back>span'
    expect([value(title, 'overflow'), value(title, 'text-overflow'), value(title, 'white-space')]).toEqual(['hidden', 'ellipsis', 'nowrap'])
  })

  it('장식 효과를 쓰지 않는다: 그라데이션 글자·원뿔 링·퍼지는 알림 배지·튀는 곡선·인용 색 띠', () => {
    expect(css.match(/background-clip\s*:\s*text|conic-gradient|nbping|\.pop1\{|cubic-bezier\(\.3,\s*1\.6/g) ?? []).toEqual([])
    expect(['.quote', 'q.cq'].map((s) => value(s, 'border-left'))).toEqual([undefined, undefined])
  })

  it('홈의 급상승·방금 업데이트 줄(.tri)은 2칸이다', () => {
    expect(value('.tri', 'grid-template-columns')).toBe('repeat(2,minmax(0,1fr))')
  })
})
