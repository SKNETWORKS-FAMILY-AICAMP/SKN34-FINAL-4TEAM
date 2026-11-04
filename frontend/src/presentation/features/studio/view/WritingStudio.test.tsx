// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import type { ReactNode } from 'react'
import { WritingStudio } from './WritingStudio'

const model = vi.hoisted(() => ({
  active: { number: 1, draft: { title: '첫 회차', body: '원고', revision: 1 }, versions: [{ id: 'v1', title: '저장본', body: '저장 원고', savedAt: '2026-11-04T00:00:00Z' }], inherited: false, hasDraft: true },
  episodes: [], draft: { title: '첫 회차', body: '원고', revision: 1 },
  busy: false, error: '', notice: '', ready: true, dirty: false, editingLocked: false,
  save: vi.fn(), reload: vi.fn(), publish: vi.fn().mockResolvedValue(true), restore: vi.fn(),
}))
vi.mock('../viewmodel/useWritingViewModel', () => ({ useWritingViewModel: () => model }))
vi.mock('../../../shared/screenIds', () => ({ useScreenId: () => {} }))
vi.mock('../../../shared/media/MediaPanel', () => ({ ManuscriptBody: ({ body }: { body: string }) => <p>{body}</p> }))
vi.mock('./SettingHistoryPanel', () => ({ SettingHistoryPanel: ({ workId }: { workId: string }) => <section aria-label="연결된 설정 이력">{workId}</section> }))
// 이 테스트는 공개 동작 연결만 검사한다. 실제 Sheet의 포커스·키보드는 별도 검증 대상이다.
vi.mock('../../../shared/Sheet', () => ({ Sheet: ({ children }: { children: ReactNode }) => <div role="dialog">{children}</div> }))
afterEach(() => { cleanup(); vi.clearAllMocks() })

it('팀 서재로 돌아가며 공개 시트에서 버전 선택과 권리 확인 후 기존 API 동작을 사용한다', async () => {
  render(<WritingStudio id="work-id" />)
  expect(screen.getByRole('link', { name: '내가 쓰는 소설' }).getAttribute('href')).toBe('/lib?tab=write')
  expect(screen.queryByRole('dialog')).toBeNull()
  fireEvent.click(screen.getByRole('button', { name: '저장 버전 · 공개' }))
  fireEvent.change(screen.getByLabelText('검토할 저장 버전'), { target: { value: 'v1' } })
  const publish = screen.getByRole('button', { name: '선택한 저장 버전 공개' }) as HTMLButtonElement
  expect(publish.disabled).toBe(true)
  fireEvent.click(screen.getByRole('checkbox'))
  expect(publish.disabled).toBe(false)
  await act(async () => { fireEvent.click(publish) })
  expect(model.publish).toHaveBeenCalledWith('v1', true)
})

it('집필실에서 같은 작품의 설정 이력을 열고 단일 시트 안에서 원고 비교로 이동한다', () => {
  render(<WritingStudio id="work-id" />)
  fireEvent.click(screen.getByRole('button', { name: '설정 버전 이력' }))
  expect(screen.getByRole('region', { name: '연결된 설정 이력' }).textContent).toBe('work-id')
  expect(screen.getAllByRole('dialog')).toHaveLength(1)
  fireEvent.click(screen.getByRole('button', { name: '원고 버전 비교' }))
  expect(screen.getByText('비교하려면 이 회차의 저장 버전이 두 개 이상 필요해요.')).toBeTruthy()
  expect(model.save).not.toHaveBeenCalled()
  expect(model.publish).not.toHaveBeenCalled()
})
