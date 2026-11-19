package ai.storyfork.content.preprocessing

import ai.storyfork.content._common.exception.ContentFailure
import ai.storyfork.content.preprocessing.domain.PreprocessingStatus.COMPLETED
import ai.storyfork.content.preprocessing.domain.PreprocessingStatus.FAILED
import ai.storyfork.content.preprocessing.domain.PreprocessingStatus.LOADING
import ai.storyfork.content.preprocessing.domain.PreprocessingStatus.QUEUED
import ai.storyfork.content.preprocessing.domain.PreprocessingStatus.RUNNING
import ai.storyfork.content.preprocessing.entity.PreprocessingJobEntity
import java.time.Instant
import org.junit.jupiter.api.Assertions.*
import org.junit.jupiter.api.Test

/** 전처리 작업 한 건의 상태 전이 규칙(#343, DEC-50 실행 계약)이다. DB·Spring 없이 엔티티 메서드만 검증한다. */
class PreprocessingJobTest {
    private val t0 = Instant.parse("2026-11-19T00:00:00Z")
    private val t1 = t0.plusSeconds(60)
    private fun job(status: String = QUEUED) = PreprocessingJobEntity(id = "job", workId = "work", memberId = "owner", status = status, total = 3)
    private fun rejected(block: () -> Unit) = assertThrows(ContentFailure::class.java, block)

    @Test fun `extracting resolving and organizing are running and loading is loading`() {
        mapOf("extracting" to RUNNING, "resolving" to RUNNING, "organizing" to RUNNING, "loading" to LOADING).forEach { (stage, status) ->
            val job = job()
            job.report(stage, 1, 3, emptyList(), null, t0)
            assertEquals(status, job.status, stage)
        }
    }

    @Test fun `the first report starts the job once and a later report keeps the start time`() {
        val job = job()
        assertNull(job.startedAt)
        job.report("extracting", 0, 3, emptyList(), null, t0)
        job.report("extracting", 2, 3, emptyList(), null, t1)
        assertEquals(listOf<Any?>(t0, null, 2, 3), listOf(job.startedAt, job.finishedAt, job.done, job.total))
    }

    @Test fun `a failed report ends the job with the reported reason and the failed episodes`() {
        val job = job()
        job.report("extracting", 1, 3, listOf(2, 3), "회차 추출에 실패했어요.", t1)
        assertEquals(listOf<Any?>(FAILED, "회차 추출에 실패했어요.", t1, listOf(2, 3), 1), listOf(job.status, job.failedReason, job.finishedAt, job.failedEpisodes, job.done))
    }

    @Test fun `a finished job rejects every further report with 409 and stays as it was`() {
        for (status in listOf(COMPLETED, FAILED)) {
            val job = job(status)
            assertEquals(409, rejected { job.report("extracting", 1, 3, emptyList(), null, t0) }.status, status)
            assertEquals(listOf<Any?>(status, 0), listOf(job.status, job.done))
        }
    }

    @Test fun `malformed reports are 422 and change nothing`() {
        class Bad(val name: String, val stage: String = "extracting", val done: Int = 1, val total: Int = 3, val failedEpisodes: List<Int> = emptyList(), val failed: String? = null)
        val cases = listOf(
            Bad("unknown stage", stage = "done"), Bad("negative done", done = -1), Bad("done above total", done = 4), Bad("negative total", total = -1),
            Bad("episode number below 1", failedEpisodes = listOf(0)), Bad("duplicate failed episode", failedEpisodes = listOf(2, 2)),
            Bad("more failed episodes than total", failedEpisodes = listOf(1, 2, 3, 4)),
            Bad("blank failure reason", failed = " "), Bad("too long failure reason", failed = "가".repeat(201)),
        )
        for (case in cases) {
            val job = job()
            assertEquals(422, rejected { job.report(case.stage, case.done, case.total, case.failedEpisodes, case.failed, t0) }.status, case.name)
            assertEquals(listOf<Any?>(QUEUED, 0, 3, null), listOf(job.status, job.done, job.total, job.startedAt), case.name)
        }
    }

    @Test fun `requeue brings only a failed job back to the queue without its end state`() {
        val job = job(FAILED).apply { failedReason = "AI"; startedAt = t0; finishedAt = t1; failedEpisodes = listOf(2); done = 1 }
        job.requeue()
        assertEquals(listOf<Any?>(QUEUED, null, null, null, 1, listOf(2)), listOf(job.status, job.failedReason, job.startedAt, job.finishedAt, job.done, job.failedEpisodes))
        for (status in listOf(QUEUED, RUNNING, LOADING, COMPLETED)) assertEquals(409, rejected { job(status).requeue() }.status, status)
    }

    @Test fun `fail records the fixed reason and the end time`() {
        val job = job(RUNNING)
        job.fail("고정 사유", t1)
        assertEquals(listOf<Any?>(FAILED, "고정 사유", t1), listOf(job.status, job.failedReason, job.finishedAt))
    }
}
