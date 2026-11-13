// @vitest-environment jsdom
import type { Editor } from '@toast-ui/editor'
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { Provider } from 'react-redux'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'

import { createAppStore } from '../../app/store'
import { MarkdownEditor } from './MarkdownEditor'
import { uiActions } from './ui/uiSlice'

/**
 * 실제 Toast UI Editor를 쓰되 만들어질 때의 옵션과 인스턴스를 붙잡는 하위 클래스로 바꾼다(jsdom에서도 만들어지고 `insertText`·`setMarkdown`은 change를 낸다).
 * 사용자가 타자를 치는 입력(ProseMirror)은 jsdom에서 흉내 낼 수 없어 편집기 메서드로 글을 바꾼다.
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

beforeEach(() => { made.options.length = made.editors.length = made.destroyed.length = 0 })
afterEach(cleanup)

const store = createAppStore()
const draw = (props: Partial<Parameters<typeof MarkdownEditor>[0]> = {}, key = 'a') => (
  <Provider store={store}>
    <MarkdownEditor key={key} label="설정 본문" initialValue={'소개\n\n## 성격\n- **차분함**'} placeholder="자유롭게 적어 보세요." onChange={() => {}} {...props} />
  </Provider>
)
const group = () => screen.getByRole('group', { name: '설정 본문' })

it('서버로 나가는 통계를 끄고 위지윅 전환·이미지 도구 없이 마크다운 쓰기·미리보기 탭으로 만든다', () => {
  render(draw())
  expect(made.options).toHaveLength(1)
  const options = made.options[0]
  expect(options).toMatchObject({
    initialEditType: 'markdown', hideModeSwitch: true, previewStyle: 'tab', usageStatistics: false, autofocus: false, language: 'ko-KR',
    initialValue: '소개\n\n## 성격\n- **차분함**', placeholder: '자유롭게 적어 보세요.', linkAttributes: { target: '_blank', rel: 'noopener noreferrer' },
    toolbarItems: [['heading', 'bold', 'italic', 'strike'], ['ul', 'ol', 'quote'], ['table', 'link']],
  })
  expect(options.el).toBe(group()) // 이름 붙은 덩어리 안에 만든다
  for (const unwanted of ['hooks', 'customHTMLRenderer', 'customHTMLSanitizer', 'plugins']) expect(options[unwanted], unwanted).toBeUndefined() // 이미지 올리기·HTML 확장은 연결하지 않는다
  expect(JSON.stringify(options.toolbarItems)).not.toContain('image')
})

it('한국어 쓰기·미리보기 탭과 이미지·코드 도구가 없는 도구 줄을 그린다', () => {
  render(draw())
  expect(Array.from(group().querySelectorAll('.tab-item'), (tab) => tab.textContent)).toEqual(['편집하기', '미리보기'])
  const tools = Array.from(group().querySelectorAll('button[aria-label]'), (b) => b.getAttribute('aria-label'))
  expect(tools).toEqual(['제목크기', '굵게', '기울임꼴', '취소선', '글머리 기호', '번호 매기기', '인용구', '표 삽입', '링크 삽입'])
  expect(group().querySelector('.ProseMirror')?.textContent).toContain('차분함')
})

it('글을 쓰는 편집 영역이 이름 붙은 여러 줄 입력으로 읽힌다', () => {
  render(draw())
  const input = within(group()).getByRole('textbox', { name: '설정 본문 입력' })
  expect(input.getAttribute('contenteditable')).toBe('true')
  expect(input.getAttribute('aria-multiline')).toBe('true')
  expect(input.classList.contains('ProseMirror')).toBe(true)
})

/** 키를 누른다. 편집기가 그 키를 가로채(기본 동작을 막으)면 false다. */
const press = (el: Element, key: string, init: KeyboardEventInit = {}) => fireEvent.keyDown(el, { key, ...init })
const input = () => within(group()).getByRole('textbox', { name: '설정 본문 입력' })
const tabs = () => within(group()).getAllByRole('tab')

it('Tab은 들여쓰기로 남고 Esc를 누른 바로 다음 Tab·Shift+Tab만 편집기가 가로채지 않아 초점이 밖으로 나갈 수 있다', () => {
  render(draw({ initialValue: '첫 줄' }))
  expect(press(input(), 'Tab')).toBe(false) // 평소의 Tab은 편집기가 들여쓰기로 쓴다
  const indented = made.editors[0].getMarkdown()
  expect(indented).not.toBe('첫 줄')
  press(input(), 'Escape')
  expect(press(input(), 'Tab')).toBe(true) // 넘겨준 Tab은 브라우저가 다음 조작 요소로 초점을 옮긴다
  expect(made.editors[0].getMarkdown()).toBe(indented) // 글은 그대로다
  expect(press(input(), 'Tab')).toBe(false) // 한 번 쓰면 다시 들여쓰기다
  press(input(), 'Escape')
  press(input(), 'Shift') // Shift+Tab은 Shift를 먼저 누른다: 함께 누르는 키는 순서를 끊지 않는다
  expect(press(input(), 'Tab', { shiftKey: true })).toBe(true) // 뒤로 나가는 Shift+Tab도 같다
})

it('Esc 뒤에 다른 키를 누르거나 한글 조합 중의 Esc였다면 Tab은 그대로 들여쓰기다', () => {
  render(draw({ initialValue: '첫 줄' }))
  press(input(), 'Escape')
  press(input(), 'ArrowLeft')
  expect(press(input(), 'Tab')).toBe(false)
  press(input(), 'Escape', { isComposing: true })
  expect(press(input(), 'Tab')).toBe(false)
})

it('편집기를 키보드로 벗어나는 방법을 글로 보이고 입력 영역의 설명으로 잇는다', () => {
  render(draw())
  const hint = screen.getByText('Tab은 들여쓰기예요. 편집기 밖으로 나가려면 Esc를 누른 다음 Tab을 누르세요.')
  expect(input().getAttribute('aria-describedby')).toBe(hint.id)
  expect(hint.id).not.toBe('')
  expect(group().contains(hint)).toBe(false) // 편집기 덩어리 밖이라 Toast가 지우지 않는다
})

it('쓰기·미리보기 탭은 탭 목록으로 읽히고 화살표·Enter·Space로 바꾸며 바꾼 탭에 초점이 남는다', () => {
  render(draw())
  const state = () => tabs().map((tab) => [tab.textContent?.trim(), tab.getAttribute('aria-selected')])
  expect(within(group()).getByRole('tablist')).toBeTruthy()
  expect(state()).toEqual([['편집하기', 'true'], ['미리보기', 'false']])
  expect(press(tabs()[0], 'ArrowRight')).toBe(false)
  expect(state()).toEqual([['편집하기', 'false'], ['미리보기', 'true']])
  expect(document.activeElement).toBe(tabs()[1])
  press(tabs()[1], 'ArrowLeft')
  expect(state()).toEqual([['편집하기', 'true'], ['미리보기', 'false']])
  expect(document.activeElement).toBe(tabs()[0])
  tabs()[1].focus()
  press(tabs()[1], 'Enter')
  expect(state()).toEqual([['편집하기', 'false'], ['미리보기', 'true']])
  tabs()[0].focus()
  press(tabs()[0], ' ')
  expect(state()).toEqual([['편집하기', 'true'], ['미리보기', 'false']])
  expect(tabs().map((tab) => tab.getAttribute('role'))).toEqual(['tab', 'tab']) // Toast가 탭을 다시 그려도 역할이 남는다
})

it('처음 글은 그대로 들어가고 그것만으로는 change를 내지 않는다', () => {
  const onChange = vi.fn()
  render(draw({ onChange }))
  expect(made.editors[0].getMarkdown()).toBe('소개\n\n## 성격\n- **차분함**') // 줄바꿈·기호가 바뀌지 않는다
  expect(onChange).not.toHaveBeenCalled()
})

it('글이 바뀔 때마다 마크다운 전체를 onChange로 주고 다시 그려도 늘 가장 새 onChange를 쓴다', () => {
  const first = vi.fn()
  const second = vi.fn()
  const view = render(draw({ onChange: first }))
  act(() => made.editors[0].setMarkdown('새 글\n\n둘째'))
  expect(first).toHaveBeenLastCalledWith('새 글\n\n둘째')
  view.rerender(draw({ onChange: second }))
  act(() => made.editors[0].insertText('끝')) // setMarkdown 뒤 커서는 글 끝이다
  expect(second).toHaveBeenLastCalledWith('새 글\n\n둘째끝')
  expect(first).toHaveBeenCalledTimes(1)
  expect(made.editors).toHaveLength(1) // onChange가 바뀌어도 편집기는 다시 만들지 않는다
})

it('처음 글(initialValue)은 만들 때만 읽고 다른 글로 바꾸려면 key를 바꿔 이전 편집기를 없애고 새로 만든다', () => {
  const view = render(draw())
  act(() => made.editors[0].insertText('입력'))
  view.rerender(draw({ initialValue: '바뀐 값' })) // 같은 key: 입력을 덮어쓰지 않는다
  expect(made.editors).toHaveLength(1)
  expect(made.editors[0].getMarkdown()).toBe('입력소개\n\n## 성격\n- **차분함**')
  view.rerender(draw({ initialValue: '다른 카드의 글' }, 'b')) // 다른 key: 다시 만든다
  expect(made.editors).toHaveLength(2)
  expect(made.destroyed).toEqual([made.editors[0]])
  expect(made.editors[1].getMarkdown()).toBe('다른 카드의 글') // 이전 카드의 글·기록이 섞이지 않는다
  expect(group().querySelectorAll('.toastui-editor-defaultUI')).toHaveLength(1)
})

it('화면에서 사라지면 편집기를 없앤다', () => {
  const view = render(draw())
  const host = group()
  view.unmount()
  expect(made.destroyed).toEqual([made.editors[0]])
  expect(host.children).toHaveLength(0)
})

it('테마가 바뀌면 편집기를 다시 만들지 않고 어두운 테마 클래스만 바꾼다', () => {
  render(draw())
  const ui = () => group().querySelector('.toastui-editor-defaultUI')!
  expect(ui().classList.contains('toastui-editor-dark')).toBe(false)
  act(() => { store.dispatch(uiActions.setTheme('dark')) })
  expect(ui().classList.contains('toastui-editor-dark')).toBe(true)
  act(() => { store.dispatch(uiActions.setTheme('light')) })
  expect(ui().classList.contains('toastui-editor-dark')).toBe(false)
  expect(made.editors).toHaveLength(1)
})
