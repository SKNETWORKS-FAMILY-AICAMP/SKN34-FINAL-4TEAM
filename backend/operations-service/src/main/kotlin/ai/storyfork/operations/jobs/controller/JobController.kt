package ai.storyfork.operations.jobs.controller

import ai.storyfork.operations.jobs.service.JobRunService
import ai.storyfork.operations.jobs.service.ScheduleService
import ai.storyfork.operations.jobs.service.dto.JobPage
import ai.storyfork.operations.jobs.service.dto.JobRun
import ai.storyfork.operations.jobs.service.dto.Schedule
import ai.storyfork.operations.jobs.service.dto.ScheduleRequest
import ai.storyfork.operations.security.OperationsMember
import java.net.URI
import java.util.UUID
import org.springframework.data.domain.Pageable
import org.springframework.http.ResponseEntity
import org.springframework.security.core.annotation.AuthenticationPrincipal
import org.springframework.web.bind.annotation.*

/**
 * Member Bearer API (operator + `jobs` permission, checked by the services): run records of the operations scheduler and
 * Content's preprocessing, and the schedule CRUD. Input validation runs after the permission check, so there is no `@Valid`.
 */
@RestController
@RequestMapping("/api/v1/operations/jobs")
class JobController(private val runService: JobRunService, private val scheduleService: ScheduleService) {
    @GetMapping("/runs")
    fun runs(
        @AuthenticationPrincipal member: OperationsMember,
        @RequestParam(required = false) status: String?,
        @RequestParam(required = false) kind: String?,
        pageable: Pageable,
    ): JobPage<JobRun> = runService.list(member, status, kind, pageable)

    @PostMapping("/runs/{id}/retry")
    fun retry(@AuthenticationPrincipal member: OperationsMember, @PathVariable id: String): ResponseEntity<JobRun> =
        ResponseEntity.accepted().body(runService.retry(member, id))

    @GetMapping("/schedules")
    fun schedules(@AuthenticationPrincipal member: OperationsMember): JobPage<Schedule> = scheduleService.list(member)

    @PostMapping("/schedules")
    fun create(@AuthenticationPrincipal member: OperationsMember, @RequestBody request: ScheduleRequest): ResponseEntity<Schedule> {
        val created = scheduleService.create(member, request)
        return ResponseEntity.created(URI.create("/api/v1/operations/jobs/schedules/${created.id}")).body(created)
    }

    @PutMapping("/schedules/{id}")
    fun update(@AuthenticationPrincipal member: OperationsMember, @PathVariable id: UUID, @RequestBody request: ScheduleRequest): Schedule =
        scheduleService.update(member, id, request)

    /** Cancels the schedule (enabled = false) and answers with it; nothing is deleted. */
    @DeleteMapping("/schedules/{id}")
    fun cancel(@AuthenticationPrincipal member: OperationsMember, @PathVariable id: UUID): Schedule = scheduleService.cancel(member, id)
}
