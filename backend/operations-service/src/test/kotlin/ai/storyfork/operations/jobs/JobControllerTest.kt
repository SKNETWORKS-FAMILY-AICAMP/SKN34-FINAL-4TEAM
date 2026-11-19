package ai.storyfork.operations.jobs

import ai.storyfork.operations.jobs.controller.JobController
import ai.storyfork.operations.jobs.service.JobRunService
import ai.storyfork.operations.jobs.service.ScheduleService
import ai.storyfork.operations.jobs.service.dto.JobPage
import ai.storyfork.operations.jobs.service.dto.JobRun
import ai.storyfork.operations.jobs.service.dto.Schedule
import ai.storyfork.operations.jobs.service.dto.ScheduleRequest
import ai.storyfork.operations.security.OperationsMember
import java.time.Instant
import java.util.UUID
import org.junit.jupiter.api.Assertions.*
import org.junit.jupiter.api.Test
import org.mockito.Mockito.*
import org.springframework.data.domain.PageRequest
import org.springframework.http.HttpStatus

/** Spring context나 HTTP 서버 없이 인증 회원·조회 조건 전달과 응답 상태가 서로 바뀌지 않는지 확인한다. */
class JobControllerTest {
    private val runService = mock(JobRunService::class.java)
    private val scheduleService = mock(ScheduleService::class.java)
    private val controller = JobController(runService, scheduleService)
    private val member = OperationsMember(UUID.randomUUID(), true)
    private val id = UUID.randomUUID()
    private val request = ScheduleRequest("alpha", "0 0 3 * * *")
    private val schedule = Schedule(id, "alpha", "0 0 3 * * *", true, emptyMap(), Instant.EPOCH, Instant.EPOCH, null)
    private val run = JobRun("r-1", "alpha", "operations-scheduler", "queued", "manual", null, null, null, null, null)

    @Test
    fun `runs passes the member, filters and page to the service`() {
        val page = PageRequest.of(2, 10)
        val result = JobPage(listOf(run), 2, 10, 21L)
        `when`(runService.list(member, "failed", "alpha", page)).thenReturn(result)

        assertSame(result, controller.runs(member, "failed", "alpha", page))
    }

    @Test
    fun `retry is accepted with the queued run`() {
        `when`(runService.retry(member, "r-1")).thenReturn(run)

        val response = controller.retry(member, "r-1")

        assertEquals(HttpStatus.ACCEPTED, response.statusCode)
        assertSame(run, response.body)
    }

    @Test
    fun `create is 201 with the schedule location, update and cancel return the schedule`() {
        `when`(scheduleService.create(member, request)).thenReturn(schedule)
        `when`(scheduleService.update(member, id, request)).thenReturn(schedule)
        `when`(scheduleService.cancel(member, id)).thenReturn(schedule.copy(enabled = false))
        `when`(scheduleService.list(member)).thenReturn(JobPage(listOf(schedule), 0, 1, 1L))

        val created = controller.create(member, request)

        assertEquals(HttpStatus.CREATED, created.statusCode)
        assertEquals("/api/v1/operations/jobs/schedules/$id", created.headers.location?.toString())
        assertSame(schedule, created.body)
        assertSame(schedule, controller.update(member, id, request))
        assertFalse(controller.cancel(member, id).enabled)
        assertEquals(listOf(schedule), controller.schedules(member).items)
    }
}
