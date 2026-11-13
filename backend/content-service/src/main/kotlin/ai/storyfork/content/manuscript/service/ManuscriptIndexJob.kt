package ai.storyfork.content.manuscript.service

import org.slf4j.LoggerFactory
import org.springframework.jdbc.core.simple.JdbcClient
import org.springframework.scheduling.annotation.Scheduled
import org.springframework.transaction.support.TransactionTemplate

internal class ManuscriptIndexJob(
    private val db: JdbcClient,
    private val transactions: TransactionTemplate,
    private val sync: ManuscriptIndexSync,
) {
    private val log = LoggerFactory.getLogger(ManuscriptIndexJob::class.java)

    @Scheduled(fixedDelayString = "\${MANUSCRIPT_INDEX_INTERVAL_MS:60000}", scheduler = "manuscriptIndexScheduler")
    fun reconcile() {
        try {
            transactions.executeWithoutResult {
                if (!db.sql("SELECT pg_try_advisory_xact_lock(1398031947, 56)").query(Boolean::class.javaObjectType).single()) return@executeWithoutResult
                // shortcut: 시연 규모에서는 전체 공개 판본과 청크 ID를 대조한다. 전체 스캔이 지연되면 변경 행 기반으로 전환한다.
                val manuscripts = db.sql(PUBLISHED_MANUSCRIPTS).query { row, _ ->
                    PublishedManuscript(row.getString("work_id"), row.getString("source_work_id"), row.getString("episode_id"),
                        row.getInt("sequence"), row.getString("content_version_id"), row.getString("content"))
                }.list()
                val changes = sync.reconcile(manuscripts)
                if (changes.added != 0 || changes.removed != 0) {
                    log.info("manuscript index reconciled: episodes={} added={} removed={}", manuscripts.size, changes.added, changes.removed)
                }
            }
        } catch (error: RuntimeException) {
            log.warn("manuscript index reconciliation failed; retrying next cycle: {}", error.javaClass.simpleName)
        }
    }
}

private const val PUBLISHED_MANUSCRIPTS = """
    SELECT e.work_id, f.source_work_id, e.id AS episode_id, e.sequence, v.content_version_id, v.content
    FROM episode_current e
    JOIN episode_version v ON v.id = e.published_version_id AND v.episode_id = e.id
    JOIN work_current wc ON wc.id = e.work_id
    JOIN work w ON w.id = e.work_id
    LEFT JOIN fork f ON f.work_id = w.id
    LEFT JOIN work source ON source.id = f.source_work_id
    WHERE wc.visibility_status = 'public' AND w.deleted_at IS NULL AND NOT w.restricted
      AND NOT (e.inherited AND source.deleted_at IS NOT NULL)
    ORDER BY e.work_id, e.sequence
"""
