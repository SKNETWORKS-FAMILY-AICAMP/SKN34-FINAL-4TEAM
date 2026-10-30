// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { Provider } from 'react-redux'
import { MemoryRouter, useLocation } from 'react-router'
import { afterEach, describe, expect, it } from 'vitest'

import App from './App'
import { createAppStore } from './app/store'

afterEach(cleanup)

const Where = () => { const l = useLocation(); return <p hidden data-testid="where">{l.pathname + l.search}</p> }
const where = () => screen.getByTestId('where').textContent
const sid = () => document.getElementById('sid')!.textContent
const toastIs = (t: string) => waitFor(() => expect(screen.getByRole('status').textContent).toBe(t))

function renderAt(path: string) {
  render(<Provider store={createAppStore({ role: 'user' })}><MemoryRouter initialEntries={[path]}><App /><Where /></MemoryRouter></Provider>)
}
const agree = () => {
  fireEvent.click(screen.getByLabelText('이 집필 방식의 정책과 안내를 확인했습니다.'))
  fireEvent.click(screen.getByLabelText('저작권과 이용 권한 안내를 확인했고, 필요한 권리를 보유했거나 허락받았습니다.'))
  fireEvent.click(screen.getByRole('button', { name: '동의하고 계속' }))
}

describe('집필 방식·저작권 안내 (U43)', () => {
  it('정책 화면을 거치지 않고 열면 동의 후 원작 랭킹으로 간다', async () => {
    renderAt('/writing-policy?method=fork')
    await screen.findByRole('heading', { name: '다른 소설 포크 전 확인' })
    expect(sid()).toBe('U43 집필 방식·저작권 안내')
    screen.getByText(/원작이 허용한 공개 회차에서만/)
    fireEvent.submit(document.getElementById('writingPolicyForm')!)
    await toastIs('정책과 저작권 안내에 모두 동의해 주세요')
    agree()
    await waitFor(() => expect(where()).toBe('/rank?t=orig'))
  })

  it('가져오기는 별도 안내 후 가져오기 화면으로, 모르는 방식은 내가 쓰는 소설로 보낸다', async () => {
    renderAt('/writing-policy?method=import')
    await screen.findByRole('heading', { name: '내 소설 가져오기 전 확인' })
    screen.getByText(/가져온 원고는 집필을 돕기 위해/)
    agree()
    await waitFor(() => expect(where()).toBe('/import'))
    cleanup()
    renderAt('/writing-policy?method=x')
    await waitFor(() => expect(where()).toBe('/lib?tab=write'))
  })
})

describe('포크 (U09·U10)', () => {
  it('상세의 포크하기 → 정책 동의 → 회차 선택 → 스냅샷 완료, 같은 원작은 다시 포크할 수 없다', async () => {
    renderAt('/work/guunmong')
    fireEvent.click(await screen.findByRole('button', { name: '✎ 포크하기' }))
    await screen.findByRole('heading', { name: '다른 소설 포크 전 확인' })
    agree()
    await screen.findByRole('heading', { name: '「구운몽」 포크' })
    expect(where()).toBe('/fork/guunmong')
    expect(sid()).toBe('U09 포크 (3단계 폼)')
    expect(screen.getByRole('button', { name: /1화 끝에서/ }).hasAttribute('disabled')).toBe(true)
    expect(document.getElementById('atl')!.textContent).toBe('2')
    fireEvent.click(screen.getByRole('button', { name: /4화 끝에서/ }))
    expect(document.getElementById('atl')!.textContent).toBe('4')
    expect(document.getElementById('rulecount')!.textContent).toBe('3')
    fireEvent.click(screen.getByRole('button', { name: /3화 끝에서/ }))
    expect(document.getElementById('rulecount')!.textContent).toBe('2')
    expect(screen.queryByLabelText(/회차별 설정 이력이 없어/)).toBeNull()
    fireEvent.change(screen.getByPlaceholderText('한 줄로 적어 주세요'), { target: { value: ' ' } })
    fireEvent.click(screen.getByRole('button', { name: '포크 소설 시작하기 →' }))
    await toastIs('무엇이 달라지는지 한 줄 적어 주세요')
    fireEvent.change(screen.getByPlaceholderText('한 줄로 적어 주세요'), { target: { value: '성진이 털어놓았다면?' } })
    fireEvent.click(screen.getByRole('button', { name: '포크 소설 시작하기 →' }))
    await screen.findByRole('heading', { name: '포크 소설을 만들었어요' })
    await toastIs('원작 3화 시점을 복사해 포크 소설을 만들었어요')
    expect(sid()).toBe('U10 포크 생성 완료 · 스냅샷')
    expect(where()).toMatch(/^\/forked\/fork/)
    screen.getByText('「구운몽: 연화봉에 남은 성진」 · 원작 「구운몽」 3화 끝에서 포크')
    expect(document.querySelector('.snap')!.textContent).toContain('복사한 회차3화')
    screen.getByRole('button', { name: '집필실로 가기 →' })
    cleanup()

    renderAt('/fork/guunmong')
    await screen.findByRole('heading', { name: '이미 포크한 원작이에요' })
    screen.getByRole('button', { name: '내 포크 계속 쓰기' })
  })

  it('회차 끝 포크 버튼은 그 회차를 고른 폼으로 이어진다', async () => {
    renderAt('/read/postman/2')
    fireEvent.click(await screen.findByRole('button', { name: '✎ 2화에서 포크하기' }))
    agree()
    await screen.findByRole('heading', { name: '「회색 도시의 우편배달부」 포크' })
    expect(document.getElementById('atl')!.textContent).toBe('2')
    fireEvent.change(screen.getByPlaceholderText('한 줄로 적어 주세요'), { target: { value: '다른 편지' } })
    fireEvent.click(screen.getByRole('button', { name: '포크 소설 시작하기 →' }))
    await toastIs('설정 이력 안내를 확인해 주세요')
  })

  it('포크를 허용하지 않은 홍길동전은 상세 화면을 보여 준다', async () => {
    renderAt('/fork/hong')
    await screen.findByRole('heading', { name: '포크를 허용하지 않은 소설' })
    expect(screen.queryByRole('button', { name: '포크 소설 시작하기 →' })).toBeNull()
  })

  it('로그인하지 않으면 포크 화면 대신 로그인으로 보낸다', async () => {
    render(<Provider store={createAppStore()}><MemoryRouter initialEntries={['/fork/guunmong']}><App /><Where /></MemoryRouter></Provider>)
    await waitFor(() => expect(where()).toBe('/login'))
  })
})
