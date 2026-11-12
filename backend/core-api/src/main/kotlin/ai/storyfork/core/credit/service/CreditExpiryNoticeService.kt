package ai.storyfork.core.credit.service

import ai.storyfork.core.credit.repository.CreditGrantRepository
import ai.storyfork.core.notification.domain.NoticeEventType
import ai.storyfork.core.notification.service.NoticeOutboxService
import java.time.Duration
import java.time.Instant
import java.time.LocalDate
import java.time.ZoneId
import java.util.UUID
import org.springframework.beans.factory.annotation.Value
import org.springframework.stereotype.Service
import org.springframework.transaction.annotation.Transactional

/**
 * 크레딧 소멸 예정 알림(UC-17·UC-27, 크레딧 분류라 끌 수 없음). [leadTime] 안에 소멸하는 크레딧이 남은 회원에게
 * 소멸 날짜(KST)마다 알림 사건을 한 번 기록한다. 사건 id를 회원·날짜로 정해 두어 여러 번 실행해도 알림은 한 번만 생긴다.
 * 며칠 전에 알릴지는 정책이 정해지지 않아 설정값(기본 3일)으로 둔다.
 */
@Service
class CreditExpiryNoticeService(
    private val grants: CreditGrantRepository,
    private val notices: NoticeOutboxService,
    @param:Value("\${app.credit.expiry-notice.lead-time:P3D}") private val leadTime: Duration,
) {
    init {
        require(leadTime > Duration.ZERO) { "소멸 예정 알림 기간은 0보다 커야 합니다." }
    }

    /** 새로 기록한 알림 사건 수를 반환한다. */
    @Transactional
    fun notifyExpiring(now: Instant = Instant.now()): Int {
        var recorded = 0
        val targets = grants.findExpiring(now, now.plus(leadTime)).map { it.memberId to it.expiresAt.atZone(KST).toLocalDate() }.distinct()
        for ((memberId, date) in targets) {
            if (notices.enqueueOnce(NoticeEventType.CREDIT_EXPIRING, memberId, date.toString(), eventId(memberId, date))) recorded += 1
        }
        return recorded
    }

    companion object {
        private val KST: ZoneId = ZoneId.of("Asia/Seoul")

        /** 같은 회원·소멸 날짜면 늘 같은 사건 id. */
        fun eventId(memberId: UUID, date: LocalDate): UUID = UUID.nameUUIDFromBytes("core.credit.expiring:$memberId:$date".toByteArray())
    }
}
