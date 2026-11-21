package ai.storyfork.operations.jobs.repository

import ai.storyfork.operations.jobs.entity.JobRunEntity
import ai.storyfork.operations.jobs.entity.JobStatus
import ai.storyfork.operations.jobs.entity.ScheduledJobEntity
import java.time.Instant
import java.util.UUID
import org.springframework.data.domain.Page
import org.springframework.data.domain.Pageable
import org.springframework.data.jpa.repository.JpaRepository
import org.springframework.data.jpa.repository.Modifying
import org.springframework.data.jpa.repository.Query
import org.springframework.data.repository.query.Param
import org.springframework.transaction.annotation.Transactional

interface ScheduledJobRepository : JpaRepository<ScheduledJobEntity, UUID> {
    fun findAllByEnabledTrue(): List<ScheduledJobEntity>

    /** ponytail: a handful of schedules, so the list is unpaged; page it when there are dozens. */
    fun findAllByOrderByCreatedAtDescIdDesc(): List<ScheduledJobEntity>
}

interface JobRunRepository : JpaRepository<JobRunEntity, UUID> {
    fun findAllByStatusOrderByCreatedAtAscIdAsc(status: JobStatus): List<JobRunEntity>
    fun findAllByStatus(status: JobStatus, page: Pageable): Page<JobRunEntity>
    fun findAllByKind(kind: String, page: Pageable): Page<JobRunEntity>
    fun findAllByStatusAndKind(status: JobStatus, kind: String, page: Pageable): Page<JobRunEntity>
    fun existsByScheduleIdAndStatusIn(scheduleId: UUID, statuses: Collection<JobStatus>): Boolean

    /** The dashboard's job counts: runs queued or running, and runs that failed after a moment. */
    fun countByStatusIn(statuses: Collection<JobStatus>): Long
    fun countByStatusAndFinishedAtAfter(status: JobStatus, since: Instant): Long
    fun findFirstByScheduleIdOrderByCreatedAtDescIdDesc(scheduleId: UUID): JobRunEntity?
    fun existsByRetryOf(retryOf: UUID): Boolean

    /**
     * Takes a run for execution with one conditional update ([fromStatus] → [toStatus], stamping its start): 1 for the one caller that wins, 0 for every other
     * (the run has left [fromStatus] or does not exist). Workers racing for the same run therefore run it once, whatever the database isolation.
     */
    @Transactional
    @Modifying
    @Query("update JobRunEntity r set r.status = :toStatus, r.startedAt = :startedAt where r.id = :id and r.status = :fromStatus")
    fun claim(@Param("id") id: UUID, @Param("fromStatus") fromStatus: JobStatus, @Param("toStatus") toStatus: JobStatus, @Param("startedAt") startedAt: Instant): Int

    /**
     * Closes a run (status, reason, finish time) only while it is still in [fromStatus]: 1 when it was closed, 0 when it had already moved on (a worker took it, or its
     * result was recorded), so a close that comes late, after a read, never overwrites what happened in between.
     */
    @Transactional
    @Modifying
    @Query("update JobRunEntity r set r.status = :toStatus, r.error = :error, r.finishedAt = :finishedAt where r.id = :id and r.status = :fromStatus")
    fun close(
        @Param("id") id: UUID, @Param("fromStatus") fromStatus: JobStatus, @Param("toStatus") toStatus: JobStatus, @Param("error") error: String, @Param("finishedAt") finishedAt: Instant,
    ): Int
}
