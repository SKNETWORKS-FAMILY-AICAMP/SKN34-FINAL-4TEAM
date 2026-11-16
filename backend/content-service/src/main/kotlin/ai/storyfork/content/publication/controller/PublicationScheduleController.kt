package ai.storyfork.content.publication.controller

import ai.storyfork.content.publication.service.PublicationScheduleService
import ai.storyfork.content.publication.service.dto.PublicationScheduleRequest
import jakarta.validation.Valid
import jakarta.validation.constraints.Min
import java.security.Principal
import org.springframework.http.HttpStatus
import org.springframework.web.bind.annotation.*

@RestController
@RequestMapping("/api/v1/works/{id}/episodes/{number}/publication-schedules")
class PublicationScheduleController(private val service: PublicationScheduleService) {
    @GetMapping
    fun list(@PathVariable id: String, @PathVariable number: Int, principal: Principal) =
        service.list(id, principal.name, number)

    @PostMapping
    @ResponseStatus(HttpStatus.CREATED)
    fun create(@PathVariable id: String, @PathVariable number: Int, principal: Principal, @Valid @RequestBody request: PublicationScheduleRequest) =
        service.create(id, principal.name, number, request)

    @PutMapping("/{scheduleId}")
    fun update(@PathVariable id: String, @PathVariable number: Int, @PathVariable scheduleId: String, principal: Principal, @Valid @RequestBody request: PublicationScheduleRequest) =
        service.update(id, principal.name, number, scheduleId, request)

    @DeleteMapping("/{scheduleId}")
    @ResponseStatus(HttpStatus.NO_CONTENT)
    fun cancel(@PathVariable id: String, @PathVariable number: Int, @PathVariable scheduleId: String, @RequestParam @Min(0) revision: Int, principal: Principal) =
        service.cancel(id, principal.name, number, scheduleId, revision)
}
