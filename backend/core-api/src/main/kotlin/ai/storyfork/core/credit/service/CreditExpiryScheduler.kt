package ai.storyfork.core.credit.service

import org.springframework.beans.factory.annotation.Value
import org.springframework.scheduling.annotation.Scheduled
import org.springframework.stereotype.Component

/**
 * 매일 00:00 KST에 소멸 시각이 지난 크레딧을 소멸로 기록한다. 매월 1일 00:00 월간 초기화 소멸도 이때 기록된다.
 * 매일 00:10 KST에는 곧 소멸되는 크레딧의 알림 사건을 기록한다(`app.credit.expiry-notice.enabled`, 기본 켜짐).
 */
@Component
class CreditExpiryScheduler(
    private val credits: CreditService,
    private val expiryNotices: CreditExpiryNoticeService,
    @Value("\${app.credit.expiry-notice.enabled:true}") private val noticeEnabled: Boolean,
) {
    @Scheduled(cron = "0 0 0 * * *", zone = "Asia/Seoul")
    fun expireDue() {
        credits.expireDue()
    }

    @Scheduled(cron = "0 10 0 * * *", zone = "Asia/Seoul")
    fun notifyExpiring() {
        if (noticeEnabled) expiryNotices.notifyExpiring()
    }
}
