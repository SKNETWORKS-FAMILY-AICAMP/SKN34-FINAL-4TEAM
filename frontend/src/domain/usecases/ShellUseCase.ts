import type { FeedbackRepository } from '../repositories/FeedbackRepository'
import type { NotificationPrefs, NotificationRepository } from '../repositories/NotificationRepository'

/** 모든 화면 상단 메뉴(GNB) 배지와 U42 알림함 */
export class ShellUseCase {
  private readonly notificationRepository: NotificationRepository
  private readonly feedbackRepository: FeedbackRepository
  constructor(notificationRepository: NotificationRepository, feedbackRepository: FeedbackRepository) {
    this.notificationRepository = notificationRepository
    this.feedbackRepository = feedbackRepository
  }

  /** 알림 수 조회가 실패해도(비로그인·일시 오류) 메뉴 전체가 깨지지 않게 0으로 둡니다. */
  async getBadges() {
    const [unread, inbox] = await Promise.all([this.notificationRepository.unreadCount().catch(() => 0), this.feedbackRepository.listInbox()])
    return { unread, pending: inbox.filter((i) => ['작가 검토 대기', '수정 진행 중', '발행 대기', '반영 실패'].includes(i.status)).length }
  }

  listNotifications(cursor?: string | null, signal?: AbortSignal) { return this.notificationRepository.list(cursor, signal) }
  getPrefs(signal?: AbortSignal) { return this.notificationRepository.getPrefs(signal) }
  markRead(id: string) { return this.notificationRepository.markRead(id) }
  markAllRead(upTo: string) { return this.notificationRepository.markAllRead(upTo) }
  removeNotification(id: string) { return this.notificationRepository.remove(id) }
  savePrefs(prefs: NotificationPrefs) { return this.notificationRepository.savePrefs(prefs) }
}
