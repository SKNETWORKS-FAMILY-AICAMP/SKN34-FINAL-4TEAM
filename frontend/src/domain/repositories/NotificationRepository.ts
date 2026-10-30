import type { AppNotification } from '../entities/notification'

export interface NotificationRepository {
  list(): Promise<AppNotification[]>
}
