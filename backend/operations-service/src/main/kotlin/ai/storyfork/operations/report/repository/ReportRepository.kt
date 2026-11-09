package ai.storyfork.operations.report.repository

import ai.storyfork.operations.report.entity.ReportEntity
import ai.storyfork.operations.report.entity.ReportHistoryEntity
import ai.storyfork.operations.report.entity.ReportHistoryType
import ai.storyfork.operations.report.entity.ReportStatus
import java.util.UUID
import org.springframework.data.jpa.repository.JpaRepository

interface ReportRepository : JpaRepository<ReportEntity, UUID> {
    fun findTop200ByOrderByCreatedAtDescIdDesc(): List<ReportEntity>
    fun findTop200ByStatusOrderByCreatedAtDescIdDesc(status: ReportStatus): List<ReportEntity>
    fun findTop200ByReporterIdOrWorkOwnerIdOrderByCreatedAtDescIdDesc(reporterId: UUID, workOwnerId: UUID): List<ReportEntity>
}

interface ReportHistoryRepository : JpaRepository<ReportHistoryEntity, UUID> {
    fun findAllByReportIdOrderByCreatedAtAscIdAsc(reportId: UUID): List<ReportHistoryEntity>
    fun findAllByReportIdAndTypeOrderByCreatedAtAscIdAsc(reportId: UUID, type: ReportHistoryType): List<ReportHistoryEntity>
}
