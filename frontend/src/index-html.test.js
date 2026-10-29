import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { JSDOM } from 'jsdom'

const demo = readFileSync(new URL('../index.html', import.meta.url), 'utf8')
const includes = (text) => expect(demo.includes(text), `missing documented demo content: ${text}`).toBe(true)

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
