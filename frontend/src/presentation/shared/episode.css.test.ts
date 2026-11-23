import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const css = readFileSync(new URL('./episode.css', import.meta.url), 'utf8')
const sizes = (re: RegExp) => [...css.matchAll(re)].map((m) => Number(m[1]))
// 규칙을 선택자와 선언부로 나눈다(@media 안의 규칙 포함). jsdom은 CSS를 적용하지 않아 글자로 확인한다.
const rules = [...css.replace(/\/\*[\s\S]*?\*\//g, '').matchAll(/([^{}]+)\{([^{}]*)\}/g)].map((m) => ({ selector: m[1].trim(), body: m[2] }))
const rule = (selector: string) => rules.find((r) => r.selector === selector)?.body ?? ''
/** 주석을 지운 CSS에서 `@media <조건>{ … }` 안 규칙의 본문을 모은다(같은 조건의 덩어리가 여러 개여도 모두). 없으면 빈 글자다. */
const bare = css.replace(/\/\*[\s\S]*?\*\//g, '')
const mediaBody = (query: string, selector: string) => {
  const head = `@media${query}{`
  const bodies: string[] = []
  for (let at = bare.indexOf(head); at !== -1; at = bare.indexOf(head, at + 1)) {
    let depth = 0
    let end = at + head.length - 1
    for (; end < bare.length; end++) {
      if (bare[end] === '{') depth++
      else if (bare[end] === '}' && --depth === 0) break
    }
    for (const [, sel, body] of bare.slice(at + head.length, end).matchAll(/([^{}]+)\{([^}]*)\}/g)) if (sel.trim() === selector) bodies.push(body)
  }
  return bodies.join(';')
}
const wide = (selector: string) => mediaBody('(min-width:901px)', selector)
const narrow = (selector: string) => mediaBody('(max-width:900px)', selector)

describe('episode.css 접근성 계약', () => {
  it('글자 크기는 모두 12px 이상이고 font-size:0으로 숨기지 않는다', () => {
    // font 축약형은 `font:11px var(--mono)`·`font:700 26px var(--story)`처럼 크기 앞에 굵기가 올 수 있다.
    const small = [...sizes(/font-size:\s*([\d.]+)px/g), ...sizes(/font:\s*(?:[\w-]+\s+)*?([\d.]+)px/g)].filter((px) => px < 12)
    expect(small).toEqual([])
    expect(css).not.toMatch(/font-size:\s*0(?![\d.])/)
  })

  it('오류 안내 색은 --danger 토큰에서 만들어 고른 테마와 OS 테마를 함께 따른다 (light-dark()와 색 리터럴을 쓰지 않는다)', () => {
    const alert = css.match(/\.ep-alert\{([^}]*)\}/)?.[1] ?? ''
    for (const prop of ['background', 'color', 'border']) expect(alert, prop).toMatch(new RegExp(`${prop}:[^;]*var\\(--danger\\)`))
    // light-dark()는 storyfork.css 머리말이 쓰지 않기로 한 함수다(옛 브라우저에서 선언이 통째로 버려져 알림 상자의 면·테두리가 사라진다).
    expect(css).not.toMatch(/light-dark\(/)
    expect(alert).not.toMatch(/#[0-9a-fA-F]{3,8}\b/)
  })

  it('입력 칸 경계는 3:1 이상인 --line3를 쓰고, 터치 기기에서는 입력 글자를 16px로 올려 iOS 확대를 막는다', () => {
    const fields = rule('.ep-main input:not([type=checkbox]):not([type=radio]),.ep-main textarea')
    expect(fields).toMatch(/border:1px solid var\(--line3\)/)
    // select는 전역 셰브런을 지우지 않으려고 따로 두지만 경계는 같은 --line3다.
    expect(rule('.ep-main select')).toMatch(/border:1px solid var\(--line3\)/)
    const coarse = css.match(/@media\(pointer:coarse\)\{([^@]*)\}\s*$/m)?.[1] ?? ''
    expect(coarse).toMatch(/\.ep-main input:not\(\[type=checkbox\]\):not\(\[type=radio\]\),\.ep-main textarea,\.ep-main select,[^{]*\{font-size:16px\}/)
    // 큰 제목 입력(28px)은 그대로 둔다.
    expect(coarse).not.toMatch(/ep-create-title/)
  })

  it('틀(.episode-app)의 제목·폼·입력 규칙은 본문(.ep-main) 안에만 걸려, 같은 틀 안에 있는 세계관 작업실의 AI 채팅 레일로 새지 않는다', () => {
    // 세계관 작업실은 채팅 레일(.world-chat)을 .episode-app 안, .ep-main 밖에 둔다. 틀 규칙이 .episode-app 전체에 걸리면 채팅의 대화 선택 상자 글자가 잘리고 입력 칸이 이중 테두리가 된다.
    expect(css).not.toMatch(/\.episode-app (?:h1|h2|form|label|input|textarea|select|summary|button)[\s,:{[]/)
    for (const element of ['h1', 'h2', 'form', 'label', 'summary']) expect(css, element).toMatch(new RegExp(`\\.ep-main ${element}[\\s,:{]`))
  })

  it('전용 상단 헤더 규칙(.ep-header·.ep-brand·.ep-top-*·.ep-dot)과 전용 푸터(.ep-footer)를 남기지 않는다 — 상단과 하단은 공용 Gnb·Footer다', () => {
    expect(css).not.toMatch(/\.ep-(header|brand|top-meta|top-label|dot|footer)\b/)
  })
})

describe('episode.css 작품 관리 히어로 계약', () => {
  it('소설 상세(.whero)가 읽는 --t* 토큰을 이 화면의 전역 토큰에 연결해 라이트·다크가 함께 바뀐다', () => {
    const tokens = css.match(/\.episode-app\{(--tbg:[^}]*)\}/)?.[1] ?? ''
    for (const token of ['--tbg', '--tfg', '--tsub', '--tacc', '--tline', '--tcard', '--tfont', '--tbtn', '--tbtnfg']) {
      expect(tokens, token).toMatch(new RegExp(`${token}:var\\(--`))
    }
  })

  it('히어로는 표지 칸을 고정하고 900px 이하에서는 표지와 정보를 한 열로 쌓는다', () => {
    expect(css).toMatch(/\.episode-app \.ep-hero\{[^}]*grid-template-columns:240px minmax\(0,1fr\)/)
    expect(css).toMatch(/@media\(max-width:900px\)\{[^@]*\.episode-app \.ep-hero\{[^}]*grid-template-columns:1fr/)
  })

  it('옛 작품 헤더(.ep-work-header) 규칙을 남기지 않는다', () => {
    expect(css).not.toContain('ep-work-header')
  })

  it('집필실로 넘긴 원고 작성·AI 이어쓰기·회차 공개 카드의 규칙을 남기지 않는다', () => {
    expect(css).not.toMatch(/\.ep-(writing|editor|ai|publish|proposal|preview|title-label|body-label)\b/)
  })

  it('옛 작품 목록 사이드바 규칙을 남기지 않고 본문은 소설 상세 페이지와 같은 최대 폭으로 가운데에 둔다(왼쪽 메뉴가 있는 화면만 아래 계약대로 넓힌다)', () => {
    expect(css).not.toMatch(/\.ep-(shell|sidebar|side-title|side-note|new|work|book)\b/)
    expect(css).toMatch(/\.ep-main\{[^}]*max-width:1120px[^}]*margin:0 auto/)
  })

  it('히어로 제목 줄의 편집 버튼은 줄어들지 않고, 글자 단위 줄바꿈(anywhere)이 버튼 최소 폭을 글자 하나로 만들지 않는다', () => {
    // overflow-wrap:anywhere는 flex 항목의 최소 폭 계산에 반영돼 '편집' 버튼이 '편…'으로 잘렸다.
    expect(css).toMatch(/\.ep-title-row \.btn\{[^}]*flex:none/)
    expect(css).not.toMatch(/\.ep-hero-main\{[^}]*overflow-wrap:\s*anywhere/)
    expect(css).toMatch(/\.ep-title-row h1\{[^}]*overflow-wrap:\s*anywhere/)
  })
})

describe('episode.css 작품 관리 화면 정리 계약', () => {
  it('뒤로 가기는 알약 버튼이 아니라 테두리·배경 없는 글자 링크다', () => {
    const rule = css.match(/\.ep-back\{([^}]*)\}/)?.[1] ?? ''
    expect(rule).toMatch(/background:\s*none/)
    expect(rule).toMatch(/border:\s*0/)
    expect(rule).not.toMatch(/border-radius:\s*999px/)
  })

  it('회차 목록 탭은 탭 바와 같은 열에 왼쪽 정렬하고, 상속 회차 칩도 좁은 화면에서 제목 열 아래로 내린다', () => {
    expect(css).not.toMatch(/\.ep-episodes\{[^}]*(margin:\s*0 auto|max-width)/)
    expect(css).toMatch(/\.ep-list-foot\{[^}]*justify-content:\s*flex-start/)
    expect(css).toMatch(/@media\(max-width:650px\)\{[^@]*\.ep-list \.ep :is\(\.btn,\.chip\)\{[^}]*grid-column:\s*2/)
  })

  it('파일 선택은 기본 입력을 시각적으로만 숨기고(포커스·스크린리더는 유지) 라벨 버튼에 포커스 링을 그린다', () => {
    const input = css.match(/\.ep-file-pick input\[type=file\]\{([^}]*)\}/)?.[1] ?? ''
    expect(input).toMatch(/position:\s*absolute/)
    expect(input).toMatch(/opacity:\s*0/)
    expect(input).not.toMatch(/display:\s*none|visibility:\s*hidden/)
    expect(css).toMatch(/\.ep-file-pick:has\(input:focus-visible\)\{[^}]*outline:/)
  })

  it('포크 삭제는 채운 빨간 버튼이 아니라 외곽선 버튼이고 동작 줄의 오른쪽 끝에 놓인다', () => {
    const rule = css.match(/\.ep-danger\{([^}]*)\}/)?.[1] ?? ''
    expect(rule).toMatch(/background:\s*transparent/)
    expect(rule).toMatch(/color:\s*var\(--danger\)/)
    expect(rule).toMatch(/margin-left:\s*auto/)
  })

  it('설정집 편집 UI를 뺀 뒤 쓰지 않는 규칙(.ep-world*·.ep-setting-row)을 남기지 않는다', () => {
    expect(css).not.toMatch(/\.ep-world\b|\.ep-setting-row\b/)
  })
})

describe('episode.css 전역 select 규칙과의 공존', () => {
  it('select 규칙은 background·padding 단축 속성을 쓰지 않아 전역 셰브런(배경 이미지)과 오른쪽 여백을 지우지 않는다', () => {
    // 이 파일은 레이어 밖이라 단축 속성 하나가 전역(@layer base) select 규칙의 background-image·padding-right를 통째로 이긴다.
    const selects = rules.filter(({ selector }) => /(^|[\s,>+~])select(?![\w-])/.test(selector))
    expect(selects.length).toBeGreaterThan(0)
    for (const { selector, body } of selects) expect(body, selector).not.toMatch(/(^|;)\s*(background|padding)\s*:/)
  })

  it('select는 배경색을 직접 정하고 오른쪽 여백은 전역 규칙에 맡기며, 작은 select는 위아래 여백을 0으로 되돌린다', () => {
    const select = rule('.ep-main select')
    expect(select).toMatch(/background-color:var\(--surface\)/)
    // 받은 피드백 탭의 작은 select는 높이를 .inp.sm(34px)이 정하므로 위아래 여백을 0으로 되돌려야 글자가 잘리지 않는다.
    const small = rule('.ep-feedback select.inp.sm')
    expect(small).toMatch(/padding-block:0(?![\d.])/)
    for (const body of [select, small]) expect(body).not.toMatch(/padding-(right|inline-end)|padding-inline:/)
  })
})

describe('episode.css 작품 관리 조용히 다듬기 계약', () => {
  it('메뉴 hover는 선택한 항목의 강조 면과 잠긴 항목을 바꾸지 않는다', () => {
    const hover = css.match(/\.ep-menu nav button:hover:not\(([^)]*)\)\{([^}]*)\}/)
    expect(hover?.[2]).toMatch(/color:var\(--ink\)/)
    expect(hover?.[1]).toContain(':disabled')
    expect(hover?.[1]).toContain('[aria-current]')
  })
})

describe('episode.css 관리 화면 사이드바 틀 계약 (작품 관리·세계관 관리 공용 — 공용 상단바·푸터가 없고 사이드바가 상단바 역할을 한다)', () => {
  it('2열 틀(메뉴 | 내용): 메뉴가 있는 화면만 본문의 폭 제한(1120px)·가운데 정렬을 풀어 메뉴가 화면 왼쪽 끝에 붙고, 내용 열 안의 글·표는 읽기 좋은 폭(1072px)까지만 쓰고 열 안에서 가운데에 둔다', () => {
    expect(rule('.ep-manage')).toMatch(/grid-template-columns:208px minmax\(0,1fr\)/)
    expect(rule('.ep-main:has(.ep-manage)')).toMatch(/max-width:none;margin-inline:0/)
    const inner = rule('.ep-manage .ep-content>*')
    expect(inner).toMatch(/max-width:1072px/)
    expect(inner).toMatch(/margin-inline:auto/)
  })

  it('메뉴가 없는 화면(/content 만들기·내 제보·독서·집필실)의 본문 틀은 그대로다: .ep-main 기본은 1120px 가운데 정렬이고, 폭을 바꾸는 규칙은 .ep-manage가 있을 때(:has)뿐이다', () => {
    expect(rule('.ep-main')).toMatch(/max-width:1120px/)
    expect(rule('.ep-main')).toMatch(/margin:0 auto/)
    const widthRules = rules.filter((r) => /^\.ep-main\b/.test(r.selector) && /max-width|margin-inline/.test(r.body)).map((r) => r.selector)
    expect(widthRules).toEqual(['.ep-main', '.ep-main:has(.ep-manage)'])
  })

  it('사이드바는 공용 상단바(.gnb)가 없어 화면 맨 위(top:0)에 붙어 화면 높이를 다 쓰는 세로 열이고, 위·아래 줄은 늘 보이고 본문(.ep-menu-body)만 키가 모자라면 안에서 스크롤한다 — 상단바 아래에 붙던 값(top:81px·100dvh - 97px)은 없다', () => {
    const menu = rule('.ep-menu')
    expect(menu).toMatch(/position:sticky;top:0;height:100dvh/)
    expect(menu).toMatch(/display:flex;flex-direction:column/)
    expect(menu).toMatch(/overflow-y:auto/)
    expect(css).not.toMatch(/top:81px|100dvh - 97px/)
    const body = wide('.ep-menu-body')
    expect(body).toMatch(/flex:1 1 auto/)
    expect(body).toMatch(/min-height:0/)
    expect(body).toMatch(/overflow-y:auto/)
    // 본문 위 8px(.ep-main)도 없애 열이 화면 맨 위에서 시작하고, 내용 열은 16px 내려 시작한다.
    expect(wide('.ep-main:has(.ep-manage)')).toMatch(/padding-top:0/)
    expect(wide('.ep-manage .ep-content')).toMatch(/padding-top:16px/)
  })

  it('맨 위 줄은 로고와 접기 토글이 한 줄이고, 로고는 전역 .logo의 600px 이하 font-size:0(글자 없이 SF만)을 덮어 사이드바 폭(195px)에서 토글과 한 줄에 들어가는 15px이다', () => {
    expect(rule('.ep-menu-top')).toMatch(/display:flex;align-items:center;justify-content:space-between/)
    const logo = rule('.ep-menu-logo')
    expect(logo).toMatch(/font-size:15px/)
    expect(logo).toMatch(/min-width:0/)
  })

  it('접기 버튼은 44×44 토글이고 펼친 동안은 아이콘을 뒤집어(왼쪽으로 접는 방향) 보이며, 본문은 메뉴·도구를 같은 12px 간격으로 쌓는다', () => {
    expect(rule('.ep-menu-toggle')).toMatch(/width:44px;height:44px/)
    expect(rule('.ep-menu-toggle[aria-expanded=true] svg')).toMatch(/transform:scaleX\(-1\)/)
    expect(rule('.ep-menu-body')).toMatch(/display:grid;gap:12px/)
  })

  it('접기(901px 이상): 접힌 틀은 44px 열이고 메뉴 옆 선·여백이 없어지며 로고·계정 줄과 본문(hidden)이 숨는다 — 900px 이하(이미 가로 블록)에서는 토글을 숨기고 접힌 메뉴도 그대로 보인다', () => {
    const collapsed = '.ep-manage[data-menu=collapsed]'
    expect(wide(collapsed)).toMatch(/grid-template-columns:44px minmax\(0,1fr\);column-gap:20px/)
    expect(wide(collapsed + ' .ep-menu')).toMatch(/height:auto;padding-right:0;border-right:0/)
    expect(wide(collapsed + ' :is(.ep-menu-logo,.ep-menu-account)')).toMatch(/display:none/)
    expect(wide('.ep-menu-body[hidden]')).toMatch(/display:none/)
    expect(narrow('.ep-menu-toggle')).toMatch(/display:none/)
    expect(narrow(collapsed)).toBe('')
    // 900px 이하에는 hidden 규칙이 없다: 본문의 display(작성자 CSS)가 UA의 [hidden]을 이겨 접힌 메뉴도 그대로 보인다.
    expect(narrow('.ep-menu-body[hidden]')).toBe('')
  })

  it('도구 묶음은 줄바꿈하는 가로 줄이고 901px부터 margin-top:auto로 본문 아래쪽에 붙어 위 선으로 구분되며 세로로 쌓인다 — 도구 버튼은 모든 폭에서 옅은 테두리·600이다(.pri는 그대로)', () => {
    expect(rule('.ep-menu-tools')).toMatch(/display:flex;flex-wrap:wrap;align-items:center/)
    expect(rule('.ep-menu-tools .btn:not(.pri)')).toMatch(/border-color:var\(--line\);font-weight:600/)
    expect(wide('.ep-menu-tools')).toMatch(/display:grid;margin-top:auto;padding-top:12px;border-top:1px solid var\(--line2\)/)
    expect(wide('.ep-menu-tools .btn:not(.pri)')).toBe('') // 데스크톱 전용 규칙이 아니다
  })

  it('맨 아래 줄(알림·테마·계정): 알림은 왼쪽, 테마·계정은 오른쪽 끝의 44px 버튼이고 901px부터 위 선으로 구분된다 — 아바타 아래에 맞추는 공용 AccountMenu는 이 줄에서 위로 열고(900px 이하는 맨 위 줄이라 아래로 연다), 열릴 때 튀지 않게 애니메이션을 끈다', () => {
    expect(rule('.ep-menu-account')).toMatch(/display:flex;align-items:center;gap:8px/)
    expect(rule('.ep-menu-account .btn')).toMatch(/margin-right:auto/)
    expect(rule('.ep-menu-account :is(.thm,.avatar)')).toMatch(/flex:none;width:44px;height:44px/)
    expect(wide('.ep-menu-account')).toMatch(/padding-top:12px;border-top:1px solid var\(--line2\)/)
    const popup = wide('body:has(.ep-menu-account) .acctm')
    expect(popup).toMatch(/transform:translateY\(calc\(-100% - 60px\)\)/) // 자기 높이 + 아바타(44px) + 간격 16px
    expect(popup).toMatch(/animation:none/) // popin의 from 프레임이 transform을 덮어 열릴 때 튀지 않게
    expect(narrow('body:has(.ep-menu-account) .acctm')).toBe('')
  })

  it('사이드바 맨 아래 줄에 테마 버튼이 있으면 오른쪽 아래에 떠 있는 테마 버튼(공용 상단바가 없는 화면의 대체, GlobalChrome)은 숨겨 테마 버튼이 둘이 되지 않는다 — 공용 상단바가 있는 화면은 storyfork.css의 body:has(.gnb) .thm-float가 같은 일을 한다', () => {
    expect(rule('body:has(.ep-menu-account) .thm-float')).toMatch(/display:none/)
  })

  it('접힌 사이드바의 상단 줄(.ep-top)은 돌아가기 링크 하나만 담는다: 주 행동 묶음(.ep-top-actions)은 없어졌다(작품 관리의 사이드바 도구 묶음 삭제)', () => {
    expect(rule('.ep-top')).toMatch(/justify-content:space-between/)
    expect(rule('.ep-top-actions')).toBe('')
  })

  it('900px 이하: 사이드바는 내용 위 가로 블록이고 로고(맨 위 줄)와 계정 줄이 맨 위 한 줄에 놓이며(DOM 순서는 로고·본문·계정이라 order로 올린다) 본문이 다음 줄이다 — 메뉴(nav)는 줄바꿈하는 줄이다', () => {
    expect(narrow('.ep-manage')).toMatch(/grid-template-columns:minmax\(0,1fr\)/)
    expect(narrow('.ep-menu')).toMatch(/position:static;height:auto;overflow:visible;flex-direction:row;flex-wrap:wrap;align-items:center/)
    expect(narrow('.ep-menu-top')).toMatch(/flex:1 1 auto/)
    expect(narrow('.ep-menu-account')).toMatch(/order:1/)
    expect(narrow('.ep-menu-body')).toMatch(/order:2;flex:1 1 100%;min-width:0/)
    expect(narrow('.ep-menu nav')).toMatch(/display:flex;flex-wrap:wrap;gap:4px/) // 가로 스크롤이 아니라 줄바꿈이라 모든 탭이 보인다(아래 polish 계약)
    expect(narrow('.ep-menu nav button')).toMatch(/flex:none;white-space:nowrap/)
  })

  it('돌아가기 링크는 메뉴 항목과 같은 글자 크기·안쪽 여백이고(공용 .ep-back의 음수 왼쪽 여백 없음), 사이드바의 링크·버튼 초점 링은 스크롤 상자에 잘리지 않게 안쪽에 그린다', () => {
    const back = rule('.ep-menu .ep-menu-back')
    expect(back).toMatch(/margin:0/)
    expect(back).toMatch(/padding:6px 10px/)
    expect(back).toMatch(/font-size:13\.5px/)
    expect(rule('.ep-menu .ep-menu-back:hover')).toMatch(/background:var\(--muted-bg\);color:var\(--ink\)/)
    expect(rule('.ep-menu button:focus-visible,.ep-menu a:focus-visible')).toMatch(/outline-offset:-2px/)
  })
})

describe('episode.css 이력 탭 제목 단계', () => {
  it('저장본·AI 제안 항목 제목(h4)은 묶음 제목(h3)보다 한 단계 낮아 탭 제목(h2) > 묶음(h3) > 항목(h4) 순으로 작아지고, 항목은 덜 굵다', () => {
    expect(rule('.ep-reading :is(h3,h4)')).toMatch(/margin:20px 0 12px/)
    // Tailwind preflight를 쓰지 않아 제목 기본 크기가 브라우저 값(h3 1.17em ≈ 17.6px로 h2 17px보다 큼, h4 1em)이라 글자 크기를 직접 정한다.
    // 묶음 제목은 직계(>)만 건드려 항목 안 '조회한 문맥' 소제목(.ep-context h3, 15px)은 그대로다.
    const px = (selector: string) => Number(rule(selector).match(/font-size:(\d+)px/)?.[1])
    const [h2, h3, h4] = [px('.ep-main h2'), px('.ep-content .ep-reading>h3'), px('.ep-content .ep-reading h4')]
    expect(h2).toBeGreaterThan(h3)
    expect(h3).toBeGreaterThan(h4)
    expect(rule('.ep-content .ep-reading h4')).toMatch(/font-weight:600/)
  })
})

describe('episode.css 관리 화면 distill 계약 (작품 관리 탭 내용)', () => {
  it('탭 내용(.ep-reading·.ep-fork·.ep-feedback)은 가운데 정렬이 아니라 히어로·카드와 같은 왼쪽 선에서 시작한다', () => {
    // 탭마다 본문이 가운데에 놓여 메뉴를 누를 때마다 시작점이 156~211px씩 바뀌었다. 가로 margin만 0으로 맞추고 max-width(읽기 폭)는 둔다.
    expect(rule('.ep-content :is(.ep-reading,.ep-fork,.ep-feedback)')).toMatch(/margin-inline:0(?![\d.])/)
    // 이야기 분기만 있던 윗여백 40px도 다른 탭과 같게 없앤다.
    expect(rule('.ep-content .ep-fork')).toMatch(/margin-top:0(?![\d.])/)
  })

  it('이력 탭 저장본·AI 제안 항목(article)은 제목·시각·버튼 세 줄에 맞는 좁은 여백이고, 항목의 직계 제목·문단에만 닿아 펼친 원고 안의 문단은 건드리지 않는다', () => {
    expect(rule('.ep-content .ep-reading article')).toMatch(/padding:12px 0 16px/)
    expect(rule('.ep-content .ep-reading article>:is(h4,p)')).toMatch(/margin:6px 0/)
    // 후손 선택자(article :is(h4,p))는 펼친 원고(div.manuscript-body)의 문단 규칙(margin:0, 특이도 0,2,2)과 같은 특이도라 불러오는 순서에 따라 문단 사이가 벌어진다.
    expect(css).not.toMatch(/article :is\(h4,p\)/)
  })

  it('세계관 탭의 연결·설정집 구획은 테두리 없는 구획(tcard 없음)이라 카드 안쪽 여백도 두지 않는다', () => {
    expect(rule('.episode-app .ep-card:not(.tcard)')).toMatch(/padding:0(?![\d.])/)
  })
})

describe('episode.css 관리 화면 quieter 계약 (작품 관리)', () => {
  it('이력·운영 탭의 안내·빈 상태 문단과 저장 시각은 다른 탭의 보조 문장과 같은 보조색이고, 알림 역할(role)이 붙은 문단은 건드리지 않는다', () => {
    expect(rule('.ep-content .ep-reading>p:not([role])')).toMatch(/color:var\(--sub\)/)
    const time = rule('.ep-content .ep-reading article time')
    expect(time).toMatch(/color:var\(--sub\)/)
    expect(time).toMatch(/font-size:13px/)
  })

  it('히어로 해시태그는 누를 수 없는 글자라 강조색 알약이 아니라 .chip과 같은 회색 알약이다 (소설 상세의 링크 태그는 .episode-app 밖이라 그대로)', () => {
    const tag = rule('.episode-app .ep-hero .hashes span')
    expect(tag).toMatch(/background:var\(--muted-bg\)/)
    expect(tag).toMatch(/color:var\(--sub\)/)
    expect(tag).not.toMatch(/--pri/)
  })

  it('이야기 분기 탭 제목은 다른 탭 제목(h2 17px)과 같은 크기라 26px 표제 규칙을 두지 않는다', () => {
    expect(css).not.toMatch(/\.ep-fork h2\{[^}]*font-size/)
  })

  it('히어로 제목은 관리 도구에 맞게 32px·700이고 명조(--tfont)는 유지한다', () => {
    const h1 = rule('.episode-app .ep-hero h1')
    expect(h1).toMatch(/font-family:var\(--tfont\)/)
    expect(h1).toMatch(/font-size:32px/)
    expect(h1).toMatch(/font-weight:700/)
  })

  it('삭제 버튼의 테두리는 위험색이 아니라 다른 외곽선 버튼과 같은 회색이고, 위험 신호는 빨간 글자와 hover의 옅은 빨간 면이 맡는다', () => {
    const danger = rule('.episode-app .ep-danger')
    expect(danger).toMatch(/border-color:var\(--line2\)/)
    expect(danger).toMatch(/color:var\(--danger\)/)
    expect(rule('.episode-app .ep-danger:hover')).toMatch(/background:color-mix\(in srgb,var\(--danger\) 10%,transparent\)/)
  })

  it('카드 머리(.ep-sec-head)가 있는 tcard는 운영 설정 카드뿐이라 따로 평탄화하지 않고, .ep-card.tcard 전체에 거는 규칙도 없다(세계관 관리의 큰 카드·이어받는 원작 세계관 카드는 그대로)', () => {
    const selectors = rules.map((r) => r.selector)
    expect(selectors).not.toContain('.episode-app .ep-card.tcard:has(>.ep-sec-head)')
    expect(selectors).not.toContain('.episode-app .ep-card.tcard')
  })

  it('받은 피드백의 두 구획 사이는 다른 탭의 구획 간격(32px)이다 (첫 구획은 inline marginTop:0이 우선해 그대로)', () => {
    expect(rule('.ep-feedback .sec')).toMatch(/margin-top:32px/)
  })
})

describe('episode.css 관리 화면 polish(작품 관리)', () => {
  it('탭 내용 묶음은 요약(.ep-brief) 다음일 때만 위쪽 선 하나와 16px 안쪽 여백으로 시작한다(요약이 없는 개요에는 선을 긋지 않는다)', () => {
    const tab = rule('.ep-brief+.ep-tab')
    expect(tab).toMatch(/border-top:1px solid var\(--line2\)/)
    expect(tab).toMatch(/padding-top:16px/)
    expect(rule('.ep-tab')).toBe('')
  })

  it('운영 설정의 저장 버튼은 모든 폭에서 안내문 아래 왼쪽에 놓인다 — 좁은 폭의 align-self:flex-end도 이 패널에서만 되돌린다', () => {
    const footer = rule('.ep-operating-settings .ep-form-footer')
    expect(footer).toMatch(/flex-direction:\s*column/)
    expect(footer).toMatch(/align-items:\s*flex-start/)
    expect(rule('.ep-operating-settings .ep-form-footer button')).toMatch(/align-self:\s*auto/)
  })

  it('설정 변경 이력과 발행 이력의 시각은 숫자 폭이 같아 행마다 어긋나지 않는다', () => {
    expect(rule('.ep-settings-history')).toMatch(/font-variant-numeric:\s*tabular-nums/)
  })
})

describe('episode.css 작품 관리 화면 polish 계약 (A·B 리뷰 반영)', () => {
  it('[P0] 쉴 때의 히어로(.ep-hero-compact)는 88px 표지 썸네일 + 제목·칩·두 줄 소개·태그 한 덩어리라 고른 탭의 내용이 첫 화면 안에서 시작한다 — 편집 중에는 이 클래스가 빠져 옛 큰 히어로(240px 표지)가 폼에 넓은 칸을 준다', () => {
    expect(rule('.episode-app .ep-hero.ep-hero-compact')).toMatch(/grid-template-columns:88px minmax\(0,1fr\);gap:0 16px/)
    expect(rule('.ep-hero-compact .ep-hero-cover')).toMatch(/max-width:none/) // 900px 이하의 표지 폭 제한(220px)을 덮는다
    expect(rule('.episode-app .ep-hero.ep-hero-compact h1')).toMatch(/font-size:24px/)
    const sum = rule('.episode-app .ep-hero.ep-hero-compact .sum')
    expect(sum).toMatch(/-webkit-line-clamp:2/) // 소개는 숨기지 않고 두 줄까지만 보인다(전문은 작품 정보 편집에 있다)
    expect(sum).toMatch(/overflow:hidden/)
    expect(sum).not.toMatch(/display:none/)
    expect(rule('.ep-hero-compact .ep-hero-cover [role=status]:empty')).toMatch(/min-height:0/) // 빈 결과 문구 자리가 썸네일 아래를 늘리지 않는다
    // 작은 썸네일에 큰 표지의 짙고 넓은 그림자(24px 60px)와 18px 모서리를 그대로 두지 않는다. 표지 편집 버튼은 열 폭(88px)을 채워 넘치지 않는다.
    expect(rule('.episode-app .ep-hero-compact .ep-cover')).toMatch(/border-radius:10px;box-shadow:var\(--sh\)/)
    expect(rule('.ep-hero-compact .ep-hero-cover .btn')).toMatch(/justify-self:stretch;padding-inline:0/)
    // 기본 히어로 규칙(240px 표지)은 그대로다: 새 작품 만들기·편집 중의 히어로.
    expect(rule('.episode-app .ep-hero')).toMatch(/grid-template-columns:240px minmax\(0,1fr\)/)
  })

  it('[P1-1] 카드의 margin은 margin-bottom뿐이다: 단축 속성(margin:0 0 32px)이 내용 열 직계 자식의 가운데 정렬(margin-inline:auto)을 지워 분기 정책·세계관 본문 카드만 40px 어긋났다', () => {
    const card = rule('.episode-app .ep-card')
    expect(card).not.toMatch(/(^|;)\s*margin\s*:/)
    expect(card).toMatch(/margin-bottom:32px/)
    expect(rule('.ep-manage .ep-content>*')).toMatch(/margin-inline:auto/)
  })

  it('[P1-2] 900px 이하 메뉴 줄은 가로 스크롤이 아니라 줄바꿈이라 모든 탭이 보인다(잘린 탭·넘침 신호 없음)', () => {
    const nav = narrow('.ep-menu nav')
    expect(nav).toMatch(/display:flex;flex-wrap:wrap;gap:4px/)
    expect(nav).not.toMatch(/overflow-x|scrollbar-width/)
  })

  it('[P2-4] 비어 있는 상태 줄(.ep-notice:empty)은 내용 열에서 자리를 차지하지 않는다 — 요소는 라이브 영역이라 남기고 높이만 0이다', () => {
    expect(rule('.ep-content>.ep-notice:empty')).toMatch(/min-height:0;margin:0/)
  })

  it('[P2-5] 탭 구획(.ep-reading·.ep-fork·.ep-feedback)은 내용 열 폭을 다 쓰고, 읽기 폭 제한은 입력(분기 폼)과 안내문에만 둔다 — 탭마다 650·760·1072로 달랐던 폭이 하나다', () => {
    expect(rule('.ep-content :is(.ep-reading,.ep-fork,.ep-feedback)')).toMatch(/max-width:none/)
    expect(rule('.ep-content .ep-fork form')).toMatch(/max-width:650px/)
    expect(rule('.ep-content .ep-lead')).toMatch(/max-width:62ch/)
  })

  it('공개 회차 탭의 작성 중인 초안 묶음(.ep-drafts)은 없어졌다: 초안은 집필실 회차 목록에서 열어, 그 규칙을 남기지 않는다', () => {
    expect(css).not.toMatch(/\.ep-drafts\b/)
  })

  it('[R9] 회차 행 전체 클릭: 행 안의 유일한 링크(수정하기, .ep-row-link)의 ::after가 행(.ep, 기준 위치)을 덮고, 링크가 없는 잠긴·상속 행은 hover 면도 없다', () => {
    expect(rule('.ep-list .ep')).toMatch(/position:relative/)
    expect(rule('.ep-list .ep-row-link::after')).toMatch(/content:'';position:absolute;inset:0/)
    expect(rule('.ep-list .ep:not(:has(.ep-row-link)):hover')).toMatch(/background:none/)
    // 포크 수 툴팁(title)은 덮개 위에 둬 살아 있다. 링크에 transform을 걸면 ::after의 기준이 버튼으로 바뀌므로 걸지 않는다.
    expect(rule('.ep-list .ep .d [title]')).toMatch(/position:relative;z-index:1/)
    expect(rule('.ep-list .ep-row-link')).not.toMatch(/transform/)
  })

  it('[P2-7] 탭 내용 묶음의 직계 탭 제목(h2)은 아래 간격을 둔다', () => {
    expect(rule('.ep-tab>h2')).toMatch(/margin:0 0 16px/)
  })

  it('[P2-8] 잠긴 저장 버튼(.pri)은 채운 보라가 아니라 옅은 윤곽선이라 눌러도 되는 버튼처럼 보이지 않는다 — 글자색을 --ink로 되돌려 라이트에서 흰 글자가 되지 않게 한다(세계관의 잠긴 저장 버튼과 같은 모양)', () => {
    const locked = rules.find((r) => /\.btn\.pri:disabled$/.test(r.selector) && r.selector.includes('.ep-edit-actions'))
    expect(locked?.body).toMatch(/background:none;border-color:var\(--line2\);color:var\(--ink\)/)
    expect(locked?.selector).toContain('.ep-operating-settings .ep-form-footer')
    // AI 집필 탭의 설정 저장도 같은 잠긴 모양이다(채운 연보라 + 흰 글자라 읽기 어렵고 운영 설정과 달랐다).
    expect(locked?.selector).toContain('.ep-serial .ep-form-footer')
  })

  it('[R11] 운영 설정 탭 카드: 넓은 화면은 2열 격자이고, 패널 껍데기(.ep-operating-settings)는 격자에 끼지 않으며(display:contents) 카드가 아닌 것(알림·불러오는 중)은 한 줄을 다 쓴다. 카드 틀은 이 탭 규칙 하나이고(margin:0이 카드 아래 간격을 grid gap 하나로 모은다) 삭제 구역은 맨 아래 전체 폭이다', () => {
    expect(rule('.ep-settings-cards')).toMatch(/display:grid;grid-template-columns:repeat\(auto-fit,minmax\(min\(100%,420px\),1fr\)\)/)
    expect(rule('.ep-settings-cards>.ep-operating-settings')).toMatch(/display:contents/)
    expect(rule('.ep-settings-cards>.ep-operating-settings>:not(.ep-card)')).toMatch(/grid-column:1\/-1/)
    expect(rule('.episode-app .ep-settings-cards .ep-card.tcard')).toMatch(/margin:0/)
    expect(rule('.episode-app .ep-settings-cards .ep-delete')).toMatch(/grid-column:1\/-1/)
  })

  it('[approve] 운영 설정 카드 배치: 집필 방식 카드는 왼쪽 두 줄을 차지해 오른쪽에 자동 처리·설정 변경 이력이 쌓이고, 틀의 직계 카드(분기 정책·포크 정보)는 전체 폭이다', () => {
    expect(rule('.ep-settings-cards>.ep-operating-settings>.ep-card:first-of-type')).toMatch(/grid-row:span 2/)
    expect(rule('.ep-settings-cards>.ep-card')).toMatch(/grid-column:1\/-1/)
  })

  it('[P2-8] 운영 설정의 저장 버튼과 잠긴 이유는 한 줄(.ep-form-actions)에 나란히 놓인다', () => {
    expect(rule('.ep-operating-settings .ep-form-actions')).toMatch(/display:flex;flex-wrap:wrap;align-items:center/)
  })

  it('[P2-8] 하위 묶음(h3) 위 간격(32px)은 제목과 내용 사이 간격보다 커서 자동 처리·설정 변경 이력이 한 묶음처럼 읽히지 않는다', () => {
    expect(rule('.ep-content .ep-reading>h3')).toMatch(/margin-top:32px/)
    expect(rule('.ep-content .ep-reading>h3')).toMatch(/font-size:16px/)
  })

  it('탭 제목(h2) 아래 묶음 제목(h3) — 분기 정책·포크 정보·작품 삭제의 카드 머리, 세계관 패널, 이야기 분기 머리글, 받은 피드백의 구획, 개요 대시보드의 구획 — 은 모두 같은 16px이다', () => {
    const group = rule('.ep-tab :is(.ep-sec-head,.ep-card,.ep-fork,.ep-feedback .sec-h,.ep-dash section)>h3')
    expect(group).toMatch(/font-size:16px/)
    expect(group).toMatch(/font-weight:700/)
  })

  it('작품 삭제 구획은 운영 설정 탭 맨 아래에서 위 구획과 넉넉히(48px) 떨어진 위험 구역이다', () => {
    expect(rule('.ep-tab .ep-delete')).toMatch(/margin-top:48px/)
  })

  it('스킵 링크가 초점을 주는 내용 열(.ep-content[tabindex="-1"])은 main처럼 초점 링을 그리지 않는다(내용 열 전체를 두르는 큰 링이 뜨지 않게)', () => {
    expect(rule('.ep-content[tabindex="-1"]:focus')).toMatch(/outline:none/)
  })

  // ── 2단계 critique(#754 G2): 시각 평가(A)와 소스 감사(B)를 반영한 규칙 ──
  it('[critique] 개요 지표 카드는 줄바꿈 flex이고 카드는 128px부터 늘어나 줄 끝에 홀로 남는 칸이 없다', () => {
    expect(rule('.ep-metrics')).toMatch(/display:flex;flex-wrap:wrap/)
    expect(rule('.ep-metrics>div')).toMatch(/flex:1 1 128px/)
    expect(rule('.ep-metrics')).not.toMatch(/grid-template-columns/)
  })

  it('[critique] 운영 설정 카드 머리는 44px이고 제목 바깥 여백은 0이다', () => {
    expect(rule('.ep-settings-cards .ep-sec-head')).toMatch(/min-height:44px/)
    expect(rule('.ep-settings-cards .ep-sec-head>h3')).toMatch(/margin:0/)
  })

  it('[critique] 운영 설정 카드 격자는 같은 줄 카드의 높이를 맞춘다(start가 아니라 stretch)', () => {
    expect(rule('.ep-settings-cards')).toMatch(/align-items:stretch/)
  })

  it('[critique] 회차 행은 수정하기 링크에 키보드 초점이 있으면 hover와 같은 행 면을 쓴다', () => {
    expect(rule('.ep-list .ep:has(.ep-row-link:focus-visible)')).toMatch(/background:color-mix\(in srgb,var\(--tfg\) 4%,transparent\)/)
  })

  it('[critique] 개요 최근 발행 이력 줄은 한 줄 글(block)이라 구분점 뒤에 flex 틈이 생기지 않는다', () => {
    expect(rule('.ep-dash .ep-settings-history li')).toMatch(/display:block/)
  })
})

describe('episode.css 작품 관리 quieter (G2 4단계)', () => {
  it('[quieter] 개요 밖 탭 요약 썸네일은 개요 히어로 썸네일과 같은 10px·--sh이고, 통계 숫자는 600이다', () => {
    expect(rule('.episode-app .ep-brief .ep-cover')).toMatch(/border-radius:10px;box-shadow:var\(--sh\)/)
    expect(rule('.episode-app .ep-brief .stats b')).toMatch(/font-weight:600/)
  })

  it('[quieter] 개요 바로가기 알약은 지표보다 무겁지 않게 옅은 테두리(--line)·600이다', () => {
    expect(rule('.episode-app .ep-shortcut')).toMatch(/border-color:var\(--line\);font-weight:600/)
  })

  it('[quieter] 카드 값(.ep-facts dd)은 카드 제목(h3 700)보다 한 단계 가벼운 600이다', () => {
    expect(rule('.ep-facts dd')).toMatch(/font-weight:600/)
    expect(rule('.ep-tab :is(.ep-sec-head,.ep-card,.ep-fork,.ep-feedback .sec-h,.ep-dash section)>h3')).toMatch(/font-weight:700/)
  })

  it('[quieter] 작품 삭제 카드는 다른 카드와 같은 면이고 위험 신호는 빨간 테두리·버튼 글자가 맡는다', () => {
    const del = rule('.episode-app .ep-settings-cards .ep-delete')
    expect(del).toMatch(/background:var\(--surface\)/)
    expect(del).toMatch(/border:1px solid color-mix\(in srgb,var\(--danger\) 35%,var\(--line2\)\)/)
  })

  it('[quieter] 작품 관리 회차 목록은 16px 모서리이고 번호는 보조색이다(소설 상세의 .ep .no는 건드리지 않는다)', () => {
    expect(rule('.episode-app .ep-list.tcard')).toMatch(/border-radius:16px/)
    expect(rule('.ep-list .ep .no')).toMatch(/color:var\(--tsub\)/)
    expect(rule('.ep .no')).toBe('')
  })

  it('[quieter] 개요 발행 이력은 줄 사이 선만 있고 마지막 줄 아래 선은 없다(운영 설정 이력은 그대로)', () => {
    expect(rule('.ep-dash .ep-settings-history li:last-child')).toMatch(/border-bottom:0/)
    expect(rule('.ep-settings-history li')).toMatch(/border-bottom:\s*1px solid var\(--line2\)/)
  })
})

describe('episode.css 작품 관리 polish (G2 5단계)', () => {
  it('[polish] 650px 이하 알림 상자의 직계 버튼은 글 뒤에 붙지 않고 아래 줄에 선다', () => {
    expect(mediaBody('(max-width:650px)', '.ep-alert>button')).toMatch(/display:flex;width:fit-content/)
    expect(mediaBody('(max-width:650px)', '.ep-alert button')).toMatch(/margin-top:10px/)
  })

  it('[polish] 집필 방식 카드는 머리 아래 8px에서 select가 시작한다(숨긴 라벨 몫의 위 여백 없음)', () => {
    expect(rule('.ep-operating-settings form')).toMatch(/margin-top:\s*8px/)
    expect(rule('.ep-operating-settings select')).toMatch(/margin-top:\s*0/)
  })

  it('[polish] 공개 회차 목록 머리 버튼 문단은 아래 안내문과 16px 떨어진다', () => {
    expect(rule('.ep-list-head')).toMatch(/margin:0 0 16px/)
  })

  it('[polish] 이력 탭 발행 이력 줄도 개요처럼 한 줄 글(block)이라 <time> 앞뒤 구분점이 매달리지 않고, 운영 설정의 이력 줄(flex)은 그대로다', () => {
    expect(rule('.ep-reading>.ep-settings-history li')).toMatch(/display:block/)
    expect(rule('.ep-settings-history li')).toMatch(/display:\s*flex/)
  })
})
