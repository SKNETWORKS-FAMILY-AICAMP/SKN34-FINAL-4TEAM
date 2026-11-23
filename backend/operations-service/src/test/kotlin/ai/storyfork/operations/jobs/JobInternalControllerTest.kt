package ai.storyfork.operations.jobs

import ai.storyfork.operations.jobs.controller.JobInternalController
import ai.storyfork.operations.jobs.service.JobExecutionService
import ai.storyfork.operations.jobs.service.dto.JobRun
import java.util.UUID
import org.junit.jupiter.api.Assertions.*
import org.junit.jupiter.api.Test
import org.mockito.Mockito.*

/** The run id reaches the execution service and its answer is the response: no Spring context or HTTP server. */
class JobInternalControllerTest {
    private val executions = mock(JobExecutionService::class.java)
    private val controller = JobInternalController(executions)

    @Test
    fun `execute passes the run id to the execution service and answers with the finished run`() {
        val id = UUID.randomUUID()
        val run = JobRun(id.toString(), "alpha", "operations-scheduler", "succeeded", "schedule", null, null, null, null, null)
        `when`(executions.execute(id)).thenReturn(run)

        assertSame(run, controller.execute(id))
    }
}
