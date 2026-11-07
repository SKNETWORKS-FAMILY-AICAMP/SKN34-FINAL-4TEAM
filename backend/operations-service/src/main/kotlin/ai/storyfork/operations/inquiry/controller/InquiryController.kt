package ai.storyfork.operations.inquiry.controller

import ai.storyfork.operations.inquiry.service.InquiryService
import ai.storyfork.operations.inquiry.service.dto.*
import jakarta.validation.Valid
import java.net.URI
import java.util.UUID
import org.springframework.data.domain.Pageable
import org.springframework.data.web.PageableDefault
import org.springframework.http.HttpStatus
import org.springframework.http.ResponseEntity
import org.springframework.web.bind.annotation.*

/** Shared service-token protection applies; these records do not represent end-user identity or ownership. */
@RestController
@RequestMapping("/api/v1/operations/inquiries")
class InquiryController(private val service: InquiryService) {
    @PostMapping
    fun create(@Valid @RequestBody request: InquiryRequest): ResponseEntity<InquiryResponse> {
        val response = service.create(request)
        return ResponseEntity.created(URI.create("/api/v1/operations/inquiries/${response.id}")).body(response)
    }

    @GetMapping
    fun list(@PageableDefault(size = 20) pageable: Pageable): InquiryListResponse = service.list(pageable)

    @GetMapping("/{id}")
    fun read(@PathVariable id: UUID): InquiryResponse = service.read(id)

    @PutMapping("/{id}")
    fun update(@PathVariable id: UUID, @Valid @RequestBody request: InquiryRequest): InquiryResponse =
        service.update(id, request)

    /** Reply records must be explicitly deleted first; this endpoint never cascades deletion. */
    @DeleteMapping("/{id}")
    @ResponseStatus(HttpStatus.NO_CONTENT)
    fun delete(@PathVariable id: UUID) = service.delete(id)

    @PostMapping("/{id}/replies")
    fun createReply(@PathVariable id: UUID, @Valid @RequestBody request: InquiryReplyRequest): ResponseEntity<InquiryReplyResponse> {
        val response = service.createReply(id, request)
        return ResponseEntity.created(URI.create("/api/v1/operations/inquiries/$id/replies/${response.id}")).body(response)
    }

    @GetMapping("/{id}/replies")
    fun listReplies(@PathVariable id: UUID, @PageableDefault(size = 20) pageable: Pageable): InquiryReplyListResponse =
        service.listReplies(id, pageable)

    @GetMapping("/{id}/replies/{replyId}")
    fun readReply(@PathVariable id: UUID, @PathVariable replyId: UUID): InquiryReplyResponse = service.readReply(id, replyId)

    @PutMapping("/{id}/replies/{replyId}")
    fun updateReply(@PathVariable id: UUID, @PathVariable replyId: UUID, @Valid @RequestBody request: InquiryReplyRequest): InquiryReplyResponse =
        service.updateReply(id, replyId, request)

    @DeleteMapping("/{id}/replies/{replyId}")
    @ResponseStatus(HttpStatus.NO_CONTENT)
    fun deleteReply(@PathVariable id: UUID, @PathVariable replyId: UUID) = service.deleteReply(id, replyId)
}
