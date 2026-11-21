// @vitest-environment jsdom
import { cleanup, fireEvent, render as renderPlain, screen, within } from '@testing-library/react'
import type { ReactElement } from 'react'
import { Provider } from 'react-redux'
import { MemoryRouter } from 'react-router'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'

import { createAppStore } from '../../../../app/store'
import type { Episode, History, Work, WritingEpisode } from '../../../../domain/entities/content'
import { WorkManagement } from './WorkManagement'

// 히어로·정책 카드는 이 테스트가 보는 회차 목록과 무관하다. 포크 수는 12화에만 2편이 갈라졌다고 본다(회차 번호로 조회).
vi.mock('./WorkOverview', () => ({ WorkOverview: () => null }))
vi.mock('../viewmodel/useEpisodeForkCounts', () => ({ useEpisodeForkCounts: () => ({ 12: 2 }) }))

const episode = (number: number, versionId?: string): Episode => ({ number, version: 1, title: `${number}화 제목`, body: `${number}화 본문`, inherited: false, versionId })
const work = (count: number): Work => ({
  id: 'w', title: '작품', summary: '', visibility: 'public', allowFork: true, allowForkPublication: false, revision: 0, source: null,
  episodes: Array.from({ length: count }, (_, i) => episode(i + 1)), draft: { title: '', body: '', revision: 0 },
})
const vm = { busy: false, coverRevision: 0, loadHistory: async () => {}, history: null }
// 사이드바 맨 아래 줄(알림·테마·계정)이 공용 스토어를 읽어 Provider로 감싼다. 접기 상태는 호출 측(EpisodePage)이 갖는다.
const render = (ui: ReactElement) => {
  const store = createAppStore()
  const wrap = (node: ReactElement) => <Provider store={store}>{node}</Provider>
  const view = renderPlain(wrap(ui))
  return { ...view, rerender: (node: ReactElement) => view.rerender(wrap(node)) }
}
const shell = { menuOpen: true, onMenuOpenChange: () => {} }
const open = (count: number) => render(
  <MemoryRouter><WorkManagement {...shell} vm={vm as never} work={work(count)} onForked={() => {}} onDeleted={() => {}} /></MemoryRouter>,
)

const rows = () => within(screen.getByRole('list')).getAllByRole('listitem')
const titles = () => rows().map((row) => row.querySelector('b')?.textContent)
const range = (from: number, to: number) => Array.from({ length: to - from + 1 }, (_, i) => `${from + i}화 제목`)

it('운영 설정 탭은 저장 성공 응답으로 집필 방식 변경 이력을 표시한다', async () => {
  const defaults = { worldUpdateMode: 'manual', proofreadingMode: 'review', autoserialState: 'off' }
  const version = { revision: 1, writingMode: 'assisted', changedAt: '2026-11-19T03:00:00Z' }
  const useCase = {
    workSettings: vi.fn().mockResolvedValue({ ...defaults, current: { revision: 0, writingMode: null, changedAt: null }, history: [] }),
    updateWorkSettings: vi.fn().mockResolvedValue({ ...defaults, current: version, history: [version] }),
  }
  render(<MemoryRouter><WorkManagement {...shell} vm={vm as never} work={work(1)} useCase={useCase as never} onForked={() => {}} onDeleted={() => {}} /></MemoryRouter>)

  fireEvent.click(screen.getByRole('button', { name: '운영 설정' }))
  fireEvent.change(await screen.findByRole('combobox', { name: '집필 방식' }), { target: { value: 'assisted' } })
  fireEvent.click(screen.getByRole('button', { name: '집필 방식 저장' }))

  expect(await screen.findByText('집필 방식을 저장했어요.')).toBeTruthy()
  expect(screen.getByRole('listitem').textContent).toContain('AI 협업 집필')
  expect(useCase.updateWorkSettings).toHaveBeenCalledWith('w', 0, 'assisted', expect.any(AbortSignal))
})
const pager = () => screen.getByRole('navigation', { name: '페이지' })
const press = (name: string) => fireEvent.click(within(pager()).getByRole('button', { name }))

// jsdom에는 scrollIntoView가 없어, 어느 요소를 어떻게 불렀는지 기록하는 대역을 둔다.
const scrolled: { el: Element; arg: unknown }[] = []
beforeEach(() => {
  scrolled.length = 0
  Element.prototype.scrollIntoView = function (this: Element, arg?: boolean | ScrollIntoViewOptions) { scrolled.push({ el: this, arg }) }
})
afterEach(() => { cleanup(); Reflect.deleteProperty(Element.prototype, 'scrollIntoView') })

it('회차가 10개 이하면 전부 한 번에 보이고 페이지 이동 버튼은 없다', () => {
  open(10)
  expect(titles()).toEqual(range(1, 10))
  expect(screen.queryByRole('navigation', { name: '페이지' })).toBeNull()
})

it('회차가 10개를 넘으면 1쪽에 1~10화만 보이고 이전은 막히며 현재 쪽이 표시된다', () => {
  open(25)
  expect(titles()).toEqual(range(1, 10))
  expect(within(pager()).getByRole('button', { name: '이전' }).hasAttribute('disabled')).toBe(true)
  expect(within(pager()).getByRole('button', { name: '다음' }).hasAttribute('disabled')).toBe(false)
  expect(within(pager()).getByRole('button', { name: '1' }).getAttribute('aria-current')).toBe('page')
  expect(within(pager()).getByRole('button', { name: '2' }).getAttribute('aria-current')).toBeNull()
})

it('다음·쪽 번호·이전으로 쪽을 옮기면 그 쪽의 회차만 보이고 처음과 끝에서 막힌다', () => {
  open(25)
  press('다음')
  expect(titles()).toEqual(range(11, 20))
  expect(within(pager()).getByRole('button', { name: '2' }).getAttribute('aria-current')).toBe('page')
  press('3')
  expect(titles()).toEqual(range(21, 25))
  expect(within(pager()).getByRole('button', { name: '다음' }).hasAttribute('disabled')).toBe(true)
  press('이전')
  expect(titles()).toEqual(range(11, 20))
})

it('쪽을 바꾸면 회차 목록 머리로 스크롤한다', () => {
  open(25)
  expect(scrolled).toEqual([])
  press('다음')
  expect(scrolled).toHaveLength(1)
  expect(scrolled[0].el).toBe(screen.getByRole('list'))
  expect(scrolled[0].arg).toEqual({ block: 'start' })
})

it('회차별 포크 수는 쪽 안의 순서가 아니라 회차 번호로 붙는다', () => {
  open(25)
  expect(screen.queryByTitle('이 회차에서 갈라진 포크')).toBeNull()
  press('다음')
  const marked = rows().filter((row) => within(row).queryByTitle('이 회차에서 갈라진 포크'))
  expect(marked.map((row) => row.querySelector('b')?.textContent)).toEqual(['12화 제목'])
  expect(within(marked[0]).getByTitle('이 회차에서 갈라진 포크').textContent).toContain('2')
})

it('쪽을 나눠도 이야기 분기의 기준 회차 선택에는 모든 회차가 있다', () => {
  open(25)
  fireEvent.click(screen.getByRole('button', { name: '이야기 분기' }))
  expect(within(screen.getByRole('combobox', { name: /기준 회차/ })).getAllByRole('option')).toHaveLength(25)
})

it('요청을 처리하는 동안 다른 탭은 잠그되 지금 보고 있는 탭은 잠그지 않아, 누른 탭에서 키보드 초점이 사라지지 않는다', () => {
  render(<MemoryRouter><WorkManagement {...shell} vm={{ ...vm, busy: true } as never} work={work(3)} onForked={() => {}} onDeleted={() => {}} /></MemoryRouter>)
  const tabs = within(screen.getByRole('navigation', { name: '작품 메뉴' })).getAllByRole('button') as HTMLButtonElement[]
  expect(tabs.map((tab) => [tab.textContent, tab.disabled])).toEqual([['공개 회차 · 3', false], ['세계관·설정집', true], ['이야기 분기', true], ['받은 피드백', true], ['운영 설정', true], ['저장·AI·발행 이력', true]])
})

it('작품 메뉴는 왼쪽 사이드바에 있고 고른 메뉴의 내용은 그 뒤의 내용 열에 그려진다(DOM 순서 = 시각 순서)', () => {
  open(3)
  const side = screen.getByRole('navigation', { name: '작품 메뉴' }).closest('.ep-menu') as HTMLElement
  const content = side.nextElementSibling as HTMLElement
  expect(content.classList.contains('ep-content')).toBe(true)
  expect(side.parentElement?.className).toBe('ep-manage') // 두 열은 같은 2열 틀의 자식이다
  expect(within(content).getByRole('list')).toBeTruthy() // 기본 메뉴(공개 회차)의 회차 목록
})

// ── 초안 목록(소유자 회차 조회)에서 오는 표시: 저장 버전 순번·작성 중인 초안 ──────────────────────────
const saved = (id: string, number = 1) => ({ id, episode: number, title: '첫 화', body: '저장된 원고', revision: 7, savedAt: '2026-11-02T00:00:00Z' })
const row = (number: number, extra: Partial<WritingEpisode> = {}): WritingEpisode => ({
  number, draft: { title: `${number}화 초안`, body: '', revision: 0 }, versions: [], publishedVersionId: null, inherited: false,
  updatedAt: null, checkpointStatus: 'none', checkpoints: [], publicationStatus: 'draft', hasDraft: true, ...extra,
})
/** vm에 초안 목록 상태(writing: null=읽는 중, {rows}=읽음, {error}=못 읽음)와 이력을 얹어 그린다. */
const openWith = (extra: object, count = 0, override: Partial<Work> = {}) => render(
  <MemoryRouter><WorkManagement {...shell} vm={{ ...vm, ...extra } as never} work={{ ...work(count), ...override }} onForked={() => {}} onDeleted={() => {}} /></MemoryRouter>,
)
const publication = (versionId: string) => ({ episode: 1, versionId, publishedAt: '2026-11-03T00:00:00Z', action: 'publish' as const })
const openHistory = () => fireEvent.click(screen.getByRole('button', { name: '저장·AI·발행 이력' }))

it('같은 저장 버전은 공개 회차·원고 저장본·발행 이력에서 모두 같은 "저장 버전 N"으로 보이고 편집 리비전 번호는 쓰지 않는다', () => {
  const versions = [saved('v1'), saved('v2')]
  const history: History = { versions, proposals: [], publicationHistory: [publication('v2')] }
  const published = { ...episode(1, 'v2'), version: 9 }
  openWith({ writing: { id: 'w', rows: [row(1, { versions, publishedVersionId: 'v2', publicationStatus: 'published' })] }, history }, 0, { episodes: [published] })
  // 공개 회차: 지금 공개 중인 저장 버전(`version`은 초안 편집 번호라 나오지 않는다)
  expect(rows()[0].textContent).toContain('공개 중 · 저장 버전 2')
  openHistory()
  expect(screen.getByRole('heading', { name: '1화 · 저장 버전 1 · 첫 화' })).toBeTruthy()
  expect(screen.getByRole('heading', { name: '1화 · 저장 버전 2 · 첫 화' })).toBeTruthy()
  expect(screen.getByText(/1화 · 발행 ·/).textContent).toContain('저장 버전 2')
  expect(document.body.textContent).not.toContain('리비전')
})

it('상속 회차는 저장 버전이 없으므로 공개 회차 줄에 저장 버전을 붙이지 않는다', () => {
  openWith({ writing: { id: 'w', rows: [row(1, { inherited: true })] } }, 0, { episodes: [{ ...episode(1, 'x'), inherited: true }] })
  expect(rows()[0].textContent).not.toMatch(/저장 버전|리비전/)
})

it.each([
  { when: '읽는 동안', writing: null, expected: '저장 버전 불러오는 중' },
  { when: '읽지 못했을 때', writing: { id: 'w', error: '초안 목록을 불러오지 못했어요.' }, expected: '저장 버전 미확인' },
  { when: '읽었지만 그 회차가 없을 때', writing: { id: 'w', rows: [row(1)] }, expected: '저장 버전 미확인' },
])('초안 목록을 $when 발행 이력의 저장 버전은 "$expected"로 구분해 보인다', ({ writing, expected }) => {
  openWith({ writing, history: { versions: [saved('v1')], proposals: [], publicationHistory: [publication('v1')] } })
  openHistory()
  expect(screen.getByText(/1화 · 발행 ·/).textContent).toContain(expected)
  // 읽는 동안에는 못 찾은 것처럼 '미확인'이라고 하지 않는다.
  if (writing === null) expect(document.body.textContent).not.toContain('미확인')
})

it('작성 중인 초안에는 발행 전 초안만 올리고 공개 중단·발행·상속·초안이 없는 회차는 뺀다', () => {
  openWith({ writing: { id: 'w', rows: [
    row(1),
    row(2, { publicationStatus: 'suspended' }),
    row(3, { publicationStatus: 'published', publishedVersionId: 'v3' }),
    row(4, { inherited: true }),
    row(5, { hasDraft: false }),
  ] } })
  const section = screen.getByRole('heading', { name: '작성 중인 초안' }).closest('section')!
  expect(within(section).getAllByRole('link').map((a) => a.textContent)).toEqual(['1화 · 1화 초안'])
})

it('초안 목록을 불러오지 못하면 오류 상자(.ep-alert)로 알린다', () => {
  openWith({ writing: { id: 'w', error: '초안 목록을 불러오지 못했어요.' } })
  const alert = screen.getByRole('alert')
  expect(alert.textContent).toBe('초안 목록을 불러오지 못했어요.')
  expect(alert.classList.contains('ep-alert')).toBe(true)
})

it('공개한 회차가 없을 때 안내는 작성 중인 초안이 있으면 "첫 회차를 작성해 보세요"를 덧붙이지 않는다', () => {
  const first = openWith({ writing: { id: 'w', rows: [row(1)] } })
  expect(screen.getByText('아직 공개한 회차가 없어요.')).toBeTruthy()
  first.unmount()
  openWith({ writing: { id: 'w', rows: [] } })
  expect(screen.getByText('아직 공개한 회차가 없어요. 첫 회차를 작성해 보세요.')).toBeTruthy()
})

// ── 메뉴를 누르면 고른 탭의 내용으로 화면을 옮긴다: 탭 내용이 히어로·분기 정책 카드 아래(접힌 선 밖)에서 시작해, 눌러도 바뀐 것이 안 보였다 ──
it('메뉴를 누르면 탭 내용 머리로 스크롤하고(처음 렌더에서는 하지 않는다) 초점은 누른 메뉴 버튼에 남는다', () => {
  open(3)
  expect(scrolled).toEqual([]) // 처음 렌더(공개 회차)에서는 스크롤하지 않는다
  const menu = screen.getByRole('button', { name: '이야기 분기' })
  menu.focus()
  fireEvent.click(menu)
  const head = scrolled.filter((s) => (s.arg as ScrollIntoViewOptions | undefined)?.block === 'start')
  expect(head).toHaveLength(1)
  const target = head[0].el as HTMLElement
  expect(head[0].arg).toEqual({ block: 'start' })
  expect(target.contains(screen.getByRole('heading', { name: '그 순간, 다른 선택을 했다면' }))).toBe(true) // 대상은 탭 내용을 감싼 요소이고
  expect(target.classList.contains('ep-content')).toBe(false) // 히어로까지 든 내용 열 전체가 아니라
  expect(target.parentElement?.classList.contains('ep-content')).toBe(true) // 그 안의 탭 내용 묶음이다
  expect(target.style.scrollMarginTop).toBe('16px') // 상단바(.gnb)가 없어 위 여백만이다(회차 목록 Pager와 같은 값)
  expect(target.classList.contains('ep-tab')).toBe(true) // 위 히어로·분기 정책·작품 삭제 구획과 선으로 나뉘는 클래스(episode.css)
  expect(document.activeElement).toBe(menu) // 초점은 누른 버튼에 남아 이어서 다른 메뉴를 고를 수 있다
})

it('메뉴 줄은 좁은 화면에서 줄바꿈해 모든 탭이 보이므로, 눌러도 그 버튼을 옆으로 옮기지 않는다(탭 내용 머리로만 스크롤한다)', () => {
  open(3)
  const menu = screen.getByRole('button', { name: '이야기 분기' })
  fireEvent.click(menu)
  expect(scrolled.find((s) => s.el === menu)).toBeUndefined()
  expect(scrolled.filter((s) => (s.arg as ScrollIntoViewOptions | undefined)?.block === 'start')).toHaveLength(1)
})

it('이력 탭의 저장본·AI 제안 항목 제목은 묶음 제목(h3) 바로 아래 단계(h4)라 헤딩 목록에서 묶음 경계가 보인다', () => {
  const versions = [saved('v1')]
  const proposal = { id: 'p1', text: '제안 본문', model: 'gpt', revision: 1, status: 'pending' as const, prompt: '지시문' }
  openWith({ writing: { id: 'w', rows: [row(1, { versions })] }, history: { versions, proposals: [proposal], publicationHistory: [] } })
  openHistory()
  expect(screen.getAllByRole('heading', { level: 3 }).map((h) => h.textContent)).toEqual(['발행 이력', '원고 저장본', 'AI 요청·제안'])
  expect(screen.getAllByRole('heading', { level: 4 }).map((h) => h.textContent)).toEqual(['1화 · 저장 버전 1 · 첫 화', 'gpt · 검토 대기'])
})

// ── 이력 탭의 불러오는 중·실패: 탭을 누르면 탭 머리로 스크롤돼 화면 맨 위 알림이 화면 밖이므로 이력 구획 안에서 알린다 ──
const historySection = () => screen.getByRole('heading', { name: '저장·AI·발행 이력', level: 2 }).parentElement!.querySelector<HTMLElement>('.ep-reading')!
/** 이력 탭을 연 채로 요청 상태(busy·origin·error·history)만 바꿔 다시 그리는 함수를 돌려준다. 요청 중에는 다른 탭이 잠기므로 탭은 먼저 연다. */
const historyTab = () => {
  const view = openWith({})
  openHistory()
  return (extra: object) => view.rerender(
    <MemoryRouter><WorkManagement {...shell} vm={{ ...vm, ...extra } as never} work={work(0)} onForked={() => {}} onDeleted={() => {}} /></MemoryRouter>,
  )
}

it('이력을 불러오는 동안에는 이력 구획 안에서 상태 문구(role=status)로 알리고, 다른 요청 중이거나 불러온 이력이 있으면 띄우지 않는다', () => {
  const again = historyTab()
  again({ busy: true, origin: 'history' })
  expect(within(historySection()).getByRole('status').textContent).toBe('이력을 불러오고 있어요…')
  // 다른 요청(예: 히어로의 분기 정책 저장)이 진행 중일 때는 이력을 읽는 중이 아니다.
  again({ busy: true, origin: '' })
  expect(within(historySection()).queryByRole('status')).toBeNull()
  again({ busy: true, origin: 'history', history: { versions: [], proposals: [], publicationHistory: [] } })
  expect(within(historySection()).queryByRole('status')).toBeNull()
})

it('이력 조회가 실패하면 이력 구획 안에 오류 상자(.ep-alert, role=alert)로 알리고, 다른 요청의 오류는 이 구획에 올리지 않는다', () => {
  const again = historyTab()
  again({ origin: 'history', error: '이력을 불러오지 못했어요.' })
  const alert = within(historySection()).getByRole('alert')
  expect(alert.textContent).toBe('이력을 불러오지 못했어요.')
  expect(alert.classList.contains('ep-alert')).toBe(true)
  again({ origin: 'fork', error: '분기를 만들지 못했어요.' })
  expect(within(historySection()).queryByRole('alert')).toBeNull()
})
