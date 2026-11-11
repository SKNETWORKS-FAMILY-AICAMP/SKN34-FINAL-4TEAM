import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { JSDOM } from 'jsdom'

const demo = readFileSync(new URL('../mockup/legacy-index.html', import.meta.url), 'utf8')
const includes = (text) => expect(demo.includes(text), `missing documented demo content: ${text}`).toBe(true)

const css = readFileSync(new URL('./styles/storyfork.css', import.meta.url), 'utf8')
// 중첩 @media를 펼쳐 [{ media, selector, body }]로 만든다. @keyframes 등 다른 at-rule은 건너뛴다.
function parseRules(source, media = '') {
  const rules = []
  const text = source.replace(/\/\*[\s\S]*?\*\//g, '')
  for (let i = 0; i < text.length;) {
    const open = text.indexOf('{', i)
    if (open < 0) break
    let depth = 1
    let end = open + 1
    for (; end < text.length && depth; end++) depth += text[end] === '{' ? 1 : text[end] === '}' ? -1 : 0
    const head = text.slice(i, open).trim()
    const body = text.slice(open + 1, end - 1)
    if (head.startsWith('@media')) rules.push(...parseRules(body, head.slice(6).trim()))
    else if (!head.startsWith('@')) rules.push({ media, selector: head, body })
    i = end
  }
  return rules
}
const sheet = parseRules(css)
const declOf = (rule, prop) => rule?.body.match(new RegExp(`(?:^|;)\\s*${prop}\\s*:\\s*([^;]*)`))?.[1].trim()
const selectorsOf = (rule) => rule.selector.split(/,(?![^()]*\))/).map((s) => s.trim())
const root = sheet.find((r) => r.selector === ':root' && !r.media)
// 테마 토큰은 `--name:var(--l,라이트) var(--d,다크)` 한 줄로만 정의한다. [라이트, 다크]를 돌려준다.
const pair = (name) => declOf(root, `--${name}`).match(/^var\(--l,\s*(#[0-9A-Fa-f]{6})\)\s+var\(--d,\s*(#[0-9A-Fa-f]{6})\)$/).slice(1)
const luminance = (hex) => {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4))
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}
const contrast = (a, b) => {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x)
  return (hi + 0.05) / (lo + 0.05)
}

describe('frontend shell source contracts', () => {
  it('guards the complete optional worldstudio route with the existing RequireRole', () => {
    const app = readFileSync(new URL('./App.tsx', import.meta.url), 'utf8')
    const routes = [...app.matchAll(/<Route\s+path="(\/worldstudio[^"]*)"\s+element=\{([^\n]+)\}/g)]
    expect(routes.map(([, path, element]) => [path, element])).toEqual([
      ['/worldstudio/:worldId?', '<RequireRole><WorldStudioPage /></RequireRole>'],
    ])
  })

  it('simplifies only the worldstudio label and credit badge, not the policy action', () => {
    const gnb = readFileSync(new URL('./presentation/shared/shell/Gnb.tsx', import.meta.url), 'utf8')
    expect(gnb).toContain("['worldstudio', '세계관', '세계관']")
    expect(gnb).not.toContain('세계관 데모')
    const credit = gnb.match(/<button[^>]*className="credit"[^>]*>([\s\S]*?)<\/button>/)?.[0]
    expect(credit).toContain('✦ 크레딧')
    expect(credit).not.toContain('데모')
    expect(credit).toContain('onClick={openPolicy}')
    expect(credit).toContain('크레딧 정책은 아직 확정되지 않았어요')
  })

  it('uses a local cover only for a successfully loaded empty cover list', () => {
    const panel = readFileSync(new URL('./presentation/shared/media/MediaPanel.tsx', import.meta.url), 'utf8')
    expect(panel).toMatch(/cover\s*&&\s*!vm\.busy\s*&&\s*!vm\.error\s*&&\s*vm\.items\.length===0\s*&&\s*<img[^>]*src="\/default-work-cover\.svg"/)
    expect(panel).toContain('alt="기본 작품 표지"')
    expect(panel).toContain("{vm.error&&<p role=\"alert\">{vm.error}</p>}")
  })

  it('ships an original portrait SVG with no executable or external content', () => {
    const svg = readFileSync(new URL('../public/default-work-cover.svg', import.meta.url), 'utf8')
    expect(svg).toContain('viewBox="0 0 300 400"')
    expect(svg).toMatch(/<title[^>]*>기본 작품 표지<\/title>/)
    expect(svg).not.toMatch(/<\s*(?:script|foreignObject|image)\b|\bon\w+\s*=|\b(?:href|src)\s*=|url\(\s*['"]?(?:https?:|\/\/|data:)/i)
  })
})

describe('browser tab title and icons', () => {
  const head = new JSDOM(readFileSync(new URL('../index.html', import.meta.url), 'utf8')).window.document.head
  // 라이트 토큰이 브랜드 기준이다.
  const token = (name) => pair(name)[0].toLowerCase()
  const href = (selector) => head.querySelector(selector)?.getAttribute('href')

  it('keeps the brand name as the default title until a screen sets its own', () => {
    expect(head.querySelector('title')?.textContent).toBe('STORYFORK')
  })

  it('links the SVG favicon with PNG and touch-icon fallbacks', () => {
    expect(href('link[rel="icon"][type="image/svg+xml"]')).toBe('/favicon.svg')
    expect(href('link[rel="icon"][type="image/png"][sizes="32x32"]')).toBe('/favicon-32.png')
    expect(href('link[rel="apple-touch-icon"]')).toBe('/apple-touch-icon.png')
  })

  it('uses the primary brand token as the browser theme color', () => {
    expect(head.querySelector('meta[name="theme-color"]')?.getAttribute('content')?.toLowerCase()).toBe(token('pri'))
  })

  it('draws the SF badge in brand tokens without fonts, scripts or external content', () => {
    const svg = readFileSync(new URL('../public/favicon.svg', import.meta.url), 'utf8')
    expect(svg).toContain('viewBox="0 0 32 32"')
    expect(svg.toLowerCase()).toContain(`fill="${token('pri')}"`)
    expect(svg.toLowerCase()).toContain(`stroke="${token('on-pri')}"`)
    expect(svg).not.toMatch(/<\s*(?:script|foreignObject|image|text)\b|font-family|\bon\w+\s*=|\b(?:href|src)\s*=|url\(\s*['"]?(?:https?:|\/\/|data:)/i)
  })

  it.each([['favicon-32.png', 32], ['apple-touch-icon.png', 180]])('ships %s as a %i px square PNG', (file, size) => {
    const png = readFileSync(new URL(`../public/${file}`, import.meta.url))
    expect(png.subarray(1, 4).toString()).toBe('PNG')
    expect([png.readUInt32BE(16), png.readUInt32BE(20)]).toEqual([size, size])
  })
})

describe('storyfork.css theme tokens', () => {
  it('defines each theme token once and switches dark with the same two toggles for the picked and the OS theme', () => {
    expect(sheet.filter((r) => declOf(r, '--bg'))).toHaveLength(1)
    expect([declOf(root, '--l'), declOf(root, '--d'), declOf(root, 'color-scheme')]).toEqual(['initial', '', 'light'])
    const picked = sheet.find((r) => r.selector === ':root[data-theme="dark"]' && !r.media)
    const system = sheet.find((r) => r.selector === ':root:not([data-theme="light"])' && r.media === '(prefers-color-scheme:dark)')
    for (const rule of [picked, system]) expect(rule.body).toBe('--l:;--d:initial;color-scheme:dark')
    // light-dark()는 계산값이 평가되지 않은 문자열이라 getComputedStyle로 색을 읽는 곳(세계관 지도 캔버스)이 깨진다.
    expect(sheet.some((r) => r.body.includes('light-dark('))).toBe(false)
  })

  it.each([['light', 0], ['dark', 1]])('keeps --faint text at 4.5:1 on every %s page surface', (_, mode) => {
    for (const bg of ['bg', 'surface', 'muted-bg', 'read-bg']) {
      expect(contrast(pair('faint')[mode], pair(bg)[mode]), `--faint on --${bg}`).toBeGreaterThanOrEqual(4.5)
    }
  })

  it('keeps every reading-theme secondary text at 4.5:1 on its own background', () => {
    const themed = sheet.filter((r) => /^\.th-/.test(r.selector) && declOf(r, '--tsub') && declOf(r, '--tbg'))
    expect(themed.length).toBeGreaterThanOrEqual(4)
    for (const r of themed) expect(contrast(declOf(r, '--tsub'), declOf(r, '--tbg')), r.selector).toBeGreaterThanOrEqual(4.5)
  })

  it('shows the work hero genre label with --pri-ink in dark so it stays 4.5:1 over the lightest part of the background art', () => {
    const label = sheet.find((r) => !r.media && r.selector === '.whero .g')
    // 라이트는 기존 강조색(--tacc) 그대로, 다크만 --pri-ink — 토큰과 같은 --l/--d 스위치라 고른 테마와 OS 테마를 함께 따른다.
    expect(declOf(label, 'color')).toBe('var(--l,var(--tacc)) var(--d,var(--pri-ink))')
    // .band 아트가 밝아지는 쪽의 실측 배경(약 #444)에서 --pri는 3.4:1이라 모자라고 --pri-ink는 4.5:1 이상이다.
    expect(contrast(pair('pri')[1], '#444444')).toBeLessThan(4.5)
    expect(contrast(pair('pri-ink')[1], '#444444')).toBeGreaterThanOrEqual(4.5)
  })
})

describe('storyfork.css accessibility contracts', () => {
  const mobile = '(max-width:600px)'
  const decls = (selector, media) => sheet.filter((r) => selectorsOf(r).includes(selector) && (media === undefined || r.media === media))

  it('shows the skip link only while it has keyboard focus', () => {
    expect(declOf(decls('.skip-link', '')[0], 'position')).toMatch(/^(?:absolute|fixed)$/)
    expect(declOf(decls('.skip-link', '')[0], 'transform')).toMatch(/translateY\(-\d+%\)/)
    expect(decls('.skip-link:focus', '').length + decls('.skip-link:focus-visible', '').length).toBeGreaterThan(0)
    expect(decls('main[tabindex="-1"]:focus', '')[0]?.body).toContain('outline:none')
  })

  it('keeps the writing studio inputs visibly focusable', () => {
    for (const selector of ['.eb', '.editor .et']) expect(decls(selector, '')[0].body, selector).not.toMatch(/outline\s*:\s*none/)
  })

  it.each(['.btn.sm', '.rib', '.pop button', '.cm .lk', '.sheet .x', '.seg button', '.sortt :is(button,a)', '.chq button', '.tagbar :is(button,a)', '.eps-q input', '.logo'])('%s는 모바일에서 44px 이상이다', (selector) => {
    expect(decls(selector, mobile).some((r) => /(?:^|;)\s*(?:min-)?height\s*:\s*44px/.test(r.body)), selector).toBe(true)
  })

  it('makes the whole checkbox label a 44px touch target on mobile', () => {
    expect(decls('label:has(>input[type="checkbox"])', mobile).some((r) => /min-height\s*:\s*44px/.test(r.body))).toBe(true)
    const box = decls('input[type="checkbox"]', mobile)[0]
    expect(declOf(box, 'width')).toBe('24px')
    expect(declOf(box, 'height')).toBe('24px')
    expect(declOf(box, 'accent-color')).toBe('var(--pri)')
  })

  it('keeps short color and opacity feedback under reduced motion instead of freezing everything', () => {
    const rule = sheet.find((r) => r.media === '(prefers-reduced-motion:reduce)' && selectorsOf(r).includes('*'))
    expect(declOf(rule, 'animation')).toBe('none!important')
    expect(rule.body).not.toMatch(/(?:^|;)\s*transition\s*:\s*none/)
    expect(declOf(rule, 'transition-property')).not.toMatch(/transform|\ball\b|width|height|clip-path/)
    expect(declOf(rule, 'transition-property')).toMatch(/background-color/)
    expect(parseFloat(declOf(rule, 'transition-duration'))).toBeLessThanOrEqual(0.15)
  })

  it('scrolls wide admin tables inside .adm-scroll instead of turning the table into a block', () => {
    expect(sheet.filter((r) => r.selector.includes('.adm table') && /display\s*:\s*block/.test(r.body))).toHaveLength(0)
    expect(declOf(decls('.adm-scroll', '')[0], 'overflow-x')).toBe('auto')
  })

  it('builds the always-dark admin bar from tokens, not literal colors', () => {
    for (const selector of ['.adm .top', '.adm .tabs button', '.adm .tabs button.on']) {
      expect(decls(selector, '').map((r) => r.body).join(';'), selector).not.toMatch(/#[0-9a-fA-F]{3,8}\b/)
    }
  })

  it('draws the import result editor focus with the global ring (3:1) instead of a faint glow', () => {
    expect(declOf(decls(':focus-visible', '')[0], 'outline')).toBe('2px solid var(--pri)')
    const editor = [...decls('.rc [contenteditable]', ''), ...decls('.rc [contenteditable]:focus', '')].map((r) => r.body).join(';')
    expect(editor).not.toMatch(/outline\s*:\s*none|box-shadow/)
    // 카드 배경(--muted-bg)과 포커스 배경(--surface) 어디서나 링 색(--pri)은 비텍스트 대비 3:1 이상이다.
    for (const mode of [0, 1]) for (const bg of ['muted-bg', 'surface']) expect(contrast(pair('pri')[mode], pair(bg)[mode]), `--pri on --${bg}`).toBeGreaterThanOrEqual(3)
  })

  it('keeps the selection popover button focus ring at 3:1 on its always-dark background without touching the account menu ring', () => {
    expect(declOf(decls('.pop:not(.acctm) button:focus-visible', '')[0], 'outline-color')).toBe('var(--fixed-pri)')
    expect(contrast(declOf(root, '--fixed-pri'), declOf(decls('.pop', '')[0], 'background'))).toBeGreaterThanOrEqual(3)
    // 계정 메뉴(.pop.acctm)는 배경이 테마 표면이라 전역 링(--pri)을 그대로 쓴다.
    expect(decls('.pop button:focus-visible', '')).toHaveLength(0)
    for (const mode of [0, 1]) expect(contrast(pair('pri')[mode], pair('surface')[mode])).toBeGreaterThanOrEqual(3)
  })

  it('keeps the studio and plot workspaces edge to edge now that they are main landmarks, leaving the default main padding alone', () => {
    // .studio-workspace(집필실 2곳)와 .sview(플롯)는 HEAD의 div처럼 여백이 없어야 한다. 그 밖의 main은 자체 padding 클래스를 가진다.
    for (const selector of ['.studio-workspace', '.sview']) expect(declOf(decls(selector, '')[0], 'padding'), selector).toBe('0')
    expect(declOf(sheet.find((r) => r.selector === 'main'), 'padding')).toBe('32px 0 72px')
  })
})

describe('STORYFORK HTML demo follows documented product flows', () => {
  it('separates free feedback from optional story-error verification and content reports', () => {
    includes('스토리 오류 검증 시뮬레이션')
    includes('유해 콘텐츠')
    includes('w.settings?.typoAuto')
    includes("type==='질문'")
    includes('유해 콘텐츠 1차 필터')
    includes('댓글·단순 오류·스토리 오류·질문·제안')
    includes('댓글·피드백·신고 안내')
  })

  it('provides in-app notifications, required categories, and all-read behavior', () => {
    includes('#/notifications')
    includes('모두 읽음')
    includes('작가 소식')
    includes('크레딧 정책 안내')
    includes('권리·보안')
    includes('90일 보관')
  })

  it('offers image and EPUB manuscript tools while excluding MVP illustrations', () => {
    includes('이미지 삽입')
    includes('.epub')
    includes('저장·발행·내보내기에는 포함되지 않아요')
    includes('일러스트 생성은 MVP에서 제외됐어요')
    expect(demo).not.toContain('data-act="illustration"')
  })

  it('requires separate author confirmation before publishing autonomous drafts when enabled', () => {
    includes('data-auto="requireReview"')
    includes('일반 발행 흐름에서 공개해 주세요')
    includes('하루 최대 1회')
    includes('KST 기준')
    includes('필터를 통과한 공개 댓글·제안만')
    includes('1시간 넘게 늦으면 건너뛰고 알림')
    includes('A.failures>=3')
    includes('A.failures=0')
    includes("S.demoCredits<5){A.status='중단됨'")
    includes('유해 콘텐츠 필터·권리 확인을 연결하지 않았어요')
    expect(demo).not.toContain('w.auto.freq')
  })

  it('shows the documented withdrawal grace period without simulating deletion', () => {
    includes('탈퇴 후 30일 동안')
    includes('다시 로그인하면 복구')
    includes('실제 탈퇴나 데이터 변경이 일어나지 않아요')
    includes('저장 공간 관리는 MVP에서 제외됐어요')
    expect(demo).not.toContain('data-storage-delete')
  })

  it('does not expose emotional reaction controls on chapter pages', () => {
    expect(demo).not.toContain('data-act="react"')
    includes('data-act="like"')
  })

  it('shows scheduled operations and explicit retry controls in the admin demo', () => {
    includes('정기 작업')
    includes('data-run-job')
    includes('자동 재처리하지 않아요')
  })

  it('limits MVP LLM operations to tracing, not evaluation or sample inspection', () => {
    includes('MVP에서는 Langfuse 추적만 제공해요')
    includes('평가 세트와 정보 누설 표본 검사는 MVP 이후예요')
  })

  it('requires a work policy acknowledgement before setup without granting blanket AI or Fork consent', () => {
    includes('if(!NEW.policyAccepted)')
    includes('id="workPolicyForm"')
    includes('id="workPolicyAck" required')
    includes('작품 등록이나 AI 기능 사용만으로 모델 학습, 상업적 이용, 무제한 재창작에 동의한 것으로 보지 않습니다.')
    includes('NEW.policyAccepted=true')
  })

  it('lets authors select and stores genre, schedule, age rating, and tags', () => {
    const genres = demo.match(/const NOVEL_GENRES=\[([^\]]+)\]/)?.[1] || ''
    expect((genres.match(/'/g) || []).length / 2).toBeGreaterThanOrEqual(25)
    includes('id="nwg"')
    includes('name="novelDay"')
    includes('id="nwIrregular"')
    includes('id="nwRating"')
    includes('id="nwTagSelect"')
    includes('schedule:[...NEW.schedule]')
    includes('rating:NEW.rating')
    includes("hash:NEW.tags.map(tag=>'#'+tag)")
  })

  it('supports direct and suggested tag entry, removable chips, and the two-tag minimum', () => {
    includes('id="nwTagInput"')
    includes('id="nwTagAdd"')
    includes('id="nwTagSelect"')
    includes('id="nwTagSelectAdd"')
    includes('id="nwTagChips"')
    includes('data-remove-tag=')
    includes("e.key==='Enter'&&!e.isComposing")
    includes('태그를 2개 이상 추가해 주세요')
  })

  it('organizes new story information in a responsive grid', () => {
    includes('class="newwork-info-grid"')
    includes('newwork-wide')
    expect(demo).toMatch(/\.newwork-info-grid\{[^}]*grid-template-columns/)
    expect(demo).toMatch(/\.newwork-info-grid\{[^}]*gap:/)
    includes('@media(max-width:760px){.newwork-info-grid{grid-template-columns:minmax(0,1fr)}}')
  })

  it('searches works and comments and supports granular administrator permissions', () => {
    includes('id="adminSearchForm"')
    includes('[w.title,w.author,w.kind,w.rights]')
    includes('[c.text,c.work,c.author]')
    includes('const ADMIN_PERMISSIONS=')
    includes('name="adminPermission"')
    includes('id="adminAccountForm"')
    includes('if(!permissions.length)')
    includes('제보·문의 대응')
    includes('이벤트 게시')
    includes('공지 게시')
  })

  it('lets administrators add and manage character chats by work and character', () => {
    includes("['characterChats','캐릭터챗']")
    includes("characterChats:'캐릭터챗 관리'")
    includes('data-admin-tab="${key}" data-go="#/admin?tab=${key}"')
    includes('function characterChats()')
    includes('Object.values(W).filter(w=>isPub(w)&&!w.parent)')
    includes('id="adminCharacterChatForm"')
    includes('id="adminChatKind"')
    includes('id="adminChatWork"')
    includes('id="adminChatCharacter"')
    includes('data-chat-admin-toggle=')
  })

  it('opens character chat management and starts a fork chat', async () => {
    const dom = new JSDOM(demo, {
      runScripts: 'dangerously',
      url: 'https://storyfork.test/#/home',
      beforeParse(window) {
        window.scrollTo = () => {}
        window.matchMedia = () => ({ matches: false })
      },
    })
    const { window } = dom
    window.__SF.S.role = 'admin'
    window.location.hash = '#/admin?tab=data'
    await new Promise(resolve => window.setTimeout(resolve, 200))
    window.document.querySelector('[data-admin-tab="characterChats"]').click()
    await new Promise(resolve => window.setTimeout(resolve, 200))

    expect(window.location.hash).toBe('#/admin?tab=characterChats')
    expect(window.document.querySelector('.workspace h1')?.textContent).toBe('캐릭터챗 관리')
    expect(window.document.querySelector('#adminChatCharacter option')?.value).toBeTruthy()

    const workId = window.document.querySelector('#adminChatWork').value
    const character = window.document.querySelector('#adminChatCharacter').value
    window.document.querySelector('#adminCharacterChatForm').dispatchEvent(new window.Event('submit', { bubbles: true, cancelable: true }))
    window.location.hash = '#/chat'
    await new Promise(resolve => window.setTimeout(resolve, 250))
    const chatCard = [...window.document.querySelectorAll('.rgrid [data-go]')].find(card => card.dataset.go === `#/chat/${workId}/${encodeURIComponent(character)}`)
    expect(chatCard).toBeTruthy()
    chatCard.click()
    await new Promise(resolve => window.setTimeout(resolve, 250))
    expect(window.document.querySelector('#chf')).toBeTruthy()
    window.close()
  })

  it('shows a filterable and sortable character chat catalog before opening a chat', () => {
    includes('function chatListPage()')
    includes('if(!wid)return chatListPage()')
    includes('chats.some(c=>c.enabled!==false&&c.workId===work.id')
    includes('aria-label="작품 유형"')
    includes('id="chatWork"')
    includes('id="chatCharacter"')
    includes('SORTS.map(([k,l])=>')
    includes('sorter(st.sort)')
    includes('w.parent?\'포크\':\'원작\'')
  })

  it('reports a whole novel from work listings instead of sentence selection', () => {
    includes('data-report-novel=')
    includes('function reportSheet(id)')
    expect(demo).not.toContain('data-rep="신고"')
    expect(demo).not.toContain('소설 신고 · ${n}화')
  })

  it('does not show a fork readiness box that does not gate forking', () => {
    expect(demo).not.toContain('포크 준비 끝!')
    expect(demo).not.toContain('class="gauge')
  })

  it('keeps fork collections scoped, sortable, and without the all-stories page', () => {
    const start = demo.indexOf('function ifs()')
    const end = demo.indexOf('function write()', start)
    const forkCollection = demo.slice(start, end)
    expect(forkCollection).not.toContain('전체 소설 보기')
    expect(forkCollection).toContain('sorter(st.sort)')
    expect(forkCollection).toContain('SORTS.map(([k,l])=>')
    expect(forkCollection).toContain('조회 ${kfmt(f.views||0)}')
    includes("SORTS=[['new','최신 순'],['pop','인기 순'],['view','조회 순']]")
    includes("k==='new'?(a,b)=>(a.upd||0)-(b.upd||0)")
    includes("if(p==='ifs'&&!Q.w){nav('#/rank?t=if');return}")
  })

  it('stores each chapter author note and renders it after the chapter text', () => {
    includes('id="authorNote"')
    includes('d.authorNote=note.value')
    includes('authorNote:d.authorNote')
    const reader = demo.slice(demo.indexOf('function reader(id,n){'), demo.indexOf('function bindReader(id,n){'))
    expect(reader).toContain('e.authorNote')
    expect(reader.indexOf('e.authorNote')).toBeGreaterThan(reader.indexOf('const body='))
    const autoPublish = demo.slice(demo.indexOf('function autoGen(id){'), demo.indexOf('function ownedWorld('))
    expect(autoPublish).toContain('authorNote:d.authorNote')
    includes('작가의 말')
  })

  it('offers novel reports on work details and omits them from ranking cards', () => {
    const card = demo.slice(demo.indexOf('function wcard('), demo.indexOf('function searchPage('))
    expect(card).toContain("ranked?'':")
    includes('data-report-novel="${w.id}"')
    const detail = demo.slice(demo.indexOf('function work(id){'), demo.indexOf('function reader(id,n){'))
    expect(detail).toContain('data-report-novel="${id}"')
    expect(detail).toContain('소설 신고')
  })

  it('keeps selecting every chapter separate from the all-chapters fork setting', () => {
    const settings = demo.slice(demo.indexOf('function publishSheet(id){'), demo.indexOf('function policySheet()'))
    expect(settings).not.toContain("st.all=fa.dataset.feAll==='1'")
    expect(settings).not.toContain('st.all=st.eps.size===w.eps.length&&w.eps.length>0')
    expect(settings).toContain('w.forkAll=st.on&&st.all')
    expect(settings).toContain('전체 회차 허용')
    const detail = demo.slice(demo.indexOf('function work(id){'), demo.indexOf('function reader(id,n){'))
    expect(detail).toContain("(w.forkAll||(w.forkEps||[]).length===w.eps.length)?'전체 회차'")
  })

  it('keeps a chapter-by-chapter selection when every chapter is allowed', async () => {
    const dom = new JSDOM(demo, {
      runScripts: 'dangerously',
      url: 'https://storyfork.test/#/home',
      beforeParse(window) {
        window.scrollTo = () => {}
        window.matchMedia = () => ({ matches: false })
      },
    })
    const { window } = dom
    const work = window.__SF.W.guunmong
    work.owner = 'me'
    work.author = '나'
    work.private = false
    work.forksAllowed = true
    work.forkAll = false
    work.forkEps = []
    work.worldIds = undefined
    window.__SF.S.role = 'user'
    window.location.hash = '#/lib?tab=write'
    await new Promise(resolve => window.setTimeout(resolve, 220))
    window.document.querySelector('[data-act="publish"][data-id="guunmong"]').click()

    for (let episode = 1; episode <= work.eps.length; episode++) window.document.querySelector(`#fkeps [data-fe="${episode}"]`).click()
    expect(window.document.querySelector('#fkeps')).toBeTruthy()
    window.document.querySelector('#savepub').click()
    expect(work.forkAll).toBe(false)
    expect(work.forkEps).toEqual(work.eps.map((_, i) => i + 1))
    expect(window.document.querySelector('.mywork .tags').textContent).toContain(`${work.eps.map((_, i) => i + 1).join('·')}화 포크 허용`)
    window.location.hash = '#/work/guunmong'
    await new Promise(resolve => window.setTimeout(resolve, 220))
    expect(window.document.querySelector('.calm').textContent).toContain('전체 회차')
    window.close()
  })

  it('shows separate policy and copyright acknowledgements for fork and import flows', () => {
    const writing = demo.slice(demo.indexOf('function write(){'), demo.indexOf('function publishSheet(id){'))
    expect(writing).toContain('#/writing-policy?method=fork')
    expect(writing).toContain('#/writing-policy?method=import')
    const policy = demo.slice(demo.indexOf('function writingPolicy(){'), demo.indexOf('function publishSheet(id){'))
    expect(policy).toContain('원작이 허용한 공개 회차')
    expect(policy).toContain('가져온 원고')
    expect(policy).toContain('저작권')
    expect(policy).toContain('writingPolicyRule')
    expect(policy).toContain('writingPolicyRights')
    expect(policy).toContain('required')
    const homeBinding = demo.slice(demo.indexOf("if(p==='home'||!"), demo.indexOf("if(p==='read')bindReader"))
    expect(homeBinding).toContain("'writing-policy'")
  })

  it('shows the policy page when forking from a novel detail page', async () => {
    const dom = new JSDOM(demo, {
      runScripts: 'dangerously',
      url: 'https://storyfork.test/#/home',
      beforeParse(window) {
        window.scrollTo = () => {}
        window.matchMedia = () => ({ matches: false })
      },
    })
    const { window } = dom
    window.__SF.S.role = 'user'
    window.location.hash = '#/work/guunmong'
    await new Promise(resolve => window.setTimeout(resolve, 220))
    window.document.querySelector('[data-act="forkPolicy"]').click()
    await new Promise(resolve => window.setTimeout(resolve, 220))
    expect(window.location.hash).toContain('#/writing-policy?method=fork')
    expect(window.document.querySelector('#writingPolicyForm')).toBeTruthy()

    window.document.querySelector('[data-go="#/write"]').click()
    await new Promise(resolve => window.setTimeout(resolve, 220))
    window.location.hash = '#/writing-policy?method=fork'
    await new Promise(resolve => window.setTimeout(resolve, 220))
    window.document.querySelector('#writingPolicyRule').checked = true
    window.document.querySelector('#writingPolicyRights').checked = true
    window.document.querySelector('#writingPolicyForm').dispatchEvent(new window.Event('submit', { bubbles: true, cancelable: true }))
    await new Promise(resolve => window.setTimeout(resolve, 220))
    expect(window.location.hash).toBe('#/rank?t=orig')

    window.location.hash = '#/work/guunmong'
    await new Promise(resolve => window.setTimeout(resolve, 220))
    window.document.querySelector('[data-act="forkPolicy"]').click()
    await new Promise(resolve => window.setTimeout(resolve, 220))
    window.document.querySelector('#writingPolicyRule').checked = true
    window.document.querySelector('#writingPolicyRights').checked = true
    window.document.querySelector('#writingPolicyForm').dispatchEvent(new window.Event('submit', { bubbles: true, cancelable: true }))
    await new Promise(resolve => window.setTimeout(resolve, 220))
    expect(window.location.hash).toBe('#/fork/guunmong')
    expect(window.document.querySelector('#startFork')).toBeTruthy()
    window.close()
  })

  it('shows the creation policy on every visit to the new story button', async () => {
    const dom = new JSDOM(demo, {
      runScripts: 'dangerously',
      url: 'https://storyfork.test/#/home',
      beforeParse(window) {
        window.scrollTo = () => {}
        window.matchMedia = () => ({ matches: false })
      },
    })
    const { window } = dom
    window.__SF.S.role = 'user'
    const acceptPolicy = async () => {
      window.document.querySelector('#workPolicyAck').checked = true
      window.document.querySelector('#workPolicyForm').dispatchEvent(new window.Event('submit', { bubbles: true, cancelable: true }))
      await new Promise(resolve => window.setTimeout(resolve, 80))
      expect(window.document.querySelector('#createWork')).toBeTruthy()
    }
    for (let visit = 0; visit < 2; visit++) {
      window.location.hash = '#/lib?tab=write'
      await new Promise(resolve => window.setTimeout(resolve, 220))
      window.document.querySelector('[data-go="#/new"]').click()
      await new Promise(resolve => window.setTimeout(resolve, 220))
      expect(window.document.querySelector('#workPolicyForm')).toBeTruthy()
      await acceptPolicy()
    }
    window.close()
  })

  it('moves world management into new story creation and preserves its draft while editing worlds', async () => {
    const dom = new JSDOM(demo, {
      runScripts: 'dangerously',
      url: 'https://storyfork.test/#/home',
      beforeParse(window) {
        window.scrollTo = () => {}
        window.matchMedia = () => ({ matches: false })
      },
    })
    const { window } = dom
    window.__SF.S.role = 'user'
    window.location.hash = '#/new'
    await new Promise(resolve => window.setTimeout(resolve, 220))
    window.document.querySelector('#workPolicyAck').checked = true
    window.document.querySelector('#workPolicyForm').dispatchEvent(new window.Event('submit', { bubbles: true, cancelable: true }))
    await new Promise(resolve => window.setTimeout(resolve, 80))
    expect(window.document.querySelector('#worldCreate')).toBeTruthy()
    expect(window.document.querySelector('#combineWorlds')).toBeTruthy()
    expect(window.document.querySelector('[data-go="#/worlds"]')).toBeNull()
    window.document.querySelector('#nwt').value = '작성 중인 작품'
    window.document.querySelector('#nwt').dispatchEvent(new window.Event('input', { bubbles: true }))
    window.document.querySelector('#worldCreate [name="name"]').value = '새 세계'
    window.document.querySelector('#worldCreate [name="rules"]').value = '밤에는 문이 닫힌다'
    window.document.querySelector('#worldCreate').dispatchEvent(new window.Event('submit', { bubbles: true, cancelable: true }))
    await new Promise(resolve => window.setTimeout(resolve, 80))
    expect(window.document.querySelector('#nwt').value).toBe('작성 중인 작품')
    expect([...window.document.querySelectorAll('[name="world"]')].some(input => input.checked && input.parentElement.textContent.includes('새 세계'))).toBe(true)
    window.location.hash = '#/worlds'
    await new Promise(resolve => window.setTimeout(resolve, 220))
    expect(window.location.hash).toBe('#/new')
    window.close()
  })

  it('keeps account logout while removing administrator shortcuts and service navigation', () => {
    expect(demo).toContain('data-act="logout"')
    expect(demo).not.toContain('data-go="#/admin">관리자 화면</button>')
    expect(demo).not.toContain('>서비스로</button>')
    expect(demo).not.toContain('data-go="#/worlds"')
  })

  it('opens a published episode as a separate manuscript revision draft', async () => {
    const dom = new JSDOM(demo, {
      runScripts: 'dangerously',
      url: 'https://storyfork.test/#/home',
      beforeParse(window) {
        window.scrollTo = () => {}
        window.matchMedia = () => ({ matches: false })
        window.HTMLElement.prototype.scrollIntoView = () => {}
        window.confirm = () => true
        Object.defineProperty(window.HTMLElement.prototype, 'innerText', { configurable: true, get() { return this.textContent } })
      },
    })
    const { window } = dom
    window.__SF.S.role = 'user'
    window.location.hash = '#/studio/starlight'
    await new Promise(resolve => window.setTimeout(resolve, 220))

    const original = window.__SF.W.starlight.eps[0].p.slice()
    const episode = [...window.document.querySelectorAll('.seps button')].find(button => button.textContent.trim().startsWith('1화 '))
    expect(episode).toBeTruthy()
    episode.click()
    await new Promise(resolve => window.setTimeout(resolve, 220))

    expect(window.location.hash).toBe('#/studio/starlight?ep=1')
    expect(window.document.querySelector('#et').value).toBe(window.__SF.W.starlight.eps[0].t)
    expect(window.document.querySelector('#eb').textContent).toContain(original[0])
    window.document.querySelector('[data-act="autoToggle"]').click()
    await new Promise(resolve => window.setTimeout(resolve, 220))
    expect(window.document.querySelector('#autoGen').disabled).toBe(true)
    window.document.querySelector('#eb').innerHTML = '<p>수정 초안</p>'
    window.document.querySelector('#eb').dispatchEvent(new window.Event('input', { bubbles: true }))
    expect(window.__SF.W.starlight.eps[0].p).toEqual(original)
    expect(window.__SF.S.draft['starlight:ep:1'].paras).toEqual(['수정 초안'])
    window.document.querySelector('[data-act="pubep"]').click()
    await new Promise(resolve => window.setTimeout(resolve, 0))
    window.document.querySelector('#doPub').click()
    await new Promise(resolve => window.setTimeout(resolve, 220))
    expect(window.__SF.W.starlight.eps[0].p).toEqual(['수정 초안'])
    window.close()
  })

  it('keeps AI proposals beside the manuscript and inserts them only after approval', async () => {
    const dom = new JSDOM(demo, {
      runScripts: 'dangerously',
      url: 'https://storyfork.test/#/home',
      beforeParse(window) {
        window.scrollTo = () => {}
        window.matchMedia = () => ({ matches: false })
        window.HTMLElement.prototype.scrollIntoView = () => {}
        window.confirm = () => true
        Object.defineProperty(window.HTMLElement.prototype, 'innerText', { configurable: true, get() { return this.textContent } })
      },
    })
    const { window } = dom
    window.__SF.S.role = 'user'
    window.location.hash = '#/studio/starlight'
    await new Promise(resolve => window.setTimeout(resolve, 220))

    const original = window.__SF.W.starlight.eps[0].p.slice()
    const request = '장면의 긴장감을 높여 이어 써 주세요.'
    const prompt = window.document.querySelector('#aiPrompt')
    expect(prompt).toBeTruthy()
    prompt.value = request
    window.document.querySelector('#btnProp').click()
    await new Promise(resolve => window.setTimeout(resolve, 220))

    expect(window.document.querySelector('.ai-context').textContent).toContain('현재 회차')
    expect(window.document.querySelector('#aiprev').textContent).toContain(request)
    expect(window.document.querySelector('#eb').textContent).toBe('')
    window.document.querySelector('#acceptAI').click()
    await new Promise(resolve => window.setTimeout(resolve, 220))
    expect(window.document.querySelector('#eb').textContent).not.toBe('')
    expect(window.__SF.W.starlight.eps[0].p).toEqual(original)
    window.close()
  })

  it('lists published episode revision drafts in storage', async () => {
    const dom = new JSDOM(demo, {
      runScripts: 'dangerously',
      url: 'https://storyfork.test/#/home',
      beforeParse(window) {
        window.scrollTo = () => {}
        window.matchMedia = () => ({ matches: false })
        Object.defineProperty(window.HTMLElement.prototype, 'innerText', { configurable: true, get() { return this.textContent } })
      },
    })
    const { window } = dom
    window.__SF.S.role = 'user'
    window.location.hash = '#/studio/starlight'
    await new Promise(resolve => window.setTimeout(resolve, 220))
    window.location.hash = '#/studio/starlight?ep=1'
    await new Promise(resolve => window.setTimeout(resolve, 220))
    window.document.querySelector('#eb').innerHTML = '<p>수정 초안</p>'
    window.document.querySelector('#eb').dispatchEvent(new window.Event('input', { bubbles: true }))
    window.location.hash = '#/me/storage'
    await new Promise(resolve => window.setTimeout(resolve, 220))

    expect(window.document.querySelector('.mec').textContent).toContain('1화 수정 초안')
    window.close()
  })

  it('logs the demo account out from the profile menu', async () => {
    const dom = new JSDOM(demo, {
      runScripts: 'dangerously',
      url: 'https://storyfork.test/#/home',
      beforeParse(window) {
        window.scrollTo = () => {}
        window.matchMedia = () => ({ matches: false })
      },
    })
    const { window } = dom
    window.__SF.S.role = 'user'
    await new Promise(resolve => window.setTimeout(resolve, 220))
    window.document.querySelector('[data-act="acct"]').click()
    await new Promise(resolve => window.setTimeout(resolve, 0))
    window.document.querySelector('.acctm [data-act="logout"]').click()
    await new Promise(resolve => window.setTimeout(resolve, 220))

    expect(window.__SF.S.role).toBeNull()
    expect(window.location.hash).toBe('#/home')
    expect(window.document.querySelector('.acctm')).toBeNull()
    window.document.querySelector('[data-act="acct"]').click()
    await new Promise(resolve => window.setTimeout(resolve, 0))
    expect(window.document.querySelector('.acctm [data-act="logout"]')).toBeNull()
    window.close()
  })

  it('puts administrator logout at the end of the sidebar and returns home', async () => {
    const dom = new JSDOM(demo, {
      runScripts: 'dangerously',
      url: 'https://storyfork.test/#/home',
      beforeParse(window) {
        window.scrollTo = () => {}
        window.matchMedia = () => ({ matches: false })
      },
    })
    const { window } = dom
    window.__SF.S.role = 'admin'
    window.location.hash = '#/admin'
    await new Promise(resolve => window.setTimeout(resolve, 220))
    const sidebar = window.document.querySelector('.admin-nav')
    expect(sidebar.lastElementChild.dataset.act).toBe('logout')
    sidebar.lastElementChild.click()
    await new Promise(resolve => window.setTimeout(resolve, 220))

    expect(window.__SF.S.role).toBeNull()
    expect(window.location.hash).toBe('#/home')
    window.close()
  })

  it('keeps theme and screen-ID controls clear of the back-to-top button', () => {
    const controls = demo.slice(demo.indexOf('function screenControls(){'), demo.indexOf('function pend()'))
    expect(controls).toContain('data-act="sidtoggle"')
    expect(controls).toContain('thmBtn(')
    expect(demo).toContain("insertAdjacentHTML('beforeend',screenControls())")
    const calls = demo.match(/thmBtn\(/g) || []
    expect(calls).toHaveLength(2)
    const controlsStyle = demo.match(/\.screen-controls\{([^}]+)\}/)?.[1] || ''
    const controlsBottom = Number(controlsStyle.match(/bottom:max\((\d+)px,/)?.[1])
    const topStyle = demo.match(/#top\{([^}]+)\}/)?.[1] || ''
    const topBottom = Number(topStyle.match(/bottom:(\d+)px/)?.[1])
    const topHeight = Number(topStyle.match(/height:(\d+)px/)?.[1])
    expect(controlsBottom).toBeGreaterThanOrEqual(topBottom + topHeight + 12)
  })
})
