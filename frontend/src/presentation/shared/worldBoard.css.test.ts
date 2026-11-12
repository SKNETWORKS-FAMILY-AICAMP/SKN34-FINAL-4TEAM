import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const board = readFileSync(new URL('./worldBoard.css', import.meta.url), 'utf8')
const studio = readFileSync(new URL('../features/worldstudio/view/world-studio.css', import.meta.url), 'utf8')
/** 선택자 블록 하나의 선언부(쉼표로 묶인 선택자는 그 블록을 통째로 찾는다). */
const rule = (css: string, selector: string) => css.match(new RegExp(`(?:^|\\})\\s*${selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*\\{([^}]*)\\}`, 'm'))?.[1] ?? ''

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

describe('세계관 작업실 레이아웃 규칙', () => {
  it('설정집은 편집 패널이 없으면 한 칸(표가 전체 폭)이고 패널이 열릴 때만 오른쪽 칸을 더하며 좁은 화면에서는 아래로 쌓는다', () => {
    expect(rule(studio, '.world-card-workspace')).toMatch(/grid-template-columns:\s*minmax\(0,1fr\)(?![^;]*340px)/)
    expect(rule(studio, '.world-card-workspace.with-editor')).toMatch(/grid-template-columns:\s*minmax\(0,1fr\)\s+340px/)
    expect(studio).toMatch(/@media\(max-width:1000px\)\{[^@]*\.world-card-workspace\.with-editor\{grid-template-columns:minmax\(0,1fr\)\}/)
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
