package ai.storyfork.content.world.controller

import ai.storyfork.content.world.service.WorldCheckpointService
import java.security.Principal
import org.springframework.http.HttpStatus
import org.springframework.web.bind.annotation.*

@RestController
@RequestMapping("/api/v1/works/{id}/world/checkpoints")
class WorldCheckpointController(private val service: WorldCheckpointService) {
    @PostMapping
    @ResponseStatus(HttpStatus.CREATED)
    fun create(@PathVariable id: String, principal: Principal) = service.create(id, principal.name)

    @GetMapping
    fun list(@PathVariable id: String, principal: Principal) = service.list(id, principal.name)

    @GetMapping("/{checkpointId}")
    fun read(@PathVariable id: String, @PathVariable checkpointId: String, principal: Principal) =
        service.read(id, principal.name, checkpointId)
}
