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
  it('설정집 게시판은 본문 폭을 기준으로 삼는 컨테이너라 채팅 레일이 열려도 좁은 배치로 바뀌고, 숨는 분류·요약은 제목 아래 한 줄로 보인다', () => {
    expect(rule(studio, '.world-card-library')).toMatch(/container:\s*worlds-board\s*\/\s*inline-size/)
    const narrow = block(studio, '@container worlds-board (max-width:760px)')
    expect(narrow).toMatch(/\.world-card-library \.worlds-board-table :is\(\.col-kind,\.col-num\)\{display:none\}/)
    expect(narrow).toMatch(/\.world-row-sub\{display:flex/)
    expect(rule(studio, '.world-row-sub')).toMatch(/display:\s*none/) // 넓은 본문에서는 분류·요약 칸이 보이므로 숨긴다
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

  it('탭 줄은 탭과 상시 저장 영역을 한 줄에 두고 저장 영역을 오른쪽 끝으로 민다', () => {
    expect(rule(studio, '.world-tabs-row')).toMatch(/display:\s*flex/)
    expect(rule(studio, '.world-tabs-row')).toMatch(/justify-content:\s*space-between/)
    expect(rule(studio, '.world-save-bar')).toMatch(/margin-left:\s*auto/)
  })
})
