import { readFileSync } from 'node:fs'
import { expect, it } from 'vitest'

const css = readFileSync(new URL('./world-studio.css', import.meta.url), 'utf8')
/** 편집 화면이 집필실과 함께 쓰는 하단 바(.writing-foot)의 규칙이 있는 파일 */
const writingCss = readFileSync(new URL('../../studio/view/writing.css', import.meta.url), 'utf8')

it('편집 화면의 파일 선택은 기본 입력을 시각적으로만 숨기고(초점·스크린리더는 유지) 라벨 버튼에 초점 링을 그린다', () => {
  const input = css.match(/\.world-card-studio \.ep-file-pick input\[type=file\]\{([^}]*)\}/)?.[1] ?? ''
  expect(input).toMatch(/position:\s*absolute/)
  expect(input).toMatch(/opacity:\s*0/)
  expect(input).not.toMatch(/display:\s*none|visibility:\s*hidden/)
  expect(css).toMatch(/\.world-card-studio \.ep-file-pick:has\(input:focus-visible\)\{[^}]*outline:/)
})

it('고른 인물 문서 버튼(aria-current)은 레일의 고른 분류 칩(aria-pressed)과 같은 모양으로 드러난다', () => {
  expect(css).toMatch(/\.world-rail-kinds button:is\(\[aria-pressed=true\],\[aria-current=true\]\)\{[^}]*border-color:[^}]*background:/)
})

/** 규칙(선택자 { 본문 }) 목록: 쉼표로 이어진 선택자도 한 규칙으로 읽어 선택자 글자 안에서 찾는다. 주석은 지워 앞 주석이 선택자에 붙거나 주석 속 `{}`가 규칙으로 읽히지 않게 한다. */
const rules = [...css.replace(/\/\*[\s\S]*?\*\//g, '').matchAll(/([^{}]+)\{([^}]*)\}/g)].map(([, selector, body]) => ({ selector: selector.trim(), body }))
const rule = (matches: (selector: string) => boolean) => rules.find((r) => matches(r.selector))

it('관계 기준 회차 입력은 독자 공개 회차 입력과 같은 크기·숫자 폭이고, 잠기면 같은 비활성 모양이라 편집할 수 있어 보이지 않는다', () => {
  const size = rule((s) => s.endsWith('.inp') && s.includes('.world-reveal') && s.includes('.relationship-episode'))
  expect(size?.body).toMatch(/min-height:\s*44px/)
  expect(size?.body).toMatch(/tabular-nums/)
  const disabled = rule((s) => s.endsWith('.inp:disabled') && s.includes('.world-reveal') && s.includes('.relationship-episode'))
  expect(disabled?.body).toMatch(/opacity:\s*\.55/)
  expect(disabled?.body).toMatch(/cursor:\s*not-allowed/)
  expect(rule((s) => s === '.relationship-episode .inp')).toBeUndefined() // 크기를 따로 덮어쓰지 않는다
})

// .episode-app 틀의 form(grid)·label(block)·input(폭 100%) 규칙을 순서와 무관하게 이기려면 `.episode-app`을 붙인 선택자여야 한다(이유는 world-studio.css 주석).
const scoped = (tail: string) => rule((s) => s === `.episode-app .relationship-episode ${tail}`)?.body

it('관계 기준 회차 폼은 .episode-app의 grid를 이기고 한 줄 flex로 줄바꿈만 하며, 접두어 없는 규칙은 남기지 않는다', () => {
  const form = scoped('form')
  expect(form).toMatch(/display:\s*flex/)
  expect(form).toMatch(/flex-wrap:\s*wrap/)
  expect(rule((s) => s === '.relationship-episode form')).toBeUndefined() // .episode-app form과 비겨 순서에 지는 규칙
})

it('관계 기준 회차 라벨은 .episode-app의 block을 이기고 "관계 기준 [입력] 화"를 한 덩어리 inline-flex로 묶는다', () => {
  expect(scoped('label')).toMatch(/display:\s*inline-flex/)
  expect(rule((s) => s === '.relationship-episode label')).toBeUndefined()
})

it('관계 기준 회차 입력은 .episode-app의 큰 입력 규칙(폭 100%·패딩·위 여백)을 이기고 독자 공개 회차 입력의 폭·패딩으로 줄인다', () => {
  const input = scoped('input:not([type=checkbox]):not([type=radio])') // 이 규칙의 :not()까지 베껴야 특이도가 위(0,4,1)다
  expect(input).toMatch(/width:\s*88px/)
  expect(input).toMatch(/padding:\s*8px 10px/)
  expect(input).toMatch(/margin-top:\s*0/) // 위 여백이 남으면 라벨 안에서 입력이 글자보다 아래로 처진다
  expect(input).not.toMatch(/font/) // 터치 기기의 16px(확대 방지) 보정은 .episode-app 규칙이 계속 맡는다
})

it('편집기 감싸개는 Toast의 z-index(본문 20·팝업 30)를 가둬 sticky 하단 바와 좁은 화면 상단 바 위로 글이 올라와 겹쳐 찍히지 않고, 두 바는 불투명한 면이다', () => {
  // 원인: Toast가 본문 컨테이너를 position:relative + z-index:20으로 그려, z-index가 없는 sticky 하단 바(.writing-foot)와 z-index 10인 상단 바(.sbar) 위로 글이 올라온다.
  expect(rule((s) => s === '.world-card-editor')?.body).toMatch(/isolation:\s*isolate/)
  const foot = writingCss.match(/\.writing-foot \{([^}]*)\}/)?.[1] ?? ''
  expect(foot).toMatch(/background:\s*var\(--tbg\)/) // 투명하지 않은 면
  expect(foot).toMatch(/border-top:\s*1px solid/) // 위 구분선
  expect(rule((s) => s === '.world-card-studio .sbar')?.body).toMatch(/background:\s*var\(--tbg\)/) // 전역 .sbar는 90% 면이라 좁은 화면에서 스크롤되는 본문이 비친다
})

it('AI 채팅이 열려 있는 동안 스크롤한 뒤 나타나는 맨 위로 버튼(#top)이 채팅 전송 버튼을 덮지 않는다: 데스크톱은 설정집 화면(.world-chat)과 편집 화면(.writing-chat) 모두 채팅 왼쪽으로 비키고, 채팅이 문서 끝에 쌓이는 편집 화면의 좁은 화면은 그 아래를 비운다', () => {
  expect(css).toMatch(/@media\s*\(min-width:\s*901px\)\s*\{body:has\(\.world-chat,\.world-card-studio \.writing-chat\) #top\s*\{[^}]*right:\s*calc\(350px \+ 24px\)/) // 기존 #top 오프셋(24px)에 채팅 열 폭만 더한다
  expect(css).toMatch(/@media\s*\(min-width:\s*901px\) and \(max-width:\s*1200px\)\s*\{body:has\(\.world-chat,\.world-card-studio \.writing-chat\) #top\s*\{[^}]*right:\s*calc\(300px \+ 24px\)/)
  // 설정집 화면은 ≤900px에서 채팅이 body의 서랍(.back-dim, z-index 100)이라 #top(z-index 50)이 그 막 아래로 가려져 겹치지 않는다.
  expect(css).toMatch(/@media\s*\(max-width:\s*900px\)\s*\{\.world-card-studio \.studio-workspace:has\(>\s*\.writing-chat\)\s*\{[^}]*padding-bottom:\s*84px/) // #top은 아래 24px부터 높이 50px → 맨 위 74px + 여유 10px
  expect(css.replace(/\/\*[\s\S]*?\*\//g, '')).not.toContain('.screen-controls') // 이 화면에는 떠 있는 테마 버튼이 없어(GlobalChrome) 그것을 비키는 규칙도 두지 않는다
})

it('인물 문서 탭은 전역 문서 버튼(.world-rail-kinds button, 한 줄 알약)을 이기는 선택자로 라벨 아래에 보조 글씨를 두고, 고른 회차 기억 탭은 고른 문서와 같은 모양이다', () => {
  expect(rule((s) => s === '.world-doc-list .world-doc-tab')?.body).toMatch(/display:\s*grid/) // 라벨 아래 줄에 파일 이름·공개 범위·표시
  expect(rule((s) => s === '.world-doc-list .world-doc-tab[data-current=true]')?.body).toMatch(/border-color:[^;]*;[^}]*background:/)
})

it('카드 편집 화면 머리는 왼쪽(이름·유형)과 오른쪽(대표 이미지 타일) 두 열이고, 편집 열이 좁으면(컨테이너 460px 미만: 좁은 화면뿐 아니라 AI 채팅을 연 900px대도) 이름 입력이 폭을 다 쓰도록 88px 타일을 이름 아래 왼쪽으로 내린다', () => {
  const head = rule((s) => s === '.world-card-head')?.body ?? ''
  expect(head).toMatch(/--tile:\s*150px/) // 데스크톱 타일 폭
  expect(head).toMatch(/grid-template-columns:\s*minmax\(0,\s*1fr\)\s*var\(--tile\)/)
  expect(head).toMatch(/grid-template-areas:\s*"name image" "meta image"/) // 이미지 블록은 이름·유형 두 행을 오른쪽에서 잇는다
  // 전환 기준은 뷰포트가 아니라 편집 열의 실제 폭이다: 채팅을 연 901~1200px에서는 편집 열이 300px대라 150px 타일 옆에서 이름 입력이 120px로 짜부러진다.
  expect(rule((s) => s === '.world-card-header')?.body).toMatch(/container:\s*world-card-head\s*\/\s*inline-size/)
  // 좁으면 이름 줄은 폭 전체를 쓰고(390px에서 이름 입력이 258px로 줄지 않게) 타일은 그 아래 왼쪽, 유형 선택은 타일 오른쪽에 온다.
  expect(css).toMatch(/@container world-card-head \(max-width:\s*459px\)\{\.world-card-head\{[^}]*--tile:\s*88px;[^}]*grid-template-areas:\s*"name name" "image meta"/)
  expect(css).not.toMatch(/@media \(max-width:\s*600px\)\{\.world-card-head/) // 뷰포트 기준 전환은 두지 않는다
})

it('대표 이미지 타일은 헤더 표지(.cov)의 3:4·둥근 모서리·그림자를 그대로 쓰고 빈 타일만 점선 테두리(--line3)·그림자 없음으로 구분하며, 빈 타일 안 이미지 추가는 타일 전체를 덮는다', () => {
  expect(rule((s) => s === '.world-card-tile.empty')?.body).toMatch(/border:\s*2px dashed var\(--line3\)[^}]*box-shadow:\s*none/)
  // 크기·모서리·그림자는 전역 .cov가 정하므로 여기서 다시 정하지 않는다(세계관 헤더 표지와 어긋나지 않게).
  expect(rule((s) => s === '.world-card-tile')?.body ?? '').not.toMatch(/aspect-ratio|border-radius|box-shadow/)
  expect(rule((s) => s === '.world-card-studio .world-card-tile .world-card-tile-add')?.body).toMatch(/position:\s*absolute;\s*inset:\s*0/)
  // 타일은 overflow:hidden이라 안쪽 라벨의 초점 고리가 잘리므로 고리는 타일에 그리고 라벨의 고리는 끈다.
  expect(css).toMatch(/\.world-card-tile:has\(input:focus-visible\)\{[^}]*outline:\s*2px solid var\(--tacc\)/)
  expect(rule((s) => s === '.world-card-studio .world-card-tile .world-card-tile-add:has(input:focus-visible)')?.body).toMatch(/outline:\s*0/)
})

it('편집 화면 레일의 썸네일은 왼쪽에 띄워 제목·상태 줄이 옆으로 흐르게 하고, 집필실과 함께 쓰는 writing.css는 건드리지 않는다', () => {
  expect(rule((s) => s === '.world-card-studio .writing-episode .board-thumb')?.body).toMatch(/float:\s*left/)
  expect(writingCss).not.toContain('board-thumb')
})
