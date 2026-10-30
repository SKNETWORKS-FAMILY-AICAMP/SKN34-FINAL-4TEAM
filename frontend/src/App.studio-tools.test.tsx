// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { Provider } from 'react-redux'
import { MemoryRouter, useLocation } from 'react-router'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import App from './App'
import { appContainer } from './app/appContainer'
import { createAppStore } from './app/store'

beforeEach(() => { vi.spyOn(window, 'confirm').mockReturnValue(true) })
afterEach(() => { cleanup(); vi.restoreAllMocks() })

const Where = () => { const l = useLocation(); return <p hidden data-testid="where">{l.pathname + l.search}</p> }
const where = () => screen.getByTestId('where').textContent
const sid = () => document.getElementById('sid')!.textContent
const toastIs = (t: string | RegExp) => waitFor(() => expect(document.getElementById('toast')!.textContent).toMatch(t))
const renderAt = (path: string) => render(<Provider store={createAppStore({ role: 'user' })}><MemoryRouter initialEntries={[path]}><App /><Where /></MemoryRouter></Provider>)
const tools = () => screen.getByRole('navigation', { name: '집필 도구' })

describe('집필실 도구 (U15·U18·U21·U23·U37~U41·자율 연재)', () => {
  it('보기를 바꾸고 메모는 다시 열어도 남아 있다', async () => {
    renderAt('/studio/starlight')
    await screen.findByLabelText('원고 본문')
    for (const [label, id] of [['사전', 'U38'], ['플롯', 'U40'], ['콘티', 'U41']] as const) {
      fireEvent.click(within(tools()).getByRole('button', { name: label }))
      await waitFor(() => expect(sid()).toContain(id))
    }
    expect(where()).toBe('/studio/starlight?view=memo')
    fireEvent.change(screen.getByLabelText('콘티 내용'), { target: { value: '아이디어 메모' } })
    fireEvent.click(within(tools()).getByRole('button', { name: '원고' }))
    await screen.findByLabelText('원고 본문')
    fireEvent.click(within(tools()).getByRole('button', { name: '콘티' }))
    await waitFor(() => expect((screen.getByLabelText('콘티 내용') as HTMLTextAreaElement).value).toBe('아이디어 메모'))
  })

  it('사전은 인물 문서를 열고 서술 순서를 바꾼다', async () => {
    renderAt('/studio/starlight?view=wiki')
    fireEvent.click((await screen.findAllByRole('button', { name: '리안' }))[0])
    await screen.findByRole('heading', { name: '리안' })

  })

  it('데모 크레딧이 5 미만이면 자율 연재를 중단한다', async () => {
    const credits = appContainer.resolve('creditRepository')
    await credits.save({ ...(await credits.get()), credits: 3 })
    renderAt('/studio/starlight')
    await screen.findByLabelText('원고 본문')
    fireEvent.click(screen.getByRole('button', { name: '집필 설정' }))
    fireEvent.click(screen.getByRole('switch', { name: 'AI 자율 연재 켜기' }))
    await toastIs('AI 자율 연재를 켰어요 (데모 · 실제 예약 없음)')
    screen.getByText(/하루 최대 1회 · KST 기준/)
    fireEvent.click(await screen.findByRole('button', { name: /지금 한 회차 생성해 보기/ }))
    await toastIs('데모 크레딧이 부족해 자율 연재를 중단했어요')
    await screen.findByText('상태: 중단됨')
    await credits.save({ ...(await credits.get()), credits: 100 })
  })

  it('중단된 자율 연재를 다시 시작해 새 회차를 공개하며, 작가 확인을 켜면 초안만 만든다', async () => {
    renderAt('/studio/starlight')
    fireEvent.click(await screen.findByRole('button', { name: '집필 설정' }))
    fireEvent.click(await screen.findByRole('button', { name: '다시 시작' }))
    await screen.findByText('상태: 실행 중')
    fireEvent.click(screen.getByRole('button', { name: /지금 한 회차 생성해 보기/ }))
    await toastIs(/^AI가 \d+화를 쓰고 공개했어요 \(데모\)$/)
    fireEvent.click(await screen.findByLabelText(/발행 전에 작가 확인 받기/))
    await waitFor(() => expect(screen.getByLabelText<HTMLInputElement>(/발행 전에 작가 확인 받기/).checked).toBe(true))
    fireEvent.click(screen.getByRole('button', { name: /지금 한 회차 생성해 보기/ }))
    await toastIs('데모 예시 초안을 만들었어요. 검토한 뒤 일반 발행 흐름에서 공개해 주세요.')
    await screen.findByText(/AI 자율 연재가 쓴 초안이에요/)
    fireEvent.click(screen.getByRole('button', { name: /지금 한 회차 생성해 보기/ }))
    await toastIs('작성 중인 초안이 있어 자동 발행을 건너뛰었어요')
  })

  it('공개 설정에서 회차별 포크 허용을 저장한다', async () => {
    renderAt('/studio/starlight?publish=1')
    const sheet = await screen.findByRole('dialog', { name: /^공개 설정 · / })
    expect(sid()).toContain('U21')
    within(sheet).getByText(/P2 · 미확정 정책/)
    fireEvent.click(within(sheet).getByRole('button', { name: '회차별 선택' }))
    fireEvent.click(within(sheet).getByRole('button', { name: '모두 해제' }))
    fireEvent.click(within(sheet).getByRole('button', { name: '저장' }))
    await toastIs('포크를 허용할 회차를 하나 이상 골라 주세요')
    fireEvent.click(within(sheet).getByRole('checkbox', { name: /^1화/ }))
    fireEvent.click(within(sheet).getByRole('button', { name: '저장' }))
    await toastIs('공개 설정을 저장했어요 · 1화 포크 허용')
  })

})
