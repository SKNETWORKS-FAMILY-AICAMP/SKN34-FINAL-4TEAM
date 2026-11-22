// @vitest-environment jsdom
// React 조립 회귀: CI 통합 계층에서만 실행한다.
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import type { ChatMessage } from '../../../domain/entities/chat'
import { checkAttachment } from '../../../domain/entities/chatAttachment'
import { ChatPanel } from './ChatPanel'

afterEach(cleanup)
const box = () => screen.getByRole('textbox', { name: '메시지' }) as HTMLTextAreaElement
const send = () => screen.getByRole('button', { name: '전송' }) as HTMLButtonElement
const type = (text: string) => fireEvent.change(box(), { target: { value: text } })

describe('함께 보낼 것 안내', () => {
  // 안내 줄(27px)에 따라 대화 영역은 591 ↔ 564다. 바뀌기 전에 맨 아래에서 80px 안을 읽고 있었는지로 정한다.
  it.each([
    ['생김', 591, 564, 409, 1000], // 전 간격 0
    ['생김', 591, 564, 349, 1000], // 전 간격 60, 후 87
    ['생김', 591, 564, 100, 100],
    ['없어짐', 564, 591, 336, 336], // 전 간격 100, 후 73
    ['생김', 591, 300, 100, 100, 1000], // 그사이 창 높이가 줄었어도 위를 읽던 중이면 그대로
  ])('안내가 %s(%i→%i): 맨 아래에서 읽던 때만 따라 내려간다(#636, scrollTop=%i)', (change, before, after, scrollTop, expected, scrollHeight = 1000) => {
    let height = before
    const measured = vi.spyOn(HTMLElement.prototype, 'clientHeight', 'get').mockImplementation(() => height)
    const panel = (note: boolean) => <ChatPanel messages={[]} onSend={() => true} sendNote={note ? '선택한 글 7자가 함께 보내져요.' : ''} />
    const { rerender } = render(panel(change === '없어짐'))
    const log = screen.getByRole('log', { name: '대화 내용' })
    Object.defineProperties(log, { scrollHeight: { value: scrollHeight }, scrollTop: { value: scrollTop, writable: true } })
    fireEvent.scroll(log) // 안내가 바뀌기 전에 읽던 자리
    height = after
    rerender(panel(change === '생김'))
    expect(log.scrollTop).toBe(expected)
    measured.mockRestore()
  })

  it('입력창이 안내를 설명으로 읽고, 잠긴 동안에는 보낼 수 없으므로 보이지 않는다(#636)', () => {
    const note = '선택한 글 7자가 함께 보내져요.'
    const { rerender } = render(<ChatPanel messages={[]} onSend={() => true} sendNote={note} />)
    expect(box().getAttribute('aria-describedby')).toBe(screen.getByText(note).id)
    rerender(<ChatPanel messages={[]} onSend={() => true} sendNote={note} disabledReason="잠김" />)
    expect(screen.queryByText(note)).toBeNull()
  })
})

describe('공용 채팅 메시지', () => {
  it('역할별로 화자를 구분하고 텍스트와 첨부 칩을 그린다', () => {
    const messages: ChatMessage[] = [
      { id: 'a', role: 'user', text: '다음 장면을 이어 줘', attachments: [{ id: 'f1', kind: 'image', name: '표지.png' }, { id: 'f2', kind: 'text', name: '메모.md' }] },
      { id: 'b', role: 'assistant', text: '제안입니다.' },
      { id: 'c', role: 'system', text: '연결이 끊겼어요.' },
    ]
    render(<ChatPanel messages={messages} />)
    const log = screen.getByRole('log', { name: '대화 내용' })
    const rows = within(log).getAllByRole('listitem').filter(li => li.classList.contains('chat-msg'))
    expect(rows.map(li => li.className)).toEqual(['chat-msg user', 'chat-msg assistant', 'chat-msg system'])
    expect(rows.map(li => li.querySelector('.chat-who')?.textContent)).toEqual(['나', 'AI', '안내'])
    expect(within(rows[0]).getByText('다음 장면을 이어 줘')).toBeTruthy()
    expect(within(rows[0]).getByLabelText('첨부').textContent).toBe('이미지 · 표지.png텍스트 · 메모.md')
    expect(within(rows[1]).queryByLabelText('첨부')).toBeNull()
  })

  it('markdown 메시지만 마크다운으로 그리고 원시 HTML은 요소로 만들지 않는다(#492)', () => {
    render(<ChatPanel messages={[
      { id: 'a', role: 'assistant', text: '**모순**이 있어요. <b>x</b>', format: 'markdown' },
      { id: 'b', role: 'assistant', text: '**그대로**' },
    ]} />)
    expect(screen.getByText('모순').tagName).toBe('STRONG')
    expect(document.querySelector('.chat-md b')).toBeNull()
    expect(screen.getByText('**그대로**').tagName).toBe('P')
  })

  it('메시지가 없으면 안내 문구를 보인다', () => {
    render(<ChatPanel messages={[]} emptyText="아직 이야기가 없어요." />)
    expect(within(screen.getByRole('log')).getByText('아직 이야기가 없어요.')).toBeTruthy()
  })

  it('renderCard는 메시지 글 바로 아래·행동 위에 카드를 그리고, null이면 아무것도 더하지 않는다', () => {
    const messages: ChatMessage[] = [{ id: 'a', role: 'assistant', text: '제안입니다.' }, { id: 'b', role: 'assistant', text: '글만 있어요.' }]
    render(<ChatPanel messages={messages} renderCard={m => (m.id === 'a' ? <section aria-label="카드">내용</section> : null)} renderActions={() => <button type="button">행동</button>} />)
    const [first, second] = within(screen.getByRole('log')).getAllByRole('listitem').filter(li => li.classList.contains('chat-msg'))
    const bubble = first.querySelector('.chat-bubble')!
    expect([...bubble.children].map(el => el.className || el.tagName)).toEqual(['chat-who sr-only', 'chat-text', 'SECTION', 'BUTTON'])
    expect(within(second).queryByLabelText('카드')).toBeNull()
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
    expect(onSend).toHaveBeenCalledExactlyOnceWith('이어 써 줘', [])
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
    await waitFor(() => expect(onSend).toHaveBeenCalledExactlyOnceWith('안녕', []))
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
    await waitFor(() => expect(box().value).toBe('남겨 줘'))
    expect(onSend).toHaveBeenCalledTimes(1)
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
    expect(onSend).toHaveBeenCalledExactlyOnceWith('한 번만', [])
    expect(box().value).toBe('')
    await act(async () => { finish(true) })
    await waitFor(() => expect(box().value).toBe(''))
    type('다음')
    fireEvent.keyDown(box(), { key: 'Enter' })
    expect(onSend).toHaveBeenCalledTimes(2)
    expect(onSend).toHaveBeenLastCalledWith('다음', [])
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

  it('실패한 요청을 기다리며 입력을 바꿨으면 이전 요청을 복구하지 않는다', async () => {
    let finish!: (ok: boolean) => void
    render(<ChatPanel messages={[]} onSend={() => new Promise<boolean>(resolve => { finish = resolve })} />)
    type('이전 요청')
    fireEvent.click(send())
    type('새 글')
    type('')
    await act(async () => { finish(false) })
    expect(box().value).toBe('')
  })

  it('onSend가 거부되면 입력을 복구하고 실패를 알리며, 다시 쓰면 안내를 지우고 다시 보낼 수 있다', async () => {
    const onSend = vi.fn().mockRejectedValueOnce(new Error('연결 끊김')).mockResolvedValue(true)
    render(<ChatPanel messages={[]} onSend={onSend} />)
    type('실패할 글')
    fireEvent.keyDown(box(), { key: 'Enter' })
    expect((await screen.findByRole('alert')).textContent).toBe('메시지를 보내지 못했어요. 다시 시도해 주세요.')
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
  const png = (name = '지도.png') => new File(['x'], name, { type: 'image/png' })
  const note = (name = '메모.md') => new File(['북문은 밤에 닫힌다.'], name, { type: '' })
  const gif = () => new File(['x'], '움짤.gif', { type: 'image/gif' })
  const card = (container: HTMLElement) => container.querySelector('.chat-card')!
  const input = (container: HTMLElement, accept: string) => container.querySelector<HTMLInputElement>(`input[type="file"][accept="${accept}"]`)!
  const IMAGES = 'image/png,image/jpeg,image/webp'
  const TEXTS = '.txt,.md,text/plain,text/markdown'
  const chips = () => screen.queryByRole('list', { name: '보낼 첨부' })
  const drop = (container: HTMLElement, ...files: File[]) => fireEvent.drop(card(container), { dataTransfer: { files } })

  it('비활성 사유가 있으면 입력·전송·첨부를 모두 잠그고 사유를 카드 아래에 연결해 알린다', () => {
    const onSend = vi.fn()
    const { container } = render(<ChatPanel messages={[]} onSend={onSend} checkFile={checkAttachment} disabledReason="준비 중이에요." />)
    expect(box().disabled).toBe(true)
    expect(send().disabled).toBe(true)
    fireEvent.click(plus())
    expect(attachItem('이미지 첨부').disabled).toBe(true)
    expect(attachItem('텍스트 파일 첨부').disabled).toBe(true)
    expect(document.getElementById(box().getAttribute('aria-describedby') ?? '')?.textContent).toBe('준비 중이에요.')
    fireEvent.click(send())
    expect(onSend).not.toHaveBeenCalled()
    // 잠긴 동안 끌어다 놓아도 첨부하지 않고, 브라우저가 파일을 열어 화면을 떠나지도 않는다
    expect(drop(container, png())).toBe(false)
    expect(chips()).toBeNull()
  })

  it('잠긴 첨부 메뉴를 열면 초점이 메뉴로 들어가고 잠긴 사유가 메뉴 설명으로 읽힌다 (잠긴 항목은 초점을 받지 못한다)', () => {
    const { rerender } = render(<ChatPanel messages={[]} onSend={vi.fn()} checkFile={checkAttachment} disabledReason="준비 중이에요." />)
    fireEvent.click(plus())
    const menu = screen.getByRole('menu', { name: '첨부' })
    expect(document.activeElement).toBe(menu)
    expect(document.getElementById(menu.getAttribute('aria-describedby') ?? '')?.textContent).toBe('준비 중이에요.')
    fireEvent.keyDown(menu, { key: 'Escape' })
    // 첨부만 준비 중일 때는 popover 안의 안내가 메뉴 설명이 된다.
    rerender(<ChatPanel messages={[]} onSend={vi.fn()} />)
    fireEvent.click(plus())
    const soon = screen.getByRole('menu', { name: '첨부' })
    expect(document.activeElement).toBe(soon)
    expect(document.getElementById(soon.getAttribute('aria-describedby') ?? '')?.textContent).toBe('이미지·텍스트 파일 첨부는 준비 중이에요.')
  })

  it('전송 handler가 없으면 입력과 전송을 잠근다', () => {
    render(<ChatPanel messages={[]} />)
    expect(box().disabled).toBe(true)
    expect(send().disabled).toBe(true)
  })

  it('파일 검사 함수가 없으면 + 버튼 안의 첨부 항목을 준비 중 안내와 함께 잠그고, 안내는 popover 안에만 둔다', () => {
    const { container } = render(<ChatPanel messages={[]} onSend={vi.fn()} />)
    const note = '이미지·텍스트 파일 첨부는 준비 중이에요.'
    expect(plus().getAttribute('aria-haspopup')).toBe('menu')
    expect(plus().getAttribute('aria-expanded')).toBe('false')
    expect(screen.queryByText(note)).toBeNull()
    fireEvent.click(plus())
    expect(plus().getAttribute('aria-expanded')).toBe('true')
    for (const name of ['이미지 첨부', '텍스트 파일 첨부']) {
      const item = attachItem(name)
      expect(item.disabled).toBe(true)
      expect(document.getElementById(item.getAttribute('aria-describedby') ?? '')?.textContent).toBe(note)
    }
    expect(screen.getAllByText(note)).toHaveLength(1)
    // 첨부가 꺼진 화면은 파일 선택 칸도 없고, 파일을 끌어다 놓아도 아무것도 가로채지 않는다
    expect(container.querySelector('input[type="file"]')).toBeNull()
    expect(fireEvent.dragOver(card(container))).toBe(true)
    // 마이크는 항상 준비 중이라 잠겨 있다
    expect((screen.getByRole('button', { name: '음성 입력 (준비 중)' }) as HTMLButtonElement).disabled).toBe(true)
    // Escape로 닫으면 + 버튼으로 초점이 돌아온다
    fireEvent.keyDown(plus(), { key: 'Escape' })
    expect(screen.queryByRole('menu')).toBeNull()
    expect(document.activeElement).toBe(plus())
  })

  it('+ 메뉴의 이미지·텍스트 항목은 각자의 형식만 고르는 파일 선택을 열고, 고른 파일을 칩으로 보인다', () => {
    const { container } = render(<ChatPanel messages={[]} onSend={vi.fn()} checkFile={checkAttachment} />)
    expect(chips()).toBeNull()
    fireEvent.click(plus())
    expect(attachItem('이미지 첨부').disabled).toBe(false)
    const images = input(container, IMAGES)
    const pick = vi.spyOn(images, 'click')
    fireEvent.click(attachItem('이미지 첨부'))
    expect(pick).toHaveBeenCalledTimes(1)
    expect(screen.queryByRole('menu')).toBeNull()
    fireEvent.change(images, { target: { files: [png()] } })
    expect(images.value).toBe('')
    fireEvent.click(plus())
    const texts = input(container, TEXTS)
    const pickText = vi.spyOn(texts, 'click')
    fireEvent.click(attachItem('텍스트 파일 첨부'))
    expect(pickText).toHaveBeenCalledTimes(1)
    fireEvent.change(texts, { target: { files: [note()] } })
    expect(within(chips()!).getAllByRole('listitem').map(li => li.textContent)).toEqual(['이미지 · 지도.png×', '텍스트 · 메모.md×'])
    expect(screen.queryByRole('alert')).toBeNull()
  })

  it('입력 카드에 끌어다 놓은 파일도 같은 검사를 거쳐 칩이 된다', () => {
    const { container } = render(<ChatPanel messages={[]} onSend={vi.fn()} checkFile={checkAttachment} />)
    expect(fireEvent.dragOver(card(container))).toBe(false) // preventDefault: 놓을 수 있다
    drop(container, png(), note())
    expect(within(chips()!).getAllByRole('listitem').map(li => li.textContent)).toEqual(['이미지 · 지도.png×', '텍스트 · 메모.md×'])
  })

  it('지원하지 않는 형식·5MB 초과·3개 초과는 입력 카드 아래에 이유를 알리고 그 파일만 받지 않는다', () => {
    const { container } = render(<ChatPanel messages={[]} onSend={vi.fn()} checkFile={checkAttachment} />)
    const big = new File([new Uint8Array(5 * 1024 * 1024 + 1)], '큰.png', { type: 'image/png' })
    drop(container, gif(), big, png('a.png'), png('b.png'), png('c.png'), png('d.png'))
    expect(within(chips()!).getAllByRole('listitem').map(li => li.textContent)).toEqual(['이미지 · a.png×', '이미지 · b.png×', '이미지 · c.png×'])
    expect(screen.getAllByRole('alert').map(a => a.textContent)).toEqual([
      '움짤.gif: 지원하지 않는 형식이에요. PNG·JPEG·WEBP 이미지와 .txt·.md 텍스트 파일만 첨부할 수 있어요.',
      '큰.png: 5MB 이하 파일만 첨부할 수 있어요.',
      'd.png: 한 메시지에 3개까지만 첨부할 수 있어요.',
    ])
    expect(card(container).nextElementSibling?.getAttribute('role')).toBe('alert') // 입력 카드 바로 아래
    // 다음에 고른 파일이 받아지면 이전 거절 안내는 지워진다
    fireEvent.click(within(chips()!).getByRole('button', { name: 'a.png 빼기' }))
    drop(container, note())
    expect(screen.queryByRole('alert')).toBeNull()
  })

  it('칩의 ×로 첨부를 빼고, 다 빼면 칩 줄이 사라진다', () => {
    const { container } = render(<ChatPanel messages={[]} onSend={vi.fn()} checkFile={checkAttachment} />)
    drop(container, png(), note())
    fireEvent.click(screen.getByRole('button', { name: '지도.png 빼기' }))
    expect(within(chips()!).getAllByRole('listitem').map(li => li.textContent)).toEqual(['텍스트 · 메모.md×'])
    fireEvent.click(screen.getByRole('button', { name: '메모.md 빼기' }))
    expect(chips()).toBeNull()
  })

  it('첨부 없이 보내면 빈 목록과 함께 글만 보낸다', async () => {
    const onSend = vi.fn().mockResolvedValue(true)
    render(<ChatPanel messages={[]} onSend={onSend} checkFile={checkAttachment} />)
    type('첨부 없는 질문')
    fireEvent.click(send())
    await waitFor(() => expect(onSend).toHaveBeenCalledExactlyOnceWith('첨부 없는 질문', []))
  })

  it('글은 첨부와 별개로 필수라 첨부만 있으면 보내지 못한다', () => {
    const onSend = vi.fn()
    const { container } = render(<ChatPanel messages={[]} onSend={onSend} checkFile={checkAttachment} />)
    drop(container, png())
    expect(send().disabled).toBe(true)
    fireEvent.submit(box().closest('form')!)
    expect(onSend).not.toHaveBeenCalled()
  })

  it('고른 파일을 글과 함께 넘기고, 전송이 시작되면 입력창과 칩을 비운다', async () => {
    let finish!: (sent: boolean) => void
    const onSend = vi.fn(() => new Promise<boolean>(resolve => { finish = resolve }))
    const { container } = render(<ChatPanel messages={[]} onSend={onSend} checkFile={checkAttachment} />)
    const file = png()
    drop(container, file)
    type('이 지도를 봐줘')
    fireEvent.click(send())
    expect(onSend).toHaveBeenCalledExactlyOnceWith('이 지도를 봐줘', [file])
    expect(chips()).toBeNull()
    expect(box().value).toBe('')
    await act(async () => finish(true))
    expect(chips()).toBeNull()
  })

  it('전송이 실패하면 글과 첨부를 그대로 되돌려 다시 보낼 수 있다', async () => {
    const onSend = vi.fn().mockResolvedValueOnce(false).mockResolvedValue(true)
    const { container } = render(<ChatPanel messages={[]} onSend={onSend} checkFile={checkAttachment} />)
    const file = png()
    drop(container, file)
    type('이 지도를 봐줘')
    fireEvent.click(send())
    await waitFor(() => expect(box().value).toBe('이 지도를 봐줘'))
    expect(within(chips()!).getAllByRole('listitem').map(li => li.textContent)).toEqual(['이미지 · 지도.png×'])
    fireEvent.click(send())
    await waitFor(() => expect(onSend).toHaveBeenLastCalledWith('이 지도를 봐줘', [file]))
  })

  it('전송하는 사이 새로 고른 첨부가 있으면 전송이 실패해도 그 첨부를 지키고 이전 첨부로 덮지 않는다', async () => {
    let finish!: (sent: boolean) => void
    const onSend = vi.fn(() => new Promise<boolean>(resolve => { finish = resolve }))
    const { container } = render(<ChatPanel messages={[]} onSend={onSend} checkFile={checkAttachment} />)
    drop(container, png('a.png'), png('b.png'))
    type('질문')
    fireEvent.click(send())
    drop(container, png('c.png'), png('d.png'), png('e.png'))
    expect(within(chips()!).getAllByRole('listitem').map(li => li.textContent)).toEqual(['이미지 · c.png×', '이미지 · d.png×', '이미지 · e.png×'])
    await act(async () => finish(false))
    // 새로 고른 첨부가 있으면 그것을 지키고 실패한 요청의 첨부는 되돌리지 않는다(새 입력을 덮지 않는다)
    expect(within(chips()!).getAllByRole('listitem').map(li => li.textContent)).toEqual(['이미지 · c.png×', '이미지 · d.png×', '이미지 · e.png×'])
  })
})
