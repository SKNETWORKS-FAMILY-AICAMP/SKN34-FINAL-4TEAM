package ai.storyfork.operations.notice.controller

import ai.storyfork.operations.notice.service.AdminNoticeService
import ai.storyfork.operations.notice.service.dto.NoticeRequest
import ai.storyfork.operations.notice.service.dto.NoticeResponse
import ai.storyfork.operations.security.OperationsMember
import java.net.URI
import java.util.UUID
import org.springframework.http.HttpStatus
import org.springframework.http.ResponseEntity
import org.springframework.security.core.annotation.AuthenticationPrincipal
import org.springframework.web.bind.annotation.*

/** 회원 Bearer 관리자 전용 공지 CRUD. `@Valid` 없이 서비스가 권한 → 값 검증 순으로 처리해, JSON 형식이 맞다면 비관리자는 입력 값과 무관하게 403이다. */
@RestController
@RequestMapping("/api/v1/operations/admin/notices")
class AdminNoticeController(private val service: AdminNoticeService) {
    @GetMapping
    fun list(@AuthenticationPrincipal member: OperationsMember) = service.list(member)

    @GetMapping("/{id}")
    fun read(@AuthenticationPrincipal member: OperationsMember, @PathVariable id: UUID) = service.read(member, id)

    @PostMapping
    fun create(@AuthenticationPrincipal member: OperationsMember, @RequestBody request: NoticeRequest): ResponseEntity<NoticeResponse> {
        val created = service.create(member, request)
        return ResponseEntity.created(URI.create("/api/v1/operations/admin/notices/${created.id}")).body(created)
    }

    @PutMapping("/{id}")
    fun update(@AuthenticationPrincipal member: OperationsMember, @PathVariable id: UUID, @RequestBody request: NoticeRequest) =
        service.update(member, id, request)

    @DeleteMapping("/{id}")
    @ResponseStatus(HttpStatus.NO_CONTENT)
    fun delete(@AuthenticationPrincipal member: OperationsMember, @PathVariable id: UUID) = service.delete(member, id)
}
