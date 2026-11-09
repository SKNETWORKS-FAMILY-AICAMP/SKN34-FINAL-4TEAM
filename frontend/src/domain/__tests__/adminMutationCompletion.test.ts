import { beforeEach, describe, expect, it, vi } from 'vitest'

import { OperationsError } from '../entities/operations'
import { adminViewSlice } from '../../presentation/features/admin/state/adminViewSlice'
import { useAdminViewModel } from '../../presentation/features/admin/viewmodel/useAdminViewModel'
import type { RootState } from '../../app/store'

// 렌더러·React·외부 의존성은 대역으로 격리하고 실제 mutation callback과 Redux reducer만 실행합니다.
// 실제 Hook mount/unmount 통합 회귀는 useAdminViewModel.test.tsx에서 CI 전용으로 유지합니다.
const doubles = vi.hoisted(() => ({
  cleanups: [] as (() => void)[], dispatch: vi.fn(), getState: vi.fn(),
  admin: { chatChoices: vi.fn(), addNotice: vi.fn(), addEvent: vi.fn() },
  operations: { saveNotice: vi.fn(), deleteNotice: vi.fn(), saveEvent: vi.fn(), deleteEvent: vi.fn() },
  support: { listAll: vi.fn(), get: vi.fn(), addReply: vi.fn(), updateReply: vi.fn(), deleteReply: vi.fn() },
}))
vi.mock('react', () => ({
  useRef: <T>(current: T) => ({ current }),
  useState: (initial: unknown) => [initial, vi.fn()],
  useEffect: (setup: () => (() => void)) => { doubles.cleanups.push(setup()) },
}))
vi.mock('react-redux', () => ({ useStore: () => ({ getState: doubles.getState }) }))
vi.mock('../../app/appContainer', () => ({ appContainer: { resolve: (name: string) => name === 'adminUseCase' ? doubles.admin : name === 'supportInquiryUseCase' ? doubles.support : doubles.operations } }))
vi.mock('../../app/store', () => ({ useAppDispatch: () => doubles.dispatch, useAppSelector: (select: (state: RootState) => unknown) => select(doubles.getState()) }))
vi.mock('../../presentation/shared/session/useLogout', () => ({ useLogout: () => vi.fn() }))
vi.mock('../../presentation/shared/screenIds', () => ({ useScreenId: vi.fn() }))
vi.mock('../../presentation/shared/events', () => ({ toast: vi.fn() }))
vi.mock('../../presentation/shared/useAsyncData', () => ({ useAsyncData: () => ({ isLoading: false, isRefreshing: false, isError: false }) }))

type VM = ReturnType<typeof useAdminViewModel>
let view: ReturnType<typeof adminViewSlice.reducer>
let dataVersion: number
beforeEach(() => {
  vi.clearAllMocks()
  doubles.cleanups.length = 0
  view = adminViewSlice.reducer(undefined, { type: 'init' })
  dataVersion = 0
  doubles.getState.mockImplementation(() => ({ adminView: view, session: { memberId: null, user: { nick: '관리자', email: '', joined: '' } } }))
  doubles.dispatch.mockImplementation((action: { type: string }) => {
    view = adminViewSlice.reducer(view, action)
    if (action.type === 'session/dataChanged') dataVersion++
  })
})

const notice = { title: '제출한 제목', body: '제출한 본문' }
const event = { ...notice, startsAt: '', endsAt: '' }
const cases: { name: string; prepare: (vm: VM, changed?: boolean) => void; submit: (vm: VM) => Promise<boolean>; method: keyof typeof doubles.operations | keyof typeof doubles.admin; other?: (vm: VM) => void }[] = [
  ...(['new', 'existing'] as const).flatMap((id) => [
    { name: `notice save ${id}`, method: 'saveNotice' as const, prepare: (vm: VM, changed = false) => { vm.selectRecord('notices', id); vm.setNoticeDraft(id, { ...notice, body: changed ? '새 본문' : notice.body }) }, submit: (vm: VM) => vm.saveNotice(id === 'new' ? null : id, notice), other: (vm: VM) => vm.selectRecord('notices', 'other') },
    { name: `event save ${id}`, method: 'saveEvent' as const, prepare: (vm: VM, changed = false) => { vm.selectRecord('events', id); vm.setEventDraft(id, { ...event, body: changed ? '새 본문' : event.body }) }, submit: (vm: VM) => vm.saveEvent(id === 'new' ? null : id, event), other: (vm: VM) => vm.selectRecord('events', 'other') },
  ]),
  { name: 'notice delete', method: 'deleteNotice', prepare: (vm, changed = false) => { vm.selectRecord('notices', 'existing'); vm.setNoticeDraft('existing', { ...notice, body: changed ? '새 본문' : notice.body }) }, submit: (vm) => vm.deleteNotice('existing'), other: (vm) => vm.selectRecord('notices', 'other') },
  { name: 'event delete', method: 'deleteEvent', prepare: (vm, changed = false) => { vm.selectRecord('events', 'existing'); vm.setEventDraft('existing', { ...event, body: changed ? '새 본문' : event.body }) }, submit: (vm) => vm.deleteEvent('existing'), other: (vm) => vm.selectRecord('events', 'other') },
  { name: 'legacy notice', method: 'addNotice', prepare: (vm, changed = false) => { vm.setLegacyDraft('notice', 'title', notice.title); vm.setLegacyDraft('notice', 'body', changed ? '새 본문' : notice.body) }, submit: async (vm) => { const ok = await vm.addNotice(notice.title, notice.body); if (ok) vm.clearLegacyDraft('notice'); return ok } },
  { name: 'legacy event', method: 'addEvent', prepare: (vm, changed = false) => { vm.setLegacyDraft('event', 'title', notice.title); vm.setLegacyDraft('event', 'body', changed ? '새 본문' : notice.body) }, submit: async (vm) => { const ok = await vm.addEvent(notice.title, '', notice.body); if (ok) vm.clearLegacyDraft('event'); return ok } },
]

function useStartedSubmission(test: typeof cases[number]) {
  let finish!: (result: { id: string; ok: boolean; msg: string }) => void
  const response = new Promise<{ id: string; ok: boolean; msg: string }>((done) => { finish = done })
  const method = test.method in doubles.operations ? doubles.operations[test.method as keyof typeof doubles.operations] : doubles.admin[test.method as keyof typeof doubles.admin]
  method.mockReturnValueOnce(response)
  let vm = useAdminViewModel('notices')
  test.prepare(vm)
  // 실제 View가 제출한 렌더의 vm을 보존하듯, 최신 선택/초안을 읽은 callback을 보존합니다.
  vm = useAdminViewModel('notices')
  const pending = test.submit(vm)
  return { vm, pending, finish: () => finish({ id: 'saved', ok: true, msg: '저장 성공' }) }
}

describe.each(cases)('$name 지연 완료의 초안 소유권', (test) => {
  it('이탈·재진입한 같은 폼의 새 초안과 선택은 보존하되 성공과 dataChanged는 유지한다', async () => {
    const request = useStartedSubmission(test)
    doubles.cleanups.splice(0).forEach((cleanup) => cleanup())
    test.prepare(useAdminViewModel('notices'), true)
    const expected = view
    request.finish()
    expect(await request.pending).toBe(true)
    expect(view).toEqual(expected)
    expect(dataVersion).toBe(1)
  })

  it('같은 mount에서 제출 뒤 바뀐 초안을 지우지 않는다', async () => {
    const request = useStartedSubmission(test)
    test.prepare(request.vm, true)
    const expected = view
    request.finish()
    expect(await request.pending).toBe(true)
    expect(view).toEqual(expected)
    expect(dataVersion).toBe(1)
  })

  if (['saveNotice', 'saveEvent'].includes(test.method)) it('제출 뒤 동일 내용으로 다시 만든 새 초안도 오래된 완료가 지우지 않는다', async () => {
    const request = useStartedSubmission(test)
    test.prepare(request.vm)
    const expected = view
    request.finish()
    expect(await request.pending).toBe(true)
    expect(view).toEqual(expected)
    expect(dataVersion).toBe(1)
  })

  if (test.other) it('제출 뒤 다른 레코드를 선택했으면 기존 초안과 새 선택을 건드리지 않는다', async () => {
    const request = useStartedSubmission(test)
    test.other?.(request.vm)
    const expected = view
    request.finish()
    expect(await request.pending).toBe(true)
    expect(view).toEqual(expected)
    expect(dataVersion).toBe(1)
  })

  it('같은 mount·초안·선택의 성공은 기존대로 초안을 정리한다', async () => {
    const request = useStartedSubmission(test)
    request.finish()
    expect(await request.pending).toBe(true)
    expect(view.noticeDrafts).toEqual({})
    expect(view.eventDrafts).toEqual({})
    expect(view.legacyDrafts).toEqual({})
    expect(dataVersion).toBe(1)
  })
})

describe('고객지원 문의 답변 동작 (67)', () => {
  it('답변 등록·수정·삭제는 서버 호출이 끝난 뒤 true를 돌려주고 dataChanged로 목록·상세를 다시 읽게 한다', async () => {
    const vm = useAdminViewModel('feedback')
    expect(await vm.live.addReply('q1', ' 답변\n')).toBe(true)
    expect(await vm.live.updateReply('q1', 'p1', '수정')).toBe(true)
    expect(await vm.live.deleteReply('q1', 'p1')).toBe(true)
    expect(doubles.support.addReply).toHaveBeenCalledWith('q1', ' 답변\n')
    expect(doubles.support.updateReply).toHaveBeenCalledWith('q1', 'p1', '수정')
    expect(doubles.support.deleteReply).toHaveBeenCalledWith('q1', 'p1')
    expect(dataVersion).toBe(3)
  })

  it('실패는 성공으로 바꾸지 않고 false를 돌려주며 다시 읽기도 요청하지 않는다', async () => {
    doubles.support.addReply.mockRejectedValueOnce(new OperationsError('이 작업을 할 권한이 없어요.'))
    doubles.support.updateReply.mockRejectedValueOnce(new Error('비공개 내부 응답'))
    const vm = useAdminViewModel('feedback')
    expect(await vm.live.addReply('q1', '답변')).toBe(false)
    expect(await vm.live.updateReply('q1', 'p1', '수정')).toBe(false)
    expect(dataVersion).toBe(0)
  })

  it('같은 문의에 대한 답변 등록 요청이 진행 중이면 중복 요청을 보내지 않는다', async () => {
    let finish!: () => void
    doubles.support.addReply.mockReturnValueOnce(new Promise<void>((done) => { finish = done }))
    const vm = useAdminViewModel('feedback')
    const first = vm.live.addReply('q1', '답변')
    expect(await vm.live.addReply('q1', '답변')).toBe(false)
    expect(doubles.support.addReply).toHaveBeenCalledTimes(1)
    finish()
    expect(await first).toBe(true)
  })

  it('같은 답변의 수정과 삭제는 서로 기다린다', async () => {
    let finish!: () => void
    doubles.support.updateReply.mockReturnValueOnce(new Promise<void>((done) => { finish = done }))
    const vm = useAdminViewModel('feedback')
    const update = vm.live.updateReply('q1', 'p1', '수정')
    expect(await vm.live.deleteReply('q1', 'p1')).toBe(false)
    expect(doubles.support.deleteReply).not.toHaveBeenCalled()
    finish()
    expect(await update).toBe(true)
  })
})
