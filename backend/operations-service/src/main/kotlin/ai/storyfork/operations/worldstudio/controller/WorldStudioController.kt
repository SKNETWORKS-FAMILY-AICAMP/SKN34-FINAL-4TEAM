package ai.storyfork.operations.worldstudio.controller

import ai.storyfork.operations.security.OperationsMember
import ai.storyfork.operations.worldstudio.service.WorldStudioService
import java.util.UUID
import org.springframework.security.core.annotation.AuthenticationPrincipal
import org.springframework.web.bind.annotation.*

/** Member Bearer API for an operator with the `works` permission. */
@RestController
@RequestMapping("/api/v1/operations/world-studios")
class WorldStudioController(private val service: WorldStudioService) {
    @GetMapping
    fun list(@AuthenticationPrincipal member: OperationsMember) = service.list(member)

    @PutMapping("/{id}/restriction")
    fun restrict(@AuthenticationPrincipal member: OperationsMember, @PathVariable id: UUID) = service.restrict(member, id)

    @DeleteMapping("/{id}/restriction")
    fun unrestrict(@AuthenticationPrincipal member: OperationsMember, @PathVariable id: UUID) = service.unrestrict(member, id)
}
