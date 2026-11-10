// @vitest-environment jsdom
import '../../../test/fixtureApp'
import { act, cleanup, fireEvent, render, renderHook, screen, waitFor } from '@testing-library/react'
import type { ReactNode } from 'react'
import { Provider } from 'react-redux'
import { MemoryRouter } from 'react-router'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { appContainer } from '../../../app/appContainer'
import { createAppStore } from '../../../app/store'
import type { Work } from '../../../domain/entities/work'
import { CommentSheet, FeedbackSheet, ReportSheet } from './view/Sheets'
import { useReaderViewModel } from './viewmodel/useReaderViewModel'
import { useWorkViewModel } from './viewmodel/useWorkViewModel'

afterEach(() => { cleanup(); vi.restoreAllMocks() })

const wrap = () => {
  const store = createAppStore({ role: 'user' })
  // useReaderViewModel·useWorkViewModel은 로그인 안내 이동에 라우터가 필요하다.
  return ({ children }: { children: ReactNode }) => <Provider store={store}><MemoryRouter>{children}</MemoryRouter></Provider>
}
const sentence = { t: '이건 어디로 가야 하지.', pi: 0 }
const sheets = [
  ['reportWork', '신고 내용', '신고하기', (work: Work) => <ReportSheet work={work} onClose={vi.fn()} />],
  ['addComment', '댓글', '등록', () => <CommentSheet workId="postman" n={1} sentence={sentence} onClose={vi.fn()} onAdded={vi.fn()} />],
  ['sendFeedback', '내용', '피드백 보내기', () => <FeedbackSheet workId="postman" n={1} sentence={sentence} onClose={vi.fn()} />],
] as const

describe('독자 시트 중복 제출 (#27)', () => {
  // 빈 내용은 ViewModel이 안내만 하고 거절한다. 실제 제출이 시작된 것이 아니므로 버튼을 잠그면 바로 다시 누른 제출이 무시된다.
  it.each(sheets)('%s 빈 내용 제출은 안내만 하고 버튼을 잠그지 않아 바로 다시 보낼 수 있다', async (method, field, button, sheet) => {
    const send = vi.spyOn(appContainer.resolve('feedbackUseCase'), method).mockImplementation(() => new Promise<never>(() => {}))
    const work = (await appContainer.resolve('workRepository').listWorks()).find((w) => w.id === 'postman')!
    render(sheet(work), { wrapper: wrap() })
    const submit = screen.getByRole<HTMLButtonElement>('button', { name: button })
    fireEvent.click(submit)
    expect(send).not.toHaveBeenCalled()
    expect(submit.disabled).toBe(false)
    fireEvent.change(screen.getByLabelText(field), { target: { value: '내용' } })
    fireEvent.click(submit)
    expect(send).toHaveBeenCalledTimes(1)
  })

  it.each(sheets)('%s 요청이 끝나기 전에는 제출 버튼이 한 번만 보내고, 실패로 끝나면 다시 보낼 수 있다', async (method, field, button, sheet) => {
    let fail!: (reason: Error) => void
    const send = vi.spyOn(appContainer.resolve('feedbackUseCase'), method).mockImplementation(() => new Promise<never>((_, reject) => { fail = reject }))
    const work = (await appContainer.resolve('workRepository').listWorks()).find((w) => w.id === 'postman')!
    render(sheet(work), { wrapper: wrap() })
    fireEvent.change(screen.getByLabelText(field), { target: { value: '내용' } })
    const submit = screen.getByRole<HTMLButtonElement>('button', { name: button })
    fireEvent.click(submit)
    fireEvent.click(submit)
    expect(send).toHaveBeenCalledTimes(1)
    expect(submit.disabled).toBe(true)
    await act(async () => { fail(new Error('저장 실패')) })
    expect(submit.disabled).toBe(false)
  })
})

describe('경로가 바뀌면 열린 시트를 닫는다 (#28)', () => {
  it('다른 회차로 가면 열려 있던 문장 시트를 닫는다', async () => {
    const { result, rerender } = renderHook(({ n }) => useReaderViewModel('postman', n), { initialProps: { n: 1 }, wrapper: wrap() })
    await waitFor(() => expect(result.current.reader?.n).toBe(1))
    act(() => result.current.openSheet({ kind: 'feedback', k: 2 }))
    expect(result.current.sheet).toEqual({ kind: 'feedback', k: 2 })
    rerender({ n: 2 })
    expect(result.current.sheet).toBeNull()
    await waitFor(() => expect(result.current.reader?.n).toBe(2))
  })

  it('다른 작품으로 가면 열려 있던 신고 시트를 닫는다', async () => {
    const { result, rerender } = renderHook(({ id }) => useWorkViewModel(id), { initialProps: { id: 'postman' }, wrapper: wrap() })
    await waitFor(() => expect(result.current.detail?.work.id).toBe('postman'))
    act(() => result.current.setReporting(true))
    expect(result.current.reporting).toBe(true)
    rerender({ id: 'starlight' })
    expect(result.current.reporting).toBe(false)
    await waitFor(() => expect(result.current.detail?.work.id).toBe('starlight'))
  })
})
