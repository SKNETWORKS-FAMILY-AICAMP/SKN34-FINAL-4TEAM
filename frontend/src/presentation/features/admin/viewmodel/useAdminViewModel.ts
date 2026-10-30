import { useNavigate } from 'react-router'

import { appContainer } from '../../../../app/appContainer'
import { useAppDispatch } from '../../../../app/store'
import type { AdminTab } from '../../../../domain/entities/admin'
import type { AdminUseCase } from '../../../../domain/usecases/AdminUseCase'
import { toast } from '../../../shared/events'
import { useScreenId } from '../../../shared/screenIds'
import { sessionActions } from '../../../shared/session/sessionSlice'
import { useAsyncData } from '../../../shared/useAsyncData'

/** 목업 adminExtra()·adminLegacy()의 baseId */
const IDS: Record<AdminTab, string> = { data: 'A01+A02', rights: 'A03', llm: 'A05', users: 'A07', works: 'A08', comments: 'A09', characterChats: 'A18', feedback: 'A10', events: 'A11', notices: 'A12', credits: 'A13', audit: 'A14', jobs: 'A16', admins: 'A17', profile: 'A15' }

/** 목업 admin(): 관리자 업무 화면. 조치 결과 문구는 UseCase가 돌려준 목업 문구입니다. */
export function useAdminViewModel(tab: AdminTab, sel: string | null, adminUseCase: AdminUseCase = appContainer.resolve('adminUseCase')) {
  const dispatch = useAppDispatch()
  const navigate = useNavigate()
  useScreenId(tab === 'rights' && sel ? 'A03+A04' : IDS[tab])
  const { data } = useAsyncData(() => adminUseCase.load(), [adminUseCase])
  /** 목업 render() 재호출: 문구가 있으면 데이터를 다시 읽고 토스트를 띄웁니다. 성공 여부를 돌려줍니다. */
  const run = async (p: Promise<string | null>, ok?: string) => {
    const msg = await p
    if (!msg) return false
    if (!ok || msg === ok) dispatch(sessionActions.dataChanged())
    toast(msg)
    return !ok || msg === ok
  }
  return {
    data,
    chatChoices: adminUseCase.chatChoices.bind(adminUseCase),
    toggleUser: (id: string) => run(adminUseCase.toggleUser(id)),
    toggleWork: (id: string) => run(adminUseCase.toggleWork(id)),
    toggleComment: (id: string, label: string) => run(adminUseCase.toggleComment(id, label)),
    toggleChat: (id: string) => run(adminUseCase.toggleChat(id)),
    addChat: (workId: string, character: string) => run(adminUseCase.addChat(workId, character), '캐릭터챗을 추가했어요 (데모)'),
    reply: (id: string, text: string) => run(adminUseCase.reply(id, text), '답변을 등록했어요 (데모 · 실제 전송 없음)'),
    addNotice: (t: string, b: string) => run(adminUseCase.addNotice(t, b), '공지를 게시했어요 (데모 · 현재 화면에만 반영)'),
    addEvent: (t: string, p: string, b: string) => run(adminUseCase.addEvent(t, p, b), '이벤트를 추가했어요 (데모 · 현재 화면에만 반영)'),
    toggleEvent: (i: number) => run(adminUseCase.toggleEvent(i)),
    runJob: (id: string) => run(adminUseCase.runJob(id)),
    resolveAlert: (id: string) => run(adminUseCase.resolveAlert(id)),
    flag: (k: 'proof' | 'hide' | 'lift') => run(adminUseCase.flag(k)),
    review: (id: string, act: 'ok' | 'hide' | 'keep' | 'restore') => run(adminUseCase.review(id, act), '처리 결과를 기록하고 신고자에게 알렸어요 (데모)'),
    saveProfile: (nick: string, email: string) => run(adminUseCase.saveProfile(nick, email), '프로필을 저장했어요 (데모 · 현재 화면에만 반영)'),
    addAdmin: (nick: string, email: string, perms: string[]) => run(adminUseCase.addAdmin(nick, email, perms), '관리자 계정을 추가했어요 (데모)'),
    logout: () => { dispatch(sessionActions.logout()); navigate('/'); toast('로그아웃했어요') },
  }
}
