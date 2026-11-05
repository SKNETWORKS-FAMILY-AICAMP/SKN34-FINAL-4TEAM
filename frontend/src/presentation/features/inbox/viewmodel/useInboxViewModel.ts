import { useCallback, useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router'

import { appContainer } from '../../../../app/appContainer'
import { useAppDispatch, useAppSelector } from '../../../../app/store'
import { type AppNotification, type NotificationPage, noticeTarget } from '../../../../domain/entities/notification'
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

/** U42 알림함: 인증된 Core 알림 API의 목록(커서 추가 조회)·읽음·삭제·수신 설정 */
export function useNotificationsViewModel(shellUseCase: ShellUseCase = appContainer.resolve('shellUseCase')) {
  const dispatch = useAppDispatch()
  const navigate = useNavigate()
  useScreenId('U42')
  const [state, setState] = useState<NotificationsState>({ status: 'loading', items: [], nextCursor: null, prefs: null, loadingMore: false, saving: false })
  const alive = useRef(0)
  const changed = () => dispatch(sessionActions.dataChanged())

  const load = useCallback(() => {
    const id = ++alive.current
    setState((s) => ({ ...s, status: 'loading' }))
    Promise.all([shellUseCase.listNotifications(), shellUseCase.getPrefs()]).then(
      ([page, prefs]) => { if (alive.current === id) setState({ status: 'ready', items: page.items, nextCursor: page.nextCursor, prefs, loadingMore: false, saving: false }) },
      () => { if (alive.current === id) setState((s) => ({ ...s, status: 'error' })) },
    )
  }, [shellUseCase])
  useEffect(() => { load(); return () => { alive.current += 1 } }, [load])

  /** SSE 변경 신호: 화면을 비우지 않고 첫 페이지만 다시 받아 합칩니다. 실패하면 조용히 두고 다음 신호·재시도에 맡깁니다. */
  const { noticeVersion, noticeStream } = useAppSelector((s) => s.session)
  const seenVersion = useRef(noticeVersion)
  useEffect(() => {
    if (seenVersion.current === noticeVersion) return
    seenVersion.current = noticeVersion
    const id = alive.current
    shellUseCase.listNotifications().then(
      (page) => { if (alive.current === id) setState((s) => (s.status === 'ready' ? mergeFirstPage(s, page) : s)) },
      () => {},
    )
  }, [noticeVersion, shellUseCase])

  const run = async (action: () => Promise<void>, failure: string) => {
    try { await action(); return true } catch { toast(failure); return false }
  }
  return {
    ...state,
    unread: state.items.filter((n) => !n.read).length,
    live: noticeStream,
    retry: load,
    loadMore: async () => {
      if (!state.nextCursor || state.loadingMore) return
      const id = alive.current
      setState((s) => ({ ...s, loadingMore: true }))
      try {
        const page = await shellUseCase.listNotifications(state.nextCursor)
        if (alive.current === id) setState((s) => ({ ...s, items: [...s.items, ...page.items.filter((n) => !s.items.some((o) => o.id === n.id))], nextCursor: page.nextCursor, loadingMore: false }))
      } catch { if (alive.current === id) { setState((s) => ({ ...s, loadingMore: false })); toast('알림을 더 불러오지 못했어요. 다시 시도해 주세요.') } }
    },
    /** 화면에 보이는 가장 최신 알림 시각까지만 읽음 처리해, 그 뒤 도착한 알림은 미읽음으로 남깁니다. */
    markAll: async () => {
      const upTo = state.items.reduce((m, n) => (n.createdAt > m ? n.createdAt : m), '')
      if (!upTo) return
      if (!await run(() => shellUseCase.markAllRead(upTo), '모두 읽음 처리하지 못했어요. 다시 시도해 주세요.')) return
      setState((s) => ({ ...s, items: s.items.map((n) => (n.createdAt <= upTo ? { ...n, read: true } : n)) }))
      changed()
    },
    open: async (n: AppNotification) => {
      if (!n.read) {
        if (!await run(() => shellUseCase.markRead(n.id), '읽음 처리하지 못했어요. 다시 시도해 주세요.')) return
        setState((s) => ({ ...s, items: s.items.map((o) => (o.id === n.id ? { ...o, read: true } : o)) }))
        changed()
      }
      const target = noticeTarget(n)
      if (target) navigate(target)
    },
    remove: async (n: AppNotification) => {
      if (!await run(() => shellUseCase.removeNotification(n.id), '알림을 삭제하지 못했어요. 다시 시도해 주세요.')) return
      setState((s) => ({ ...s, items: s.items.filter((o) => o.id !== n.id) }))
      changed()
    },
    setPref: async (k: keyof NotificationPrefs, on: boolean) => {
      if (!state.prefs || state.saving) return
      setState((s) => ({ ...s, saving: true }))
      try {
        const prefs = await shellUseCase.savePrefs({ ...state.prefs, [k]: on })
        setState((s) => ({ ...s, prefs, saving: false }))
      } catch { setState((s) => ({ ...s, saving: false })); toast('알림 설정을 저장하지 못했어요. 다시 시도해 주세요.') }
    },
  }
}

type NotificationsState = {
  status: 'loading' | 'ready' | 'error'
  items: AppNotification[]
  nextCursor: string | null
  prefs: NotificationPrefs | null
  loadingMore: boolean
  saving: boolean
}

/** 새로 받은 첫 페이지로 앞부분을 갱신하고(다른 곳에서 삭제·읽음 반영), 이미 불러온 더 오래된 알림은 유지합니다. */
function mergeFirstPage(s: NotificationsState, page: NotificationPage): NotificationsState {
  if (!page.nextCursor) return { ...s, items: page.items, nextCursor: null }
  const oldest = page.items[page.items.length - 1]?.createdAt ?? ''
  const older = s.items.filter((o) => o.createdAt <= oldest && !page.items.some((p) => p.id === o.id))
  return { ...s, items: [...page.items, ...older], nextCursor: older.length ? s.nextCursor : page.nextCursor }
}
