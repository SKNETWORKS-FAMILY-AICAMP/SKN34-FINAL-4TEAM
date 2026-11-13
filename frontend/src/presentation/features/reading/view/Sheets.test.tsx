// @vitest-environment jsdom
import '../../../../test/fixtureApp'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import type { ReactNode } from 'react'
import { Provider } from 'react-redux'
import { MemoryRouter } from 'react-router'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { appContainer } from '../../../../app/appContainer'
import { createAppStore } from '../../../../app/store'
import type { Work } from '../../../../domain/entities/work'
import { CommentSheet, FeedbackSheet, LookSheet, ReportSheet } from './Sheets'

const toasts: string[] = []
const heard = (e: Event) => { toasts.push((e as CustomEvent<string>).detail) }
beforeEach(() => { toasts.length = 0; window.addEventListener('sf-toast', heard) })
afterEach(() => { cleanup(); vi.restoreAllMocks(); window.removeEventListener('sf-toast', heard) })

const wrap = (store = createAppStore({ role: 'user' })) => ({ children }: { children: ReactNode }) => <Provider store={store}><MemoryRouter>{children}</MemoryRouter></Provider>
const sentence = { t: '이건 어디로 가야 하지.', pi: 0 }
const postman = async () => (await appContainer.resolve('workRepository').listWorks()).find((w) => w.id === 'postman')!
const sheets = [
  ['reportWork', '신고 내용', '신고하기', '신고 내용을 입력해 주세요', (work: Work) => <ReportSheet work={work} onClose={vi.fn()} />],
  ['addComment', '댓글', '등록', '댓글 내용을 입력해 주세요', () => <CommentSheet workId="postman" n={1} sentence={sentence} onClose={vi.fn()} onAdded={vi.fn()} />],
  ['sendFeedback', '내용', '피드백 보내기', '내용을 입력해 주세요', () => <FeedbackSheet workId="postman" n={1} sentence={sentence} onClose={vi.fn()} />],
] as const

describe('독자 시트의 오류 안내', () => {
  it.each(sheets)('%s 빈 내용은 사라지는 토스트가 아니라 시트 안에서 알린다', async (_method, _field, button, message, sheet) => {
    render(sheet(await postman()), { wrapper: wrap() })
    const dialog = within(screen.getByRole('dialog'))
    fireEvent.click(dialog.getByRole('button', { name: button }))
    expect((await dialog.findByRole('alert')).textContent).toBe(message)
    expect(toasts).toEqual([])
  })

  it.each(sheets)('%s 실패 사유를 시트 안에 남기고 다시 보내기 시작하면 지운다', async (method, field, button, _message, sheet) => {
    vi.spyOn(appContainer.resolve('feedbackUseCase'), method).mockRejectedValueOnce(new Error('저장 실패')).mockImplementation(() => new Promise<never>(() => {}))
    render(sheet(await postman()), { wrapper: wrap() })
    const dialog = within(screen.getByRole('dialog'))
    fireEvent.change(dialog.getByLabelText(field), { target: { value: '내용' } })
    fireEvent.click(dialog.getByRole('button', { name: button }))
    expect((await dialog.findByRole('alert')).textContent).toBe('저장 실패')
    expect(toasts).toEqual([])
    await waitFor(() => expect(dialog.getByRole<HTMLButtonElement>('button', { name: button }).disabled).toBe(false))
    fireEvent.click(dialog.getByRole('button', { name: button }))
    expect(dialog.queryByRole('alert')).toBeNull()
  })

  it('서버로 보내는 댓글(submit)의 실패 사유도 시트 안에 남긴다', async () => {
    const submit = vi.fn(async (_text: string, _sentence: typeof sentence, _spoiler: boolean, fail: (message: string) => void) => { fail('공개 회차를 찾을 수 없어요.'); return false })
    const onClose = vi.fn()
    render(<CommentSheet workId="guunmong" n={1} sentence={sentence} onClose={onClose} submit={submit} />, { wrapper: wrap() })
    const dialog = within(screen.getByRole('dialog'))
    fireEvent.change(dialog.getByLabelText('댓글'), { target: { value: '보내려던 감상' } })
    fireEvent.click(dialog.getByRole('button', { name: '등록' }))
    expect((await dialog.findByRole('alert')).textContent).toBe('공개 회차를 찾을 수 없어요.')
    expect(submit).toHaveBeenCalledWith('보내려던 감상', sentence, false, expect.any(Function))
    expect(dialog.getByLabelText<HTMLTextAreaElement>('댓글').value).toBe('보내려던 감상')
    expect(onClose).not.toHaveBeenCalled()
    expect(toasts).toEqual([])
  })
})

describe('독자 시트의 접수 완료 안내', () => {
  it('피드백을 접수하면 결과를 상태로 알리고 사라진 제출 버튼 대신 확인 버튼으로 포커스를 옮긴다', async () => {
    vi.spyOn(appContainer.resolve('feedbackUseCase'), 'sendFeedback').mockResolvedValue({ status: '작가 검토 대기', message: '작가에게 전달했어요.' })
    render(<FeedbackSheet workId="postman" n={1} sentence={sentence} onClose={vi.fn()} />, { wrapper: wrap() })
    const dialog = within(screen.getByRole('dialog'))
    fireEvent.change(dialog.getByLabelText('내용'), { target: { value: '오타가 있어요' } })
    fireEvent.click(dialog.getByRole('button', { name: '피드백 보내기' }))
    const result = await dialog.findByRole('status')
    expect(result.textContent).toBe('작가 검토 대기 작가에게 전달했어요.')
    const ok = dialog.getByRole('button', { name: '확인' })
    await waitFor(() => expect(document.activeElement).toBe(ok))
    // 포커스가 닿을 때 결과 문구가 버튼 설명으로도 읽힌다.
    expect(ok.getAttribute('aria-describedby')).toBe(result.id)
  })

  it('데모 소설 신고를 접수하면 결과를 상태로 알리고 확인 버튼으로 포커스를 옮긴다', async () => {
    vi.spyOn(appContainer.resolve('feedbackUseCase'), 'reportWork').mockResolvedValue('신고를 운영팀에 접수했어요.')
    render(<ReportSheet work={await postman()} onClose={vi.fn()} />, { wrapper: wrap() })
    const dialog = within(screen.getByRole('dialog'))
    fireEvent.change(dialog.getByLabelText('신고 내용'), { target: { value: '권리 확인 부탁' } })
    fireEvent.click(dialog.getByRole('button', { name: '신고하기' }))
    expect((await dialog.findByRole('status')).textContent).toBe('접수됨 신고를 운영팀에 접수했어요.')
    await waitFor(() => expect(document.activeElement).toBe(dialog.getByRole('button', { name: '확인' })))
  })
})

describe('보기 설정 시트', () => {
  it('글자 크기는 누를 수 없는 값 표시이고 바뀌면 상태로 알린다', () => {
    const store = createAppStore()
    render(<LookSheet onClose={vi.fn()} />, { wrapper: wrap(store) })
    const dialog = within(screen.getByRole('dialog', { name: '보기 설정' }))
    const size = dialog.getByRole('status')
    expect(size.textContent).toBe('글자 크기 19')
    expect(dialog.queryByRole('button', { name: /글자 크기/ })).toBeNull()
    fireEvent.click(dialog.getByRole('button', { name: '가 +' }))
    expect(size.textContent).toBe('글자 크기 20')
    expect(store.getState().ui.fs).toBe(20)
  })

  it('선택 버튼 묶음마다 이름이 있어 켜기·끄기가 무엇의 선택인지 알린다', () => {
    render(<LookSheet onClose={vi.fn()} />, { wrapper: wrap() })
    const dialog = within(screen.getByRole('dialog', { name: '보기 설정' }))
    expect(dialog.getAllByRole('group').map((group) => group.getAttribute('aria-label'))).toEqual(['배경', '배경 움직임', '글자 크기'])
    expect(within(dialog.getByRole('group', { name: '배경 움직임' })).getByRole('button', { name: '켜기' }).getAttribute('aria-pressed')).toBe('true')
    expect(dialog.getByRole('group', { name: '글자 크기' }).contains(dialog.getByRole('status'))).toBe(true)
  })
})
