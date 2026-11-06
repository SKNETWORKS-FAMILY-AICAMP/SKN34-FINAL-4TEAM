import { useNavigate } from 'react-router'

import { appContainer } from '../../../../app/appContainer'
import { useAppDispatch } from '../../../../app/store'
import type { NotificationPrefs } from '../../../../domain/repositories/NotificationRepository'
import type { InboxAct, InboxUseCase } from '../../../../domain/usecases/InboxUseCase'
import type { ShellUseCase } from '../../../../domain/usecases/ShellUseCase'
import { toast } from '../../../shared/events'
import { useScreenId } from '../../../shared/screenIds'
import { sessionActions } from '../../../shared/session/sessionSlice'
import { useAsyncData } from '../../../shared/useAsyncData'

/** 목업 inbox(): U20 독자 피드백함 */
export function useInboxViewModel(sel: string | null, inboxUseCase: InboxUseCase = appContainer.resolve('inboxUseCase')) {
  const dispatch = useAppDispatch()
  useScreenId('U20')
  const { data } = useAsyncData(() => inboxUseCase.list(sel), [inboxUseCase, sel])
  return {
    data,
    act: async (id: string, act: InboxAct, answer?: string) => {
      const msg = await inboxUseCase.act(id, act, answer)
      if (!msg) return
      dispatch(sessionActions.dataChanged())
      toast(msg)
    },
  }
}

/** 목업 notificationsPage(): U42 알림함 */
export function useNotificationsViewModel(shellUseCase: ShellUseCase = appContainer.resolve('shellUseCase')) {
  const dispatch = useAppDispatch()
  const navigate = useNavigate()
  useScreenId('U42')
  const { data } = useAsyncData(() => shellUseCase.getNotifications(), [shellUseCase])
  const changed = () => dispatch(sessionActions.dataChanged())
  return {
    data,
    markAll: async () => { await shellUseCase.markRead(); changed() },
    open: async (id: string, target: string) => { await shellUseCase.markRead(id); changed(); navigate(target.replace(/^#/, '')) },
    setPref: async (k: keyof NotificationPrefs, on: boolean) => { await shellUseCase.setPref(k, on); changed() },
  }
}
