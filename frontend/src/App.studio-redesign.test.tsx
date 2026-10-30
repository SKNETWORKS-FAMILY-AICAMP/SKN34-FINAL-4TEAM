// @vitest-environment jsdom
import { cleanup, fireEvent, screen, within } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { renderApp } from './test/renderApp'
import { createAppStore } from './app/store'

afterEach(cleanup)

describe('집필실 화면 구성', () => {
  it('집필 도구와 모든 화면의 AI 채팅을 표시한다', async () => {
    renderApp('/studio/starlight', createAppStore({ role: 'user' }))
    const nav = await screen.findByRole('navigation', { name: '집필 도구' })
    expect(within(nav).queryByRole('button', { name: '보드' })).toBeNull()
    expect(within(nav).queryByRole('button', { name: '개요' })).toBeNull()
    fireEvent.click(within(nav).getByRole('button', { name: '플롯' }))
    await screen.findByRole('heading', { name: '플롯' })
    fireEvent.click(screen.getByRole('button', { name: '매트릭스' }))
    expect(screen.getByRole('columnheader', { name: '등장 인물' })).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'AI 채팅 열기' }))
    expect(screen.getByText(/사전 조회와 세계관 시뮬레이션/)).toBeTruthy()
    fireEvent.click(within(nav).getByRole('button', { name: '사전' }))
    expect(await screen.findByLabelText('사전 검색')).toBeTruthy()
    expect(screen.getByRole('region', { name: 'AI 채팅' })).toBeTruthy()
    fireEvent.click(within(nav).getByRole('button', { name: '콘티' }))
    expect(await screen.findByRole('heading', { name: '콘티' })).toBeTruthy()
  })

  it('설정 팝업과 문장 AI 도구를 제공한다', async () => {
    renderApp('/studio/starlight', createAppStore({ role: 'user' }))
    await screen.findByLabelText('원고 본문')
    fireEvent.click(screen.getByRole('button', { name: '집필 설정' }))
    const dialog = screen.getByRole('dialog', { name: '집필 설정' })
    expect(within(dialog).getByText('작품 설정')).toBeTruthy()
    expect(within(dialog).getByRole('switch', { name: /AI 자율 연재/ })).toBeTruthy()
    fireEvent.click(within(dialog).getByRole('button', { name: '닫기' }))
    fireEvent.click(screen.getByRole('button', { name: '문장 AI 도구' }))
    fireEvent.click(screen.getByRole('button', { name: 'Scene Beat' }))
    expect(screen.getByLabelText('장면 지시문')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Text Replacement' }))
    expect(screen.getByLabelText('수정 요청')).toBeTruthy()
  })

  it('사전에서 작품 개요와 항목별 공개 설정을 보여준다', async () => {
    renderApp('/studio/starlight?view=wiki', createAppStore({ role: 'user' }))
    expect(await screen.findByLabelText('시놉시스')).toBeTruthy()
    fireEvent.click((await screen.findAllByRole('button', { name: '리안' }))[0])
    expect(await screen.findByLabelText('엔티티 공개 범위')).toBeTruthy()
    expect(screen.getAllByLabelText(/속성 공개 범위/).length).toBeGreaterThan(0)
    expect(screen.getByText(/포크한 독자는 비공개 설정을/)).toBeTruthy()
  })
})
