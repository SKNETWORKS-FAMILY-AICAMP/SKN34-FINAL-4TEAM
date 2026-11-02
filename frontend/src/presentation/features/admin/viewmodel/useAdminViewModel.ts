import { useNavigate } from 'react-router'

import { appContainer } from '../../../../app/appContainer'
import { useAppDispatch, useAppSelector } from '../../../../app/store'
import type { AdminTab } from '../../../../domain/entities/admin'
import type { AdminResult, AdminUseCase } from '../../../../domain/usecases/AdminUseCase'
import { toast } from '../../../shared/events'
import { useScreenId } from '../../../shared/screenIds'
import { sessionActions } from '../../../shared/session/sessionSlice'
import { useAsyncData } from '../../../shared/useAsyncData'
import { adminViewActions, type AdminChatForm, type AdminFilter } from '../state/adminViewSlice'

/** 목업 adminExtra()·adminLegacy()의 baseId */
const IDS: Record<AdminTab, string> = { data: 'A01+A02', rights: 'A03', llm: 'A05', users: 'A07', works: 'A08', comments: 'A09', characterChats: 'A18', feedback: 'A10', events: 'A11', notices: 'A12', credits: 'A13', audit: 'A14', jobs: 'A16', admins: 'A17', profile: 'A15' }

/** 목업 admin(): 관리자 업무 화면. 조치 결과 문구는 UseCase가 돌려준 목업 문구입니다. */
export function useAdminViewModel(tab: AdminTab, adminUseCase: AdminUseCase = appContainer.resolve('adminUseCase')) {
  const dispatch = useAppDispatch()
  const navigate = useNavigate()
  const view = useAppSelector((s) => s.adminView)
  const sel = view.sel
  useScreenId(tab === 'rights' && sel ? 'A03+A04' : IDS[tab])
  const { data } = useAsyncData(() => adminUseCase.load(), [adminUseCase])
  /** 목업 render() 재호출: 성공하면 데이터를 다시 읽고, 문구가 있으면 토스트를 띄웁니다. 성공 여부를 돌려줍니다. */
  const run = async (p: Promise<AdminResult>) => {
    const r = await p
    if (!r) return false
    if (r.ok) dispatch(sessionActions.dataChanged())
    toast(r.msg)
    return r.ok
  }
  return {
    data,
    ...view,
    setSel: (id: string) => { dispatch(adminViewActions.select(id)) },
    setFilter: (t: AdminTab, filter: AdminFilter) => { dispatch(adminViewActions.setFilter({ tab: t, filter })) },
    setChatForm: (form: AdminChatForm) => { dispatch(adminViewActions.setChatForm(form)) },
    chatChoices: adminUseCase.chatChoices.bind(adminUseCase),
    toggleUser: (id: string) => run(adminUseCase.toggleUser(id)),
    toggleWork: (id: string) => run(adminUseCase.toggleWork(id)),
    toggleComment: (id: string, label: string) => run(adminUseCase.toggleComment(id, label)),
    toggleChat: (id: string) => run(adminUseCase.toggleChat(id)),
    addChat: (workId: string, character: string) => run(adminUseCase.addChat(workId, character)),
    reply: (id: string, text: string) => run(adminUseCase.reply(id, text)),
    addNotice: (t: string, b: string) => run(adminUseCase.addNotice(t, b)),
    addEvent: (t: string, p: string, b: string) => run(adminUseCase.addEvent(t, p, b)),
    toggleEvent: (i: number) => run(adminUseCase.toggleEvent(i)),
    runJob: (id: string) => run(adminUseCase.runJob(id)),
    resolveAlert: (id: string) => run(adminUseCase.resolveAlert(id)),
    flag: (k: 'proof' | 'hide' | 'lift') => run(adminUseCase.flag(k)),
    review: (id: string, act: 'ok' | 'hide' | 'keep' | 'restore') => run(adminUseCase.review(id, act)),
    saveProfile: (nick: string, email: string) => run(adminUseCase.saveProfile(nick, email)),
    addAdmin: (nick: string, email: string, perms: string[]) => run(adminUseCase.addAdmin(nick, email, perms)),
    logout: () => { dispatch(sessionActions.logout()); navigate('/'); toast('로그아웃했어요') },
  }
}
