// @vitest-environment jsdom
import '../fixtureApp'

import { cleanup, fireEvent, screen, waitFor, within } from '@testing-library/react'
import { asValue } from 'awilix/browser'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { appContainer } from '../../app/appContainer'
import { createAppStore } from '../../app/store'
import type { FeedbackReport } from '../../domain/entities/feedbackReport'
import type { FeedbackReportRepository } from '../../domain/repositories/FeedbackReportRepository'
import { FeedbackReportUseCase } from '../../domain/usecases/FeedbackReportUseCase'
import { FeedbackUseCase } from '../../domain/usecases/FeedbackUseCase'
import { renderApp } from '../renderApp'

const user = () => createAppStore({ role: 'user' })
const toastIs = (t: string | RegExp) => waitFor(() => expect(document.getElementById('toast')!.textContent).toMatch(t))
const card = (id: string) => within(document.querySelector<HTMLElement>(`[data-report="${id}"]`)!)

const report = (extra: Partial<FeedbackReport> = {}): FeedbackReport => ({
  id: 'r1', workId: 'guunmong', workTitle: '구운몽', episodeNumber: 2, publishedVersionId: 'v2', kind: 'typo', body: '오탈자가 있어요', quote: null, visibility: 'private',
  status: 'unchecked', reporterName: '독자A', mine: false, owner: false, authorChecked: false, withdrawn: false, amendments: [], responses: [],
  createdAt: '2026-11-10T01:00:00Z', updatedAt: '2026-11-10T01:00:00Z', ...extra,
})

/** 서버 대신 메모리로 답하는 제보 저장소: 서버의 상태 전이를 간단히 따라 하고 호출은 vi.fn에 남긴다(HTTP 계약은 HttpFeedbackReportRepository 테스트가 확인). */
function memoryReports(seed: FeedbackReport[]) {
  const rows = [...seed]
  const find = (id: string) => rows.find((r) => r.id === id)!
  const at = () => '2026-11-10T03:00:00Z'
  return {
    create: vi.fn(async (workId: string, n: number, input: { kind: FeedbackReport['kind']; body: string; quote?: string; visibility: FeedbackReport['visibility'] }) => {
      const made = report({ id: `new${rows.length}`, workId, episodeNumber: n, kind: input.kind, body: input.body, quote: input.quote ?? null, visibility: input.visibility, mine: true, reporterName: '나' })
      rows.unshift(made)
      return { ...made }
    }),
    listEpisode: vi.fn(async (workId: string, n: number) => rows.filter((r) => r.workId === workId && r.episodeNumber === n && (r.visibility === 'public' || r.mine || r.owner || r.body === null)).map((r) => ({ ...r }))),
    listMine: vi.fn(async () => rows.filter((r) => r.mine).map((r) => ({ ...r }))),
    listInbox: vi.fn(async () => rows.filter((r) => r.owner).map((r) => ({ ...r }))),
    setVisibility: vi.fn(async (_w: string, id: string, visibility: FeedbackReport['visibility']) => ({ ...Object.assign(find(id), { visibility }) })),
    correct: vi.fn(async (_w: string, id: string, body: string) => { const r = find(id); r.amendments.push({ action: 'correct', body, createdAt: at() }); return { ...r } }),
    withdraw: vi.fn(async (_w: string, id: string) => { const r = find(id); r.withdrawn = true; r.amendments.push({ action: 'withdraw', body: null, createdAt: at() }); return { ...r } }),
    check: vi.fn(async (_w: string, id: string) => { const r = find(id); r.authorChecked = true; if (r.status === 'unchecked') r.status = 'checked'; return { ...r } }),
    answer: vi.fn(async (_w: string, id: string, input: { body: string; isPublic: boolean }) => {
      const r = find(id)
      r.responses.push({ id: `p${r.responses.length}`, authorName: '작가', body: input.body, isPublic: input.isPublic, createdAt: at() })
      if (r.status === 'unchecked' || r.status === 'checked') r.status = 'answered'
      return { ...r }
    }),
    setStatus: vi.fn(async (_w: string, id: string, status: FeedbackReport['status']) => ({ ...Object.assign(find(id), { status }) })),
  } satisfies FeedbackReportRepository
}

describe('실제 작품 제보 화면 (기능 23)', () => {
  const works = appContainer.resolve('mockDb').works
  const originalReport = appContainer.resolve('feedbackReportUseCase')
  const originalFeedback = appContainer.resolve('feedbackUseCase')
  /** 제보 저장소 대역을 연결한다(제보 UseCase와, 정본 분기를 가진 FeedbackUseCase를 함께 바꾼다). */
  const connect = (seed: FeedbackReport[], tweak: (repo: ReturnType<typeof memoryReports>) => void = () => {}) => {
    const repo = memoryReports(seed)
    tweak(repo)
    const reports = new FeedbackReportUseCase(repo)
    const { workRepository, feedbackRepository, adminRepository } = appContainer.cradle
    appContainer.register({ feedbackReportUseCase: asValue(reports), feedbackUseCase: asValue(new FeedbackUseCase(workRepository, feedbackRepository, adminRepository, reports)) })
    return repo
  }
  beforeEach(() => { for (const work of works) work.canonical = true })
  afterEach(() => {
    cleanup()
    vi.restoreAllMocks()
    appContainer.register({ feedbackReportUseCase: asValue(originalReport), feedbackUseCase: asValue(originalFeedback) })
    for (const work of works) delete work.canonical
  })

  /** 정본 회차에서 첫 문장을 눌러 피드백 시트를 연다. 고른 문장 글자를 돌려준다. */
  async function openFeedbackSheet() {
    renderApp('/read/guunmong/2', user())
    await screen.findByRole('heading', { name: '돌다리 위의 팔선녀' })
    const first = document.querySelector<HTMLElement>('#text [data-s]')!
    fireEvent.click(first)
    fireEvent.click(within(screen.getByRole('dialog', { name: '문장 작업' })).getByRole('button', { name: '✉ 피드백 보내기' }))
    await screen.findByLabelText('피드백 유형')
    return first.textContent!
  }

  describe('회차 열람', () => {
    it('피드백 시트는 유형·내용·공개 범위를 제보 API로 보내고 실제 상태만 안내하며 회차 제보 목록을 다시 읽는다', async () => {
      const repo = connect([])
      const quote = await openFeedbackSheet()
      await screen.findByText('아직 공개된 제보가 없어요.')
      const sheet = within(screen.getByLabelText('피드백 유형').closest('[role=dialog]') as HTMLElement)
      // 정본 시트: 기본 비공개, 입력 한도는 서버 계약(500자), AI 시뮬레이션·자동 응답 문구가 없다.
      expect(sheet.getByLabelText<HTMLSelectElement>('공개 범위').value).toBe('private')
      expect(sheet.getByLabelText<HTMLTextAreaElement>('내용').maxLength).toBe(500)
      expect(sheet.queryByText(/AI|시뮬레이션|데모/)).toBeNull()
      fireEvent.change(sheet.getByLabelText('피드백 유형'), { target: { value: '스토리 오류' } })
      expect(sheet.queryByText(/시뮬레이션/)).toBeNull()
      fireEvent.change(sheet.getByLabelText('내용'), { target: { value: '  앞 장면과 시간이 안 맞아요  ' } })
      fireEvent.change(sheet.getByLabelText('공개 범위'), { target: { value: 'public' } })
      fireEvent.click(sheet.getByRole('button', { name: '피드백 보내기' }))

      await sheet.findByText('제보를 등록했어요. 작가가 확인하면 상태가 바뀌어요. 공개 제보라 회차 하단에서 다른 독자도 볼 수 있어요.', { exact: false })
      expect(repo.create).toHaveBeenCalledWith('guunmong', 2, { kind: 'story', body: '앞 장면과 시간이 안 맞아요', quote, visibility: 'public' })
      expect(sheet.getByText('작가 확인 전')).toBeTruthy()
      // 방금 보낸 공개 제보가 회차 하단 목록에 서버 값으로 나타난다.
      await screen.findByRole('heading', { name: '제보 1' })
      const row = document.querySelector<HTMLElement>('[data-report="new0"]')!
      expect(row.textContent).toContain('앞 장면과 시간이 안 맞아요')
      expect(row.textContent).toContain('스토리 오류')
      expect(repo.listEpisode.mock.calls.length).toBeGreaterThan(1)
    })

    it('내용이 비어 있으면 서버에 보내지 않고, 서버가 거절하면 안내를 보이며 입력과 시트를 그대로 둔다', async () => {
      const repo = connect([], (r) => r.create.mockRejectedValueOnce(new Error('공개 작품을 찾을 수 없어요.')))
      await openFeedbackSheet()
      fireEvent.click(screen.getByRole('button', { name: '피드백 보내기' }))
      await toastIs('내용을 입력해 주세요')
      expect(repo.create).not.toHaveBeenCalled()
      const text = screen.getByLabelText<HTMLTextAreaElement>('내용')
      fireEvent.change(text, { target: { value: '보내려던 제보' } })
      fireEvent.click(screen.getByRole('button', { name: '피드백 보내기' }))
      await toastIs('공개 작품을 찾을 수 없어요.')
      expect(text.value).toBe('보내려던 제보')
      expect(screen.queryByText('작가 확인 전')).toBeNull()
      expect(screen.getByRole<HTMLButtonElement>('button', { name: '피드백 보내기' }).disabled).toBe(false)
    })

    it('회차 하단은 공개 제보와 원문이 숨겨진 제보(작가의 공개 답변만), 철회·정정 표시를 읽기 전용으로 보여 준다', async () => {
      connect([
        report({ id: 'open', visibility: 'public', body: '공개 제보 본문', quote: '인용 문장', kind: 'story', status: 'resolved', amendments: [{ action: 'correct', body: '정정 내용이에요', createdAt: '2026-11-10T02:00:00Z' }] }),
        report({ id: 'hidden', body: null, quote: null, reporterName: null, status: 'answered', responses: [{ id: 'p', authorName: '작가', body: '의도한 복선이에요', isPublic: true, createdAt: '2026-11-10T02:00:00Z' }] }),
        report({ id: 'gone', visibility: 'public', body: '철회한 제보', withdrawn: true, amendments: [{ action: 'withdraw', body: null, createdAt: '2026-11-10T02:30:00Z' }] }),
      ])
      renderApp('/read/guunmong/2', user())
      await screen.findByRole('heading', { name: '제보 3' })
      expect(card('open').getByText('공개 제보 본문')).toBeTruthy()
      expect(card('open').getByText('인용 문장').tagName).toBe('Q')
      expect(card('open').getByText('처리 완료')).toBeTruthy()
      expect(card('open').getByText(/정정 내용이에요/)).toBeTruthy()
      expect(card('hidden').getByText(/내용은 보이지 않고/)).toBeTruthy()
      expect(card('hidden').getByText('의도한 복선이에요')).toBeTruthy()
      expect(card('hidden').queryByText('오탈자가 있어요')).toBeNull()
      expect(card('gone').getByText('철회됨', { selector: '.chip' })).toBeTruthy()
      // 읽기 전용이다. 정정·철회 같은 동작은 내 서재에서 한다.
      expect(document.querySelector('[data-report] button')).toBeNull()
    })

    it('목록을 못 불러오면 안내하고 다시 불러올 수 있다', async () => {
      const repo = connect([report({ id: 'open', visibility: 'public' })], (r) => r.listEpisode.mockRejectedValue(new Error('network')))
      renderApp('/read/guunmong/2', user())
      const alert = await screen.findByText('제보를 불러오지 못했어요. 연결 상태를 확인한 뒤 다시 시도해 주세요.')
      const rows = [report({ id: 'open', visibility: 'public' })]
      repo.listEpisode.mockResolvedValue(rows)
      fireEvent.click(within(alert.closest('[role=alert]') as HTMLElement).getByRole('button', { name: '다시 불러오기' }))
      await screen.findByRole('heading', { name: '제보 1' })
      expect(screen.queryByText('제보를 불러오지 못했어요. 연결 상태를 확인한 뒤 다시 시도해 주세요.')).toBeNull()
    })
  })

  describe('내 서재 · 내 제보', () => {
    const mine = () => [
      report({ id: 'a', mine: true, visibility: 'private', reporterName: '나', body: '내 비공개 제보', status: 'answered', responses: [{ id: 'p', authorName: '작가', body: '비공개 답변이에요', isPublic: false, createdAt: '2026-11-10T02:00:00Z' }] }),
      report({ id: 'b', mine: true, visibility: 'public', reporterName: '나', body: '내 공개 제보', episodeNumber: 3, createdAt: '2026-11-10T00:00:00Z' }),
    ]

    it('실제 제보 목록을 상태·작가 답변과 함께 보이고 공개 범위를 서버 값으로 바꾼다', async () => {
      const repo = connect(mine())
      renderApp('/lib?tab=qa', user())
      await screen.findByRole('heading', { name: '내 제보 2' })
      expect(card('a').getByText('답변함')).toBeTruthy()
      expect(card('a').getByText(/비공개 답변이에요/)).toBeTruthy()
      expect(card('a').getByText(/· 비공개 답변/)).toBeTruthy()
      fireEvent.click(card('a').getByRole('button', { name: /공개로 바꾸기/ }))
      await toastIs('공개 제보로 바꿨어요')
      expect(repo.setVisibility).toHaveBeenCalledWith('guunmong', 'a', 'public')
      await waitFor(() => expect(card('a').getByRole('button', { name: /비공개로 바꾸기/ })).toBeTruthy())
      expect(screen.getByText('작가가 처리하면 상태가 바뀌어요.')).toBeTruthy()
    })

    it('정정은 원문을 두고 덧붙이며 서버가 거절하면 입력을 남기고, 철회하면 정정·철회 버튼이 사라지고 공개 범위만 바꿀 수 있다', async () => {
      const repo = connect(mine(), (r) => r.correct.mockRejectedValueOnce(new Error('철회한 제보는 정정할 수 없어요.')))
      renderApp('/lib?tab=qa', user())
      await screen.findByRole('heading', { name: '내 제보 2' })
      fireEvent.click(card('b').getByText('정정하기'))
      const input = card('b').getByLabelText<HTMLTextAreaElement>(/정정 내용 ·/)
      expect(input.maxLength).toBe(500)
      fireEvent.change(input, { target: { value: '  정정할 내용이에요  ' } })
      fireEvent.click(card('b').getByRole('button', { name: '정정 남기기' }))
      await toastIs('철회한 제보는 정정할 수 없어요.')
      expect(input.value).toBe('  정정할 내용이에요  ')
      fireEvent.click(card('b').getByRole('button', { name: '정정 남기기' }))
      await toastIs('정정을 남겼어요')
      expect(repo.correct).toHaveBeenLastCalledWith('guunmong', 'b', '정정할 내용이에요')
      await waitFor(() => expect(card('b').getByText(/정정할 내용이에요/, { selector: '.a span' })).toBeTruthy())
      expect(card('b').getByText('내 공개 제보')).toBeTruthy()
      expect(input.value).toBe('')

      const confirm = vi.spyOn(window, 'confirm').mockReturnValueOnce(false).mockReturnValueOnce(true)
      fireEvent.click(card('b').getByRole('button', { name: /철회/ }))
      expect(repo.withdraw).not.toHaveBeenCalled()
      fireEvent.click(card('b').getByRole('button', { name: /철회/ }))
      await toastIs('제보를 철회했어요')
      expect(confirm).toHaveBeenCalledTimes(2)
      expect(repo.withdraw).toHaveBeenCalledWith('guunmong', 'b')
      await waitFor(() => expect(card('b').getByText('철회됨', { selector: '.chip' })).toBeTruthy())
      expect(card('b').queryByRole('button', { name: /철회 ·/ })).toBeNull()
      expect(card('b').queryByText('정정하기')).toBeNull()
      expect(card('b').getByText('내 공개 제보')).toBeTruthy()
      expect(card('b').getByRole('button', { name: /비공개로 바꾸기/ })).toBeTruthy()
    })

    it('제보가 없으면 안내하고, 불러오지 못하면 다시 불러오기를 보인다', async () => {
      const repo = connect([], (r) => r.listMine.mockRejectedValue(new Error('network')))
      renderApp('/lib?tab=qa', user())
      const retry = await screen.findByRole('button', { name: '다시 불러오기' })
      repo.listMine.mockResolvedValue([])
      fireEvent.click(retry)
      await screen.findByText(/남긴 제보가 없어요/)
    })
  })

  describe('작가 피드백함', () => {
    const owned = () => [
      report({ id: 'n1', owner: true, reporterName: '독자A', body: '새 제보', quote: '고른 문장' }),
      report({ id: 'n2', owner: true, reporterName: '독자B', body: '철회될 제보', visibility: 'public', withdrawn: true, status: 'answered',
        amendments: [{ action: 'correct', body: '정정 먼저', createdAt: '2026-11-10T02:00:00Z' }, { action: 'withdraw', body: null, createdAt: '2026-11-10T02:30:00Z' }] }),
    ]

    it('실제 제보를 제보자·인용·철회·정정 표시와 함께 보이고 확인·공개 답변·상태 변경을 서버로 보낸다', async () => {
      const repo = connect(owned())
      renderApp('/inbox', user())
      await screen.findByRole('heading', { name: '독자 제보 2' })
      expect(card('n1').getByText(/독자A/)).toBeTruthy()
      expect(card('n1').getByText('고른 문장').tagName).toBe('Q')
      expect(card('n2').getByText('철회됨', { selector: '.chip' })).toBeTruthy()
      expect(card('n2').getByText(/정정 먼저/)).toBeTruthy()
      // 데모 피드백이 없으면 목록이 비었다는 안내가 실제 제보와 모순되지 않는다.
      expect(screen.queryByText('제보가 없어요.')).toBeNull()

      fireEvent.click(card('n1').getByRole('button', { name: /확인했어요/ }))
      await toastIs('확인했어요')
      expect(repo.check).toHaveBeenCalledWith('guunmong', 'n1')
      await waitFor(() => expect(card('n1').queryByRole('button', { name: /확인했어요/ })).toBeNull())
      expect(card('n1').getByText('확인함', { selector: '.chip' })).toBeTruthy()

      const answer = card('n1').getByLabelText<HTMLTextAreaElement>(/작가 답변 ·/)
      expect(answer.maxLength).toBe(2000)
      fireEvent.click(card('n1').getByRole('button', { name: '답변 보내기' }))
      await toastIs('답변 내용을 입력해 주세요.')
      expect(repo.answer).not.toHaveBeenCalled()
      fireEvent.change(answer, { target: { value: '  의도한 복선이에요  ' } })
      fireEvent.click(card('n1').getByLabelText(/공개 답변/))
      fireEvent.click(card('n1').getByRole('button', { name: '답변 보내기' }))
      await toastIs('공개 답변을 남겼어요')
      expect(repo.answer).toHaveBeenCalledWith('guunmong', 'n1', { body: '의도한 복선이에요', isPublic: true })
      await waitFor(() => expect(card('n1').getByText('답변함', { selector: '.chip' })).toBeTruthy())
      expect(card('n1').getByText('의도한 복선이에요')).toBeTruthy()
      expect(answer.value).toBe('')

      const select = card('n1').getByLabelText<HTMLSelectElement>(/처리 상태 ·/)
      expect(select.value).toBe('answered')
      expect(within(select).getByRole('option', { name: '작가 확인 전' }).hasAttribute('disabled')).toBe(true)
      fireEvent.change(select, { target: { value: 'resolved' } })
      await toastIs('처리 상태를 바꿨어요 · 처리 완료')
      expect(repo.setStatus).toHaveBeenCalledWith('guunmong', 'n1', 'resolved')
      await waitFor(() => expect(card('n1').getByText('처리 완료', { selector: '.chip' })).toBeTruthy())
    })

    it('서버가 거절하면 안내만 하고 상태 선택은 서버 값으로 남는다', async () => {
      const repo = connect(owned(), (r) => r.setStatus.mockRejectedValueOnce(new Error('작품 소유자만 할 수 있어요.')))
      renderApp('/inbox', user())
      await screen.findByRole('heading', { name: '독자 제보 2' })
      const select = card('n1').getByLabelText<HTMLSelectElement>(/처리 상태 ·/)
      fireEvent.change(select, { target: { value: 'closed' } })
      await toastIs('작품 소유자만 할 수 있어요.')
      expect(repo.setStatus).toHaveBeenCalledTimes(1)
      expect(select.value).toBe('unchecked')
    })

    it('접수된 제보가 없으면 안내하고 불러오지 못하면 다시 불러오기를 보인다', async () => {
      const repo = connect([], (r) => r.listInbox.mockRejectedValue(new Error('network')))
      renderApp('/inbox', user())
      const retry = await screen.findByRole('button', { name: '다시 불러오기' })
      repo.listInbox.mockResolvedValue([])
      fireEvent.click(retry)
      await screen.findByText('접수된 독자 제보가 없어요.')
    })
  })
})
