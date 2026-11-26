// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { Provider } from 'react-redux'
import { MemoryRouter, Route, Routes } from 'react-router'
import { afterEach, expect, it, vi } from 'vitest'

import { createAppStore } from '../../../../app/store'
import type { InheritedWorld, Work } from '../../../../domain/entities/content'
import type { StudioWorld } from '../../../../domain/entities/studioWorld'
import { LinkedWorldPanel } from './LinkedWorldPanel'

/** 올린 표지를 소유자 인증으로 읽는 공용 훅의 대역. 기본값은 읽는 중이다(서재 MyWorlds 테스트와 같은 방식). */
const cover = vi.hoisted(() => vi.fn<(useCase: unknown, worldId: string | undefined, enabled: boolean, revision: number) => { url: string; error: string }>(() => ({ url: '', error: '' })))
vi.mock('../../../shared/useWorldCoverImage', () => ({ useWorldCoverImage: cover }))

afterEach(() => { cleanup(); cover.mockReset() })

const world = (id: string, name: string, linkedWorkId: string | null = null, extra: Partial<StudioWorld> = {}): StudioWorld => ({ id, name, description: '', version: 1, settings: [], analysis: null, linkedWorkId, ...extra })
const MINE = [world('free', '빈 세계'), world('other', '다른 소설의 세계', 'w2'), world('mine', '이 소설의 세계', 'w1')]
const stubWorlds = (list: () => Promise<StudioWorld[]>, supportsCover = false) => ({ list: vi.fn(list), cover: vi.fn(), supportsCover })
/** 내 세계관 목록 대역과 연결 요청 기록. 목록은 호출마다 list()가 정한 값을 준다. 목록 조회(useAsyncData)가 store를 읽어 Provider로 감싼다. */
function show(worldStudioId: string | null | undefined, list: () => Promise<StudioWorld[]> = async () => MINE, busy = false, supportsCover = false) {
  const onLink = vi.fn(async () => true)
  const worlds = stubWorlds(list, supportsCover)
  const store = createAppStore()
  const tree = (id: string | null | undefined) => <Provider store={store}><MemoryRouter><LinkedWorldPanel work={{ id: 'w1', worldStudioId: id, source: null }} busy={busy} onLink={onLink} onDetach={vi.fn(async () => null)} worlds={worlds} /></MemoryRouter></Provider>
  const view = render(tree(worldStudioId))
  /** 부모가 연결·해제 결과를 작품에 반영한 것처럼 같은 패널을 다른 연결 상태로 다시 그린다(패널 안의 선택·검색어 상태는 그대로 남는다). */
  const relink = (id: string | null) => view.rerender(tree(id))
  return { onLink, worlds, view, relink, card: () => within(screen.getByRole('region', { name: '세계관 연결' })) }
}
/** 목록에 보이는 세계관 이름(카드 라디오의 이름)을 위에서 아래로 */
const listed = (card: ReturnType<typeof show>['card']) => card().queryAllByRole('radio').map((radio) => document.getElementById(radio.getAttribute('aria-labelledby') ?? '')?.textContent)
/** 카드 한 장의 표지 이미지 주소. 이미지가 없으면(표지를 읽는 중) undefined */
const coverOf = (card: ReturnType<typeof show>['card'], name: string) => card().getByRole('radio', { name }).closest('label')?.querySelector('img')?.getAttribute('src')

it('연결된 세계관은 이름을 그 세계관 관리 화면 링크로 보이고 연결 해제를 요청한다', async () => {
  const { card, onLink } = show('mine')
  const link = await card().findByRole('link', { name: '이 소설의 세계' })
  expect(link.getAttribute('href')).toBe('/worldstudio/mine')
  expect(link.closest('p')?.textContent).toBe('연결된 세계관: 이 소설의 세계')
  expect(card().queryByRole('searchbox')).toBeNull()
  expect(card().queryByRole('radio')).toBeNull()
  // 1:1·독자 위키 공개 범위 설명은 고를 때 필요한 정보라 이미 연결된 뒤에는 읽히지 않는다.
  expect(card().queryByText(/세계관 하나는 소설 하나에만 연결돼요/)).toBeNull()
  fireEvent.click(card().getByRole('button', { name: '연결 해제' }))
  await waitFor(() => expect(onLink).toHaveBeenCalledWith(null)) // 해제 직전에 목록을 다시 읽은 뒤 요청한다
})

/** 공개 세계관(장르 있음)이 이 소설에 연결된 목록 */
const PUBLIC_MINE = [world('free', '빈 세계'), world('mine', '이 소설의 세계', 'w1', { visibility: 'public', genre: 'fantasy' })]
const openUnlinkWarning = async (list: () => Promise<StudioWorld[]> = async () => PUBLIC_MINE) => {
  const shown = show('mine', list)
  await shown.card().findByRole('link', { name: '이 소설의 세계' }) // 세계관 목록을 읽은 뒤
  fireEvent.click(shown.card().getByRole('button', { name: '연결 해제' }))
  const box = await screen.findByRole('alertdialog', { name: '세계관 연결을 해제할까요?' }) // 해제 직전에 목록을 다시 읽은 뒤에 열린다
  return { ...shown, box, dialog: () => within(box) }
}

it('공개 세계관의 연결 해제는 경고 대화 상자를 열어 세계관을 비공개로 바꾸고 해제(처음 초점)·공개 그대로 해제·취소를 고르게 하고, 고르기 전에는 해제를 요청하지 않는다', async () => {
  const { box, dialog, onLink } = await openUnlinkWarning()
  expect(onLink).not.toHaveBeenCalled()
  expect(document.getElementById(box.getAttribute('aria-describedby')!)?.textContent).toBe('이 세계관은 공개 상태예요. 연결을 해제하면 작가 전용이던 설정 카드까지 모든 설정이 독자에게 공개돼요.')
  expect(dialog().getAllByRole('button').map((button) => button.textContent)).toEqual(['세계관을 비공개로 바꾸고 해제', '공개 그대로 해제', '취소'])
  await waitFor(() => expect(document.activeElement).toBe(dialog().getByRole('button', { name: '세계관을 비공개로 바꾸고 해제' }))) // 처음 초점은 안전한 쪽이다
  fireEvent.click(dialog().getByRole('button', { name: '취소' }))
  expect(screen.queryByRole('alertdialog')).toBeNull()
  expect(onLink).not.toHaveBeenCalled()
})

it('세계관을 비공개로 바꾸고 해제를 고르면 장르를 현재 값 그대로 실어 해제를 요청하고 대화 상자를 닫는다', async () => {
  const { dialog, onLink } = await openUnlinkWarning()
  fireEvent.click(dialog().getByRole('button', { name: '세계관을 비공개로 바꾸고 해제' }))
  expect(onLink).toHaveBeenCalledWith(null, { makePrivate: { genre: 'fantasy' } })
  expect(screen.queryByRole('alertdialog')).toBeNull()
})

it('공개 그대로 해제를 고르면 비공개로 바꾸지 않고 해제를 요청하며, 장르가 없는 세계관은 장르 없음 그대로 보낸다', async () => {
  const { dialog, onLink } = await openUnlinkWarning()
  fireEvent.click(dialog().getByRole('button', { name: '공개 그대로 해제' }))
  expect(onLink).toHaveBeenCalledWith(null, {})
  cleanup()
  const none = await openUnlinkWarning(async () => [world('mine', '이 소설의 세계', 'w1', { visibility: 'public' })])
  fireEvent.click(none.dialog().getByRole('button', { name: '세계관을 비공개로 바꾸고 해제' }))
  expect(none.onLink).toHaveBeenCalledWith(null, { makePrivate: { genre: null } })
})

it('비공개 세계관은 경고 없이 지금처럼 해제를 요청한다(확인은 호출한 쪽이 묻는다)', async () => {
  const { card, onLink } = show('mine') // 목록의 이 세계관은 공개 여부가 없어 비공개다
  await card().findByRole('link', { name: '이 소설의 세계' }) // 목록을 읽은 뒤
  fireEvent.click(card().getByRole('button', { name: '연결 해제' }))
  await waitFor(() => expect(onLink).toHaveBeenCalledWith(null)) // 해제 직전에 목록을 다시 읽은 뒤
  expect(screen.queryByRole('alertdialog')).toBeNull()
})

it('내 세계관 목록을 처음 읽는 동안에는 연결 해제가 잠기고, 읽고 나면 풀린다', async () => {
  let finish!: (worlds: StudioWorld[]) => void
  const { card, onLink, worlds } = show('mine', () => new Promise<StudioWorld[]>((resolve) => { finish = resolve }))
  const unlink = () => card().getByRole<HTMLButtonElement>('button', { name: '연결 해제' })
  await waitFor(() => expect(worlds.list).toHaveBeenCalled()) // 목록 요청이 나간 뒤(그때 finish가 정해진다)에도 아직 읽는 중이다
  expect(unlink().disabled).toBe(true)
  fireEvent.click(unlink()) // 잠긴 버튼은 아무것도 하지 않는다
  expect(screen.queryByRole('alertdialog')).toBeNull()
  expect(onLink).not.toHaveBeenCalled()
  await act(async () => { finish(MINE) })
  await waitFor(() => expect(unlink().disabled).toBe(false))
})

it('해제를 누르면 그때 목록을 다시 읽어(읽는 동안 버튼이 잠긴다) 최신 공개 여부로 정한다: 탭을 열 때 비공개였어도 그 사이 공개로 바뀌었으면 경고하고 다시 읽은 장르를 보낸다', async () => {
  let calls = 0
  let reread!: (worlds: StudioWorld[]) => void
  const { card, onLink, worlds } = show('mine', () => (++calls === 1 ? Promise.resolve([world('mine', '이 소설의 세계', 'w1')]) : new Promise<StudioWorld[]>((resolve) => { reread = resolve })))
  await card().findByRole('link', { name: '이 소설의 세계' }) // 탭을 열 때는 비공개
  const unlink = () => card().getByRole<HTMLButtonElement>('button', { name: '연결 해제' })
  unlink().focus() // 누르면 초점이 버튼에 있다
  fireEvent.click(unlink())
  await waitFor(() => expect(unlink().getAttribute('aria-disabled')).toBe('true')) // 다시 읽는 동안 잠긴다
  expect(unlink().disabled).toBe(false) // disabled가 되면 초점을 잃어 경고 상자가 닫힌 뒤 돌아갈 곳이 없다
  fireEvent.click(unlink()) // 잠긴 동안 다시 눌러도 다시 읽지 않는다
  expect(worlds.list).toHaveBeenCalledTimes(2)
  expect(onLink).not.toHaveBeenCalled()
  await act(async () => { reread([world('mine', '이 소설의 세계', 'w1', { visibility: 'public', genre: 'drama' })]) }) // 그 사이 공개로 바뀌었다
  const dialog = within(await screen.findByRole('alertdialog', { name: '세계관 연결을 해제할까요?' }))
  expect(unlink().getAttribute('aria-disabled')).toBeNull() // 다시 읽기가 끝나 풀린다
  expect(dialog.getAllByRole('button').map((button) => button.textContent)).toEqual(['세계관을 비공개로 바꾸고 해제', '공개 그대로 해제', '취소'])
  fireEvent.click(dialog.getByRole('button', { name: '취소' }))
  expect(document.activeElement).toBe(unlink()) // 취소하면 누른 버튼으로 돌아온다
  fireEvent.click(unlink()) // 다시 누르면 다시 읽는다
  await waitFor(() => expect(worlds.list).toHaveBeenCalledTimes(3))
  await act(async () => { reread([world('mine', '이 소설의 세계', 'w1', { visibility: 'public', genre: 'drama' })]) })
  fireEvent.click(within(await screen.findByRole('alertdialog')).getByRole('button', { name: '세계관을 비공개로 바꾸고 해제' }))
  expect(onLink).toHaveBeenCalledWith(null, { makePrivate: { genre: 'drama' } }) // 탭을 열 때가 아니라 다시 읽은 최신 값이다
})

it('해제가 성공하면 사라지는 버튼 대신 연결 구역의 제목으로 초점을 옮기고(경고 상자를 거쳐도 같다), 실패하면 옮기지 않고 해제 버튼으로 돌아온다', async () => {
  const heading = (shown: ReturnType<typeof show>) => shown.card().getByRole('heading', { name: '세계관 연결' })
  const plain = show('mine') // 비공개 세계관: 경고 없이 해제한다
  await plain.card().findByRole('link', { name: '이 소설의 세계' })
  const plainUnlink = plain.card().getByRole('button', { name: '연결 해제' })
  plainUnlink.focus()
  fireEvent.click(plainUnlink)
  await waitFor(() => expect(document.activeElement).toBe(heading(plain)))
  cleanup()
  const viaDialog = show('mine', async () => PUBLIC_MINE) // 공개 세계관: 경고 상자에서 고른 뒤
  await viaDialog.card().findByRole('link', { name: '이 소설의 세계' })
  const dialogUnlink = viaDialog.card().getByRole('button', { name: '연결 해제' })
  dialogUnlink.focus()
  fireEvent.click(dialogUnlink)
  fireEvent.click(within(await screen.findByRole('alertdialog')).getByRole('button', { name: '공개 그대로 해제' }))
  await waitFor(() => expect(document.activeElement).toBe(heading(viaDialog)))
  cleanup()
  const failing = show('mine', async () => PUBLIC_MINE)
  await failing.card().findByRole('link', { name: '이 소설의 세계' })
  failing.onLink.mockResolvedValueOnce(false) // 해제하지 못했다
  const failedUnlink = failing.card().getByRole('button', { name: '연결 해제' })
  failedUnlink.focus()
  fireEvent.click(failedUnlink)
  fireEvent.click(within(await screen.findByRole('alertdialog')).getByRole('button', { name: '공개 그대로 해제' }))
  await waitFor(() => expect(failing.onLink).toHaveBeenCalled())
  await act(async () => {})
  expect(document.activeElement).toBe(failedUnlink) // 버튼이 남아 있으니 거기로 돌아온다
})

it('탭을 열 때 공개였어도 해제 직전에 다시 읽은 값이 비공개면 경고 없이 해제를 요청하고, 다시 읽지 못하면 비공개였어도 공개 여부를 모르는 경고를 연다', async () => {
  let calls = 0
  const flipped = show('mine', async () => [++calls === 1 ? world('mine', '이 소설의 세계', 'w1', { visibility: 'public' }) : world('mine', '이 소설의 세계', 'w1')])
  await flipped.card().findByRole('link', { name: '이 소설의 세계' })
  fireEvent.click(flipped.card().getByRole('button', { name: '연결 해제' }))
  await waitFor(() => expect(flipped.onLink).toHaveBeenCalledWith(null))
  expect(screen.queryByRole('alertdialog')).toBeNull()
  cleanup()
  calls = 0
  const failing = show('mine', async () => { if (++calls > 1) throw new Error('offline'); return MINE })
  await failing.card().findByRole('link', { name: '이 소설의 세계' })
  fireEvent.click(failing.card().getByRole('button', { name: '연결 해제' }))
  const dialog = within(await screen.findByRole('alertdialog', { name: '세계관 연결을 해제할까요?' }))
  expect(dialog.getAllByRole('button').map((button) => button.textContent)).toEqual(['공개 그대로 해제', '취소'])
  expect(failing.onLink).not.toHaveBeenCalled()
})

it('다시 읽는 중 화면을 떠나면 그 요청을 취소하고 아무것도 하지 않는다', async () => {
  let calls = 0
  const { card, onLink, worlds, view } = show('mine', () => (++calls === 1 ? Promise.resolve(MINE) : new Promise<StudioWorld[]>(() => undefined)))
  await card().findByRole('link', { name: '이 소설의 세계' })
  fireEvent.click(card().getByRole('button', { name: '연결 해제' }))
  const signal = (worlds.list.mock.calls[1] as unknown[])[0] as AbortSignal
  expect(signal.aborted).toBe(false)
  view.unmount()
  expect(signal.aborted).toBe(true)
  expect(onLink).not.toHaveBeenCalled()
})

it('목록을 읽지 못하거나 목록에 이 세계관이 없어 공개 여부를 모르면 공개일 수 있다는 경고를 비공개 선택지 없이 공개 그대로 해제·취소만으로 열고, 처음 초점은 취소다', async () => {
  const failed = show('mine', async () => { throw new Error('offline') })
  await failed.card().findByRole('alert') // 내 세계관을 불러오지 못했어요
  fireEvent.click(failed.card().getByRole('button', { name: '연결 해제' }))
  const box = await screen.findByRole('alertdialog', { name: '세계관 연결을 해제할까요?' })
  expect(document.getElementById(box.getAttribute('aria-describedby')!)?.textContent).toBe('이 세계관의 공개 여부를 확인하지 못했어요. 공개 세계관이라면 연결을 해제할 때 작가 전용이던 설정 카드까지 모든 설정이 독자에게 공개돼요.')
  const dialog = within(box)
  expect(dialog.getAllByRole('button').map((button) => button.textContent)).toEqual(['공개 그대로 해제', '취소']) // 장르를 몰라 비공개로 바꿀 수 없다
  await waitFor(() => expect(document.activeElement).toBe(dialog.getByRole('button', { name: '취소' })))
  fireEvent.click(dialog.getByRole('button', { name: '취소' }))
  expect(screen.queryByRole('alertdialog')).toBeNull()
  expect(failed.onLink).not.toHaveBeenCalled()
  fireEvent.click(failed.card().getByRole('button', { name: '연결 해제' }))
  fireEvent.click(within(await screen.findByRole('alertdialog')).getByRole('button', { name: '공개 그대로 해제' }))
  expect(failed.onLink).toHaveBeenCalledWith(null, {}) // 대화 상자가 확인을 받았으니 호출한 쪽이 다시 묻지 않는다
  cleanup()
  const absent = show('mine', async () => [world('free', '빈 세계')]) // 목록은 읽었지만 이 세계관이 없다
  const unlink = () => absent.card().getByRole<HTMLButtonElement>('button', { name: '연결 해제' })
  await waitFor(() => expect(unlink().disabled).toBe(false))
  fireEvent.click(unlink())
  expect(within(await screen.findByRole('alertdialog')).getAllByRole('button').map((button) => button.textContent)).toEqual(['공개 그대로 해제', '취소'])
  expect(absent.onLink).not.toHaveBeenCalled()
})

it('세계관 연결 구획은 같은 탭의 다른 카드와 같은 카드(tcard ep-card)이고, 표지 격자를 담은 연결 양식만 카드 폭을 다 쓰는 ep-pick-form이다(검색창은 양식 밖)', async () => {
  const { card } = show(null)
  const search = await card().findByRole('searchbox', { name: '세계관 검색' })
  const region = screen.getByRole('region', { name: '세계관 연결' })
  expect([...region.classList]).toEqual(expect.arrayContaining(['tcard', 'ep-card']))
  const form = card().getByRole('button', { name: '세계관 연결' }).closest('form')!
  expect(form.classList.contains('ep-pick-form')).toBe(true)
  expect(form.classList.contains('ep-edit')).toBe(true)
  expect(search.closest('form')).toBeNull()
})

it('미연결이면 검색창 아래 목록에서 고르기 전에는 연결할 수 없고, 고른 세계관으로만 연결을 요청한다', async () => {
  const { card, onLink } = show(null, async () => [...MINE, world('free-2', '둘째 빈 세계')])
  const search = await card().findByRole('searchbox', { name: '세계관 검색' }) as HTMLInputElement
  // 드롭다운이 아니라 검색창과 표지 카드 목록이다. 연결 전에는 세계관을 고르는 데 필요한 규칙 설명이 그대로 보인다.
  expect(card().queryByRole('combobox')).toBeNull()
  expect(card().getByText(/세계관 하나는 소설 하나에만 연결돼요/)).toBeTruthy()
  // 검색어가 비면 연결할 수 있는 세계관 전체다: 다른 소설에 연결된 세계관은 빠지고, 목록을 읽은 뒤 이 소설에서 연결을 푼 세계관은 다시 고를 수 있다. 처음에는 아무것도 고르지 않았다.
  expect(search.value).toBe('')
  expect(card().getByRole('group', { name: '연결할 세계관' })).toBeTruthy()
  expect(listed(card)).toEqual(['빈 세계', '이 소설의 세계', '둘째 빈 세계'])
  expect(card().queryAllByRole('radio', { checked: true })).toEqual([])
  // 고르기 전에는 버튼이 잠기고 이유를 버튼에 이어 알린다. 잠긴 버튼을 눌러도, 양식이 그대로 제출돼도 연결 요청은 가지 않는다.
  const connect = card().getByRole('button', { name: '세계관 연결' }) as HTMLButtonElement
  expect(connect.disabled).toBe(true)
  expect(document.getElementById(connect.getAttribute('aria-describedby') ?? '')?.textContent).toBe('연결할 세계관을 먼저 골라 주세요.')
  fireEvent.click(connect)
  fireEvent.submit(connect.closest('form')!)
  expect(onLink).not.toHaveBeenCalled()
  // 고르면 그 세계관으로 연결을 요청한다.
  fireEvent.click(card().getByRole('radio', { name: '빈 세계' }))
  expect(connect.disabled).toBe(false)
  expect(card().queryByText('연결할 세계관을 먼저 골라 주세요.')).toBeNull()
  expect(connect.hasAttribute('aria-describedby')).toBe(false)
  fireEvent.click(connect)
  expect(onLink).toHaveBeenLastCalledWith('free')
  fireEvent.click(card().getByRole('radio', { name: '둘째 빈 세계' }))
  fireEvent.click(connect)
  expect(onLink).toHaveBeenLastCalledWith('free-2')
  expect(card().queryByRole('button', { name: '연결 해제' })).toBeNull()
})

it('세계관은 검색 화면의 카드처럼 표지·이름·설정 카드 수로 보이고, 검색창은 연결 양식 밖에 있어 Enter가 연결을 제출하지 않는다', async () => {
  const { card } = show(null, async () => [world('free', '빈 세계', null, { cardCount: 12 }), world('free-2', '둘째 빈 세계')])
  const search = await card().findByRole('searchbox', { name: '세계관 검색' }) as HTMLInputElement
  // 검색창이 연결 양식 안에 있으면 Enter가 양식을 제출해 고른 세계관을 바로 연결한다.
  expect(search.form).toBeNull()
  expect(card().getByRole('button', { name: '세계관 연결' }).closest('form')).toBeTruthy()
  const description = (name: string) => document.getElementById(card().getByRole('radio', { name }).getAttribute('aria-describedby') ?? '')?.textContent
  // 서버 요약의 카드 수(cardCount)를 쓰고, 없으면 설정 수다.
  expect(description('빈 세계')).toBe('설정 카드 12개')
  expect(description('둘째 빈 세계')).toBe('설정 카드 0개')
  expect(coverOf(card, '빈 세계')).toBe('/default-work-cover.svg')
})

it('고른 세계관 카드에만 선택됨이 보이고, 검색으로 빠져 선택이 비워지면 사라진다', async () => {
  const { card } = show(null)
  const search = await card().findByRole('searchbox', { name: '세계관 검색' })
  expect(card().queryByText('선택됨')).toBeNull()
  fireEvent.click(card().getByRole('radio', { name: '빈 세계' }))
  expect(card().getAllByText('선택됨')).toHaveLength(1)
  expect(card().getByText('선택됨').closest('label')).toBe(card().getByRole('radio', { name: '빈 세계' }).closest('label'))
  fireEvent.change(search, { target: { value: '이 소설' } })
  expect(card().queryByText('선택됨')).toBeNull()
})

it('올린 표지가 있는 세계관은 소유자 인증으로 읽은 표지를, 없거나 읽지 못하면 기본 표지를, 읽는 동안은 빈 칸을 보인다', async () => {
  const read: Record<string, { url: string; error: string }> = { w2: { url: 'blob:world-cover', error: '' }, w3: { url: '', error: '표지를 불러오지 못했어요.' } }
  cover.mockImplementation((_useCase, id) => read[id ?? ''] ?? { url: '', error: '' })
  const { card, worlds } = show(null, async () => [world('w1', '세계 1'), world('w2', '세계 2', null, { hasCover: true }), world('w3', '세계 3', null, { hasCover: true }), world('w4', '세계 4', null, { hasCover: true })], false, true)
  await card().findByRole('searchbox', { name: '세계관 검색' })
  // 읽는 동안(w4)은 기본 표지가 아니라 빈 칸이라, 올린 표지가 기본 표지에서 바뀌며 깜빡이지 않는다.
  expect(['세계 1', '세계 2', '세계 3', '세계 4'].map((name) => coverOf(card, name))).toEqual(['/default-work-cover.svg', 'blob:world-cover', '/default-work-cover.svg', undefined])
  expect(cover).toHaveBeenCalledWith(worlds, 'w1', false, 0) // 올린 표지가 없는 세계관은 읽지 않는다
  expect(cover).toHaveBeenCalledWith(worlds, 'w2', true, 0)
})

it('표지 저장소가 없는 데모는 올린 표지가 있다고 해도 읽지 않고 기본 표지를 보인다', async () => {
  const { card, worlds } = show(null, async () => [world('w1', '세계 1', null, { hasCover: true })])
  await card().findByRole('searchbox', { name: '세계관 검색' })
  expect(coverOf(card, '세계 1')).toBe('/default-work-cover.svg')
  expect(cover).toHaveBeenCalledWith(worlds, 'w1', false, 0)
})

it('검색어로 이름을 걸러 목록을 좁히고, 비우면 전체로 돌아오며, 결과가 없으면 알린다', async () => {
  const { card } = show(null, async () => [...MINE, world('free-2', '둘째 빈 세계')])
  const search = await card().findByRole('searchbox', { name: '세계관 검색' })
  fireEvent.change(search, { target: { value: '빈' } })
  expect(listed(card)).toEqual(['빈 세계', '둘째 빈 세계'])
  fireEvent.change(search, { target: { value: '둘째' } })
  expect(listed(card)).toEqual(['둘째 빈 세계'])
  expect(card().queryByText('검색 결과가 없어요')).toBeNull()
  // 결과가 없어도 검색창은 남는다(검색어를 고쳐 다시 찾을 수 있다).
  fireEvent.change(search, { target: { value: '없는 이름' } })
  expect(listed(card)).toEqual([])
  expect(card().getByRole('status').textContent).toBe('검색 결과가 없어요')
  fireEvent.change(search, { target: { value: '' } })
  expect(listed(card)).toEqual(['빈 세계', '이 소설의 세계', '둘째 빈 세계'])
})

it('고른 세계관이 검색으로 목록에서 빠지면 선택을 비워 연결을 잠그고, 목록에 남아 있으면 선택을 유지한다', async () => {
  const { card, onLink } = show(null, async () => [...MINE, world('free-2', '둘째 빈 세계')])
  const search = await card().findByRole('searchbox', { name: '세계관 검색' })
  const connect = card().getByRole('button', { name: '세계관 연결' }) as HTMLButtonElement
  const checked = (name: string) => (card().getByRole('radio', { name }) as HTMLInputElement).checked
  fireEvent.click(card().getByRole('radio', { name: '빈 세계' }))
  // 검색해도 목록에 남아 있으면 그대로 고른 채다.
  fireEvent.change(search, { target: { value: '빈' } })
  expect(checked('빈 세계')).toBe(true)
  expect(connect.disabled).toBe(false)
  // 목록에서 빠지면 선택을 비운다: 보이지 않는 세계관으로 연결하지 않고, 검색어를 지워도 되살아나지 않는다.
  fireEvent.change(search, { target: { value: '이 소설' } })
  expect(connect.disabled).toBe(true)
  fireEvent.submit(connect.closest('form')!)
  expect(onLink).not.toHaveBeenCalled()
  fireEvent.change(search, { target: { value: '' } })
  expect(card().queryAllByRole('radio', { checked: true })).toEqual([])
})

it('연결을 해제하면 고른 세계관과 검색어를 비워, 다시 나타난 양식이 직전 선택으로 시작하지 않는다', async () => {
  const { card, onLink, relink } = show(null)
  fireEvent.change(await card().findByRole('searchbox', { name: '세계관 검색' }), { target: { value: '이 소설' } })
  fireEvent.click(card().getByRole('radio', { name: '이 소설의 세계' }))
  relink('mine') // 연결이 작품에 반영돼 양식이 사라진다
  fireEvent.click(card().getByRole('button', { name: '연결 해제' }))
  await waitFor(() => expect(onLink).toHaveBeenLastCalledWith(null)) // 해제 직전에 목록을 다시 읽은 뒤 요청한다
  relink(null) // 해제가 반영돼 양식이 다시 나타난다
  expect((card().getByRole('searchbox', { name: '세계관 검색' }) as HTMLInputElement).value).toBe('')
  expect(card().queryAllByRole('radio', { checked: true })).toEqual([])
})

it('연결할 수 있는 내 세계관이 없으면 세계관 만들기로 안내한다', async () => {
  const { card } = show(undefined, async () => [world('other', '다른 소설의 세계', 'w2')])
  await card().findByText('연결할 수 있는 내 세계관이 없어요. 다른 소설에 연결되지 않은 세계관만 연결할 수 있어요.')
  expect(card().getByRole('link', { name: '세계관 만들기' }).getAttribute('href')).toBe('/worldstudio')
  expect(card().queryByRole('button', { name: '세계관 연결' })).toBeNull()
})

it('내 세계관을 읽는 동안과 읽지 못했을 때를 빈 목록과 구분해 알리고 다시 불러온다', async () => {
  let fail = true
  const { card, worlds } = show(null, async () => { if (fail) throw new Error('offline'); return MINE })
  expect(card().getByRole('status').textContent).toBe('내 세계관을 불러오고 있어요…')
  expect((await card().findByRole('alert')).textContent).toBe('내 세계관을 불러오지 못했어요.')
  expect(card().queryByText(/연결할 수 있는 내 세계관이 없어요/)).toBeNull()
  fail = false
  fireEvent.click(card().getByRole('button', { name: '내 세계관 다시 불러오기' }))
  await card().findByRole('searchbox', { name: '세계관 검색' })
  expect(card().queryByRole('alert')).toBeNull()
  expect(worlds.list).toHaveBeenCalledTimes(2)
})

it('세계관 이름을 읽지 못해도 연결된 세계관으로 가는 링크와 연결 해제는 남고, 처리 중에는 누를 수 없다', async () => {
  const { card } = show('mine', async () => { throw new Error('offline') }, true)
  await card().findByRole('alert')
  expect(card().getByRole('link', { name: '세계관 열기' }).getAttribute('href')).toBe('/worldstudio/mine')
  expect((card().getByRole('button', { name: '연결 해제' }) as HTMLButtonElement).disabled).toBe(true)
  await act(async () => {})
})

// ── Fork 세계관 독립(#583): 자기 세계관이 없는 Fork는 이어받는 원작 세계관을 읽기 전용으로 보이고 내 세계관으로 독립시킨다 ──

const FORK = { id: 'fork', worldStudioId: null, source: { workId: 'o', title: '원작', episode: 2, version: 1, direction: '' } }
const inheritedCard = (id: string, title: string, cardType: string) => ({ id, title, cardType, aliases: [] })
const INHERITED: InheritedWorld = {
  upto: 2, relationshipCount: 3,
  cards: [inheritedCard('c1', '카엘', 'character'), inheritedCard('p1', '성문', 'location'), inheritedCard('c2', '린', 'character')],
}
const DETACH = '내 세계관으로 만들어 수정하기'
/**
 * 이어받는 세계관 조회·내 세계관 목록 대역과 독립 요청 기록. 독립이 성공하면 새 세계관 관리 화면(/worldstudio/:id)으로 가는지는 그 주소의 라우트로 확인한다.
 * 독립 요청 중 잠금과 실패 문구는 작품 관리 화면(useEpisodeViewModel)이 busy·detachError로 내려 주므로 여기서는 그 값을 직접 준다.
 */
function showFork({ inherited = async () => INHERITED as InheritedWorld | null, work = FORK as Pick<Work, 'id' | 'worldStudioId' | 'source'>, busy = false, detach = async () => 'new-world' as string | null, detachError = '' } = {}) {
  const onDetach = vi.fn(detach)
  const useCase = { inheritedWorld: vi.fn(inherited) }
  const worlds = stubWorlds(async () => MINE)
  const view = render(
    <Provider store={createAppStore()}>
      <MemoryRouter initialEntries={['/content']}>
        <Routes>
          <Route path='/content' element={<LinkedWorldPanel work={work} busy={busy} onLink={vi.fn(async () => true)} onDetach={onDetach} detachError={detachError} useCase={useCase} worlds={worlds} />} />
          <Route path='/worldstudio/:id' element={<p>세계관 관리 화면</p>} />
        </Routes>
      </MemoryRouter>
    </Provider>,
  )
  return { onDetach, useCase, view, card: () => within(screen.getByRole('region', { name: '이어받는 원작 세계관' })) }
}

it('자기 세계관이 없는 Fork는 이어받는 원작 세계관을 N화 기준의 카드 유형별 수·제목과 관계 수로 읽기 전용으로 보인다', async () => {
  const { card, useCase } = showFork()
  await card().findByText('원작 「원작」 세계관을 2화 기준으로 이어받는 중')
  expect(card().getAllByRole('term').map((term) => term.textContent)).toEqual(['인물 2', '장소 1', '관계'])
  expect(card().getAllByRole('definition').map((definition) => definition.textContent)).toEqual(['카엘, 린', '성문', '3개'])
  expect(card().getByRole('button', { name: DETACH })).toBeTruthy()
  // 상한 회차는 서버가 Fork 기준 회차로 정하므로 upto를 보내지 않는다.
  expect(useCase.inheritedWorld).toHaveBeenCalledWith('fork', undefined, expect.any(AbortSignal))
  // 기존 '세계관 연결' 카드는 그대로 따로 있다.
  expect((await within(screen.getByRole('region', { name: '세계관 연결' })).findByRole('searchbox', { name: '세계관 검색' }))).toBeTruthy()
})

it('Fork가 아니거나 자기 세계관이 연결됐으면 이어받는 세계관을 묻지 않고, 이어받는 것이 없으면(null) 카드를 보이지 않는다', async () => {
  for (const work of [{ ...FORK, source: null }, { ...FORK, worldStudioId: 'mine' }]) {
    const { useCase, view } = showFork({ work })
    await act(async () => {})
    expect(useCase.inheritedWorld).not.toHaveBeenCalled()
    expect(screen.queryByRole('region', { name: '이어받는 원작 세계관' })).toBeNull()
    view.unmount()
  }
  const { useCase } = showFork({ inherited: async () => null })
  await waitFor(() => expect(screen.queryByRole('region', { name: '이어받는 원작 세계관' })).toBeNull())
  expect(useCase.inheritedWorld).toHaveBeenCalledTimes(1)
})

it('이어받은 세계관을 읽지 못하면 빈 상태로 바꾸지 않고 실패로 알리며 독립 버튼 없이 다시 불러온다', async () => {
  let fail = true
  const { card, useCase } = showFork({ inherited: async () => { if (fail) throw new Error('offline'); return INHERITED } })
  expect(card().getByRole('status').textContent).toBe('원작 세계관을 불러오고 있어요…')
  expect((await card().findByRole('alert')).textContent).toBe('원작 세계관을 불러오지 못했어요.')
  expect(card().queryByRole('button', { name: DETACH })).toBeNull()
  fail = false
  fireEvent.click(card().getByRole('button', { name: '원작 세계관 다시 불러오기' }))
  await card().findByText('원작 「원작」 세계관을 2화 기준으로 이어받는 중')
  expect(card().queryByRole('alert')).toBeNull()
  expect(useCase.inheritedWorld).toHaveBeenCalledTimes(2)
})

it('관계 상태를 모르면(null) 관계 0개로 채우지 않고 불러오지 못했다고 알리며, 관계가 정말 없으면 0개로 보인다', async () => {
  const relations = (view: ReturnType<typeof showFork>) => view.card().getAllByRole('definition').at(-1)?.textContent
  const unknown = showFork({ inherited: async () => ({ ...INHERITED, relationshipCount: null }) })
  await unknown.card().findByText('불러오지 못했어요')
  expect(relations(unknown)).toBe('불러오지 못했어요')
  unknown.view.unmount()
  const none = showFork({ inherited: async () => ({ ...INHERITED, relationshipCount: 0 }) })
  await none.card().findByText('0개')
  expect(relations(none)).toBe('0개')
})

it('내 세계관으로 만들어 수정하기를 누르면 독립을 한 번 요청하고 성공하면 새 세계관 관리 화면으로 간다', async () => {
  const { card, onDetach } = showFork()
  fireEvent.click(await card().findByRole('button', { name: DETACH }))
  expect(onDetach).toHaveBeenCalledTimes(1)
  expect(await screen.findByText('세계관 관리 화면')).toBeTruthy()
})

it('독립에 실패하면(null) 이동하지 않고 서버 문구를 이 카드 안에 보이며, 연결 카드에는 보이지 않는다', async () => {
  const { card, onDetach } = showFork({ detach: async () => null, detachError: '이어받는 원작 세계관이 없어요.' })
  fireEvent.click(await card().findByRole('button', { name: DETACH }))
  await waitFor(() => expect(onDetach).toHaveBeenCalledTimes(1))
  expect(card().getByRole('alert').textContent).toBe('이어받는 원작 세계관이 없어요.')
  expect(within(screen.getByRole('region', { name: '세계관 연결' })).queryByRole('alert')).toBeNull()
  expect(screen.queryByText('세계관 관리 화면')).toBeNull()
})

it('이어받은 카드가 없으면 독립할 것이 없어 버튼을 잠그고 이유를 알린다', async () => {
  const { card, onDetach } = showFork({ inherited: async () => ({ ...INHERITED, cards: [], relationshipCount: 0 }) })
  await card().findByText('이어받은 카드가 없어서 독립할 수 없어요.')
  const button = card().getByRole('button', { name: DETACH }) as HTMLButtonElement
  expect(button.disabled).toBe(true)
  expect(document.getElementById(button.getAttribute('aria-describedby') ?? '')?.textContent).toBe('이어받은 카드가 없어서 독립할 수 없어요.')
  expect(card().queryAllByRole('term')).toEqual([])
  fireEvent.click(button)
  expect(onDetach).not.toHaveBeenCalled()
})

it('다른 요청을 처리하는 중이면 독립 버튼을 누를 수 없다', async () => {
  const { card, onDetach } = showFork({ busy: true })
  const button = await card().findByRole('button', { name: DETACH }) as HTMLButtonElement
  expect(button.disabled).toBe(true)
  fireEvent.click(button)
  expect(onDetach).not.toHaveBeenCalled()
})
