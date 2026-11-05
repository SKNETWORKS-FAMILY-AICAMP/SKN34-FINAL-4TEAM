// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import type { SavedSetting } from '../../../domain/entities/content'
import { SettingVersionHistory } from './SettingVersionHistory'

afterEach(cleanup)
const first: SavedSetting = { id: 's', versionId: 'v1', name: '마법', content: '이전 규칙', category: '규칙', tags: [], visibility: 'private', fromEpisode: 1, toEpisode: null, knownBy: [], evidence: '' }
const second = { ...first, versionId: 'v2', content: '현재 규칙' }
it('설정별 이력을 고르고 확인 후 기존 복원 handler에 정확한 ID를 전달한다', () => {
  const restore = vi.fn()
  render(<SettingVersionHistory history={[first, second, { ...first, id: 'other', versionId: 'v3', name: '다른 설정' }]} current={[second]} onRestore={restore} />)
  fireEvent.change(screen.getByLabelText('설정 항목'), { target: { value: 's' } })
  fireEvent.change(screen.getByLabelText('설정 버전'), { target: { value: 'v1' } })
  expect(screen.getByText('이전 규칙')).toBeTruthy()
  expect(screen.getByRole('heading', { level: 3, name: '이력 1 · 마법' })).toBeTruthy()
  fireEvent.click(screen.getByRole('button', { name: '이 설정을 새 버전으로 복원' }))
  expect(screen.getByText('「마법」의 이력 1로 복원할까요?')).toBeTruthy()
  expect(restore).not.toHaveBeenCalled()
  expect(document.activeElement).toBe(screen.getByRole('button', { name: '새 버전으로 복원 확인' }))
  fireEvent.click(screen.getByRole('button', { name: '새 버전으로 복원 확인' }))
  expect(restore).toHaveBeenCalledWith('s', 'v1')
})
it('초안 충돌 상태에서는 복원을 막고 이유를 표시한다', () => {
  render(<SettingVersionHistory history={[first]} current={[first]} disabledReason="작성 중인 설정 초안을 먼저 확정해 주세요." onRestore={vi.fn()} />)
  fireEvent.change(screen.getByLabelText('설정 항목'), { target: { value: 's' } })
  fireEvent.change(screen.getByLabelText('설정 버전'), { target: { value: 'v1' } })
  expect(screen.getByRole('button', { name: '이 설정을 새 버전으로 복원' })).toHaveProperty('disabled', true)
  expect(screen.getByText('작성 중인 설정 초안을 먼저 확정해 주세요.')).toBeTruthy()
})

it('같은 이름의 이력을 전환하면 상세 번호가 바뀌고 현재 설정 표시를 유지한다', () => {
  render(<SettingVersionHistory history={[first, second]} current={[second]} onRestore={vi.fn()} />)
  fireEvent.change(screen.getByLabelText('설정 항목'), { target: { value: 's' } })
  fireEvent.change(screen.getByLabelText('설정 버전'), { target: { value: 'v1' } })
  expect(screen.getByRole('heading', { level: 3, name: '이력 1 · 마법' })).toBeTruthy()
  expect(screen.getByText('이전 규칙')).toBeTruthy()

  fireEvent.change(screen.getByLabelText('설정 버전'), { target: { value: 'v2' } })
  expect(screen.getByRole('heading', { level: 3, name: '이력 2 · 마법' })).toBeTruthy()
  expect(screen.getByText('현재 규칙')).toBeTruthy()
  expect(screen.queryByText('이전 규칙')).toBeNull()
  expect(screen.getByRole('option', { name: '이력 1 · 마법' })).toBeTruthy()
  expect(screen.getByRole('option', { name: '이력 2 · 마법 · 현재 설정' })).toBeTruthy()
  expect(screen.getByText('규칙 · 비공개 · 1화부터 · 현재 설정')).toBeTruthy()
})

it('설정별로 번호를 매기고 설정 변경 시 선택과 복원 확인을 초기화한다', () => {
  const other: SavedSetting = { ...first, id: 'other', versionId: 'v3', name: '다른 설정' }
  render(<SettingVersionHistory history={[first, other, second]} current={[second, other]} onRestore={vi.fn()} />)
  fireEvent.change(screen.getByLabelText('설정 항목'), { target: { value: 's' } })
  fireEvent.change(screen.getByLabelText('설정 버전'), { target: { value: 'v2' } })
  expect(screen.getByRole('heading', { level: 3, name: '이력 2 · 마법' })).toBeTruthy()
  fireEvent.click(screen.getByRole('button', { name: '이 설정을 새 버전으로 복원' }))
  fireEvent.change(screen.getByLabelText('설정 항목'), { target: { value: 'other' } })
  expect(screen.getByLabelText('설정 버전')).toHaveProperty('value', '')
  expect(screen.queryByRole('heading', { level: 3 })).toBeNull()
  expect(screen.queryByRole('group', { name: '설정 복원 확인' })).toBeNull()

  fireEvent.change(screen.getByLabelText('설정 버전'), { target: { value: 'v3' } })
  expect(screen.getByRole('heading', { level: 3, name: '이력 1 · 다른 설정' })).toBeTruthy()
})
