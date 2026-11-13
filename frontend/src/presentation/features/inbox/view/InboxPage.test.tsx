// @vitest-environment jsdom
import '../../../../test/fixtureApp'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { Provider } from 'react-redux'
import { MemoryRouter } from 'react-router'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { appContainer } from '../../../../app/appContainer'
import { createAppStore } from '../../../../app/store'
import type { EditSuggestion } from '../../../../domain/entities/editSuggestion'
import { InboxPage } from './InboxPage'

beforeEach(() => { vi.stubGlobal('fetch', vi.fn(async () => new Response(null, { status: 401 }))) })
afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.restoreAllMocks() })

const feedback = () => appContainer.resolve('feedbackRepository')
/** 작가 판단이 필요한(`from` 없는) 제보를 하나 넣고 그 항목을 선택한 화면을 연다. */
async function open(id: string) {
  await feedback().addReport({ id: 'r-' + id, w: 'starlight', n: 1, type: '질문', text: '제보 ' + id, status: '작가 검토 대기', reply: '' })
  await feedback().addInbox({ id, rid: 'r-' + id, w: 'starlight', n: 1, pi: 0, type: '질문', who: '독자', text: '제보 ' + id, baseText: '', status: '작가 검토 대기', ai: { cls: '제안', why: '안내', ev: '문장' } })
  return render(<Provider store={createAppStore({ role: 'user' })}><MemoryRouter initialEntries={[`/inbox?i=${id}`]}><InboxPage /></MemoryRouter></Provider>)
}

describe('독자 피드백함 (U20)', () => {
  it('불러오는 동안 빈 화면 대신 상태를 안내하고, 불러오면 h1 제목을 보여 준다', async () => {
    await open('loading')
    expect(screen.getByRole('status').textContent).toMatch(/불러오/)
    const main = screen.getByRole('main')
    expect(main.id).toBe('main')
    expect(main.getAttribute('tabindex')).toBe('-1')
    const title = await screen.findByRole('heading', { name: /독자 피드백함/, level: 1 })
    expect(screen.getAllByRole('heading', { level: 1 })).toEqual([title])
    expect(screen.queryByRole('status')).toBeNull()
  })

  it('처리 중에는 버튼을 잠그고 중복 처리하지 않으며, 결과를 상태 영역으로 알리고 초점을 옮긴다', async () => {
    let finish!: (message: string) => void
    const act_ = vi.spyOn(appContainer.resolve('inboxUseCase'), 'act').mockImplementation(() => new Promise((resolve) => { finish = resolve }))
    await open('pending')
    fireEvent.change(await screen.findByLabelText('작가 답변'), { target: { value: '의도한 복선이에요' } })
    const send = screen.getByRole<HTMLButtonElement>('button', { name: '답변 보내기' })
    fireEvent.click(send)
    await waitFor(() => expect(send.disabled).toBe(true))
    expect(screen.getByRole<HTMLButtonElement>('button', { name: '의도한 설정이에요' }).disabled).toBe(true)
    expect(document.querySelector('.panel')!.getAttribute('aria-busy')).toBe('true')
    fireEvent.click(send)
    expect(act_).toHaveBeenCalledTimes(1)
    expect(act_).toHaveBeenCalledWith('pending', 'resolve', '의도한 복선이에요')
    await act(async () => { finish('처리했어요 (데모)') })
    const status = await screen.findByText('처리했어요 (데모)')
    expect(status.getAttribute('role')).toBe('status')
    expect(document.activeElement).toBe(status)
    expect(screen.getByRole<HTMLButtonElement>('button', { name: '답변 보내기' }).disabled).toBe(false)
  })

  it('두 처리 버튼은 같은 처리 요청(답변 포함)을 보낸다', async () => {
    const act_ = vi.spyOn(appContainer.resolve('inboxUseCase'), 'act').mockResolvedValue('처리했어요 (데모)')
    await open('same')
    fireEvent.change(await screen.findByLabelText('작가 답변'), { target: { value: '답변' } })
    fireEvent.click(screen.getByRole('button', { name: '의도한 설정이에요' }))
    await waitFor(() => expect(act_).toHaveBeenCalledWith('same', 'resolve', '답변'))
  })

  it('불러오는 중에도, 불러온 뒤에도 탭 제목은 독자 피드백함이다', async () => {
    await open('title')
    expect(document.title).toBe('독자 피드백함 · STORYFORK')
    await screen.findByRole('heading', { name: /독자 피드백함/, level: 1 })
    expect(document.title).toBe('독자 피드백함 · STORYFORK')
  })

  it('데모 피드백을 불러오지 못하면 끝나지 않는 로딩 대신 알리고 다시 불러올 수 있으며, 그동안에도 수정 제안 영역은 가리지 않는다', async () => {
    const list = vi.spyOn(appContainer.resolve('inboxUseCase'), 'list').mockRejectedValue(new Error('down'))
    render(<Provider store={createAppStore({ role: 'user' })}><MemoryRouter initialEntries={['/inbox']}><InboxPage /></MemoryRouter></Provider>)
    const failed = await screen.findByText('독자 피드백을 불러오지 못했어요. 연결 상태를 확인한 뒤 다시 시도해 주세요.')
    expect(failed.closest('[role=alert]')).not.toBeNull()
    expect(screen.queryByRole('status')).toBeNull()
    screen.getByRole('heading', { name: '독자 수정 제안' })
    list.mockRestore()
    fireEvent.click(screen.getByRole('button', { name: '독자 피드백 다시 불러오기' }))
    await screen.findByRole('heading', { name: /데모 작품 피드백/ })
    expect(screen.queryByText(/독자 피드백을 불러오지 못했어요/)).toBeNull()
  })

  it('데모 항목을 골라도 화면을 다시 만들지 않아 수정 제안에 쓰던 편집안과 고른 링크의 초점이 남는다', async () => {
    vi.spyOn(appContainer.resolve('editSuggestionUseCase'), 'inbox').mockResolvedValue([suggestion])
    await feedback().addInbox({ id: 'other', rid: 'r-other', w: 'starlight', n: 1, pi: 0, type: '질문', who: '독자', text: '제보 other', baseText: '', status: '작가 검토 대기', ai: { cls: '제안', why: '안내', ev: '문장' } })
    await open('picked')
    const draft = await screen.findByLabelText<HTMLTextAreaElement>('편집안')
    fireEvent.change(draft, { target: { value: '쓰던 편집안' } })
    const other = screen.getByRole('link', { name: /제보 other/ })
    other.focus()
    fireEvent.click(other)
    expect(other.isConnected).toBe(true)
    expect(draft.isConnected).toBe(true)
    await waitFor(() => expect(other.getAttribute('aria-current')).toBe('true'))
    expect(screen.getByLabelText('편집안')).toBe(draft)
    expect(draft.value).toBe('쓰던 편집안')
    expect(document.activeElement).toBe(other)
  })

  it('다른 항목을 고르면 새 항목을 불러오는 동안에도 이전 항목에 쓰던 답변을 비운다', async () => {
    await feedback().addInbox({ id: 'next', rid: 'r-next', w: 'starlight', n: 1, pi: 0, type: '질문', who: '독자', text: '제보 next', baseText: '', status: '작가 검토 대기', ai: { cls: '제안', why: '안내', ev: '문장' } })
    await open('typed')
    fireEvent.change(await screen.findByLabelText('작가 답변'), { target: { value: '이전 항목에 쓴 답' } })
    // 다음 조회를 붙잡아 두어, 고른 주소는 바뀌었지만 화면에는 이전 항목이 남아 있는 순간을 만든다.
    const inbox = appContainer.resolve('inboxUseCase')
    const list = inbox.list.bind(inbox)
    let release!: () => void
    const gate = new Promise<void>((resolve) => { release = resolve })
    vi.spyOn(inbox, 'list').mockImplementation(async (selected) => { await gate; return list(selected) })
    const next = screen.getByRole('link', { name: /제보 next/ })
    fireEvent.click(next)
    expect(screen.getByLabelText<HTMLTextAreaElement>('작가 답변').value).toBe('')
    await act(async () => { release() })
    await waitFor(() => expect(next.getAttribute('aria-current')).toBe('true'))
    expect(screen.getByLabelText<HTMLTextAreaElement>('작가 답변').value).toBe('')
  })

  it('데모 피드백 패널의 제목은 굵은 글씨가 아니라 제목 요소다', async () => {
    await open('titles')
    expect((await screen.findByRole('heading', { name: '접수된 피드백' })).tagName).toBe('H3')
    expect(screen.getByRole('heading', { name: '작가 판단이 필요해요' }).tagName).toBe('H4')
  })
})

const suggestion: EditSuggestion = {
  id: 's1', workId: 'w1', workTitle: '별빛 서약', episodeNumber: 3, publishedVersionId: 'v1', source: 'reader', proposerName: '독자A',
  beforeText: '않 된다고', afterText: '안 된다고', editedText: null, reason: null, status: 'pending', decisionReason: null,
  applyResult: null, applyFailure: null, appliedVersionId: null, scope: 'auto', scopeReasons: ['단어마다 한 글자 오탈자 수준만 바뀌어요.'],
  mine: false, owner: true, createdAt: '2026-11-10T01:00:00Z', updatedAt: '2026-11-10T01:00:00Z',
}
