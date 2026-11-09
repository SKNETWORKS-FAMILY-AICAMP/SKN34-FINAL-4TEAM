package ai.storyfork.operations.event.controller

import ai.storyfork.operations.event.service.AdminEventService
import ai.storyfork.operations.event.service.dto.EventListResponse
import ai.storyfork.operations.event.service.dto.EventRequest
import ai.storyfork.operations.event.service.dto.EventResponse
import ai.storyfork.operations.security.OperationsMember
import java.net.URI
import java.util.UUID
import org.springframework.http.ResponseEntity
import org.springframework.security.core.annotation.AuthenticationPrincipal
import org.springframework.web.bind.annotation.*

/** 회원 Bearer·operator·`events` 권한으로 보호되는 이벤트 관리자 CRUD. 입력 검증은 권한 확인 뒤 EventService가 하므로 `@Valid`를 두지 않는다. */
@RestController
@RequestMapping("/api/v1/operations/admin/events")
class AdminEventController(private val service: AdminEventService) {
    @PostMapping
    fun create(@AuthenticationPrincipal member: OperationsMember, @RequestBody request: EventRequest): ResponseEntity<EventResponse> {
        val event = service.create(member, request)
        return ResponseEntity.created(URI.create("/api/v1/operations/admin/events/${event.id}")).body(event)
    }

    @GetMapping
    fun list(@AuthenticationPrincipal member: OperationsMember): EventListResponse = service.list(member)

    @GetMapping("/{id}")
    fun read(@AuthenticationPrincipal member: OperationsMember, @PathVariable id: UUID): EventResponse = service.read(member, id)

    @PutMapping("/{id}")
    fun update(@AuthenticationPrincipal member: OperationsMember, @PathVariable id: UUID, @RequestBody request: EventRequest): EventResponse =
        service.update(member, id, request)

    @DeleteMapping("/{id}")
    fun delete(@AuthenticationPrincipal member: OperationsMember, @PathVariable id: UUID): ResponseEntity<Void> {
        service.delete(member, id)
        return ResponseEntity.noContent().build()
    }
}
