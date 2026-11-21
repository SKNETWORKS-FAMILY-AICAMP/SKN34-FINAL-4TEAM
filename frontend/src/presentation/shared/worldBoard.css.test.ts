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

  it('관계 편집기는 그래프 옆 폼이 없는 캔버스 한 칸이라 2열 분기(컨테이너·뷰포트)와 하단 폼·표의 규칙이 없다', () => {
    expect(map).not.toMatch(/@container relationship-editor|container:\s*relationship-editor|relationship-service|relationship-list|relationship-table/)
    expect(map).not.toMatch(/@media\(max-width:1050px\)/)
  })

  it('인물관계도 무대의 고정 색은 한 곳에서 변수로 정하고 쓰지 않는 옛 지도 규칙은 두지 않는다', () => {
    const literals = map.replace(/\/\*[\s\S]*?\*\//g, '').match(/#[0-9a-fA-F]{3,8}\b|rgba?\([^)]*\)/g) ?? []
    expect(literals.length).toBeLessThanOrEqual(2) // 무대 면 2색뿐(점·선·이름의 색은 캔버스에 그리는 graphPaint가 정한다)
    expect(rule(map, '.relationship-stage')).toMatch(/--stage-2:#0b1324;--stage-3:#080e1b/)
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
  it('캔버스(.relationship-surface)는 상자를 가득 채우고 그 위 층은 도구(10)·설정 패널·추가 패널(20)·키보드 목록(25)·톱니(30) 순으로 쌓인다', () => {
    expect(rule(map, '.relationship-surface')).toMatch(/position:absolute;inset:0/)
    expect(rule(map, '.relationship-add-button')).toMatch(/position:absolute;top:10px;left:10px;z-index:10/)
    expect(rule(map, '.relationship-gear')).toMatch(/position:absolute;top:10px;right:10px;z-index:30/)
    expect(rule(map, '.relationship-settings')).toMatch(/position:absolute;top:50px;right:10px;bottom:10px;z-index:20/)
    expect(rule(map, '.relationship-add-panel')).toMatch(/z-index:20/)
    expect(rule(map, '.relationship-keys')).toMatch(/position:absolute;left:10px;bottom:10px;z-index:25/)
  })

  it('390px 가로 넘침 방어(측정 필요): 무대가 안쪽의 넓은 내용(알림 줄·설정 패널)에 밀려 커지지 않게 min-width:0·max-width:100%이고, 무대 위 한 줄은 줄바꿈한다', () => {
    expect(rule(map, '.relationship-stage')).toMatch(/min-width:0;max-width:100%;overflow:hidden/)
    expect(rule(map, '.relationship-bar')).toMatch(/display:flex;flex-wrap:wrap/)
  })
})

describe('관계도 캔버스(react-force-graph)', () => {
  it('무대는 옵시디언처럼 평평한 한 색이라(격자·그라데이션 없음) 캔버스 배경이 투명이어도 한 색이 비치고, React Flow의 격자·컨트롤·간선·카드·점·이름표 층 규칙은 남기지 않는다', () => {
    const stage = rule(map, '.relationship-stage')
    expect(stage).toMatch(/background:var\(--stage-2\)/)
    expect(stage).not.toMatch(/gradient/)
    expect(map).not.toMatch(/react-flow|xyflow|--xy-|relationship-(port|dot|character-card|names|edge|legend|filter|center|tools-slot|marker)|data-level/)
  })

  it('직접 만든 보드(스크롤 상자·카드 보드·간선 SVG 층)의 규칙은 남기지 않는다', () => {
    for (const gone of ['relationship-cards-scroll', 'relationship-cards-board', 'relationship-card-edges']) expect(map, gone).not.toContain(gone)
  })

  it('캔버스 감싸개는 안내문을 캔버스 위(order:-1)에 두고 겹침의 기준이 된다: 안내문을 묶은 .relationship-notes는 자리를 차지하지 않는다(display:contents). 관리 모드 관계도 보기는 world-studio.css가 묶음을 캔버스 아래 가운데에 겹친다', () => {
    expect(rule(map, '.relationship-canvas')).toMatch(/position:relative;display:flex;flex-direction:column/)
    expect(rule(map, '.relationship-notes')).toMatch(/display:contents/)
    expect(rule(map, '.relationship-canvas .relationship-hint')).toMatch(/order:-1/)
  })

  it('작성 모드의 캔버스 높이는 화면 높이를 따르는 범위이고 좁은 화면은 440px이며, 연결 상대를 고르는 중에는 십자 커서다(react-force-graph가 인라인으로 정한 포인터를 덮는다)', () => {
    expect(rule(map, '.relationship-flow')).toMatch(/position:relative;height:clamp\(440px,66vh,760px\)/)
    expect(map).toContain('@media(max-width:600px){.relationship-flow{height:440px}}')
    expect(rule(map, '.relationship-flow.connecting canvas')).toMatch(/cursor:crosshair!important/)
  })

  it('터치 기기에서는 톱니·+ 설정 추가·패널 버튼이 누르는 크기 44px로 커진다', () => {
    expect(map).toContain('@media(pointer:coarse){.relationship-gear{width:44px;height:44px}.relationship-add-button,.relationship-settings .btn{min-height:44px}}')
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
  it('그래프 위 한 줄(.relationship-bar: 알림만, 있을 때만 그려진다)은 줄바꿈하는 flex이고 안쪽 여백 16px(좁은 화면 12px)이며, 알림 글은 늘 한 줄을 쓰고, 어두운 무대 위 글은 고정 보조색이다', () => {
    expect(rule(map, '.relationship-bar')).toMatch(/display:flex;flex-wrap:wrap;align-items:center;gap:6px 8px;padding:10px 16px/)
    expect(rule(map, '.relationship-bar>p')).toMatch(/flex:1 1 100%/)
    expect(rule(map, '.relationship-stage .muted')).toMatch(/color:var\(--fixed-sub\)/) // --sub(라이트 #5F6370)는 무대 위 대비가 2.5~3.1:1이다
    expect(block(map, '@media(max-width:600px)')).toMatch(/\.relationship-bar\{padding-inline:12px\}/) // 안내와 같은 왼쪽 선
    expect(map).not.toMatch(/relationship-toolbar|relationship-focus/) // 예전 도구줄·중심 줄은 없다
  })

  it('관계 작성 시트의 적용 바는 시트 안쪽 여백을 이용해 바닥에 붙고(sticky), 옛 하단 폼 열의 bottom 값은 두지 않는다', () => {
    expect(rule(map, '.relationship-apply')).toMatch(/position:sticky/)
    expect(rule(map, '.relationship-apply')).not.toMatch(/bottom/)
    expect(block(map, '@media(max-width:600px)')).not.toMatch(/relationship-apply/)
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
  it('무대는 카드 안의 평평한 면이라 그림자가 없다(어두운 면 위 그림자는 보이지 않고 층만 늘린다)', () => {
    expect(rule(map, '.relationship-stage')).not.toMatch(/box-shadow/)
  })

  it('설정 패널의 구획 제목은 보조 글자색의 작은 글자이고 구획은 선 하나로 나뉜다(무대 위 글자색은 고정 토큰)', () => {
    expect(rule(map, '.relationship-settings h4')).toMatch(/font-size:12px;font-weight:700;color:var\(--fixed-sub\)/)
    expect(rule(map, '.relationship-settings section')).toMatch(/border-top:1px solid var\(--rc-line\)/)
  })
})

describe('관계 작성 시트(R5)', () => {
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
  })

  it('관계도 카드의 유형 점은 8px 원이다', () => {
    expect(rule(map, '.relationship-kind')).toMatch(/width:8px;\s*height:8px;[^}]*border-radius:50%/)
  })
})

describe('관계도 설정 패널', () => {
  it('설정 찾기·슬라이더는 .episode-app 틀의 입력 규칙(폭 100%·패딩·위 여백)을 이기도록 .episode-app 아래에서 다시 정하고, 입력은 터치 기기의 16px 보정을 건드리지 않는다', () => {
    const find = rule(map, '.episode-app .relationship-settings .relationship-find input:not([type=checkbox]):not([type=radio])')
    expect(find).toMatch(/width:100%;margin-top:0/)
    expect(find).not.toMatch(/font/) // 터치 기기의 입력 16px(확대 방지) 보정이 그대로 남는다
    const range = rule(map, '.episode-app .relationship-settings .relationship-slider input[type=range]')
    expect(range).toMatch(/grid-column:1\/-1;width:100%/)
    expect(range).toMatch(/padding:0;border:0;background:none/) // 틀의 입력 상자(테두리·면·패딩)를 슬라이더에는 쓰지 않는다
  })

  it('패널은 캔버스 오른쪽 위에 겹치고 안쪽이 길면 스크롤하며, 600px 이하에서는 아래에서 올라오는 시트다', () => {
    const panel = rule(map, '.relationship-settings')
    expect(panel).toMatch(/width:min\(280px,calc\(100% - 20px\)\)/)
    expect(panel).toMatch(/overflow:auto/)
    expect(map).toMatch(/@media\(max-width:600px\)\{\.relationship-settings\{top:auto;left:0;right:0;bottom:0;width:auto;max-height:min\(60%,380px\)/)
  })

  it('열려 있는 톱니·+ 설정 추가 버튼은 눌린 모양이다', () => {
    expect(rule(map, ':is(.relationship-add-button,.relationship-gear)[aria-expanded=true]')).toMatch(/background:var\(--rc-sel\)/)
  })
})

describe('390px 가로 넘침(critique 후속)', () => {
  it('900px 이하 보기 메뉴 묶음·줄은 min-width:0라 탭 줄+채팅 열기 버튼의 최소 폭(약 480px)이 358px 본문의 그리드 칸을 늘리지 않고 탭 줄이 가로로 스크롤한다', () => {
    expect(studio).toContain('@media(max-width:900px){.world-menu-body,.world-menu-row{min-width:0}.world-menu-row{display:flex;align-items:center;gap:8px}')
  })
})

// ── 캔버스 조작: 추가 패널·오른쪽 클릭 메뉴·키보드 목록 ──────────────────────────────────────────────────────────────
describe('관계도 추가 패널·오른쪽 클릭 메뉴·키보드 목록', () => {
  it('+ 설정 추가 패널은 캔버스 오른쪽에 붙어 도구·안내문(10) 위에 뜨고, 600px 이하에서는 캔버스 아래에서 올라오는 시트다', () => {
    const panel = rule(map, '.relationship-add-panel')
    expect(panel).toMatch(/position:absolute;top:0;right:0;bottom:0;z-index:20/)
    expect(panel).toMatch(/width:min\(300px,100%\)/)
    expect(map).toMatch(/@media\(max-width:600px\)\{\.relationship-add-panel\{top:auto;left:0;width:auto;max-height:min\(72%,420px\)/)
  })


  it('오른쪽 클릭 메뉴는 body 포털의 fixed라 무대 토큰이 아니라 전역 면 토큰을 쓰고(라이트·다크를 따른다), 시트·서랍(.back-dim 100)보다 위다', () => {
    const menu = rule(map, '.relationship-menu')
    expect(menu).toMatch(/position:fixed;z-index:120/)
    expect(menu).toMatch(/background:var\(--surface\);color:var\(--ink\)/)
    expect(menu).not.toMatch(/--stage|--rc-|--fixed/)
    expect(rule(map, '.relationship-menu [role=menuitem][aria-disabled=true]')).toMatch(/cursor:not-allowed/)
  })


  it('오른쪽 클릭 메뉴는 화면보다 키가 커져도(8유형 하위 목록 + 낮은 가로 화면) 뷰포트 안에서 안쪽으로 스크롤하고, 좁은 화면·터치에서는 항목이 44px다', () => {
    expect(rule(map, '.relationship-menu')).toMatch(/max-height:calc\(100dvh - 16px\);overflow-y:auto/)
    expect(map).toMatch(/@media\(max-width:600px\),\(pointer:coarse\)\{\.relationship-menu \[role=menuitem\]\{min-height:44px\}\}/)
    expect(block(map, '@media(pointer:coarse)')).not.toMatch(/relationship-menu/) // 위 묶음이 맡는다
  })


  it('키보드 목록은 초점이 없으면 1px로 줄여 스크린리더에만 읽히고, 초점이 있으면 캔버스 왼쪽 아래에 겹쳐 보인다(길면 안쪽 스크롤)', () => {
    expect(rule(map, '.relationship-keys:not(:focus-within)')).toMatch(/width:1px;height:1px;padding:0;overflow:hidden;border:0;clip-path:inset\(50%\)/)
    expect(rule(map, '.relationship-keys')).toMatch(/max-height:45%;padding:10px 12px;overflow:auto/)
    expect(rule(map, '.relationship-keys button:is(:hover,:focus-visible)')).toMatch(/background:var\(--stage-tint\)/)
  })
})
