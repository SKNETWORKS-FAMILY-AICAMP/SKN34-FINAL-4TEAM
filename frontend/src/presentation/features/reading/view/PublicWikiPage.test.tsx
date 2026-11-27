// @vitest-environment jsdom
import '../../../../test/fixtureApp' // appContainer보다 먼저: 시드 작품과 메모리 저장소를 쓴다

import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { Provider } from 'react-redux'
import { MemoryRouter, Route, Routes } from 'react-router'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'

import { appContainer } from '../../../../app/appContainer'
import { createAppStore } from '../../../../app/store'
import { WCATS, type ReaderWorldCards } from '../../../../domain/entities/wiki'
import { PublicWikiPage } from './PublicWikiPage'

// 시드 작품을 서버(정본) 작품으로 본다. 연결된 세계관의 카드 읽기(ReadingUseCase.linkedWorldCards)만 대역으로 바꾼다(HTTP 계약은 data 단위 테스트).
const works = () => appContainer.resolve('mockDb').works
beforeEach(() => { for (const work of works()) work.canonical = true })
afterEach(() => { cleanup(); vi.restoreAllMocks(); delete appContainer.resolve('workRepository').readWorldCards; for (const work of works()) delete work.canonical })

const linked = () => vi.spyOn(appContainer.resolve('readingUseCase'), 'linkedWorldCards')
const served = (extra: Partial<ReaderWorldCards> = {}): ReaderWorldCards => ({
  workId: 'guunmong', worldId: 'world-1', upto: 2, relationshipStatus: 'current',
  cards: [
    { id: 'c1', title: '성진', text: '연화봉의 젊은 승려.', cardType: 'character', aliases: [], tags: [], revealFromEpisode: 1 },
    { id: 'c2', title: '연화봉', text: '육관대사의 도량이 있다.', cardType: 'location', aliases: [], tags: [], revealFromEpisode: 2 },
  ],
  relationships: [{ id: 'r1', sourceCardId: 'c1', targetCardId: 'c2', label: '수행하는 곳' }],
  ...extra,
})
const show = (path: string) => render(
  <Provider store={createAppStore()}>
    <MemoryRouter initialEntries={[path]}><Routes><Route path="/work/:id/wiki" element={<PublicWikiPage />} /></Routes></MemoryRouter>
  </Provider>,
)
const article = () => screen.findByRole('article', { name: '구운몽/설정 위키' })

it('연결된 세계관이 있는 서버 작품은 그 세계관의 독자 공개 카드로 위키를 채우고 서버가 적용한 기준 회차를 알린다', async () => {
  const read = linked().mockResolvedValue(served({ upto: 1 }))
  show('/work/guunmong/wiki?upto=2')
  const panel = within(await article())
  expect(read).toHaveBeenCalledWith(expect.objectContaining({ id: 'guunmong', canonical: true }), 2)
  // 요청은 2화였지만 서버가 1화까지만 적용했으면 그 값으로 알리고 그 회차로 돌아간다.
  panel.getByText('1화까지 공개된 설정만 보여요.')
  screen.getByRole('link', { name: '구운몽 1화로 돌아가기' })
  panel.getByRole('heading', { name: '1.1. 성진', level: 3 })
  expect(within(panel.getByRole('heading', { name: '2.1. 연화봉', level: 3 }).closest('.nw-doc') as HTMLElement).getByRole('link', { name: '성진' })).toBeTruthy()
})

it('연결된 세계관이 없으면 기존 작품 설정 위키를 그대로 보인다', async () => {
  linked().mockResolvedValue(null)
  const legacy = { id: 'char:성진', cat: 'char', t: '성진', alias: [], tags: [], props: {}, at: {}, body: '계율을 어긴 **제자**' }
  vi.spyOn(appContainer.resolve('workRepository'), 'readWorld').mockImplementation(async (work) => ({ ...work, wiki: { docs: [legacy], cats: structuredClone(WCATS) } }))
  show('/work/guunmong/wiki')
  const panel = within(await article())
  expect([...(await article()).querySelectorAll('details > summary')].map((s) => s.textContent)).toEqual(['1. 캐릭터'])
  panel.getByText('계율을 어긴 **제자**') // 기존 위키 본문은 마크다운으로 바꾸지 않는다
  panel.getByText('4화까지 공개된 설정만 보여요.')
})

it('관계를 읽지 못한 응답이면 카드는 그대로 보이고 연결을 불러오지 못했다고 알린다', async () => {
  linked().mockResolvedValue(served({ relationships: [], relationshipStatus: 'unavailable' }))
  show('/work/guunmong/wiki')
  const panel = within(await article())
  panel.getByRole('heading', { name: '1.1. 성진', level: 3 })
  panel.getByText(/설정 사이의 연결을 불러오지 못했어요/)
})

it('연결된 세계관의 카드를 읽지 못하면 빈 위키 대신 실패를 알리고 다시 불러오면 보인다', async () => {
  // 저장소에서 실패시켜 실제 UseCase(linkedWorldCards)를 지난다: UseCase가 실패를 '연결 없음'으로 삼키면 기존 위키가 보여 아래 단언이 깨진다.
  const read = vi.fn<(workId: string, upto?: number) => Promise<ReaderWorldCards>>().mockRejectedValue(new Error('offline'))
  appContainer.resolve('workRepository').readWorldCards = read
  show('/work/guunmong/wiki')
  const alert = await screen.findByRole('alert')
  expect(alert.textContent).toContain('불러오지 못했어요')
  expect(screen.queryByRole('article')).toBeNull()
  read.mockResolvedValue(served())
  fireEvent.click(within(alert).getByRole('button', { name: '다시 불러오기' }))
  within(await article()).getByRole('heading', { name: '1.1. 성진', level: 3 })
})
