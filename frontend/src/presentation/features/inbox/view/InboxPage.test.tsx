// @vitest-environment jsdom
import '../../../../test/fixtureApp'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { Provider } from 'react-redux'
import { MemoryRouter } from 'react-router'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { appContainer } from '../../../../app/appContainer'
import { createAppStore } from '../../../../app/store'
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
})
