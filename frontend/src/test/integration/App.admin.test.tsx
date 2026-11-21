// @vitest-environment jsdom
import '../fixtureApp'

import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { Provider } from 'react-redux'
import { MemoryRouter, useLocation } from 'react-router'
import { afterEach, describe, expect, it, vi } from 'vitest'

import '../scrollToSpy'
import App from '../../App'
import { appContainer } from '../../app/appContainer'
import { createAppStore } from '../../app/store'
import type { Metrics } from '../../domain/entities/llmOps'

afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.restoreAllMocks() })

const Where = () => { const l = useLocation(); return <p hidden data-testid="where">{l.pathname + l.search}</p> }
const where = () => screen.getByTestId('where').textContent
const sid = () => document.getElementById('sid')!.textContent
const toastIs = (t: string | RegExp) => waitFor(() => expect(document.getElementById('toast')!.textContent).toMatch(t))
const renderAt = (path: string, role: 'user' | 'admin' | null = 'admin', store = createAppStore({ role })) => {
  return { store, ...render(<Provider store={store}><MemoryRouter initialEntries={[path]} useTransitions={false}><App /><Where /></MemoryRouter></Provider>) }
}
const nav = () => screen.getByRole('navigation', { name: '관리자 업무' })
/** 표 행의 ⋮ 버튼('「이름」 조치')을 눌러 메뉴를 열고 그 안을 돌려준다(다른 행의 열린 메뉴는 바깥 누름으로 먼저 닫는다). */
const openRowMenu = (row: HTMLElement) => {
  fireEvent.pointerDown(document.body)
  fireEvent.click(within(row).getByRole('button', { name: /조치$/ }))
  return within(screen.getByRole('menu'))
}

describe('관리자 (A01~A18)', () => {
  it('관리자 화면에서 로그아웃하면 홈으로 가고 로그인 안내가 남지 않는다 (목업 logout)', async () => {
    vi.stubGlobal('navigator', { locks: { request: (_name: string, _options: object, callback: (lock: object) => Promise<unknown>) => callback({}) } })
    const fetch = vi.fn(async (path: string) => path.endsWith('/csrf') ? Response.json({ csrfToken: 'csrf' })
      : path.endsWith('/refresh') ? Response.json({ accessToken: 'token', user: { id: 'admin', email: 'admin@example.invalid', nickname: '관리자', operator: true } })
        : new Response(null, { status: 204 }))
    vi.stubGlobal('fetch', fetch)
    const { store } = renderAt('/admin')
    fireEvent.click(await screen.findByRole('button', { name: /계정 메뉴/ }))
    fireEvent.click(screen.getByRole('menuitem', { name: '로그아웃' }))
    await toastIs('로그아웃했어요')
    await waitFor(() => expect(where()).toBe('/'))
    expect(store.getState().session).toMatchObject({ role: null, next: null, loginMsg: '' })
    expect(fetch).toHaveBeenCalledWith('/api/v1/auth/logout', expect.objectContaining({ method: 'POST', credentials: 'same-origin', headers: expect.objectContaining({ 'X-CSRF-TOKEN': 'csrf', 'X-Auth-User': 'admin' }) }))
  })

  it('일반 회원·비로그인은 관리자 로그인 안내로 보낸다', async () => {
    const { store } = renderAt('/admin?tab=users', 'user')
    await waitFor(() => expect(where()).toBe('/login'))
    expect(store.getState().session).toMatchObject({ next: '/admin?tab=users', loginRole: 'admin', loginMsg: '관리자 화면은 관리자 계정으로 로그인해야 볼 수 있어요.' })
    cleanup()
    renderAt('/admin', null)
    await waitFor(() => expect(where()).toBe('/login'))
  })

  it('탭 이동: 현재 탭 표시, tab=ai는 LLM Ops, 모르는 탭은 개요', async () => {
    renderAt('/admin?tab=nope')
    await screen.findByRole('heading', { name: '관리 개요' })
    expect(sid()).toContain('A01')
    expect(within(nav()).getByRole('link', { name: '개요' }).getAttribute('aria-current')).toBe('page')
    // 개요·LLM Ops·정기 작업은 운영 API 탭이라 데모 표기가 없다.
    expect(document.querySelector('.admin-head .chip')).toBeNull()
    expect(screen.queryByText('데모 화면')).toBeNull()
    expect(document.querySelector('.gnb')).toBeNull()
    cleanup()
    renderAt('/admin?tab=ai')
    await screen.findByRole('heading', { name: 'LLM Ops · 경고' })
    expect(sid()).toContain('A05')
    fireEvent.click(within(nav()).getByRole('link', { name: '사용자' }))
    await screen.findByRole('heading', { name: '사용자 관리' })
    expect(where()).toBe('/admin?tab=users')
    expect(sid()).toContain('A07')
  })

  it('댓글 관리에서 숨긴 댓글은 회차 뷰어 목록·개수에서 빠지고 게시 복구하면 돌아온다 (목업 reader() cms)', async () => {
    const text = '돌다리 장면 묘사 최고… 성진 흔들릴 만하네'
    // 숨김은 확인을 거친다(게시 복구는 확인 없음).
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(true)
    const readerCount = async () => { cleanup(); renderAt('/read/guunmong/1', 'user'); return (await screen.findByRole('heading', { name: /^댓글 \d+$/ })).textContent }
    const before = await readerCount()
    expect(screen.queryByText(text)).not.toBeNull()
    const toggle = async (done: string) => {
      cleanup(); renderAt('/admin?tab=comments')
      fireEvent.click(openRowMenu((await screen.findByText(text)).closest('tr') as HTMLElement).getByRole('menuitem'))
      await toastIs(done)
    }
    await toggle('댓글을 숨겼어요.')
    expect(await readerCount()).toBe('댓글 ' + (Number(before!.split(' ')[1]) - 1))
    expect(screen.queryByText(text)).toBeNull()
    await toggle('댓글을 게시 상태로 되돌렸어요.')
    expect(await readerCount()).toBe(before)
    expect(screen.queryByText(text)).not.toBeNull()
    expect(confirm).toHaveBeenCalledTimes(1)
    confirm.mockRestore()
  })

  it('문의에 답변하면 회원 문의 목록에 운영팀 답변이 보인다', async () => {
    renderAt('/me/inquiry', 'user')
    fireEvent.change(await screen.findByLabelText('제목'), { target: { value: '답변 요청' } })
    fireEvent.change(screen.getByLabelText('내용'), { target: { value: '확인 부탁해요' } })
    fireEvent.click(screen.getByRole('button', { name: '문의 보내기' }))
    await screen.findByText('[이용 문의] 답변 요청')
    cleanup()
    renderAt('/admin?tab=feedback')
    fireEvent.click(await screen.findByRole('button', { name: /답변 요청.*답변 대기/ }))
    await screen.findByRole('heading', { name: '답변 요청' })
    screen.getByText('확인 부탁해요', { selector: '.admin-prose' })
    fireEvent.change(await screen.findByLabelText('새 답변 내용'), { target: { value: '확인했어요' } })
    fireEvent.click(screen.getByRole('button', { name: '답변 등록' }))
    await toastIs('답변을 등록했어요.')
    cleanup()
    renderAt('/me/inquiry', 'user')
    const q = (await screen.findByText('[이용 문의] 답변 요청')).closest('.rp') as HTMLElement
    within(q).getByText('답변 완료')
    within(q).getByText('확인했어요')
  })

  it('제보·문의 탭은 기존 단일 답변 데모와 운영 문의 기록 데모 없이 실제 회원 문의와 작가 제보만 보인다', async () => {
    renderAt('/admin?tab=feedback')
    await screen.findByRole('heading', { name: '회원 문의' })
    expect(screen.queryByText('기존 회원 문의 데모')).toBeNull()
    expect(screen.queryByRole('button', { name: '문의 기록 추가' })).toBeNull()
    screen.getByText('작가 검토 제보')
    expect(document.querySelector('.admin-head .chip')).toBeNull()
  })

  it('개요는 운영 대시보드 카드를 서버 값으로 보이고, 출처를 읽지 못한 칸은 0이 아니라 불러오지 못함으로 보인다', async () => {
    const dashboard = appContainer.resolve('operationsDashboardUseCase')
    const card = async (label: string) => (await screen.findByText(label)).closest('div') as HTMLElement
    renderAt('/admin?tab=data')
    within(await card('전체 회원')).getByText('1,284명')
    const inquiries = await card('답변 대기 문의')
    within(inquiries).getByText('3건')
    expect(within(inquiries).getByRole('link', { name: /바로 가기$/ }).getAttribute('href')).toBe('/admin?tab=feedback')
    expect(within(await card('접수 신고')).getByRole('link', { name: /바로 가기$/ }).getAttribute('href')).toBe('/admin?tab=rights')
    within(await card('AI 요청 · 오늘')).getByText('48건')
    cleanup()
    // 회원(Core)·접수 신고 칸만 비어 오고 나머지는 그대로 보인다.
    const real = await dashboard.dashboard()
    vi.spyOn(dashboard, 'dashboard').mockResolvedValue({ ...real, members: null, pending: { inquiries: 4, reports: null }, unavailable: ['core', 'content'] })
    renderAt('/admin?tab=data')
    await screen.findByText(/일부 출처를 불러오지 못했어요: core, content/)
    within(await card('전체 회원')).getByText('불러오지 못함')
    const reports = await card('접수 신고')
    within(reports).getByText('불러오지 못함')
    expect(within(reports).queryByText('0건')).toBeNull()
    within(await card('답변 대기 문의')).getByText('4건')
  })

  it('개요는 요약 카드가 맨 위이고 그 아래에 서비스 지표(전체 기간)와 최근 7일 AI 사용 순으로 단계 막대 4묶음·회차당 반응·Fork 기준 회차 분포를 보이며 비율·오차·n은 각 막대 위에 있다', async () => {
    renderAt('/admin?tab=data')
    const section = await screen.findByRole('region', { name: '서비스 지표(전체 기간)' })
    const after = (first: Element, second: Element) => !!(first.compareDocumentPosition(second) & Node.DOCUMENT_POSITION_FOLLOWING)
    expect(after(document.querySelector('.admin-summary')!, section)).toBe(true)
    expect(after(section, await screen.findByLabelText('최근 7일 AI 사용'))).toBe(true)
    const figures = within(section).getAllByRole('figure')
    expect(figures.map((figure) => figure.querySelector('figcaption')?.textContent)).toEqual([
      '독자 이어 읽기', '독자의 Fork', 'Fork 작가의 저장·발행', 'AI 제안 채택·수정 제안 승인', '회차당 반응', 'Fork 기준 회차 분포',
    ])
    // 비율 목록은 캡션 아래·그림(role=img) 위에 있다.
    for (const figure of figures.slice(0, 5)) expect(after(figure.querySelector('ul.admin-funnel-rates')!, figure.querySelector('[role="img"]')!)).toBe(true)
    const lines = (name: string) => within(within(section).getByRole('list', { name })).getAllByRole('listitem').map((li) => li.textContent)
    expect(lines('독자 이어 읽기 비율')).toEqual(['조회 → 1화 이상 읽음60.0% ±5.8%p · n=300', '1화 이상 → 이어 읽기40.0% ±7.5%p · n=180'])
    expect(lines('Fork 작가의 저장·발행 비율')).toEqual(['Fork → 직접 저장68.0% ±20.0%p · n=25', '저장 → 직접 발행47.1% ±24.3%p · n=17'])
    expect(lines('회차당 반응 값')).toEqual(['좋아요4.65 · 발행 회차 n=46', '관심2.11 · 발행 회차 n=46', '댓글0.83 · 발행 회차 n=46'])
    within(section).getByText('첫 발행까지 걸린 시간의 중앙값 31.5시간')
    within(section).getByText(/시연 데이터를 집계한 값이에요/)
  })

  it('Content를 읽지 못해 funnel이 비어 오면 서비스 지표는 0으로 채우지 않고 불러오지 못함으로 보인다', async () => {
    const dashboard = appContainer.resolve('operationsDashboardUseCase')
    const real = await dashboard.dashboard()
    vi.spyOn(dashboard, 'dashboard').mockResolvedValue({ ...real, funnel: null, unavailable: ['content'] })
    renderAt('/admin?tab=data')
    const section = await screen.findByRole('region', { name: '서비스 지표(전체 기간)' })
    within(section).getByText('불러오지 못함')
    expect(within(section).queryAllByRole('figure')).toEqual([])
    await screen.findByText(/일부 출처를 불러오지 못했어요: content/)
  })

  it('운영 대시보드를 읽지 못하면 실패를 알리고 다시 불러오기로 복구한다', async () => {
    const dashboard = appContainer.resolve('operationsDashboardUseCase')
    vi.spyOn(dashboard, 'dashboard').mockRejectedValue(new Error('조회 실패'))
    renderAt('/admin?tab=data')
    await screen.findByText(/운영 현황을 불러오지 못했어요/)
    expect(screen.queryByText('불러오지 못함')).toBeNull()
    vi.mocked(dashboard.dashboard).mockRestore()
    fireEvent.click(screen.getByRole('button', { name: '다시 불러오기' }))
    await screen.findByText('1,284명')
  })

  it('개요는 카드 아래에 최근 7일 AI 사용 차트 둘을 보이고, 새로고침은 차트도 다시 읽는다', async () => {
    const weekly = vi.spyOn(appContainer.resolve('llmOpsUseCase'), 'weeklyMetrics')
    renderAt('/admin?tab=data')
    const usage = await screen.findByLabelText('최근 7일 AI 사용')
    // 차트는 값을 말로 옮긴 요약을 role=img로 알린다(크기를 못 재는 jsdom에서는 그림 없이 이 틀만 렌더된다).
    await within(usage).findByRole('img', { name: /^최근 7일 요청 \d+건, 실패율 / })
    within(usage).getByRole('img', { name: /^최근 7일 비용 사용자 \$/ })
    const before = weekly.mock.calls.length
    fireEvent.click(screen.getByRole('button', { name: '새로고침' }))
    await waitFor(() => expect(weekly.mock.calls.length).toBeGreaterThan(before))
  })

  it('최근 7일 차트는 읽는 동안 불러오는 중으로 보이고, 카드는 따로 먼저 보인다', async () => {
    let finish!: (metrics: Metrics) => void
    vi.spyOn(appContainer.resolve('llmOpsUseCase'), 'weeklyMetrics').mockReturnValue(new Promise<Metrics>((resolve) => { finish = resolve }))
    renderAt('/admin?tab=data')
    const usage = await screen.findByLabelText('최근 7일 AI 사용')
    within(usage).getByText('AI 사용 현황을 불러오고 있어요.')
    await screen.findByText('1,284명')
    expect(within(usage).queryByRole('img')).toBeNull()
    finish({ rows: [] })
    await within(usage).findByText('아직 데이터가 없어요.')
    expect(within(usage).queryByText('AI 사용 현황을 불러오고 있어요.')).toBeNull()
    expect(within(usage).queryByRole('img')).toBeNull()
  })

  it('최근 7일 차트는 LLM Ops 조회 권한이 없으면(403) 차트 대신 안내 한 줄만 보이고 다시 불러오기는 두지 않는다', async () => {
    vi.spyOn(appContainer.resolve('llmOpsUseCase'), 'weeklyMetrics').mockResolvedValue(null)
    renderAt('/admin?tab=data')
    const usage = await screen.findByLabelText('최근 7일 AI 사용')
    await within(usage).findByText('LLM Ops 조회 권한이 있어야 볼 수 있어요.')
    expect(within(usage).queryByRole('img')).toBeNull()
    expect(within(usage).queryByRole('button', { name: '다시 불러오기' })).toBeNull()
    await screen.findByText('1,284명')
  })

  it('최근 7일 차트를 읽지 못하면 0으로 채우지 않고 실패를 알리며, 다시 불러오기로 복구한다', async () => {
    const weekly = vi.spyOn(appContainer.resolve('llmOpsUseCase'), 'weeklyMetrics').mockRejectedValue(new Error('조회 실패'))
    renderAt('/admin?tab=data')
    const usage = await screen.findByLabelText('최근 7일 AI 사용')
    await within(usage).findByText(/AI 사용 현황을 불러오지 못했어요/)
    expect(within(usage).queryByRole('img')).toBeNull()
    await screen.findByText('1,284명')
    weekly.mockRestore()
    fireEvent.click(within(usage).getByRole('button', { name: '다시 불러오기' }))
    await within(usage).findByRole('img', { name: /^최근 7일 요청 \d+건, 실패율 / })
    expect(within(usage).queryByText(/불러오지 못했어요/)).toBeNull()
  })

  it('경고 조회 권한(llm·jobs)이 없으면 LLM Ops 경고 보기는 실패 화면 대신 필요한 권한을 안내하고, 다른 보기는 그대로 쓸 수 있다', async () => {
    vi.spyOn(appContainer.resolve('operationsDashboardUseCase'), 'alerts').mockResolvedValue(null)
    renderAt('/admin?tab=llm')
    await screen.findByText("경고를 보려면 'LLM Ops 조회' 또는 '정기 작업' 권한이 필요해요.")
    expect(screen.queryByRole('region', { name: '운영 경고 표' })).toBeNull()
    expect(screen.queryByRole('button', { name: '다시 불러오기' })).toBeNull()
    fireEvent.click(within(nav()).getByRole('link', { name: '추적·지표' }))
    await screen.findByRole('region', { name: 'LLM 추적 표' })
  })

  it("정기 작업 탭은 '정기 작업' 권한이 없으면(403) 일반 실패 문구와 다시 불러오기 대신 필요한 권한 안내만 보인다", async () => {
    const jobs = appContainer.resolve('jobMonitorUseCase')
    vi.spyOn(jobs, 'runs').mockResolvedValue(null)
    vi.spyOn(jobs, 'schedules').mockResolvedValue(null)
    renderAt('/admin?tab=jobs')
    await screen.findByText("실행 기록과 일정을 보려면 '정기 작업' 권한이 필요해요.")
    expect(screen.queryByText(/불러오지 못했어요/)).toBeNull()
    expect(screen.queryByRole('button', { name: '다시 불러오기' })).toBeNull()
    expect(screen.queryByRole('region', { name: '정기 작업 일정 표' })).toBeNull()
    expect(screen.queryByRole('button', { name: '일정 등록' })).toBeNull()
  })

  it('LLM Ops의 추적·지표·프롬프트·모델·평가·누설 검사·경고 기준은 조회 권한(llm)이 없으면(403) 다시 불러오기 대신 같은 권한 안내만 보인다', async () => {
    const llm = appContainer.resolve('llmOpsUseCase')
    vi.spyOn(llm, 'traces').mockResolvedValue(null)
    vi.spyOn(llm, 'metrics').mockResolvedValue(null)
    vi.spyOn(llm, 'prompts').mockResolvedValue(null)
    vi.spyOn(llm, 'models').mockResolvedValue(null)
    vi.spyOn(llm, 'evaluations').mockResolvedValue(null)
    vi.spyOn(llm, 'leakChecks').mockResolvedValue(null)
    vi.spyOn(llm, 'alertRules').mockResolvedValue(null)
    vi.spyOn(llm, 'settings').mockResolvedValue(null)
    renderAt('/admin?tab=llm')
    // 쪽마다 권한이 없는 패널 수만큼 같은 안내가 보이고(경고 1·추적·지표 2·프롬프트·모델 2·평가·누설 검사 3), 목록이 403이면 등록·실행·저장 폼도 숨겨 권한 안내만 보인다.
    const pages: [string, number, RegExp | null][] = [['경고', 1, /기준 저장$/], ['추적·지표', 2, null], ['프롬프트·모델', 2, /^모델 등록$/], ['평가·누설 검사', 3, /^평가 실행$|^표본 비율 저장$/]]
    for (const [page, notes, hiddenForm] of pages) {
      fireEvent.click(within(nav()).getByRole('link', { name: page }))
      await waitFor(() => expect(screen.getAllByText('LLM Ops 조회 권한이 있어야 볼 수 있어요.')).toHaveLength(notes))
      expect(screen.queryByText(/불러오지 못했어요/)).toBeNull()
      expect(screen.queryByRole('button', { name: '다시 불러오기' })).toBeNull()
      if (hiddenForm) expect(screen.queryByRole('button', { name: hiddenForm })).toBeNull()
    }
  })

  it('프롬프트 상세만 403이어도 다시 불러오기 없이 권한 안내를 보인다', async () => {
    vi.spyOn(appContainer.resolve('llmOpsUseCase'), 'prompt').mockResolvedValue(null)
    renderAt('/admin?tab=llm&view=prompts')
    fireEvent.click(await screen.findByRole('button', { name: /qa-answer/ }))
    const detail = await screen.findByLabelText('프롬프트 상세')
    await within(detail).findByText('LLM Ops 조회 권한이 있어야 볼 수 있어요.')
    expect(within(detail).queryByRole('button', { name: '다시 불러오기' })).toBeNull()
    expect(within(detail).queryByRole('button', { name: '새 버전 등록' })).toBeNull()
  })

  it('공지를 게시하면 회원 공지사항에 보인다', async () => {
    renderAt('/admin?tab=notices')
    fireEvent.click(await screen.findByRole('button', { name: '공지 작성' }))
    expect((await screen.findByLabelText<HTMLInputElement>('공지 제목')).required).toBe(true)
    fireEvent.change(screen.getByLabelText('공지 제목'), { target: { value: '점검 안내' } })
    fireEvent.change(screen.getByLabelText('공지 내용'), { target: { value: '오늘 밤 점검해요' } })
    fireEvent.click(screen.getByRole('button', { name: '공지 저장' }))
    await toastIs('공지를 저장했어요. 회원 공지사항에 바로 공개돼요.')
    cleanup()
    renderAt('/me/notice', 'user')
    await screen.findByRole('link', { name: /점검 안내/ })
  })

  it('이벤트를 등록하면 회원 이벤트 화면에 보인다', async () => {
    renderAt('/admin?tab=notices')
    fireEvent.click(within(nav()).getByRole('link', { name: '이벤트' }))
    // 이벤트는 운영 API(대역: 메모리 저장소)로 등록하고, 회원 화면은 같은 공개 API로 읽는다.
    fireEvent.click(await screen.findByRole('button', { name: '이벤트 작성' }))
    fireEvent.change(await screen.findByLabelText('이벤트 제목'), { target: { value: '새 이벤트' } })
    fireEvent.change(screen.getByLabelText('이벤트 내용'), { target: { value: '참여해 보세요' } })
    fireEvent.click(screen.getByRole('button', { name: '이벤트 저장' }))
    await toastIs('이벤트를 등록했어요.')
    await screen.findByRole('heading', { name: '새 이벤트' })
    within(screen.getByRole('region', { name: '운영 이벤트' })).getByText('상시')
    cleanup()
    renderAt('/me/event', 'user')
    await screen.findByText('새 이벤트')
    screen.getByText('상시')
  })

  it('정기 작업 탭은 실행 기록의 출처 실패를 알리되 불러온 기록은 그대로 보이고, 실패한 작업은 확인 뒤 다시 실행을 요청한다', async () => {
    const jobs = appContainer.resolve('jobMonitorUseCase')
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(true)
    const real = (await jobs.runs({ status: '', kind: '', page: 0 }))!
    const runs = vi.spyOn(jobs, 'runs').mockResolvedValue({ ...real, unavailable: ['content-preprocessing'] })
    renderAt('/admin?tab=jobs')
    await screen.findByText(/일부 출처의 실행 기록을 불러오지 못했어요: content-preprocessing/)
    const row = (await screen.findByRole('button', { name: '「manuscript_preprocessing 실행 job-failed-1」 조치' })).closest('tr') as HTMLElement
    within(row).getByText('원고 전처리')
    within(row).getByText('38/100 (38%)')
    within(row).getByText('39화 전처리 중 AI 요청이 시간 초과됐어요.')
    runs.mockRestore()
    fireEvent.click(openRowMenu(row).getByRole('menuitem', { name: '다시 실행' }))
    expect(confirm).toHaveBeenCalledTimes(1)
    await toastIs('실패한 작업의 재실행을 요청했어요.')
    await waitFor(() => expect(screen.queryByRole('button', { name: '「manuscript_preprocessing 실행 job-failed-1」 조치' })).toBeNull())
    within(screen.getByRole('region', { name: '정기 작업 일정 표' })).getByText('LLM 경고 점검')
  })

  it('분류·캐릭터챗 입력은 다른 화면에 갔다 와도 유지된다 (목업 S.admin.filters·chatForm)', async () => {
    const { store } = renderAt('/admin?tab=characterChats')
    await screen.findByLabelText('작품 유형')
    fireEvent.click(within(nav()).getByRole('link', { name: '캐릭터챗' }))
    const kind = await screen.findByLabelText('작품 유형') as HTMLSelectElement
    fireEvent.change(kind, { target: { value: 'original' } })
    fireEvent.click(within(nav()).getByRole('link', { name: '작품' }))
    const cat = await screen.findByLabelText('분류') as HTMLSelectElement
    fireEvent.change(cat, { target: { value: 'fork' } })
    cleanup()
    renderAt('/admin?tab=characterChats', 'admin', store)
    expect((await screen.findByLabelText('작품 유형') as HTMLSelectElement).value).toBe('original')
    fireEvent.click(within(nav()).getByRole('link', { name: '작품' }))
    expect((await screen.findByLabelText('분류') as HTMLSelectElement).value).toBe('fork')
  })

  it('프로필 탭은 로그인한 계정을 보여 주고 변경은 회원 계정 화면으로 보낸다', async () => {
    const { store } = renderAt('/admin?tab=profile')
    const { nick, email } = store.getState().session.user
    await screen.findByText(nick, { selector: '.mehead b' })
    screen.getByText(`${email} · 관리자 계정`)
    expect(screen.getByRole('link', { name: '닉네임·이메일 변경' }).getAttribute('href')).toBe('/me/profile')
    expect(screen.queryByRole('button', { name: '프로필 저장' })).toBeNull()
  })

  it('실행 기록은 서버가 읽게 허용하는 앞쪽 1,000건 밖으로는 쪽 이동을 막고 안내한다', async () => {
    const jobs = appContainer.resolve('jobMonitorUseCase')
    const real = (await jobs.runs({ status: '', kind: '', page: 0 }))!
    vi.spyOn(jobs, 'runs').mockResolvedValue({ ...real, page: 49, size: 20, total: 3000 })
    renderAt('/admin?tab=jobs')
    await screen.findByText(/전체 3,000건 · 50\/50쪽/)
    expect((screen.getByRole('button', { name: '다음' }) as HTMLButtonElement).disabled).toBe(true)
    expect((screen.getByRole('button', { name: '이전' }) as HTMLButtonElement).disabled).toBe(false)
    screen.getByText(/앞쪽 1,000건까지만 볼 수 있어요/)
  })

  it('LLM Ops 추적은 요청 ID로 한 요청을 찾고 단계 상세를 우리 화면에 보인다', async () => {
    renderAt('/admin?tab=llm&view=traces')
    const list = () => within(screen.getByRole('region', { name: 'LLM 추적 표' }))
    await waitFor(() => expect(list().getAllByRole('row')).toHaveLength(5))
    fireEvent.change(screen.getByLabelText('요청 ID'), { target: { value: 'req-trace-2' } })
    fireEvent.click(within(screen.getByRole('region', { name: 'LLM 추적' })).getByRole('button', { name: '조회' }))
    await waitFor(() => expect(list().getAllByRole('row')).toHaveLength(2))
    fireEvent.click(list().getByRole('button', { name: '「writing 추적 trace-2」 조치' }))
    fireEvent.click(within(screen.getByRole('menu')).getByRole('menuitem', { name: '단계 상세' }))
    await screen.findByRole('heading', { name: 'writing · 실패' })
    // 관리자는 Langfuse 웹에 들어가지 않으므로 상세는 우리 화면의 단계 표뿐이고 Langfuse 링크는 없다.
    expect(screen.queryByRole('link', { name: /Langfuse/ })).toBeNull()
    within(screen.getByRole('region', { name: '추적 실행 단계 표' })).getByText('retrieve')
    screen.getByText('모델 응답 실패(예시)')
    fireEvent.click(screen.getByRole('button', { name: '추적 목록으로' }))
    await screen.findByRole('region', { name: 'LLM 추적 표' })
  })

  it('LLM Ops 지표는 묶음별 표를 보이고 데이터가 없는 비율은 0%가 아니라 데이터 없음이다', async () => {
    renderAt('/admin?tab=llm&view=traces')
    within(await screen.findByRole('region', { name: 'LLM 지표 표' })).getByRole('columnheader', { name: '날짜' })
    // 표 위 차트: 날짜별은 요청 수·p95 지연·실패율.
    screen.getByRole('img', { name: /^최근 7일 요청 \d+건, 실패율 .*, p95 지연 최대 / })
    const ratio = (label: string) => screen.getByText(label).closest('div') as HTMLElement
    within(ratio('제안 채택률')).getByText('42%')
    within(ratio('필터 복원률')).getByText('데이터 없음')
    fireEvent.change(screen.getByLabelText('묶음'), { target: { value: 'model' } })
    fireEvent.click(within(screen.getByRole('region', { name: 'LLM 지표' })).getByRole('button', { name: '조회' }))
    await within(await screen.findByRole('region', { name: 'LLM 지표 표' })).findByRole('columnheader', { name: '모델' })
    // 기능·모델별은 비용 가로 막대로 바뀐다.
    screen.getByRole('img', { name: /^최근 7일 모델별 비용 사용자 / })
    expect(screen.queryByRole('img', { name: /p95 지연/ })).toBeNull()
  })

  it('프롬프트 승격은 최신 평가가 통과가 아니면 서버 문구로 거절되고, 새 버전은 라벨 없이 등록된다', async () => {
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(true)
    renderAt('/admin?tab=llm&view=prompts')
    fireEvent.click(await screen.findByRole('button', { name: /qa-answer/ }))
    await screen.findByRole('heading', { name: 'qa-answer' })
    fireEvent.click(screen.getByRole('button', { name: '「qa-answer 3번 버전」 조치' }))
    fireEvent.click(within(screen.getByRole('menu')).getByRole('menuitem', { name: 'production 승격' }))
    expect(confirm).toHaveBeenCalledTimes(1)
    await within(screen.getByLabelText('프롬프트 상세')).findByText('회귀 평가를 통과한 버전만 production으로 올릴 수 있어요.')
    // 현재 production 버전에는 조치 메뉴가 없다.
    expect(screen.queryByRole('button', { name: '「qa-answer 2번 버전」 조치' })).toBeNull()
    fireEvent.change(screen.getByLabelText('새 버전 본문'), { target: { value: '새 프롬프트' } })
    fireEvent.click(screen.getByRole('button', { name: '새 버전 등록' }))
    await toastIs('새 버전을 등록했어요.')
    await screen.findByRole('button', { name: '「qa-answer 4번 버전」 조치' })
  })

  it('LLM Ops 평가는 지표 표를 보이고 모델·누설 검사 기록도 읽는다', async () => {
    renderAt('/admin?tab=llm&view=quality')
    fireEvent.click(await screen.findByRole('button', { name: '「qa-regression qa-answer 3번 버전 평가」 조치' }))
    fireEvent.click(within(screen.getByRole('menu')).getByRole('menuitem', { name: '상세' }))
    const metrics = await screen.findByRole('region', { name: '평가 지표 표' })
    screen.getByRole('img', { name: /^평가 지표 2개: faithfulness 점수 0\.780 기준 0\.900/ })
    within(metrics).getByText('faithfulness')
    within(metrics).getByText('-0.120')
    fireEvent.click(within(nav()).getByRole('link', { name: '프롬프트·모델' }))
    within(await screen.findByRole('region', { name: '모델 단가 표' })).getByText('$2.50')
    fireEvent.click(within(nav()).getByRole('link', { name: '평가·누설 검사' }))
    const leaks = await screen.findByRole('region', { name: '정보 누설 검사 표' })
    within(leaks).getByText('의심')
    fireEvent.click(within(leaks).getByRole('button', { name: '「추적 trace-1」 조치' }))
    fireEvent.click(within(screen.getByRole('menu')).getByRole('menuitem', { name: '추적 보기' }))
    await screen.findByRole('region', { name: '추적 상세' })
    // 누설 검사의 추적은 추적·지표 쪽으로 옮겨 상세를 연다.
    expect(where()).toBe('/admin?tab=llm&view=traces')
  })

  it('경고 기준은 값을 넣고 켜서 저장하고, 표본 비율은 0~1만 받는다', async () => {
    renderAt('/admin?tab=llm')
    fireEvent.change(await screen.findByLabelText('AI 실패율 기준값'), { target: { value: '0.2' } })
    fireEvent.click(screen.getByLabelText('AI 실패율 켜기'))
    fireEvent.click(screen.getByRole('button', { name: 'AI 실패율 기준 저장' }))
    await toastIs('경고 기준을 저장했어요.')
    // 표본 비율은 평가·누설 검사 쪽에 있다. 범위 밖 값은 서버에 보내지 않고 안내한다(jsdom은 max 검증으로 click 제출을 막으므로 submit 이벤트로 보낸다).
    fireEvent.click(within(nav()).getByRole('link', { name: '평가·누설 검사' }))
    fireEvent.change(await screen.findByLabelText('표본 비율(0~1)'), { target: { value: '1.5' } })
    fireEvent.submit(screen.getByRole('button', { name: '표본 비율 저장' }).closest('form')!)
    await toastIs('표본 비율은 0 이상 1 이하의 숫자로 입력해 주세요.')
    fireEvent.change(screen.getByLabelText('표본 비율(0~1)'), { target: { value: '0.5' } })
    fireEvent.click(screen.getByRole('button', { name: '표본 비율 저장' }))
    await toastIs('누설 검사 표본 비율을 저장했어요.')
  })

  it('개요의 미확인 경고 카드는 LLM Ops 경고로 이어지고, 메모와 함께 확인하면 미확인 목록에서 빠지고 카드의 수도 줄어든다', async () => {
    renderAt('/admin?tab=data')
    const openCard = async () => (await screen.findByText('미확인 경고')).closest('div') as HTMLElement
    await within(await openCard()).findByText('2건')
    fireEvent.click(within(await openCard()).getByRole('link', { name: /바로 가기$/ }))
    // 운영 경고 알림의 이동 대상(/admin?tab=llm)과 같은 자리: LLM Ops는 경고 보기로 열린다.
    expect(where()).toBe('/admin?tab=llm')
    fireEvent.change(await screen.findByLabelText('AI 실패율 경고 메모'), { target: { value: '재시작 확인' } })
    fireEvent.click(screen.getByRole('button', { name: 'AI 실패율 경고 확인' }))
    await toastIs('경고를 확인으로 기록했어요.')
    await waitFor(() => expect(screen.queryByLabelText('AI 실패율 경고 메모')).toBeNull())
    fireEvent.change(screen.getByLabelText('상태'), { target: { value: 'acknowledged' } })
    const row = (await screen.findByText('재시작 확인')).closest('tr') as HTMLElement
    within(row).getByText('확인함')
    fireEvent.click(within(row).getByRole('button', { name: 'AI 실패율 경고 조치 완료' }))
    await toastIs('경고를 조치 완료로 기록했어요.')
    fireEvent.click(within(nav()).getByRole('link', { name: '개요' }))
    await within(await openCard()).findByText('1건')
  })

  it('정기 작업 일정을 등록하면 목록에 보이고, 잘못된 매개변수는 보내지 않으며, 취소하면 꺼짐으로 보인다', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(true)
    renderAt('/admin?tab=jobs')
    await screen.findByRole('region', { name: '정기 작업 일정 표' })
    fireEvent.change(screen.getByLabelText('작업 종류'), { target: { value: 'leak_sample_check' } })
    fireEvent.change(screen.getByLabelText('cron 식'), { target: { value: '0 0 5 * * *' } })
    fireEvent.change(screen.getByLabelText('매개변수(JSON 객체)'), { target: { value: '{깨짐' } })
    fireEvent.click(screen.getByRole('button', { name: '일정 등록' }))
    await toastIs('매개변수는 JSON 객체로 입력해 주세요.')
    fireEvent.change(screen.getByLabelText('매개변수(JSON 객체)'), { target: { value: '{}' } })
    fireEvent.click(screen.getByRole('button', { name: '일정 등록' }))
    await toastIs('정기 작업 일정을 등록했어요.')
    const table = screen.getByRole('region', { name: '정기 작업 일정 표' })
    await within(table).findByText('0 0 5 * * *')
    // 수정은 기존 종류를 함께 보내는 전체 교체라 cron만 고쳐도 성공하고, 폼은 등록 모드로 돌아간다.
    fireEvent.click(within(table).getByRole('button', { name: '「정보 누설 표본 검사 일정」 조치' }))
    fireEvent.click(within(screen.getByRole('menu')).getByRole('menuitem', { name: '수정' }))
    await screen.findByRole('heading', { name: '일정 수정 · 정보 누설 표본 검사' })
    fireEvent.change(screen.getByLabelText('cron 식'), { target: { value: '0 0 6 * * *' } })
    fireEvent.click(screen.getByRole('button', { name: '일정 변경' }))
    await toastIs('정기 작업 일정을 바꿨어요.')
    await within(table).findByText('0 0 6 * * *')
    await screen.findByRole('heading', { name: '일정 등록' })
    fireEvent.click(within(table).getByRole('button', { name: '「정보 누설 표본 검사 일정」 조치' }))
    fireEvent.click(within(screen.getByRole('menu')).getByRole('menuitem', { name: '일정 취소' }))
    await toastIs('정기 작업 일정을 취소했어요.')
    await within(table).findByText('꺼짐·취소됨')
  })
})
