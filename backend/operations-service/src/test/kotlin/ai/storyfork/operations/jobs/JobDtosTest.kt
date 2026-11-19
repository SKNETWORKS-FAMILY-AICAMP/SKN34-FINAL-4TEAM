package ai.storyfork.operations.jobs

import ai.storyfork.operations.jobs.entity.JobRunEntity
import ai.storyfork.operations.jobs.entity.JobStatus
import ai.storyfork.operations.jobs.entity.JobTrigger
import ai.storyfork.operations.jobs.entity.ScheduledJobEntity
import ai.storyfork.operations.jobs.repository.JobRunRepository
import ai.storyfork.operations.jobs.repository.ScheduledJobRepository
import ai.storyfork.operations.jobs.service.dto.ContentPreprocessingJob
import ai.storyfork.operations.jobs.service.dto.ContentPreprocessingJobList
import ai.storyfork.operations.jobs.service.dto.JobPage
import ai.storyfork.operations.jobs.service.dto.JobProgress
import ai.storyfork.operations.jobs.service.dto.JobRun
import ai.storyfork.operations.jobs.service.dto.ScheduleRequest
import ai.storyfork.operations.jobs.service.dto.toRun
import java.time.Instant
import java.util.UUID
import org.junit.jupiter.api.Assertions.*
import org.junit.jupiter.api.Test
import org.springframework.data.repository.query.parser.PartTree
import tools.jackson.databind.DeserializationFeature
import tools.jackson.module.kotlin.jacksonMapperBuilder
import tools.jackson.module.kotlin.readValue

/** Mapping, JSON shape and derived query names without Spring, HTTP or a database. */
class JobDtosTest {
    // Spring Boot's mapper ignores unknown properties, and so does the Content client, so a field Content adds later must not break the list.
    private val mapper = jacksonMapperBuilder().disable(DeserializationFeature.FAIL_ON_UNKNOWN_PROPERTIES).build()
    private val t = Instant.parse("2026-03-10T01:02:03Z")

    private fun job(status: String, failed: List<Int> = emptyList(), startedAt: Instant? = t, finishedAt: Instant? = null) =
        ContentPreprocessingJob("job-1", "work-1", status, 3, 10, failed, startedAt, finishedAt)

    @Test
    fun `a Content job becomes a user started preprocessing run with progress and the work as target`() {
        val run = job("running").toRun()

        assertEquals("job-1", run.id)
        assertEquals("preprocessing", run.kind)
        assertEquals("content-preprocessing", run.source)
        assertEquals("running", run.status)
        assertEquals("user", run.trigger)
        assertEquals(JobProgress(3, 10), run.progress)
        assertEquals(t, run.startedAt)
        assertNull(run.finishedAt)
        assertNull(run.error)
        assertEquals("work-1", run.targetId)
    }

    @Test
    fun `Content statuses map to the run vocabulary and an unknown one is passed through`() {
        assertEquals(
            listOf("queued", "running", "running", "succeeded", "failed", "paused"),
            listOf("queued", "running", "loading", "completed", "failed", "paused").map { job(it).toRun().status },
        )
    }

    @Test
    fun `a failed Content job reports a fixed message with the failed episode count and no episode list`() {
        assertEquals("전처리에 실패한 회차가 2개 있어요.", job("failed", failed = listOf(2, 5), finishedAt = t).toRun().error)
        assertEquals("전처리에 실패했어요.", job("failed").toRun().error)
        assertNull(job("completed", failed = listOf(2)).toRun().error)
    }

    @Test
    fun `an own run keeps its lowercase status and trigger, progress only when both counts exist`() {
        val schedule = UUID.randomUUID()
        val finished = JobRunEntity(scheduleId = schedule, kind = "alpha", trigger = JobTrigger.MANUAL, status = JobStatus.SUCCEEDED,
            createdAt = t, startedAt = t, finishedAt = t.plusSeconds(4), done = 3, total = 5, targetId = "target-1")
        val bare = JobRunEntity(scheduleId = schedule, kind = "alpha", trigger = JobTrigger.SCHEDULE, createdAt = t)

        assertEquals(JobRun(finished.id.toString(), "alpha", "operations-scheduler", "succeeded", "manual", JobProgress(3, 5), t, t.plusSeconds(4), null, "target-1"), finished.toRun())
        assertEquals(JobRun(bare.id.toString(), "alpha", "operations-scheduler", "queued", "schedule", null, null, null, null, null), bare.toRun())
    }

    @Test
    fun `an own run with only one of the two counts has no progress instead of a half filled one`() {
        val half = JobRunEntity(scheduleId = UUID.randomUUID(), kind = "alpha", trigger = JobTrigger.SCHEDULE, createdAt = t, done = 2)

        assertNull(half.toRun().progress)
    }

    @Test
    fun `a run leaves out the optional fields it does not have`() {
        val tree = mapper.readTree(mapper.writeValueAsString(JobRunEntity(scheduleId = UUID.randomUUID(), kind = "alpha", trigger = JobTrigger.SCHEDULE, createdAt = t).toRun()))

        assertEquals(setOf("id", "kind", "source", "status", "trigger"), tree.propertyNames().toSet())
    }

    @Test
    fun `a list page always carries unavailable even when empty`() {
        val tree = mapper.readTree(mapper.writeValueAsString(JobPage(listOf("a"), 0, 20, 1L)))

        assertEquals(setOf("items", "page", "size", "total", "unavailable"), tree.propertyNames().toSet())
        assertTrue(tree.path("unavailable").isArray)
    }

    @Test
    fun `the Content list parses the contract shape, ignoring fields it does not use`() {
        val body = """{"items":[{"id":"job-1","workId":"work-1","status":"loading","done":3,"total":10,"failedEpisodes":[4,9],
            "startedAt":"2026-03-10T01:02:03Z","finishedAt":null,"memberId":"ignored"},
            {"id":"job-2","workId":"work-2","status":"queued","done":0,"total":0,"failedEpisodes":[],"startedAt":null,"finishedAt":null}],"total":2}"""

        val list = mapper.readValue<ContentPreprocessingJobList>(body)

        assertEquals(listOf(4, 9), list.items[0].failedEpisodes)
        assertEquals(t, list.items[0].startedAt)
        assertNull(list.items[0].finishedAt)
        assertNull(list.items[1].startedAt)
    }

    @Test
    fun `a schedule request defaults to enabled with empty params`() {
        val request = mapper.readValue<ScheduleRequest>("""{"kind":"alpha","cron":"0 0 3 * * *"}""")

        assertEquals(ScheduleRequest("alpha", "0 0 3 * * *", true, emptyMap()), request)
        assertEquals(mapOf("limit" to 3, "dataset" to "d1"), mapper.readValue<ScheduleRequest>("""{"kind":"a","cron":"c","params":{"limit":3,"dataset":"d1"}}""").params)
    }

    @Test
    fun `the repository query names resolve against their entities`() {
        // Static check without a database: a typo in a derived query name would otherwise break every CI integration test.
        for (method in JobRunRepository::class.java.declaredMethods) PartTree(method.name, JobRunEntity::class.java)
        for (method in ScheduledJobRepository::class.java.declaredMethods) PartTree(method.name, ScheduledJobEntity::class.java)
    }
}
