import type { AppNotification, NotificationPage } from '../entities/notification'

/** 회원이 끌 수 있는 알림 종류(읽기·작가 소식). 나머지 분류는 항상 켜져 있습니다. */
export type NotificationPrefs = { read: boolean; creator: boolean }

export interface NotificationRepository {
  /** 최신순 한 페이지. cursor는 직전 응답의 nextCursor입니다. */
  list(cursor?: string | null, signal?: AbortSignal): Promise<NotificationPage>
  unreadCount(signal?: AbortSignal): Promise<number>
  markRead(id: string): Promise<void>
  /** upTo(ISO) 이전에 도착한 알림만 읽음으로 바꿉니다. 그 뒤 도착분은 미읽음으로 남습니다. */
  markAllRead(upTo: string): Promise<void>
  remove(id: string): Promise<void>
  getPrefs(signal?: AbortSignal): Promise<NotificationPrefs>
  savePrefs(prefs: NotificationPrefs): Promise<NotificationPrefs>
}

export type { AppNotification }
