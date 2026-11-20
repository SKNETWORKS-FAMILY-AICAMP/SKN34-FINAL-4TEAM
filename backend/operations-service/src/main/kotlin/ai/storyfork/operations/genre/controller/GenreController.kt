package ai.storyfork.operations.genre.controller

import ai.storyfork.operations.genre.service.GenreService
import ai.storyfork.operations.genre.service.dto.GenreCreateRequest
import ai.storyfork.operations.genre.service.dto.GenreOrderRequest
import ai.storyfork.operations.genre.service.dto.GenreUpdateRequest
import ai.storyfork.operations.security.OperationsMember
import org.springframework.http.HttpStatus
import org.springframework.security.core.annotation.AuthenticationPrincipal
import org.springframework.web.bind.annotation.*

@RestController
@RequestMapping("/api/v1/operations/genres")
class GenreController(private val service: GenreService) {
    @GetMapping
    fun list(@AuthenticationPrincipal member: OperationsMember) = service.list(member)

    @PostMapping
    @ResponseStatus(HttpStatus.CREATED)
    fun create(@AuthenticationPrincipal member: OperationsMember, @RequestBody request: GenreCreateRequest) = service.create(member, request)

    @PatchMapping("/{code}")
    fun update(@AuthenticationPrincipal member: OperationsMember, @PathVariable code: String, @RequestBody request: GenreUpdateRequest) =
        service.update(member, code, request)

    @PutMapping("/order")
    fun reorder(@AuthenticationPrincipal member: OperationsMember, @RequestBody request: GenreOrderRequest) = service.reorder(member, request)
}
