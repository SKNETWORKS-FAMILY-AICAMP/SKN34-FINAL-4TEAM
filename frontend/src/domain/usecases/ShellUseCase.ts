import type { NotificationRepository } from '../repositories/NotificationRepository'

/** 모든 화면 상단 메뉴(GNB)가 쓰는 배지 숫자 */
export class ShellUseCase {
  private readonly notificationRepository: NotificationRepository
  constructor(notificationRepository: NotificationRepository) { this.notificationRepository = notificationRepository }

  async getBadges() {
    const notifications = await this.notificationRepository.list()
    // ponytail: 독자 제보 처리 대기 수(pending)는 피드백함 저장소가 생기는 Task 9에서 채운다.
    return { unread: notifications.filter((n) => !n.read).length, pending: 0 }
  }
}
