package ai.storyfork.operations.inquiry.service

import ai.storyfork.operations.inquiry.entity.InquiryEntity
import ai.storyfork.operations.inquiry.entity.InquiryReplyEntity
import ai.storyfork.operations.inquiry.repository.InquiryReplyRepository
import ai.storyfork.operations.inquiry.repository.InquiryRepository
import ai.storyfork.operations.inquiry.service.dto.*
import java.time.Instant
import java.time.temporal.ChronoUnit
import java.util.UUID
import org.springframework.data.domain.PageRequest
import org.springframework.data.domain.Pageable
import org.springframework.data.domain.Sort
import org.springframework.http.HttpStatus
import org.springframework.stereotype.Service
import org.springframework.transaction.annotation.Transactional
import org.springframework.web.server.ResponseStatusException

@Service
@Transactional
class InquiryService(
    private val inquiries: InquiryRepository,
    private val replies: InquiryReplyRepository,
) {
    fun create(request: InquiryRequest): InquiryResponse {
        validate(request)
        return inquiries.saveAndFlush(InquiryEntity(
            title = request.title.trim(), body = request.body, category = request.category.trim(),
        )).response()
    }

    @Transactional(readOnly = true)
    fun list(pageable: Pageable): InquiryListResponse {
        val page = inquiries.findAll(bounded(pageable, Sort.Direction.DESC))
        return InquiryListResponse(page.content.map { it.response() }, page.number, page.size, page.totalElements, page.totalPages)
    }

    @Transactional(readOnly = true)
    fun read(id: UUID): InquiryResponse = inquiry(id).response()

    fun update(id: UUID, request: InquiryRequest): InquiryResponse {
        validate(request)
        val row = inquiry(id)
        row.title = request.title.trim()
        row.body = request.body
        row.category = request.category.trim()
        row.updatedAt = Instant.now().truncatedTo(ChronoUnit.MICROS)
        return inquiries.saveAndFlush(row).response()
    }

    /** Delete replies explicitly first; the database FK also guards concurrent reply creation. */
    fun delete(id: UUID) {
        val row = inquiry(id)
        if (replies.existsByInquiryId(id)) throw ResponseStatusException(HttpStatus.CONFLICT, "Delete replies first.")
        inquiries.delete(row)
        inquiries.flush()
    }

    fun createReply(inquiryId: UUID, request: InquiryReplyRequest): InquiryReplyResponse {
        validateInquiryBody(request.body)
        requireParent(inquiryId)
        return replies.saveAndFlush(InquiryReplyEntity(inquiryId = inquiryId, body = request.body)).response()
    }

    @Transactional(readOnly = true)
    fun listReplies(inquiryId: UUID, pageable: Pageable): InquiryReplyListResponse {
        val bounded = bounded(pageable, Sort.Direction.ASC)
        requireParent(inquiryId)
        val page = replies.findAllByInquiryId(inquiryId, bounded)
        return InquiryReplyListResponse(page.content.map { it.response() }, page.number, page.size, page.totalElements, page.totalPages)
    }

    @Transactional(readOnly = true)
    fun readReply(inquiryId: UUID, replyId: UUID): InquiryReplyResponse = reply(inquiryId, replyId).response()

    fun updateReply(inquiryId: UUID, replyId: UUID, request: InquiryReplyRequest): InquiryReplyResponse {
        validateInquiryBody(request.body)
        val row = reply(inquiryId, replyId)
        row.body = request.body
        row.updatedAt = Instant.now().truncatedTo(ChronoUnit.MICROS)
        return replies.saveAndFlush(row).response()
    }

    fun deleteReply(inquiryId: UUID, replyId: UUID) {
        val row = reply(inquiryId, replyId)
        replies.delete(row)
        replies.flush()
    }

    private fun inquiry(id: UUID): InquiryEntity = inquiries.findById(id).orElseThrow { NoSuchElementException("Inquiry not found.") }

    private fun reply(inquiryId: UUID, replyId: UUID): InquiryReplyEntity =
        replies.findByIdAndInquiryId(replyId, inquiryId) ?: throw NoSuchElementException("Reply not found.")

    private fun requireParent(inquiryId: UUID) {
        if (!inquiries.existsById(inquiryId)) throw NoSuchElementException("Inquiry not found.")
    }

    private fun bounded(pageable: Pageable, direction: Sort.Direction): Pageable {
        require(pageable.isPaged) { "Pagination is required." }
        return PageRequest.of(pageable.pageNumber, pageable.pageSize.coerceAtMost(100), Sort.by(direction, "createdAt", "id"))
    }

    private fun validate(request: InquiryRequest) = validateInquiryFields(request.title, request.category, request.body)

    private fun InquiryEntity.response() = InquiryResponse(id, title, body, category, createdAt, updatedAt)
    private fun InquiryReplyEntity.response() = InquiryReplyResponse(id, inquiryId, body, createdAt, updatedAt)
}

/** Shared with [SupportInquiryService] so the service-token and member entry points enforce the same limits. */
internal fun validateInquiryFields(title: String, category: String, body: String) {
    require(title.isNotBlank() && title.length <= 200 && '\u0000' !in title) { "Invalid inquiry title." }
    require(category.isNotBlank() && category.length <= 50 && '\u0000' !in category) { "Invalid inquiry category." }
    validateInquiryBody(body)
}

internal fun validateInquiryBody(body: String) {
    require(body.isNotBlank() && body.length <= 20000 && '\u0000' !in body) { "Invalid body." }
}
