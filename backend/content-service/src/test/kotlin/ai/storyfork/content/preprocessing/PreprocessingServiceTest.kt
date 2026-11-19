package ai.storyfork.content.preprocessing

import ai.storyfork.content._common.exception.ContentFailure
import ai.storyfork.content.episode.repository.EpisodeRepository
import ai.storyfork.content.preprocessing.client.PreprocessingAiClient
import ai.storyfork.content.preprocessing.client.PreprocessingAiFailure
import ai.storyfork.content.preprocessing.client.dto.PreprocessingAiRequest
import ai.storyfork.content.preprocessing.domain.PreprocessingStatus.COMPLETED
import ai.storyfork.content.preprocessing.domain.PreprocessingStatus.FAILED
import ai.storyfork.content.preprocessing.domain.PreprocessingStatus.LOADING
import ai.storyfork.content.preprocessing.domain.PreprocessingStatus.QUEUED
import ai.storyfork.content.preprocessing.domain.PreprocessingStatus.RUNNING
import ai.storyfork.content.preprocessing.entity.PreprocessingJobEntity
import ai.storyfork.content.preprocessing.repository.PreprocessingJobRepository
import ai.storyfork.content.preprocessing.service.PreprocessingService
import ai.storyfork.content.preprocessing.service.dto.PreprocessingJobResponse
import ai.storyfork.content.preprocessing.service.dto.PreprocessingProgressRequest
import ai.storyfork.content.work.entity.WorkEntity
import ai.storyfork.content.work.repository.WorkRepository
import java.time.Instant
import java.util.Optional
import java.util.UUID
import org.junit.jupiter.api.Assertions.*
import org.junit.jupiter.api.BeforeEach
import org.junit.jupiter.api.Test
import org.mockito.Mockito.*
import org.springframework.dao.DataIntegrityViolationException
import org.springframework.data.domain.PageImpl
import org.springframework.data.domain.PageRequest
import org.springframework.data.domain.Sort
import org.springframework.transaction.PlatformTransactionManager
import org.springframework.transaction.support.SimpleTransactionStatus
import org.springframework.transaction.support.TransactionTemplate

/** 전처리 작업 접수·진행·재실행(#343, DEC-50 실행 계약)을 DB·AI 서비스 없이 검증한다. 저장소·AI 클라이언트는 대역이다. */
class PreprocessingServiceTest {
    private val world = UUID.randomUUID()
    private val t0 = Instant.parse("2026-11-19T00:00:00Z")
    private val t1 = t0.plusSeconds(60)
    private val works = mock(WorkRepository::class.java)
    private val episodes = mock(EpisodeRepository::class.java)
    private val jobs = mock(PreprocessingJobRepository::class.java)
    private val ai = mock(PreprocessingAiClient::class.java)
    private val manager = mock(PlatformTransactionManager::class.java)
    private val service = PreprocessingService(works, episodes, jobs, ai, TransactionTemplate(manager))
    private val work = WorkEntity(id = "work", ownerId = "owner", title = "메밀꽃 필 무렵", worldStudioId = world)
    private val newestFirst = Sort.by(Sort.Order.desc("createdAt"), Sort.Order.asc("id"))

    /** saveAndFlush가 불린 시점의 (상태, 사유)다. 같은 객체를 다시 저장해도 저장 순서를 구분할 수 있다. */
    private val savedStates = mutableListOf<Pair<String, String?>>()
    private val placeholder = PreprocessingJobEntity()
    private fun anyJob(): PreprocessingJobEntity = any(PreprocessingJobEntity::class.java) ?: placeholder
    private fun anyRequest(): PreprocessingAiRequest = any(PreprocessingAiRequest::class.java) ?: PreprocessingAiRequest("", "", emptyList())
    private fun aiRequests() = mockingDetails(ai).invocations.filter { it.method.name == "accept" }.map { it.arguments[0] as PreprocessingAiRequest }
    private fun savedJobs() = mockingDetails(jobs).invocations.filter { it.method.name == "saveAndFlush" }.map { it.arguments[0] as PreprocessingJobEntity }
    private fun rejected(block: () -> Unit) = assertThrows(ContentFailure::class.java, block)
    private fun job(status: String, id: String = "job") = PreprocessingJobEntity(id = id, workId = "work", memberId = "owner", status = status, total = 3)
    private fun failedJob(failedEpisodes: List<Int> = emptyList()) = job(FAILED).apply {
        done = 1; this.failedEpisodes = failedEpisodes; failedReason = "고정 사유"; startedAt = t0; finishedAt = t1
    }

    @BeforeEach fun stubs() {
        `when`(manager.getTransaction(any())).thenAnswer { SimpleTransactionStatus() }
        `when`(works.findById("work")).thenReturn(Optional.of(work))
        `when`(episodes.savedNumbers("work")).thenReturn(listOf(1, 2, 5))
        `when`(jobs.saveAndFlush(anyJob())).thenAnswer { call ->
            (call.arguments[0] as PreprocessingJobEntity).also { savedStates += it.status to it.failedReason }
        }
    }

    // ---- start ----

    @Test fun `start queues one job for the saved episodes and hands it to the AI service after the first save`() {
        val response = service.start("work", "owner")

        val saved = savedJobs().single()
        assertEquals(listOf<Any?>("work", world, "owner", QUEUED, 0, 3), listOf(saved.workId, saved.worldId, saved.memberId, saved.status, saved.done, saved.total))
        assertEquals(PreprocessingJobResponse(saved.id, "work", QUEUED, 0, 3, emptyList(), null, null, null), response)
        assertEquals(listOf(PreprocessingAiRequest(saved.id, "work", listOf(1, 2, 5))), aiRequests())
        val order = inOrder(jobs, ai)
        order.verify(jobs).saveAndFlush(anyJob())
        order.verify(ai).accept(anyRequest())
        assertEquals(listOf<Pair<String, String?>>(QUEUED to null), savedStates, "AI가 받아 줬으면 작업 행은 AI 진행 보고 전까지 그대로 queued다")
    }

    @Test fun `only the owner of a live work can start and nothing is created otherwise`() {
        for (other in listOf(work.copyOwner("other"), work.copyDeleted())) {
            `when`(works.findById("work")).thenReturn(Optional.of(other))
            assertEquals(404, rejected { service.start("work", "owner") }.status)
        }
        `when`(works.findById("work")).thenReturn(Optional.empty())
        assertEquals(404, rejected { service.start("work", "owner") }.status)
        verify(jobs, never()).saveAndFlush(anyJob())
        verifyNoInteractions(ai)
    }

    @Test fun `a work without a saved episode is 422 and nothing is created`() {
        `when`(episodes.savedNumbers("work")).thenReturn(emptyList())
        assertEquals(422, rejected { service.start("work", "owner") }.status)
        verify(jobs, never()).saveAndFlush(anyJob())
        verifyNoInteractions(ai)
    }

    @Test fun `an open or completed latest job is 409 and a failed one allows a new job`() {
        for (status in listOf(QUEUED, RUNNING, LOADING, COMPLETED)) {
            `when`(jobs.findFirstByWorkIdOrderByCreatedAtDesc("work")).thenReturn(job(status, "old"))
            assertEquals(409, rejected { service.start("work", "owner") }.status, status)
        }
        verify(jobs, never()).saveAndFlush(anyJob())
        verifyNoInteractions(ai)

        `when`(jobs.findFirstByWorkIdOrderByCreatedAtDesc("work")).thenReturn(failedJob())
        assertEquals(QUEUED, service.start("work", "owner").status)
        assertEquals(1, aiRequests().size)
    }

    @Test fun `losing the unique index race is 409 and the AI service is not called`() {
        doThrow(DataIntegrityViolationException("duplicate")).`when`(jobs).saveAndFlush(anyJob())
        assertEquals(409, rejected { service.start("work", "owner") }.status)
        verifyNoInteractions(ai)
    }

    @Test fun `an AI service failure leaves the job failed with the fixed reason and answers 502`() {
        doThrow(PreprocessingAiFailure("AI_UNAVAILABLE")).`when`(ai).accept(anyRequest())

        val failure = rejected { service.start("work", "owner") }

        assertEquals(502, failure.status)
        assertEquals(listOf<Pair<String, String?>>(QUEUED to null, FAILED to PreprocessingService.AI_CALL_FAILED), savedStates)
        val order = inOrder(jobs, ai)
        order.verify(jobs).saveAndFlush(anyJob())
        order.verify(ai).accept(anyRequest())
        order.verify(jobs).saveAndFlush(anyJob())
        assertNotNull(savedJobs().first().finishedAt)
    }

    // ---- latest ----

    @Test fun `latest reads the newest job of the work for its owner only`() {
        val running = job(RUNNING, "j2").apply { done = 2; startedAt = t0 }
        `when`(jobs.findFirstByWorkIdOrderByCreatedAtDesc("work")).thenReturn(running)

        assertEquals(PreprocessingJobResponse("j2", "work", RUNNING, 2, 3, emptyList(), null, t0.toString(), null), service.latest("work", "owner"))

        assertEquals(404, rejected { service.latest("work", "other") }.status)
        verify(jobs, times(1)).findFirstByWorkIdOrderByCreatedAtDesc("work")
    }

    @Test fun `latest without any job is 404 with its own code`() {
        val failure = rejected { service.latest("work", "owner") }
        assertEquals(404, failure.status)
        assertEquals("PREPROCESSING_NOT_STARTED", failure.code)
    }

    // ---- progress ----

    @Test fun `progress applies the report to the locked open job and answers its new state`() {
        val queued = job(QUEUED)
        `when`(jobs.lock("job")).thenReturn(queued)

        val response = service.progress("job", PreprocessingProgressRequest("extracting", 1, 3, emptyList()))

        assertEquals(listOf<Any?>("job", RUNNING, 1, 3), listOf(response.id, response.status, response.done, response.total))
        assertNotNull(queued.startedAt)
        assertEquals(listOf<Pair<String, String?>>(RUNNING to null), savedStates)
    }

    @Test fun `progress with a failure reason fails the job and keeps the reported episodes`() {
        `when`(jobs.lock("job")).thenReturn(job(RUNNING))

        val response = service.progress("job", PreprocessingProgressRequest("extracting", 1, 3, listOf(2), "전처리 로직 미구현"))

        assertEquals(listOf<Any?>(FAILED, "전처리 로직 미구현", listOf(2)), listOf(response.status, response.error, response.failedEpisodes))
        assertNotNull(response.finishedAt)
    }

    @Test fun `progress of an unknown job is 404 and of a finished job 409 without saving`() {
        assertEquals(404, rejected { service.progress("none", PreprocessingProgressRequest("extracting", 0, 3, emptyList())) }.status)
        for (status in listOf(COMPLETED, FAILED)) {
            `when`(jobs.lock("done")).thenReturn(job(status, "done"))
            assertEquals(409, rejected { service.progress("done", PreprocessingProgressRequest("extracting", 0, 3, emptyList())) }.status, status)
        }
        verify(jobs, never()).saveAndFlush(anyJob())
    }

    // ---- list ----

    @Test fun `list pages newest first and filters by status`() {
        val failed = failedJob(listOf(2))
        `when`(jobs.findAll(PageRequest.of(0, 20, newestFirst))).thenReturn(PageImpl(listOf(failed), PageRequest.of(0, 20, newestFirst), 41))
        `when`(jobs.findAllByStatus(FAILED, PageRequest.of(1, 50, newestFirst))).thenReturn(PageImpl(listOf(failed), PageRequest.of(1, 50, newestFirst), 51))

        val all = service.list(null, null, null)
        assertEquals(41L, all.total)
        assertEquals(listOf(PreprocessingJobResponse("job", "work", FAILED, 1, 3, listOf(2), "고정 사유", t0.toString(), t1.toString())), all.items)
        assertEquals(51L, service.list("failed", "1", "50").total)
    }

    @Test fun `list rejects an unknown status and bad paging with 422`() {
        for ((status, page, size) in listOf(Triple("done", null, null), Triple("FAILED", null, null), Triple(null, "-1", null), Triple(null, "x", null), Triple(null, null, "0"), Triple(null, null, "101"))) {
            assertEquals(422, rejected { service.list(status, page, size) }.status, "${status} ${page} ${size}")
        }
        verifyNoInteractions(jobs)
    }

    // ---- retry ----

    @Test fun `retry requeues the latest failed job and sends its failed episodes or else all saved ones`() {
        val withFailures = failedJob(listOf(2, 5))
        `when`(jobs.lock("job")).thenReturn(withFailures)
        `when`(jobs.findFirstByWorkIdOrderByCreatedAtDesc("work")).thenReturn(withFailures)

        val response = service.retry("job")

        assertEquals(listOf<Any?>(QUEUED, null, null, null), listOf(response.status, response.error, response.startedAt, response.finishedAt))
        assertEquals(listOf(PreprocessingAiRequest("job", "work", listOf(2, 5))), aiRequests())
        assertEquals(listOf<Pair<String, String?>>(QUEUED to null), savedStates)

        val withoutFailures = failedJob()
        `when`(jobs.lock("job")).thenReturn(withoutFailures)
        `when`(jobs.findFirstByWorkIdOrderByCreatedAtDesc("work")).thenReturn(withoutFailures)
        service.retry("job")
        assertEquals(listOf(1, 2, 5), aiRequests().last().episodes)
    }

    @Test fun `retry of an unknown job is 404 of a job that is not failed 409 and of an older job 409`() {
        assertEquals(404, rejected { service.retry("none") }.status)
        for (status in listOf(QUEUED, RUNNING, LOADING, COMPLETED)) {
            `when`(jobs.lock("job")).thenReturn(job(status))
            assertEquals(409, rejected { service.retry("job") }.status, status)
        }
        `when`(jobs.lock("job")).thenReturn(failedJob())
        `when`(jobs.findFirstByWorkIdOrderByCreatedAtDesc("work")).thenReturn(job(RUNNING, "newer"))
        assertEquals(409, rejected { service.retry("job") }.status, "더 새로운 작업이 있으면 옛 작업은 다시 실행하지 않는다")
        verify(jobs, never()).saveAndFlush(anyJob())
        verifyNoInteractions(ai)
    }

    @Test fun `retry that the AI service refuses leaves the job failed again and answers 502`() {
        val failed = failedJob(listOf(2))
        `when`(jobs.lock("job")).thenReturn(failed)
        `when`(jobs.findFirstByWorkIdOrderByCreatedAtDesc("work")).thenReturn(failed)
        doThrow(PreprocessingAiFailure("AI_TIMEOUT")).`when`(ai).accept(anyRequest())

        assertEquals(502, rejected { service.retry("job") }.status)

        assertEquals(listOf<Pair<String, String?>>(QUEUED to null, FAILED to PreprocessingService.AI_CALL_FAILED), savedStates)
        assertEquals(listOf(2), failed.failedEpisodes, "실패 회차 기록은 AI의 다음 보고 전까지 지우지 않는다")
    }

    @Test fun `retry that loses the unique index race is 409 and the AI service is not called`() {
        val failed = failedJob()
        `when`(jobs.lock("job")).thenReturn(failed)
        `when`(jobs.findFirstByWorkIdOrderByCreatedAtDesc("work")).thenReturn(failed)
        doThrow(DataIntegrityViolationException("duplicate")).`when`(jobs).saveAndFlush(anyJob())

        assertEquals(409, rejected { service.retry("job") }.status)
        verifyNoInteractions(ai)
    }

    private fun WorkEntity.copyOwner(owner: String) = WorkEntity(id = id, ownerId = owner, title = title, worldStudioId = worldStudioId)
    private fun WorkEntity.copyDeleted() = WorkEntity(id = id, ownerId = ownerId, title = title, deletedAt = t0)
}
