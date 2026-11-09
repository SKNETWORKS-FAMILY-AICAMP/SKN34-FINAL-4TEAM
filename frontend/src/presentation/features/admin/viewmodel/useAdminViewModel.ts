import { useEffect, useRef, useState } from 'react'
import { useStore } from 'react-redux'
import { useLogout } from '../../../shared/session/useLogout'

import { appContainer } from '../../../../app/appContainer'
import { useAppDispatch, useAppSelector, type RootState } from '../../../../app/store'
import type { AdminTab } from '../../../../domain/entities/admin'
import { OperationsError, toUtcFromKoreanInput, type InquiryInput, type NoticeInput } from '../../../../domain/entities/operations'
import { type AdminResult, type AdminUseCase, canToggleWork } from '../../../../domain/usecases/AdminUseCase'
import type { OperationsUseCase } from '../../../../domain/usecases/OperationsUseCase'
import type { AdminInput, MemberQuery } from '../../../../domain/entities/member'
import type { ReportStatus, ReviewDecision } from '../../../../domain/entities/report'
import type { MemberUseCase } from '../../../../domain/usecases/MemberUseCase'
import type { ReportUseCase } from '../../../../domain/usecases/ReportUseCase'
import { toast } from '../../../shared/events'
import { useScreenId } from '../../../shared/screenIds'
import { sessionActions } from '../../../shared/session/sessionSlice'
import { useAsyncData } from '../../../shared/useAsyncData'
import { adminViewActions, type AdminChatForm, type AdminFilter, type EventDraft, type OperationsRecordKind } from '../state/adminViewSlice'

/** 목업 adminExtra()·adminLegacy()의 baseId */
const IDS: Record<AdminTab, string> = { data: 'A01+A02', rights: 'A03', llm: 'A05', users: 'A07', works: 'A08', comments: 'A09', characterChats: 'A18', feedback: 'A10', events: 'A11', notices: 'A12', credits: 'A13', audit: 'A14', jobs: 'A16', admins: 'A17', profile: 'A15' }
export type AdminActionState = { pending: boolean; error: string; message: string }
const demoSaved = (name: string) => ({ ok: true, msg: `${name} 저장했어요 (독립 운영 데모 · 서버 저장 없음)` })
const demoDeleted = (name: string) => ({ ok: true, msg: `${name} 삭제했어요 (독립 운영 데모 · 서버 삭제 없음)` })
/** 운영 API에 실제로 연결된 탭. 나머지 탭은 기존 메모리 데모입니다. */
export const LIVE_TABS: AdminTab[] = ['users', 'admins', 'rights', 'profile']
const ROLES: MemberQuery['role'][] = ['MEMBER', 'ADMIN']
const STATUSES: ReportStatus[] = ['RECEIVED', 'ACCEPTED', 'REJECTED']

/** 기존 회원/제보 데모와 독립 운영 CRUD를 함께 보여 주되 정본과 조치를 섞지 않습니다. */
export function useAdminViewModel(
  tab: AdminTab,
  adminUseCase: AdminUseCase = appContainer.resolve('adminUseCase'),
  operationsUseCase: OperationsUseCase = appContainer.resolve('operationsUseCase'),
  memberUseCase: MemberUseCase = appContainer.resolve('memberUseCase'),
  reportUseCase: ReportUseCase = appContainer.resolve('reportUseCase'),
) {
  const dispatch = useAppDispatch()
  const store = useStore<RootState>()
  const logout = useLogout()
  const view = useAppSelector((s) => s.adminView)
  const memberId = useAppSelector((s) => s.session.memberId)
  const me = useAppSelector((s) => s.session.user)
  const sel = view.sel
  useScreenId(tab === 'rights' && sel ? 'A03+A04' : IDS[tab])
  const query = useAsyncData(async () => {
    const [data, operations] = await Promise.all([adminUseCase.load(), operationsUseCase.load()])
    return { ...data, operations }
  }, [adminUseCase, operationsUseCase])
  // 실제 운영 API 조회: 현재 탭에 필요한 목록만 요청하고, 필터는 서버 query로 보냅니다.
  const filter = view.filters[tab]
  const role = ROLES.find((r) => r === filter?.category) ?? 'ALL'
  const q = tab === 'users' ? filter?.query ?? '' : ''
  const sort = filter?.sort === 'oldest' ? 'oldest' : 'newest'
  const status = STATUSES.find((x) => x === filter?.category) ?? null
  const live = useAsyncData(async () => ({
    members: tab === 'users' ? await memberUseCase.listMembers({ role, q, sort }) : [],
    admins: tab === 'admins' ? await memberUseCase.listAdmins() : [],
    // 개요의 '접수된 신고' 수도 실제 신고 목록에서 셉니다.
    reports: tab === 'rights' ? await reportUseCase.listAll(status) : tab === 'data' ? await reportUseCase.listAll('RECEIVED') : [],
  }), [tab, role, q, sort, status, memberUseCase, reportUseCase])
  const reportId = tab === 'rights' ? sel : null
  const report = useAsyncData(async () => reportId ? reportUseCase.get(reportId) : null, [reportId, reportUseCase])
  const busy = useRef(new Set<string>())
  const mounted = useRef(true)
  const [actions, setActions] = useState<Record<string, AdminActionState>>({})
  const [lastSuccess, setLastSuccess] = useState('')
  useEffect(() => { mounted.current = true; return () => { mounted.current = false } }, [])

  // 데모 조회(query) 중·실패 때는 데모 탭 조치만 막습니다. 실제 운영 API 탭은 데모 조회와 무관하게 조치합니다.
  const mutationsBlocked = !LIVE_TABS.includes(tab) && (query.isLoading || query.isRefreshing || query.isError)

  /** 지연 실행으로 중복 호출 자체를 막습니다. 저장 결과와 뒤이은 목록 재조회 결과는 별개입니다. */
  const run = async (key: string, action: () => Promise<AdminResult>): Promise<boolean> => {
    if (busy.current.has(key) || mutationsBlocked) return false
    busy.current.add(key)
    setLastSuccess('')
    setActions((s) => ({ ...s, [key]: { pending: true, error: '', message: '' } }))
    try {
      const result = await action()
      if (result?.ok) dispatch(sessionActions.dataChanged())
      if (mounted.current) {
        const error = result ? (result.ok ? '' : result.msg) : '대상을 찾을 수 없어요. 목록을 새로고침해 주세요.'
        setActions((s) => ({ ...s, [key]: { pending: false, error, message: result?.ok ? result.msg : '' } }))
        if (result?.ok) setLastSuccess(result.msg)
        if (result) toast(result.msg)
      }
      return result?.ok ?? false
    } catch (error) {
      if (mounted.current) {
        const message = error instanceof OperationsError ? error.message : '완료 여부를 확인하지 못했어요. 입력은 유지했어요. 목록을 새로고침해 처리 여부를 확인한 뒤 다시 시도해 주세요.'
        setActions((s) => ({ ...s, [key]: { pending: false, error: message, message: '' } }))
        toast(message)
      }
      return false
    } finally { busy.current.delete(key) }
  }
  /** 서버 응답 성공만 완료로 표시하고 dataChanged로 목록·상세를 다시 조회합니다. */
  const runLive = (key: string, msg: string, action: () => Promise<void>) => run(key, async () => { await action(); return { ok: true, msg } })
  const selectRecord = (kind: OperationsRecordKind, id: string | null) => { dispatch(adminViewActions.selectRecord({ kind, id })) }
  /**
   * 요청을 보내는 순간의 초안(`draftOf`)을 기억해 두었다가, 완료 때 호출하면 같은 mount·같은 선택에서
   * 초안이 그대로일 때만 true입니다. 화면을 떠났거나 다른 레코드를 골랐거나 초안을 고쳤다면(같은 내용으로 다시 쓴 새 초안 포함) false입니다.
   */
  const watchForm = (kind: OperationsRecordKind, id: string, draftOf: (s: RootState['adminView']) => unknown) => {
    const before = draftOf(store.getState().adminView)
    return () => {
      const now = store.getState().adminView
      return mounted.current && now.recordSelection[kind] === id && draftOf(now) === before
    }
  }
  return {
    ...query, ...view, actions, lastSuccess,
    /** 개요의 '답변 대기 문의': 운영 패널(메모리) 문의 중 답변이 하나도 없는 건수. 회원 문의는 세지 않습니다. */
    unansweredInquiries: query.data?.operations.inquiries.filter((q) => !q.replies.length).length ?? 0,
    /** 본인 계정 조치 버튼을 막는 화면용 값. 서버도 본인 제한을 400으로 거절합니다. */
    selfId: memberId,
    me,
    live: {
      ...live, report,
      setMemberRestriction: (id: string, restricted: boolean) => runLive(`member:${id}`, restricted ? '회원 이용을 제한했어요.' : '회원 이용 제한을 해제했어요.', () => memberUseCase.setRestriction(id, restricted)),
      createAdmin: (input: AdminInput) => runLive('admin:new', '관리자 계정을 만들고 권한을 저장했어요.', () => memberUseCase.createAdmin(input)),
      review: (id: string, decision: ReviewDecision, note: string) => runLive(`report:${id}:review`, '검토 결과를 기록했어요.', () => reportUseCase.review(id, decision, note)),
      setContentRestriction: (id: string, restricted: boolean) => runLive(`report:${id}:restrict`, restricted ? '대상 작품을 제한했어요.' : '대상 작품 제한을 해제했어요.', () => reportUseCase.setContentRestriction(id, restricted)),
      requestEvidence: (id: string, body: string) => runLive(`report:${id}:evidence`, '작품 등록자에게 권리 증빙을 요청했어요.', () => reportUseCase.requestEvidence(id, body)),
    },
    mutationsBlocked,
    setSel: (id: string) => { dispatch(adminViewActions.select(id)) },
    setFilter: (t: AdminTab, filter: AdminFilter) => { dispatch(adminViewActions.setFilter({ tab: t, filter })) },
    setChatForm: (form: AdminChatForm) => { dispatch(adminViewActions.setChatForm(form)) },
    selectRecord,
    setNoticeDraft: (id: string, value: NoticeInput) => { dispatch(adminViewActions.setNoticeDraft({ id, value })) },
    setEventDraft: (id: string, value: EventDraft) => { dispatch(adminViewActions.setEventDraft({ id, value })) },
    setInquiryDraft: (id: string, value: InquiryInput) => { dispatch(adminViewActions.setInquiryDraft({ id, value })) },
    setReplyDraft: (id: string, value: string) => { dispatch(adminViewActions.setReplyDraft({ id, value })) },
    // 성공·dataChanged는 유지하되 UI 정리는 살아 있는 폼의 제출 초안·선택에만 적용합니다.
    saveNotice: (id: string | null, input: NoticeInput) => run(`notice:${id ?? 'new'}`, async () => {
      const key = id ?? 'new', untouched = watchForm('notices', key, (s) => s.noticeDrafts[key])
      const row = await operationsUseCase.saveNotice(id, input)
      if (untouched()) { dispatch(adminViewActions.clearNoticeDraft(key)); selectRecord('notices', row.id) }
      return demoSaved('공지를')
    }),
    deleteNotice: (id: string) => run(`notice:${id}`, async () => {
      const untouched = watchForm('notices', id, (s) => s.noticeDrafts[id])
      await operationsUseCase.deleteNotice(id)
      if (untouched()) { dispatch(adminViewActions.clearNoticeDraft(id)); selectRecord('notices', null) }
      return demoDeleted('공지를')
    }),
    saveEvent: (id: string | null, input: EventDraft) => run(`event:${id ?? 'new'}`, async () => {
      const key = id ?? 'new', untouched = watchForm('events', key, (s) => s.eventDrafts[key])
      const row = await operationsUseCase.saveEvent(id, { title: input.title, body: input.body, startsAt: toUtcFromKoreanInput(input.startsAt), endsAt: toUtcFromKoreanInput(input.endsAt) })
      if (untouched()) { dispatch(adminViewActions.clearEventDraft(key)); selectRecord('events', row.id) }
      return demoSaved('이벤트를')
    }),
    deleteEvent: (id: string) => run(`event:${id}`, async () => {
      const untouched = watchForm('events', id, (s) => s.eventDrafts[id])
      await operationsUseCase.deleteEvent(id)
      if (untouched()) { dispatch(adminViewActions.clearEventDraft(id)); selectRecord('events', null) }
      return demoDeleted('이벤트를')
    }),
    saveInquiry: (id: string | null, input: InquiryInput) => run(`inquiry:${id ?? 'new'}`, async () => {
      const key = id ?? 'new', untouched = watchForm('inquiries', key, (s) => s.inquiryDrafts[key])
      const row = await operationsUseCase.saveInquiry(id, input)
      if (untouched()) { dispatch(adminViewActions.clearInquiryDraft(key)); selectRecord('inquiries', row.id) }
      return demoSaved('문의를')
    }),
    deleteInquiry: (id: string) => run(`inquiry:${id}`, async () => {
      const replyDrafts = store.getState().adminView.replyDrafts, untouched = watchForm('inquiries', id, (s) => s.inquiryDrafts[id])
      await operationsUseCase.deleteInquiry(id)
      // 문의에 딸린 답변 초안도 요청 중에 새로 쓰거나 고치지 않았을 때만 함께 정리합니다.
      if (untouched() && Object.entries(store.getState().adminView.replyDrafts).every(([key, body]) => !key.startsWith(id + ':') || body === replyDrafts[key])) {
        dispatch(adminViewActions.clearInquiryDraft(id)); dispatch(adminViewActions.clearInquiryReplies(id)); selectRecord('inquiries', null)
      }
      return demoDeleted('문의를')
    }),
    saveReply: (inquiryId: string, id: string | null, body: string) => run(`reply:${inquiryId}:${id ?? 'new'}`, async () => {
      const key = `${inquiryId}:${id ?? 'new'}`, untouched = watchForm('inquiries', inquiryId, (s) => s.replyDrafts[key])
      await operationsUseCase.saveReply(inquiryId, id, body)
      if (untouched()) dispatch(adminViewActions.clearReplyDraft(key))
      return demoSaved('답변을')
    }),
    deleteReply: (inquiryId: string, id: string) => run(`reply:${inquiryId}:${id}`, async () => {
      const key = `${inquiryId}:${id}`, untouched = watchForm('inquiries', inquiryId, (s) => s.replyDrafts[key])
      await operationsUseCase.deleteReply(inquiryId, id)
      if (untouched()) dispatch(adminViewActions.clearReplyDraft(key))
      return demoDeleted('답변을')
    }),
    chatChoices: adminUseCase.chatChoices.bind(adminUseCase),
    canToggleWork,
    toggleWork: (id: string) => run(`work:${id}`, () => adminUseCase.toggleWork(id)),
    toggleComment: (id: string, label: string) => run(`comment:${id}`, () => adminUseCase.toggleComment(id, label)),
    toggleChat: (id: string) => run(`chat:${id}`, () => adminUseCase.toggleChat(id)),
    addChat: (workId: string, character: string) => run('chat:new', () => adminUseCase.addChat(workId, character)),
    runJob: (id: string) => run(`job:${id}`, () => adminUseCase.runJob(id)),
    resolveAlert: (id: string) => run(`alert:${id}`, () => adminUseCase.resolveAlert(id)),
    logout,
  }
}
