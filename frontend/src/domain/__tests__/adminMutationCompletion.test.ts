import { beforeEach, describe, expect, it, vi } from 'vitest'

import { adminViewSlice } from '../../presentation/features/admin/state/adminViewSlice'
import type { AdminTab } from '../entities/admin'
import { useAdminViewModel } from '../../presentation/features/admin/viewmodel/useAdminViewModel'
import type { RootState } from '../../app/store'

// 렌더러·React·외부 의존성은 대역으로 격리하고 실제 mutation callback과 Redux reducer만 실행합니다.
// 실제 Hook mount/unmount 통합 회귀는 useAdminViewModel.test.tsx에서 CI 전용으로 유지합니다.
const doubles = vi.hoisted(() => ({
  cleanups: [] as (() => void)[], dispatch: vi.fn(), getState: vi.fn(),
  admin: { chatChoices: vi.fn() },
  operations: { saveNotice: vi.fn(), deleteNotice: vi.fn(), saveEvent: vi.fn(), deleteEvent: vi.fn(), saveInquiry: vi.fn(), deleteInquiry: vi.fn(), saveReply: vi.fn(), deleteReply: vi.fn() },
  member: { setRestriction: vi.fn(), createAdmin: vi.fn() },
  report: { review: vi.fn(), setContentRestriction: vi.fn(), requestEvidence: vi.fn() },
  /** 데모 조회(adminUseCase를 deps로 가진 useAsyncData)의 상태. 운영 API 조회(live·report)는 항상 완료로 둔다. */
  demoQuery: { isLoading: false, isRefreshing: false, isError: false } as { isLoading: boolean; isRefreshing: boolean; isError: boolean; data?: unknown },
}))
vi.mock('react', () => ({
  useRef: <T>(current: T) => ({ current }),
  useState: (initial: unknown) => [initial, vi.fn()],
  useEffect: (setup: () => (() => void)) => { doubles.cleanups.push(setup()) },
}))
vi.mock('react-redux', () => ({ useStore: () => ({ getState: doubles.getState }) }))
vi.mock('../../app/appContainer', () => ({ appContainer: { resolve: (name: string) => ({ adminUseCase: doubles.admin, memberUseCase: doubles.member, reportUseCase: doubles.report } as Record<string, unknown>)[name] ?? doubles.operations } }))
vi.mock('../../app/store', () => ({ useAppDispatch: () => doubles.dispatch, useAppSelector: (select: (state: RootState) => unknown) => select(doubles.getState()) }))
vi.mock('../../presentation/shared/session/useLogout', () => ({ useLogout: () => vi.fn() }))
vi.mock('../../presentation/shared/screenIds', () => ({ useScreenId: vi.fn() }))
vi.mock('../../presentation/shared/events', () => ({ toast: vi.fn() }))
vi.mock('../../presentation/shared/useAsyncData', () => ({
  useAsyncData: (_load: unknown, deps: readonly unknown[]) => deps.includes(doubles.admin) ? doubles.demoQuery : { isLoading: false, isRefreshing: false, isError: false },
}))

type VM = ReturnType<typeof useAdminViewModel>
let view: ReturnType<typeof adminViewSlice.reducer>
let dataVersion: number
beforeEach(() => {
  vi.clearAllMocks()
  doubles.cleanups.length = 0
  view = adminViewSlice.reducer(undefined, { type: 'init' })
  dataVersion = 0
  doubles.demoQuery = { isLoading: false, isRefreshing: false, isError: false }
  doubles.getState.mockImplementation(() => ({ adminView: view, session: { memberId: null, user: { nick: '관리자', email: '', joined: '' } } }))
  doubles.dispatch.mockImplementation((action: { type: string }) => {
    view = adminViewSlice.reducer(view, action)
    if (action.type === 'session/dataChanged') dataVersion++
  })
})

const notice = { title: '제출한 제목', body: '제출한 본문' }
const event = { ...notice, startsAt: '', endsAt: '' }
const inquiry = { ...notice, category: '계정' }
const replyKey = 'question:reply'
const cases: { name: string; prepare: (vm: VM, changed?: boolean) => void; submit: (vm: VM) => Promise<boolean>; method: keyof typeof doubles.operations; other?: (vm: VM) => void }[] = [
  ...(['new', 'existing'] as const).flatMap((id) => [
    { name: `notice save ${id}`, method: 'saveNotice' as const, prepare: (vm: VM, changed = false) => { vm.selectRecord('notices', id); vm.setNoticeDraft(id, { ...notice, body: changed ? '새 본문' : notice.body }) }, submit: (vm: VM) => vm.saveNotice(id === 'new' ? null : id, notice), other: (vm: VM) => vm.selectRecord('notices', 'other') },
    { name: `event save ${id}`, method: 'saveEvent' as const, prepare: (vm: VM, changed = false) => { vm.selectRecord('events', id); vm.setEventDraft(id, { ...event, body: changed ? '새 본문' : event.body }) }, submit: (vm: VM) => vm.saveEvent(id === 'new' ? null : id, event), other: (vm: VM) => vm.selectRecord('events', 'other') },
    { name: `inquiry save ${id}`, method: 'saveInquiry' as const, prepare: (vm: VM, changed = false) => { vm.selectRecord('inquiries', id); vm.setInquiryDraft(id, { ...inquiry, body: changed ? '새 본문' : inquiry.body }) }, submit: (vm: VM) => vm.saveInquiry(id === 'new' ? null : id, inquiry), other: (vm: VM) => vm.selectRecord('inquiries', 'other') },
    { name: `reply save ${id}`, method: 'saveReply' as const, prepare: (vm: VM, changed = false) => { vm.selectRecord('inquiries', 'question'); vm.setReplyDraft(`question:${id}`, changed ? '새 답변' : '제출한 답변') }, submit: (vm: VM) => vm.saveReply('question', id === 'new' ? null : id, '제출한 답변'), other: (vm: VM) => vm.selectRecord('inquiries', 'other') },
  ]),
  { name: 'notice delete', method: 'deleteNotice', prepare: (vm, changed = false) => { vm.selectRecord('notices', 'existing'); vm.setNoticeDraft('existing', { ...notice, body: changed ? '새 본문' : notice.body }) }, submit: (vm) => vm.deleteNotice('existing'), other: (vm) => vm.selectRecord('notices', 'other') },
  { name: 'event delete', method: 'deleteEvent', prepare: (vm, changed = false) => { vm.selectRecord('events', 'existing'); vm.setEventDraft('existing', { ...event, body: changed ? '새 본문' : event.body }) }, submit: (vm) => vm.deleteEvent('existing'), other: (vm) => vm.selectRecord('events', 'other') },
  { name: 'inquiry delete', method: 'deleteInquiry', prepare: (vm, changed = false) => { vm.selectRecord('inquiries', 'existing'); vm.setInquiryDraft('existing', { ...inquiry, body: changed ? '새 본문' : inquiry.body }); vm.setReplyDraft('existing:new', changed ? '새 답변' : '기존 답변') }, submit: (vm) => vm.deleteInquiry('existing'), other: (vm) => vm.selectRecord('inquiries', 'other') },
  { name: 'reply delete', method: 'deleteReply', prepare: (vm, changed = false) => { vm.selectRecord('inquiries', 'question'); vm.setReplyDraft(replyKey, changed ? '새 답변' : '기존 답변') }, submit: (vm) => vm.deleteReply('question', 'reply'), other: (vm) => vm.selectRecord('inquiries', 'other') },
]

function useStartedSubmission(test: typeof cases[number]) {
  let finish!: (result: { id: string; ok: boolean; msg: string }) => void
  const response = new Promise<{ id: string; ok: boolean; msg: string }>((done) => { finish = done })
  doubles.operations[test.method].mockReturnValueOnce(response)
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

  it('이탈만 하고 돌아오지 않아도 같은 초안·선택을 정리하지 않고 성공과 dataChanged는 유지한다', async () => {
    const request = useStartedSubmission(test)
    doubles.cleanups.splice(0).forEach((cleanup) => cleanup())
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

  if (['saveNotice', 'saveEvent', 'saveInquiry'].includes(test.method)) it('제출 뒤 동일 내용으로 다시 만든 새 초안도 오래된 완료가 지우지 않는다', async () => {
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
    expect(view.inquiryDrafts).toEqual({})
    expect(view.replyDrafts).toEqual({})
    expect(dataVersion).toBe(1)
  })
})

it('문의 삭제 중 새로 쓴 답변 초안도 지우지 않는다', async () => {
  const test = cases.find((test) => test.name === 'inquiry delete')!
  const request = useStartedSubmission(test)
  request.vm.setReplyDraft('existing:new', '삭제 대기 중 작성한 답변')
  const expected = view
  request.finish()
  expect(await request.pending).toBe(true)
  expect(view).toEqual(expected)
  expect(dataVersion).toBe(1)
})

describe('데모 조회 상태와 실제 운영 API 탭 조치 (#197)', () => {
  const settled = { isLoading: false, isRefreshing: false, isError: false }
  const demoStates = [['조회 중', { isLoading: true }], ['새로고침 중', { isRefreshing: true }], ['조회 실패', { isError: true }]] as const
  const liveActions: { tab: AdminTab; name: string; submit: (vm: VM) => Promise<boolean>; backend: () => ReturnType<typeof vi.fn> }[] = [
    { tab: 'users', name: '회원 이용 제한', submit: (vm) => vm.live.setMemberRestriction('member-1', true), backend: () => doubles.member.setRestriction },
    { tab: 'admins', name: '관리자 계정 생성', submit: (vm) => vm.live.createAdmin({ email: 'new@example.invalid', nickname: '새 관리자', password: 'password-1', permissions: ['works'] }), backend: () => doubles.member.createAdmin },
    { tab: 'rights', name: '신고 검토', submit: (vm) => vm.live.review('report-1', 'ACCEPTED', '확인'), backend: () => doubles.report.review },
  ]

  describe.each(demoStates)('데모 조회가 %s일 때', (_name, state) => {
    beforeEach(() => { doubles.demoQuery = { ...settled, ...state } })

    it.each(liveActions)('운영 API 탭($tab)의 $name 조치는 막히지 않고 실행되어 목록을 다시 읽는다', async ({ tab, submit, backend }) => {
      backend().mockResolvedValueOnce(undefined)
      const vm = useAdminViewModel(tab)
      expect(vm.mutationsBlocked).toBe(false)
      expect(await submit(vm)).toBe(true)
      expect(backend()).toHaveBeenCalledTimes(1)
      expect(dataVersion).toBe(1)
    })

    it('데모 탭의 조치는 기존처럼 막혀 실행되지 않는다', async () => {
      const vm = useAdminViewModel('notices')
      expect(vm.mutationsBlocked).toBe(true)
      expect(await vm.saveNotice(null, notice)).toBe(false)
      expect(doubles.operations.saveNotice).not.toHaveBeenCalled()
      expect(dataVersion).toBe(0)
    })
  })

  it('데모 조회가 끝나 있으면 데모 탭 조치는 실행된다', async () => {
    doubles.operations.saveNotice.mockResolvedValueOnce({ id: 'saved' })
    const vm = useAdminViewModel('notices')
    expect(vm.mutationsBlocked).toBe(false)
    expect(await vm.saveNotice(null, notice)).toBe(true)
    expect(dataVersion).toBe(1)
  })
})

it('작품 탭 View가 쓰는 정본 작품 조치 불가 판단을 ViewModel이 노출한다 (#197)', () => {
  const vm = useAdminViewModel('works')
  expect(vm.canToggleWork({ canonical: true })).toBe(false)
  expect(vm.canToggleWork({})).toBe(true)
})

describe('개요의 답변 대기 문의 (#202)', () => {
  it('운영 패널 문의 중 답변이 하나도 없는 건수를 센다', () => {
    doubles.demoQuery = {
      isLoading: false, isRefreshing: false, isError: false,
      data: { operations: { inquiries: [{ replies: [] }, { replies: [{ id: 'reply' }] }, { replies: [] }] } },
    }
    expect(useAdminViewModel('data').unansweredInquiries).toBe(2)
  })
})

// OperationsUseCase는 UTC 형식을 다시 검사하지 않으므로, 형식 검사는 이 경계가 맡습니다 (#202).
describe('이벤트 기간 입력 경계', () => {
  it('한국시간 입력은 UTC로, 빈 입력은 null로 UseCase에 전달한다', async () => {
    doubles.operations.saveEvent.mockResolvedValueOnce({ id: 'saved' })
    const vm = useAdminViewModel('events')
    expect(await vm.saveEvent(null, { ...event, startsAt: '2026-11-05T09:30', endsAt: '' })).toBe(true)
    expect(doubles.operations.saveEvent).toHaveBeenCalledWith(null, { title: event.title, body: event.body, startsAt: '2026-11-05T00:30:00.000Z', endsAt: null })
  })

  it.each(['2026-02-30T09:00', '2026-11-05T24:00', '2026-11-05', '임의 기간'])('형식이 틀린 입력은 UseCase에 닿기 전에 거절한다: %s', async (startsAt) => {
    const vm = useAdminViewModel('events')
    expect(await vm.saveEvent(null, { ...event, startsAt })).toBe(false)
    expect(doubles.operations.saveEvent).not.toHaveBeenCalled()
    expect(dataVersion).toBe(0)
  })
})
