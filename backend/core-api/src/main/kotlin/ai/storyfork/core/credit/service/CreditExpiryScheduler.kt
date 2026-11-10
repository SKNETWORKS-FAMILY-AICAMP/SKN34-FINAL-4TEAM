package ai.storyfork.core.credit.service

import org.springframework.scheduling.annotation.Scheduled
import org.springframework.stereotype.Component

/** 매일 00:00 KST에 소멸 시각이 지난 크레딧을 소멸로 기록한다. 매월 1일 00:00 월간 초기화 소멸도 이때 기록된다. */
@Component
class CreditExpiryScheduler(private val credits: CreditService) {
    @Scheduled(cron = "0 0 0 * * *", zone = "Asia/Seoul")
    fun expireDue() {
        credits.expireDue()
    }
}
