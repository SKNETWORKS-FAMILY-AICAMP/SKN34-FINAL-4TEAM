// @vitest-environment jsdom
import type { Editor } from '@toast-ui/editor'
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { Provider } from 'react-redux'
import { afterEach, beforeAll, beforeEach, expect, it, vi } from 'vitest'

import { createAppStore } from '../../app/store'
import { stubRangeGeometry } from '../../test/rangeGeometry'
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

beforeAll(stubRangeGeometry)
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
    placeholder: '자유롭게 적어 보세요.', linkAttributes: { target: '_blank', rel: 'noopener noreferrer' },
    toolbarItems: [['heading', 'bold', 'italic', 'strike'], ['ul', 'ol', 'quote'], ['table', 'link']],
  })
  expect(options.el).toBe(group()) // 이름 붙은 덩어리 안에 만든다
  for (const unwanted of ['hooks', 'customHTMLRenderer', 'customHTMLSanitizer']) expect(options[unwanted], unwanted).toBeUndefined() // 이미지 올리기·HTML 확장은 연결하지 않는다
  expect(options.plugins).toHaveLength(1) // Toast 결함 보정(shared/toastFixes)에 쓰는 편집 화면을 얻는 플러그인 하나뿐이다
  expect(made.editors[0].getMarkdown()).toBe('소개\n\n## 성격\n- **차분함**') // 글은 보정을 건 뒤에 넣는다
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

// ── Toast UI Editor의 알려진 결함 보정(shared/toastFixes, 집필실 원고 편집기와 같은 방법) ──
it('열자마자 되돌리기를 눌러도 불러온 글은 사라지지 않고 내가 쓴 글만 되돌린다', () => {
  const onChange = vi.fn()
  render(draw({ initialValue: '불러온 설명', onChange }))
  act(() => { made.editors[0].exec('undo') })
  expect(onChange).not.toHaveBeenCalled()
  expect(made.editors[0].getMarkdown()).toBe('불러온 설명')
  act(() => { made.editors[0].moveCursorToEnd(false); made.editors[0].insertText('!') })
  expect(onChange).toHaveBeenLastCalledWith('불러온 설명!')
  act(() => { made.editors[0].exec('undo') })
  expect(onChange).toHaveBeenLastCalledWith('불러온 설명')
  act(() => { made.editors[0].exec('undo') })
  expect(onChange).toHaveBeenCalledTimes(2)
})

it('Toast의 구문 강조가 실패하는 글(들여쓴 ``` 줄로 끝나는 글)도 그대로 열리고 이어서 쓸 수 있다', () => {
  const onChange = vi.fn()
  const poison = '앞\n  ```'
  render(draw({ initialValue: poison, onChange }))
  expect(made.editors[0].getMarkdown()).toBe(poison)
  expect(onChange).not.toHaveBeenCalled()
  act(() => { made.editors[0].moveCursorToEnd(false); made.editors[0].insertText('!') })
  expect(onChange).toHaveBeenLastCalledWith(`${poison}!`)
})

it('줄 처음부터 다음 줄 처음까지 지운 것을 되돌려도 화면의 글과 편집기가 내는 글이 같다', () => {
  const onChange = vi.fn()
  const body = '가\n나\n다'
  render(draw({ initialValue: body, onChange }))
  act(() => { made.editors[0].deleteSelection([1, 1], [2, 1]) })
  expect(onChange).toHaveBeenLastCalledWith('나\n다')
  act(() => { made.editors[0].exec('undo') })
  expect(Array.from(input().children, (line) => line.textContent)).toEqual(['가', '나', '다'])
  expect(made.editors[0].getMarkdown()).toBe(body)
  expect(onChange).toHaveBeenLastCalledWith(body)
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

// ── 설정 링크(DEC-53): 편집기 위 버튼·검색 패널·미리보기 링크 이동 ──
const [LA, LB] = ['aaaaaaaa-2222-3333-4444-555555555555', 'bbbbbbbb-2222-3333-4444-555555555555']
const linkCards = [{ id: LA, title: '리안', type: '인물', aliases: ['견습 서약사'] }, { id: LB, title: '별빛 탑', type: '장소' }]
const linkButton = () => screen.getByRole('button', { name: '설정 링크' })
const dialog = () => screen.getByRole('dialog', { name: '설정 링크 넣기' })
const picks = () => within(dialog()).getAllByRole('listitem').map((li) => li.textContent)

it('설정 링크를 주지 않으면 그 버튼도 검색 패널도 없다', () => {
  render(draw())
  expect(screen.queryByRole('button', { name: '설정 링크' })).toBeNull()
})

it('설정 링크 버튼은 Toast 도구 줄 밖(편집기 위)에 있어 좁은 편집기에서 더보기로 숨지 않고, 누르면 같은 세계관 설정을 이름·별칭으로 찾는 패널이 열려 검색 칸에 초점이 간다', () => {
  render(draw({ cardLinks: { cards: linkCards, open: vi.fn() } }))
  // jsdom은 도구 줄 너비가 0이라 Toast가 도구 항목을 모두 더보기(display:none)로 옮긴다. 버튼은 그 밖이라 그래도 눌린다.
  expect(made.options[0].toolbarItems).toEqual([['heading', 'bold', 'italic', 'strike'], ['ul', 'ol', 'quote'], ['table', 'link']]) // 도구 줄은 그대로다
  expect(group().contains(linkButton())).toBe(false)
  expect(screen.queryByRole('dialog')).toBeNull()
  expect(linkButton().getAttribute('aria-expanded')).toBe('false')
  fireEvent.click(linkButton())
  expect(document.activeElement).toBe(within(dialog()).getByRole('searchbox'))
  expect(linkButton().getAttribute('aria-expanded')).toBe('true')
  expect(picks()).toEqual(['리안인물', '별빛 탑장소'])
  fireEvent.change(within(dialog()).getByRole('searchbox'), { target: { value: ' 서약 ' } }) // 별칭으로도 찾고 앞뒤 공백은 무시한다
  expect(picks()).toEqual(['리안인물'])
  fireEvent.change(within(dialog()).getByRole('searchbox'), { target: { value: '없는 이름' } })
  expect(within(dialog()).queryAllByRole('listitem')).toHaveLength(0)
  within(dialog()).getByText('맞는 설정이 없어요.')
})

it('고른 설정은 선택한 글자를 링크 글자로, 선택이 없으면 그 설정의 제목으로 커서 위치에 넣고 onChange로 알린 뒤 패널을 닫고 편집기로 초점을 돌린다', () => {
  const onChange = vi.fn()
  render(draw({ initialValue: '소개 글', onChange, cardLinks: { cards: linkCards, open: vi.fn() } }))
  act(() => { made.editors[0].setSelection([1, 1], [1, 3]) }) // '소개'
  fireEvent.click(linkButton())
  fireEvent.click(within(dialog()).getByRole('button', { name: /^리안/ }))
  expect(onChange).toHaveBeenLastCalledWith(`[소개](card:${LA}) 글`)
  expect(screen.queryByRole('dialog')).toBeNull()
  act(() => { made.editors[0].moveCursorToEnd(false) })
  fireEvent.click(linkButton())
  fireEvent.click(within(dialog()).getByRole('button', { name: /^별빛 탑/ }))
  expect(onChange).toHaveBeenLastCalledWith(`[소개](card:${LA}) 글[별빛 탑](card:${LB})`)
})

it('Esc는 패널을 닫고 초점을 설정 링크 버튼으로 돌려주며, 한글 조합 중의 Esc는 패널을 닫지 않는다', () => {
  render(draw({ cardLinks: { cards: linkCards, open: vi.fn() } }))
  fireEvent.click(linkButton())
  const search = within(dialog()).getByRole('searchbox')
  fireEvent.keyDown(search, { key: 'Escape', isComposing: true })
  expect(screen.queryByRole('dialog')).not.toBeNull()
  fireEvent.keyDown(search, { key: 'Escape' })
  expect(screen.queryByRole('dialog')).toBeNull()
  expect(document.activeElement).toBe(linkButton())
  fireEvent.click(linkButton())
  fireEvent.click(within(dialog()).getByRole('button', { name: '닫기' }))
  expect(screen.queryByRole('dialog')).toBeNull()
})

it('미리보기는 정규식이 인정한 설정 링크만 눌러 열 수 있는 링크로 그리고(나머지 모양은 파서가 링크로 읽어도 아니다), 목록에 없는 카드는 열지 않는다', () => {
  const open = vi.fn()
  const shapes = [
    `[승상](card:${LA})`, `[을](card:${LB})`, `[[갑]](card:${LA})`, `<card:${LA}>`, `[괄호](<card:${LA}>)`, `[제목](card:${LA} "t")`,
    `[줄
바꿈](card:${LA})`, `[외부](https://example.test/a)`,
  ]
  render(draw({ initialValue: shapes.join('\n\n'), cardLinks: { cards: [linkCards[0]], open } }))
  fireEvent.click(group().querySelectorAll<HTMLElement>('.tab-item')[1]) // 미리보기 탭
  const preview = group().querySelector('.toastui-editor-md-preview')!
  const anchors = Array.from(preview.querySelectorAll<HTMLAnchorElement>('a[data-card-link]'))
  // 인정된 링크 둘(승상·을)만 눌러 열 수 있는 링크다: 같은 화면 안 해시 주소이고 새 탭으로 열지 않는다.
  expect(anchors.map((a) => [a.textContent, a.dataset.cardLink, a.getAttribute('href'), a.getAttribute('target')])).toEqual([
    ['승상', LA, `#card-${LA}`, null], ['을', LB, `#card-${LB}`, null],
  ])
  // 파서가 링크로 읽은 나머지 여섯 모양(외부 링크 포함)은 data 속성이 없고, 설정 카드 주소는 Toast sanitizer가 지워 어디도 가리키지 않는다.
  const others = Array.from(preview.querySelectorAll<HTMLAnchorElement>('a:not([data-card-link])'))
  expect(others).toHaveLength(6)
  expect(others.filter((a) => /card/i.test(a.getAttribute('href') ?? ''))).toEqual([])
  expect(fireEvent.click(anchors[0])).toBe(false) // 해시 이동 같은 기본 동작을 막았다
  expect(open).toHaveBeenCalledTimes(1)
  expect(open).toHaveBeenCalledWith(LA)
  fireEvent.click(anchors[1])
  expect(open).toHaveBeenCalledTimes(1) // 이 세계관(cards)에 없는 카드는 열지 않는다
})

it('미리보기는 줄 중간·소제목·인용·목록·표·들여쓴 줄·이어진 줄·강조 안의 설정 링크도 눌러 열 수 있는 링크로 그린다(원문 위치로 판정해도 칸이 어긋나지 않는다)', () => {
  const link = (label: string, id = LA) => `[${label}](card:${id})`
  const blocks = [
    `앞 ${link('줄 중간')} 뒤 ${link('둘', LB)}`, `# 제목 ${link('소제목')}`, `> 인용 ${link('인용글')}`, `- 목록 ${link('목록글', LB)}`,
    `   ${link('들여쓴 줄')}`, `첫 줄
둘째 줄 ${link('이어진 줄')}`, `**${link('굵게')}**`, `| 칸 |
|---|
| ${link('표 안')} |`,
  ]
  render(draw({ initialValue: blocks.join('\n\n'), cardLinks: { cards: linkCards, open: vi.fn() } }))
  fireEvent.click(group().querySelectorAll<HTMLElement>('.tab-item')[1]) // 미리보기 탭
  const anchors = group().querySelectorAll<HTMLAnchorElement>('.toastui-editor-md-preview a[data-card-link]')
  expect(Array.from(anchors, (a) => [a.textContent, a.dataset.cardLink])).toEqual([
    ['줄 중간', LA], ['둘', LB], ['소제목', LA], ['인용글', LA], ['목록글', LB], ['들여쓴 줄', LA], ['이어진 줄', LA], ['굵게', LA], ['표 안', LA],
  ])
})
