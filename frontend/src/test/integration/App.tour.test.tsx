// @vitest-environment jsdom
import '../fixtureApp'

import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { StrictMode } from 'react'
import { Provider } from 'react-redux'
import { MemoryRouter } from 'react-router'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'

import '../scrollToSpy'
import '../testLocks'
import App from '../../App'
import { appContainer } from '../../app/appContainer'
import { createAppStore } from '../../app/store'
import { forgetSession, login } from '../../data/api/auth'
import type { EditSuggestion } from '../../domain/entities/editSuggestion'
import type { FeedbackReport } from '../../domain/entities/feedbackReport'
import { FORK_WORLD_REQUIRED } from '../../domain/entities/work'
import { isTourSeen, tourOffKey } from '../../presentation/shared/tour/tourPrefs'

// fixtureApp은 앱 전체를 그리는 테스트가 투어에 가려지지 않게 모든 투어를 끈 채(storyfork.tour=off) 시작한다. 이 파일은 그 스위치를 켜서 앱의 자동 시작을 검사한다.
/** 스위치를 켜고, 앞 테스트가 남긴 '본 것' 기억(storyfork.tour.*)도 지워 처음 방문 상태로 만든다. */
const toursOn = () => {
  Object.keys(localStorage).filter((k) => k.startsWith(`${tourOffKey}.`)).forEach((k) => localStorage.removeItem(k))
  localStorage.removeItem(tourOffKey)
}
const toursOff = () => localStorage.setItem(tourOffKey, 'off')
afterEach(() => { cleanup(); vi.restoreAllMocks(); toursOff() })

const report = (extra: Partial<FeedbackReport> = {}): FeedbackReport => ({
  id: 'r1', workId: 'guunmong', workTitle: '구운몽', episodeNumber: 2, publishedVersionId: 'v2', kind: 'typo', body: '오탈자가 있어요', quote: null, visibility: 'private',
  status: 'unchecked', reporterName: '독자A', mine: false, owner: true, authorChecked: false, withdrawn: false, amendments: [], responses: [],
  createdAt: '2026-11-10T01:00:00Z', updatedAt: '2026-11-10T01:00:00Z', ...extra,
})
const suggestion: EditSuggestion = {
  id: 's1', workId: 'w1', workTitle: '별빛 서약', episodeNumber: 3, publishedVersionId: 'v1', source: 'reader', proposerName: '독자A',
  beforeText: '않 된다고', afterText: '안 된다고', editedText: null, reason: null, status: 'pending', decisionReason: null,
  applyResult: null, applyFailure: null, appliedVersionId: null, scope: 'auto', scopeReasons: ['단어마다 한 글자 오탈자 수준만 바뀌어요.'],
  mine: false, owner: true, createdAt: '2026-11-10T01:00:00Z', updatedAt: '2026-11-10T01:00:00Z',
}
/** 작가 피드백함의 두 목록(독자 제보·수정 제안) 읽기를 대신한다. 제보 응답은 Promise로 시점을 정할 수 있다. */
function stubInbox(reports: Promise<FeedbackReport[]> | FeedbackReport[] = [], suggestions: EditSuggestion[] = []) {
  vi.spyOn(appContainer.resolve('feedbackReportUseCase'), 'listInbox').mockImplementation(() => Promise.resolve(reports))
  vi.spyOn(appContainer.resolve('editSuggestionUseCase'), 'inbox').mockResolvedValue(suggestions)
}
beforeEach(() => { stubInbox() })

const renderAt = (path: string) => render(<Provider store={createAppStore({ role: 'user' })}><MemoryRouter initialEntries={[path]}><App /></MemoryRouter></Provider>)

it('fixtureApp은 모든 화면·탭의 투어를 끈 채 시작한다', () => {
  expect(isTourSeen('studio')).toBe(true)
  expect(isTourSeen('manage', 'settings')).toBe(true)
})

it('본 화면은 앱에서 투어를 저절로 시작하지 않는다', async () => {
  renderAt('/inbox')
  await screen.findByRole('heading', { name: /독자 피드백함/ })
  expect(screen.queryByRole('dialog')).toBeNull()
})

it('앱에서는 처음 가는 화면의 투어가 저절로 시작하고, 끝내면 그 화면을 본 것으로 기억한다', async () => {
  toursOn()
  renderAt('/inbox')
  const tip = await screen.findByRole('dialog', { name: '독자 제보' })
  expect(tip.textContent).toContain('1 / 2')
  fireEvent.click(screen.getByRole('button', { name: '건너뛰기' }))
  await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
  expect(isTourSeen('inbox')).toBe(true)
})

/** 사용법 버튼으로 투어를 시작해 첫 단계의 제목과 단계 수(화면에 있는 대상만)를 확인한다. */
async function startTour(path: string, ready: () => Promise<unknown>) {
  render(<Provider store={createAppStore({ role: 'user' })}><MemoryRouter initialEntries={[path]}><App /></MemoryRouter></Provider>)
  await ready()
  // 화면의 데이터(소설 상세는 다음 회차 게시판까지)가 도착해야 버튼이 열린다.
  const button = screen.getByRole<HTMLButtonElement>('button', { name: '사용법' })
  await waitFor(() => expect(button.disabled).toBe(false))
  fireEvent.click(button)
  const tip = await screen.findByRole('dialog')
  return { title: tip.querySelector('h3')?.textContent, count: tip.querySelector('.tour-count')?.textContent }
}

// 지연 로딩 화면(소설 상세·독서)은 여러 테스트를 함께 돌리면 첫 import가 기본 1초를 넘을 수 있어 다른 통합 테스트처럼 5초를 기다린다.
it.each([
  ['Fork 생성', '/fork/guunmong', () => screen.findByRole('heading', { name: '「구운몽」 포크' }, { timeout: 5000 }), '어디서부터 바꿀까요?', '1 / 5'],
  // 사용법 버튼은 지금 탭(회차)의 투어를 연다: 정렬·검색 → 첫 회차 → 포크. (메뉴 소개인 화면 투어는 첫 진입에만 저절로 뜬다.)
  ['소설 상세(회차 탭)', '/work/postman', () => screen.findByRole('link', { name: '읽기 시작' }, { timeout: 5000 }), '회차 정렬·검색', '1 / 3'],
  // 데모 작품은 설정 위키 링크가 없어 그 단계가 빠진다(위쪽 막대 → 본문 → 회차 끝 포크).
  ['독서 화면', '/read/postman/1', () => screen.findByRole('heading', { name: '수취인 불명' }, { timeout: 5000 }), '보기 설정', '1 / 3'],
  ['작가 피드백함', '/inbox', () => screen.findByRole('heading', { name: /독자 피드백함/ }, { timeout: 5000 }), '독자 제보', '1 / 2'],
])('%s의 사용법 버튼은 이 화면의 첫 단계부터 투어를 시작한다', async (_name, path, ready, title, count) => {
  expect(await startTour(path, ready)).toEqual({ title, count })
})

/** 열려 있는 투어를 마지막 단계까지 넘기고 그 말풍선의 글을 돌려준다. */
async function lastStepText() {
  for (;;) {
    const [n, total] = (screen.getByRole('dialog').querySelector('.tour-count')?.textContent ?? '').split(' / ').map(Number)
    if (n === total) return screen.getByRole('dialog').textContent ?? ''
    fireEvent.click(screen.getByRole('button', { name: '다음' }))
    await waitFor(() => expect(screen.getByRole('dialog').querySelector('.tour-count')?.textContent).toBe(`${n + 1} / ${total}`))
  }
}

// 세계관이 연결되지 않은 작품은 포크 버튼이 잠긴다(서버 409 FORK_WORLD_REQUIRED): 포크를 안내하는 단계마다 그 조건을 한 문장으로 알린다.
it.each([
  ['Fork 생성', '/fork/guunmong', () => screen.findByRole('heading', { name: '「구운몽」 포크' }, { timeout: 5000 })],
  ['소설 상세', '/work/postman', () => screen.findByRole('link', { name: '읽기 시작' }, { timeout: 5000 })],
  ['독서 화면', '/read/postman/1', () => screen.findByRole('heading', { name: '수취인 불명' }, { timeout: 5000 })],
])('%s의 포크 단계는 세계관이 연결된 작품만 분기할 수 있다는 조건을 알린다(#971)', async (_name, path, ready) => {
  await startTour(path, ready)
  expect(await lastStepText()).toContain(FORK_WORLD_REQUIRED)
})

// 작가 피드백함은 두 목록(독자 제보·수정 제안)을 읽은 뒤에 시작한다: 데이터가 없을 때 시작하면 카드 처리 단계가 빠지고, 읽기에 실패한 화면에서는 시작하지 않는다.
it('작가 피드백함은 제보 응답 전에는 투어를 시작하지 않고, 응답 뒤 시작해 카드 처리 단계가 들어간다', async () => {
  toursOn()
  let answer!: (rows: FeedbackReport[]) => void
  stubInbox(new Promise<FeedbackReport[]>((resolve) => { answer = resolve }), [suggestion])
  renderAt('/inbox')
  await screen.findByRole('heading', { name: /독자 피드백함/ })
  await act(async () => { await new Promise((r) => setTimeout(r, 80)) })
  expect(screen.queryByRole('dialog')).toBeNull()
  expect(screen.getByRole<HTMLButtonElement>('button', { name: '사용법' }).disabled).toBe(true)
  await act(async () => { answer([report()]) })
  const tip = await screen.findByRole('dialog', { name: '독자 제보' })
  // 제보 → 제보 처리(카드) → 수정 제안 → 제안 승인(카드)
  expect(tip.querySelector('.tour-count')?.textContent).toBe('1 / 4')
})

it('작가 피드백함은 제보 읽기에 실패하면 투어를 시작하지 않는다', async () => {
  toursOn()
  vi.spyOn(appContainer.resolve('feedbackReportUseCase'), 'listInbox').mockRejectedValue(new Error('offline'))
  renderAt('/inbox')
  await screen.findByText('독자 제보를 불러오지 못했어요. 연결 상태를 확인한 뒤 다시 시도해 주세요.')
  await act(async () => { await new Promise((r) => setTimeout(r, 80)) })
  expect(screen.queryByRole('dialog')).toBeNull()
})

it('소설 상세는 처음 열면 화면 투어 → 지금 탭(회차)의 투어 순서로 뜨고, 다른 탭을 처음 열면 그 탭의 투어가 한 번 뜬다(#971)', async () => {
  toursOn()
  renderAt('/work/postman')
  const intro = await screen.findByRole('dialog', { name: '읽기 시작' })
  expect(intro.querySelector('.tour-count')?.textContent).toBe('1 / 2')
  fireEvent.click(screen.getByRole('button', { name: '건너뛰기' }))
  const eps = await screen.findByRole('dialog', { name: '회차 정렬·검색' })
  expect(eps.querySelector('.tour-count')?.textContent).toBe('1 / 3')
  fireEvent.click(screen.getByRole('button', { name: '건너뛰기' }))
  await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
  expect(isTourSeen('work')).toBe(true)
  expect(isTourSeen('work', 'eps')).toBe(true)
  fireEvent.click(screen.getByRole('tab', { name: '정보' }))
  const info = await screen.findByRole('dialog', { name: '작품 소개' })
  expect(info.querySelector('.tour-count')?.textContent).toMatch(/^1 \/ \d$/)
  fireEvent.click(screen.getByRole('button', { name: '건너뛰기' }))
  await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
  fireEvent.click(screen.getByRole('tab', { name: '회차' }))
  await act(async () => { await new Promise((r) => setTimeout(r, 80)) })
  expect(screen.queryByRole('dialog')).toBeNull() // 본 탭은 다시 뜨지 않는다
})

it('작품 관리는 앱에서 처음 열면 메뉴 소개(6단계)가 저절로 뜨고 이야기 분기 단계가 세계관 조건을 알리며, 끝내면 개요 탭 투어가 이어진다(#971)', async () => {
  toursOn()
  const owned = { id: 'w', title: '옛 제목', summary: '옛 소개', visibility: 'private', allowFork: false, allowForkPublication: false, revision: 0, source: null, episodes: [], draft: { title: '회차', body: '초안', revision: 0 }, creationType: 'ORIGINAL', genres: ['판타지'], hashtags: [] }
  // 작품 관리는 Content 서버를 읽는다: 내 작품 목록만 주고 나머지(표지 없음·빈 회차)는 비어 있는 서버를 흉내 낸다.
  vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const path = String(input)
    if (path.endsWith('/csrf')) return Response.json({ csrfToken: 'csrf' })
    if (path.includes('/auth/')) return Response.json({ accessToken: 'bearer', user: { id: 'writer', email: 'writer@example.invalid', nickname: 'Writer', operator: false } })
    if ((init?.method ?? 'GET') === 'GET' && path === '/api/v1/works') return Response.json([owned])
    if (/\/episodes$/.test(path)) return Response.json([])
    return new Response(null, { status: 404 })
  }))
  try {
    await login('writer@example.invalid', 'test-password') // Content 서버는 로그인한 요청만 받는다
    // 실제 앱처럼 StrictMode로 그린다: 자동 시작 effect가 곧바로 두 번 돌아도 메뉴 소개가 탭 투어에 덮이지 않아야 한다.
    render(<StrictMode><Provider store={createAppStore({ role: 'user' })}><MemoryRouter initialEntries={['/content?work=w']}><App /></MemoryRouter></Provider></StrictMode>)
    const intro = await screen.findByRole('dialog', { name: '개요' }, { timeout: 5000 })
    expect(intro.querySelector('.tour-count')?.textContent).toBe('1 / 6')
    for (let step = 2; step <= 4; step++) {
      fireEvent.click(screen.getByRole('button', { name: '다음' }))
      await waitFor(() => expect(screen.getByRole('dialog').querySelector('.tour-count')?.textContent).toBe(`${step} / 6`))
    }
    expect(screen.getByRole('dialog').textContent).toContain(FORK_WORLD_REQUIRED) // 4단계: 이야기 분기
    fireEvent.click(screen.getByRole('button', { name: '건너뛰기' }))
    const tab = await screen.findByRole('dialog', { name: '작품 정보 편집' })
    expect(tab.querySelector('.tour-count')?.textContent).toBe('1 / 3')
    expect(isTourSeen('manage')).toBe(true)
  } finally { vi.unstubAllGlobals(); forgetSession() }
}, 20000)

it('독서 화면의 문장 단계는 서버 작품에서만 수정 제안도 안내하고 데모 작품에는 약속하지 않는다', async () => {
  let wiki = ''
  const sentenceStep = async (canonical: boolean) => {
    const work = appContainer.resolve('mockDb').works.find((w) => w.id === 'postman')!
    if (canonical) {
      work.canonical = true
      // 정본 열람은 서버 회차 댓글을 읽으므로 서버 호출만 비운다.
      vi.spyOn(appContainer.resolve('episodeCommentRepository'), 'list').mockResolvedValue([])
    }
    try {
      renderAt('/read/postman/1')
      await screen.findByRole('heading', { name: '수취인 불명' })
      fireEvent.click(screen.getByRole('button', { name: '사용법' }))
      await screen.findByRole('dialog', { name: '보기 설정' })
      // 보기 설정 → (서버 작품만 설정 위키) → 문장 누르기
      for (const title of canonical ? ['설정 위키', '문장 누르기'] : ['문장 누르기']) {
        fireEvent.click(screen.getByRole('button', { name: '다음' }))
        const tip = await screen.findByRole('dialog', { name: title })
        if (title === '설정 위키') wiki = tip.textContent ?? ''
      }
      return screen.getByRole('dialog').textContent ?? ''
    } finally { cleanup(); delete work.canonical }
  }
  expect(await sentenceStep(true)).toContain('수정 제안')
  expect(wiki).toContain('이 회차까지 공개된 세계관 설정만')
  expect(wiki).toContain('스포일러 없이')
  expect(await sentenceStep(false)).not.toContain('수정 제안')
})
