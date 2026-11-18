// @vitest-environment jsdom
import '../../../../test/fixtureApp' // appContainer보다 먼저: 공개 세계관은 서버 대신 메모리 데모 저장소를 쓴다
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { Provider } from 'react-redux'
import { MemoryRouter, Route, Routes } from 'react-router'
import { afterEach, expect, it, vi } from 'vitest'

import { appContainer } from '../../../../app/appContainer'
import { createAppStore } from '../../../../app/store'
import type { PublicWorld } from '../../../../domain/entities/publicWorld'
import { bookPath, cardPath } from '../worldDetail'
import { WorldCardPage } from './WorldCardPage'

afterEach(() => { cleanup(); vi.restoreAllMocks() })

// jsdom에는 scrollIntoView가 없다
const scrollIntoView = vi.fn()
Element.prototype.scrollIntoView = scrollIntoView

const WORLD = 'moonhalo-isles'
const mount = (path: string) => render(
  <Provider store={createAppStore()}>
    <MemoryRouter initialEntries={[path]}>
      <Routes><Route path="/worlds/:id/cards/:cardId" element={<WorldCardPage />} /></Routes>
    </MemoryRouter>
  </Provider>,
)
/** 세계관을 다 읽을 때까지(불러오는 중 안내가 사라질 때까지) 기다린다. 메모리 데모 저장소가 답한다. */
const renderAt = async (path: string) => {
  mount(path)
  await waitFor(() => expect(screen.queryByText('세계관을 불러오고 있어요.')).toBeNull())
}
/** 달무리 군도 카드 번호: 0 우주관 · 1 하엘 · 2 오르 · 3 미라 · 4 새벽항 · 5 금기 · 6 섬의 실종. 설정집 순서는 1·2·3·4·5·6·0이다. */
const open = (cardId: number) => renderAt(cardPath(WORLD, cardId))
const items = (section: Element) => within(section as HTMLElement).getAllByRole('listitem').map((li) => li.textContent)
const sections = () => Array.from(document.querySelectorAll('details.nw-sec'))
const heads = () => sections().map((d) => d.querySelector(':scope > summary')?.textContent)
/** `##` 앞 첫머리 글: 제목·번호 없이 목차 아래에 그린다(개요 문단을 지어 붙이지 않는다). */
const lead = () => document.querySelector<HTMLElement>('article.nw .nw-lead')
const rows = (table: HTMLElement) => ({
  keys: within(table).getAllByRole('rowheader').map((e) => e.textContent),
  values: within(table).getAllByRole('cell').map((e) => e.textContent),
})

it('카드 한 장이 빵부스러기·분류 상자·문서 제목·정보 표를 갖춘 나무위키 문서 한 편이다', async () => {
  await open(2)
  const crumbs = within(screen.getByRole('navigation', { name: '현재 위치' }))
  expect(crumbs.getAllByRole('link').map((a) => [a.textContent, a.getAttribute('href')])).toEqual([
    ['달무리 군도', `/worlds/${WORLD}`], ['인물', bookPath(WORLD, '인물')], ['늙은 항해사 오르', cardPath(WORLD, 2)],
  ])
  expect(crumbs.getByRole('link', { name: '늙은 항해사 오르' }).getAttribute('aria-current')).toBe('page')
  expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('늙은 항해사 오르')
  expect(within(document.querySelector<HTMLElement>('article.nw .nw-cat')!).getAllByRole('link').map((a) => a.textContent)).toEqual(['달무리 군도', '인물'])
  // 정보 표: 맨 위 유형 칩 → 인물은 관계 수(소속이 없으면 소속 행 없음) → 세계관
  expect(rows(screen.getByRole('table', { name: '늙은 항해사 오르' }))).toEqual({ keys: ['유형', '관계', '세계관'], values: ['인물', '2개', '달무리 군도'] })
})

it('목차와 접이식 문단은 내용이 있는 문단만 연속 번호로 그리고 각 문단은 대상 카드 페이지로 가는 링크를 둔다', async () => {
  await open(2)
  const toc = within(screen.getByRole('navigation', { name: '목차' })).getAllByRole('link').map((a) => a.textContent)
  expect(toc).toEqual(['1. 관계', '2. 연관 설정', '3. 같은 유형의 다른 설정']) // 이 카드를 가리키는 설정이 없어 번호가 건너뛰지 않는다
  expect(heads()).toEqual(toc)
  expect(sections().every((d) => (d as HTMLDetailsElement).open)).toBe(true)
  const [relations, links, same] = sections()
  within(lead()!).getByText('기억에 항로를 적는 마지막 항해사. 일곱 번째 섬의 항로를 혼자 기억한다고 한다.')
  expect(screen.queryByText(/개요/)).toBeNull() // 본문에 없는 '개요' 문단을 지어 붙이지 않는다
  expect(items(relations)).toEqual(['조석신 하엘 · 숭배 · 방향 미상', '견습 항해사 미라 · 스승-제자 · 방향 미상']) // 설정집 순서, 라벨이 관계
  expect(within(relations as HTMLElement).getAllByRole('link').map((a) => a.getAttribute('href'))).toEqual([cardPath(WORLD, 1), cardPath(WORLD, 3)])
  expect(items(links)).toEqual(['사건 일곱 번째 섬의 실종 · 목격 · 방향 미상'])
  expect(items(same)).toEqual(['조석신 하엘', '견습 항해사 미라'])
})

it('인물이 아닌 카드는 방향 미상 연결을 중립적인 연관 설정으로 보인다', async () => {
  await open(4)
  expect(heads()).toEqual(['1. 연관 설정'])
  const [links] = sections()
  expect(items(links)).toEqual(['인물 견습 항해사 미라 · 머무는 곳 · 방향 미상', '기타 우주관 · 물때의 달 · 물때에 맞춰 열림 · 방향 미상'])
  expect(rows(screen.getByRole('table', { name: '새벽항' }))).toEqual({ keys: ['유형', '연결', '세계관'], values: ['장소', '2개', '달무리 군도'] })
})

it('인물의 정보 표는 이어진 조직을 소속으로 보인다', async () => {
  await renderAt(cardPath('silent-orbit', 5)) // 교신사 하린 → 관제 잔류단(소속)
  const table = screen.getByRole('table', { name: '교신사 하린' })
  expect(rows(table)).toEqual({ keys: ['유형', '소속', '관계', '세계관'], values: ['인물', '관제 잔류단 · 소속 · 방향 미상', '2개', '침묵 궤도'] })
  expect(within(table).getByRole('link', { name: '관제 잔류단' }).getAttribute('href')).toBe(cardPath('silent-orbit', 2))
})

it('이전·다음 설정을 설정집 순서로 잇고 누르면 그 카드로 옮겨 가며 세계관으로 돌아가기는 설정집 탭이다', async () => {
  await open(2)
  const nav = within(screen.getByRole('navigation', { name: '이전·다음 설정' }))
  expect(nav.getAllByRole('link').map((a) => [a.textContent, a.getAttribute('href'), a.getAttribute('rel')])).toEqual([
    ['이전 설정 조석신 하엘', cardPath(WORLD, 1), 'prev'], ['다음 설정 견습 항해사 미라', cardPath(WORLD, 3), 'next'],
  ])
  expect(screen.getByRole('link', { name: '← 세계관으로 돌아가기' }).getAttribute('href')).toBe(bookPath(WORLD))
  fireEvent.click(nav.getByRole('link', { name: /다음 설정/ }))
  expect((await screen.findByRole('heading', { level: 1, name: '견습 항해사 미라' })).textContent).toBe('견습 항해사 미라')
})

it('설정집 순서의 첫 카드는 이전이, 끝 카드는 다음이 없다', async () => {
  await open(1)
  expect(screen.queryByRole('link', { name: /이전 설정/ })).toBeNull()
  screen.getByRole('link', { name: /다음 설정/ })
  cleanup()
  await open(0)
  expect(screen.queryByRole('link', { name: /다음 설정/ })).toBeNull()
  screen.getByRole('link', { name: /이전 설정/ })
})

it('없는 카드는 찾을 수 없는 설정과 설정집 링크를, 없는 세계관은 찾을 수 없는 세계관을 알린다', async () => {
  await open(99)
  expect(screen.getByRole('heading', { level: 1, name: '찾을 수 없는 설정' })).toBeTruthy()
  expect(screen.getByRole('link', { name: '세계관으로 돌아가기' }).getAttribute('href')).toBe(bookPath(WORLD))
  cleanup()
  await renderAt(cardPath('없는-세계관', 0))
  expect(screen.getByRole('heading', { level: 1, name: '찾을 수 없는 세계관' })).toBeTruthy()
  expect(screen.getByRole('link', { name: '공개 세계관 보러 가기' }).getAttribute('href')).toBe('/worlds')
})

it('목차 링크는 기본 이동을 막고 그 문단으로 스크롤·포커스를 옮기며 움직임 줄이기 설정이면 부드럽게 스크롤하지 않는다', async () => {
  scrollIntoView.mockClear()
  await open(2)
  const toc = within(screen.getByRole('navigation', { name: '목차' }))
  const summary = (n: number) => sections()[n].querySelector('summary')
  expect(fireEvent.click(toc.getByRole('link', { name: '2. 연관 설정' }))).toBe(false) // preventDefault
  expect(scrollIntoView).toHaveBeenLastCalledWith({ behavior: 'smooth', block: 'start' })
  expect(scrollIntoView.mock.contexts.at(-1)).toBe(summary(1))
  expect(document.activeElement).toBe(summary(1))
  Object.defineProperty(window, 'matchMedia', { configurable: true, value: () => ({ matches: true }) })
  try {
    fireEvent.click(toc.getByRole('link', { name: '1. 관계' }))
    expect(scrollIntoView).toHaveBeenLastCalledWith({ behavior: 'auto', block: 'start' })
    expect(document.activeElement).toBe(summary(0))
  } finally {
    Reflect.deleteProperty(window, 'matchMedia')
  }
})

// ── 서버 응답: 불러오는 중·실패·서버 카드 id(위치 번호가 아니다) ──
const useCase = () => appContainer.resolve('publicWorldUseCase')
const serverWorld = (extra: Partial<PublicWorld> = {}): PublicWorld => ({
  id: 'sw', name: '서버 세계', description: '서버 설명', genre: 'sf', authorNickname: '서버 작가', publishedAt: '2026-11-01T00:00:00Z', revisionNo: 1,
  cards: [
    { id: 'c-uuid-1', title: '하린', text: '교신사', cardType: 'character', aliases: [], tags: [] },
    { id: 'c-uuid-2', title: '온실', text: '식물 구역', cardType: 'location', aliases: [], tags: [] },
  ],
  relationships: [{ id: 'r-1', sourceCardId: 'c-uuid-1', targetCardId: 'c-uuid-2', label: '거점' }], relationshipStatus: 'current', ...extra,
})

it('세계관을 읽는 동안 불러오는 중 안내를 보이고 끝나면 카드 페이지를 보인다', async () => {
  let done!: (world: PublicWorld) => void
  vi.spyOn(useCase(), 'get').mockReturnValue(new Promise((resolve) => { done = resolve }))
  mount(cardPath('sw', 'c-uuid-1'))
  screen.getByText('세계관을 불러오고 있어요.')
  expect(screen.queryByRole('heading', { level: 1 })).toBeNull()
  await act(async () => done(serverWorld()))
  expect((await screen.findByRole('heading', { level: 1, name: '하린' })).textContent).toBe('하린')
  expect(screen.queryByText('세계관을 불러오고 있어요.')).toBeNull()
})

it('서버 카드는 카드 id로 찾고 데모 안내 없이 연결·이전·다음 링크가 카드 id를 쓰며 다른 카드로 옮겨도 세계관을 다시 읽지 않는다', async () => {
  const get = vi.spyOn(useCase(), 'get').mockResolvedValue(serverWorld())
  await renderAt(cardPath('sw', 'c-uuid-1'))
  expect(screen.queryByText(/데모/)).toBeNull()
  expect(heads()).toEqual(['1. 연관 설정'])
  expect(within(sections()[0] as HTMLElement).getAllByRole('link').map((a) => a.getAttribute('href'))).toEqual([cardPath('sw', 'c-uuid-2')])
  const nav = within(screen.getByRole('navigation', { name: '이전·다음 설정' }))
  expect(nav.getAllByRole('link').map((a) => a.getAttribute('href'))).toEqual([cardPath('sw', 'c-uuid-2')])
  fireEvent.click(nav.getByRole('link', { name: /다음 설정/ }))
  expect((await screen.findByRole('heading', { level: 1, name: '온실' })).textContent).toBe('온실')
  expect(get).toHaveBeenCalledTimes(1)
})

it('그 세계관의 카드 id가 아닌 값(위치 번호·모르는 id)은 찾을 수 없는 설정이고 비공개·없는 세계관은 찾을 수 없는 세계관이다', async () => {
  const get = vi.spyOn(useCase(), 'get').mockResolvedValue(serverWorld())
  await renderAt(cardPath('sw', 1))
  expect(screen.getByRole('heading', { level: 1, name: '찾을 수 없는 설정' })).toBeTruthy()
  cleanup()
  get.mockResolvedValue(undefined)
  await renderAt(cardPath('sw', 'c-uuid-1'))
  expect(screen.getByRole('heading', { level: 1, name: '찾을 수 없는 세계관' })).toBeTruthy()
  expect(screen.queryByRole('alert')).toBeNull()
})

it('세계관 조회가 실패하면 찾을 수 없음으로 바꾸지 않고 실패 안내와 다시 시도를 보이며 누르면 다시 읽는다', async () => {
  const get = vi.spyOn(useCase(), 'get').mockRejectedValue(new Error('offline'))
  mount(cardPath('sw', 'c-uuid-1'))
  expect((await screen.findByRole('alert')).textContent).toContain('세계관을 불러오지 못했어요.')
  expect(screen.queryByRole('heading', { level: 1 })).toBeNull()
  get.mockResolvedValue(serverWorld())
  fireEvent.click(screen.getByRole('button', { name: '다시 시도' }))
  await screen.findByRole('heading', { level: 1, name: '하린' })
  expect(screen.queryByRole('alert')).toBeNull()
})

// ── 카드 본문 마크다운: ## 제목 문단·정보 상자의 별칭·태그·원시 HTML ──
const marked = (text: string, extra: Partial<PublicWorld['cards'][number]> = {}) => serverWorld({
  cards: [
    { id: 'c-uuid-1', title: '하린', text, cardType: 'character', aliases: [], tags: [], ...extra },
    { id: 'c-uuid-2', title: '온실', text: '식물 구역', cardType: 'location', aliases: [], tags: [] },
  ],
})

it('본문의 설정 링크(DEC-53)는 응답에 있는 카드의 페이지로 가는 링크가 되고 응답에 없는 카드는 글자만 보이며, 가리킨 카드의 페이지에는 본문 링크로 가리킨 카드가 들어간다', async () => {
  const [a, b, gone] = ['aaaaaaaa-2222-3333-4444-555555555555', 'bbbbbbbb-2222-3333-4444-555555555555', 'cccccccc-2222-3333-4444-555555555555']
  vi.spyOn(useCase(), 'get').mockResolvedValue(serverWorld({
    cards: [
      { id: a, title: '하린', text: `[온실](card:${b})에서 [사라진 곳](card:${gone})을 본다.`, cardType: 'character', aliases: [], tags: [] },
      { id: b, title: '온실', text: '식물 구역', cardType: 'location', aliases: [], tags: [] },
    ],
    relationships: [],
  }))
  await renderAt(cardPath('sw', a))
  const link = within(lead()!).getByRole('link', { name: '온실' })
  expect(link.getAttribute('href')).toBe(cardPath('sw', b))
  expect(within(lead()!).queryByRole('link', { name: '사라진 곳' })).toBeNull() // 응답에 없는 카드는 글자만
  expect(lead()!.textContent).toBe('온실에서 사라진 곳을 본다.')
  fireEvent.click(link)
  await screen.findByRole('heading', { level: 1, name: '온실' })
  expect(heads()).toEqual(['1. 이 카드를 가리키는 설정'])
  expect(items(sections()[0])).toEqual(['인물 하린 · 본문 링크'])
})

it('목차는 본문 마크다운의 ## 제목이고 그 뒤에 연관 설정 문단이 이어지며 첫머리 글은 제목 없이 그린다', async () => {
  vi.spyOn(useCase(), 'get').mockResolvedValue(marked('교신사다.\n\n## 성격\n- **차분함**\n- 끈질김\n\n## 과거\n#### 어린 시절\n온실에서 자랐다.'))
  await renderAt(cardPath('sw', 'c-uuid-1'))
  const toc = within(screen.getByRole('navigation', { name: '목차' })).getAllByRole('link').map((a) => a.textContent)
  expect(toc).toEqual(['1. 성격', '2. 과거', '3. 연관 설정'])
  expect(heads()).toEqual(toc)
  const [trait, past, links] = sections()
  within(lead()!).getByText('교신사다.')
  expect(items(trait)).toEqual(['차분함', '끈질김'])
  expect(trait.querySelector('li strong')?.textContent).toBe('차분함') // 마크다운으로 그려진다
  expect(past.querySelector('h5')?.textContent).toBe('어린 시절') // 본문 제목은 문단 제목(h2)보다 낮은 단계다
  expect(items(links)).toEqual(['장소 온실 · 거점 · 방향 미상']) // 유형 칩 + 대상 카드 · 연관 라벨
  expect(document.querySelectorAll('h1')).toHaveLength(1)
})

it('#·##·### 제목은 겹친 번호의 목차와 안에 든 접이식 문단이 되고 상위를 접으면 하위도 함께 접힌다', async () => {
  vi.spyOn(useCase(), 'get').mockResolvedValue(marked('교신사다.\n\n# 인물\n## 성격\n차분하다.\n### 말버릇\n음…\n## 과거\n#### 어린 시절\n자랐다.'))
  await renderAt(cardPath('sw', 'c-uuid-1'))
  const toc = screen.getByRole('navigation', { name: '목차' })
  expect(within(toc).getAllByRole('link').map((a) => a.textContent)).toEqual(['1. 인물', '1.1. 성격', '1.1.1. 말버릇', '1.2. 과거', '2. 연관 설정'])
  expect(toc.querySelectorAll('ol ol ol li')).toHaveLength(1) // 말버릇이 세 번째 단계 목록에 든다
  expect(heads()).toEqual(['1. 인물', '1.1. 성격', '1.1.1. 말버릇', '1.2. 과거', '2. 연관 설정'])
  const [person, trait, habit, past] = sections()
  expect([person, trait, habit].map((d) => d.querySelector(':scope > summary > *')?.tagName)).toEqual(['H2', 'H3', 'H4'])
  expect(person.contains(trait) && trait.contains(habit) && person.contains(past)).toBe(true) // 하위 문단은 상위 문단 안에 있다
  expect(past.querySelector('.nw-doc h5')?.textContent).toBe('어린 시절') // #### 이하는 목차가 아니라 본문 소제목이다
  within(lead()!).getByText('교신사다.')
})

it('## 줄이 없는 본문은 개요 문단 없이 첫머리 글로 마크다운을 그리고 목차에 넣지 않는다', async () => {
  vi.spyOn(useCase(), 'get').mockResolvedValue(marked('**성격**: 차분함\n\n- 항해사'))
  await renderAt(cardPath('sw', 'c-uuid-1'))
  expect(heads()).toEqual(['1. 연관 설정'])
  expect(within(screen.getByRole('navigation', { name: '목차' })).getAllByRole('link').map((a) => a.textContent)).toEqual(['1. 연관 설정'])
  expect(lead()!.querySelector('p strong')?.textContent).toBe('성격')
  expect(items(lead()!)).toEqual(['항해사'])
})

it('정보 상자에 별칭은 쉼표로, 태그는 칩으로 보이고 값이 없으면 그 행이 없다', async () => {
  const get = vi.spyOn(useCase(), 'get').mockResolvedValue(marked('교신사', { aliases: ['린', '교신사'], tags: ['주인공', '우주'] }))
  await renderAt(cardPath('sw', 'c-uuid-1'))
  const table = screen.getByRole('table', { name: '하린' })
  expect(rows(table)).toEqual({ keys: ['유형', '별칭', '관계', '태그', '세계관'], values: ['인물', '린, 교신사', '0개', '주인공우주', '서버 세계'] })
  expect(within(table).getAllByRole('listitem').map((li) => li.textContent)).toEqual(['주인공', '우주'])
  cleanup()
  get.mockResolvedValue(marked('교신사'))
  await renderAt(cardPath('sw', 'c-uuid-1'))
  expect(rows(screen.getByRole('table', { name: '하린' })).keys).toEqual(['유형', '관계', '세계관'])
})

it('본문의 원시 HTML은 요소로 그리지 않고 글자로 보인다', async () => {
  vi.spyOn(useCase(), 'get').mockResolvedValue(marked('<script>window.x = 1</script>\n\n<img src="https://example.test/x.png" onerror="window.x = 2">'))
  await renderAt(cardPath('sw', 'c-uuid-1'))
  const article = document.querySelector('article.nw')!
  expect(article.querySelector('script, img')).toBeNull()
  expect(article.textContent).toContain('<script>window.x = 1</script>')
})

// ── 카드 대표 이미지(#401): 공개 이미지 주소를 <img>로 직접 읽고, 읽지 못하면 감춘다 ──
it('이미지가 있는 카드는 정보 상자 맨 위에 공개 카드 이미지 주소의 이미지를 보이고(대체 글은 카드 제목 이미지) 읽지 못하면 감춘다', async () => {
  vi.spyOn(useCase(), 'get').mockResolvedValue(marked('교신사', { imageId: 'img 1' }))
  await renderAt(cardPath('sw', 'c-uuid-1'))
  const info = screen.getByRole('table', { name: '하린' })
  const image = within(info).getByRole('img', { name: '하린 이미지' })
  expect(image.getAttribute('src')).toBe('/api/v1/public/world-studios/sw/card-images/img%201')
  expect(info.querySelector('tbody tr:first-child')?.contains(image)).toBe(true) // 유형 행보다 위
  fireEvent.error(image)
  expect(within(info).queryByRole('img')).toBeNull()
  expect(within(info).getByText('유형')).toBeTruthy() // 이미지를 감춰도 정보 상자의 행은 그대로다
})

it('이미지가 없는 카드(imageId가 null이거나 없음)의 정보 상자에는 이미지가 없다', async () => {
  vi.spyOn(useCase(), 'get').mockResolvedValue(marked('교신사', { imageId: null }))
  await renderAt(cardPath('sw', 'c-uuid-1'))
  expect(screen.queryByRole('img')).toBeNull()
  cleanup()
  vi.spyOn(useCase(), 'get').mockResolvedValue(serverWorld())
  await renderAt(cardPath('sw', 'c-uuid-2'))
  expect(screen.queryByRole('img')).toBeNull()
})
