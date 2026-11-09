// @vitest-environment jsdom
import '../../../../test/fixtureApp'

import { cleanup, fireEvent, screen, waitFor } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'

import { appContainer } from '../../../../app/appContainer'
import { createAppStore } from '../../../../app/store'
import { SessionExpired } from '../../../../domain/repositories/ProfileRepository'
import { renderApp } from '../../../../test/renderApp'

afterEach(() => { cleanup(); document.title = 'STORYFORK'; vi.restoreAllMocks() })

const expectOneMain = () => {
  const mains = document.querySelectorAll('main')
  expect(mains).toHaveLength(1)
  expect(mains[0].id).toBe('main')
  expect(mains[0].getAttribute('tabindex')).toBe('-1')
  return mains[0]
}

it('소설 상세는 id가 main인 랜드마크 하나와 h1 하나를 갖고 탭 제목은 작품 제목이다', async () => {
  renderApp('/work/postman', createAppStore({ role: 'user' }))
  const title = await screen.findByRole('heading', { name: '회색 도시의 우편배달부', level: 1 })
  expect(expectOneMain().contains(title)).toBe(true)
  expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1)
  await waitFor(() => expect(document.title).toBe('회색 도시의 우편배달부 · STORYFORK'))
})

it('볼 수 없는 소설 안내도 main 하나와 h1 하나이며 탭 제목은 일반 화면 이름이다', async () => {
  renderApp('/work/nope')
  await screen.findByRole('heading', { name: '소설을 찾을 수 없거나 볼 수 없어요.', level: 1 })
  expectOneMain()
  expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1)
  await waitFor(() => expect(document.title).toBe('소설 상세 · STORYFORK'))
})

/** 시드 작품을 서버(정본) 작품으로 표시하고 좋아요 저장소를 대역으로 바꾼다. 서버가 없는 CI에서 화면 조립만 확인한다(HTTP 계약은 data 단위 테스트). */
function serverWorks() {
  const works = appContainer.resolve('mockDb').works
  for (const work of works) { work.canonical = true; work.statisticsSupported = false }
  const likes = appContainer.resolve('workLikeRepository')
  const read = vi.spyOn(likes, 'read'), like = vi.spyOn(likes, 'like'), unlike = vi.spyOn(likes, 'unlike')
  return { read, like, unlike, restore: () => { for (const work of works) { delete work.canonical; delete work.statisticsSupported } } }
}
const heart = () => screen.findByRole('button', { name: '좋아요' })
const count = () => document.getElementById('lkc')!.textContent

it('서버 작품 상세는 서버가 알려 준 좋아요 수와 내 좋아요 상태를 보여 주고 자리표시 조회·댓글 지표는 그리지 않는다', async () => {
  const server = serverWorks()
  server.read.mockResolvedValue({ likes: 12, liked: true })
  try {
    renderApp('/work/guunmong', createAppStore({ role: 'user' }))
    expect((await heart()).getAttribute('aria-pressed')).toBe('true')
    expect(count()).toBe('12')
    expect(server.read).toHaveBeenCalledWith('guunmong')
    expect(document.querySelector('.stats')!.textContent).not.toMatch(/👁|💬/)
  } finally { server.restore() }
})

it('좋아요를 누르면 서버에 보내고 서버가 확정한 새 수와 상태로 바뀌며 다시 누르면 취소한다', async () => {
  const server = serverWorks()
  server.read.mockResolvedValueOnce({ likes: 3, liked: false }).mockResolvedValue({ likes: 4, liked: true })
  server.like.mockResolvedValue({ likes: 4, liked: true })
  server.unlike.mockResolvedValue({ likes: 3, liked: false })
  try {
    renderApp('/work/guunmong', createAppStore({ role: 'user' }))
    expect((await heart()).getAttribute('aria-pressed')).toBe('false')
    expect(count()).toBe('3')
    fireEvent.click(await heart())
    await screen.findByText('좋아요를 눌렀어요')
    await waitFor(() => expect(count()).toBe('4'))
    expect(server.like).toHaveBeenCalledWith('guunmong')
    expect((await heart()).getAttribute('aria-pressed')).toBe('true')
    server.read.mockResolvedValue({ likes: 3, liked: false })
    fireEvent.click(await heart())
    await screen.findByText('좋아요를 취소했어요')
    await waitFor(() => expect(count()).toBe('3'))
    expect(server.unlike).toHaveBeenCalledWith('guunmong')
    expect((await heart()).getAttribute('aria-pressed')).toBe('false')
  } finally { server.restore() }
})

it('좋아요 실패는 성공으로 숨기지 않고 서버 안내를 보이며 수와 상태를 그대로 둔다', async () => {
  const server = serverWorks()
  server.read.mockResolvedValue({ likes: 3, liked: false })
  server.like.mockRejectedValue(new Error('공개 작품을 찾을 수 없어요.'))
  try {
    renderApp('/work/guunmong', createAppStore({ role: 'user' }))
    fireEvent.click(await heart())
    await screen.findByText('공개 작품을 찾을 수 없어요.')
    expect(count()).toBe('3')
    expect((await heart()).getAttribute('aria-pressed')).toBe('false')
    expect(screen.queryByText('좋아요를 눌렀어요')).toBeNull()
    expect(server.read).toHaveBeenCalledTimes(1)
  } finally { server.restore() }
})

it('로그인이 만료됐으면 만료를 알리고 로그아웃해 다시 로그인하게 한다', async () => {
  const server = serverWorks()
  server.read.mockResolvedValue({ likes: 3, liked: false })
  server.like.mockRejectedValue(new SessionExpired())
  try {
    const { store } = renderApp('/work/guunmong', createAppStore({ role: 'user' }))
    fireEvent.click(await heart())
    await screen.findByText('세션이 만료됐어요. 다시 로그인해 주세요.')
    expect(store.getState().session.role).toBeNull()
  } finally { server.restore() }
})

it('비로그인이 서버 작품의 좋아요를 누르면 서버를 부르지 않고 로그인 안내로 보낸다', async () => {
  const server = serverWorks()
  try {
    const { store } = renderApp('/work/guunmong')
    fireEvent.click(await heart())
    await screen.findByRole('heading', { name: '로그인', level: 1 })
    screen.getByText('좋아요는 로그인한 회원만 누를 수 있어요.')
    expect(store.getState().session.next).toBe('/work/guunmong')
    expect(server.like).not.toHaveBeenCalled()
    expect(server.read).not.toHaveBeenCalled()
  } finally { server.restore() }
})
