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
/** 미디어 쿼리 밖 규칙(media를 주면 그 미디어 쿼리 안 규칙) 중 selector가 그대로 든 규칙들의 prop 값을 선언 순서대로 돌려준다. */
const values = (selector: string, prop: string, media = '') => sheet
  .filter((r) => r.media === media && r.selectors.includes(selector))
  .flatMap((r) => [...r.body.matchAll(new RegExp(`(?:^|;)\\s*${prop}\\s*:\\s*([^;]*)`, 'g'))].map((m) => m[1].trim()))
const value = (selector: string, prop: string, media?: string) => values(selector, prop, media).at(-1)

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

describe('storyfork.css 관리자 전체 폭 틀 계약', () => {
  const adminPage = readFileSync(new URL('../presentation/features/admin/view/AdminPage.tsx', import.meta.url), 'utf8')
  /** 900px 이하(사이드바가 상단바 아래 가로 메뉴 줄이 되는 구간)에서 마지막으로 정한 값. */
  const narrow = (selector: string, prop: string) => value(selector, prop, '(max-width:900px)')
  const opsCss = readFileSync(new URL('../presentation/features/admin/view/admin-operations.css', import.meta.url), 'utf8')

  it('관리자 틀은 최대 폭 제한(.wrap) 없이 사이드바를 왼쪽 끝 전체 높이로 둔다', () => {
    // 틀 마크업: 상단바·본문 어디에도 최대 폭 1120px(.wrap)을 쓰지 않는다(푸터의 .wrap은 AdminPage 밖이다).
    expect(adminPage).not.toMatch(/className=['"{][^'"}]*\bwrap\b/)
    // 틀: 사이드바 열(220~240px) | 남은 폭 전부. 어느 칸에도 최대 폭을 두지 않는다.
    expect(value('.adm', 'display')).toBe('grid')
    expect(value('.adm', 'grid-template-columns')).toMatch(/^(?:22\d|23\d|240)px minmax\(0,1fr\)$/)
    for (const selector of ['.adm', '.adm .admin-col', '.adm .top', '.adm .workspace']) expect(value(selector, 'max-width'), selector).toBeUndefined()
    // 사이드바: 왼쪽 열 전체가 테마와 무관한 어두운 면이고, 메뉴는 sticky로 화면 높이만큼 남으며 길면 안에서 스크롤한다.
    // 높이를 height로 못 박지 않고 max-height로 두는 이유: 푸터가 있는 짧은 화면에서도 틀이 푸터를 첫 화면 밖으로 밀지 않는다(위 푸터 위치 계약).
    expect(value('.adm .admin-side', 'background')).toBe('var(--fixed-dark)')
    expect([value('.adm .admin-nav', 'position'), value('.adm .admin-nav', 'top'), value('.adm .admin-nav', 'overflow-y')]).toEqual(['sticky', '0', 'auto'])
    expect(values('.adm .admin-nav', 'max-height')).toEqual(['100vh', '100dvh'])
    // 상단바: 오른쪽 열 맨 위의 밝은 면이고 본문을 스크롤해도 남는다.
    expect([value('.adm .top', 'position'), value('.adm .top', 'top'), value('.adm .top', 'background')]).toEqual(['sticky', '0', 'var(--surface)'])
    // 본문 main은 .wrap을 떼면 전역 main{padding:32px 0 72px}이 되살아나 제목 위 여백이 56px이 된다(24px + 32px): 여백은 .workspace만 가진다.
    expect(value('.adm main', 'padding')).toBe('0')
    // 900px 이하: 사이드바는 상단바 아래의 가로 메뉴 줄이 된다(상단바가 맨 위).
    expect([narrow('.adm', 'flex-direction'), narrow('.adm .admin-col', 'display'), narrow('.adm .top', 'order'), narrow('.adm .top', 'position'), narrow('.adm .admin-nav', 'position')])
      .toEqual(['column', 'contents', '-1', 'static', 'static'])
  })

  it('패널 머리(.table-head)는 좁은 화면에서도 제목과 버튼을 한 줄에 두고 버튼을 전체 폭으로 늘리지 않는다', () => {
    // 필터가 머리 밖으로 나간 뒤에도 세로로 쌓고 stretch하던 규칙이 남아 390px에서 새로고침이 전체 폭 큰 버튼이 됐다.
    expect([values('.adm .table-head', 'flex-direction', '(max-width:600px)'), values('.adm .table-head', 'align-items', '(max-width:600px)')]).toEqual([[], []])
    expect(value('.adm .table-head', 'flex-wrap')).toBe('wrap')
    expect(opsCss).not.toMatch(/\.table-head\s*\{[^}]*align-items\s*:\s*stretch/)
  })

  it('표 행 조치 버튼은 음수 여백 대신 셀 가운데 맞춤으로 글자와 맞추고, 쪽 이동 줄은 글자와 버튼을 세로 가운데로 둔다', () => {
    // 버튼 높이(36·44px)·글자 크기에 매인 음수 여백(-7.5px·-11.5px)은 값이 바뀌거나 버튼이 다른 글자 아래 줄로 내려가면 겹친다: 셀을 가운데 맞춤하면 높이와 상관없이 중심이 맞는다.
    expect(value('.adm td', 'vertical-align')).toBe('middle')
    expect([value('.adm td .btn', 'margin-top'), values('.adm td .btn', 'margin-top', '(max-width:600px),(pointer:coarse)'), values('.adm td .admin-inline:has(.inp) .btn', 'margin-top')]).toEqual([undefined, [], []])
    expect(opsCss).toMatch(/\.admin-pager\s*\{[^}]*align-items\s*:\s*center/)
  })

  it('900px 이하에서는 브랜드를 가로 스크롤 메뉴 밖 상단바 왼쪽에 둔다(메뉴 안 브랜드가 잘리던 audit 지적)', () => {
    // 상단바 브랜드는 데스크톱에서는 숨기고(사이드바 맨 위 브랜드가 맡는다) 900px 이하에서 보인다.
    expect([value('.adm .admin-brand-top', 'display'), narrow('.adm .admin-brand-top', 'display')]).toEqual(['none', 'flex'])
    // 반대로 메뉴 안 브랜드는 900px 이하에서 숨긴다.
    expect([value('.adm .admin-nav .admin-brand', 'display'), narrow('.adm .admin-nav .admin-brand', 'display')]).toEqual([undefined, 'none'])
  })

  it('LLM Ops 한 쪽에 쌓은 패널(경고+경고 기준 등)은 숫자 카드 줄 사이 gap과 같은 12px로 띄운다', () => {
    // .panel은 바깥 여백이 없어 두 패널이 맞붙어 한 덩어리로 보였다.
    expect(opsCss).toMatch(/\.panel\.admin-operations \+ \.panel\.admin-operations\s*\{[^}]*margin-top:\s*12px/)
  })

  it('표 행 조치(⋮ 메뉴)는 조치 칸을 ⋮ 버튼 하나 폭으로 줄이고, 36px(터치 44px) 단추와 버튼 자리 기준 fixed 메뉴를 쓴다', () => {
    // 조치 칸은 56px·오른쪽 맞춤이다. 글자 버튼 위험 색(.adm td .btn.danger)은 메뉴 항목(.pop-menu-list .danger)이 맡아 규칙을 지웠고, 남은 글자 버튼(경고 메모 줄·기준 저장·결과 보기)은 그대로다.
    expect(opsCss).toMatch(/\.adm th\.act-menu, \.adm td\.act-menu \{[^}]*width: 56px[^}]*text-align: right/)
    expect([value('.adm td .btn.danger', 'color'), value('.adm td .btn', 'color')]).toEqual([undefined, 'var(--pri-ink)'])
    // 단추 크기는 변수 하나(36px)이고 터치(600px 이하·coarse)는 44px이다. 명시도가 같아 터치 규칙이 기본 규칙 뒤에 있어야 이긴다.
    const base = opsCss.indexOf('.adm .row-menu { --more-size: 36px; }')
    const touch = opsCss.indexOf('@media (max-width: 600px), (pointer: coarse) { .adm .row-menu { --more-size: 44px; } }')
    expect([base > 0, touch > base]).toEqual([true, true])
    expect(opsCss).toMatch(/\.adm \.row-menu \.pop-menu-btn \{[^}]*width: var\(--more-size\); height: var\(--more-size\)/)
    // 메뉴는 표 스크롤 영역(.adm-scroll)에 잘리지 않게 fixed이고, 위치는 PopMenu가 열 때 알려 주는 버튼의 자리로 맞춘다(정적 위치에 기대면 스크롤한 문서에서 어긋난다).
    expect(opsCss).toMatch(/\.adm \.row-menu \.pop-menu-list \{[^}]*position: fixed; top: calc\(var\(--pop-bottom, 0px\) \+ 4px\); right: var\(--pop-right, 0px\); left: auto/)
    // 좁은 화면은 조치 칸이 오른쪽에 고정(sticky)되어 칸마다 쌓임 맥락이 생기므로, 열린 메뉴의 칸을 올려 아래 행의 고정 칸에 가려지지 않게 한다.
    expect(opsCss).toMatch(/@media \(max-width: 600px\) \{[^@]*\.adm td\.act-menu:has\(\[aria-expanded="true"\]\) \{ z-index: 3; \}/)
  })

  it('날짜·시각 칸(.admin-date)은 공백에서 꺾이지 않는 한 줄이고 숫자 폭을 맞춘다', () => {
    // 'ko-KR short' 날짜는 '26. 11. 20. 오전 12:03'처럼 공백이 많아, 좁아지면 '오전 / 12:03' 두 줄로 꺾이고 넓은 칸(권한 등)이 폭을 다 가져간다.
    expect([value('.adm .admin-date', 'white-space'), value('.adm .admin-date', 'font-variant-numeric')]).toEqual(['nowrap', 'tabular-nums'])
  })

  it('패널 주 행동·필터 버튼은 btn sm 규칙(36px·0 14px·13.5px) 하나로 같은 크기이고, 터치 환경(600px 이하·coarse)에서만 44px이다', () => {
    // 공지 작성·이벤트 작성 같은 .btn.pri는 전역 기본(44px·20px·15px) 큰 알약이라 필터 '조회'(.btn.sm)와 크기가 달랐다: .adm 안의 버튼은 모두 .btn.sm과 같다.
    const small = ['height', 'padding', 'font-size'].map((prop) => value('.btn.sm', prop))
    expect(small).toEqual(['36px', '0 14px', '13.5px'])
    expect(['height', 'padding', 'font-size'].map((prop) => value('.adm .btn', prop))).toEqual(small)
    // 터치 보정(파일 맨 끝 모바일 블록)은 .btn.sm처럼 .adm 버튼도 44px 이상으로 올린다.
    expect(sheet.some((r) => r.media === '(max-width:600px),(pointer:coarse)' && r.selectors.includes('.adm .btn') && /(?:^|;)\s*min-height\s*:\s*44px/.test(r.body))).toBe(true)
    // 필터 줄: 버튼에 따로 높이를 두지 않고 입력·선택을 같은 36px로 맞춰 줄이 가지런하다(터치 환경은 입력도 44px).
    expect(opsCss).not.toMatch(/\.admin-filter \.btn\s*\{/)
    expect(opsCss).toMatch(/\.admin-filter \.inp\s*\{[^}]*height:\s*36px/)
    expect(opsCss).toMatch(/@media \(max-width: 600px\), \(pointer: coarse\) \{[^@]*\.admin-filter \.inp \{[^}]*min-height:\s*44px/)
  })
})
