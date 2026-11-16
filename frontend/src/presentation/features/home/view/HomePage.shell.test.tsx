// @vitest-environment jsdom
// React 조립 회귀: CI 통합 계층에서만 실행한다.
import '../../../../test/fixtureApp'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { Provider } from 'react-redux'
import { MemoryRouter } from 'react-router'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'

import { appContainer } from '../../../../app/appContainer'
import { createAppStore } from '../../../../app/store'
import { seedWorks } from '../../../../data/mock/seed'
import type { Work } from '../../../../domain/entities/work'
import { STUB_RANKED_AT, stubWorkSearch } from '../../../../test/stubWorkSearch'
import { HomePage } from './HomePage'

beforeEach(() => { stubWorkSearch() })
afterEach(() => { cleanup(); vi.restoreAllMocks() })

const renderHome = () => render(<Provider store={createAppStore()}><MemoryRouter useTransitions={false}><HomePage /></MemoryRouter></Provider>)

it('본문 랜드마크 하나 안에서 기존 #home 구성을 유지한다', async () => {
  renderHome()
  await screen.findByText('다르게 이어진 포크 소설')
  const main = screen.getByRole('main')
  expect(screen.getAllByRole('main')).toHaveLength(1)
  expect(main.id).toBe('main')
  expect(main.getAttribute('tabindex')).toBe('-1')
  expect(main.querySelector(':scope > #home > h1.sr-only')?.textContent).toBe('STORYFORK')
  expect(main.querySelectorAll('#home .chips, #home .hero, #home .t10')).toHaveLength(3)
})

it('홈의 탭 제목은 태그라인이고 화면을 떠나면 기본 제목으로 돌아간다', async () => {
  const view = renderHome()
  await waitFor(() => expect(document.title).toBe('원작을 나만의 이야기로 · STORYFORK'))
  view.unmount()
  expect(document.title).toBe('STORYFORK')
})

it('실시간 인기·급상승은 최근 24시간 조회 기준임을 알리고 집계가 비면 빈 상태를 보여 준다', async () => {
  vi.spyOn(appContainer.resolve('workSearchRepository'), 'rankings').mockResolvedValue({ items: [], computedAt: STUB_RANKED_AT })
  renderHome()
  const top = await screen.findByLabelText('실시간 인기 TOP10')
  expect(within(top).getByText('24시간 조회').getAttribute('title')).toBe('최근 24시간 조회 수 순')
  expect(within(top).getByText('최근 24시간 동안 조회된 소설이 아직 없어요.')).toBeTruthy()
  expect(within(top).queryByRole('list')).toBeNull()
  screen.getByText('최근 24시간 동안 조회가 늘어난 소설이 아직 없어요.')
  expect(screen.queryByText(/데모 데이터/)).toBeNull()
})

it('순위 조회가 실패하면 빈 목록으로 숨기지 않고 안내하며 나머지 홈은 그대로 보여 준다', async () => {
  vi.spyOn(appContainer.resolve('workSearchRepository'), 'rankings').mockRejectedValue(new Error('offline'))
  renderHome()
  await screen.findByText('다르게 이어진 포크 소설')
  expect(screen.getAllByText('순위를 불러오지 못했어요.')).toHaveLength(2)
  expect(within(screen.getByLabelText('실시간 인기 TOP10')).queryByRole('list')).toBeNull()
  expect(screen.queryByText('최근 24시간 동안 조회된 소설이 아직 없어요.')).toBeNull()
})

/** 서버(정본) 작품 카드: 서버가 주지 않는 통계는 감추고 방금 업데이트만 upd(지난 분)를 가진다. */
const server = (id: string, title: string, upd = 0): Work => ({ ...seedWorks(0)[0], id, title, canonical: true, statisticsSupported: false, upd })

it('TOP10 머리에 서버가 순위를 계산한 시각을 한국시간 HH:mm 기준으로 보인다', async () => {
  renderHome()
  const top = await screen.findByLabelText('실시간 인기 TOP10')
  within(top).getByText('14:07 기준')
})

it('방금 업데이트는 서버 업데이트 순에 상대 시각과 회차를 보이고, 이번 주 인기 무료 소설은 서버 인기 줄로 채운다', async () => {
  vi.spyOn(appContainer.resolve('workSearchRepository'), 'rankings').mockImplementation(async ({ kind }) => ({
    computedAt: STUB_RANKED_AT,
    items: kind === 'updated' ? [server('u1', '방금 올라온 소설', 5)] : kind === 'popular' ? [server('p1', '이번 주 인기작')] : [],
  }))
  renderHome()
  const fresh = (await screen.findByRole('heading', { name: '방금 업데이트' })).parentElement!
  within(fresh).getByText('방금 올라온 소설')
  within(fresh).getByText('5분 전 · 4화')
  const weekly = screen.getByRole('heading', { name: '이번 주 인기 무료 소설' }).closest('section')!
  within(weekly).getByText('이번 주 인기작')
  expect(screen.queryByRole('heading', { name: '함께 읽을 소설' })).toBeNull()
  expect(screen.queryByRole('heading', { name: '원작부터 읽어 보세요' })).toBeNull()
})

it('서버 순위 줄이 비면 빈 상태 문구를 보여 준다', async () => {
  vi.spyOn(appContainer.resolve('workSearchRepository'), 'rankings').mockResolvedValue({ items: [], computedAt: STUB_RANKED_AT })
  renderHome()
  const fresh = (await screen.findByRole('heading', { name: '방금 업데이트' })).parentElement!
  within(fresh).getByText('아직 업데이트된 소설이 없어요.')
  within(screen.getByRole('heading', { name: '이번 주 인기 무료 소설' }).closest('section')!).getByText('이번 주에 좋아요를 받은 소설이 아직 없어요.')
})

it.each([
  ['latest', '포크 소설을 불러오지 못했어요.'], ['updated', '업데이트 소식을 불러오지 못했어요.'], ['popular', '이번 주 인기 소설을 불러오지 못했어요.'],
] as const)('%s 줄만 실패하면 그 줄만 실패로 안내하고 나머지 순위는 그대로 보여 준다', async (failing, message) => {
  const rankings = vi.spyOn(appContainer.resolve('workSearchRepository'), 'rankings')
  const stub = rankings.getMockImplementation()!
  rankings.mockImplementation(async (query, signal) => { if (query.kind === failing) throw new Error('offline'); return stub(query, signal) })
  renderHome()
  await screen.findByText(message)
  expect(screen.getAllByText(/불러오지 못했어요/)).toHaveLength(1)
  expect(within(screen.getByLabelText('실시간 인기 TOP10')).getAllByRole('listitem')).toHaveLength(10)
})

it('목업(서버 순위 없음)은 기존 원작 소개 문구를 유지하고 계산 시각을 보이지 않는다', async () => {
  const useCase = appContainer.resolve('readingUseCase')
  const original = useCase.getHome.bind(useCase)
  vi.spyOn(useCase, 'getHome').mockImplementation(async (role, chip) => ({ ...(await original(role, chip)), serverRanking: false, rankingComputedAt: null }))
  renderHome()
  await screen.findByRole('heading', { name: '원작부터 읽어 보세요' })
  // 목업의 fresh는 서버의 업데이트 순위가 아니라 최신 순이므로 weekly처럼 서버 랭킹일 때만 '방금 업데이트'라 부른다.
  expect(screen.getByRole('heading', { name: '함께 읽을 소설' })).toBeTruthy()
  expect(screen.queryByRole('heading', { name: '방금 업데이트' })).toBeNull()
  expect(screen.queryByRole('heading', { name: '이번 주 인기 무료 소설' })).toBeNull()
  expect(screen.queryByText(/\d{2}:\d{2} 기준/)).toBeNull()
})

it('급상승 줄만 실패해도 실패 안내 위에 TOP10의 계산 시각을 남기지 않는다', async () => {
  const rankings = vi.spyOn(appContainer.resolve('workSearchRepository'), 'rankings')
  const stub = rankings.getMockImplementation()!
  rankings.mockImplementation(async (query, signal) => { if (query.kind === 'rising') throw new Error('offline'); return stub(query, signal) })
  renderHome()
  const top = await screen.findByLabelText('실시간 인기 TOP10')
  within(top).getByText('순위를 불러오지 못했어요.')
  expect(within(top).queryByText(/\d{2}:\d{2} 기준/)).toBeNull()
})

it('순위 조회가 실패한 자리마다 다시 불러오기가 있고 누르면 그 자리를 서버 값으로 채운다', async () => {
  const rankings = vi.spyOn(appContainer.resolve('workSearchRepository'), 'rankings')
  const stub = rankings.getMockImplementation()!
  rankings.mockRejectedValue(new Error('offline'))
  renderHome()
  await screen.findByText('다르게 이어진 포크 소설')
  // 실시간 인기·급상승·포크 소설·방금 업데이트·이번 주 인기: 실패한 다섯 자리 모두에서 다시 시도할 수 있다.
  expect(screen.getAllByRole('button', { name: '다시 불러오기' })).toHaveLength(5)
  expect(screen.getAllByRole('alert').map((alert) => alert.textContent)).toContain('순위를 불러오지 못했어요.')
  const top = screen.getByLabelText('실시간 인기 TOP10')
  rankings.mockImplementation(stub)
  fireEvent.click(within(top).getByRole('button', { name: '다시 불러오기' }))
  await waitFor(() => expect(within(top).getAllByRole('listitem')).toHaveLength(10))
  expect(screen.queryByText(/불러오지 못했어요/)).toBeNull()
  expect(screen.queryByRole('button', { name: '다시 불러오기' })).toBeNull()
})

it('필터 칩 묶음은 이름이 있는 그룹이다', async () => {
  renderHome()
  await screen.findByText('다르게 이어진 포크 소설')
  const chips = within(screen.getByRole('group', { name: '소설 필터' })).getAllByRole('button')
  expect(chips.map((chip) => [chip.textContent, chip.getAttribute('aria-pressed')])).toContainEqual(['추천', 'true'])
})

it.each([[true, 'instant'], [false, 'smooth']] as const)('발견 선반 화살표는 동작 줄이기(%s)를 따라 %s로 넘긴다', async (reduced, behavior) => {
  vi.stubGlobal('matchMedia', vi.fn(() => ({ matches: reduced, addEventListener: () => {}, removeEventListener: () => {} })))
  // jsdom에는 요소 scrollBy가 없다.
  const scrollBy = vi.fn()
  Object.defineProperty(HTMLElement.prototype, 'scrollBy', { configurable: true, value: scrollBy })
  try {
    renderHome()
    await screen.findByText('오늘, 스토리포크의 발견')
    fireEvent.click(screen.getByRole('button', { name: '다음' }))
    expect(scrollBy).toHaveBeenCalledWith(expect.objectContaining({ behavior }))
  } finally {
    Reflect.deleteProperty(HTMLElement.prototype, 'scrollBy')
    vi.unstubAllGlobals()
  }
})

it('순위가 아닌 서버 작품 목록(지표 없음)은 기존 중립 제목과 회차만 보이고 지어낸 업데이트 시각을 쓰지 않는다', async () => {
  const useCase = appContainer.resolve('readingUseCase')
  const original = useCase.getHome.bind(useCase)
  vi.spyOn(useCase, 'getHome').mockImplementation(async (role, chip) => ({
    ...(await original(role, chip)), ranked: false, serverRanking: false, rankingComputedAt: null, fresh: [server('c1', '목록 작품', 720)],
  }))
  renderHome()
  const list = (await screen.findByRole('heading', { name: '함께 읽을 소설' })).parentElement!
  within(list).getByText('4화')
  expect(within(list).queryByText(/전/)).toBeNull()
  expect(screen.queryByRole('heading', { name: '방금 업데이트' })).toBeNull()
})
