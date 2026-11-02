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

  /** 목업 pend(): 작가가 처리할 피드백 수 */
  async getBadges() {
    const [notifications, inbox] = await Promise.all([this.notificationRepository.list(), this.feedbackRepository.listInbox()])
    return { unread: notifications.filter((n) => !n.read).length, pending: inbox.filter((i) => ['작가 검토 대기', '수정 진행 중', '발행 대기'].includes(i.status)).length }
  }

  async getNotifications() {
    const [list, prefs] = await Promise.all([this.notificationRepository.list(), this.notificationRepository.getPrefs()])
    return { list, prefs }
  }

  /** id가 없으면 모두 읽음 */
  async markRead(id?: string) {
    const list = await this.notificationRepository.list()
    await this.notificationRepository.save(list.map((n) => (!id || n.id === id ? { ...n, read: true } : n)))
  }

  async setPref(key: keyof NotificationPrefs, on: boolean) {
    await this.notificationRepository.savePrefs({ ...(await this.notificationRepository.getPrefs()), [key]: on })
  }
}
