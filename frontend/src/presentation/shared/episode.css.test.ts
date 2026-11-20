import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const css = readFileSync(new URL('./episode.css', import.meta.url), 'utf8')
const sizes = (re: RegExp) => [...css.matchAll(re)].map((m) => Number(m[1]))
// 규칙을 선택자와 선언부로 나눈다(@media 안의 규칙 포함). jsdom은 CSS를 적용하지 않아 글자로 확인한다.
const rules = [...css.replace(/\/\*[\s\S]*?\*\//g, '').matchAll(/([^{}]+)\{([^{}]*)\}/g)].map((m) => ({ selector: m[1].trim(), body: m[2] }))
const rule = (selector: string) => rules.find((r) => r.selector === selector)?.body ?? ''

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
    const fields = rule('.episode-app input:not([type=checkbox]):not([type=radio]),.episode-app textarea')
    expect(fields).toMatch(/border:1px solid var\(--line3\)/)
    // select는 전역 셰브런을 지우지 않으려고 따로 두지만 경계는 같은 --line3다.
    expect(rule('.episode-app select')).toMatch(/border:1px solid var\(--line3\)/)
    const coarse = css.match(/@media\(pointer:coarse\)\{([^@]*)\}\s*$/m)?.[1] ?? ''
    expect(coarse).toMatch(/\.episode-app input:not\(\[type=checkbox\]\):not\(\[type=radio\]\),\.episode-app textarea,\.episode-app select,[^{]*\{font-size:16px\}/)
    // 큰 제목 입력(28px)은 그대로 둔다.
    expect(coarse).not.toMatch(/ep-create-title/)
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
    const select = rule('.episode-app select')
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

describe('episode.css 관리 화면 왼쪽 사이드바 계약', () => {
  it('왼쪽 메뉴는 상단바 아래에 붙는(sticky) 열이고 넘치면 안에서 스크롤하며, 900px 이하에서는 내용 위의 가로 스크롤 줄이 된다', () => {
    // 작품 관리·세계관 관리가 함께 쓰는 2열 틀: 메뉴 | 내용. 메뉴가 있는 화면만 본문 폭을 넓혀 내용 폭을 지킨다.
    expect(rule('.ep-manage')).toMatch(/grid-template-columns:\d+px minmax\(0,1fr\)/)
    expect(css).toMatch(/\.ep-main:has\(\.ep-manage\)\{[^}]*max-width:1[3-9]\d\dpx/)
    const menu = rule('.ep-menu')
    expect(menu).toMatch(/position:sticky/)
    expect(menu).toMatch(/top:\d+px/) // 상단바(.gnb) 바로 아래
    expect(menu).toMatch(/max-height:calc\(100dvh/)
    expect(menu).toMatch(/overflow-y:auto/)
    const narrow = [...css.matchAll(/@media\(max-width:900px\)\{((?:[^@{}]|\{[^{}]*\})*)\}/g)].map((m) => m[1]).join('')
    expect(narrow).toMatch(/\.ep-manage\{[^}]*grid-template-columns:minmax\(0,1fr\)/)
    expect(narrow).toMatch(/\.ep-menu\{[^}]*position:static/)
    expect(narrow).toMatch(/\.ep-menu nav\{[^}]*display:flex[^}]*overflow-x:auto/)
    expect(narrow).toMatch(/\.ep-menu nav button\{[^}]*flex:none[^}]*white-space:nowrap/)
    // 스크롤 상자는 바깥으로 넘친 초점 링을 자르므로 메뉴 안의 링은 안쪽에 그린다.
    expect(css).toMatch(/\.ep-menu button:focus-visible\{[^}]*outline-offset:-2px/)
  })
})

describe('episode.css 이력 탭 제목 단계', () => {
  it('저장본·AI 제안 항목 제목(h4)은 묶음 제목(h3)과 같은 여백·글자 크기라 단계만 낮아지고 눈으로는 같다', () => {
    expect(rule('.ep-reading :is(h3,h4)')).toMatch(/margin:20px 0 12px/)
    // Tailwind preflight를 쓰지 않아 제목 기본 크기가 브라우저 값(h3 1.17em, h4 1em) 그대로다: h4에 같은 크기를 줘야 단계를 낮춰도 작아 보이지 않는다.
    expect(rule('.ep-reading h4')).toMatch(/font-size:1\.17em/)
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
