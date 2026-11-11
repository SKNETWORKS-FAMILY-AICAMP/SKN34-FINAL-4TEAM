// @vitest-environment jsdom
// React 조립 회귀: CI 통합 계층에서만 실행한다.
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import type { ChatMessage } from '../../../domain/entities/chat'
import { ChatPanel } from './ChatPanel'

afterEach(cleanup)
const box = () => screen.getByRole('textbox', { name: '메시지' }) as HTMLTextAreaElement
const send = () => screen.getByRole('button', { name: '전송' }) as HTMLButtonElement
const type = (text: string) => fireEvent.change(box(), { target: { value: text } })

describe('공용 채팅 메시지', () => {
  it('역할별로 화자를 구분하고 텍스트와 첨부 칩을 그린다', () => {
    const messages: ChatMessage[] = [
      { id: 'a', role: 'user', text: '다음 장면을 이어 줘', attachments: [{ id: 'f1', kind: 'image', name: '표지.png' }, { id: 'f2', kind: 'audio', name: '메모.m4a' }] },
      { id: 'b', role: 'assistant', text: '제안입니다.' },
      { id: 'c', role: 'system', text: '연결이 끊겼어요.' },
    ]
    render(<ChatPanel messages={messages} />)
    const log = screen.getByRole('log', { name: '대화 내용' })
    const rows = within(log).getAllByRole('listitem').filter(li => li.classList.contains('chat-msg'))
    expect(rows.map(li => li.className)).toEqual(['chat-msg user', 'chat-msg assistant', 'chat-msg system'])
    expect(rows.map(li => li.querySelector('.chat-who')?.textContent)).toEqual(['나', 'AI', '안내'])
    expect(within(rows[0]).getByText('다음 장면을 이어 줘')).toBeTruthy()
    expect(within(rows[0]).getByLabelText('첨부').textContent).toBe('이미지 · 표지.png음성 · 메모.m4a')
    expect(within(rows[1]).queryByLabelText('첨부')).toBeNull()
  })

  it('메시지가 없으면 안내 문구를 보인다', () => {
    render(<ChatPanel messages={[]} emptyText="아직 이야기가 없어요." />)
    expect(within(screen.getByRole('log')).getByText('아직 이야기가 없어요.')).toBeTruthy()
  })

  it('빈 상태에는 제목을 붙일 수 있고, 메시지가 생기면 안내와 추천 칩을 거둔다', () => {
    const { rerender } = render(<ChatPanel messages={[]} emptyTitle="무엇을 함께 써볼까요?" emptyText="제안은 원고에 자동으로 반영되지 않아요." suggestions={['요약']} />)
    const log = screen.getByRole('log')
    expect(within(log).getByRole('heading', { name: '무엇을 함께 써볼까요?' })).toBeTruthy()
    expect(within(log).getByText('제안은 원고에 자동으로 반영되지 않아요.')).toBeTruthy()
    rerender(<ChatPanel messages={[{ id: 'a', role: 'user', text: '안녕' }]} emptyTitle="무엇을 함께 써볼까요?" emptyText="제안은 원고에 자동으로 반영되지 않아요." suggestions={['요약']} />)
    expect(screen.queryByRole('heading')).toBeNull()
    expect(screen.queryByRole('button', { name: '요약' })).toBeNull()
  })
})

describe('공용 채팅 입력', () => {
  it('Enter로 앞뒤 공백을 뺀 글을 보내고 성공하면 입력창을 비운다', async () => {
    const onSend = vi.fn().mockResolvedValue(true)
    render(<ChatPanel messages={[]} onSend={onSend} />)
    type('  이어 써 줘  ')
    fireEvent.keyDown(box(), { key: 'Enter' })
    await waitFor(() => expect(box().value).toBe(''))
    expect(onSend).toHaveBeenCalledExactlyOnceWith('이어 써 줘')
  })

  it('전송 버튼도 같은 전송을 하고 비어 있거나 공백뿐이면 옅게 잠가 보내지 않는다', async () => {
    const onSend = vi.fn().mockResolvedValue(true)
    render(<ChatPanel messages={[]} onSend={onSend} />)
    expect(send().disabled).toBe(true)
    fireEvent.click(send())
    type('   ')
    fireEvent.keyDown(box(), { key: 'Enter' })
    expect(send().disabled).toBe(true)
    expect(onSend).not.toHaveBeenCalled()
    type('안녕')
    expect(send().disabled).toBe(false)
    fireEvent.click(send())
    await waitFor(() => expect(onSend).toHaveBeenCalledExactlyOnceWith('안녕'))
  })

  it('추천 칩은 입력창에 글만 채우고 보내지 않으며 입력이 잠기면 칩도 잠긴다', () => {
    const onSend = vi.fn().mockResolvedValue(true)
    const { rerender } = render(<ChatPanel messages={[]} onSend={onSend} suggestions={['다음 장면 아이디어', '문장 다듬기']} />)
    expect(screen.getAllByRole('button').filter(b => ['다음 장면 아이디어', '문장 다듬기'].includes(b.textContent ?? ''))).toHaveLength(2)
    fireEvent.click(screen.getByRole('button', { name: '문장 다듬기' }))
    expect(box().value).toBe('문장 다듬기')
    expect(document.activeElement).toBe(box())
    expect(send().disabled).toBe(false)
    expect(onSend).not.toHaveBeenCalled()
    rerender(<ChatPanel messages={[]} suggestions={['문장 다듬기']} />)
    expect((screen.getByRole('button', { name: '문장 다듬기' }) as HTMLButtonElement).disabled).toBe(true)
  })

  it('추천 칩을 넘기지 않으면 그리지 않는다', () => {
    render(<ChatPanel messages={[]} onSend={vi.fn()} />)
    expect(screen.queryByRole('list', { name: '추천 질문' })).toBeNull()
  })

  it('Shift+Enter는 줄바꿈에 맡기고 한글 조합 중·Safari 조합 확정 Enter(isComposing=false, keyCode=229)는 보내지 않는다', () => {
    const onSend = vi.fn().mockResolvedValue(true)
    render(<ChatPanel messages={[]} onSend={onSend} />)
    type('한글')
    expect(fireEvent.keyDown(box(), { key: 'Enter', shiftKey: true })).toBe(true)
    for (const init of [{ isComposing: true }, { isComposing: false, keyCode: 229 }]) {
      expect(fireEvent.keyDown(box(), { key: 'Enter', ...init })).toBe(true)
    }
    expect(onSend).not.toHaveBeenCalled()
    expect(box().value).toBe('한글')
  })

  it('전송에 실패하면 입력을 남긴다', async () => {
    const onSend = vi.fn().mockResolvedValue(false)
    render(<ChatPanel messages={[]} onSend={onSend} />)
    type('남겨 줘')
    fireEvent.keyDown(box(), { key: 'Enter' })
    await waitFor(() => expect(onSend).toHaveBeenCalledTimes(1))
    expect(box().value).toBe('남겨 줘')
  })

  it('처리 중에는 보내지 못하고 같은 요청을 겹쳐 보내지 않는다', () => {
    const onSend = vi.fn().mockResolvedValue(true)
    render(<ChatPanel messages={[]} onSend={onSend} busy />)
    type('기다려')
    expect(send().disabled).toBe(true)
    fireEvent.keyDown(box(), { key: 'Enter' })
    expect(onSend).not.toHaveBeenCalled()
  })

  it('busy를 넘기지 않아도 전송이 끝나기 전에는 같은 입력을 다시 보내지 않고 끝나면 다음 전송을 받는다', async () => {
    let finish!: (ok: boolean) => void
    const onSend = vi.fn(() => new Promise<boolean>(resolve => { finish = resolve }))
    render(<ChatPanel messages={[]} onSend={onSend} />)
    type('한 번만')
    fireEvent.keyDown(box(), { key: 'Enter' })
    fireEvent.keyDown(box(), { key: 'Enter' })
    fireEvent.click(send())
    expect(onSend).toHaveBeenCalledExactlyOnceWith('한 번만')
    expect(box().value).toBe('한 번만')
    await act(async () => { finish(true) })
    await waitFor(() => expect(box().value).toBe(''))
    type('다음')
    fireEvent.keyDown(box(), { key: 'Enter' })
    expect(onSend).toHaveBeenCalledTimes(2)
    expect(onSend).toHaveBeenLastCalledWith('다음')
  })

  it('busy를 넘기지 않아도 전송하는 동안은 새 글이 있어도 전송 버튼을 잠가 눌러도 무시되는 일이 없게 한다', async () => {
    let finish!: (ok: boolean) => void
    const onSend = vi.fn(() => new Promise<boolean>(resolve => { finish = resolve }))
    render(<ChatPanel messages={[]} onSend={onSend} />)
    type('첫 글')
    fireEvent.click(send())
    type('기다리며 쓴 글')
    expect(send().disabled).toBe(true)
    await act(async () => { finish(true) })
    // 기다리는 사이 쓴 글은 남고, 전송이 끝나면 버튼이 다시 열린다.
    await waitFor(() => expect(send().disabled).toBe(false))
    expect(box().value).toBe('기다리며 쓴 글')
  })

  it('onSend가 거부되면 입력을 남기고 실패를 알리며, 다시 쓰면 안내를 지우고 다시 보낼 수 있다', async () => {
    const onSend = vi.fn().mockRejectedValueOnce(new Error('연결 끊김')).mockResolvedValue(true)
    render(<ChatPanel messages={[]} onSend={onSend} />)
    type('실패할 글')
    fireEvent.keyDown(box(), { key: 'Enter' })
    expect((await screen.findByRole('alert')).textContent).toBe('보내지 못했어요. 입력은 그대로 남아 있어요. 다시 시도해 주세요.')
    expect(box().value).toBe('실패할 글')
    expect(send().disabled).toBe(false)
    type('실패할 글 고침')
    expect(screen.queryByRole('alert')).toBeNull()
    fireEvent.keyDown(box(), { key: 'Enter' })
    await waitFor(() => expect(box().value).toBe(''))
    expect(onSend).toHaveBeenCalledTimes(2)
    expect(screen.queryByRole('alert')).toBeNull()
  })
})

describe('공용 채팅 비활성·첨부', () => {
  const plus = () => screen.getByRole('button', { name: '첨부' })
  const attachItem = (name: string) => screen.getByRole('menuitem', { name }) as HTMLButtonElement

  it('비활성 사유가 있으면 입력·전송·첨부를 모두 잠그고 사유를 카드 아래에 연결해 알린다', () => {
    const onSend = vi.fn()
    const onAttach = vi.fn()
    render(<ChatPanel messages={[]} onSend={onSend} onAttach={onAttach} disabledReason="준비 중이에요." />)
    expect(box().disabled).toBe(true)
    expect(send().disabled).toBe(true)
    fireEvent.click(plus())
    expect(attachItem('이미지 첨부').disabled).toBe(true)
    expect(attachItem('음성 첨부').disabled).toBe(true)
    expect(document.getElementById(box().getAttribute('aria-describedby') ?? '')?.textContent).toBe('준비 중이에요.')
    fireEvent.click(send())
    expect(onSend).not.toHaveBeenCalled()
    expect(onAttach).not.toHaveBeenCalled()
  })

  it('전송 handler가 없으면 입력과 전송을 잠근다', () => {
    render(<ChatPanel messages={[]} />)
    expect(box().disabled).toBe(true)
    expect(send().disabled).toBe(true)
  })

  it('첨부 handler가 없으면 + 버튼 안의 이미지·음성 항목을 준비 중 안내와 함께 잠그고, 안내는 popover 안에만 둔다', () => {
    render(<ChatPanel messages={[]} onSend={vi.fn()} />)
    const note = '이미지·음성 첨부는 준비 중이에요.'
    expect(plus().getAttribute('aria-haspopup')).toBe('menu')
    expect(plus().getAttribute('aria-expanded')).toBe('false')
    expect(screen.queryByText(note)).toBeNull()
    fireEvent.click(plus())
    expect(plus().getAttribute('aria-expanded')).toBe('true')
    for (const name of ['이미지 첨부', '음성 첨부']) {
      const item = attachItem(name)
      expect(item.disabled).toBe(true)
      expect(document.getElementById(item.getAttribute('aria-describedby') ?? '')?.textContent).toBe(note)
    }
    expect(screen.getAllByText(note)).toHaveLength(1)
    // 마이크는 항상 준비 중이라 잠겨 있다
    expect((screen.getByRole('button', { name: '음성 입력 (준비 중)' }) as HTMLButtonElement).disabled).toBe(true)
    // Escape로 닫으면 + 버튼으로 초점이 돌아온다
    fireEvent.keyDown(plus(), { key: 'Escape' })
    expect(screen.queryByRole('menu')).toBeNull()
    expect(document.activeElement).toBe(plus())
  })

  it('첨부 handler가 있으면 고른 파일을 종류와 함께 넘기고 파일 선택을 비운다', () => {
    const onAttach = vi.fn()
    const { container } = render(<ChatPanel messages={[]} onSend={vi.fn()} onAttach={onAttach} />)
    fireEvent.click(plus())
    expect(attachItem('음성 첨부').disabled).toBe(false)
    const input = container.querySelector<HTMLInputElement>('input[type="file"][accept="audio/*"]')!
    const pick = vi.spyOn(input, 'click')
    fireEvent.click(attachItem('음성 첨부'))
    expect(pick).toHaveBeenCalledTimes(1)
    expect(screen.queryByRole('menu')).toBeNull()
    const file = new File(['x'], '메모.m4a', { type: 'audio/mp4' })
    fireEvent.change(input, { target: { files: [file] } })
    expect(onAttach).toHaveBeenCalledExactlyOnceWith('audio', file)
    expect(container.querySelector('input[type="file"][accept="image/*"]')).toBeTruthy()
  })
})
