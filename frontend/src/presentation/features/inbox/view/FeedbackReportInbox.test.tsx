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

it('유형과 상태를 함께 골라 해당 제보와 작가의 처리 기록을 본다', async () => {
  vi.spyOn(reports(), 'listInbox').mockResolvedValue([report(), report({
    id: 'r2', kind: 'story', body: '장면 순서', status: 'checked', authorChecked: true,
    handledAt: '2026-11-10T02:00:00Z', handlerName: '작가봄',
  })])
  open()
  await screen.findByRole('heading', { name: '독자 제보 2' })
  const reply = card('r1').getByLabelText(/작가 답변/) as HTMLTextAreaElement
  fireEvent.change(reply, { target: { value: '확인하고 있습니다' } })
  card('r1').getByRole('button', { name: '상태 변경 · 구운몽 2화' })
  fireEvent.change(screen.getByLabelText('제보 유형'), { target: { value: 'story' } })
  expect(card('r1').queryByRole('button', { name: '상태 변경 · 구운몽 2화' })).toBeNull()
  card('r2').getByText(/작가봄/)
  fireEvent.change(screen.getByLabelText('제보 상태'), { target: { value: 'unchecked' } })
  // 0건 안내는 필터를 바꾼 결과라 스크린 리더에도 알린다.
  expect(screen.getByText('조건에 맞는 제보가 없어요.').getAttribute('role')).toBe('status')
  fireEvent.change(screen.getByLabelText('제보 유형'), { target: { value: '' } })
  expect((card('r1').getByLabelText(/작가 답변/) as HTMLTextAreaElement).value).toBe('확인하고 있습니다')
})

it('상태 필터를 건 채 처리해도 방금 처리한 카드는 결과 안내와 함께 남는다', async () => {
  let rows = [report()]
  vi.spyOn(reports(), 'listInbox').mockImplementation(async () => rows)
  vi.spyOn(reports(), 'check').mockImplementation(async () => { rows = [report({ status: 'checked', authorChecked: true })]; return rows[0] })
  open()
  await screen.findByRole('heading', { name: '독자 제보 1' })
  fireEvent.change(screen.getByLabelText('제보 상태'), { target: { value: 'unchecked' } })
  fireEvent.click(card('r1').getByRole('button', { name: /확인했어요/ }))
  // 확인하면 상태가 '작가 확인 전' 필터와 어긋나지만, 결과 안내(와 초점을 받을 카드)가 숨겨지면 안 된다.
  await card('r1').findByText('확인함', { selector: '.chip' })
  expect(card('r1').getByRole('status').textContent).toBe('확인했어요')
  expect(document.activeElement).toBe(document.querySelector('[data-report="r1"]'))
  expect(screen.queryByText('조건에 맞는 제보가 없어요.')).toBeNull()
})

it('처리 기록은 마지막 처리 시각을 보이고 최초 확인 시각이 다르면 함께 보인다', async () => {
  const first = '2026-11-10T01:00:00Z', later = '2026-11-11T03:00:00Z'
  const at = (iso: string) => new Date(iso).toLocaleString('ko-KR')
  const handled = { status: 'checked', authorChecked: true, handlerName: '작가봄', authorCheckedAt: first } as const
  vi.spyOn(reports(), 'listInbox').mockResolvedValue([
    report({ id: 'r1', ...handled, handledAt: first }),
    report({ id: 'r2', ...handled, status: 'answered', handledAt: later }),
    report({ id: 'r3', ...handled }),
  ])
  open()
  await screen.findByRole('heading', { name: '독자 제보 3' })
  // 확인만 했으면 두 시각이 같아 마지막 처리 하나만 보인다.
  expect(card('r1').getByText(/마지막 처리/).textContent).toBe(`작가봄 · 마지막 처리 ${at(first)}`)
  // 그 뒤 다시 처리했으면 최초 확인 시각도 함께 보인다.
  expect(card('r2').getByText(/마지막 처리/).textContent).toBe(`작가봄 · 마지막 처리 ${at(later)} · 최초 확인 ${at(first)}`)
  // 처리 시각이 기록되기 전의 제보는 최초 확인만 보인다.
  expect(card('r3').getByText(/최초 확인/).textContent).toBe(`작가봄 · 최초 확인 ${at(first)}`)
  expect(card('r3').queryByText(/마지막 처리/)).toBeNull()
})
