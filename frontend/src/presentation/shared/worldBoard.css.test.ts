import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const board = readFileSync(new URL('./worldBoard.css', import.meta.url), 'utf8')
const studio = readFileSync(new URL('../features/worldstudio/view/world-studio.css', import.meta.url), 'utf8')
const map = readFileSync(new URL('../features/worldstudio/view/world-map.css', import.meta.url), 'utf8')
/** 선택자 블록 하나의 선언부(쉼표로 묶인 선택자는 그 블록을 통째로 찾는다). */
const rule = (css: string, selector: string) => css.match(new RegExp(`(?:^|\\})\\s*${selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*\\{([^}]*)\\}`, 'm'))?.[1] ?? ''
/** `@media (…)`·`@container …` 블록 하나의 안쪽(중첩된 규칙 포함). 공백 차이는 무시한다. */
const block = (css: string, head: string) => {
  const start = css.indexOf(head)
  if (start < 0) return ''
  let depth = 0
  for (let i = css.indexOf('{', start); i < css.length; i += 1) {
    if (css[i] === '{') depth += 1
    else if (css[i] === '}' && --depth === 0) return css.slice(css.indexOf('{', start) + 1, i).replace(/\s+/g, ' ').trim()
  }
  return ''
}

describe('설정 카드 게시판(공개 설정집·세계관 설정집 탭 공용) 도구줄·표 규칙', () => {
  it('검색 칸은 placeholder가 잘리지 않을 최소 폭을 지키고, 정렬 라벨·결과 수는 한 줄로 둔다', () => {
    expect(rule(board, '.worlds-search')).toMatch(/min-width:\s*min\(\s*260px,\s*100%\s*\)/)
    expect(rule(board, '.worlds-sort')).toMatch(/white-space:\s*nowrap/)
    expect(rule(board, '.worlds-sort')).toMatch(/flex:\s*none/)
    expect(rule(board, '.worlds-board-tools p')).toMatch(/white-space:\s*nowrap/)
  })

  it('표 머리는 줄바꿈하지 않고 제목 열은 넉넉한 비율의 너비를 가지며 요약은 말줄임이다', () => {
    expect(rule(board, '.worlds-board-table th')).toMatch(/white-space:\s*nowrap/)
    expect(rule(board, '.worlds-board-table th.col-title')).toMatch(/width:\s*34%/)
    expect(rule(board, '.worlds-board-table .col-title')).toMatch(/word-break:\s*keep-all/)
    expect(rule(board, '.worlds-board-table .col-sum')).toMatch(/text-overflow:\s*ellipsis/)
  })
})

describe('설정 카드 게시판의 좁은 배치와 터치 영역', () => {
  it('좁은 배치는 뷰포트(720px 이하)와 게시판을 감싼 컨테이너(worlds-board, 760px 이하) 두 기준이 같은 규칙을 쓴다', () => {
    const byViewport = block(board, '@media (max-width: 720px)')
    expect(byViewport).toMatch(/\.worlds-board \{ grid-template-columns: minmax\(0, 1fr\)/)
    expect(byViewport).toMatch(/\.worlds-board-table :is\(\.col-no, \.col-sum\) \{ display: none; \}/)
    expect(block(board, '@container worlds-board (max-width: 760px)')).toBe(byViewport) // 한쪽만 고치면 두 화면의 좁은 모양이 어긋난다
  })

  it('제목 링크·버튼은 줄 높이를 바꾸지 않고 누르는 영역만 44px 안팎으로 넓힌다', () => {
    expect(rule(board, '.worlds-board-table .col-title :is(a, button)')).toMatch(/position:\s*relative/)
    expect(rule(board, '.worlds-board-table .col-title :is(a, button)::after')).toMatch(/position:\s*absolute;\s*inset:\s*-12px -10px/)
  })
})

describe('세계관 작업실 레이아웃 규칙', () => {
  it('설정집 게시판은 본문 폭을 기준으로 삼는 컨테이너라 채팅 레일이 열려도 좁은 배치로 바뀌고, 숨는 분류·요약은 제목 아래 한 줄로 보인다(열 숨김 기준은 600px 미만, 분류 칩 줄은 1000px 이하)', () => {
    expect(rule(studio, '.world-card-library')).toMatch(/container:\s*worlds-board\s*\/\s*inline-size/)
    const narrow = block(studio, '@container worlds-board (max-width:599px)')
    expect(narrow).toMatch(/\.world-card-library \.worlds-board-table :is\(\.col-sum,\.col-kind,\.col-num\)\{display:table-cell;visibility:hidden;width:0;padding:0;border:0\}/) // 숨기는 열은 폭 0의 보이지 않는 칸이다(열 수가 늘 7개)
    expect(narrow).toMatch(/\.world-row-sub\{display:flex/)
    expect(rule(studio, '.world-row-sub')).toMatch(/display:\s*none/) // 600px 이상 본문에서는 분류·요약 칸이 보이므로 숨긴다
    // 채팅을 연 1440px(게시판 폭 약 748px)에서도 한 줄 행이 되도록 600px부터 요약 칸을 되살린다(번호 칸은 공용 규칙대로 숨긴 채): 특이도 (0,3,0)이 공용 (0,2,0)을 이긴다.
    expect(block(studio, '@container worlds-board (min-width:600px)')).toMatch(/\.world-card-library \.worlds-board-table \.col-sum\{display:table-cell\}/)
    expect(block(board, '@container worlds-board (max-width: 760px)')).toMatch(/:is\(\.col-no, \.col-sum\) \{ display: none; \}/) // 공용 게시판의 760px 규칙은 그대로다(공개 설정집 /worlds는 변화 없음)
    expect(studio).not.toMatch(/@media\(max-width:(720|480)px\)/) // 뷰포트 기준 분기는 채팅 레일(300~350px)을 몰라 표가 넘쳤다
    expect(rule(studio, '.world-board-scroll')).toMatch(/overflow-x:\s*auto/)
  })

  it('행 선택 칸은 44px 터치 영역이고 저장을 막는 사유 버튼·공개 스위치 줄도 44px 높이를 지킨다', () => {
    expect(rule(studio, '.world-card-library .worlds-board-table .col-pick')).toMatch(/width:44px;padding:0/)
    expect(rule(studio, '.episode-app .world-pick')).toMatch(/min-height:44px/)
    expect(rule(studio, '.world-save-issue button')).toMatch(/min-height:44px/)
    expect(rule(studio, '.world-card-reach .world-consent')).toMatch(/min-height:44px/)
  })

  it('관계 편집기는 뷰포트가 아니라 자기 폭이 좁을 때 그래프와 관계 폼을 위아래로 쌓는다', () => {
    expect(rule(map, '.relationship-editor')).toMatch(/container:\s*relationship-editor\s*\/\s*inline-size/)
    expect(block(map, '@container relationship-editor (max-width:950px)')).toMatch(/\.relationship-service-layout\{grid-template-columns:minmax\(0,1fr\)\}/)
    expect(map).not.toMatch(/@media\(max-width:1050px\)/)
  })

  it('인물관계도 무대의 고정 색은 한 곳에서 변수로 정하고 쓰지 않는 옛 지도 규칙은 두지 않는다', () => {
    const literals = map.replace(/\/\*[\s\S]*?\*\//g, '').match(/#[0-9a-fA-F]{3,8}\b|rgba?\([^)]*\)/g) ?? []
    expect(literals.length).toBeLessThanOrEqual(6) // 무대 그라데이션 3색·간선 2색·카드 그림자
    expect(rule(map, '.relationship-stage')).toMatch(/--stage-1:#182742;--stage-2:#0b1324;--stage-3:#080e1b/)
    expect(map).not.toMatch(/\.world-map (i|button:hover)\{/)
    expect(`${map}${studio}`).not.toMatch(/var\(--danger,/) // 늘 정의된 토큰에 대체값을 두지 않는다
  })


  it('설정집 게시판은 오른쪽 편집 패널 없이 한 칸이라 공개 설정집과 같은 분류 메뉴 폭을 쓰고, 편집 화면이 열려 있는 동안 설정집 화면은 숨는다', () => {
    expect(studio).not.toMatch(/world-card-workspace|with-editor|showing-detail|world-mobile-list/)
    expect(studio).not.toMatch(/\.world-card-library \.worlds-board\{[^}]*150px/)
    expect(rule(studio, '.episode-app[hidden]')).toMatch(/display:\s*none/)
  })

  it('AI 채팅은 본문 | 채팅 2열(채팅 350px 고정)이고 상단바 아래에 붙어 화면 높이를 쓰며 좁은 화면에서는 오른쪽 서랍이 된다', () => {
    expect(rule(studio, '.episode-app.with-chat')).toMatch(/grid-template-columns:\s*minmax\(0,1fr\)\s+350px/)
    expect(rule(studio, '.world-chat')).toMatch(/position:\s*sticky/)
    expect(rule(studio, '.world-chat')).toMatch(/height:\s*calc\(100dvh - 65px\)/)
  })

  it('AI 채팅 배경은 이연보라 틴트가 아니라 페이지 배경과 같고, 구분은 왼쪽 선으로만 은은하게 한다', () => {
    const chat = rule(studio, '.world-chat')
    expect(chat).toMatch(/(?<![\w-])background:\s*var\(--tbg\)/)
    expect(chat).not.toMatch(/pri-soft|--chat-bg/)
    expect(chat).toMatch(/border-left:\s*1px solid var\(--tline\)/)
    expect(studio).toMatch(/@media\(max-width:900px\)\{[^@]*\.world-chat\{[^}]*position:fixed/)
  })

  it('관리 모드 사이드바의 도구 묶음은 줄바꿈하는 가로 줄이고 901px부터 구분선 뒤에 버튼과 상시 저장 영역을 세로로 쌓으며, 옛 탭 줄 규칙을 남기지 않는다', () => {
    expect(rule(studio, '.world-menu-tools')).toMatch(/flex-wrap:\s*wrap/)
    expect(studio).toMatch(/@media\(min-width:901px\)\{\.world-menu-tools\{[^}]*display:grid[^}]*border-top:\s*1px solid[^}]*\}\.world-menu-tools \.world-save-bar\{[^}]*flex-direction:column/)
    expect(studio).not.toMatch(/world-tabs-(row|end)/) // 탭 줄을 비운 것이 이 이동의 목적이다
  })
})

// ── critique 단계: 게시판 열·분류 칩 줄·관계도 층 ──────────────────────────────────────────────────────────
describe('게시판 열·분류 칩 줄(critique)', () => {
  it('숨기는 게시판 열은 display:none이 아니라 폭 0의 보이지 않는 칸으로 남아 열 수가 늘 7개다(미리보기 colSpan=7과 맞아 열 폭이 변하지 않고 오른쪽 빈 칸이 없다)', () => {
    const hidden = 'display:table-cell;visibility:hidden;width:0;padding:0;border:0'
    expect(block(studio, '@container worlds-board (max-width:760px)')).toBe(`.world-card-library .worlds-board-table .col-no{${hidden}}`) // 공용 규칙이 숨기는 번호 칸
    expect(block(studio, '@container worlds-board (max-width:599px)')).toContain(`.world-card-library .worlds-board-table :is(.col-sum,.col-kind,.col-num){${hidden}}`)
    expect(studio).not.toMatch(/:is\(\.col-kind,\.col-num\)\{display:none\}/)
    // 특이도 (0,3,0)이 공용 (0,2,0)의 display:none을 이기고, 요약은 600px 이상 규칙이 table-cell로 되살린다.
    expect(block(studio, '@container worlds-board (min-width:600px)')).toContain('.col-sum{display:table-cell}')
  })

  it('제목 열은 26%라 요약이 더 넓고(공용 게시판의 34%는 그대로), 사이드바를 접어 게시판이 760~1000px가 돼도 표가 세로 분류 메뉴 없이 카드 폭 전체를 쓴다', () => {
    expect(rule(studio, '.world-card-library .worlds-board-table th.col-title')).toMatch(/width:26%/)
    expect(rule(board, '.worlds-board-table th.col-title')).toMatch(/width:\s*34%/)
    const chips = block(studio, '@container worlds-board (max-width:1000px)')
    expect(chips).toContain('.world-card-library .worlds-board{grid-template-columns:minmax(0,1fr);gap:14px}')
    expect(chips).toContain('.world-card-library .worlds-cats ul{display:flex;gap:8px;margin:-4px;padding:4px;overflow-x:auto;scrollbar-width:none}')
    expect(chips).toContain('.world-card-library .worlds-cats ul::-webkit-scrollbar{display:none}')
    expect(chips).toContain('.world-card-library .worlds-cats :is(a,button){flex:none;width:auto;gap:6px;min-height:44px;padding:0 16px;border:1px solid var(--line2);border-radius:999px;background:var(--surface)}')
    expect(chips).toContain('.world-card-library .worlds-cats :is(a,button)[aria-current]{border-color:var(--pri)}')
    // 공용 게시판의 칩 줄 기준(760px 컨테이너·720px 뷰포트)과 그 동일성은 그대로다.
    expect(block(board, '@container worlds-board (max-width: 760px)')).toContain('.worlds-cats :is(a, button) { flex: none; width: auto;')
  })
})

describe('관계도 층과 좁은 화면 넘침 방어(critique)', () => {
  it('간선 그림(React Flow 간선 층)은 카드 층 아래이고 라벨은 뷰포트 포털의 별도 SVG(카드 층 위, 눌리지 않는다)이며, 무대 위 카드 면은 반투명이 아니라 불투명이라 뒤를 지나는 간선이 카드 글자를 가로지르지 않는다', () => {
    expect(rule(map, '.relationship-card-labels')).toMatch(/position:absolute;width:1px;height:1px;overflow:visible;pointer-events:none/)
    const stage = rule(map, '.relationship-stage')
    expect(stage).toMatch(/--rc-bg:color-mix\(in srgb,var\(--fixed-ink\) 7%,var\(--stage-2\)\)/)
    expect(stage).toMatch(/--rc-sel:color-mix\(in srgb,var\(--fixed-pri\) 20%,var\(--stage-2\)\)/)
    expect(stage).not.toMatch(/--rc-(bg|sel):[^;]*transparent/) // 투명을 섞으면 카드 뒤 간선이 비친다
  })

  it('390px 가로 넘침 방어(측정 필요): 그리드·플렉스 항목이 안쪽의 넓은 내용(관계 목록 표 최소 600px·중심 칩 줄)에 밀려 커지지 않게 min-width:0이다', () => {
    expect(map).toContain('.relationship-editor :is(.relationship-service-form,.relationship-list,.relationship-focus,.relationship-add,.relationship-stage){min-width:0;max-width:100%}')
    expect(map).toContain('.relationship-list>.adm-scroll,.relationship-focus>*{min-width:0;max-width:100%}')
    expect(rule(map, '.relationship-table')).toMatch(/width:100%;table-layout:fixed/)
  })
})

describe('관계도 React Flow 캔버스(@xyflow/react)', () => {
  it('캔버스는 무대 그라데이션이 비치게 배경을 투명으로 두고, 점 격자·컨트롤 색을 이 화면의 고정 토큰으로 덮는다(React Flow 기본 흰 배경·컨트롤 색을 쓰지 않는다)', () => {
    const flow = rule(map, '.relationship-flow .react-flow')
    expect(flow).toMatch(/--xy-background-color:transparent/)
    expect(flow).toMatch(/--xy-background-pattern-color:color-mix\(in srgb,var\(--fixed-ink\) \d+%,transparent\)/)
    expect(flow).toMatch(/--xy-controls-button-background-color:var\(--rc-bg\)/)
    expect(flow).toMatch(/--xy-controls-button-color:var\(--rc-ink\)/)
    expect(flow).toMatch(/--xy-controls-button-border-color:var\(--rc-line\)/)
    expect(flow).not.toMatch(/#fff|white/i)
  })

  it('카드는 React Flow 노드 래퍼 안을 가득 채울 뿐 위치·층을 스스로 정하지 않고, 간선을 이으려고 둔 숨은 핸들은 보이지도 눌리지도 않는다', () => {
    const card = rule(map, '.relationship-character-card')
    expect(card).toMatch(/width:100%;height:100%/)
    expect(card).not.toMatch(/position:absolute|left:0|top:0|z-index/)
    expect(rule(map, '.relationship-handle')).toMatch(/opacity:0;pointer-events:none/)
  })

  it('직접 만든 보드(스크롤 상자·카드 보드·간선 SVG 층)의 규칙은 남기지 않는다', () => {
    for (const gone of ['relationship-cards-scroll', 'relationship-cards-board', 'relationship-card-edges']) expect(map, gone).not.toContain(gone)
  })

  it('작성 모드(2열)의 캔버스 높이는 화면 높이를 따르는 범위이고 좁은 화면은 440px이며, 터치 기기는 카드 위 세로 손짓을 페이지 스크롤이 받는다', () => {
    expect(rule(map, '.relationship-flow')).toMatch(/position:relative;height:clamp\(380px,55vh,590px\)/)
    expect(map).toContain('@media(max-width:600px){.relationship-flow{height:440px}.relationship-character-card{border-radius:10px}}')
    expect(map).toContain('@media(pointer:coarse){.relationship-character-card{touch-action:pan-y}.relationship-flow .react-flow__controls-button{width:44px;height:44px}}') // 컨트롤 버튼도 누르는 크기 44px
  })
})

describe('설정 카드 썸네일(#401)', () => {
  it('28px 고정 크기·잘라 채우기라 읽는 동안의 빈 자리와 이미지가 줄 높이를 바꾸지 않고 제목 글자와 가운데로 맞춘다', () => {
    const thumb = rule(board, '.board-thumb')
    expect(thumb).toMatch(/width:\s*28px/)
    expect(thumb).toMatch(/height:\s*28px/)
    expect(thumb).toMatch(/object-fit:\s*cover/)
    expect(thumb).toMatch(/vertical-align:\s*middle/)
    expect(thumb).toMatch(/flex:\s*none/)
  })
})

describe('관계도 무대 안 묶음과 좁은 화면 적용 바', () => {
  it('그래프 위 한 줄 툴바(중심 콤보·이웃 쪽 이동·전체 관계도로)는 줄바꿈하는 flex이고 툴바와 같은 안쪽 여백(16px, 좁은 화면 12px)이며, 안내 글은 늘 한 줄을 쓰고, 어두운 무대 위 글은 고정 보조색이다', () => {
    expect(rule(map, '.relationship-focus')).toMatch(/display:\s*flex;\s*flex-wrap:\s*wrap;\s*align-items:\s*center;\s*gap:\s*8px 12px;\s*padding:\s*0 16px 10px/)
    expect(rule(map, '.relationship-focus>p')).toMatch(/flex:\s*1 1 100%/)
    expect(map).not.toContain('.relationship-focus [role=group]') // 중심 설정 칩 줄은 없다(콤보 하나로 묶었다)
    expect(rule(map, '.relationship-focus :is(.muted,.page-controls)')).toMatch(/color:\s*var\(--fixed-sub\)/) // --sub(라이트 #5F6370)는 무대 위 대비가 2.5~3.1:1이다
    expect(block(map, '@media(max-width:600px)')).toMatch(/\.relationship-focus\{padding-inline:12px\}/) // 툴바·안내·필터·범례와 같은 왼쪽 선
  })

  it('적용 바는 폼 안쪽 여백만큼만 아래로 내려 붙는다(sticky bottom = -padding): 넓은 화면 20px, 좁은 화면 12px', () => {
    expect(rule(map, '.relationship-service-form')).toMatch(/padding:\s*20px/)
    expect(rule(map, '.relationship-apply')).toMatch(/bottom:\s*-20px/)
    expect(map).toMatch(/@media\(max-width:600px\)\{\.relationship-service-form\{padding:12px\}\}/)
    expect(block(map, '@media(max-width:600px)')).toMatch(/\.relationship-apply\{bottom:-12px\}/) // 18px면 폼 밖으로 6px 잘린다
  })
})

describe('select 규칙은 전역 셰브런(오른쪽 화살표)을 지우지 않는다', () => {
  /** 가장 안쪽 규칙 목록: 중첩된 @media·@container 안의 규칙도 낱개로 읽고, 주석은 지운다. */
  const flat = (css: string) => [...css.replace(/\/\*[\s\S]*?\*\//g, '').matchAll(/([^{}]+)\{([^{}]*)\}/g)].map(([, selector, body]) => ({ selector: selector.trim(), body }))

  it('select 요소를 고르는 규칙은 padding·padding-inline·background 단축 속성과 오른쪽 안쪽 여백을 정하지 않는다(위아래·왼쪽은 개별 속성으로)', () => {
    // 전역 select는 appearance:none + 오른쪽 셰브런(background-image) + padding-right로 그린다. 비레이어인 기능 CSS의 단축 속성은 그 값을 이겨 셰브런 자리를 0으로 되돌리거나 그림을 지운다.
    const offenders = [board, studio, map]
      .flatMap(flat)
      .filter(({ selector, body }) => selector.split(',').some((s) => /(^|[\s>+~(])select($|[^\w-])/.test(s.trim())) && /(^|;)\s*(padding|padding-inline|padding-right|padding-inline-end|background)\s*:/.test(body))
      .map(({ selector }) => selector)
    expect(offenders).toEqual([])
  })
})

describe('관계도 무대 조용히 다듬기', () => {
  it('무대는 카드 안의 평평한 면이라 그림자가 없고(어두운 면 위 그림자는 보이지 않고 층만 늘린다) 고정 색 그라데이션은 그대로다', () => {
    const stage = rule(map, '.relationship-stage')
    expect(stage).not.toMatch(/box-shadow/)
    expect(stage).toMatch(/radial-gradient\(ellipse at 50% 46%,var\(--stage-1\) 0%,var\(--stage-2\) 56%,var\(--stage-3\) 100%\)/)
  })

  it('구획 제목 h4는 700·자간 없음이고 유형 필터 버튼은 600이며, 켜진 칩은 보라 틴트 면 + 낮춘 테두리(3:1 이상 유지)·꺼진 칩은 글자만 물러난다', () => {
    const h4 = rule(map, '.relationship-toolbar h4')
    expect(h4).toMatch(/font-weight:700/)
    expect(h4).not.toMatch(/letter-spacing/)
    expect(rule(map, '.relationship-filter .btn')).toMatch(/font-weight:600/)
    const on = rule(map, '.relationship-stage .relationship-filter .btn[aria-pressed=true]')
    expect(on).toMatch(/background:var\(--rc-sel\)/)
    // 기본이 '모두 켜짐'이라 밝은 보라 테두리(무대 위 6.8~8.8:1) 여섯 개가 그래프보다 먼저 보였다. 선택 상태 표시를 지우지 않으려고(비문자 3:1) 없애지 않고 무대 색에 60% 섞어 낮춘다(3.0~3.9:1).
    expect(on).toMatch(/border-color:color-mix\(in srgb,var\(--rc-accent\) 60%,var\(--stage-2\)\)/)
    expect(on).not.toMatch(/border-color:var\(--rc-accent\)/)
    expect(rule(map, '.relationship-stage .relationship-filter .btn[aria-pressed=false]')).toMatch(/color:var\(--fixed-sub\)/)
    // 꺼진 칩의 보조 글자는 hover 면 위에서 4.5:1에 못 미쳐(3.8:1) hover에서 다시 밝아진다.
    expect(rule(map, '.relationship-stage .relationship-filter .btn[aria-pressed=false]:hover')).toMatch(/color:var\(--fixed-ink\)/)
  })

  it('관계선·화살촉·범례 선은 무대에 섞어 낮추고(밝은 하늘색 14선이 카드보다 눈에 띄었다) 라벨은 회색 글자다 — 선은 무대 위 3:1 이상, 라벨은 4.5:1 이상, 고른 선(흰색)은 그대로라 더 뜬다', () => {
    const stage = rule(map, '.relationship-stage')
    expect(stage).toMatch(/--edge:color-mix\(in srgb,#A9C6FF 70%,var\(--stage-2\)\)/) // 무대 위 4.7~6.0:1
    expect(stage).toMatch(/--edge-emotion:color-mix\(in srgb,#FFD98A 75%,var\(--stage-2\)\)/) // 6.5~8.4:1
    expect(stage).toMatch(/--edge-active:var\(--fixed-ink\)/)
    expect(rule(map, '.relationship-stage .relationship-edge-label')).toMatch(/fill:var\(--fixed-sub\)/) // 선 색을 따르던 라벨을 회색 글자로(6.3:1 이상)
  })

  it('관계 목록 행의 조작은 알약 테두리 없는 글자 버튼이고(hover는 옅은 면), 주체·대상 이름은 본문색 + 옅은 밑줄 링크다(밑줄이 링크 표시라 3:1 이상인 --line3)', () => {
    const actions = rule(map, '.relationship-row-actions .btn')
    expect(actions).toMatch(/border-color:transparent/)
    expect(actions).toMatch(/background:none/)
    expect(actions).toMatch(/font-weight:600/)
    expect(rule(map, '.relationship-row-actions .btn:hover')).toMatch(/background:var\(--muted-bg\)/) // 비레이어 background:none이 전역 hover 면을 이기므로 다시 정한다
    const link = rule(map, '.relationship-card-link')
    expect(link).toMatch(/color:inherit/)
    expect(link).toMatch(/text-decoration:underline/)
    expect(link).toMatch(/text-decoration-color:var\(--line3\)/)
    expect(rule(map, '.relationship-card-link:hover')).toMatch(/color:var\(--pri-ink\);text-decoration-color:currentColor/)
  })

  it('관계 목록 표 머리는 회색 띠가 아니라 아래 선 하나이고, 공용 게시판(/worlds/:id)의 머리 띠는 그대로다', () => {
    expect(rule(map, '.relationship-table th')).toMatch(/font-size:12px;background:none;border-bottom:1px solid var\(--line2\)/)
    expect(rule(board, '.worlds-board-table th')).not.toMatch(/background/) // 공용 worldBoard.css는 머리 면을 정하지 않고 전역 th를 쓴다
  })
})

describe('관계 작성 시트와 관계 목록 표(R5)', () => {
  it('관계 작성 패널은 시트라 입력·select·textarea를 폭 100%·15px로 키우고(터치 기기는 확대 방지로 16px), 실제 관계 문구 칸은 최소 3줄에서 글 길이를 따라 자란다', () => {
    const fields = ':is(input:not([type=checkbox]):not([type=radio]),select,textarea)'
    expect(map).toContain('.relationship-sheet ' + fields + '{box-sizing:border-box;width:100%;font-size:15px}')
    expect(rule(map, '.relationship-sheet textarea')).toMatch(/field-sizing:content;\s*min-height:calc\(3lh \+ 24px\)/)
    expect(map).toContain('@media(pointer:coarse){.relationship-sheet ' + fields + '{font-size:16px}}') // iOS는 16px 미만 입력에 초점이 가면 확대한다
    // N화부터 칸은 시트 안에서도 88px 숫자 칸이다(위의 폭 100%를 이기려고 선택자를 더 길게).
    expect(rule(map, '.relationship-sheet .relationship-from input:not([type=checkbox]):not([type=radio])')).toMatch(/width:88px/)
  })

  it('적용 바는 시트 안쪽 여백(.sheet padding 26px)만큼 아래로 내려 붙어 시트 바닥에 닿는다', () => {
    expect(rule(map, '.relationship-sheet .relationship-apply')).toMatch(/bottom:-26px/)
    expect(rule(map, '.relationship-apply')).toMatch(/bottom:-20px/) // 위 폼(오른쪽 열) 규칙은 그대로
  })

  it('관계 목록 표는 칸 폭을 정하고(주체 18%·대상 20%·시작 회차 84px·작업 126px) 글자는 14px이며, 좁은 편집기용 작업 칸 64px 규칙은 없다(전역 가로 스크롤 상자가 대신한다)', () => {
    expect(rule(map, '.relationship-table :is(th,td)')).toMatch(/font-size:14px/)
    expect(map).toMatch(/\.relationship-table th\.col-subject\{width:18%\}\.relationship-table th\.col-target\{width:20%\}\.relationship-table th\.col-from\{width:84px\}/)
    expect(rule(map, '.relationship-table :is(th,td):last-child')).toMatch(/width:126px/)
    expect(map).not.toMatch(/relationship-editor \(max-width:520px\)/)
    expect(map).not.toMatch(/last-child\{width:64px\}/)
  })

  it('관계도 카드의 유형 점은 8px 원이다', () => {
    expect(rule(map, '.relationship-kind')).toMatch(/width:8px;\s*height:8px;[^}]*border-radius:50%/)
  })
})

describe('관계도 컨트롤 정리(critique 승인)', () => {
  it("'관계 추가'는 접힌 details라 요약 줄이 44px이고 안쪽 묶음이 간격을 정하며(details를 grid로 두지 않는다), 중심 콤보는 .episode-app 틀 규칙을 이기도록 .episode-app 아래에서 정한다", () => {
    expect(rule(map, '.relationship-add>summary')).toMatch(/min-height:44px/)
    expect(rule(map, '.relationship-add-body')).toMatch(/display:grid;gap:12px/)
    expect(map).not.toMatch(/\.relationship-add,\.relationship-list\{display:grid/)
    expect(rule(map, '.episode-app .relationship-center')).toMatch(/display:inline-flex/)
    const input = rule(map, '.episode-app .relationship-center input:not([type=checkbox]):not([type=radio])')
    expect(input).toMatch(/margin-top:0/)
    expect(input).not.toMatch(/font/) // 터치 기기의 입력 16px(확대 방지) 보정이 그대로 남는다
  })
})

describe('390px 가로 넘침(critique 후속)', () => {
  it('관계 목록 표의 가로 스크롤 상자는 기준 위치(position:relative)라 안의 sr-only(position:absolute) 요소가 상자 밖으로 나가 문서 폭을 늘리지 않는다 (마지막 칸 머리의 오른쪽 맞춤 숨은 글자가 표 오른쪽 끝에 놓여 390px에서 innerWidth가 646으로 늘던 원인)', () => {
    expect(rule(map, '.relationship-list>.adm-scroll')).toMatch(/position:relative/)
    expect(map).toContain('.relationship-list>.adm-scroll,.relationship-focus>*{min-width:0;max-width:100%}') // 앞선 min-width 방어는 그대로
  })

  it('900px 이하 보기 메뉴 묶음·줄은 min-width:0라 탭 줄+채팅 열기 버튼의 최소 폭(약 480px)이 358px 본문의 그리드 칸을 늘리지 않고 탭 줄이 가로로 스크롤한다', () => {
    expect(studio).toContain('@media(max-width:900px){.world-menu-body,.world-menu-row{min-width:0}.world-menu-row{display:flex;align-items:center;gap:8px}')
  })
})

// ── 3단계 distill: 그래프 카드의 두 버튼은 마우스 기기에서만 호버·초점·선택·상대일 때 보인다 ───────────────────────────
it('인물 카드의 두 버튼은 마우스 기기에서만 호버·초점·선택·상대일 때 보이고, 터치 화면은 늘 보인다', () => {
  expect(block(map, '@media(hover:hover)')).toBe('.relationship-stage .relationship-character-card>div{opacity:0}.relationship-stage .relationship-character-card:is(:hover,:focus-within,.selected,.target)>div{opacity:1}')
})
