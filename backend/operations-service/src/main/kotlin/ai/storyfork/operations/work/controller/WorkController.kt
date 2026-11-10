package ai.storyfork.operations.work.controller

import ai.storyfork.operations.security.OperationsMember
import ai.storyfork.operations.work.service.WorkService
import java.util.UUID
import org.springframework.security.core.annotation.AuthenticationPrincipal
import org.springframework.web.bind.annotation.*

@RestController
@RequestMapping("/api/v1/operations/works")
class WorkController(private val service: WorkService) {
    @GetMapping
    fun list(@AuthenticationPrincipal member: OperationsMember) = service.list(member)

    @PutMapping("/{id}/restriction")
    fun restrict(@AuthenticationPrincipal member: OperationsMember, @PathVariable id: UUID) = service.restrict(member, id)

    @DeleteMapping("/{id}/restriction")
    fun unrestrict(@AuthenticationPrincipal member: OperationsMember, @PathVariable id: UUID) = service.unrestrict(member, id)
}
