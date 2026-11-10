// @vitest-environment jsdom
// CI integration: 작품 화면의 관심 등록/해제(기능 21-B)와 서재 '관심 소설' 반영. 좋아요(♥)와는 별개 흐름이다.
import '../../../../test/fixtureApp'

import { cleanup, fireEvent, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { appContainer } from '../../../../app/appContainer'
import { createAppStore } from '../../../../app/store'
import { renderApp } from '../../../../test/renderApp'

const interests = () => appContainer.resolve('workInterestRepository')

// 컨테이너는 파일 안에서 공유되므로 관심 목록과 이 파일이 바꾼 목업 DB를 테스트마다 되돌린다.
afterEach(async () => {
  cleanup(); vi.restoreAllMocks()
  for (const id of await interests().list()) await interests().remove(id)
  const db = appContainer.resolve('mockDb')
  db.progress.liked = {}
  db.works.forEach((w) => { w.private = false })
})

const button = async (name: string) => {
  const found = await screen.findByRole('button', { name })
  await waitFor(() => expect((found as HTMLButtonElement).disabled).toBe(false))
  return found
}

describe('작품 화면 관심 등록/해제', () => {
  it('로그인 회원은 관심 작품에 담고 뺀다', async () => {
    renderApp('/work/guunmong', createAppStore({ role: 'user' }))
    fireEvent.click(await button('관심 등록'))
    await screen.findByRole('button', { name: '관심 해제' })
    expect(await interests().list()).toEqual(['guunmong'])
    expect(screen.getByRole('status').textContent).toBe('관심 소설에 담았어요')

    fireEvent.click(await button('관심 해제'))
    await screen.findByRole('button', { name: '관심 등록' })
    expect(await interests().list()).toEqual([])
    expect(screen.getByRole('status').textContent).toBe('관심 소설에서 뺐어요')
  })

  it('이미 담은 작품은 처음부터 관심 해제로 보인다', async () => {
    await interests().add('guunmong')
    renderApp('/work/guunmong', createAppStore({ role: 'user' }))
    await button('관심 해제')
  })

  it('좋아요(♥) 버튼은 관심 등록과 별개라 관심 목록을 바꾸지 않고 좋아요 문구로 알린다', async () => {
    renderApp('/work/guunmong', createAppStore({ role: 'user' }))
    await button('관심 등록')
    const heart = () => screen.getByRole('button', { name: '관심 소설' })
    fireEvent.click(heart())
    await waitFor(() => expect(heart().getAttribute('aria-pressed')).toBe('true'))
    expect(screen.getByRole('status').textContent).toBe('이 창에서만 좋아요를 눌렀어요 · 계정에 저장되지 않아요')
    expect(await interests().list()).toEqual([])
    fireEvent.click(heart())
    await waitFor(() => expect(heart().getAttribute('aria-pressed')).toBe('false'))
    expect(screen.getByRole('status').textContent).toBe('좋아요를 취소했어요')
    screen.getByRole('button', { name: '관심 등록' })
  })

  it('비회원은 등록하지 않고 로그인 안내로 보낸다', async () => {
    const store = createAppStore()
    renderApp('/work/guunmong', store)
    fireEvent.click(await screen.findByRole('link', { name: '관심 등록' }))
    await screen.findByText('관심 소설은 로그인한 뒤 담을 수 있어요.')
    expect(store.getState().session).toMatchObject({ next: '/work/guunmong', loginMsg: '관심 소설은 로그인한 뒤 담을 수 있어요.' })
    expect(await interests().list()).toEqual([])
  })

  it('서버가 거절하면 이유를 알리고 버튼 상태를 바꾸지 않는다', async () => {
    vi.spyOn(interests(), 'add').mockRejectedValueOnce(new Error('공개 작품을 찾을 수 없어요.'))
    renderApp('/work/guunmong', createAppStore({ role: 'user' }))
    fireEvent.click(await button('관심 등록'))
    await waitFor(() => expect(screen.getByRole('status').textContent).toBe('공개 작품을 찾을 수 없어요.'))
    screen.getByRole('button', { name: '관심 등록' })
    expect(await interests().list()).toEqual([])
  })

  it('공개가 아닌 작품에는 관심 버튼을 보이지 않는다', async () => {
    appContainer.resolve('mockDb').works.find((w) => w.id === 'starlight')!.private = true
    renderApp('/work/starlight', createAppStore({ role: 'user' }))
    await screen.findByRole('heading', { name: '별빛 서약의 탑', level: 1 })
    expect(screen.queryByRole('button', { name: '관심 등록' })).toBeNull()
    expect(screen.queryByRole('button', { name: '관심 해제' })).toBeNull()
  })
})

describe('서재 관심 소설', () => {
  it('관심 등록한 작품만 보이고 좋아요만 누른 작품은 보이지 않는다', async () => {
    appContainer.resolve('mockDb').progress.liked = { starlight: true }
    await interests().add('hong')
    await interests().add('postman')
    renderApp('/lib', createAppStore({ role: 'user' }))
    await screen.findByRole('link', { name: '▶ 2화 이어 읽기' })
    await waitFor(() => expect([...document.querySelectorAll('.grid6 .hk')].map((el) => el.textContent)).toEqual(['회색 도시의 우편배달부', '홍길동전']))
    expect(screen.queryByText(/소설 화면에서 .*누르면 여기에 모여요/)).toBeNull()
  })

  it('관심 등록이 없으면 관심 등록을 안내한다', async () => {
    renderApp('/lib', createAppStore({ role: 'user' }))
    await screen.findByText("소설 화면에서 '관심 등록'을 누르면 여기에 모여요.")
  })
})
