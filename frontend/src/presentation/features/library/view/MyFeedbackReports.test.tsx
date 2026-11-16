// @vitest-environment jsdom
import '../../../../test/fixtureApp'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { Provider } from 'react-redux'
import { MemoryRouter } from 'react-router'
import { afterEach, expect, it, vi } from 'vitest'

import { appContainer } from '../../../../app/appContainer'
import { createAppStore } from '../../../../app/store'
import type { FeedbackReport } from '../../../../domain/entities/feedbackReport'
import { MyFeedbackReports } from './MyFeedbackReports'

afterEach(() => { cleanup(); vi.restoreAllMocks() })

const report = (extra: Partial<FeedbackReport> = {}): FeedbackReport => ({
  id: 'r1', workId: 'guunmong', workTitle: '구운몽', episodeNumber: 2, publishedVersionId: 'v2', kind: 'typo', body: '오탈자가 있어요', quote: null, visibility: 'public',
  status: 'unchecked', reporterName: '나', mine: true, owner: false, authorChecked: false, withdrawn: false, amendments: [], responses: [],
  createdAt: '2026-11-10T01:00:00Z', updatedAt: '2026-11-10T01:00:00Z', ...extra,
})
const reports = () => appContainer.resolve('feedbackReportUseCase')
const cardEl = (id: string) => document.querySelector<HTMLElement>(`[data-report="${id}"]`)!
const card = (id: string) => within(cardEl(id))
const open = () => render(<Provider store={createAppStore({ role: 'user' })}><MemoryRouter><MyFeedbackReports /></MemoryRouter></Provider>)

it('처리에 실패하면 서버 문구를 사라지는 토스트뿐 아니라 그 제보 카드 안의 경고로 남기고 입력은 그대로 둔다', async () => {
  vi.spyOn(reports(), 'listMine').mockResolvedValue([report(), report({ id: 'r2', episodeNumber: 3 })])
  vi.spyOn(reports(), 'correct').mockRejectedValue(new Error('철회한 제보는 정정할 수 없어요.'))
  open()
  await screen.findByRole('heading', { name: '내 제보 2' })
  fireEvent.click(card('r1').getByText('정정하기'))
  const input = card('r1').getByLabelText<HTMLTextAreaElement>(/정정 내용 ·/)
  fireEvent.change(input, { target: { value: '정정할 내용이에요' } })
  fireEvent.click(card('r1').getByRole('button', { name: /정정 남기기/ }))
  expect((await card('r1').findByRole('alert')).textContent).toBe('철회한 제보는 정정할 수 없어요.')
  expect(input.value).toBe('정정할 내용이에요')
  // 다른 제보 카드에는 남기지 않는다.
  expect(card('r2').queryByRole('alert')).toBeNull()
  expect(card('r2').queryByRole('status')).toBeNull()
})

it('처리에 성공하면 결과를 그 제보 카드 안의 상태로 남기고 키보드 위치도 그 카드에 둔다', async () => {
  let rows = [report(), report({ id: 'r2', episodeNumber: 3 })]
  vi.spyOn(reports(), 'listMine').mockImplementation(async () => rows)
  vi.spyOn(reports(), 'setVisibility').mockImplementation(async (r, visibility) => { rows = rows.map((row) => (row.id === r.id ? { ...row, visibility } : row)); return rows[0] })
  open()
  await screen.findByRole('heading', { name: '내 제보 2' })
  // 비공개로 줄이는 것은 묻지 않고 바로 보낸다.
  fireEvent.click(card('r1').getByRole('button', { name: /비공개로 바꾸기/ }))
  expect((await card('r1').findByRole('status')).textContent).toBe('비공개 제보로 바꿨어요')
  await card('r1').findByText('비공개', { selector: '.chip' })
  await waitFor(() => expect(document.activeElement).toBe(cardEl('r1')))
  expect(card('r2').queryByRole('status')).toBeNull()
})

it('새 요청을 보내면 이전 결과를 지우고 그 요청의 결과만 남긴다', async () => {
  vi.spyOn(reports(), 'listMine').mockResolvedValue([report(), report({ id: 'r2', episodeNumber: 3 })])
  vi.spyOn(reports(), 'withdraw').mockRejectedValueOnce(new Error('이미 철회한 제보예요.')).mockReturnValue(new Promise(() => {}))
  vi.spyOn(window, 'confirm').mockReturnValue(true)
  open()
  await screen.findByRole('heading', { name: '내 제보 2' })
  fireEvent.click(card('r1').getByRole('button', { name: /철회 ·/ }))
  expect((await card('r1').findByRole('alert')).textContent).toBe('이미 철회한 제보예요.')
  fireEvent.click(card('r2').getByRole('button', { name: /철회 ·/ }))
  await waitFor(() => expect(card('r1').queryByRole('alert')).toBeNull())
  expect(card('r2').queryByRole('alert')).toBeNull()
})
