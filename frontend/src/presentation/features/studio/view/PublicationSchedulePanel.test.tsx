// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'

import type { WritingEpisode } from '../../../../domain/entities/content'
import { PublicationSchedulePanel } from './PublicationSchedulePanel'

const vm = vi.hoisted(() => ({
  rows: [] as unknown[] | null, pending: undefined as unknown, busy: false, error: '', notice: '',
  form: { versionId: '', time: '2026-12-01T10:00', rights: true },
  edit: vi.fn(), reload: vi.fn(), save: vi.fn(), cancel: vi.fn(),
}))
vi.mock('../viewmodel/usePublicationScheduleViewModel', () => ({ usePublicationScheduleViewModel: () => vm }))
afterEach(() => { cleanup(); vi.clearAllMocks(); vm.pending = undefined; vm.form = { versionId: '', time: '2026-12-01T10:00', rights: true } })

const version = (id: string, length: number) => ({ id, episode: 1, title: id, body: '가'.repeat(length), revision: 1, savedAt: '2026-11-04T00:00:00Z' })
const episode = { number: 1, versions: [version('short', 4999), version('exact', 5000)] } as unknown as WritingEpisode
const submit = () => screen.getByRole('button', { name: '발행 예약' })

// 공개 분량 규칙(UC-10 U13): 예약 발행도 공개 경로이므로 선택한 저장 버전 본문이 5,000자 미만이면 예약할 수 없다.
it('예약할 저장 버전 본문이 5,000자 미만이면 발행 예약을 잠그고 사유를 연결한다', () => {
  vm.form = { ...vm.form, versionId: 'short' }
  render(<PublicationSchedulePanel workId="work" episode={episode} />)
  expect(submit()).toHaveProperty('disabled', true)
  expect(document.getElementById(submit().getAttribute('aria-describedby') ?? '')?.textContent).toBe('공개하려면 본문이 5,000자 이상이어야 해요. 지금은 4,999자예요.')
  fireEvent.click(submit())
  expect(vm.save).not.toHaveBeenCalled()
})

it('5,000자 이상인 저장 버전은 사유 없이 예약할 수 있고, 아직 고르지 않았을 때는 사유 대신 기존 조건을 따른다', () => {
  vm.form = { ...vm.form, versionId: 'exact' }
  const view = render(<PublicationSchedulePanel workId="work" episode={episode} />)
  expect(submit()).toHaveProperty('disabled', false)
  expect(submit().hasAttribute('aria-describedby')).toBe(false)
  fireEvent.click(submit())
  expect(vm.save).toHaveBeenCalledOnce()
  vm.form = { ...vm.form, versionId: '' }
  view.rerender(<PublicationSchedulePanel workId="work" episode={episode} />)
  expect(submit()).toHaveProperty('disabled', true)
  expect(submit().hasAttribute('aria-describedby')).toBe(false)
})

it('기존 예약의 버전이 짧아도 예약 취소는 막지 않는다', () => {
  vm.pending = { id: 'p1', status: 'pending', versionId: 'short', scheduledAt: '2026-12-01T01:00:00Z' }
  vm.form = { ...vm.form, versionId: 'short' }
  render(<PublicationSchedulePanel workId="work" episode={episode} />)
  expect(screen.getByRole('button', { name: '예약 변경' })).toHaveProperty('disabled', true)
  expect(screen.getByRole('button', { name: '예약 취소' })).toHaveProperty('disabled', false)
})

// AI 자율 집필 중에는 서버가 2화부터 예약 등록·변경을 막는다(계약 'AI 자율 집필 = 집필 방식'): 잠그고 이유를 알리며, 예약 취소는 막지 않는다.
it('잠긴 회차(AI 자율 집필 중 2화부터)는 5,000자 이상 저장 버전도 발행 예약·변경을 잠그고 이유를 알리지만 예약 취소는 막지 않는다', () => {
  const NOTICE = 'AI 자율 집필 중에는 1화만 직접 쓸 수 있어요. 운영 설정 > 집필 방식을 바꾸면 모든 회차를 쓸 수 있어요.'
  vm.form = { ...vm.form, versionId: 'exact' }
  const view = render(<PublicationSchedulePanel workId="work" episode={episode} />)
  expect(screen.queryByText(NOTICE)).toBeNull()
  expect(submit()).toHaveProperty('disabled', false)
  vm.pending = { id: 'p1', status: 'pending', versionId: 'exact', scheduledAt: '2026-12-01T01:00:00Z' }
  view.rerender(<PublicationSchedulePanel workId="work" episode={episode} locked />)
  expect(screen.getByText(NOTICE)).toBeTruthy()
  expect(screen.getByRole('button', { name: '예약 변경' })).toHaveProperty('disabled', true)
  expect(screen.getByRole('button', { name: '예약 취소' })).toHaveProperty('disabled', false)
})
