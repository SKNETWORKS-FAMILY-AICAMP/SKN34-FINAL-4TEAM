package ai.storyfork.operations.alert.service

import ai.storyfork.operations.alert.entity.AlertStatus
import ai.storyfork.operations.alert.repository.OperationAlertRepository
import java.time.Instant
import java.time.temporal.ChronoUnit
import org.springframework.stereotype.Service

private const val RETENTION_DAYS = 90L

/** Scheduled by the jobs piece (alert_cleanup); this is only the work of one run. */
@Service
class AlertCleanupService(private val alerts: OperationAlertRepository) {
    /** Deletes alerts resolved more than 90 days ago (F-ALT-02 retention) and returns how many. */
    fun run(now: Instant = Instant.now()): Long =
        alerts.deleteByStatusAndActedAtBefore(AlertStatus.RESOLVED, now.minus(RETENTION_DAYS, ChronoUnit.DAYS))
}
