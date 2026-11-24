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

  it('넓은 화면 인증 푸터 내용은 가운데 상자가 아니라 왼쪽 면 안쪽 여백(64px)에 맞춘다', () => {
    const wide = '(min-width:901px)'
    expect([value('.lg+.foot .wrap', 'max-width', wide), value('.lg+.foot .wrap', 'padding-inline', wide)]).toEqual(['none', '64px'])
    expect(value('.lg-l', 'padding')).toBe('56px 64px')
    expect(value('.lg+.foot .wrap', 'max-width')).toBeUndefined()
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
    // 메뉴를 버튼 아래에 맞추는 AccountMenu가 이 폭(240)을 가정한다. 폭이 두 군데 적히면 짝을 잘못 읽으니 선언은 하나다.
    expect(values('.pop.acctm', 'width')).toEqual(['240px'])
  })

  it('계정 메뉴는 sticky 상단바 위에 떠 가려지지 않는다', () => {
    expect(Number(value('.pop.acctm', 'z-index'))).toBeGreaterThan(Number(value('.gnb', 'z-index')))
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

  it('프로필 줄의 "프로필 ›"은 보조색이라 메뉴 머리의 보라 강조는 아바타와 크레딧 줄만 남는다', () => {
    expect(value('.pop.acctm .who em', 'color')).toBe('var(--sub)')
  })
})

describe('storyfork.css 서재 목록 카드 계약', () => {
  it('제목 링크의 ::after가 카드 전체를 덮고, 버튼 줄(.acts)은 그 위에 놓여 버튼은 자기 동작만 한다', () => {
    expect([value('.li.rowlink', 'position'), value('.li-link::after', 'position'), value('.li-link::after', 'inset')]).toEqual(['relative', 'absolute', '0'])
    expect([value('.li.rowlink>.acts', 'position'), value('.li.rowlink>.acts', 'z-index')]).toEqual(['relative', '1'])
  })

  it('키보드 초점(제목 링크의 :focus-visible)도 hover와 같은 카드 배경을 쓰고, 안쪽 버튼 위에서는 카드 배경을 켜지 않는다', () => {
    expect(value('.li.rowlink:has(.li-link:focus-visible)', 'background')).toBe('var(--muted-bg)')
    expect(value('.li.rowlink:hover:not(:has(.acts:hover))', 'background')).toBe('var(--muted-bg)')
    // 버튼 위에서도 켜지던 옛 규칙(자손 hover에도 걸린다)은 없다.
    expect(value('.li.rowlink:hover', 'background')).toBeUndefined()
  })

  it('카드 제목(h3)은 세 탭이 같은 글꼴 하나이고, 글자 버튼(.btn.weak)은 테두리·배경 없이 높이를 .btn.sm에 맡긴다', () => {
    expect(['font-size', 'font-weight', 'line-height'].map((prop) => value('.li h3', prop))).toEqual(['15px', '700', '1.5'])
    expect(['border-color', 'background', 'color'].map((prop) => value('.btn.weak', prop))).toEqual(['transparent', 'transparent', 'var(--sub)'])
    expect([value('.btn.weak:hover', 'background'), value('.btn.weak:hover', 'color')]).toEqual(['var(--muted-bg)', 'var(--ink)'])
    // 높이를 따로 두지 않아 데스크톱 36px, 터치(600px 이하·coarse) 44px이 .btn.sm 그대로 지켜진다.
    expect([values('.btn.weak', 'height'), values('.btn.weak', 'min-height')]).toEqual([[], []])
  })

  it('좁은 화면에서는 이어 읽기 줄의 글자 버튼을 내용 폭으로 두고 주 버튼(이어 읽기)이 남는 폭을 채운다', () => {
    const mobile = '(max-width:600px)'
    expect([value('.li>.acts .btn', 'flex', mobile), value('.li>.acts .btn.weak', 'flex', mobile)]).toEqual(['1', 'none'])
  })

  it('새로 시작하기 카드 열은 기본 3열·900px 이하 1열 한 규칙씩이고 !important를 쓰지 않는다', () => {
    expect(values('.newbox', 'grid-template-columns')).toEqual(['repeat(3,minmax(0,1fr))'])
    expect(values('.newbox', 'grid-template-columns', '(max-width:900px)')).toEqual(['1fr'])
  })

  it('목록 행의 주 버튼은 채우지 않은 연보라 톤이고 hover만 조금 진해진다', () => {
    const b = '.li.rowlink>.acts .btn.pri'
    expect([value(b, 'background'), value(b, 'color')]).toEqual(['var(--pri-soft)', 'var(--pri-ink)'])
    expect(value(b, 'border-color')).toMatch(/^color-mix\(/)
    expect(value(`${b}:hover`, 'background')).toMatch(/^color-mix\(/)
  })

  it('서재 구역 제목(h2)은 페이지 제목(h1)보다 한 단계 작고 가볍다', () => {
    expect([value('.lib .sec-h h2', 'font-size'), value('.lib .sec-h h2', 'font-weight')]).toEqual(['20px', '700'])
    expect(value('.sec-h :is(h1,h2)', 'font-size')).toBe('23px')
  })

  it('밑줄 탭과 작품 구분 필터는 선택되지 않은 탭에 hover하면 글자가 진해진다', () => {
    expect(value('.libtabs :is(button,a):not(.on):hover', 'color')).toBe('var(--ink)')
  })
})

describe('server-writing.css 서재 목록 제목 줄·칩 줄 계약', () => {
  const writingCss = readFileSync(new URL('../presentation/features/library/view/server-writing.css', import.meta.url), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '')

  it('제목 줄의 새 소설·새 세계관 버튼은 제목 오른쪽 끝에 놓이고, 칩 줄은 칩과 글자를 한 줄에서 가운데 맞춤으로 잇는다', () => {
    expect(writingCss).toMatch(/\.server-writing \.sec-h > \.btn \{[^}]*margin-left: auto/)
    expect(writingCss).toMatch(/\.server-tags \{[^}]*display: flex[^}]*flex-wrap: wrap[^}]*align-items: center/)
  })

  it('[quieter] 칩 줄의 칩은 600이다 — 700 제목(.hk) 바로 아래 칩이 같은 굵기로 겨루지 않고 작품 관리 히어로 칩 줄·관리자 칩(600)과 맞춘다. 색·칩 종류는 그대로다', () => {
    expect(writingCss).toMatch(/\.server-tags \.chip \{[^}]*font-weight: 600/)
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

  it('검색 버튼 hover는 테두리색만 바꾸고 후광 그림자를 켜지 않는다', () => {
    expect(value('.search:hover', 'border-color')).toBe('var(--pri)')
    expect(value('.search:hover', 'box-shadow')).toBeUndefined()
    expect(value('.search', 'transition')).toBe('border-color .15s')
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

  it('인증 화면의 홈으로 버튼은 떠 있는 그림자 없이 테마 버튼과 같은 높이로 놓인다', () => {
    expect(value('.auth-header .back', 'box-shadow')).toBe('none')
    expect(value('.back', 'height')).toBe(value('.auth-header .thm', 'height'))
  })

  it('로그인 도움 링크는 밑줄로 링크임을 보이고 굵기는 폼 레이블보다 가볍다', () => {
    expect([value('.lg-links a', 'font-weight'), value('.lg-links a', 'text-decoration')]).toEqual(['500', 'underline'])
    expect(Number(value('.lg-links a', 'font-weight'))).toBeLessThan(Number(value('.field', 'font-weight')))
  })
})

describe('storyfork.css 관리자 전체 폭 틀 계약', () => {
  const adminPage = readFileSync(new URL('../presentation/features/admin/view/AdminPage.tsx', import.meta.url), 'utf8')
  /** 900px 이하(사이드바가 상단바 아래 가로 메뉴 줄이 되는 구간)에서 마지막으로 정한 값. */
  const narrow = (selector: string, prop: string) => value(selector, prop, '(max-width:900px)')
  const opsCss = readFileSync(new URL('../presentation/features/admin/view/admin-operations.css', import.meta.url), 'utf8')
  const jobMonitor = readFileSync(new URL('../presentation/features/admin/view/JobMonitor.tsx', import.meta.url), 'utf8')

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

  it('브랜드는 메인(/)으로 가는 링크(a)라, 메뉴 항목 규칙(.adm .admin-nav :is(button,a): 38px·500·--fixed-sub)보다 높은 명시도로 브랜드 모양을 지키고 상단바 브랜드는 터치 목표 44px이다', () => {
    // 같은 레이어에서 명시도 (0,2,1)인 메뉴 항목 규칙이 (0,2,0) 브랜드 규칙을 이겨 브랜드가 메뉴 항목처럼 작아졌다: 클래스 셋(0,3,0)으로 올린다. display는 정하지 않는다(메뉴 안 링크 규칙이 flex로 두고, 위 계약이 기본 구간 display 없음을 지킨다).
    expect(['height', 'font-weight', 'color', 'justify-content'].map((prop) => value('.adm .admin-nav .admin-brand', prop))).toEqual(['60px', '800', 'var(--fixed-ink)', 'center'])
    // 메뉴 항목 규칙(:is(button,a){text-align:left})이 브랜드도 왼쪽에 붙였다. 링크는 flex라 text-align이 아니라 justify-content로 사이드바 가운데에 둔다(메뉴 항목 규칙은 왼쪽 정렬 그대로).
    expect(values('.adm .admin-nav :is(button,a)', 'justify-content')).toEqual([])
    // 900px 이하 가로 메뉴 구간의 상단바 브랜드는 누르는 영역이 글자 높이만큼이던 것을 44px로 올린다.
    expect(narrow('.adm .admin-brand-top', 'min-height')).toBe('44px')
  })

  it('cron 식(td code)은 공백에서 꺾이지 않는 한 줄이다', () => {
    // '0 30 4 1 1 *'은 필드 경계가 공백이라 좁은 칸에서 꺾이면 필드 수를 셀 수 없다(390px 일정 표). 표 스크롤 영역 안에서 가로로 스크롤한다.
    expect(opsCss).toMatch(/\.adm td code \{[^}]*white-space: nowrap/)
  })

  it('크레딧 탭에서 고른 회원의 보유 크레딧 카드(한 장)는 600px 이하에서도 전체 폭이다', () => {
    // 공용 .kpi는 좁은 화면에서 2열이라 카드가 한 장이면 반 폭에 갇히고 설명이 세 줄로 꺾였다. 카드가 여럿인 개요·LLM Ops .kpi는 그대로 2열이다.
    expect(opsCss).toMatch(/@media \(max-width: 600px\) \{[^@]*\.adm \.credit-member \.kpi \{ grid-template-columns: minmax\(0, 1fr\); \}/)
  })

  it('안내문(.admin-note)도 폼·표처럼 카드 안쪽 폭 전체를 쓴다(폭 상한 없음)', () => {
    // 폼이 카드 폭 전체가 되어(아래 '관리자 폼은 표처럼…' 계약) 안내문만 800px이면 폼 오른쪽 끝과 어긋난다.
    expect(value('.adm .admin-note', 'max-width')).toBeUndefined()
  })

  it('쌓인 패널은 무엇이든(.panel + .panel) 숫자 카드 줄 사이 gap과 같은 12px로 띄우고, 같은 간격을 인라인 14px로 덮지 않는다', () => {
    // .panel은 바깥 여백이 없어 두 패널이 맞붙어 한 덩어리로 보였다. .admin-operations 패널끼리만 12px이고 캐릭터챗·관리자 계정·작업 일정·신고·문의 쪽은 인라인 14px이라 화면마다 간격이 달랐다.
    expect(opsCss).toMatch(/\.adm \.panel \+ \.panel\s*\{[^}]*margin-top:\s*12px/)
    expect(opsCss).not.toMatch(/\.panel\.admin-operations \+ \.panel\.admin-operations/)
    for (const source of [adminPage, jobMonitor]) expect(source).not.toMatch(/className=['"][^'"]*\bpanel\b[^'"]*['"]\s+style=\{\{ marginTop: 14 \}\}/)
  })

  it('크레딧 탭에서 고른 회원의 보유 크레딧 카드(한 장)는 폭 상한 없이 바로 아래 폼과 같은 카드 안쪽 폭 전체다', () => {
    // 폼이 카드 폭 전체가 되어(아래 계약) 카드 한 장도 800px로 묶지 않는다: auto-fit 격자의 한 장은 전체 폭이다. 600px 이하 1열 규칙은 위 계약이 지킨다.
    expect(opsCss).not.toMatch(/\.credit-member \.kpi \{[^}]*max-width/)
  })

  it('좁은 화면(600px 이하)에서 표 끝 칸의 오른쪽 고정(sticky)은 열을 가로지르는 한 칸(td[colspan])에는 걸리지 않고, 고정 칸 왼쪽에는 1px 경계선이 있다', () => {
    // 빈 결과 행의 유일한 칸(td colspan)도 :last-child라 같이 고정되면 폭 600px인 칸이 스크롤 영역(301px) 오른쪽 끝에 맞춰 밀려 문구가 영역 밖에 남았다(캐릭터챗·작품·댓글 390px). 같은 모양의 상세·수정 행도 같다.
    const sticky = sheet.filter((r) => r.media === '(max-width:600px)' && r.selectors.some((s) => s.includes(':last-child')) && /position\s*:\s*sticky/.test(r.body))
    expect(sticky.map((r) => r.selectors)).toEqual([['.adm-scroll table:has(th.act) :is(th,td):not([colspan]):last-child']])
    // 번지는 그림자만으로는 옅어서 잘린 열이 반쯤 걸친 글자로만 보였다: 왼쪽 끝에 1px 선을 더해 가로 스크롤하는 표로 읽히게 한다.
    expect(sticky[0].body).toMatch(/box-shadow\s*:\s*inset 1px 0 0 var\(--line2\),/)
  })

  it('실패한 실행의 진행 막대는 정상 색(기본 파랑)으로 가득 차 보이지 않고 실패 색이다', () => {
    // 작업 감시 실행 기록의 실패 행이 '● 실패' 옆에서 3/3 (100%) 막대를 정상처럼 채우고 있었다. 상태 칩의 .bad를 신호로 쓴다.
    expect(opsCss).toMatch(/\.adm tr:has\(\.chip\.bad\) progress \{ accent-color: var\(--danger\); \}/)
  })

  it('관리자의 위험 버튼(.btn.danger: 크레딧 회수)은 주 행동 옆에서 같은 무게의 채운 버튼이 아니라 윤곽선 버튼이다', () => {
    // 전역 .btn.danger는 --danger 채움이라 '지급'(보라 채움)과 같은 무게로 붙어 잘못 누르기 쉬웠다. 집필실(.writing-danger)·계획(.plan-sheet)과 같은 윤곽선 모양이다.
    expect(['background', 'color'].map((prop) => value('.adm .btn.danger', prop))).toEqual(['var(--surface)', 'var(--danger)'])
    expect(value('.adm .btn.danger', 'border-color')).toMatch(/^color-mix\(in srgb,var\(--danger\) 45%/)
    expect(value('.adm .btn.danger:hover:not(:disabled)', 'background')).toMatch(/^color-mix\(/)
  })

  it('표 행 조치(⋮ 메뉴)는 조치 칸을 ⋮ 버튼 하나 폭으로 줄이고, 36px(터치 44px) 단추와 버튼 자리 기준 fixed 메뉴를 쓴다', () => {
    // 조치 칸은 56px·오른쪽 맞춤이다. 글자 버튼 위험 색(.adm td .btn.danger)은 메뉴 항목(.pop-menu-list .danger)이 맡아 규칙을 지웠고, 남은 글자 버튼(경고 메모 줄·기준 저장·결과 보기)은 그대로다.
    expect(opsCss).toMatch(/\.adm th\.act-menu, \.adm td\.act-menu \{[^}]*width: 56px[^}]*text-align: right[^}]*white-space: nowrap/)
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

  it('표 머리(.adm th)와 짧은 라벨 칸(.admin-nowrap)은 두세 줄로 꺾이지 않는 한 줄이다', () => {
    // body{word-break:keep-all;overflow-wrap:anywhere} 아래 표 자동 레이아웃에서 글자가 아주 긴 칸(매칭 패턴·권한·대상 ID)이 남는 폭을 가져가고, 짧은 칸은 공백·하이픈 단위 최소 폭까지 눌려 '입력/단가'·'S14 QA1123/관리자'처럼 꺾였다(.admin-date와 같은 이유). 머리 글자는 모두 짧아 전체에 걸고, 본문 칸은 짧은 라벨 칸에만 클래스로 건다.
    expect(value('.adm th', 'white-space')).toBe('nowrap')
    expect(opsCss).toMatch(/\.adm \.admin-nowrap \{ white-space: nowrap; \}/)
  })

  it('권한 체크박스 줄(.admin-perm-grid label)은 좌우 안쪽 여백이 없어 체크박스가 legend 글자와 왼쪽이 맞는다', () => {
    // 타일 배경을 지운 뒤 padding:8px만 남아 체크박스가 legend보다 6px 들어가 보였다. 위아래 8px는 그대로이고 label이 격자 칸 전체 폭이라 누르는 영역도 그대로다.
    expect(value('.admin-perm-grid label', 'padding')).toBe('8px 0')
  })

  it('권한 체크박스 격자(.admin-perm-grid)는 어떤 폭에서도 열이 4개를 넘지 않아 12개가 외톨이 없이 떨어진다', () => {
    // 폼이 카드 폭 전체가 되면(1440px에서 격자 폭 1072px) 최소 190px 자동 열이 5열이라 12개가 5+5+2로 갈렸다. 열 최소 폭을 격자 폭의 24%로 올려 열 수를 4 이하(4×3·3×4·2×6·1×12)로 막고, 좁은 화면은 190px이 그대로 열을 줄인다.
    const track = value('.admin-perm-grid', 'grid-template-columns')?.match(/^repeat\(auto-fit,minmax\((.+),1fr\)\)$/)?.[1] ?? ''
    const floor = Number(/(\d+)px/.exec(track)?.[1])
    const share = Number(/(\d+)%/.exec(track)?.[1] ?? 0) / 100
    const gap = parseFloat(value('.admin-perm-grid', 'gap') ?? '')
    const columns = (width: number) => Math.floor((width + gap) / (Math.max(floor, width * share) + gap))
    const orphaned = Array.from({ length: 2400 - 190 + 1 }, (_, i) => 190 + i).filter((width) => 12 % columns(width) !== 0)
    expect(orphaned, `열 수가 12의 약수가 아닌 격자 폭(px): ${track}`).toEqual([])
  })

  it('빈 상태 문구(.admin-empty)는 표 글자와 같은 13.5px이다', () => {
    // 본문 15px를 물려받아 패널 제목(16px)과 경쟁했고 표 안 빈 행(13.5px)과 크기가 둘로 갈렸다. 색(--sub)·여백은 그대로다.
    expect(opsCss).toMatch(/\.adm \.admin-empty \{[^}]*font-size: 13\.5px/)
  })

  it('패널 주 행동·필터 버튼은 btn sm 규칙(36px·0 14px·13.5px) 하나로 같은 크기이고, 터치 환경(600px 이하·coarse)에서만 44px이다', () => {
    // 공지 작성·이벤트 작성 같은 .btn.pri는 전역 기본(44px·20px·15px) 큰 알약이라 필터 '조회'(.btn.sm)와 크기가 달랐다: .adm 안의 버튼은 모두 .btn.sm과 같다.
    const small = ['height', 'padding', 'font-size'].map((prop) => value('.btn.sm', prop))
    expect(small).toEqual(['36px', '0 14px', '13.5px'])
    expect(['height', 'padding', 'font-size'].map((prop) => value('.adm .btn', prop))).toEqual(small)
    // 터치 보정(파일 맨 끝 모바일 블록)은 .btn.sm처럼 .adm 버튼도 44px 이상으로 올린다.
    expect(sheet.some((r) => r.media === '(max-width:600px),(pointer:coarse)' && r.selectors.includes('.adm .btn') && /(?:^|;)\s*min-height\s*:\s*44px/.test(r.body))).toBe(true)
    // 관리자 입력·선택(.inp)은 필터 줄·폼·표 칸 어디서나 버튼과 같은 36px이라 한 화면의 줄이 가지런하다(터치 환경은 입력도 44px). 전역 .inp(46px)는 @layer(base)라 이 규칙이 이긴다.
    expect(opsCss).not.toMatch(/\.admin-filter \.btn\s*\{/)
    expect(opsCss).toMatch(/\.adm \.inp\s*\{[^}]*height:\s*36px/)
    expect(opsCss).toMatch(/@media \(max-width: 600px\), \(pointer: coarse\) \{[^@]*\.adm \.inp \{[^}]*min-height:\s*44px/)
  })

  it('관리자 폼은 표처럼 카드(패널) 안쪽 폭 전체를 쓴다: 폼 격자·권한 상자·제출 줄에 폭 상한이 없고 제출 줄만 위 12px을 띄운다', () => {
    // 폼을 800px로 묶으면 1440px에서 카드(안쪽 약 1102px) 왼쪽에 붙고 오른쪽 300px가 비어 보였다(사용자 피드백). 검색 입력(.field-search 360px)은 필터 줄이라 예외다.
    expect(opsCss).not.toMatch(/\.(?:form-grid|admin-permissions|rowend)[^{}]*\{[^}]*max-width/)
    // 폭이 같아져 권한 상자는 fieldset 기본 가로 여백(2px)만 없애면 입력과 양쪽 끝이 맞고, 제출 줄은 격자 안 줄 사이와 같은 12px 아래로 띄운다.
    expect(opsCss).toMatch(/\.adm \.admin-permissions \{ margin-inline: 0; \}/)
    expect(opsCss).toMatch(/\.adm \.form-grid ~ \.rowend \{ margin-top: 12px; \}/)
  })

  it('표 스크롤 영역은 위치 기준이라 열 머리 .sr-only가 문서 가로 스크롤을 만들지 않는다', () => {
    // .sr-only는 absolute에 위치 지정이 없어 표가 영역보다 넓으면 영역 밖(표 오른쪽 끝)에 놓인다. 영역이 위치 기준이 아니면 영역의 overflow가 못 자르고 페이지가 가로로 밀린다(작업 감시 실행 기록 표 848px, 창 약 1120px 이하).
    expect(opsCss).toMatch(/\.adm \.adm-scroll \{ position: relative; \}/)
  })
})

describe('storyfork.css 모바일 상단바 polish', () => {
  const mobile = '(max-width:600px)'

  it('390px에서 로고·검색·알림·테마·아바타가 한 줄에 담기도록 가로 간격은 4px이고 로고는 16px이다 (줄 사이 간격 10px은 그대로)', () => {
    // 한 줄 폭 358px(390 − 좌우 16px)에 로고(18px일 때 130px)·44·79·44·44px를 간격 10px로 놓으면 381px라 아바타만 둘째 줄로 내려갔다. 4px·16px이면 약 347px이다.
    expect(value('.gnb .in', 'gap', mobile)).toBe('10px 4px')
    expect(value('.gnb .logo', 'font-size', mobile)).toBe('16px')
  })

  it('주 메뉴(세계관·랭킹·캐릭터챗·내 서재) 글자는 같은 폭의 칸 가운데에 놓인다', () => {
    expect(value('.gnb .nav :is(button,a)', 'justify-content', mobile)).toBe('center')
  })
})

describe('storyfork.css 디자인 점검 P1 계약 (#623)', () => {
  it('main.wrap은 .wrap의 가로 패딩에 덮이지 않고 위 여백 32px을 갖는다 — 아래 여백은 푸터의 위 여백이 정하고, 읽기 면(.calm)은 자기 위 여백이 있어 더하지 않는다', () => {
    expect(value('main.wrap', 'padding-top')).toBe('32px')
    expect(values('main.wrap', 'padding-bottom')).toEqual([])
    expect(value('.calm main.wrap', 'padding-top')).toBe('0')
    // 모바일 홈의 위 여백 20px 보정은 위 규칙과 겹쳐 52px이 되므로 두지 않는다.
    expect(sheet.filter((r) => r.selectors.includes('#home') && /padding-top/.test(r.body))).toEqual([])
  })

  it('선택된 태그 칩의 개수 글자는 투명도로 흐리게 하지 않는다 — 흰 글자 × 0.8이 보라 면 위에서 4.25:1(AA 미달)이었다', () => {
    expect(values('.tagbar :is(button,a).on span', 'opacity')).toEqual([])
    expect(value('.tagbar :is(button,a).on span', 'color')).toBe('inherit')
  })
})

it('소설 상세 히어로의 장르 뒤 칩(자율 연재·연재 상태·원작 링크)은 인라인 style 대신 이 규칙으로 8px 띄운다', () => {
  expect(value('.whero-body .chip', 'margin-left')).toBe('8px')
})

describe('storyfork.css 실시간 인기(.t10) 순위 목록 계약 (홈 / 과 공개 세계관 /worlds가 같은 .t10을 쓴다)', () => {
  it('순위 목록(.t10 ol)은 위에서부터 쌓고 남는 높이를 줄 사이에 벌리지 않는다 — 패널 아래가 비어도 된다(space-between은 항목이 적을 때 줄 간격이 들쭉날쭉 벌어졌다)', () => {
    expect(value('.t10 ol', 'justify-content')).toBe('flex-start')
  })

  it('[quieter] "24시간 조회" 칩(.t10h .live)은 대기·주의 칩이 쓰는 주황(--acc-*)이 아니라 .chip과 같은 회색(--muted-bg·--sub)이다 — 금·은·동 메달(.md1~3)은 순위 정보라 색을 그대로 둔다', () => {
    expect(value('.t10h .live', 'background')).toBe('var(--muted-bg)')
    expect(value('.t10h .live', 'color')).toBe('var(--sub)')
  })

  it('[polish] "24시간 조회" 칩(.t10h .live)은 같은 줄 제목(.t10h h2, 800)보다 가벼운 600이다 — 회색 보조 칩이 제목과 같은 800이면 머리 줄이 두 덩어리로 겨뤘다(다른 보조 칩·관리 화면 칩 줄과 같은 600)', () => {
    expect(value('.t10h .live', 'font-weight')).toBe('600')
  })
})

describe('storyfork.css 상단바(.gnb) 계정 아바타 계약', () => {
  it('아바타는 상단바가 좁아져도 줄어들지 않는다 — 601~900px에서 메뉴·검색과 한 줄에 놓이면 flex 축소로 38×20 타원이 됐다', () => {
    expect(sheet.some((r) => r.media === '' && r.selectors.includes('.gnb .avatar') && /flex:\s*none/.test(r.body))).toBe(true)
  })
  it('901~1023px에서는 검색 칸이 줄어 한 줄에 맞춘다 — 검색 최소 폭 260px 때문에 테마·아바타가 찌그러지고 가로로 58px 넘쳤다. 넓은 화면에서는 글자 폭(약 300px) 그대로라 안내 문구가 두 줄로 꺾이지 않는다(260px로 묶으면 꺾였다). 테마 버튼도 줄지 않는다', () => {
    // 줄어드는 규칙은 짧은 안내('검색')만 보이는 901~1100px에만 둔다. 1101px 이상은 긴 안내가 보이므로 원래 규칙(최소 260px, 글자 폭) 그대로다.
    const search = sheet.find((r) => r.media === '(min-width:901px) and (max-width:1100px)' && r.selectors.includes('.gnb .search'))
    expect(search?.body).toMatch(/min-width:\s*0/)
    expect(search?.body).toMatch(/flex:\s*0 1 260px/)
    expect(sheet.some((r) => r.media === '(min-width:901px)' && r.selectors.includes('.gnb .search'))).toBe(false)
    expect(sheet.some((r) => r.media === '' && r.selectors.includes('.gnb .thm') && /flex:\s*none/.test(r.body))).toBe(true)
  })
})
