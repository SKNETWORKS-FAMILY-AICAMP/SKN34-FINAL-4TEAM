import { useCallback, useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router'

import { appContainer } from '../../../../app/appContainer'
import { useAppDispatch, useAppSelector } from '../../../../app/store'
import { type AppNotification, noticeTarget } from '../../../../domain/entities/notification'
import type { NotificationPrefs } from '../../../../domain/repositories/NotificationRepository'
import type { InboxAct, InboxUseCase } from '../../../../domain/usecases/InboxUseCase'
import type { ShellUseCase } from '../../../../domain/usecases/ShellUseCase'
import { toast } from '../../../shared/events'
import { useScreenId } from '../../../shared/screenIds'
import { sessionActions } from '../../../shared/session/sessionSlice'
import { useAsyncData } from '../../../shared/useAsyncData'
import { applyNotificationRefresh, completeMarkAllRead, readNotificationsThrough, type NotificationListState } from './notificationListState'

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
  const [state, setState] = useState<NotificationsState>({ status: 'loading', items: [], nextCursor: null, prefs: null, loadingMore: false, saving: false, appliedRefreshSeq: 0, readUpTo: null })
  const alive = useRef(0)
  const controller = useRef<AbortController | null>(null)
  /** SSE 요청 순번. 응답 적용 여부는 state의 마지막 성공 순번으로 판단합니다. */
  const refreshSeq = useRef(0)
  const changed = () => dispatch(sessionActions.dataChanged())

  const load = useCallback(() => {
    const id = ++alive.current
    controller.current?.abort()
    const request = new AbortController()
    controller.current = request
    setState((s) => ({ ...s, status: 'loading' }))
    Promise.all([shellUseCase.listNotifications(null, request.signal), shellUseCase.getPrefs(request.signal)]).then(
      ([page, prefs]) => { if (alive.current === id) setState({ status: 'ready', items: page.items, nextCursor: page.nextCursor, prefs, loadingMore: false, saving: false, appliedRefreshSeq: 0, readUpTo: null }) },
      () => { if (alive.current === id) setState((s) => ({ ...s, status: 'error' })) },
    )
  }, [shellUseCase])
  useEffect(() => { load(); return () => { alive.current += 1; controller.current?.abort() } }, [load])

  /** SSE 변경 신호: 화면을 비우지 않고 첫 페이지만 다시 받아 합칩니다. 실패하면 조용히 두고 다음 신호·재시도에 맡깁니다. */
  const { noticeVersion, noticeStream } = useAppSelector((s) => s.session)
  const seenVersion = useRef(noticeVersion)
  useEffect(() => {
    if (seenVersion.current === noticeVersion) return
    seenVersion.current = noticeVersion
    const id = alive.current
    const seq = ++refreshSeq.current
    shellUseCase.listNotifications(null, controller.current?.signal).then(
      (page) => { if (alive.current === id) setState((s) => (s.status === 'ready' ? { ...s, ...applyNotificationRefresh(s, page, seq) } : s)) },
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
      const cursor = state.nextCursor
      if (!cursor || state.loadingMore) return
      const id = alive.current
      setState((s) => ({ ...s, loadingMore: true }))
      try {
        const page = await shellUseCase.listNotifications(cursor, controller.current?.signal)
        // SSE로 목록 기준(cursor)이 바뀌었으면 이전 기준의 응답은 버립니다. 이어 붙이면 사이 알림을 영영 놓칩니다.
        if (alive.current === id) setState((s) => (s.nextCursor !== cursor ? { ...s, loadingMore: false } : { ...s, items: [...s.items, ...readNotificationsThrough(page.items, s.readUpTo).filter((n) => !s.items.some((o) => o.id === n.id))], nextCursor: page.nextCursor, loadingMore: false }))
      } catch { if (alive.current === id) { setState((s) => ({ ...s, loadingMore: false })); toast('알림을 더 불러오지 못했어요. 다시 시도해 주세요.') } }
    },
    /**
     * 서버 최신 알림의 시각 문자열을 그대로 upTo로 보내고 성공한 경계를 유지합니다.
     * 대기 중·성공 뒤 도착한 항목도 createdAt <= upTo이면 읽음이며, 경계 뒤의 새 알림은 미읽음입니다.
     */
    markAll: async () => {
      const upTo = state.items[0]?.createdAt
      if (!upTo) return
      const id = alive.current
      if (!await run(() => shellUseCase.markAllRead(upTo), '모두 읽음 처리하지 못했어요. 다시 시도해 주세요.') || alive.current !== id) return
      setState((s) => ({ ...s, ...completeMarkAllRead(s, upTo) }))
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

type NotificationsState = NotificationListState & {
  status: 'loading' | 'ready' | 'error'
  prefs: NotificationPrefs | null
  loadingMore: boolean
  saving: boolean
}
