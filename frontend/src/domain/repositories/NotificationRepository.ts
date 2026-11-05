import type { AppNotification } from '../entities/notification'

/** 목업 S.notificationPrefs: 끌 수 있는 알림 종류 */
export type NotificationPrefs = { read: boolean; creator: boolean }

export interface NotificationRepository {
  list(): Promise<AppNotification[]>
  save(list: AppNotification[]): Promise<void>
  getPrefs(): Promise<NotificationPrefs>
  savePrefs(prefs: NotificationPrefs): Promise<void>
}
