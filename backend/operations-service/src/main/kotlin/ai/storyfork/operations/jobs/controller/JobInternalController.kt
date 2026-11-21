package ai.storyfork.operations.jobs.controller

import ai.storyfork.operations.jobs.service.JobExecutionService
import ai.storyfork.operations.jobs.service.dto.JobRun
import java.util.UUID
import org.springframework.web.bind.annotation.PathVariable
import org.springframework.web.bind.annotation.PostMapping
import org.springframework.web.bind.annotation.RequestMapping
import org.springframework.web.bind.annotation.RestController

/**
 * Service API of the AI service's job workers, behind the shared internal token only ([ai.storyfork.operations.security.InternalSecurityConfig], never exposed
 * through the public entry point): a worker asks for a queued run to be executed and waits until the handler has finished. 200 with the finished run, 404 for an
 * unknown run, 409 when another worker took the run or it is no longer queued (a task delivered twice is refused, not run again).
 */
@RestController
@RequestMapping("/internal/v1/jobs/runs")
class JobInternalController(private val executions: JobExecutionService) {
    @PostMapping("/{runId}/execute")
    fun execute(@PathVariable runId: UUID): JobRun = executions.execute(runId)
}
