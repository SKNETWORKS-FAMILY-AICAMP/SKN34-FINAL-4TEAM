// @vitest-environment jsdom
import { act, cleanup, renderHook, waitFor } from '@testing-library/react'
import type { ReactNode } from 'react'
import { Provider } from 'react-redux'
import { MemoryRouter } from 'react-router'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { createAppStore } from '../../../../app/store'
import type { AdminTab } from '../../../../domain/entities/admin'
import { createFixtureContainer } from '../../../../test/fixtureContainer'
import { useAdminViewModel } from './useAdminViewModel'

// React/Hook 통합 회귀: CI 전용이며 로컬 선택 단위 범위에 포함하지 않습니다.
afterEach(cleanup)
function setup(tab: AdminTab = 'notices') {
  const container = createFixtureContainer()
  const admin = container.resolve('adminUseCase')
  const operations = container.resolve('operationsUseCase')
  const notices = container.resolve('noticeUseCase'), support = container.resolve('supportInquiryUseCase')
  const store = createAppStore({ role: 'admin' })
  const wrapper = ({ children }: { children: ReactNode }) => <Provider store={store}><MemoryRouter>{children}</MemoryRouter></Provider>
  const members = container.resolve('memberUseCase'), reports = container.resolve('reportUseCase')
  return { admin, operations, notices, support, store, mount: () => renderHook(({ tab }) => useAdminViewModel(tab, admin, operations, members, reports, notices, support), { wrapper, initialProps: { tab } }) }
}

describe('관리자 비동기 상태와 입력 보존', () => {
  it('초기 실패와 로딩을 구분하고 명시적인 다시 시도로 복구한다', async () => {
    const f = setup()
    const load = vi.spyOn(f.admin, 'load').mockRejectedValueOnce(new Error('내부 비밀 오류'))
    const { result } = f.mount()
    expect(result.current.isLoading).toBe(true)
    await waitFor(() => expect(result.current.isError).toBe(true))
    expect(result.current.data).toBeUndefined()
    act(() => result.current.retry())
    await waitFor(() => expect(result.current.data?.admin).toBeTruthy())
    expect(result.current.isError).toBe(false)
    expect(load).toHaveBeenCalledTimes(2)
  })

  it('같은 조치를 같은 tick에서 두 번 호출해도 한 번만 실행하고 실패를 false로 돌려준다', async () => {
    const f = setup()
    const { result } = f.mount()
    await waitFor(() => expect(result.current.data).toBeTruthy())
    let reject!: (error: Error) => void
    const save = vi.spyOn(f.notices, 'save').mockImplementation(() => new Promise((_, no) => { reject = no }))
    let pending!: Promise<boolean>
    await act(async () => {
      pending = result.current.saveNotice(null, { title: '제목', body: '본문' })
      expect(await result.current.saveNotice(null, { title: '제목', body: '본문' })).toBe(false)
    })
    expect(save).toHaveBeenCalledTimes(1)
    expect(result.current.actions['notice:new'].pending).toBe(true)
    await act(async () => { reject(new Error('노출하면 안 되는 내부 응답')); expect(await pending).toBe(false) })
    expect(result.current.actions['notice:new']).toMatchObject({ pending: false, error: expect.stringContaining('입력은 유지') })
    expect(f.store.getState().session.dataVersion).toBe(0)
  })

  it('저장 성공 뒤 재조회만 실패하면 성공 결과를 뒤집지 않고 이전 목록과 stale 오류를 남긴다', async () => {
    const f = setup()
    const { result } = f.mount()
    await waitFor(() => expect(result.current.data && result.current.live.data).toBeTruthy())
    const before = result.current.live.data
    vi.spyOn(f.notices, 'list').mockRejectedValueOnce(new Error('새로고침 실패'))
    await act(async () => { expect(await result.current.saveNotice(null, { title: '저장된 공지', body: '본문' })).toBe(true) })
    await waitFor(() => expect(result.current.live.isError).toBe(true))
    expect(result.current.live.data).toBe(before)
    expect(result.current.actions['notice:new'].message).toContain('저장')
    expect(result.current.lastSuccess).toContain('저장')
    expect(await f.notices.list()).toHaveLength(1)
    act(() => result.current.live.retry())
    await waitFor(() => expect(result.current.live.data?.notices).toHaveLength(1))
  })

  it('답변 등록 실패는 내부 예외 내용을 노출하지 않고 처리 중 표시를 풀며 다시 읽지 않는다', async () => {
    const f = setup('feedback')
    const { result } = f.mount()
    await waitFor(() => expect(result.current.data).toBeTruthy())
    vi.spyOn(f.support, 'addReply').mockRejectedValueOnce(new Error('비공개 내부 응답'))
    await act(async () => { expect(await result.current.live.addReply('q1', '보낼 답변')).toBe(false) })
    expect(result.current.actions['inquiry:q1:reply'].pending).toBe(false)
    expect(result.current.actions['inquiry:q1:reply'].error).not.toContain('비공개 내부 응답')
    expect(f.store.getState().session.dataVersion).toBe(0)
  })

  it('탭을 옮기면 이전 탭의 조치 결과 문구를 지우고 같은 탭에서는 유지한다', async () => {
    const f = setup()
    const hook = f.mount()
    await waitFor(() => expect(hook.result.current.data && hook.result.current.live.data).toBeTruthy())
    await act(async () => { expect(await hook.result.current.saveNotice(null, { title: '저장한 공지', body: '본문' })).toBe(true) })
    expect(hook.result.current.lastSuccess).toContain('저장')
    expect(hook.result.current.actions['notice:new'].message).toContain('저장')
    hook.rerender({ tab: 'notices' })
    expect(hook.result.current.lastSuccess).toContain('저장')

    hook.rerender({ tab: 'profile' })
    expect(hook.result.current.lastSuccess).toBe('')
    expect(hook.result.current.actions).toEqual({})
  })

  it('고객지원 문의의 선택은 탭과 화면 재진입 후에도 Redux에 유지된다', async () => {
    const f = setup('feedback')
    const hook = f.mount()
    await waitFor(() => expect(hook.result.current.data).toBeTruthy())
    act(() => { hook.result.current.selectRecord('inquiries', 'q1') })
    hook.rerender({ tab: 'notices' })
    hook.unmount()
    const again = f.mount()
    expect(again.result.current.recordSelection.inquiries).toBe('q1')
  })

  it('제보·문의 탭은 상태 필터를 서버 조회 조건으로, 선택한 문의는 상세로 읽는다', async () => {
    const f = setup('feedback')
    const listAll = vi.spyOn(f.support, 'listAll')
    const get = vi.spyOn(f.support, 'get')
    const { result } = f.mount()
    await waitFor(() => expect(listAll).toHaveBeenCalledWith(null))
    act(() => { result.current.setFilter('feedback', { category: 'WAITING', sort: 'title', query: '', search: '' }) })
    await waitFor(() => expect(listAll).toHaveBeenLastCalledWith('WAITING'))
    act(() => { result.current.selectRecord('inquiries', 'q1') })
    await waitFor(() => expect(get).toHaveBeenCalledWith('q1'))
  })

  it('개요 탭은 답변 대기 문의만 서버에서 읽고 조회 실패를 빈 목록으로 숨기지 않는다', async () => {
    const f = setup('data')
    const listAll = vi.spyOn(f.support, 'listAll').mockRejectedValueOnce(new Error('조회 실패'))
    const { result } = f.mount()
    await waitFor(() => expect(result.current.live.inquiries.isError).toBe(true))
    expect(result.current.live.inquiries.data).toBeUndefined()
    expect(listAll).toHaveBeenCalledWith('WAITING')
  })

  it('공지 저장 중 이탈·재진입해 같은 폼을 새로 쓰면 오래된 성공은 새 초안과 선택을 보존한다', async () => {
    const f = setup()
    const hook = f.mount()
    await waitFor(() => expect(hook.result.current.data).toBeTruthy())
    const submitted = { title: '제출한 공지', body: '원래 본문' }
    const replacement = { title: '재진입 후 새 공지', body: '잃으면 안 되는 새 본문' }
    act(() => { hook.result.current.selectRecord('notices', 'new'); hook.result.current.setNoticeDraft('new', submitted) })
    let finish!: (row: Awaited<ReturnType<typeof f.notices.save>>) => void
    vi.spyOn(f.notices, 'save').mockImplementationOnce(() => new Promise((done) => { finish = done }))
    let pending!: Promise<boolean>
    act(() => { pending = hook.result.current.saveNotice(null, submitted) })
    hook.unmount()
    const again = f.mount()
    await waitFor(() => expect(again.result.current.data).toBeTruthy())
    act(() => again.result.current.setNoticeDraft('new', replacement))
    await act(async () => {
      finish({ ...submitted, id: 'saved-notice', createdAt: '2026-11-05T00:00:00Z', updatedAt: '2026-11-05T00:00:00Z' })
      expect(await pending).toBe(true)
    })
    expect(again.result.current.noticeDrafts.new).toEqual(replacement)
    expect(again.result.current.recordSelection.notices).toBe('new')
    expect(again.result.current.lastSuccess).toBe('')
    expect(f.store.getState().session.dataVersion).toBe(1)
  })

  it('같은 mount에서도 완료 직전 Redux의 초안·선택 변경을 동기적으로 존중한다', async () => {
    const f = setup()
    const { result } = f.mount()
    await waitFor(() => expect(result.current.data).toBeTruthy())
    const submitted = { title: '제출한 공지', body: '원래 본문' }
    act(() => { result.current.selectRecord('notices', 'new'); result.current.setNoticeDraft('new', submitted) })
    let finish!: (row: Awaited<ReturnType<typeof f.notices.save>>) => void
    vi.spyOn(f.notices, 'save').mockImplementationOnce(() => new Promise((done) => { finish = done }))
    const vm = result.current
    let pending!: Promise<boolean>
    act(() => { pending = vm.saveNotice(null, submitted) })
    await act(async () => {
      vm.setNoticeDraft('new', { ...submitted, body: '제출 뒤 새 본문' })
      vm.selectRecord('notices', 'other')
      finish({ ...submitted, id: 'saved-notice', createdAt: '2026-11-05T00:00:00Z', updatedAt: '2026-11-05T00:00:00Z' })
      expect(await pending).toBe(true)
    })
    expect(result.current.noticeDrafts.new.body).toBe('제출 뒤 새 본문')
    expect(result.current.recordSelection.notices).toBe('other')
    expect(f.store.getState().session.dataVersion).toBe(1)
  })

  it('오래된 조회 응답은 새 데이터와 오류 상태를 덮지 않는다', async () => {
    const f = setup()
    const current = await f.admin.load()
    let resolve!: (data: typeof current) => void
    const load = vi.spyOn(f.admin, 'load').mockImplementationOnce(() => new Promise((done) => { resolve = done }))
    const { result, unmount } = f.mount()
    await waitFor(() => expect(load).toHaveBeenCalledTimes(1))
    unmount()
    await act(async () => { resolve(current) })
    expect(result.current.data).toBeUndefined()
  })
})
