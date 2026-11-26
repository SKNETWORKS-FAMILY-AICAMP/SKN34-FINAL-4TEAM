// @vitest-environment jsdom
import '../fixtureApp'

import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { Provider } from 'react-redux'
import { MemoryRouter } from 'react-router'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'

import '../scrollToSpy'
import App from '../../App'
import { appContainer } from '../../app/appContainer'
import { createAppStore } from '../../app/store'
import type { EditSuggestion } from '../../domain/entities/editSuggestion'
import type { FeedbackReport } from '../../domain/entities/feedbackReport'
import { isTourSeen, markTourSeen, tourKey, tourScreens } from '../../presentation/shared/tour/tourPrefs'

// fixtureApp은 앱 전체를 그리는 테스트가 투어에 가려지지 않게 아홉 화면을 모두 본 것으로 시작한다. 이 파일은 그 값을 하나씩 되돌려 앱의 자동 시작을 검사한다.
afterEach(() => { cleanup(); vi.restoreAllMocks(); markTourSeen('inbox') })

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

it('fixtureApp은 투어가 있는 아홉 화면을 모두 본 것으로 시작한다', () => {
  expect(tourScreens.every(isTourSeen)).toBe(true)
})

it('본 화면은 앱에서 투어를 저절로 시작하지 않는다', async () => {
  renderAt('/inbox')
  await screen.findByRole('heading', { name: /독자 피드백함/ })
  expect(screen.queryByRole('dialog')).toBeNull()
})

it('앱에서는 처음 가는 화면의 투어가 저절로 시작하고, 끝내면 그 화면을 본 것으로 기억한다', async () => {
  localStorage.removeItem(tourKey('inbox'))
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

it.each([
  ['Fork 생성', '/fork/guunmong', () => screen.findByRole('heading', { name: '「구운몽」 포크' }), '어디서부터 바꿀까요?', '1 / 5'],
  // 데모 작품은 AI 자율 연재 탭이 없어 '다음 회차' 단계가 빠진다.
  ['소설 상세', '/work/postman', () => screen.findByRole('link', { name: '읽기 시작' }), '읽기 시작', '1 / 4'],
  // 데모 작품은 설정 위키 링크가 없어 그 단계가 빠진다(위쪽 막대 → 본문 → 회차 끝 포크).
  ['독서 화면', '/read/postman/1', () => screen.findByRole('heading', { name: '수취인 불명' }), '보기 설정', '1 / 3'],
  ['작가 피드백함', '/inbox', () => screen.findByRole('heading', { name: /독자 피드백함/ }), '독자 제보', '1 / 2'],
])('%s의 사용법 버튼은 이 화면의 첫 단계부터 투어를 시작한다', async (_name, path, ready, title, count) => {
  expect(await startTour(path, ready)).toEqual({ title, count })
})

// 작가 피드백함은 두 목록(독자 제보·수정 제안)을 읽은 뒤에 시작한다: 데이터가 없을 때 시작하면 카드 처리 단계가 빠지고, 읽기에 실패한 화면에서는 시작하지 않는다.
it('작가 피드백함은 제보 응답 전에는 투어를 시작하지 않고, 응답 뒤 시작해 카드 처리 단계가 들어간다', async () => {
  localStorage.removeItem(tourKey('inbox'))
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
  localStorage.removeItem(tourKey('inbox'))
  vi.spyOn(appContainer.resolve('feedbackReportUseCase'), 'listInbox').mockRejectedValue(new Error('offline'))
  renderAt('/inbox')
  await screen.findByText('독자 제보를 불러오지 못했어요. 연결 상태를 확인한 뒤 다시 시도해 주세요.')
  await act(async () => { await new Promise((r) => setTimeout(r, 80)) })
  expect(screen.queryByRole('dialog')).toBeNull()
})

it('독서 화면의 문장 단계는 서버 작품에서만 수정 제안도 안내하고 데모 작품에는 약속하지 않는다', async () => {
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
        await screen.findByRole('dialog', { name: title })
      }
      return screen.getByRole('dialog').textContent ?? ''
    } finally { cleanup(); delete work.canonical }
  }
  expect(await sentenceStep(true)).toContain('수정 제안')
  expect(await sentenceStep(false)).not.toContain('수정 제안')
})
