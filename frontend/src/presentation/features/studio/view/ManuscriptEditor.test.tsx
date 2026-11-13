// @vitest-environment jsdom
import { act, cleanup, createEvent, fireEvent, render, screen, waitFor } from '@testing-library/react'
import type { Editor } from '@tiptap/core'
import { createRef, useState } from 'react'
import { afterEach, beforeAll, expect, it, vi } from 'vitest'

import { imageMarker } from '../../../../domain/entities/media'
import { stubRangeGeometry } from '../../../../test/rangeGeometry'
import { ManuscriptEditor, type ManuscriptEditorHandle } from './ManuscriptEditor'

const IMAGE = 'e25ffb25-8128-48c0-8d66-e1d56831cd56'
vi.mock('../../../shared/media/MediaPanel', () => ({ StoredImage: ({ id, alt }: { id: string; alt: string }) => <span role="img" aria-label="본문 이미지" data-id={id} data-alt={alt} /> }))

beforeAll(stubRangeGeometry)
afterEach(() => { cleanup(); vi.restoreAllMocks() })

type Dom = HTMLElement & { editor: Editor }
const surface = () => screen.getByLabelText('원고 본문') as Dom
const editor = () => surface().editor
const lines = () => Array.from(surface().querySelectorAll(':scope > p, :scope > .node-episodeImage')).map(el => el.tagName === 'P' ? el.textContent : `(이미지 ${el.querySelector<HTMLElement>('[role="img"]')?.dataset.id})`)

/** vm.addImage가 하는 일(업로드 성공 뒤 `\n\n표식\n\n`을 [start,end) 자리에 넣는다)을 흉내 내는 부모 */
function Harness({ initial, editable = true, onImage, onBody, handle }: {
  initial: string; editable?: boolean; onImage?: (file: File, start: number, end: number) => void; onBody?: (body: string) => void; handle?: React.Ref<ManuscriptEditorHandle>
}) {
  const [body, setBody] = useState(initial)
  return <ManuscriptEditor value={body} editable={editable} workId="work" number={1} ref={handle}
    onChange={next => { onBody?.(next); setBody(next) }}
    onImage={async (file, start, end) => {
      onImage?.(file, start, end)
      setBody(b => b.slice(0, start) + `\n\n${imageMarker(IMAGE)}\n\n` + b.slice(end))
      return true
    }} />
}
const png = () => new File(['png'], '본문.png', { type: 'image/png' })

it('원고를 문단과 이미지 블록으로 그리고 접근성 이름 원고 본문의 편집 영역을 만든다', async () => {
  render(<Harness initial={`앞 문단\n\n${imageMarker(IMAGE)}\n뒤 문단`} />)
  // 이미지 블록은 React 노드 뷰라 마운트 직후 비동기로 그려진다. 같은 원고 안에서 기존 StoredImage로 실제 이미지를 그린다.
  expect(await screen.findByRole('img', { name: '본문 이미지' })).toBeTruthy()
  const box = surface()
  expect(box.getAttribute('role')).toBe('textbox')
  expect(box.getAttribute('aria-multiline')).toBe('true')
  expect(box.getAttribute('contenteditable')).toBe('true')
  expect(box.getAttribute('aria-readonly')).toBe('false')
  expect(lines()).toEqual(['앞 문단', '', `(이미지 ${IMAGE})`, '뒤 문단'])
})

it('빈 본문에는 이야기를 이어 써 보세요 안내를 보이고 입력이 있으면 지운다', () => {
  render(<Harness initial="" />)
  expect(surface().querySelector('p')!.getAttribute('data-placeholder')).toBe('이야기를 이어 써 보세요')
  expect(surface().querySelector('p.is-editor-empty')).not.toBeNull()
  cleanup()
  render(<Harness initial="글" />)
  expect(surface().querySelector('p.is-editor-empty')).toBeNull()
})

it('입력을 저장 형식의 본문 문자열로 바꿔 알린다: 한 줄이 한 문단이고 빈 줄도 남는다', () => {
  const onBody = vi.fn()
  render(<Harness initial="첫째" onBody={onBody} />)
  act(() => { editor().chain().focus('end').insertContent([{ type: 'paragraph' }, { type: 'paragraph', content: [{ type: 'text', text: '셋째' }] }]).run() })
  expect(onBody).toHaveBeenLastCalledWith('첫째\n\n셋째')
  // 부모가 같은 값을 돌려줘도 편집기를 다시 만들지 않는다: 문서와 커서가 그대로다.
  expect(lines()).toEqual(['첫째', '', '셋째'])
})

it('굵게·제목·목록 같은 서식은 만들 수 없고 붙여넣은 서식은 글자만 남는다', () => {
  const onBody = vi.fn()
  render(<Harness initial="" onBody={onBody} />)
  expect(Object.keys(editor().schema.nodes).sort()).toEqual(['doc', 'episodeImage', 'paragraph', 'text'])
  expect(Object.keys(editor().schema.marks)).toEqual([])
  const html = '<h1>제목</h1><p><b>굵게</b> 글</p><ul><li>목록</li></ul>'
  const paste = createEvent.paste(surface(), { clipboardData: { files: [], getData: (type: string) => (type === 'text/html' ? html : '제목\n굵게 글\n목록') } })
  fireEvent(surface(), paste)
  expect(onBody).toHaveBeenLastCalledWith('제목\n굵게 글\n목록')
  expect(surface().querySelectorAll('h1, b, strong, ul, li')).toHaveLength(0)
})

it('붙여넣은 일반 텍스트의 빈 줄을 합치지 않고 저장 형식 그대로 둔다', () => {
  const onBody = vi.fn()
  render(<Harness initial="" onBody={onBody} />)
  fireEvent.paste(surface(), { clipboardData: { files: [], getData: (type: string) => (type === 'text/plain' ? '첫 문단\n\n둘째 문단\n셋째' : '') } })
  expect(onBody).toHaveBeenLastCalledWith('첫 문단\n\n둘째 문단\n셋째')
})

it('복사한 글자는 문단 사이를 한 줄바꿈으로, 이미지는 표식 한 줄로 내보낸다', () => {
  render(<Harness initial={`가\n${imageMarker(IMAGE)}\n나`} />)
  const data: Record<string, string> = {}
  act(() => { editor().commands.selectAll() })
  fireEvent.copy(surface(), { clipboardData: { setData: (type: string, value: string) => { data[type] = value }, clearData: () => {} } })
  expect(data['text/plain']).toBe(`가\n${imageMarker(IMAGE)}\n나`)
})

it('40,000자를 넘는 입력은 막고 안내하며 지우는 입력은 늘 허용한다', () => {
  const onBody = vi.fn()
  render(<Harness initial={'가'.repeat(40000)} onBody={onBody} />)
  act(() => { editor().chain().focus('end').insertContent('나').run() })
  expect(onBody).not.toHaveBeenCalled()
  expect(surface().textContent).toHaveLength(40000)
  expect(screen.getByRole('status').textContent).toBe('40,000자를 넘는 입력은 넣을 수 없어요.')
  act(() => { editor().chain().focus('end').deleteRange({ from: editor().state.doc.content.size - 3, to: editor().state.doc.content.size - 1 }).run() })
  expect(onBody).toHaveBeenCalledOnce()
  expect(onBody.mock.calls[0][0]).toHaveLength(39998)
  expect(screen.getByRole('status').textContent).toBe('')
})

it('붙여넣은 HTML의 이미지 블록은 서버 이미지 id(UUID)일 때만 받는다', async () => {
  render(<Harness initial="" />)
  act(() => { editor().commands.setContent(`<div data-episode-image="../x"></div><div data-episode-image="${IMAGE}"></div>`) })
  expect(await screen.findAllByRole('img', { name: '본문 이미지' })).toHaveLength(1)
})

it('이미지 표식은 46자로 세어 40,000자 한도 안에 남지 않는 이미지 블록 입력도 막는다', () => {
  const onBody = vi.fn()
  render(<Harness initial={'가'.repeat(39990)} onBody={onBody} />)
  act(() => { editor().chain().focus('end').insertContent({ type: 'episodeImage', attrs: { imageId: IMAGE } }).run() })
  expect(onBody).not.toHaveBeenCalled()
})

it('읽기 전용(원작 기준·저장 중)이면 편집할 수 없고 붙여넣거나 끌어다 놓은 이미지도 올리지 않는다', () => {
  const onImage = vi.fn()
  const { rerender } = render(<Harness initial="원작 글" editable={false} onImage={onImage} />)
  expect(surface().getAttribute('contenteditable')).toBe('false')
  expect(surface().getAttribute('aria-readonly')).toBe('true')
  fireEvent.paste(surface(), { clipboardData: { files: [png()], getData: () => '' } })
  expect(onImage).not.toHaveBeenCalled()
  rerender(<Harness initial="원작 글" editable />)
  expect(surface().getAttribute('contenteditable')).toBe('true')
  expect(surface().getAttribute('aria-readonly')).toBe('false')
})

it('이미지 파일을 붙여넣으면 커서의 본문 위치와 함께 기존 업로드 경로로 올리고 이미지를 그린다', async () => {
  const onImage = vi.fn()
  render(<Harness initial={'앞뒤'} onImage={onImage} />)
  act(() => { editor().commands.setTextSelection(2) }) // "앞|뒤"
  const file = png()
  const event = createEvent.paste(surface(), { clipboardData: { files: [file], getData: () => '' } })
  fireEvent(surface(), event)
  expect(event.defaultPrevented).toBe(true)
  expect(onImage).toHaveBeenCalledExactlyOnceWith(file, 1, 1)
  await waitFor(() => expect(lines()).toEqual(['앞', '', `(이미지 ${IMAGE})`, '', '뒤']))
  // 커서는 이미지 다음 글 줄 맨 앞에 놓이고 새 편집기에서 바로 입력을 이어 갈 수 있다.
  expect(editor().state.selection.$from.parent.textContent).toBe('뒤')
  expect(editor().state.selection.$from.parentOffset).toBe(0)
  expect(document.activeElement).toBe(surface())
})

it('이미지 파일을 끌어다 놓으면 놓은 자리의 본문 위치에 올린다(이미지가 아닌 파일·내부 이동은 건드리지 않는다)', async () => {
  const onImage = vi.fn()
  render(<Harness initial={'첫째\n둘째'} onImage={onImage} />)
  vi.spyOn(editor().view, 'posAtCoords').mockReturnValue({ pos: 2, inside: -1 }) // 첫째 문단의 '첫|째'
  const file = png()
  const drop = createEvent.drop(surface(), { dataTransfer: { files: [file], types: ['Files'], getData: () => '' }, clientX: 1, clientY: 1 })
  fireEvent(surface(), drop)
  expect(drop.defaultPrevented).toBe(true)
  expect(onImage).toHaveBeenCalledExactlyOnceWith(file, 1, 1)
  await waitFor(() => expect(lines()).toEqual(['첫', '', `(이미지 ${IMAGE})`, '', '째', '둘째']))
  onImage.mockClear()
  // 이미지가 들어가며 편집기가 새로 만들어졌으니 새 view에 다시 건다.
  vi.spyOn(editor().view, 'posAtCoords').mockReturnValue({ pos: 2, inside: -1 })
  fireEvent.drop(surface(), { dataTransfer: { files: [new File(['x'], 'a.pdf', { type: 'application/pdf' })], types: ['Files'], getData: () => '' }, clientX: 1, clientY: 1 })
  expect(onImage).not.toHaveBeenCalled()
})

it('첨부 버튼 같은 바깥 동작은 핸들의 addImage로 커서 위치에 올리고, 실패하면 본문을 그대로 두고 편집기로 초점을 돌린다', async () => {
  const handle = createRef<ManuscriptEditorHandle>()
  const onImage = vi.fn()
  render(<Harness initial="가나" onImage={onImage} handle={handle} />)
  act(() => { editor().commands.setTextSelection({ from: 1, to: 2 }) }) // "가" 선택
  let ok = false
  await act(async () => { ok = await handle.current!.addImage(png(), false) })
  expect(ok).toBe(true)
  expect(onImage).toHaveBeenCalledExactlyOnceWith(expect.any(File), 0, 1)
  await waitFor(() => expect(lines()).toEqual(['', '', `(이미지 ${IMAGE})`, '', '나']))
  // 시트처럼 편집기 밖에서 부른 경우(focus=false)에는 초점을 가져오지 않는다.
  expect(document.activeElement).not.toBe(surface())
})

it('이미지 올리기가 실패하면 본문과 편집기를 그대로 두고 초점만 돌려준다', async () => {
  const handle = createRef<ManuscriptEditorHandle>()
  render(<ManuscriptEditor value="가나" editable workId="work" number={1} onChange={() => {}} onImage={async () => false} ref={handle} />)
  const before = surface()
  let ok = true
  await act(async () => { ok = await handle.current!.addImage(png()) })
  expect(ok).toBe(false)
  expect(surface()).toBe(before)
  expect(lines()).toEqual(['가나'])
  expect(document.activeElement).toBe(surface())
})

it('편집기 밖에서 본문이 바뀌면(회차 전환·다시 불러오기) 새 문서로 보고 되돌리기가 이전 글을 되살리지 않는다', () => {
  const onBody = vi.fn()
  const view = render(<ManuscriptEditor value="첫째 회차 글" editable workId="work" number={1} onChange={onBody} onImage={async () => true} />)
  act(() => { editor().chain().focus('end').insertContent('!').run() })
  expect(onBody).toHaveBeenLastCalledWith('첫째 회차 글!')
  view.rerender(<ManuscriptEditor value="둘째 회차 글" editable workId="work" number={2} onChange={onBody} onImage={async () => true} />)
  expect(lines()).toEqual(['둘째 회차 글'])
  onBody.mockClear()
  act(() => { editor().commands.undo() })
  expect(lines()).toEqual(['둘째 회차 글'])
  expect(onBody).not.toHaveBeenCalled()
})

it('본문 이미지마다 원고 안 순서를 대체 텍스트에 붙여 여러 장을 구분한다', async () => {
  const SECOND = '6f0c6c4e-8f4a-4d0b-9d52-1c3b5a7e9f10'
  render(<Harness initial={`${imageMarker(IMAGE)}\n사이 문단\n${imageMarker(SECOND)}`} />)
  await waitFor(() => expect(screen.getAllByRole('img')).toHaveLength(2))
  expect(screen.getAllByRole('img').map(image => [image.dataset.id, image.dataset.alt])).toEqual([[IMAGE, '본문 이미지 1'], [SECOND, '본문 이미지 2']])
})
