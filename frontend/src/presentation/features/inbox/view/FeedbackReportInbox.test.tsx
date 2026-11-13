// @vitest-environment jsdom
import '../../../../test/fixtureApp'
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { Provider } from 'react-redux'
import { MemoryRouter } from 'react-router'
import { afterEach, expect, it, vi } from 'vitest'

import { appContainer } from '../../../../app/appContainer'
import { createAppStore } from '../../../../app/store'
import type { FeedbackReport } from '../../../../domain/entities/feedbackReport'
import { FeedbackReportInbox } from './FeedbackReportInbox'

afterEach(() => { cleanup(); vi.restoreAllMocks() })

const report = (extra: Partial<FeedbackReport> = {}): FeedbackReport => ({
  id: 'r1', workId: 'guunmong', workTitle: '구운몽', episodeNumber: 2, publishedVersionId: 'v2', kind: 'typo', body: '오탈자가 있어요', quote: null, visibility: 'private',
  status: 'unchecked', reporterName: '독자A', mine: false, owner: true, authorChecked: false, withdrawn: false, amendments: [], responses: [],
  createdAt: '2026-11-10T01:00:00Z', updatedAt: '2026-11-10T01:00:00Z', ...extra,
})
const reports = () => appContainer.resolve('feedbackReportUseCase')
const card = (id: string) => within(document.querySelector<HTMLElement>(`[data-report="${id}"]`)!)
const open = () => render(<Provider store={createAppStore({ role: 'user' })}><MemoryRouter><FeedbackReportInbox /></MemoryRouter></Provider>)

it('처리에 실패하면 서버 문구를 토스트뿐 아니라 그 제보 카드 안의 경고로 남긴다', async () => {
  vi.spyOn(reports(), 'listInbox').mockResolvedValue([report(), report({ id: 'r2', reporterName: '독자B' })])
  vi.spyOn(reports(), 'check').mockRejectedValue(new Error('작품 소유자만 할 수 있어요.'))
  open()
  await screen.findByRole('heading', { name: '독자 제보 2' })
  fireEvent.click(card('r1').getByRole('button', { name: /확인했어요/ }))
  expect((await card('r1').findByRole('alert')).textContent).toBe('작품 소유자만 할 수 있어요.')
  expect(card('r2').queryByRole('alert')).toBeNull()
  expect(card('r2').queryByRole('status')).toBeNull()
})

it('처리에 성공하면 결과를 그 제보 카드 안의 상태로 남긴다', async () => {
  let rows = [report()]
  vi.spyOn(reports(), 'listInbox').mockImplementation(async () => rows)
  vi.spyOn(reports(), 'check').mockImplementation(async () => { rows = [report({ status: 'checked', authorChecked: true })]; return rows[0] })
  open()
  await screen.findByRole('heading', { name: '독자 제보 1' })
  fireEvent.click(card('r1').getByRole('button', { name: /확인했어요/ }))
  expect((await card('r1').findByRole('status')).textContent).toBe('확인했어요')
  await card('r1').findByText('확인함', { selector: '.chip' })
})

it('답변하기는 누르기 쉬운 높이를 주는 전용 클래스를 쓴다', async () => {
  vi.spyOn(reports(), 'listInbox').mockResolvedValue([report()])
  open()
  await screen.findByRole('heading', { name: '독자 제보 1' })
  expect(card('r1').getByText('답변하기').closest('details')!.className).toBe('report-answer')
})
