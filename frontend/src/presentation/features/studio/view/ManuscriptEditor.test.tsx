// @vitest-environment jsdom
import type { Editor } from '@toast-ui/editor'
import { act, cleanup, createEvent, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { createRef, StrictMode, Suspense, useState, type ReactNode, type Ref } from 'react'
import { Provider } from 'react-redux'
import { afterEach, beforeAll, beforeEach, expect, it, vi } from 'vitest'

import { createAppStore } from '../../../../app/store'
import { imageMarker } from '../../../../domain/entities/media'
import { stubRangeGeometry } from '../../../../test/rangeGeometry'
import { MarkdownEditor } from '../../../shared/MarkdownEditor'
import { uiActions } from '../../../shared/ui/uiSlice'
import { LazyManuscriptEditor } from './LazyManuscriptEditor'
import { ManuscriptEditor, type ManuscriptEditorHandle } from './ManuscriptEditor'

/**
 * 실제 Toast UI Editor를 쓰되 만들어질 때의 옵션과 인스턴스를 붙잡는 하위 클래스로 바꾼다(jsdom에서도 만들어진다).
 * 사용자가 타자를 치는 입력(ProseMirror)은 jsdom에서 흉내 낼 수 없어 편집기 메서드(insertText·setSelection·exec)와 툴바 클릭·붙여넣기 이벤트로 글을 바꾼다.
 */
const made = vi.hoisted(() => ({ options: [] as Record<string, unknown>[], editors: [] as Editor[], destroyed: [] as Editor[] }))
vi.mock('@toast-ui/editor', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@toast-ui/editor')>()
  class Spy extends actual.default {
    constructor(options: ConstructorParameters<typeof actual.default>[0]) {
      super(options)
      made.options.push({ ...options })
      made.editors.push(this)
    }

    destroy() {
      made.destroyed.push(this)
      super.destroy()
    }
  }
  return { ...actual, default: Spy }
})

const IMAGE = 'e25ffb25-8128-48c0-8d66-e1d56831cd56'
const SECOND = '6f0c6c4e-8f4a-4d0b-9d52-1c3b5a7e9f10'
const MARK = imageMarker(IMAGE)
// 이미지는 기존 StoredImage가, 미리보기는 공용 ManuscriptBody가 그린다: 여기서는 무엇을 받는지와 화면에 올라와 있는 이미지 수만 본다.
const mounted = vi.hoisted(() => ({ images: 0 }))
vi.mock('../../../shared/media/MediaPanel', async () => {
  const { useEffect } = await import('react')
  return {
    StoredImage: ({ id, alt }: { id: string; alt: string }) => {
      useEffect(() => { mounted.images += 1; return () => { mounted.images -= 1 } }, [])
      return <span role="img" aria-label={alt} data-id={id} />
    },
    ManuscriptBody: ({ workId, number, body }: { workId: string; number: number; body: string }) => <div data-testid="preview" data-work={workId} data-number={number}>{body}</div>,
  }
})

beforeAll(stubRangeGeometry)
beforeEach(() => { made.options.length = made.editors.length = made.destroyed.length = 0 })
afterEach(() => { cleanup(); vi.restoreAllMocks() })

const store = createAppStore()
const draw = (ui: ReactNode) => <Provider store={store}>{ui}</Provider>
/** 지금 화면의 Toast 편집기 */
const toast = () => made.editors[made.editors.length - 1]
const surface = () => screen.getByRole('textbox', { name: '원고 본문' })
/** Toast가 그려지는 자리(툴바 + 편집 영역) */
const host = () => document.querySelector<HTMLElement>('.manuscript-editor .writing-body')!
const lines = () => Array.from(surface().children, (line) => { const image = line.querySelector<HTMLElement>('.manuscript-image'); return image ? `(이미지 ${image.dataset.imageId})` : line.textContent })
// jsdom은 폭을 0으로 재서 Toast가 툴바 항목을 모두 '더 보기' 접힘 안에 둔다. 역할 대신 이름으로 직접 찾는다.
const tool = (name: string) => host().querySelector<HTMLButtonElement>(`button[aria-label="${name}"]`)!
const status = () => screen.getByRole('status')
const end = () => act(() => { toast().moveCursorToEnd(false) })
const type = (text: string) => act(() => { toast().insertText(text) })
const select = (from: [number, number], to = from) => act(() => { toast().setSelection(from, to) })
const png = () => new File(['png'], '본문.png', { type: 'image/png' })

type HarnessProps = {
  initial: string; editable?: boolean; busy?: boolean; upload?: boolean
  onImage?: (file: File, start: number, end: number) => void; onBody?: (body: string) => void; handle?: Ref<ManuscriptEditorHandle>
}
/** vm.addImage가 하는 일(업로드 성공 뒤 `\n\n표식\n\n`을 [start,end) 자리에 넣는다)을 흉내 내는 부모 */
function Harness({ initial, editable = true, busy = false, upload = true, onImage, onBody, handle }: HarnessProps) {
  const [body, setBody] = useState(initial)
  return <ManuscriptEditor value={body} editable={editable} busy={busy} workId="work" number={1} ref={handle}
    onChange={next => { onBody?.(next); setBody(next) }}
    onImage={async (file, start, end) => {
      onImage?.(file, start, end)
      if (upload) setBody(b => b.slice(0, start) + `\n\n${MARK}\n\n` + b.slice(end))
      return upload
    }} />
}

it('원고를 문단과 이미지 블록으로 그리고 접근성 이름 원고 본문의 편집 영역을 만든다', async () => {
  const body = `앞 문단\n\n${MARK}\n뒤 문단`
  render(draw(<Harness initial={body} />))
  // 이미지 표식 줄은 편집 영역에서 기존 StoredImage로 실제 이미지가 된다(위젯 자리를 찾은 다음 렌더에 그린다).
  expect(await screen.findByRole('img', { name: '본문 이미지 1' })).toBeTruthy()
  const box = surface()
  expect(box.classList.contains('ProseMirror')).toBe(true)
  expect(box.getAttribute('aria-multiline')).toBe('true')
  expect(box.getAttribute('contenteditable')).toBe('true')
  expect(box.getAttribute('aria-readonly')).toBe('false')
  expect(lines()).toEqual(['앞 문단', '', `(이미지 ${IMAGE})`, '뒤 문단'])
  // 이미지로 보여도 저장 글은 표식 글자 그대로다.
  expect(toast().getMarkdown()).toBe(body)
})

it('늦게 불러오는 래퍼(LazyManuscriptEditor)로도 같은 편집기가 뜨고 핸들(addImage)이 이어진다', async () => {
  const handle = createRef<ManuscriptEditorHandle>()
  const onImage = vi.fn(async () => false)
  render(draw(<Suspense fallback={<p>불러오는 중</p>}><LazyManuscriptEditor ref={handle} value="글" editable workId="work" number={1} onChange={() => {}} onImage={onImage} /></Suspense>))
  expect(await screen.findByRole('textbox', { name: '원고 본문' })).toBeTruthy()
  expect(toast().getMarkdown()).toBe('글')
  await act(async () => { await handle.current!.addImage(png(), false) })
  expect(onImage).toHaveBeenCalledExactlyOnceWith(expect.any(File), 0, 0)
})

it('마크다운 쓰기 모드로 만들고 통계 전송·자동 초점·위지윅 전환을 끄며 글 높이만큼 자라게 한다', () => {
  render(draw(<Harness initial="글" />))
  expect(made.options).toHaveLength(1)
  expect(made.options[0]).toMatchObject({
    initialEditType: 'markdown', hideModeSwitch: true, usageStatistics: false, autofocus: false, language: 'ko-KR', height: 'auto',
    placeholder: '이야기를 이어 써 보세요',
  })
  expect(made.options[0].el).toBe(host())
  expect(toast().getMarkdown()).toBe('글')
})

it('빈 본문에는 이야기를 이어 써 보세요 안내를 보이고 입력이 있으면 지운다', () => {
  render(draw(<Harness initial="" />))
  expect(surface().querySelector('.placeholder')?.textContent).toBe('이야기를 이어 써 보세요')
  cleanup()
  render(draw(<Harness initial="글" />))
  expect(surface().querySelector('.placeholder')).toBeNull()
})

it('입력을 저장 형식의 본문 문자열로 바꿔 알린다: 한 줄이 한 문단이고 빈 줄도 남는다', () => {
  const onBody = vi.fn()
  render(draw(<Harness initial="첫째" onBody={onBody} />))
  end()
  type('\n\n셋째')
  expect(onBody).toHaveBeenLastCalledWith('첫째\n\n셋째')
  // 부모가 같은 값을 돌려줘도 편집기를 다시 만들지 않는다: 문서와 커서가 그대로다.
  expect(lines()).toEqual(['첫째', '', '셋째'])
  expect(made.editors).toHaveLength(1)
})

const ROUND_TRIP = [
  '', ' ', '\n', '\n앞\n', '\n\n\n', '  앞 공백\n뒤 공백  \n\t탭', '첫째\n\n\n셋째\n', MARK, `앞\n\n${MARK}\n\n뒤`, `앞 ${MARK} 뒤`, ` ${MARK} `,
  `${MARK}\n본문\n${imageMarker(SECOND)}`, `${MARK}\n${imageMarker(SECOND)}\n${MARK}`, `앞\n${imageMarker(IMAGE.toUpperCase())}\n뒤`, '😀 한글 ‘따옴표’ <b>태그</b> & [[대괄호]]',
  '**굵게** *기울임* ***둘***\n## 제목\n> 인용\n---\n***', '2 * 3 * 4\n**짝 없음\n별표 \\*글자\\*',
  '- 목록\n1. 번호\n`코드`\n<b>태그</b>\n| 표 | 칸 |\n~~취소~~\n[링크](http://x)', '\u3000전각 공백\u00a0', `[[IMAGE:${IMAGE}]]`, '    들여쓴 줄\n```\n코드\n```',
]
it.each(ROUND_TRIP)('열기만 해서는 onChange를 부르지 않고 불러온 직후의 글이 저장한 글과 같으며 고친 곳 말고는 그대로다: %j', (body) => {
  const onBody = vi.fn()
  render(draw(<Harness initial={body} onBody={onBody} />))
  expect(toast().getMarkdown()).toBe(body)
  expect(onBody).not.toHaveBeenCalled()
  end()
  type('!')
  expect(onBody).toHaveBeenLastCalledWith(`${body}!`)
})

it('Toast 내부 표기와 같은 글자($$widget0 …$$)가 든 원고는 고치면 그 글자를 잃으므로 편집을 받지 않고 이유를 알린다', () => {
  const onBody = vi.fn()
  const onImage = vi.fn(async () => true)
  const body = '앞 줄\n$$widget0 글$$'
  render(draw(<Harness initial={body} onBody={onBody} onImage={onImage} />))
  expect(status().textContent).toBe('이 원고에는 편집기가 그대로 둘 수 없는 표기($$widget…$$)가 있어 여기서는 고칠 수 없어요.')
  end()
  type('!')
  act(() => { toast().deleteSelection([1, 1], [1, 2]) })
  fireEvent.click(tool('굵게'))
  // 편집 영역의 글은 그대로이고 저장으로 이어지는 onChange도, 이미지 올리기도 일어나지 않는다.
  expect(toast().getMarkdown()).toBe('앞 줄\n글')
  expect(onBody).not.toHaveBeenCalled()
  fireEvent.paste(surface(), { clipboardData: { getData: () => '', files: [png()] } })
  expect(onImage).not.toHaveBeenCalled()
})

it('40,000자 본문도 그대로 돌아온다', () => {
  const lines = ('가'.repeat(99) + '\n').repeat(400)
  const withImage = ('가'.repeat(99) + '\n').repeat(399) + '가'.repeat(53) + '\n' + imageMarker(SECOND)
  for (const body of [lines, withImage]) {
    expect(body).toHaveLength(40000)
    const onBody = vi.fn()
    render(draw(<Harness initial={body} onBody={onBody} />))
    expect(toast().getMarkdown()).toBe(body)
    expect(onBody).not.toHaveBeenCalled()
    cleanup()
  }
})

// Toast의 구문 강조는 문서 끝의 들여쓴 코드 울타리(공백 두 칸 + ```)에서 범위를 잘못 계산해 예외를 던진다(편집기를 만들다 죽거나, 입력 중이면 Toast의 글만 바뀐다).
it('Toast의 구문 강조가 실패하는 글도 그대로 열리고, 그런 글이 되는 입력도 화면의 글과 편집기가 내는 글이 같다', () => {
  const onBody = vi.fn()
  const poison = '앞\n  ```'
  render(draw(<Harness initial={poison} onBody={onBody} />))
  expect(lines()).toEqual(['앞', '  ```'])
  expect(toast().getMarkdown()).toBe(poison)
  expect(onBody).not.toHaveBeenCalled()
  end()
  type('!')
  expect(onBody).toHaveBeenLastCalledWith(`${poison}!`)
  cleanup()
  onBody.mockClear()
  render(draw(<Harness initial={'앞\n  ``'} onBody={onBody} />))
  end()
  type('`')
  expect(lines()).toEqual(['앞', '  ```'])
  expect(toast().getMarkdown()).toBe(poison)
  expect(onBody).toHaveBeenLastCalledWith(poison)
})

// 왕복이 어긋나는 입력(알려진 한계): Toast는 CR 줄바꿈을 LF로 읽고, 자기 위젯 표기(`$$widget0 …$$`)와 같은 글자를 벗겨 읽는다. 열기만 해서는 저장하지 않으므로 고치기 전에는 서버 글이 바뀌지 않는다.
it.each([['a\r\nb', 'a\nb'], ['a\rb', 'a\nb'], ['$$widget0 글$$', '글']])('알려진 한계: %j는 %j로 읽힌다(고치기 전에는 onChange를 부르지 않는다)', (body, read) => {
  const onBody = vi.fn()
  render(draw(<Harness initial={body} onBody={onBody} />))
  expect(toast().getMarkdown()).toBe(read)
  expect(onBody).not.toHaveBeenCalled()
})

it('툴바는 굵게·기울임 | 소제목·인용·구분선 | 이미지 여섯 개뿐이고 Toast의 제목 단계·이미지 주소 팝업과 자체 탭은 쓰지 않는다', () => {
  render(draw(<Harness initial="글" />))
  const names = Array.from(host().querySelectorAll('.toastui-editor-defaultUI-toolbar button:not(.more)'), (button) => button.getAttribute('aria-label'))
  expect(names).toEqual(['굵게', '기울임', '소제목', '인용', '구분선', '이미지'])
  const groups = made.options[0].toolbarItems as { name: string; command?: string; popup?: unknown; el?: HTMLElement }[][]
  expect(groups.map((group) => group.map((item) => item.name))).toEqual([['bold', 'italic'], ['subheading', 'quote', 'hr'], ['image']])
  // 문자열 항목('heading'·'image')은 Toast 기본 팝업을 띄운다. 모두 직접 정한 항목이고 팝업이 없다.
  expect(groups.flat().every((item) => typeof item === 'object' && !item.popup)).toBe(true)
  expect(groups[2][0].el?.contains(tool('이미지'))).toBe(true)
  // 좁은 화면에서 넘친 항목을 여는 버튼에도 이름이 있다.
  expect(host().querySelector('button.more')?.getAttribute('aria-label')).toBe('더 보기')
  // Toast의 쓰기·미리보기 탭은 초점·보조기기에서 뺀다(우리 전환 컨트롤을 쓴다).
  expect(host().querySelector('.toastui-editor-md-tab-container')?.hasAttribute('inert')).toBe(true)
})

it.each([
  ['굵게', '**첫째** 줄'],
  ['기울임', '*첫째* 줄'],
  ['소제목', '## 첫째 줄'],
  ['인용', '> 첫째 줄'],
])('툴바의 %s는 계약의 기호를 넣는다', (name, expected) => {
  const onBody = vi.fn()
  render(draw(<Harness initial="첫째 줄" onBody={onBody} />))
  select([1, 1], [1, 3])
  fireEvent.click(tool(name))
  expect(onBody).toHaveBeenLastCalledWith(expected)
})

it('툴바의 구분선은 커서 줄 아래에 *** 한 줄을 넣는다', () => {
  const onBody = vi.fn()
  render(draw(<Harness initial={'첫째 줄\n둘째 줄'} onBody={onBody} />))
  select([1, 5])
  fireEvent.click(tool('구분선'))
  expect(onBody).toHaveBeenLastCalledWith('첫째 줄\n***\n\n둘째 줄')
})

it('툴바 이미지 버튼은 PNG·JPEG 파일 선택을 열어 커서 자리에 기존 업로드 경로로 올리고 저장 중에는 잠근다', async () => {
  const onImage = vi.fn()
  const view = render(draw(<Harness initial="앞뒤" onImage={onImage} />))
  const input = document.querySelector<HTMLInputElement>('.manuscript-editor input[type="file"]')!
  expect(input.accept).toBe('.png,.jpg,.jpeg')
  expect(input.hidden).toBe(true)
  const open = vi.spyOn(input, 'click')
  fireEvent.click(tool('이미지'))
  expect(open).toHaveBeenCalledOnce()
  select([1, 2]) // "앞|뒤"
  const file = png()
  await act(async () => { fireEvent.change(input, { target: { files: [file] } }) })
  expect(onImage).toHaveBeenCalledExactlyOnceWith(file, 1, 1)
  await waitFor(() => expect(lines()).toEqual(['앞', '', `(이미지 ${IMAGE})`, '', '뒤']))
  expect(tool('이미지').disabled).toBe(false)
  view.rerender(draw(<Harness initial="앞뒤" busy />))
  expect(tool('이미지').disabled).toBe(true)
})

it('쓰기 | 미리보기 전환은 눌림 상태를 알리고, 미리보기는 공용 ManuscriptBody로 그리며 그동안 편집 영역과 툴바를 쓸 수 없다', () => {
  const body = `글\n${MARK}`
  render(draw(<Harness initial={body} />))
  const [write, preview] = within(screen.getByRole('group', { name: '원고 보기' })).getAllByRole('button')
  expect([write.textContent, preview.textContent]).toEqual(['쓰기', '미리보기'])
  // 기본은 쓰기다.
  expect([write, preview].map((button) => button.getAttribute('aria-pressed'))).toEqual(['true', 'false'])
  expect(screen.queryByTestId('preview')).toBeNull()
  fireEvent.click(preview)
  expect([write, preview].map((button) => button.getAttribute('aria-pressed'))).toEqual(['false', 'true'])
  const drawn = screen.getByTestId('preview')
  expect([drawn.textContent, drawn.dataset.work, drawn.dataset.number]).toEqual([body, 'work', '1'])
  expect(screen.getByRole('region', { name: '원고 미리보기' }).contains(drawn)).toBe(true)
  // 툴바는 편집 영역과 같은 자리(Toast)에 있어 함께 감춘다: 초점도 보조기기도 닿지 않는다.
  expect(host().hidden).toBe(true)
  expect(host().contains(tool('굵게'))).toBe(true)
  expect(screen.queryByRole('textbox', { name: '원고 본문' })).toBeNull()
  // 편집기는 그대로 남아 돌아오면 이어 쓴다(되돌리기 기록·커서 유지).
  fireEvent.click(write)
  expect(host().hidden).toBe(false)
  expect(screen.queryByTestId('preview')).toBeNull()
  expect(made.editors).toHaveLength(1)
  expect(made.destroyed).toHaveLength(0)
})

it('미리보기는 지금 편집 중인 글을 그리고 빈 원고면 쓴 글이 없다고 알린다', () => {
  render(draw(<Harness initial="" />))
  const preview = screen.getByRole('button', { name: '미리보기' })
  fireEvent.click(preview)
  expect(screen.getByRole('region', { name: '원고 미리보기' }).textContent).toBe('아직 쓴 글이 없어요.')
  fireEvent.click(screen.getByRole('button', { name: '쓰기' }))
  type('**새 글**')
  fireEvent.click(preview)
  expect(screen.getByTestId('preview').textContent).toBe('**새 글**')
})

it('Toast의 숨은 미리보기(표준 마크다운)는 처음에도 입력 뒤에도 그리지 않는다', () => {
  render(draw(<Harness initial="처음" />))
  const hidden = () => host().querySelector('.toastui-editor-md-preview')?.textContent
  expect(hidden()).toBe('')
  end()
  type(' 다음')
  expect(toast().getMarkdown()).toBe('처음 다음')
  expect(hidden()).toBe('')
})

it('붙여넣은 서식(HTML)은 글자만 남는다', () => {
  const onBody = vi.fn()
  render(draw(<Harness initial="" onBody={onBody} />))
  const html = '<h1>제목</h1><p><b>굵게</b> 글</p><ul><li>목록</li></ul>'
  const paste = createEvent.paste(surface(), { clipboardData: { files: [], getData: (kind: string) => (kind === 'text/html' ? html : '제목\n굵게 글\n목록') } })
  fireEvent(surface(), paste)
  expect(paste.defaultPrevented).toBe(true)
  expect(onBody).toHaveBeenLastCalledWith('제목\n굵게 글\n목록')
  expect(surface().querySelectorAll('h1, b, strong, ul, li')).toHaveLength(0)
})

it('붙여넣은 일반 텍스트의 빈 줄을 합치지 않고 저장 형식 그대로 둔다', () => {
  const onBody = vi.fn()
  render(draw(<Harness initial="" onBody={onBody} />))
  fireEvent.paste(surface(), { clipboardData: { files: [], getData: (kind: string) => (kind === 'text/plain' ? '첫 문단\n\n둘째 문단\r\n셋째' : '') } })
  expect(onBody).toHaveBeenLastCalledWith('첫 문단\n\n둘째 문단\n셋째')
})

// Toast의 버그: 줄 전체(빈 줄 포함)를 고른 채 빈 줄로 시작하는 글을 넣으면 화면에는 맞게 들어가는데 getMarkdown()은 뒤따르는 줄바꿈 하나를 잃는다(저장되는 글이 화면과 달라진다).
it.each([
  ['빈 줄에서', '가\n\n나', [2, 1], [2, 1], '\nA', '가\n\nA\n나', '가\n\nA!\n나'],
  ['빈 줄에서 줄바꿈만', '가\n\n나', [2, 1], [2, 1], '\n', '가\n\n\n나', '가\n\n!\n나'],
  ['한 줄 전체를 고르고', '가\n둘째\n나', [2, 1], [2, 3], '\nA\n', '가\n\nA\n\n나', '가\n\nA\n!\n나'],
  ['여러 줄 전체를 고르고', '가\n둘째\n셋째\n나', [2, 1], [3, 3], '\n\nA', '가\n\n\nA\n나', '가\n\n\nA!\n나'],
  ['첫 줄부터 고르고', '첫째\n둘째\n나', [1, 1], [2, 3], '\nA', '\nA\n나', '\nA!\n나'],
] as const)('%s 빈 줄로 시작하는 글을 붙여넣어도 화면의 글과 편집기가 내는 글이 같고 되돌리기도 그대로다', (_name, body, from, to, pasted, expected, typed) => {
  const onBody = vi.fn()
  render(draw(<Harness initial={body} onBody={onBody} />))
  select([from[0], from[1]], [to[0], to[1]])
  fireEvent.paste(surface(), { clipboardData: { files: [], getData: (kind: string) => (kind === 'text/plain' ? pasted : '') } })
  expect(lines().join('\n')).toBe(expected)
  expect(toast().getMarkdown()).toBe(expected)
  expect(onBody).toHaveBeenLastCalledWith(expected)
  // 커서는 붙여넣은 글 끝에 있어 이어 쓸 수 있다.
  type('!')
  expect(lines().join('\n')).toBe(typed)
  expect(onBody).toHaveBeenLastCalledWith(typed)
  // 이어 쓴 글자와 붙여넣기를 되돌린다(가까이 이어진 입력은 한 번에 되돌려질 수 있다).
  act(() => { toast().exec('undo') })
  act(() => { toast().exec('undo') })
  expect(lines().join('\n')).toBe(body)
  expect(toast().getMarkdown()).toBe(body)
  expect(onBody).toHaveBeenLastCalledWith(body)
})

it('줄 처음부터 다음 줄 처음까지 지운 것을 되돌려도 화면의 글과 편집기가 내는 글이 같다', () => {
  const onBody = vi.fn()
  const body = '가\n나\n다'
  render(draw(<Harness initial={body} onBody={onBody} />))
  act(() => { toast().deleteSelection([1, 1], [2, 1]) })
  expect(onBody).toHaveBeenLastCalledWith('나\n다')
  act(() => { toast().exec('undo') })
  expect(lines()).toEqual(['가', '나', '다'])
  expect(toast().getMarkdown()).toBe(body)
  expect(onBody).toHaveBeenLastCalledWith(body)
  // 되돌리기 기록도 그대로 이어진다: 다시 하기는 지운 상태로 돌아간다.
  act(() => { toast().exec('redo') })
  expect(lines()).toEqual(['나', '다'])
  expect(toast().getMarkdown()).toBe('나\n다')
})

// 무작위 원고에 무작위 편집(범위를 고른 붙여넣기·지우기·툴바 명령·되돌리기)을 해도 화면의 글 = getMarkdown() = onChange가 낸 글이다.
// Toast는 일부 편집에서 자기 글(toastMark)을 화면의 문서와 다르게 고친다. 씨앗을 고정한 난수라 결과는 늘 같다.
it('무작위 편집에서도 화면의 글과 편집기가 내는 글이 늘 같다', () => {
  let seed = 7
  const random = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 2 ** 32 }
  const pick = <T,>(items: readonly T[]) => items[Math.floor(random() * items.length)]
  const pieces = ['*', '**', '## ', '> ', '---', '- ', '1. ', '`', '```', '$', ' ', '가', '나다', '\n', '\n', '\n\n', MARK, `\n${MARK}\n`]
  const texts = ['가', '\n', '\nA', 'A\n', '\n\n', 'x\ny', `\n${MARK}`, `${MARK}\n`, '> 인용\n- 목록']
  // 커서가 놓일 수 있는 칸(Toast의 칸 번호): 위젯 안쪽은 사용자가 커서를 둘 수 없다.
  const columns = (line: string) => {
    const inside = new Set<number>()
    for (const widget of line.matchAll(/\$\$widget\d+ .*?\$\$/g)) for (let at = widget.index + 1; at < widget.index + widget[0].length; at++) inside.add(at)
    return Array.from({ length: line.length + 1 }, (_, at) => at + 1).filter((at) => !inside.has(at - 1))
  }
  for (let round = 0; round < 40; round++) {
    const body = Array.from({ length: Math.floor(random() * 10) }, () => pick(pieces)).join('')
    const onBody = vi.fn()
    render(draw(<Harness initial={body} onBody={onBody} />))
    const trail = [JSON.stringify(body)]
    expect(toast().getMarkdown(), trail.join(' → ')).toBe(body)
    for (let step = 0; step < 4; step++) {
      const rows = rawText().split('\n')
      const point = (): [number, number] => { const row = Math.floor(random() * rows.length); return [row + 1, pick(columns(rows[row]))] }
      let from = point()
      let to = random() < 0.5 ? from : point()
      if (random() < 0.3) { from = [from[0], 1]; to = [from[0], rows[from[0] - 1].length + 1] } // 한 줄 전체
      if (from[0] > to[0] || (from[0] === to[0] && from[1] > to[1])) [from, to] = [to, from]
      const action = pick(['insert', 'insert', 'insert', 'delete', 'bold', 'italic', 'blockQuote', 'hr', 'subheading', 'undo', 'redo'])
      const text = pick(texts)
      trail.push(`${action}${action === 'insert' ? JSON.stringify(text) : ''}@${from}-${to}`)
      act(() => {
        toast().setSelection(from, to)
        if (action === 'insert') toast().insertText(text)
        else if (action === 'delete') toast().deleteSelection()
        else toast().exec(action)
      })
      expect(toast().getMarkdown(), trail.join(' → ')).toBe(shownText())
      if (onBody.mock.calls.length) expect(onBody.mock.calls[onBody.mock.calls.length - 1][0], trail.join(' → ')).toBe(shownText())
    }
    cleanup()
  }
})

it('Ctrl+V(Toast의 붙여넣기 칸)로 빈 줄에 빈 줄로 시작하는 글을 넣어도 화면의 글과 편집기가 내는 글이 같다', () => {
  const onBody = vi.fn()
  render(draw(<Harness initial={'가\n\n나'} onBody={onBody} />))
  select([2, 1])
  const clip = host().querySelector<HTMLTextAreaElement>('.toastui-editor-pseudo-clipboard')!
  clip.value = '\nA'
  fireEvent.input(clip)
  expect(lines().join('\n')).toBe('가\n\nA\n나')
  expect(toast().getMarkdown()).toBe('가\n\nA\n나')
  expect(onBody).toHaveBeenLastCalledWith('가\n\nA\n나')
})

it('글자와 이미지가 함께 든 붙여넣기(문서 프로그램에서 복사한 글)는 글자를 넣고 이미지를 올리지 않는다', () => {
  const onImage = vi.fn()
  const onBody = vi.fn()
  render(draw(<Harness initial="" onImage={onImage} onBody={onBody} />))
  fireEvent.paste(surface(), { clipboardData: { files: [png()], getData: (kind: string) => (kind === 'text/plain' ? '문서에서 복사한 글' : '') } })
  expect(onBody).toHaveBeenLastCalledWith('문서에서 복사한 글')
  expect(onImage).not.toHaveBeenCalled()
})

it('복사한 글자는 문단 사이를 한 줄바꿈으로, 이미지는 표식 한 줄로 내보낸다', () => {
  const body = `가\n${MARK}\n나`
  render(draw(<Harness initial={body} />))
  const data: Record<string, string> = {}
  select([1, 1], [3, 2])
  fireEvent.copy(surface(), { clipboardData: { setData: (kind: string, value: string) => { data[kind] = value }, getData: (kind: string) => data[kind] ?? '' } })
  // Toast가 이미지 줄에 붙이는 내부 표기($$widget0 …$$)는 내보내지 않는다.
  expect(data['text/plain']).toBe(body)
})

it('40,000자를 넘는 입력은 막고 안내하며 지우는 입력은 늘 허용한다', () => {
  const onBody = vi.fn()
  render(draw(<Harness initial={'가'.repeat(40000)} onBody={onBody} />))
  end()
  type('나')
  expect(onBody).not.toHaveBeenCalled()
  // 막은 입력은 편집 영역에도, 편집기가 내는 글에도 남지 않는다.
  expect(surface().textContent).toHaveLength(40000)
  expect(toast().getMarkdown()).toHaveLength(40000)
  expect(status().textContent).toBe('40,000자를 넘는 입력은 넣을 수 없어요.')
  act(() => { toast().deleteSelection([1, 39999], [1, 40001]) })
  expect(onBody).toHaveBeenCalledOnce()
  expect(onBody.mock.calls[0][0]).toHaveLength(39998)
  expect(status().textContent).toBe('')
})

it('이미지 표식은 46자로 세어 40,000자 한도 안에 남지 않는 이미지 블록 입력도 막는다', () => {
  const onBody = vi.fn()
  render(draw(<Harness initial={'가'.repeat(39990)} onBody={onBody} />))
  end()
  type(`\n${MARK}`)
  expect(onBody).not.toHaveBeenCalled()
  expect(toast().getMarkdown()).toHaveLength(39990)
  cleanup()
  // 줄바꿈 1자 + 표식 46자가 꼭 맞게 들어가는 자리에는 들어간다(Toast가 문서 안에서 표식을 감싸는 글자는 세지 않는다).
  render(draw(<Harness initial={'가'.repeat(39953)} onBody={onBody} />))
  end()
  type(`\n${MARK}`)
  expect(onBody).toHaveBeenLastCalledWith(`${'가'.repeat(39953)}\n${MARK}`)
  expect(toast().getMarkdown()).toHaveLength(40000)
  type('나')
  expect(toast().getMarkdown()).toHaveLength(40000)
})

it('이미지 뒤의 커서 위치도 표식을 46자로 센 저장 문자열 위치로 넘긴다', async () => {
  const handle = createRef<ManuscriptEditorHandle>()
  const onImage = vi.fn()
  render(draw(<Harness initial={`${MARK}\n뒷줄`} upload={false} onImage={onImage} handle={handle} />))
  select([2, 2]) // "뒷|줄"
  await act(async () => { await handle.current!.addImage(png(), false) })
  expect(onImage).toHaveBeenCalledExactlyOnceWith(expect.any(File), 48, 48)
})

it('표식 줄은 줄 전체가 서버 이미지 id(UUID) 표식일 때만 이미지로 그린다', async () => {
  // 계약의 이미지 줄 규칙(공용 `imageMarker(id) === 줄`)과 같다: image는 소문자만, UUID는 대소문자를 가리지 않고, 앞뒤에 글자·공백이 있으면 글자다.
  const upper = IMAGE.toUpperCase()
  render(draw(<Harness initial={`[[image:../x]]\n${MARK}\n앞 ${MARK}\n ${MARK}\n[[IMAGE:${IMAGE}]]\n${imageMarker(upper)}`} />))
  expect(await screen.findAllByRole('img')).toHaveLength(2)
  expect(lines()).toEqual(['[[image:../x]]', `(이미지 ${IMAGE})`, `앞 ${MARK}`, ` ${MARK}`, `[[IMAGE:${IMAGE}]]`, `(이미지 ${upper})`])
})

it('이미지가 있는 줄에는 소제목·인용을 넣지 않아 편집 영역에 Toast 내부 표기가 드러나지 않는다', async () => {
  const onBody = vi.fn()
  const body = `앞\n${MARK}`
  render(draw(<Harness initial={body} onBody={onBody} />))
  await screen.findByRole('img', { name: '본문 이미지 1' })
  for (const name of ['소제목', '인용']) {
    select([1, 1], [2, 1])
    fireEvent.click(tool(name))
    expect(onBody).not.toHaveBeenCalled()
    expect(lines()).toEqual(['앞', `(이미지 ${IMAGE})`])
    expect(toast().getMarkdown()).toBe(body)
    expect(status().textContent).toBe('이미지가 있는 줄에는 이 동작을 쓸 수 없어요.')
  }
  // 이미지가 없는 줄에는 그대로 쓸 수 있고 안내는 지운다.
  select([1, 1])
  fireEvent.click(tool('인용'))
  expect(onBody).toHaveBeenLastCalledWith(`> 앞\n${MARK}`)
  expect(status().textContent).toBe('')
})

it('잠긴 동안(저장 중)에는 편집기를 그대로 둔 채 입력·툴바·이미지 붙여넣기와 끌어다 놓기를 받지 않는다', () => {
  const onImage = vi.fn()
  const onBody = vi.fn()
  const view = render(draw(<Harness initial="원작 글" editable={false} onImage={onImage} onBody={onBody} />))
  expect(host().hasAttribute('inert')).toBe(true)
  expect(surface().getAttribute('aria-readonly')).toBe('true')
  type('!')
  fireEvent.click(tool('굵게'))
  fireEvent.paste(surface(), { clipboardData: { files: [png()], getData: () => '' } })
  fireEvent.paste(surface(), { clipboardData: { files: [], getData: () => '글자' } })
  fireEvent.drop(surface(), { dataTransfer: { files: [png()], types: ['Files'], getData: () => '' }, clientX: 1, clientY: 1 })
  expect(onImage).not.toHaveBeenCalled()
  expect(onBody).not.toHaveBeenCalled()
  expect(toast().getMarkdown()).toBe('원작 글')
  expect(lines()).toEqual(['원작 글'])
  view.rerender(draw(<Harness initial="원작 글" editable onBody={onBody} />))
  // 같은 편집기가 다시 열린다.
  expect(made.editors).toHaveLength(1)
  expect(host().hasAttribute('inert')).toBe(false)
  expect(surface().getAttribute('aria-readonly')).toBe('false')
  end()
  type('!')
  expect(onBody).toHaveBeenLastCalledWith('원작 글!')
})

it('이미지 파일을 붙여넣으면 커서의 본문 위치와 함께 기존 업로드 경로로 올리고 이미지를 그린다', async () => {
  const onImage = vi.fn()
  render(draw(<Harness initial={'앞뒤'} onImage={onImage} />))
  select([1, 2]) // "앞|뒤"
  const file = png()
  const event = createEvent.paste(surface(), { clipboardData: { files: [file], getData: () => '' } })
  fireEvent(surface(), event)
  expect(event.defaultPrevented).toBe(true)
  expect(onImage).toHaveBeenCalledExactlyOnceWith(file, 1, 1)
  await waitFor(() => expect(lines()).toEqual(['앞', '', `(이미지 ${IMAGE})`, '', '뒤']))
  // 이미지가 들어가며 새로 만들어진 편집기는 이미지 다음 글 줄 맨 앞에 커서를 두고 바로 입력을 이어 갈 수 있다.
  expect(made.editors).toHaveLength(2)
  expect(toast().getSelection()).toEqual([[5, 1], [5, 1]])
  expect(document.activeElement).toBe(surface())
})

it('개발 모드(StrictMode)처럼 효과가 두 번 돌아도 편집기는 하나만 남고 이미지 삽입 뒤의 이미지·커서·초점 복원이 그대로다', async () => {
  const onImage = vi.fn()
  render(<StrictMode>{draw(<Harness initial="앞뒤" onImage={onImage} />)}</StrictMode>)
  expect(made.editors.length - made.destroyed.length).toBe(1)
  expect(document.querySelectorAll('.toastui-editor-defaultUI')).toHaveLength(1)
  select([1, 2])
  fireEvent.paste(surface(), { clipboardData: { files: [png()], getData: () => '' } })
  expect(onImage).toHaveBeenCalledOnce()
  await waitFor(() => expect(lines()).toEqual(['앞', '', `(이미지 ${IMAGE})`, '', '뒤']))
  expect(made.editors.length - made.destroyed.length).toBe(1)
  expect(document.querySelectorAll('.toastui-editor-defaultUI')).toHaveLength(1)
  expect(await screen.findAllByRole('img')).toHaveLength(1)
  expect(toast().getSelection()).toEqual([[5, 1], [5, 1]])
  expect(document.activeElement).toBe(surface())
})

it('Ctrl+V로 붙여넣은 이미지(Toast의 붙여넣기 칸)도 업로드 경로로 올리고 data: 주소로 본문에 넣지 않는다', async () => {
  const onImage = vi.fn()
  render(draw(<Harness initial={'앞뒤'} onImage={onImage} />))
  select([1, 2])
  const file = png()
  const clip = host().querySelector('.toastui-editor-pseudo-clipboard')!
  const event = createEvent.paste(clip, { clipboardData: { items: [{ kind: 'file', type: 'image/png', getAsFile: () => file }], files: [file], getData: () => '' } })
  fireEvent(clip, event)
  expect(event.defaultPrevented).toBe(true)
  expect(onImage).toHaveBeenCalledExactlyOnceWith(file, 1, 1)
  await waitFor(() => expect(lines()).toEqual(['앞', '', `(이미지 ${IMAGE})`, '', '뒤']))
  expect(toast().getMarkdown()).toBe(`앞\n\n${MARK}\n\n뒤`)
})

/** Toast가 감싼 ProseMirror 화면. jsdom에는 좌표 계산이 없어 놓은 자리(posAtCoords)만 정해 준다. */
type PMDoc = { textBetween: (from: number, to: number, separator: string) => string; content: { size: number } }
const mdView = () => (toast() as unknown as { mdEditor: { view: { state: { doc: PMDoc }; props: Record<string, unknown>; posAtCoords: (at: { left: number; top: number }) => { pos: number; inside: number } | null } } }).mdEditor.view
/** 편집 영역의 글(ProseMirror 문서)을 Toast의 줄 그대로 읽는다. 이미지 줄은 Toast가 `$$widget0 표식$$`로 감싸 둔다. */
const rawText = () => { const { doc } = mdView().state; return doc.textBetween(0, doc.content.size, '\n') }
/** 화면에 보이는 글: 감싼 표기를 벗긴 저장 형식 */
const shownText = () => rawText().replace(/\$\$widget\d+ (.*?)\$\$/g, '$1')

it('커서를 따라 스크롤할 때 화면에 붙어 있는 툴바(위)와 하단 바(아래)에 가리지 않을 만큼 여백을 둔다', () => {
  render(draw(<Harness initial="글" />))
  expect(mdView().props.scrollThreshold).toEqual({ top: 56, right: 0, bottom: 72, left: 0 })
  expect(mdView().props.scrollMargin).toEqual({ top: 72, right: 0, bottom: 96, left: 0 })
})

it('이미지 파일을 끌어다 놓으면 놓은 자리의 본문 위치에 올린다(이미지가 아닌 파일·내부 이동은 건드리지 않는다)', async () => {
  const onImage = vi.fn()
  render(draw(<Harness initial={'첫째\n둘째'} onImage={onImage} />))
  vi.spyOn(mdView(), 'posAtCoords').mockReturnValue({ pos: 2, inside: -1 }) // 첫째 문단의 '첫|째'
  const file = png()
  const drop = createEvent.drop(surface(), { dataTransfer: { files: [file], types: ['Files'], getData: () => '' }, clientX: 1, clientY: 1 })
  fireEvent(surface(), drop)
  expect(drop.defaultPrevented).toBe(true)
  expect(onImage).toHaveBeenCalledExactlyOnceWith(file, 1, 1)
  await waitFor(() => expect(lines()).toEqual(['첫', '', `(이미지 ${IMAGE})`, '', '째', '둘째']))
  onImage.mockClear()
  // 이미지가 아닌 파일은 올리지 않고, 브라우저가 그 파일을 열며 화면을 떠나지도 않게 막는다.
  const other = createEvent.drop(surface(), { dataTransfer: { files: [new File(['x'], 'a.pdf', { type: 'application/pdf' })], types: ['Files'], getData: () => '' }, clientX: 1, clientY: 1 })
  fireEvent(surface(), other)
  expect(other.defaultPrevented).toBe(true)
  expect(onImage).not.toHaveBeenCalled()
  expect(lines()).toEqual(['첫', '', `(이미지 ${IMAGE})`, '', '째', '둘째'])
})

it('첨부 버튼 같은 바깥 동작은 핸들의 addImage로 커서 위치에 올리고, 실패하면 본문을 그대로 두고 편집기로 초점을 돌린다', async () => {
  const handle = createRef<ManuscriptEditorHandle>()
  const onImage = vi.fn()
  render(draw(<Harness initial="가나" onImage={onImage} handle={handle} />))
  select([1, 1], [1, 2]) // "가" 선택
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
  render(draw(<Harness initial="가나" upload={false} handle={handle} />))
  const before = surface()
  let ok = true
  await act(async () => { ok = await handle.current!.addImage(png()) })
  expect(ok).toBe(false)
  expect(surface()).toBe(before)
  expect(made.editors).toHaveLength(1)
  expect(lines()).toEqual(['가나'])
  expect(document.activeElement).toBe(surface())
})

/** 올리는 동안 화면을 잠그는 부모(vm.addImage → editingLocked) */
function Locking({ gate }: { gate: Promise<boolean> }) {
  const [locked, setLocked] = useState(false)
  return <ManuscriptEditor value="가나" editable={!locked} workId="work" number={1} onChange={() => {}}
    onImage={async () => { setLocked(true); const ok = await gate; setLocked(false); return ok }} />
}

it('올리는 동안 잠겼다가 실패하면 잠금이 풀린 뒤에 편집기로 초점을 돌려준다', async () => {
  let finish!: (ok: boolean) => void
  render(draw(<Locking gate={new Promise<boolean>((resolve) => { finish = resolve })} />))
  await act(async () => { fireEvent.paste(surface(), { clipboardData: { files: [png()], getData: () => '' } }) })
  expect(host().hasAttribute('inert')).toBe(true)
  expect(document.activeElement).not.toBe(surface())
  await act(async () => { finish(false) })
  expect(host().hasAttribute('inert')).toBe(false)
  expect(document.activeElement).toBe(surface())
})

it('편집기 밖에서 본문이 바뀌면(회차 전환·다시 불러오기) 새 문서로 보고 되돌리기가 이전 글을 되살리지 않는다', () => {
  const onBody = vi.fn()
  const draft = (value: string, number: number) => draw(<ManuscriptEditor value={value} editable workId="work" number={number} onChange={onBody} onImage={async () => true} />)
  const view = render(draft('첫째 회차 글', 1))
  end()
  type('!')
  expect(onBody).toHaveBeenLastCalledWith('첫째 회차 글!')
  const first = toast()
  view.rerender(draft('둘째 회차 글', 2))
  expect(toast()).not.toBe(first)
  expect(made.destroyed).toContain(first)
  expect(lines()).toEqual(['둘째 회차 글'])
  onBody.mockClear()
  act(() => { toast().exec('undo') })
  expect(lines()).toEqual(['둘째 회차 글'])
  expect(onBody).not.toHaveBeenCalled()
})

it('열자마자 되돌리기를 눌러도 불러온 원고는 사라지지 않고 내가 쓴 글만 되돌린다', () => {
  const onBody = vi.fn()
  render(draw(<Harness initial={`불러온 원고\n${MARK}`} onBody={onBody} />))
  act(() => { toast().exec('undo') })
  expect(onBody).not.toHaveBeenCalled()
  expect(toast().getMarkdown()).toBe(`불러온 원고\n${MARK}`)
  end()
  type('!')
  expect(onBody).toHaveBeenLastCalledWith(`불러온 원고\n${MARK}!`)
  act(() => { toast().exec('undo') })
  expect(onBody).toHaveBeenLastCalledWith(`불러온 원고\n${MARK}`)
  act(() => { toast().exec('undo') })
  expect(onBody).toHaveBeenCalledTimes(2)
  act(() => { toast().exec('redo') })
  expect(onBody).toHaveBeenLastCalledWith(`불러온 원고\n${MARK}!`)
})

it('본문 이미지마다 원고 안 순서를 대체 텍스트에 붙여 여러 장을 구분한다', async () => {
  render(draw(<Harness initial={`${MARK}\n사이 문단\n${imageMarker(SECOND)}`} />))
  await waitFor(() => expect(screen.getAllByRole('img')).toHaveLength(2))
  expect(screen.getAllByRole('img').map((image) => [image.dataset.id, image.getAttribute('aria-label')])).toEqual([[IMAGE, '본문 이미지 1'], [SECOND, '본문 이미지 2']])
})

it('카드 편집기(위젯 규칙 없음)와 번갈아 떠도 서로의 글과 이미지 표시를 깨지 않는다', async () => {
  const body = `앞\n${MARK}`
  const first = render(draw(<Harness initial={body} />))
  expect(await screen.findByRole('img', { name: '본문 이미지 1' })).toBeTruthy()
  first.unmount()
  // Toast는 위젯 규칙을 모듈 전역에 두고 편집기를 만들 때마다 덮어쓴다: 규칙 없이 만든 카드 편집기는 표식을 글자 그대로 둔다.
  const card = render(draw(<MarkdownEditor label="설정 본문" initialValue={body} onChange={() => {}} />))
  expect(toast().getMarkdown()).toBe(body)
  expect(document.querySelector('.manuscript-image')).toBeNull()
  card.unmount()
  // 다시 연 원고 편집기는 자기 규칙을 다시 건다.
  render(draw(<Harness initial={body} />))
  expect(await screen.findByRole('img', { name: '본문 이미지 1' })).toBeTruthy()
  expect(toast().getMarkdown()).toBe(body)
})

const press = (key: string, init: KeyboardEventInit = {}) => fireEvent.keyDown(surface(), { key, ...init })

it('Tab은 들여쓰기로 남고 Esc를 누른 바로 다음 Tab만 편집기가 가로채지 않아 초점이 밖으로 나갈 수 있으며 그 방법을 입력 영역의 설명으로 잇는다', () => {
  render(draw(<Harness initial="첫 줄" />))
  expect(press('Tab')).toBe(false) // 평소의 Tab은 편집기가 들여쓰기로 쓴다
  const indented = toast().getMarkdown()
  expect(indented).not.toBe('첫 줄')
  press('Escape')
  expect(press('Tab')).toBe(true) // 넘겨준 Tab은 브라우저가 다음 조작 요소로 초점을 옮긴다
  expect(toast().getMarkdown()).toBe(indented)
  expect(press('Tab')).toBe(false) // 한 번 쓰면 다시 들여쓰기다
  const hint = screen.getByText('Tab은 들여쓰기예요. 편집기 밖으로 나가려면 Esc를 누른 다음 Tab을 누르세요.')
  expect(hint.id).not.toBe('')
  expect(surface().getAttribute('aria-describedby')).toBe(hint.id)
})

it('계약에 없는 서식을 넣는 Toast 단축키(취소선 Ctrl+S, 목록 Ctrl+U·O, 코드 Ctrl+Shift+C·P)는 받지 않아 저장하려고 누른 Ctrl+S가 기호를 넣지 않는다', () => {
  render(draw(<Harness initial="첫 줄" />))
  select([1, 1], [1, 4])
  // 한글 입력기에서는 key가 자모로 오므로 자판 자리(code)로 가린다. 받지 않은 키는 브라우저의 기본 동작(페이지 저장 창 등)도 막는다.
  for (const [key, code, init] of [['s', 'KeyS', {}], ['ㄴ', 'KeyS', {}], ['S', 'KeyS', { shiftKey: true }], ['u', 'KeyU', {}], ['o', 'KeyO', {}], ['C', 'KeyC', { shiftKey: true }], ['P', 'KeyP', { shiftKey: true }]] as const) {
    expect(press(key, { code, ctrlKey: true, ...init }), `${key} ${code}`).toBe(false)
    expect(press(key, { code, metaKey: true, ...init }), `${key} ${code} (meta)`).toBe(false)
    expect(toast().getMarkdown(), `${key} ${code}`).toBe('첫 줄')
  }
  // 계약에 있는 굵게·기울임 단축키와 복사(Ctrl+C)는 그대로다.
  expect(press('c', { code: 'KeyC', ctrlKey: true })).toBe(true)
  press('b', { code: 'KeyB', keyCode: 66, ctrlKey: true })
  expect(toast().getMarkdown()).toBe('**첫 줄**')
})

it('테마가 바뀌면 편집기를 다시 만들지 않고 어두운 테마 클래스만 바꾼다', () => {
  render(draw(<Harness initial="글" />))
  const ui = () => host().querySelector('.toastui-editor-defaultUI')!
  expect(ui().classList.contains('toastui-editor-dark')).toBe(false)
  act(() => { store.dispatch(uiActions.setTheme('dark')) })
  expect(ui().classList.contains('toastui-editor-dark')).toBe(true)
  act(() => { store.dispatch(uiActions.setTheme('light')) })
  expect(ui().classList.contains('toastui-editor-dark')).toBe(false)
  expect(made.editors).toHaveLength(1)
})

it('이미지 줄을 지우거나 화면에서 사라지면 이미지 위젯에 올린 React를 정리하고 편집기를 없앤다', async () => {
  const view = render(draw(<Harness initial={`${MARK}\n글\n${imageMarker(SECOND)}`} />))
  await waitFor(() => expect(mounted.images).toBe(2))
  act(() => { toast().deleteSelection([1, 1], [2, 1]) }) // 첫 이미지 줄을 지운다
  await waitFor(() => expect(mounted.images).toBe(1))
  expect(screen.getAllByRole('img').map((image) => [image.dataset.id, image.getAttribute('aria-label')])).toEqual([[SECOND, '본문 이미지 1']])
  const place = host()
  view.unmount()
  expect(mounted.images).toBe(0)
  expect(made.destroyed).toEqual([made.editors[0]])
  expect(place.children).toHaveLength(0)
})
