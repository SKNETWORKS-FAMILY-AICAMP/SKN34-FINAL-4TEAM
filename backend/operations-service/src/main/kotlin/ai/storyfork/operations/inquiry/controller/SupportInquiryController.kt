package ai.storyfork.operations.inquiry.controller

import ai.storyfork.operations.inquiry.service.SupportInquiryService
import ai.storyfork.operations.inquiry.service.dto.*
import ai.storyfork.operations.security.OperationsMember
import jakarta.validation.Valid
import java.util.UUID
import org.springframework.http.HttpStatus
import org.springframework.security.core.annotation.AuthenticationPrincipal
import org.springframework.web.bind.annotation.*

/** Member Bearer API for platform support inquiries; mutations return the whole updated inquiry with its replies. */
@RestController
@RequestMapping("/api/v1/operations/support/inquiries")
class SupportInquiryController(private val service: SupportInquiryService) {
    @PostMapping
    @ResponseStatus(HttpStatus.CREATED)
    fun create(@AuthenticationPrincipal member: OperationsMember, @Valid @RequestBody request: SupportInquiryRequest) =
        service.create(member, request)

    @GetMapping("/mine")
    fun mine(@AuthenticationPrincipal member: OperationsMember) = service.mine(member)

    @GetMapping
    fun list(@AuthenticationPrincipal member: OperationsMember, @RequestParam(required = false) status: SupportInquiryStatus?) =
        service.list(member, status)

    @GetMapping("/{id}")
    fun detail(@AuthenticationPrincipal member: OperationsMember, @PathVariable id: UUID) = service.detail(member, id)

    @PostMapping("/{id}/replies")
    @ResponseStatus(HttpStatus.CREATED)
    fun reply(
        @AuthenticationPrincipal member: OperationsMember, @PathVariable id: UUID, @Valid @RequestBody request: SupportReplyRequest,
    ) = service.reply(member, id, request)

    @PutMapping("/{id}/replies/{replyId}")
    fun updateReply(
        @AuthenticationPrincipal member: OperationsMember, @PathVariable id: UUID, @PathVariable replyId: UUID,
        @Valid @RequestBody request: SupportReplyRequest,
    ) = service.updateReply(member, id, replyId, request)

    @DeleteMapping("/{id}/replies/{replyId}")
    fun deleteReply(@AuthenticationPrincipal member: OperationsMember, @PathVariable id: UUID, @PathVariable replyId: UUID) =
        service.deleteReply(member, id, replyId)
}
