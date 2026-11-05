// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { Provider } from 'react-redux'
import { MemoryRouter, useLocation } from 'react-router'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import App from './App'
import { createAppStore } from './app/store'

beforeEach(() => {
  vi.spyOn(window, 'confirm').mockReturnValue(true)
  URL.createObjectURL = vi.fn(() => 'blob:x')
  URL.revokeObjectURL = vi.fn()
})
afterEach(() => { cleanup(); vi.restoreAllMocks() })

const Where = () => { const l = useLocation(); return <p hidden data-testid="where">{l.pathname + l.search}</p> }
const where = () => screen.getByTestId('where').textContent
const sid = () => document.getElementById('sid')!.textContent
const toastIs = (t: string) => waitFor(() => expect(document.getElementById('toast')!.textContent).toBe(t))
const renderAt = (path: string) => render(<Provider store={createAppStore({ role: 'user' })}><MemoryRouter initialEntries={[path]}><App /><Where /></MemoryRouter></Provider>)
const body = () => screen.getByLabelText('원고 본문')

describe('집필실 (U13·U14·U16·U17·U22)', () => {
  it('남의 소설은 쓸 수 없고 포크를 권한다', async () => {
    renderAt('/studio/guunmong')
    await screen.findByRole('heading', { name: '내 소설만 쓸 수 있어요' })
    screen.getByRole('button', { name: '✎ 포크하기' })
  })

  it('발행 회차는 수정 초안으로 열리고 수정 공개 전에는 원본이 그대로다', async () => {
    renderAt('/studio/starlight')
    fireEvent.click(await screen.findByRole('button', { name: /^1화 .* 원고$/ }))
    await waitFor(() => expect(where()).toBe('/studio/starlight?ep=1'))
    await screen.findByText(/공개 원고를 복사한 수정 초안이에요/)
    const title = (screen.getByLabelText('회차 제목') as HTMLInputElement).value
    body().innerHTML = '<p>수정 초안</p>'
    fireEvent.input(body())
    fireEvent.click(screen.getByRole('button', { name: '수정 공개하기' }))
    const sheet = await screen.findByRole('dialog', { name: '1화 수정 공개하기' })
    expect(sid()).toContain('U22')
    fireEvent.click(within(sheet).getByRole('button', { name: '수정 공개하기' }))
    await toastIs('1화 수정안을 발행했어요 (데모)')
    cleanup()
    renderAt('/read/starlight/1')
    await screen.findAllByText('수정 초안')
    expect(title).not.toBe('')
  })

  it('TXT·EPUB·이미지 안내와 회차 공개 중단·새 회차 공개', async () => {
    renderAt('/studio/starlight')
    await screen.findByLabelText('원고 본문')
    body().innerHTML = '<p>새로운 원고입니다.</p>'
    fireEvent.input(body())
    fireEvent.click(screen.getByRole('button', { name: '이 회차 txt' }))
    await waitFor(() => expect(URL.createObjectURL).toHaveBeenCalled())
    fireEvent.click(screen.getByRole('button', { name: 'EPUB(.epub) 내보내기' }))
    await toastIs('EPUB는 회차·메타데이터·이미지를 포함해야 해요. 이 데모에서는 TXT 내보내기만 지원합니다.')
    screen.getByText(/이미지는 이 화면에서 임시 삽입만 할 수 있으며/)
    fireEvent.click(screen.getAllByRole('button', { name: '회차 공개 중단' })[0])
    await toastIs('이 회차의 공개를 중단했어요 (데모)')
    await screen.findByRole('button', { name: '회차 다시 공개' })
    fireEvent.click(screen.getByRole('button', { name: '공개하기' }))
    const sheet = await screen.findByRole('dialog', { name: /화 공개하기$/ })
    fireEvent.click(within(sheet).getByRole('button', { name: '공개하기' }))
    await waitFor(() => expect(where()).toBe('/work/starlight'))
  })
})
