package ai.storyfork.operations.inquiry.service

import ai.storyfork.operations.inquiry.entity.InquiryEntity
import ai.storyfork.operations.inquiry.entity.InquiryReplyEntity
import ai.storyfork.operations.inquiry.repository.InquiryReplyRepository
import ai.storyfork.operations.inquiry.repository.InquiryRepository
import ai.storyfork.operations.inquiry.service.dto.*
import ai.storyfork.operations.member.repository.AdminPermissionRepository
import ai.storyfork.operations.member.repository.has
import ai.storyfork.operations.member.repository.requirePermission
import ai.storyfork.operations.security.OperationsMember
import java.time.Instant
import java.time.temporal.ChronoUnit
import java.util.UUID
import org.springframework.data.domain.PageRequest
import org.springframework.stereotype.Service
import org.springframework.transaction.annotation.Transactional

private const val FEEDBACK = "feedback"

/** ponytail: newest 100 only; add paging when an admin list outgrows it. */
private val NEWEST = PageRequest.ofSize(100)

/** Member-filed support inquiries only (`member_id IS NOT NULL`); legacy service-token records stay invisible here. */
@Service
@Transactional
class SupportInquiryService(
    private val inquiries: InquiryRepository,
    private val replies: InquiryReplyRepository,
    private val permissions: AdminPermissionRepository,
) {
    fun create(member: OperationsMember, request: SupportInquiryRequest): SupportInquiryResponse {
        validateInquiryFields(request.title, request.category, request.body)
        return inquiries.saveAndFlush(InquiryEntity(
            title = request.title.trim(), body = request.body, category = request.category.trim(), memberId = member.memberId,
        )).response(emptyList())
    }

    @Transactional(readOnly = true)
    fun mine(member: OperationsMember) =
        SupportInquiryListResponse(withReplies(inquiries.findAllByMemberIdOrderByCreatedAtDescIdDesc(member.memberId, NEWEST)))

    /** The status filter runs in the database, so the 100-row limit applies after filtering. */
    @Transactional(readOnly = true)
    fun list(member: OperationsMember, status: SupportInquiryStatus?): SupportInquiryListResponse {
        permissions.requirePermission(member, FEEDBACK)
        return SupportInquiryListResponse(withReplies(when (status) {
            null -> inquiries.findAllByMemberIdIsNotNullOrderByCreatedAtDescIdDesc(NEWEST)
            SupportInquiryStatus.WAITING -> inquiries.findWaitingMemberInquiries(NEWEST)
            SupportInquiryStatus.ANSWERED -> inquiries.findAnsweredMemberInquiries(NEWEST)
        }))
    }

    /** Another member's inquiry is 404, not 403, so ids cannot be probed. */
    @Transactional(readOnly = true)
    fun detail(member: OperationsMember, id: UUID): SupportInquiryResponse {
        val row = inquiry(id)
        if (row.memberId != member.memberId && !permissions.has(member, FEEDBACK)) throw NoSuchElementException("Inquiry not found.")
        return withReplies(row)
    }

    fun reply(member: OperationsMember, id: UUID, request: SupportReplyRequest): SupportInquiryResponse {
        permissions.requirePermission(member, FEEDBACK)
        validateInquiryBody(request.body)
        val row = inquiry(id)
        replies.saveAndFlush(InquiryReplyEntity(inquiryId = id, body = request.body))
        return withReplies(row)
    }

    fun updateReply(member: OperationsMember, id: UUID, replyId: UUID, request: SupportReplyRequest): SupportInquiryResponse {
        permissions.requirePermission(member, FEEDBACK)
        validateInquiryBody(request.body)
        val row = inquiry(id)
        val stored = reply(id, replyId)
        stored.body = request.body
        stored.updatedAt = Instant.now().truncatedTo(ChronoUnit.MICROS)
        replies.saveAndFlush(stored)
        return withReplies(row)
    }

    fun deleteReply(member: OperationsMember, id: UUID, replyId: UUID): SupportInquiryResponse {
        permissions.requirePermission(member, FEEDBACK)
        val row = inquiry(id)
        replies.delete(reply(id, replyId))
        replies.flush()
        return withReplies(row)
    }

    private fun inquiry(id: UUID): InquiryEntity =
        inquiries.findByIdAndMemberIdIsNotNull(id) ?: throw NoSuchElementException("Inquiry not found.")

    /** Scoped by the inquiry, so a reply id belonging to another inquiry is 404. */
    private fun reply(id: UUID, replyId: UUID): InquiryReplyEntity =
        replies.findByIdAndInquiryId(replyId, id) ?: throw NoSuchElementException("Reply not found.")

    /** Loads the replies of every row in one query; the single-row case reuses it. */
    private fun withReplies(rows: List<InquiryEntity>): List<SupportInquiryResponse> {
        if (rows.isEmpty()) return emptyList()
        val byInquiry = replies.findAllByInquiryIdInOrderByCreatedAtAscIdAsc(rows.map { it.id }).groupBy { it.inquiryId }
        return rows.map { it.response(byInquiry[it.id].orEmpty()) }
    }

    private fun withReplies(row: InquiryEntity) = withReplies(listOf(row)).single()

    private fun InquiryEntity.response(answers: List<InquiryReplyEntity>) = SupportInquiryResponse(
        id, checkNotNull(memberId), category, title, body,
        if (answers.isEmpty()) SupportInquiryStatus.WAITING else SupportInquiryStatus.ANSWERED,
        createdAt, updatedAt, answers.map { SupportReplyResponse(it.id, it.body, it.createdAt, it.updatedAt) },
    )
}
