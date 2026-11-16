package ai.storyfork.core.credit.service

import java.time.Duration
import java.time.Instant
import org.slf4j.LoggerFactory
import org.springframework.beans.factory.annotation.Value
import org.springframework.scheduling.annotation.Scheduled
import org.springframework.stereotype.Component

/**
 * 오래 닫히지 않은 크레딧 예약을 차감 없이 해제한다(F-CRD-03: 시간 초과는 차감 없음).
 * AI 작업이 비정상 종료돼 settle·release가 오지 않으면 예약이 RESERVED로 남아, 그 크레딧이 잔액에서 빠진 채 소멸도 되지 않는다.
 * [timeout]보다 오래된 RESERVED 예약을 해제하며, 해제된 예약은 정산할 수 없으므로 [timeout]은 AI 작업의 최대 실행 시간보다 길어야 한다.
 * 기본은 꺼져 있다(`app.credit.reservation-cleanup.enabled=false`). 첫 AI 호출자를 붙일 때 그 작업의 최대 실행 시간을 확인하고 켠다.
 * 회원 식별 정보와 작업 키는 로그에 남기지 않는다.
 */
@Component
class CreditReservationCleanupJob(
    private val reservations: CreditReservationService,
    @Value("\${app.credit.reservation-cleanup.enabled:false}") private val enabled: Boolean,
    @Value("\${app.credit.reservation-cleanup.timeout:PT1H}") private val timeout: Duration,
    @Value("\${app.credit.reservation-cleanup.batch-size:100}") private val batchSize: Int,
) {
    private val log = LoggerFactory.getLogger(CreditReservationCleanupJob::class.java)

    init {
        // 0이나 음수면 진행 중인 작업의 예약까지 모두 풀려 정산이 거절되므로 시작할 때 막는다.
        require(timeout > Duration.ZERO && batchSize > 0) { "예약 정리 timeout과 batch-size는 0보다 커야 합니다." }
    }

    @Scheduled(fixedDelayString = "\${app.credit.reservation-cleanup.poll-interval:PT10M}")
    fun poll() {
        if (!enabled) return
        try { runOnce(Instant.now()) } catch (e: RuntimeException) { log.warn("credit reservation cleanup failed: {}", e.javaClass.simpleName) }
    }

    /** [timeout]보다 오래된 예약을 최대 batchSize개 해제하고 해제한 건수를 반환한다. 한 건이 실패해도 나머지는 계속한다. */
    fun runOnce(now: Instant): Int {
        var released = 0
        for (stale in reservations.stale(now.minus(timeout), batchSize)) {
            try {
                // 해제는 예약을 잠근 뒤 상태를 다시 확인하므로, 그 사이 정산된 예약은 해제되지 않고 예외로 끝난다.
                reservations.release(stale.memberId, stale.operationKey, now)
                released += 1
            } catch (e: RuntimeException) {
                log.warn("credit reservation cleanup skipped: id={} error={}", stale.id, e.javaClass.simpleName)
            }
        }
        return released
    }
}
