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

  it('AI 제안은 버리면 원고가 그대로이고 승인해야 들어간다', async () => {
    renderAt('/studio/starlight')
    await screen.findByLabelText('AI에게 요청')
    expect(sid()).toBe('U14 집필실 · AI 도움')
    expect(document.querySelector('.ai-context')!.textContent).toContain('현재 회차')
    fireEvent.change(screen.getByLabelText('AI에게 요청'), { target: { value: '장면의 긴장감을 높여 이어 써 주세요.' } })
    fireEvent.click(screen.getByRole('button', { name: /장면 이어쓰기/ }))
    const prev = await screen.findByRole('region', { name: 'AI 제안 미리보기' })
    expect(prev.textContent).toContain('장면의 긴장감을 높여 이어 써 주세요.')
    expect(sid()).toBe('U16 AI 소설 제안')
    expect(body().textContent).toBe('')
    fireEvent.click(within(prev).getByRole('button', { name: '버리기' }))
    await toastIs('제안을 버렸어요')
    expect(body().textContent).toBe('')
    fireEvent.click(screen.getByRole('button', { name: /장면 이어쓰기/ }))
    fireEvent.click(await screen.findByRole('button', { name: '원고에 넣기' }))
    await toastIs('소설에 넣었어요 · 설정 검사를 해 보세요')
    await waitFor(() => expect(body().textContent).toContain('리안은 한동안 말없이 창밖을 바라보았다.'))
  })

  it('설정 검사·TXT·EPUB·이미지 안내와 회차 공개 중단·새 회차 공개', async () => {
    renderAt('/studio/starlight')
    await screen.findByLabelText('원고 본문')
    body().innerHTML = '<p>해가 진 뒤 탑의 문이 열렸다.</p>'
    fireEvent.input(body())
    fireEvent.click(screen.getByRole('button', { name: /설정 검사/ }))
    await toastIs('1곳이 설정과 어긋나요')
    expect(sid()).toBe('U17 설정 검사 · 수정')
    fireEvent.click(screen.getByRole('button', { name: '제안대로 고치기' }))
    await toastIs('문장을 고쳤어요 · 다시 검사했어요')
    await waitFor(() => expect(body().textContent).toBe('해가 진 뒤라 문은 열리지 않았다.'))
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
