import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

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

  it('normalizes selecting every chapter to the all-chapters fork setting', () => {
    const settings = demo.slice(demo.indexOf('function publishSheet(id){'), demo.indexOf('function policySheet()'))
    expect(settings).toContain("st.all=fa.dataset.feAll==='1'&&w.eps.length>0")
    expect(settings).toContain('st.all=st.eps.size===w.eps.length&&w.eps.length>0')
    expect(settings).toContain('w.forkAll=st.on&&st.all')
    expect(settings).toContain('전체 회차 허용')
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
  })

  it('keeps theme and screen-ID controls together at the bottom of every screen', () => {
    const controls = demo.slice(demo.indexOf('function screenControls(){'), demo.indexOf('function pend()'))
    expect(controls).toContain('data-act="sidtoggle"')
    expect(controls).toContain('thmBtn(')
    expect(demo).toContain("insertAdjacentHTML('beforeend',screenControls())")
    const calls = demo.match(/thmBtn\(/g) || []
    expect(calls).toHaveLength(2)
    expect(demo).toContain('.screen-controls{position:fixed')
  })
})
