package ai.storyfork.operations.jobs.service.dto

import ai.storyfork.operations.jobs.entity.JobRunEntity
import ai.storyfork.operations.jobs.entity.ScheduledJobEntity
import com.fasterxml.jackson.annotation.JsonInclude
import java.time.Instant
import java.util.UUID

/** [JobRun.kind] and [JobRun.source] of the runs read from Content; [CONTENT_PREPROCESSING] is also the name shown in a list's unavailable sources. */
const val PREPROCESSING_KIND = "preprocessing"
const val CONTENT_PREPROCESSING = "content-preprocessing"

data class JobProgress(val done: Int, val total: Int)

/** Run record, the same for every source. Absent optional fields are left out of the JSON (the contract's ?). */
@JsonInclude(JsonInclude.Include.NON_NULL)
data class JobRun(
    val id: String,
    val kind: String,
    val source: String,
    val status: String,
    val trigger: String,
    val progress: JobProgress?,
    val startedAt: Instant?,
    val finishedAt: Instant?,
    val error: String?,
    val targetId: String?,
)

@JsonInclude(JsonInclude.Include.NON_NULL)
data class Schedule(
    val id: UUID,
    val kind: String,
    val cron: String,
    val enabled: Boolean,
    val params: Map<String, Any?>,
    val createdAt: Instant,
    val updatedAt: Instant,
    val lastRun: JobRun?,
)

/** A list answer; [unavailable] names the sources whose rows are missing because they could not be read. */
data class JobPage<T>(val items: List<T>, val page: Int, val size: Int, val total: Long, val unavailable: List<String> = emptyList())

/** Create and full-replace body of a schedule. [kind] cannot change on update. */
data class ScheduleRequest(val kind: String, val cron: String, val enabled: Boolean = true, val params: Map<String, Any?> = emptyMap())

/** Content's preprocessing job (DEC-50). Content computes every value; only the status is mapped to the run vocabulary. */
data class ContentPreprocessingJob(
    val id: String,
    val workId: String,
    val status: String,
    val done: Int = 0,
    val total: Int = 0,
    val failedEpisodes: List<Int> = emptyList(),
    val startedAt: Instant? = null,
    val finishedAt: Instant? = null,
)

data class ContentPreprocessingJobList(val items: List<ContentPreprocessingJob>)

/** Progress exists only when both counts do. */
fun JobRunEntity.toRun() = JobRun(
    id.toString(), kind, source, status.name.lowercase(), trigger.name.lowercase(),
    done?.let { finished -> total?.let { all -> JobProgress(finished, all) } }, startedAt, finishedAt, error, targetId,
)

/** The author started it, so the trigger is user; loading (cards being stored) is still running for the admin. */
fun ContentPreprocessingJob.toRun() = JobRun(
    id, PREPROCESSING_KIND, CONTENT_PREPROCESSING,
    when (status) { "running", "loading" -> "running"; "completed" -> "succeeded"; else -> status },
    "user", JobProgress(done, total), startedAt, finishedAt,
    // A fixed message with the count: the failed episode numbers stay with Content (a long work can have hundreds).
    if (status != "failed") null else if (failedEpisodes.isEmpty()) "전처리에 실패했어요." else "전처리에 실패한 회차가 ${failedEpisodes.size}개 있어요.",
    workId,
)

fun ScheduledJobEntity.toSchedule(lastRun: JobRun?) = Schedule(id, kind, cron, enabled, params, createdAt, updatedAt, lastRun)
