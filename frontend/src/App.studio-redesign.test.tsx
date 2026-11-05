// @vitest-environment jsdom
import { cleanup, fireEvent, screen, within } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { waitFor } from '@testing-library/react'
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
    expect(screen.queryByRole('button', { name: '개요' })).toBeNull()
    expect(await screen.findByRole('navigation', { name: '플롯 목록' })).toBeTruthy()
    await waitFor(() => expect(screen.getByRole('button', { name: '플롯 추가' })).toHaveProperty('disabled', false))
    fireEvent.click(screen.getByRole('button', { name: 'AI 채팅 열기' }))
    expect(screen.getByText(/사전 조회와 세계관 시뮬레이션/)).toBeTruthy()
    fireEvent.click(within(nav).getByRole('button', { name: '사전' }))
    expect(await screen.findByLabelText('사전 검색')).toBeTruthy()
    expect(screen.queryByRole('button', { name: /사건 기본 분류/ })).toBeNull()
    fireEvent.change(screen.getByLabelText('사전 검색'), { target: { value: '재의 사절 도착' } })
    fireEvent.submit(screen.getByRole('search'))
    expect(await screen.findByText('찾는 문서가 없어요.')).toBeTruthy()
    expect(screen.getByRole('region', { name: 'AI 채팅' })).toBeTruthy()
    expect(screen.queryByRole('button', { name: /인물에게 맡겨 보기|장면 이어쓰기|설정 검사/ })).toBeNull()
    fireEvent.click(within(nav).getByRole('button', { name: '콘티' }))
    expect(await screen.findByRole('heading', { name: '콘티' })).toBeTruthy()
    expect(screen.queryByText(/Snippets|아이디어|조각/)).toBeNull()
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
    expect(screen.queryByRole('button', { name: 'Scene Beat' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Text Replacement' })).toBeNull()
    expect(screen.getByLabelText('문장 또는 장면 요청')).toBeTruthy()
  })

  it('플롯을 생성하고 편집 시트에서 저장한다', async () => {
    renderApp('/studio/starlight?view=narrative', createAppStore({ role: 'user' }))
    await waitFor(() => expect(screen.getByRole('button', { name: '플롯 추가' })).toHaveProperty('disabled', false))
    fireEvent.click(screen.getByRole('button', { name: '플롯 추가' }))
    fireEvent.change(screen.getByLabelText('플롯 제목'), { target: { value: '검증할 플롯' } })
    fireEvent.click(screen.getByRole('button', { name: '저장' }))
    await screen.findByRole('heading', { name: '검증할 플롯' })
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    fireEvent.click(screen.getByRole('button', { name: '플롯 수정' }))
    const dialog = await screen.findByRole('dialog', { name: '플롯 수정' })
    expect(within(dialog).getByLabelText('플롯 제목')).toHaveProperty('value', '검증할 플롯')
    fireEvent.click(within(dialog).getByRole('button', { name: '취소' }))
  })

  it('장면 계획에서 기존 인물·장소를 참조하며 사전 수정은 제공하지 않는다', async () => {
    renderApp('/studio/starlight?view=narrative', createAppStore({ role: 'user' }))
    await waitFor(() => expect(screen.getByRole('button', { name: '플롯 추가' })).toHaveProperty('disabled', false))
    fireEvent.click(screen.getByRole('button', { name: '플롯 추가' }))
    fireEvent.change(screen.getByLabelText('플롯 제목'), { target: { value: '참조 검증 플롯' } })
    fireEvent.click(screen.getByRole('button', { name: '저장' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    fireEvent.click(screen.getByRole('button', { name: '장면 계획 추가' }))
    expect(screen.getByLabelText('리안')).toBeTruthy()
    expect(screen.getByLabelText('별빛 탑')).toBeTruthy()
    expect(screen.getByRole('heading', { name: '플롯' })).toBeTruthy()
    expect(screen.queryByRole('button', { name: '새 문서' })).toBeNull()
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
