// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import { afterEach, expect, it, vi } from 'vitest'

import type { Episode, Work } from '../../../../domain/entities/content'
import { kstDateTime } from '../../../shared/format'
import { WorkDashboard } from './WorkDashboard'

// 조회(독자 지표·발행 이력·피드백)는 useWorkDashboard.test가 본다. 여기서는 훅이 준 상태를 어떻게 그리는지만 본다.
type Load<T> = { data: T | undefined; isLoading: boolean; isRefreshing: boolean; isError: boolean; retry: () => void }
const done = <T,>(data: T): Load<T> => ({ data, isLoading: false, isRefreshing: false, isError: false, retry: vi.fn() })
const pending = <T,>(): Load<T> => ({ data: undefined, isLoading: true, isRefreshing: false, isError: false, retry: vi.fn() })
const failed = <T,>(): Load<T> => ({ data: undefined, isLoading: false, isRefreshing: false, isError: true, retry: vi.fn() })
const dash = vi.hoisted(() => ({ state: {} as Record<string, unknown>, calls: [] as unknown[][] }))
vi.mock('../viewmodel/useWorkDashboard', () => ({ useWorkDashboard: (...args: unknown[]) => { dash.calls.push(args); return dash.state } }))

afterEach(() => { cleanup(); dash.calls.length = 0 })

const episode = (number: number, body: string, inherited = false): Episode => ({ number, version: 1, title: `${number}화`, body, inherited })
const work = (over: Partial<Work> = {}): Work => ({
  id: 'w', title: '작품', summary: '', visibility: 'public', allowFork: true, allowForkPublication: false, revision: 0, source: null,
  episodes: [episode(1, '가나다'), episode(2, '라마')], draft: { title: '', body: '', revision: 0 }, ...over,
})
const loaded = (over: object = {}) => {
  dash.state = { reader: done({ likes: 56, views: 1234 }), publications: done([]), feedback: done(5), ...over }
}
type Props = Partial<Parameters<typeof WorkDashboard>[0]>
const open = (props: Props = {}) => {
  render(<MemoryRouter><WorkDashboard work={work()} draftCount={2} forkCounts={{ 1: 1, 2: 2 }} mockup={false} disabled={false} {...props} /></MemoryRouter>)
}
/** 지표 카드의 값: 이름(dt)이 같은 줄(div)의 dd 글 */
const metric = (name: string | RegExp) => {
  const term = screen.getByText(name, { selector: 'dt' })
  return term.nextElementSibling?.textContent
}

it('구획 세 개(작품 지표·최근 발행 이력·바로가기)가 묶음 제목(h3)으로 이름 붙은 region이다', () => {
  loaded()
  open()
  for (const name of ['작품 지표', '최근 발행 이력', '바로가기']) {
    const region = screen.getByRole('region', { name })
    expect(within(region).getByRole('heading', { level: 3, name })).toBeTruthy()
  }
  expect(screen.queryByRole('heading', { level: 2 })).toBeNull() // 탭 제목(h2)은 호출 측이 그린다
})

it('공개 작품의 지표 카드는 서버가 준 값을 그대로 보인다(공개 회차·초안·총 글자 수·포크·피드백·누적 조회·좋아요)', () => {
  loaded()
  open()
  expect(metric('공개 회차')).toBe('2화')
  expect(metric('작성 중인 초안')).toBe('2개')
  expect(metric(/^총 글자 수/)).toBe('5자')
  expect(metric('포크 수')).toBe('3편')
  expect(metric('받은 피드백')).toBe('5건')
  expect(metric('누적 조회(회원)')).toBe('1,234회')
  expect(metric('좋아요')).toBe('56')
})

it('총 글자 수는 이어받은 원작 회차를 빼고 세며, 빼는 때는 이름에 그 사실을 적는다', () => {
  loaded()
  open({ work: work({ episodes: [episode(1, '가나다', true), episode(2, '라마'), episode(3, '바')] }) })
  expect(metric(/^총 글자 수/)).toBe('3자')
  expect(screen.getByText('총 글자 수 · 공백 포함, 원작 회차 제외', { selector: 'dt' })).toBeTruthy()
  cleanup()
  open()
  expect(screen.getByText('총 글자 수 · 공백 포함', { selector: 'dt' })).toBeTruthy()
})

it('큰 수는 천 단위로 끊어 보인다', () => {
  loaded({ reader: done({ likes: 1200, views: 3456789 }) })
  open({ work: work({ episodes: [episode(1, '가'.repeat(12345))] }) })
  expect(metric(/^총 글자 수/)).toBe('12,345자')
  expect(metric('누적 조회(회원)')).toBe('3,456,789회')
  expect(metric('좋아요')).toBe('1,200')
})

it('비공개 작품의 독자 지표(누적 조회·좋아요)는 0이 아니라 공개 전이다', () => {
  loaded({ reader: done('before') })
  open({ work: work({ visibility: 'private' }) })
  expect(metric('누적 조회(회원)')).toBe('공개 전')
  expect(metric('좋아요')).toBe('공개 전')
})

it('집계가 없으면(null) 집계 없음이라고 하고 0으로 채우지 않는다', () => {
  loaded({ reader: done(null) })
  open()
  expect(metric('누적 조회(회원)')).toBe('집계 없음')
  expect(metric('좋아요')).toBe('집계 없음')
})

it('읽는 동안은 …(스크린리더에는 불러오는 중), 읽지 못하면 불러오지 못했어요이고 다른 값은 그대로다', () => {
  loaded({ reader: pending(), feedback: failed() })
  open()
  expect(metric('누적 조회(회원)')).toBe('…불러오는 중')
  expect(metric('좋아요')).toBe('…불러오는 중')
  expect(metric('받은 피드백')).toBe('불러오지 못했어요')
  expect(metric('공개 회차')).toBe('2화')
  cleanup()
  loaded({ reader: failed(), feedback: pending() })
  open()
  expect(metric('누적 조회(회원)')).toBe('불러오지 못했어요')
  expect(metric('받은 피드백')).toBe('…불러오는 중')
})

it('작성 중인 초안은 읽는 중(null)이면 …이고 읽지 못한(undefined) 때는 항목을 감춘다', () => {
  loaded()
  open({ draftCount: null })
  expect(metric('작성 중인 초안')).toBe('…불러오는 중')
  cleanup()
  open({ draftCount: undefined })
  expect(screen.queryByText('작성 중인 초안')).toBeNull()
  expect(screen.getByText('공개 회차')).toBeTruthy()
})

it('포크 수는 읽지 못했거나 읽는 중(undefined)이면 0편으로 채우지 않고 감추고, 읽었으면 값의 합계다', () => {
  loaded()
  open({ forkCounts: undefined })
  expect(screen.queryByText('포크 수')).toBeNull()
  cleanup()
  open({ forkCounts: {} })
  expect(metric('포크 수')).toBe('0편')
})

it('최근 발행 이력은 회차·동작·시각을 한 줄씩 보이고, 시각은 time 요소다', () => {
  loaded({ publications: done([
    { episode: 3, versionId: 'v3', publishedAt: '2026-11-09T00:00:00Z', action: 'publish' as const },
    { episode: 2, versionId: 'v2', publishedAt: '2026-11-08T00:00:00Z', action: 'unpublish' as const },
  ]) })
  open()
  const items = within(screen.getByRole('list')).getAllByRole('listitem')
  expect(items).toHaveLength(2)
  expect(items[0].textContent).toContain('3화 · 발행 ·')
  expect(items[1].textContent).toContain('2화 · 공개 중단 ·')
  expect(items[0].querySelector('time')?.getAttribute('datetime')).toBe('2026-11-09T00:00:00Z')
  // 시각은 한국시간이고 초는 붙이지 않는다(AI 집필 기록과 같은 공용 kstDateTime).
  expect(items[0].querySelector('time')?.textContent).toBe(kstDateTime('2026-11-09T00:00:00Z'))
  expect(items[0].querySelector('time')?.textContent).not.toMatch(/\d:\d\d:\d\d/)
})

it('발행 이력이 없으면 안내만, 못 읽으면 구획 안에 알림(role 없이)과 다시 불러오기를 둔다', () => {
  loaded()
  open()
  const recent = () => screen.getByRole('region', { name: '최근 발행 이력' })
  expect(within(recent()).getByText('발행 이력이 없어요.')).toBeTruthy()
  expect(screen.queryByRole('list')).toBeNull()
  cleanup()
  const publications = failed<never[]>()
  loaded({ publications })
  open()
  expect(within(recent()).getByText(/발행 이력을 불러오지 못했어요/)).toBeTruthy()
  expect(screen.queryByRole('alert')).toBeNull() // 독립 구획의 실패라 화면 알림을 가로채지 않는다
  fireEvent.click(within(recent()).getByRole('button', { name: '다시 불러오기' }))
  expect(publications.retry).toHaveBeenCalledTimes(1)
})

it('바로가기는 사이드바 메뉴에 없는 목적지인 집필실 열기와 (공개 작품이면) 소설 상세 보기뿐이고, 메뉴와 같은 탭 전환 버튼은 두지 않는다', () => {
  loaded()
  open()
  const shortcuts = () => within(screen.getByRole('region', { name: '바로가기' }))
  expect(shortcuts().getAllByRole('link').map((a) => [a.textContent, a.getAttribute('href')])).toEqual([['집필실 열기', '/studio/w'], ['소설 상세 보기', '/work/w']])
  expect(shortcuts().queryAllByRole('button')).toEqual([])
  cleanup()
  open({ work: work({ visibility: 'private' }) })
  expect(shortcuts().getAllByRole('link').map((a) => a.textContent)).toEqual(['집필실 열기']) // 비공개 작품은 소설 상세 보기가 없다
})

it('요청 중이거나 편집 중이면(disabled) 두 바로가기가 같은 모양의 잠긴 버튼이 되어, 저장하지 않은 입력을 잃는 이동이 없다', () => {
  loaded()
  open({ disabled: true })
  const shortcuts = within(screen.getByRole('region', { name: '바로가기' }))
  expect(shortcuts.queryAllByRole('link')).toEqual([])
  const buttons = shortcuts.getAllByRole('button') as HTMLButtonElement[]
  expect(buttons.map((button) => button.textContent)).toEqual(['집필실 열기', '소설 상세 보기'])
  expect(buttons.every((button) => button.disabled && button.classList.contains('ep-shortcut'))).toBe(true)
})

it('독자 지표 조회에는 이 작품·목업 여부를 넘기고, 테스트가 넣은 UseCase는 발행 이력에 쓴다', () => {
  loaded()
  const episodes = { history: vi.fn() }
  open({ mockup: true, useCase: episodes as never })
  expect(dash.calls[0][0]).toMatchObject({ id: 'w', visibility: 'public' })
  expect(dash.calls[0][1]).toBe(true)
  expect(dash.calls[0][2]).toEqual({ episodes })
})
