import { readFileSync } from 'node:fs'
import { expect, it } from 'vitest'

const css = readFileSync(new URL('./world-studio.css', import.meta.url), 'utf8')
/** 편집 화면이 집필실과 함께 쓰는 하단 바(.writing-foot)의 규칙이 있는 파일 */
const writingCss = readFileSync(new URL('../../studio/view/writing.css', import.meta.url), 'utf8')
/** 공용 관리 화면 틀(/content 작품 관리와 함께 쓴다). 세계관 전용 규칙은 이 파일이 아니라 world-studio.css에 둔다. */
const episodeCss = readFileSync(new URL('../../../shared/episode.css', import.meta.url), 'utf8')
/** 시간선 보드(스크롤 상자)의 규칙이 있는 파일 */
const timelineCss = readFileSync(new URL('./world-timeline.css', import.meta.url), 'utf8')

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

it('대표 이미지 타일은 헤더 표지(.cov)의 3:4·둥근 모서리·그림자를 그대로 쓰고 빈 타일만 얇은(1px) 점선 테두리(--line3)·그림자 없음으로 구분하며, 빈 타일 안 이미지 추가는 타일 전체를 덮는다', () => {
  // 두께만 2px에서 줄인다: 색을 --line2로 옅게 하면 라이트에서 1.23:1이라 빈 자리의 윤곽이 사라지고, --line3은 3.49:1(다크 4.41:1)로 경계 대비 3:1을 지킨다.
  expect(rule((s) => s === '.world-card-tile.empty')?.body).toMatch(/border:\s*1px dashed var\(--line3\)[^}]*box-shadow:\s*none/)
  // 크기·모서리·그림자는 전역 .cov가 정하므로 여기서 다시 정하지 않는다(세계관 헤더 표지와 어긋나지 않게).
  expect(rule((s) => s === '.world-card-tile')?.body ?? '').not.toMatch(/aspect-ratio|border-radius|box-shadow/)
  expect(rule((s) => s === '.world-card-studio .world-card-tile .world-card-tile-add')?.body).toMatch(/position:\s*absolute;\s*inset:\s*0/)
  // 타일은 overflow:hidden이라 안쪽 라벨의 초점 고리가 잘리므로 고리는 타일에 그리고 라벨의 고리는 끈다.
  expect(css).toMatch(/\.world-card-tile:has\(input:focus-visible\)\{[^}]*outline:\s*2px solid var\(--tacc\)/)
  expect(rule((s) => s === '.world-card-studio .world-card-tile .world-card-tile-add:has(input:focus-visible)')?.body).toMatch(/outline:\s*0/)
})

it('편집 화면 레일의 쪽 이동은 앞의 글자(설정 카드)를 스크린리더용으로만 남겨 한 줄에 다음 버튼까지 든다 — 숨겨 읽히지 않게 하지 않는다 (critique)', () => {
  const label = rule((s) => s === '.world-card-studio .page-controls>span:first-child')?.body ?? ''
  expect(label).toMatch(/position:absolute;width:1px;height:1px/)
  expect(label).toMatch(/clip-path:inset\(50%\)/)
  expect(label).not.toMatch(/display:\s*none|visibility:\s*hidden/)
})

it('편집 화면 레일의 썸네일은 왼쪽에 띄워 제목·상태 줄이 옆으로 흐르게 하고, 집필실과 함께 쓰는 writing.css는 건드리지 않는다', () => {
  expect(rule((s) => s === '.world-card-studio .writing-episode .board-thumb')?.body).toMatch(/float:\s*left/)
  expect(writingCss).not.toContain('board-thumb')
})

it('연관 설정 목록의 줄은 제목과 문구가 한 줄에 안 들어가면 문구를 다음 줄로 내려 줄바꿈하고, 줄어들지 않는 문구가 제목 칸을 글자 하나 폭으로 짜부러뜨리거나 줄 밖으로 넘치게 하지 않는다 (#485 QA)', () => {
  // 자유 관계의 문구는 관계 본문 전체(최대 3,000자)라 길 수 있다. 예전 규칙은 문구를 flex:none으로 고정해 줄이 넘치고, 남은 폭이 없는 제목은 overflow-wrap:anywhere 때문에 한 글자씩 쌓였다.
  const row = rule((s) => s === '.world-card-link')?.body ?? ''
  expect(row).toMatch(/flex-wrap:\s*wrap/)
  expect(row).toMatch(/overflow-wrap:\s*anywhere/)
  const label = rule((s) => s === '.world-card-link small')?.body ?? ''
  expect(label).not.toMatch(/flex:\s*none/)
  expect(label).toMatch(/min-width:\s*0/)
})

it('터치 기기에서는 설정집 도구줄·편집 화면 레일의 검색·정렬 입력이 16px라 iOS가 초점에서 화면을 확대하지 않는다', () => {
  // 위의 13.5px 규칙(.episode-app .world-compact input:not()…, 특이도 (0,4,1))이 shared/episode.css의 16px 보정((0,3,1))을 이기므로, 같은 선택자(:not()까지)를 뒤에서 되돌린다.
  const coarse = css.match(/@media\(pointer:coarse\)\{\.episode-app \.world-compact input:not\(\[type=checkbox\]\):not\(\[type=radio\]\),\.episode-app \.world-compact select,\.world-rail-tools input\{font-size:16px\}\}/)
  expect(coarse).not.toBeNull()
  expect(coarse!.index).toBeGreaterThan(css.indexOf('.world-rail-tools input{')) // 같은 특이도는 뒤에 온 규칙이 이긴다
  expect(coarse!.index).toBeGreaterThan(css.indexOf('.episode-app .world-compact select'))
})

it('설정집 게시판의 분류 칩은 칩 줄이 모자라도 글자가 꺾이지 않고 줄 안에서 가로로 스크롤한다: 칩이 든 li는 flex 항목이라 li에 flex:none이 있어야 한다', () => {
  // 공용 게시판(worldBoard.css)은 좁은 배치에서 목록을 가로 flex로 바꾸고 칩 버튼에 flex:none을 주지만 버튼의 부모는 li라 그 규칙이 닿지 않는다. 칩이 한 줄에 다 들어가지 않으면 li가 줄어들어 글자가 한 글자씩 꺾였다
  // (왼쪽 사이드바로 게시판 폭이 줄어 1024px에서도 좁은 배치가 기본이 되며 드러남).
  expect(rule((s) => s === '.world-card-library .worlds-cats li')?.body).toMatch(/flex:\s*none/)
})

it('시간선 스크롤 상자는 높이가 제한돼, 사건이 많아도 보드가 페이지째 길어지지 않고 바로 아래의 설명이 한 번 스크롤한 위치에 보인다', () => {
  // 선후가 없는 사건은 모두 0열에 150px 간격으로 쌓여 32개면 보드가 약 4,840px였고, 설명(aria-live)은 보드 아래라 사건을 눌러도 화면이 안 바뀐 것처럼 보였다.
  const scroll = timelineCss.match(/\.world-timeline-scroll\{([^}]*)\}/)?.[1] ?? ''
  expect(scroll).toMatch(/max-height:\s*clamp\(320px,\s*55vh,\s*560px\)/)
  expect(scroll).toMatch(/overflow:\s*auto/) // 상자 안에서 가로·세로로 민다(키보드는 tabIndex=0 region으로 스크롤)
})

it('설정집 일괄 공개 회차 줄은 .episode-app의 label(block)·입력(폭 100%) 규칙을 이겨 "일괄 공개 회차 [입력] 화부터 공개"가 한 줄로 붙는다', () => {
  // .world-reveal{display:flex}(0,1,0)는 .episode-app label{display:block}(0,1,1)에 지고, 88px 입력 규칙(0,2,0)은 .episode-app input:not():not()(0,3,1)에 져 세 줄로 갈라졌다.
  // 편집 화면의 .world-reveal은 .episode-app 밖이라 이 규칙을 받지 않는다.
  expect(rule((s) => s === '.episode-app .world-reveal')?.body).toMatch(/display:\s*flex/)
  const input = rule((s) => s === '.episode-app .world-reveal input:not([type=checkbox]):not([type=radio])')?.body // 이 규칙의 :not()까지 베껴야 특이도가 위(0,4,1)다
  // 채팅을 연 1440px에서 '전체 공개'가 셋째 줄로 넘어가지 않게 88px에서 줄였다(편집 화면 .world-reveal의 88px는 그대로).
  expect(input).toMatch(/width:\s*72px/)
  expect(input).toMatch(/margin-top:\s*0/)
  expect(input).toMatch(/padding:\s*8px 10px/)
  expect(input).not.toMatch(/font/) // 터치 기기의 16px(확대 방지) 보정은 .episode-app 규칙이 계속 맡는다
})

it('카드 편집의 유형 라벨은 전역 .field의 세로 쌓기(column)를 이겨 "유형 [select]"가 한 줄이다', () => {
  // 전역 .field는 flex-direction:column인데 .world-card-meta .world-type은 display·align-items만 다시 정해, 세로 축 가운데 정렬로 라벨이 select 위 가운데에 떴다.
  expect(rule((s) => s === '.world-card-meta .world-type')?.body).toMatch(/flex-direction:\s*row/)
})

it('650px 이하에서는 세계관 관리 헤더의 표지를 72px로 줄여 제목 옆에 두고(칩·소개·버튼은 전체 폭) 고른 탭의 내용이 첫 화면에 들어온다 (공용 .ep-hero-cover와 /content 작품 관리 표지는 그대로)', () => {
  // 표지는 개요 탭에서 크게 보고 바꾸므로 헤더의 표지는 중복이다. .ep-hero-main을 풀어(display:contents) 제목 줄만 표지 옆 열에 두고 나머지 줄은 두 열을 가로지른다.
  // 공용 .episode-app .ep-hero(같은 특이도)를 이기도록 클래스를 하나 더 붙였고, 공용 .ep-hero-cover의 220px 상한은 이 화면에서만 푼다.
  expect(css).toContain('@media(max-width:650px){.episode-app .world-manage-hero.ep-hero{grid-template-columns:72px minmax(0,1fr);gap:12px 16px}.episode-app .world-manage-hero .ep-hero-cover{max-width:none}.episode-app .world-manage-hero .ep-hero-main{display:contents}.episode-app .world-manage-hero .ep-hero-main>:not(.ep-title-row){grid-column:1/-1}}')
  expect(css).not.toContain('max-width:120px')
  expect(episodeCss).not.toContain('world-manage-hero') // 공용 틀은 건드리지 않는다
})


it('채팅이 닫혀 떠 있는 열기 버튼(.studio-chat-toggle)이 설정집 화면의 문서 끝 내용을 덮지 않게 900px 이하에서 본문 아래를 84px 비운다(편집 화면 규칙과 같은 값)', () => {
  expect(css).toMatch(/@media\(max-width:900px\)\{\.episode-app:has\(>\.studio-chat-toggle\) \.ep-main\{padding-bottom:84px\}\}/)
})

it('분류 칩 줄(게시판 폭 1000px 이하)에서는 비어 있는 분류도 옆 칩과 같은 44px 높이·16px 안쪽 여백이고, 세로 메뉴(넓은 본문)에서는 다른 분류 항목과 같은 40px·12px 그대로다', () => {
  // 칩은 min-height:44px;padding:0 16px(shared/worldBoard.css)인데 빈 분류만 40px·12px라 줄 안에서 중심선이 어긋났다. 세로 메뉴의 항목은 40px·12px이라 기본값을 바꾸면 거기서 어긋난다.
  expect(rule((s) => s === '.worlds-cats .worlds-cats-empty')?.body).toMatch(/min-height:\s*40px;\s*padding:\s*0 12px/)
  const chip = css.match(/@container worlds-board \(max-width:1000px\)\{\.worlds-cats \.worlds-cats-empty\{([^}]*)\}\}/)
  expect(chip?.[1]).toMatch(/min-height:\s*44px/)
  expect(chip?.[1]).toMatch(/padding:\s*0 16px/)
  expect(chip!.index).toBeGreaterThan(css.indexOf('.worlds-cats .worlds-cats-empty{')) // 같은 특이도는 뒤에 온 규칙이 이긴다
})

it('관계 기준 회차 상자는 카드 안의 카드가 아니라 테두리·면·안쪽 여백 없이 카드 바탕 위에 놓인다 (한 줄 배치·입력 규칙은 그대로)', () => {
  // 부모가 이미 .tcard.ep-card라 상자를 한 번 더 두면 상자 → 어두운 관계도 면 → 범례로 겹이 세 단이 된다.
  const box = rule((s) => s === '.relationship-episode')?.body ?? ''
  expect(box).toMatch(/display:\s*grid/)
  expect(box).not.toMatch(/(^|;)\s*(padding|border|border-radius|background)\s*:/)
})

it('시간선 사건의 시점 칸은 시점이 비어 글자가 없어도 한 줄 높이를 지켜 점과 연결선 화살표(y+65)의 높이가 달라지지 않는다', () => {
  expect(timelineCss.match(/\.world-timeline-time\{([^}]*)\}/)?.[1]).toMatch(/min-height:\s*1lh/)
})

// 관리 화면 quieter(세계관 관리): 색·굵기·두께만 낮추고 구조·문구는 그대로다.

it('잠긴 저장 버튼(개요 저장·사이드바/상단 저장·마법사 세계관 저장)은 채운 보라가 아니라 윤곽선 버튼이다 — 숨기지 않고 톤만 낮추며, 흐림(.45)은 공용 disabled 규칙이 맡고, 채팅·관계도 무대·AI 검토의 잠긴 주 버튼은 건드리지 않는다', () => {
  const idle = rule((s) => s === ':is(.world-save-bar,.world-info-edit,.world-save-actions) .btn.pri:disabled')?.body ?? ''
  expect(idle).toMatch(/background:none/)
  expect(idle).toMatch(/border-color:var\(--line2\)/)
  // 글자색은 되돌리기(.btn 기본 --ink)와 같다: 둘 다 잠기면 같은 흐림(.45)이다. 글자색을 아예 빼면 공용 .btn.pri의 --on-pri(라이트 흰색)가 남아 윤곽선 버튼에서 글자가 보이지 않는다.
  expect(idle).toMatch(/color:var\(--ink\)/)
  expect(idle).not.toMatch(/color:var\(--sub\)/)
  expect(idle).not.toMatch(/display|visibility|opacity/)
  expect(css).not.toMatch(/\.world-writing \.btn\.pri:disabled/) // 화면 전체로 넓히면 어두운 무대의 상대 선택·채팅 버튼까지 바뀐다
})

it('게시판 제목은 800이 아니라 650이라 줄마다 무거운 글자가 쌓이지 않고(AI 의견 배지 제외), 공개 칸의 N화부터는 보라 기둥도 굵은 기둥도 아니라 본문색 보통 굵기다', () => {
  expect(rule((s) => s === '.world-card-library .worlds-board-table .col-title :is(a,button):not(.world-opinion)')?.body).toMatch(/font-weight:650/)
  const vis = rule((s) => s === '.world-card-library .worlds-board-table .col-vis[data-public=true]')?.body ?? ''
  expect(vis).toMatch(/color:var\(--tfg\)/)
  expect(vis).not.toMatch(/font-weight/) // 공개/비공개는 글자('N화부터'·'비공개')와 색으로 이미 갈리므로 굵기까지 얹지 않는다
})

it('분류 칩 줄(게시판 폭 1000px 이하)에서 선택하지 않은 칩은 옅은 테두리·600이고, 선택한 칩(aria-current)은 건드리지 않는다', () => {
  expect(css).toMatch(/@container worlds-board \(max-width:1000px\)\{\.world-card-library \.worlds-cats :is\(a,button\):not\(\[aria-current\]\)\{border-color:var\(--line\);font-weight:600\}\}/)
})

it('사이드바의 도구 버튼(AI 검토·집필 메모·확정 버전)은 모든 폭에서 보기 메뉴보다 가벼운 옅은 테두리·600이다(900px 이하 가로 줄에서도 탭 줄보다 무겁지 않다) — 저장 버튼(.pri)은 그대로다', () => {
  expect(css).toMatch(/\.world-menu-tools \.btn:not\(\.pri\)\{border-color:var\(--line\);font-weight:600\}/)
  expect(css).not.toMatch(/@media\(min-width:901px\)\{[^@]*\.world-menu-tools \.btn:not\(\.pri\)/) // 데스크톱 전용 규칙이 아니다
})

it('채팅 머리의 브랜드 원은 집필실 채팅 머리(.chat-brand)와 같은 옅은 면이다 — 채운 보라는 전송 버튼만', () => {
  const soft = /background:\s*var\(--pri-soft\);\s*color:\s*var\(--pri-ink\)/
  expect(rule((s) => s === '.world-chat .chat-brand')?.body).toMatch(soft)
  expect(writingCss.match(/\.chat-brand \{([^}]*)\}/)?.[1]).toMatch(soft)
})

it('작성 단계 표시는 연결선·원 테두리가 1px로 가늘고(지금 단계의 채움 --pri는 그대로), 레일의 분류 칩·문서 탭 글자는 600이다', () => {
  expect(rule((s) => s === '.world-step-nav li+li::before')?.body).toMatch(/height:1px/)
  expect(rule((s) => s === '.world-step-nav span')?.body).toMatch(/border:1px solid var\(--line2\)/)
  expect(css).toMatch(/\.world-step-nav \[data-state=now\] span\{[^}]*background:var\(--pri\)/)
  expect(rule((s) => s === '.world-rail-kinds button')?.body).toMatch(/font-weight:600/)
})

it('Toast 기본 CSS를 어두운 테마 CSS보다 먼저 불러온다(마크다운·원고 편집기 둘 다) — 특이도가 같은 두 규칙은 나중에 불러온 쪽이 이기고, 두 편집기가 같은 CSS를 각자 불러 먼저 평가된 순서가 남으므로 한쪽만 맞추면 어두운 탭 줄 뒤에 밝은 띠(#f7f9fc)가 다시 깔린다', () => {
  for (const path of ['../../../shared/MarkdownEditor.tsx', '../../studio/view/ManuscriptEditor.tsx']) {
    const source = readFileSync(new URL(path, import.meta.url), 'utf8')
    const base = source.indexOf("'@toast-ui/editor/dist/toastui-editor.css'")
    const dark = source.indexOf("'@toast-ui/editor/dist/theme/toastui-editor-dark.css'")
    expect(base, path).toBeGreaterThan(-1)
    expect(dark, path).toBeGreaterThan(base)
  }
})

// 관리 화면 polish(세계관 관리): 정렬·간격·상태 마감만 다룬다. 구조·문구·접근성 이름은 그대로다.

it('설정집 도구줄의 검색 칸은 220px에서 시작해, 채팅을 연 1440px(게시판 폭 약 748px)에서 정렬·결과 수·가져오기·+ 새 설정과 한 줄에 담긴다 (공개 설정집 /worlds는 그대로)', () => {
  const search = rule((s) => s === '.world-card-library .worlds-search')?.body ?? ''
  expect(search).toMatch(/flex-basis:\s*220px/)
  expect(search).toMatch(/min-width:\s*min\(220px,\s*100%\)/) // 좁은 본문에서 칸이 넘치지 않는 하한
})

it('사이드바의 저장 영역은 901px부터 위 도구 버튼 묶음과 8px 더 떨어지고, 저장 상태 글자는 보기 메뉴 글자와 같은 x(안쪽 여백 10px)에서 시작한다', () => {
  expect(css).toMatch(/@media\(min-width:901px\)\{\.world-menu-tools\{[^@]*\.world-menu-tools \.world-save-bar\{[^}]*margin-top:8px[^}]*\}\.world-menu-tools \.world-save-state\{padding-inline:10px\}/)
})

it('작성 단계 표시: 첫 원이 카드 왼쪽 가장자리에 맞고, 500px 이하에서는 지금 단계만 이름을 보이고 나머지는 번호 원만 남겨 네 단계가 가로 스크롤 없이 한 줄에 든다', () => {
  expect(rule((s) => s === '.world-step-nav ol')?.body).toMatch(/margin-inline-start:\s*-6px/)
  expect(css).toMatch(/@media\(max-width:500px\)\{[^@]*\.world-step-nav button:not\(\[aria-current\]\)\{font-size:0;gap:0;padding-right:6px\}/)
})

it('이미지 타일 안내는 두 줄 길이를 고르게 나누고(text-wrap:balance), 시간선 사건은 마우스를 올리면 제목에 밑줄이 생긴다(고른 사건의 보라 글자는 건드리지 않는다)', () => {
  expect(rule((s) => s === '.world-card-tile-note')?.body).toMatch(/text-wrap:\s*balance/)
  expect(timelineCss).toMatch(/\.world-timeline-event:hover strong\{text-decoration:underline;text-underline-offset:3px\}/)
})

// ── 기능별 탭·게시판 미리보기·사이드바 접기(audit 단계: R1·R4) ────────────────────────────────────────

it('사이드바 접기(R1): 901px부터만 접힌 틀이 44px 열이고 메뉴 옆 선·여백이 없어지며, 900px 이하(이미 가로 줄)에서는 접기 버튼을 숨기고 접힌 메뉴도 그대로 보인다 — 공용 episode.css는 건드리지 않는다', () => {
  expect(css).toContain('@media(min-width:901px){.world-content.ep-manage[data-menu=collapsed]{grid-template-columns:44px minmax(0,1fr);column-gap:20px}.world-content.ep-manage[data-menu=collapsed] .ep-menu{padding-right:0;border-right:0}}')
  // 900px 이하: 접힌 메뉴(hidden)를 되살린다. .world-writing [hidden]{display:none!important}를 이기려면 !important와 한 단계 높은 선택자가 필요하다.
  expect(css).toContain('@media(max-width:900px){.world-menu-toggle{display:none}.world-writing .world-menu-body[hidden]{display:grid!important}}')
  expect(episodeCss).not.toContain('data-menu') // /content 작품 관리 사이드바는 그대로
  expect(episodeCss).not.toContain('world-menu')
})

it('접기 버튼은 44×44 토글이고 펼친 동안에는 아이콘을 뒤집어(왼쪽으로 접는 방향) 보이며, 메뉴 묶음은 보기 메뉴와 도구를 같은 세로 간격으로 쌓는다', () => {
  const toggle = rule((s) => s === '.world-menu-toggle')?.body ?? ''
  expect(toggle).toMatch(/width:44px;height:44px/)
  expect(toggle).toMatch(/justify-self:start/)
  expect(rule((s) => s === '.world-menu-toggle[aria-expanded=true] svg')?.body).toMatch(/transform:scaleX\(-1\)/)
  expect(rule((s) => s === '.world-menu-body')?.body).toMatch(/display:grid;gap:12px/) // .ep-menu의 gap과 같다
})

it('게시판 미리보기 줄은 표 칸 여백 없이 고른 줄과 같은 옅은 면 한 칸이고, 고른 줄과의 사이 선을 거두며, 요약은 4줄까지만 보인다 (R4)', () => {
  expect(rule((s) => s === '.world-card-library .worlds-board-table tr.world-row-preview>td')?.body).toMatch(/padding:0;background:var\(--pri-soft\)/)
  expect(rule((s) => s === '.world-card-library .worlds-board-table tr.sel:has(+.world-row-preview) td')?.body).toMatch(/border-bottom-color:transparent/)
  expect(rule((s) => s === '.world-preview-sum')?.body).toMatch(/-webkit-line-clamp:4/)
})

it('쪽 이동의 select는 .ep-main의 큰 입력 패딩·위 여백을 이겨 값이 보인다 (높이 34px의 .inp.sm에 위아래 패딩 14px이 걸려 값이 잘렸다)', () => {
  expect(rule((s) => s === '.episode-app .page-controls select.inp')?.body).toMatch(/margin-top:0;padding-block:0/)
})

it("'소설 연결' 탭의 Fork 행은 연관 설정과 같은 44px 행(.world-card-link)을 링크로 쓰므로 밑줄을 없애고, 구획 사이는 선 하나다", () => {
  expect(rule((s) => s === 'a.world-card-link')?.body).toMatch(/text-decoration:none/)
  expect(rule((s) => s === '.world-novel .world-forks')?.body).toMatch(/border-top:1px solid var\(--tline\)/)
  expect(rule((s) => s === '.world-cover-now')?.body).toMatch(/width:160px/) // 개요 탭의 지금 표지
  // 카드 안의 행이 입력칸처럼 보이지 않게 테두리는 카드 테두리(--line)보다 진하지 않고, hover의 보라 테두리는 그대로다(같은 특이도라 hover를 다시 정한다)
  expect(rule((s) => s === '.world-novel .world-card-link')?.body).toMatch(/border-color:var\(--line\)/)
  expect(rule((s) => s === '.world-novel .world-card-link:hover')?.body).toMatch(/border-color:var\(--pri\)/)
})

// ── critique 승인 항목: 히어로 축소·탭 줄 채팅 버튼·문서 탭 부제 ───────────────────────────────────────────────

it('관리 모드의 모든 보기(개요 포함)와 작성 모드(wizard)의 히어로는 72px 표지 + 제목·칩 한 덩어리로 줄고 소개를 숨기며(data-view로만 가르므로 /content 히어로는 그대로), 650px 이하 규칙보다 특이도가 높다', () => {
  const compact = '.episode-app .world-manage-hero[data-view]'
  expect(rule((s) => s === compact)?.body).toMatch(/grid-template-columns:72px minmax\(0,1fr\);gap:0 16px;align-items:center/)
  expect(rule((s) => s === `${compact} .ep-hero-cover`)?.body).toMatch(/max-width:none/) // 공용 .ep-hero-cover의 220px 상한은 이 화면에서만 푼다
  expect(rule((s) => s === `${compact} .ep-hero-main`)?.body).toMatch(/display:block/) // 650px 이하의 display:contents를 덮는다
  expect(rule((s) => s === `${compact} .sum`)?.body).toMatch(/display:none/)
  expect(rule((s) => s === `${compact} h1`)?.body).toMatch(/font-size:24px/)
  expect(css).not.toContain(':not([data-view=overview])') // 개요 탭도 줄인다: 폼의 이름·설명칸이 첫 화면에 보여야 한다
  expect(css).not.toMatch(/\.world-manage-hero\[data-view=overview\]\{/)
  expect(episodeCss).not.toContain('data-view') // 공용 틀·/content 작품 관리 히어로는 그대로다
})

it('900px 이하에서 닫힌 AI 채팅 열기 버튼은 보기 메뉴 줄의 오른쪽 끝 슬롯에 놓이고(제자리 버튼), 넓은 화면에서는 줄을 풀어 메뉴 배치가 그대로며 빈 슬롯은 숨는다', () => {
  expect(rule((s) => s === '.world-menu-row')?.body).toMatch(/display:contents/)
  expect(rule((s) => s === '.world-chat-slot:empty')?.body).toMatch(/display:none/)
  expect(css).toContain('@media(max-width:900px){.world-menu-body,.world-menu-row{min-width:0}.world-menu-row{display:flex;align-items:center;gap:8px}.world-menu-row nav{flex:1 1 auto;min-width:0}.world-chat-slot .studio-chat-toggle{position:static;flex:none;box-shadow:none;white-space:nowrap}}')
  expect(writingCss).not.toContain('world-chat-slot') // 집필실의 같은 공용 버튼은 건드리지 않는다
})

it('인물 문서 탭의 파일 이름(.world-doc-file)은 화면에서 숨겨 스크린리더용으로만 남고 탭에는 부제가 없다(공개 범위는 문서 안내 줄이 알린다)', async () => {
  const doc = readFileSync(new URL('./CharacterDocs.tsx', import.meta.url), 'utf8')
  expect(doc.match(/<small className="world-doc-file sr-only">/g)).toHaveLength(2) // 문서 탭과 회차 기억 탭
  expect(doc).not.toMatch(/<small className="world-doc-file">/)
  expect(rule((s) => s === '.world-doc-tab .world-doc-flag')?.body).toMatch(/margin-left:6px/)
  expect(rule((s) => s === '.world-doc-scope,.world-doc-tab .world-doc-flag')).toBeUndefined()
  expect(doc).not.toContain('world-doc-scope') // 탭의 부제는 문서 안내 줄로 옮겼다
  expect(css).not.toContain('world-doc-scope')
})

// ── 3단계 distill: 게시판 일괄 공개 줄(접힘)·제목 옆 [n] ─────────────────────────────────────────────────────
it('일괄 공개는 접힌 summary 한 줄(누르는 높이 44px)이고, 펼친 안쪽 .world-bulk-body가 예전의 줄바꿈하는 가로 줄이다', () => {
  expect(rule((s) => s === '.world-bulk>summary')?.body).toMatch(/cursor:pointer;min-height:44px/)
  expect(rule((s) => s === '.world-bulk-body')?.body).toMatch(/display:flex;flex-wrap:wrap;align-items:center;gap:8px/)
  expect(rule((s) => s === '.world-bulk')?.body).not.toMatch(/display:flex/) // details 자체에는 flex를 걸지 않는다
})

it('게시판 제목 옆 [n](.world-count)은 600px 이상 넓은 표에서 숨는다: 연결 칸이 같은 수를 보이고, 좁은 표에서는 연결 칸이 숨어 [n]이 대신한다', () => {
  expect(css).toContain('@container worlds-board (min-width:600px){.world-card-library .world-count{display:none}}')
})

it('마법사 1단계는 이전 단계를 그리지 않으므로 첫 자식이 된 다음 단계(.pri)는 왼쪽으로 밀리지 않고 오른쪽 끝에 남는다', () => {
  expect(rule((s) => s === '.world-step-actions .btn:first-child')?.body).toMatch(/margin-right:auto/) // 이전 단계는 왼쪽
  expect(rule((s) => s === '.world-step-actions .btn.pri:first-child')?.body).toMatch(/margin-right:0/)
})

// ── 4단계 quieter: 채운 보라·진한 테두리·굵기를 줄인다(구조·문구는 그대로) ─────────────────────────────────────────
it('AI 채팅 열기는 이 화면(.episode-app)에서만 채운 보라가 아니라 윤곽선 버튼이다(hover는 옅은 면) — 집필실·카드 편집 화면은 .episode-app 밖이라 그대로 보라다', () => {
  const rest = rule((s) => s === '.episode-app .studio-chat-toggle.btn.pri')?.body ?? ''
  expect(rest).toMatch(/background:var\(--surface\)/)
  expect(rest).toMatch(/border-color:var\(--line2\)/)
  expect(rest).toMatch(/color:var\(--ink\)/)
  expect(rule((s) => s === '.episode-app .studio-chat-toggle.btn.pri:hover')?.body).toMatch(/background:var\(--muted-bg\)/)
  expect(rules.some((r) => /\.studio-chat-toggle\.btn\.pri/.test(r.selector) && !r.selector.startsWith('.episode-app '))).toBe(false)
  expect(writingCss).not.toMatch(/studio-chat-toggle\.btn\.pri/) // 집필실 공용 규칙은 건드리지 않는다
})

it('시간선은 보라를 고른 사건에만 쓴다: 고르지 않은 점은 회색 고리(--line3 2px, 3:1 이상), 고른 점은 채운 보라이고 후광(outline)이 없으며, 연결선·스크롤바는 --line3이고 opacity로 흐리지 않는다(.5면 3:1 아래)', () => {
  expect(timelineCss.match(/\.world-timeline-dot\{([^}]*)\}/)?.[1]).toMatch(/border:2px solid var\(--line3\)/)
  const picked = timelineCss.match(/\.world-timeline-event\[aria-pressed=true\] \.world-timeline-dot\{([^}]*)\}/)?.[1] ?? ''
  expect(picked).toMatch(/background:var\(--pri\);border-color:var\(--pri\)/)
  expect(picked).not.toMatch(/outline/)
  const svg = timelineCss.match(/\.world-timeline-board svg\{([^}]*)\}/)?.[1] ?? ''
  expect(svg).toMatch(/color:var\(--line3\)/)
  expect(svg).not.toMatch(/opacity/)
  expect(timelineCss.match(/\.world-timeline-scroll\{([^}]*)\}/)?.[1]).toMatch(/scrollbar-color:var\(--line3\) var\(--surface\)/)
  expect(timelineCss.match(/\.world-timeline-event strong\{([^}]*)\}/)?.[1]).toMatch(/font-weight:600/)
  expect(timelineCss).toMatch(/\.world-timeline-event\[aria-pressed=true\] strong\{color:var\(--pri-ink\);font-weight:700\}/) // 고른 사건의 보라 제목은 그대로
})

it('마법사 헤더의 저장됨 칩(.chip.ok[role=status])은 평소 상태라 강조색이 아니라 회색 칩이고(공개 칩은 그대로), 이 화면 헤더 칩은 700이 아니라 600이다', () => {
  expect(rule((s) => s === '.world-manage-hero .chip.ok[role=status]')?.body).toMatch(/background:var\(--muted-bg\);color:var\(--sub\)/)
  expect(rules.some((r) => r.selector === '.world-manage-hero .chip.ok')).toBe(false) // role 없는 공개 칩의 보라는 의미가 있어 그대로
  expect(rule((s) => s === '.world-manage-hero .ep-chips .chip')?.body).toMatch(/font-weight:600/)
  expect(episodeCss).not.toContain('world-manage-hero') // 공용 틀·/content 작품 관리 히어로 칩은 그대로다
})

it('카드 편집기 미리보기: 커서 문단의 노란 면(분할 보기 전용 표시)을 끄고, 링크는 Toast 기본 파랑이 아니라 이 화면의 강조색(--tacc)이다 — 둘 다 .world-card-editor 범위이고 Toast 어두운 테마 규칙(특이도 (0,3,1))보다 한 단계 높다', () => {
  const ui = '.world-card-editor .toastui-editor-defaultUI .toastui-editor-contents'
  expect(rule((s) => s === ui + ' .toastui-editor-md-preview-highlight::after')?.body).toMatch(/display:none/)
  expect(rule((s) => s === ui + ' :is(a,a:hover)')?.body).toMatch(/color:var\(--tacc\)/)
  expect(rules.every((r) => !/toastui/.test(r.selector) || r.selector.startsWith('.world-card-editor '))).toBe(true) // 범위 밖(집필실 원고 편집기)은 건드리지 않는다
})

it('게시판 표 머리는 회색 띠가 아니라 아래 선 하나다(관리자 표와 같은 규칙, 이 화면 범위): 공용 worldBoard.css는 그대로라 /worlds/:id의 표는 띠가 남는다', () => {
  expect(rule((s) => s === '.world-card-library .worlds-board-table th')?.body).toMatch(/background:none;border-bottom:1px solid var\(--line2\)/)
})

// ── 5단계 polish: 정렬·간격·390 탭 줄·상태 마감(색·구조·문구는 그대로) ────────────────────────────────────────
/** 관계도·관계 목록 규칙이 있는 파일(이 테스트는 media 안의 규칙을 원문 정규식으로 본다) */
const mapCss = readFileSync(new URL('./world-map.css', import.meta.url), 'utf8')
const mapRules = [...mapCss.replace(/\/\*[\s\S]*?\*\//g, '').matchAll(/([^{}]+)\{([^}]*)\}/g)].map(([, selector, body]) => ({ selector: selector.trim(), body }))
const mapRule = (matches: (selector: string) => boolean) => mapRules.find((r) => matches(r.selector))

it('900px 이하 세계관 메뉴의 탭 줄(nav)은 줄바꿈해 탭 다섯 개가 모두 보인다(가로 스크롤 줄 끝에서 소설 연결이 AI 채팅 열기 뒤로 가려졌다). 공용 .ep-menu nav(/content 작품 관리 메뉴)는 그대로이고, 이 규칙은 .world-menu-body를 더해 그 규칙을 이긴다', () => {
  expect(css).toMatch(/@media\(max-width:900px\)\{\.world-menu-body \.world-menu-row nav\{flex-wrap:wrap;overflow-x:visible\}\}/)
  expect(episodeCss).toContain('.ep-menu nav{display:flex;gap:4px;overflow-x:auto;scrollbar-width:none}') // 공용 틀은 그대로다
})

it('공개 범위·장르 줄은 라벨은 위 선·컨트롤은 아래 선에 맞춘다: 높이가 다른 seg(약 48px)와 select(약 40px)의 아래를 맞추면 라벨이 10px 어긋났다', () => {
  expect(rule((s) => s === '.episode-app .world-publish')?.body).toMatch(/align-items:stretch/)
  expect(rule((s) => s === '.episode-app .world-publish')?.body).not.toMatch(/align-items:flex-end/)
  expect(rule((s) => s === '.episode-app .world-publish .field')?.body).toMatch(/justify-content:space-between/) // .field는 세로 flex: 라벨 위·컨트롤 아래
})

it('마법사(data-view=wizard) 히어로는 표지를 위 선에 맞춘다(오른쪽 열이 행동 줄 때문에 더 길어 가운데 정렬이면 표지가 떠 보인다). 관리 보기의 히어로는 그대로 가운데다', () => {
  expect(rule((s) => s === '.episode-app .world-manage-hero[data-view=wizard]')?.body).toMatch(/align-items:start/)
  expect(rule((s) => s === '.episode-app .world-manage-hero[data-view]')?.body).toMatch(/align-items:center/)
})

it('시간선 상세는 카드 글자 선과 같은 x에서 시작하고(좌우 안쪽 여백 없음), 점과 제목 사이 간격은 8px다 — 점 중심 y(행 top 22 + 시점 1lh + 간격 8 + 점 반지름 7)에 맞춰 연결선 좌표도 58이다', () => {
  expect(timelineCss.match(/\.world-timeline-description\{([^}]*)\}/)?.[1]).toMatch(/padding:12px 0(;|$)/)
  expect(timelineCss.match(/\.world-timeline-event\{([^}]*)\}/)?.[1]).toMatch(/gap:8px/)
  expect(timelineCss.match(/\.world-timeline-event\{([^}]*)\}/)?.[1]).not.toMatch(/gap:15px/)
})

it("'관계 추가' 접힘 summary는 기본 ▶ 표시가 보이는 list-item이다(display:flex면 Chromium이 marker를 그리지 않는다). 누르는 높이는 44px다", () => {
  const summary = mapRule((s) => s === '.relationship-add>summary')?.body ?? ''
  expect(summary).toMatch(/display:list-item/)
  expect(summary).not.toMatch(/display:flex/)
  expect(summary).toMatch(/min-height:44px;padding-block:10px/)
})

it('카드 편집 화면의 상단 바는 600px 이하에서 오른쪽 묶음(저장 상태·테마)이 100% 폭으로 다음 줄에 내려가지 않고 같은 줄 오른쪽 끝에 붙는다', () => {
  expect(css).toMatch(/@media\(max-width:600px\)\{\.world-card-studio \.writing-bar-end\{width:auto;margin-left:auto\}\}/)
  expect(writingCss).toContain('.writing-bar-end { justify-content: flex-start; width: 100%; }') // 집필실 공용 규칙은 그대로다
})

it('게시판 미리보기는 왼쪽 안쪽 여백 56px(선택 칸 44 + 칸 여백 12)로 표 열에 맞고, 연결된 설정은 한 줄에 하나씩이다', () => {
  expect(rule((s) => s === '.world-preview')?.body).toMatch(/padding:6px 20px 16px 56px/)
  expect(rule((s) => s === '.world-preview-meta ul')?.body).toMatch(/display:grid;gap:2px/)
  expect(rule((s) => s === '.world-preview-meta ul')?.body).not.toMatch(/flex/)
})

it('관계도 툴바는 600px 이하에서 중심 입력이 한 줄 전체를 쓰고, 쪽 이동 앞의 라벨(이웃·그래프)은 화면에서만 숨겨 버튼이 혼자 줄에 떨어지지 않는다(nav 이름은 그대로)', () => {
  expect(mapCss).toMatch(/@media\(max-width:600px\)\{\.episode-app \.relationship-center\{flex:1 1 100%\}\.episode-app \.relationship-center input:not\(\[type=checkbox\]\):not\(\[type=radio\]\)\{width:100%\}\.relationship-focus \.page-controls>span:first-child\{position:absolute;width:1px;height:1px;padding:0;margin:-1px;overflow:hidden;clip-path:inset\(50%\);white-space:nowrap;border:0\}\}/)
})

it('카드 레일의 쪽 이동은 레일 글과 같은 x(24px)에서 시작하는 왼쪽 정렬이고, 한 줄에 들어가도록 간격 6px·select 최소 폭 56px다(가운데 정렬로 263px를 꽉 채우던 것)', () => {
  const nav = rule((s) => s === '.world-card-studio .writing-rail .page-controls')?.body ?? ''
  expect(nav).toMatch(/padding-inline-start:24px/)
  expect(nav).toMatch(/justify-content:flex-start/)
  expect(nav).toMatch(/gap:6px/)
  expect(rule((s) => s === '.world-card-studio .writing-rail .page-controls select.inp')?.body).toMatch(/min-width:56px/)
})

it('관계 목록의 삭제는 편집과 달리 위험색 글자이고 hover 면은 그대로다', () => {
  expect(mapRule((s) => s === '.relationship-row-actions .btn:last-child')?.body).toMatch(/color:var\(--danger\)/)
  expect(mapRule((s) => s === '.relationship-row-actions .btn:hover')?.body).toMatch(/background:var\(--muted-bg\)/)
})
