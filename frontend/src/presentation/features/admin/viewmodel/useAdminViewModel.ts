import { useEffect, useRef, useState } from 'react'
import { useStore } from 'react-redux'
import { useLogout } from '../../../shared/session/useLogout'

import { appContainer } from '../../../../app/appContainer'
import { useAppDispatch, useAppSelector, type RootState } from '../../../../app/store'
import type { AdminTab } from '../../../../domain/entities/admin'
import { toUtcFromKoreanInput, type NoticeInput } from '../../../../domain/entities/operations'
import { type AdminResult, type AdminUseCase, canToggleWork } from '../../../../domain/usecases/AdminUseCase'
import type { NoticeUseCase } from '../../../../domain/usecases/NoticeUseCase'
import type { OperationsUseCase } from '../../../../domain/usecases/OperationsUseCase'
import type { AdminInput, MemberQuery } from '../../../../domain/entities/member'
import { REPORT_STATUSES, type ReviewDecision } from '../../../../domain/entities/report'
import { SUPPORT_STATUSES } from '../../../../domain/entities/supportInquiry'
import type { MemberUseCase } from '../../../../domain/usecases/MemberUseCase'
import type { ReportUseCase } from '../../../../domain/usecases/ReportUseCase'
import type { SupportInquiryUseCase } from '../../../../domain/usecases/SupportInquiryUseCase'
import { toast } from '../../../shared/events'
import { useScreenId } from '../../../shared/screenIds'
import { sessionActions } from '../../../shared/session/sessionSlice'
import { type ActionState, useActionRunner } from '../../../shared/useActionRunner'
import { useAsyncData } from '../../../shared/useAsyncData'
import { adminViewActions, type AdminChatForm, type AdminFilter, type EventDraft, type OperationsRecordKind } from '../state/adminViewSlice'

/** 목업 adminExtra()·adminLegacy()의 baseId */
const IDS: Record<AdminTab, string> = { data: 'A01+A02', rights: 'A03', llm: 'A05', users: 'A07', works: 'A08', comments: 'A09', characterChats: 'A18', feedback: 'A10', events: 'A11', notices: 'A12', credits: 'A13', audit: 'A14', jobs: 'A16', admins: 'A17', profile: 'A15' }
export type AdminActionState = ActionState
const demoSaved = (name: string) => ({ ok: true, msg: `${name} 저장했어요 (독립 운영 데모 · 서버 저장 없음)` })
const demoDeleted = (name: string) => ({ ok: true, msg: `${name} 삭제했어요 (독립 운영 데모 · 서버 삭제 없음)` })
/** 운영 API에 실제로 연결된 탭. 나머지 탭은 기존 메모리 데모입니다. */
export const LIVE_TABS: AdminTab[] = ['users', 'admins', 'rights', 'feedback', 'profile', 'notices']
const ROLES: MemberQuery['role'][] = ['MEMBER', 'ADMIN']

/** 기존 제보 데모·독립 공지/이벤트 데모와 실제 운영 API(회원·신고·고객지원 문의)를 함께 보여 주되 정본과 조치를 섞지 않습니다. */
export function useAdminViewModel(
  tab: AdminTab,
  adminUseCase: AdminUseCase = appContainer.resolve('adminUseCase'),
  operationsUseCase: OperationsUseCase = appContainer.resolve('operationsUseCase'),
  memberUseCase: MemberUseCase = appContainer.resolve('memberUseCase'),
  reportUseCase: ReportUseCase = appContainer.resolve('reportUseCase'),
  noticeUseCase: NoticeUseCase = appContainer.resolve('noticeUseCase'),
  supportInquiryUseCase: SupportInquiryUseCase = appContainer.resolve('supportInquiryUseCase'),
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
  const status = REPORT_STATUSES.find(([value]) => value === filter?.category)?.[0] ?? null
  const live = useAsyncData(async () => ({
    members: tab === 'users' ? await memberUseCase.listMembers({ role, q, sort }) : [],
    admins: tab === 'admins' ? await memberUseCase.listAdmins() : [],
    // 개요의 '접수된 신고' 수도 실제 신고 목록에서 셉니다.
    reports: tab === 'rights' ? await reportUseCase.listAll(status) : tab === 'data' ? await reportUseCase.listAll('RECEIVED') : [],
    notices: tab === 'notices' ? await noticeUseCase.list() : [],
  }), [tab, role, q, sort, status, memberUseCase, reportUseCase, noticeUseCase])
  const reportId = tab === 'rights' ? sel : null
  const report = useAsyncData(async () => reportId ? reportUseCase.get(reportId) : null, [reportId, reportUseCase])
  // 고객지원 문의(67): 제보·문의 탭은 상태 필터 목록과 선택한 문의 상세를, 개요는 답변 대기 수만 서버에서 읽습니다.
  const inquiryStatus = SUPPORT_STATUSES.find(([s]) => s === filter?.category)?.[0] ?? null
  const inquiries = useAsyncData(async () => tab === 'feedback' ? supportInquiryUseCase.listAll(inquiryStatus) : tab === 'data' ? supportInquiryUseCase.listAll('WAITING') : [], [tab, inquiryStatus, supportInquiryUseCase])
  const inquiryId = tab === 'feedback' ? view.recordSelection.inquiries : null
  const inquiry = useAsyncData(async () => inquiryId ? supportInquiryUseCase.get(inquiryId) : null, [inquiryId, supportInquiryUseCase])
  // mounted는 화면을 떠난 뒤 끝난 조치가 다른 화면에 알림을 띄우거나 Redux 초안·선택을 정리하지 않게 하는 데만 씁니다.
  const mounted = useRef(true)
  const [lastSuccess, setLastSuccess] = useState('')
  useEffect(() => { mounted.current = true; return () => { mounted.current = false } }, [])
  const notify = (message: string) => { if (mounted.current) toast(message) }
  const { actions, run: exec } = useActionRunner('완료 여부를 확인하지 못했어요. 입력은 유지했어요. 목록을 새로고침해 처리 여부를 확인한 뒤 다시 시도해 주세요.', notify)

  // 데모 조회(query) 중·실패 때는 데모 탭 조치만 막습니다. 실제 운영 API 탭은 데모 조회와 무관하게 조치합니다.
  const mutationsBlocked = !LIVE_TABS.includes(tab) && (query.isLoading || query.isRefreshing || query.isError)

  /** 지연 실행으로 중복 호출 자체를 막습니다. 저장 결과와 뒤이은 목록 재조회 결과는 별개입니다. */
  const run = async (key: string, action: () => Promise<AdminResult>): Promise<boolean> => {
    if (mutationsBlocked) return false
    return exec(key, async () => {
      setLastSuccess('')
      const result = await action()
      if (!result) return { ok: false, msg: '대상을 찾을 수 없어요. 목록을 새로고침해 주세요.' }
      if (result.ok) { dispatch(sessionActions.dataChanged()); setLastSuccess(result.msg) }
      notify(result.msg)
      return result
    })
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
    /** 본인 계정 조치 버튼을 막는 화면용 값. 서버도 본인 제한을 400으로 거절합니다. */
    selfId: memberId,
    me,
    live: {
      ...live, report, inquiries, inquiry,
      setMemberRestriction: (id: string, restricted: boolean) => runLive(`member:${id}`, restricted ? '회원 이용을 제한했어요.' : '회원 이용 제한을 해제했어요.', () => memberUseCase.setRestriction(id, restricted)),
      createAdmin: (input: AdminInput) => runLive('admin:new', '관리자 계정을 만들고 권한을 저장했어요.', () => memberUseCase.createAdmin(input)),
      review: (id: string, decision: ReviewDecision, note: string) => runLive(`report:${id}:review`, '검토 결과를 기록했어요.', () => reportUseCase.review(id, decision, note)),
      setContentRestriction: (id: string, restricted: boolean) => runLive(`report:${id}:restrict`, restricted ? '대상 작품을 제한했어요.' : '대상 작품 제한을 해제했어요.', () => reportUseCase.setContentRestriction(id, restricted)),
      requestEvidence: (id: string, body: string) => runLive(`report:${id}:evidence`, '작품 등록자에게 권리 증빙을 요청했어요.', () => reportUseCase.requestEvidence(id, body)),
      // 답변 수정·삭제는 같은 키를 써서 한 답변에 동시에 두 요청이 나가지 않게 합니다.
      addReply: (id: string, body: string) => runLive(`inquiry:${id}:reply`, '답변을 등록했어요.', () => supportInquiryUseCase.addReply(id, body)),
      updateReply: (id: string, replyId: string, body: string) => runLive(`inquiry:${id}:reply:${replyId}`, '답변을 수정했어요.', () => supportInquiryUseCase.updateReply(id, replyId, body)),
      deleteReply: (id: string, replyId: string) => runLive(`inquiry:${id}:reply:${replyId}`, '답변을 삭제했어요.', () => supportInquiryUseCase.deleteReply(id, replyId)),
    },
    mutationsBlocked,
    setSel: (id: string) => { dispatch(adminViewActions.select(id)) },
    setFilter: (t: AdminTab, filter: AdminFilter) => { dispatch(adminViewActions.setFilter({ tab: t, filter })) },
    setChatForm: (form: AdminChatForm) => { dispatch(adminViewActions.setChatForm(form)) },
    selectRecord,
    setNoticeDraft: (id: string, value: NoticeInput) => { dispatch(adminViewActions.setNoticeDraft({ id, value })) },
    setEventDraft: (id: string, value: EventDraft) => { dispatch(adminViewActions.setEventDraft({ id, value })) },
    // 성공·dataChanged는 유지하되 UI 정리는 살아 있는 폼의 제출 초안·선택에만 적용합니다.
    saveNotice: (id: string | null, input: NoticeInput) => run(`notice:${id ?? 'new'}`, async () => {
      const key = id ?? 'new', untouched = watchForm('notices', key, (s) => s.noticeDrafts[key])
      const row = await noticeUseCase.save(id, input)
      if (untouched()) { dispatch(adminViewActions.clearNoticeDraft(key)); selectRecord('notices', row.id) }
      return { ok: true, msg: '공지를 저장했어요. 회원 공지사항에 바로 공개돼요.' }
    }),
    deleteNotice: (id: string) => run(`notice:${id}`, async () => {
      const untouched = watchForm('notices', id, (s) => s.noticeDrafts[id])
      await noticeUseCase.delete(id)
      if (untouched()) { dispatch(adminViewActions.clearNoticeDraft(id)); selectRecord('notices', null) }
      return { ok: true, msg: '공지를 삭제했어요. 회원 공지사항에서도 사라져요.' }
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
