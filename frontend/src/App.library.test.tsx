// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { Provider } from 'react-redux'
import { MemoryRouter, useLocation } from 'react-router'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import App from './App'
import { createAppStore } from './app/store'

beforeEach(() => { vi.spyOn(window, 'confirm').mockReturnValue(true) })
afterEach(() => { cleanup(); vi.restoreAllMocks() })

const Where = () => { const l = useLocation(); return <p hidden data-testid="where">{l.pathname + l.search}</p> }
const where = () => screen.getByTestId('where').textContent
const sid = () => document.getElementById('sid')!.textContent
const toastIs = (t: string) => waitFor(() => expect(screen.getByRole('status').textContent).toBe(t))
const renderAt = (path: string) => render(<Provider store={createAppStore({ role: 'user' })}><MemoryRouter initialEntries={[path]}><App /><Where /></MemoryRouter></Provider>)
const acceptPolicy = async () => {
  fireEvent.click(await screen.findByLabelText(/운영 정책을 확인했고/))
  fireEvent.click(screen.getByRole('button', { name: '정책 확인 후 작품 설정하기' }))
  await screen.findByRole('heading', { name: '새 소설 쓰기' })
}

describe('내 서재 (U11·U12)', () => {
  it('읽는 중·내가 쓰는 소설·내 댓글·신고 탭을 오간다', async () => {
    renderAt('/lib')
    await screen.findByRole('button', { name: '▶ 2화 이어 읽기' })
    expect(sid()).toBe('U11 내 서재')
    screen.getByText('소설 화면에서 ♡를 누르면 여기에 모여요.')
    fireEvent.click(screen.getByRole('button', { name: '내 댓글·신고' }))
    await screen.findByText('작가가 처리하면 상태가 바뀌어요.')
    fireEvent.click(screen.getByRole('button', { name: '내가 쓰는 소설' }))
    await screen.findByRole('heading', { name: '별빛 서약의 탑' })
    expect(sid()).toBe('U12 내 서재 · 내가 쓰는 소설')
    expect(where()).toBe('/lib?tab=write')
    cleanup()
    renderAt('/write')
    await screen.findByRole('heading', { name: '별빛 서약의 탑' })
    expect(where()).toBe('/lib?tab=write')
  })
})

describe('새 소설 만들기 (U28)', () => {
  it('새 소설 쓰기를 누를 때마다 정책 확인을 다시 요구하고 /worlds는 /new로 보낸다', async () => {
    for (let visit = 0; visit < 2; visit++) {
      renderAt('/lib?tab=write')
      fireEvent.click(await screen.findByRole('button', { name: /＋ 새 소설 쓰기/ }))
      await screen.findByRole('heading', { name: '집필 전 정책 확인' })
      expect(sid()).toBe('U28 새 소설 만들기')
      await acceptPolicy()
      cleanup()
    }
    renderAt('/worlds')
    await waitFor(() => expect(where()).toBe('/new'))
  })

  it('세계관을 만들어도 작성 중인 정보가 남고, 실패는 Toast로 알린 뒤 집필실로 간다', async () => {
    renderAt('/new')
    await acceptPolicy()
    expect(within(screen.getByLabelText('장르')).getAllByRole('option')).toHaveLength(30)
    fireEvent.change(screen.getByLabelText('제목'), { target: { value: '작성 중인 작품' } })
    const create = document.getElementById('worldCreate')!
    fireEvent.change(within(create).getByLabelText('이름'), { target: { value: '새 세계' } })
    fireEvent.change(within(create).getByLabelText('세계관 규칙 (한 줄에 하나)'), { target: { value: '밤에는 문이 닫힌다' } })
    fireEvent.click(within(create).getByRole('button', { name: '비공개 세계관 만들기' }))
    await toastIs('비공개 세계관을 만들었어요 (데모)')
    expect((screen.getByLabelText('제목') as HTMLInputElement).value).toBe('작성 중인 작품')
    await waitFor(() => expect((screen.getByLabelText(/새 세계 · 내 비공개 세계관/) as HTMLInputElement).checked).toBe(true))

    fireEvent.click(screen.getByRole('button', { name: '소설 만들고 1화 쓰기 →' }))
    await toastIs('태그를 2개 이상 추가해 주세요')
    fireEvent.change(screen.getByLabelText('직접 입력'), { target: { value: '#회귀' } })
    fireEvent.click(screen.getByRole('button', { name: '직접 추가' }))
    fireEvent.change(screen.getByLabelText('직접 입력'), { target: { value: '회귀' } })
    fireEvent.click(screen.getByRole('button', { name: '직접 추가' }))
    await toastIs('이미 추가된 태그예요')
    fireEvent.click(screen.getByRole('button', { name: '선택 추가' }))
    await toastIs('추천 태그를 선택해 주세요')
    fireEvent.change(screen.getByLabelText('추천 태그'), { target: { value: '성장' } })
    fireEvent.click(screen.getByRole('button', { name: '선택 추가' }))
    screen.getByText('2개 선택 · 최소 2개')
    fireEvent.click(screen.getByRole('button', { name: '소설 만들고 1화 쓰기 →' }))
    await toastIs('인물을 1명 이상 적어 주세요')
    fireEvent.change(screen.getByPlaceholderText('이름 (필수)'), { target: { value: '등대지기' } })
    fireEvent.click(screen.getByRole('button', { name: '소설 만들고 1화 쓰기 →' }))
    await toastIs('소설을 만들었어요 · 나만 보기 상태예요')
    await waitFor(() => expect(where()).toMatch(/^\/studio\/mine/))
  })

  it('연결된 작품이 있는 세계관은 삭제할 수 없다', async () => {
    renderAt('/new')
    await acceptPolicy()
    fireEvent.click(screen.getByRole('button', { name: '세계관 삭제' }))
    await toastIs('연결된 작품이 있어 삭제할 수 없어요')
  })
})

describe('가져오기 (U24)', () => {
  it('정책 동의 → 예시 원고 정리 → 저장하면 내가 쓰는 소설로 간다', async () => {
    renderAt('/writing-policy?method=import')
    fireEvent.click(await screen.findByLabelText('이 집필 방식의 정책과 안내를 확인했습니다.'))
    fireEvent.click(screen.getByLabelText('저작권과 이용 권한 안내를 확인했고, 필요한 권리를 보유했거나 허락받았습니다.'))
    fireEvent.click(screen.getByRole('button', { name: '동의하고 계속' }))
    await screen.findByRole('heading', { name: '내 소설 가져오기' })
    expect(where()).toBe('/import')
    expect(sid()).toBe('U24 소설 가져오기')
    expect(screen.getByRole('button', { name: '정리 시작' }).hasAttribute('disabled')).toBe(true)
    fireEvent.click(screen.getByRole('button', { name: /예시 소설 선택/ }))
    screen.getByText('✓ 춘향전_전문.txt · 286KB')
    fireEvent.click(screen.getByRole('button', { name: '정리 시작' }))
    await toastIs('연결할 내 세계관을 선택해 주세요')
    fireEvent.change(screen.getByLabelText('연결할 내 세계관'), { target: { value: screen.getByRole('option', { name: '새 세계' }).getAttribute('value') } })
    fireEvent.click(screen.getByRole('button', { name: '정리 시작' }))
    await toastIs('AI로 처리할 권리에 체크해 주세요')
    fireEvent.click(screen.getByLabelText('이 소설을 AI로 처리할 권리가 있어요'))
    fireEvent.click(screen.getByRole('button', { name: '정리 시작' }))
    await waitFor(() => expect(window.confirm).toHaveBeenCalledWith('원고 설정 추출 · 예시 비용 10 크레딧 · 데모 잔액 100. 실제 요금은 미정이며 실제 차감은 없어요. 계속할까요?'))
    fireEvent.click(await screen.findByRole('button', { name: '확인하고 저장' }, { timeout: 4000 }))
    await toastIs('세계관·인물·사건을 저장했어요 (비공개 상태)')
    await waitFor(() => expect(where()).toBe('/lib?tab=write'))
    await screen.findByRole('heading', { name: '춘향전 (가져온 소설)' })
  })
})
