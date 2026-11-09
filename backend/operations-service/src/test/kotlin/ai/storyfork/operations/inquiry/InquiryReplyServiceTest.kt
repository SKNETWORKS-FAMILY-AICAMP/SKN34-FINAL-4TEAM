package ai.storyfork.operations.inquiry

import ai.storyfork.operations._common.blankTexts
import ai.storyfork.operations.inquiry.entity.InquiryReplyEntity
import ai.storyfork.operations.inquiry.repository.InquiryReplyRepository
import ai.storyfork.operations.inquiry.repository.InquiryRepository
import ai.storyfork.operations.inquiry.service.InquiryService
import ai.storyfork.operations.inquiry.service.dto.InquiryReplyRequest
import java.time.Instant
import java.util.UUID
import org.junit.jupiter.api.Assertions.*
import org.junit.jupiter.api.Test
import org.mockito.Mockito.*
import org.springframework.dao.OptimisticLockingFailureException
import org.springframework.data.domain.PageImpl
import org.springframework.data.domain.PageRequest
import org.springframework.data.domain.Sort

class InquiryReplyServiceTest {
    private val inquiries = mock(InquiryRepository::class.java)
    private val replies = mock(InquiryReplyRepository::class.java)
    private val service = InquiryService(inquiries, replies)
    private val inquiryId = UUID.randomUUID()
    private val replyId = UUID.randomUUID()
    private val request = InquiryReplyRequest("답변 본문")

    private fun reply() = InquiryReplyEntity(
        id = replyId, inquiryId = inquiryId, body = "이전 답변",
        createdAt = Instant.parse("2026-01-01T00:00:00Z"),
    )

    @Test
    fun `create reply first checks parent and persists only that parent UUID`() {
        `when`(inquiries.existsById(inquiryId)).thenReturn(true)
        `when`(replies.saveAndFlush(any(InquiryReplyEntity::class.java) ?: reply())).thenAnswer { it.arguments[0] }

        val result = service.createReply(inquiryId, request)

        assertNotNull(result.id)
        assertEquals(inquiryId, result.inquiryId)
        assertEquals(request.body, result.body)
        assertEquals(result.createdAt, result.updatedAt)
        val order = inOrder(inquiries, replies)
        order.verify(inquiries).existsById(inquiryId)
        order.verify(replies).saveAndFlush(any(InquiryReplyEntity::class.java) ?: reply())
    }

    @Test
    fun `reply accepts exactly twenty thousand characters without truncation`() {
        `when`(inquiries.existsById(inquiryId)).thenReturn(true)
        `when`(replies.saveAndFlush(any(InquiryReplyEntity::class.java) ?: reply())).thenAnswer { it.arguments[0] }

        val result = service.createReply(inquiryId, InquiryReplyRequest("b".repeat(20000)))

        assertEquals(20000, result.body.length)
    }

    @Test
    fun `invalid reply creation fails before parent lookup or persistence`() {
        `when`(inquiries.existsById(inquiryId)).thenReturn(true)
        `when`(replies.saveAndFlush(any(InquiryReplyEntity::class.java) ?: reply())).thenAnswer { it.arguments[0] }
        for (body in blankTexts + "답\u0000변") {
            assertThrows(IllegalArgumentException::class.java) { service.createReply(inquiryId, InquiryReplyRequest(body)) }
        }
        verifyNoInteractions(inquiries, replies)
    }

    @Test
    fun `create reply under missing parent fails without writing a reply`() {
        assertThrows(NoSuchElementException::class.java) { service.createReply(inquiryId, request) }
        verifyNoInteractions(replies)
    }

    @Test
    fun `list replies checks parent and queries a bounded stable parent-scoped page`() {
        val bounded = PageRequest.of(0, 100, Sort.by(Sort.Direction.ASC, "createdAt", "id"))
        `when`(inquiries.existsById(inquiryId)).thenReturn(true)
        `when`(replies.findAllByInquiryId(inquiryId, bounded)).thenReturn(PageImpl(listOf(reply()), bounded, 150))

        val result = service.listReplies(inquiryId, PageRequest.of(0, 100, Sort.by("body")))

        assertEquals(listOf(replyId), result.items.map { it.id })
        assertEquals(inquiryId, result.items.single().inquiryId)
        assertEquals(0, result.page)
        assertEquals(100, result.size)
        assertEquals(150L, result.totalElements)
        assertEquals(2, result.totalPages)
        verify(replies).findAllByInquiryId(inquiryId, bounded)
    }

    @Test
    fun `missing parent reply list is not misreported as an empty successful list`() {
        assertThrows(NoSuchElementException::class.java) { service.listReplies(inquiryId, PageRequest.of(0, 20)) }
        verifyNoInteractions(replies)
    }

    @Test
    fun `read reply scopes UUID lookup by parent and returns explicit fields`() {
        val row = reply()
        `when`(replies.findByIdAndInquiryId(replyId, inquiryId)).thenReturn(row)

        val result = service.readReply(inquiryId, replyId)

        assertEquals(replyId, result.id)
        assertEquals(inquiryId, result.inquiryId)
        assertEquals(row.body, result.body)
        assertEquals(row.createdAt, result.createdAt)
        assertEquals(row.updatedAt, result.updatedAt)
        verify(replies, never()).findById(replyId)
    }

    @Test
    fun `reply cannot be read updated or deleted through another inquiry`() {
        val otherParent = UUID.randomUUID()
        `when`(replies.findByIdAndInquiryId(replyId, otherParent)).thenReturn(null)

        assertThrows(NoSuchElementException::class.java) { service.readReply(otherParent, replyId) }
        assertThrows(NoSuchElementException::class.java) { service.updateReply(otherParent, replyId, request) }
        assertThrows(NoSuchElementException::class.java) { service.deleteReply(otherParent, replyId) }

        verify(replies, times(3)).findByIdAndInquiryId(replyId, otherParent)
        verify(replies, never()).findById(replyId)
        verify(replies, never()).saveAndFlush(any(InquiryReplyEntity::class.java) ?: reply())
        verify(replies, never()).delete(any(InquiryReplyEntity::class.java) ?: reply())
        verify(replies, never()).flush()
    }

    @Test
    fun `reply update replaces body but preserves UUID parent and creation time`() {
        val row = reply()
        `when`(replies.findByIdAndInquiryId(replyId, inquiryId)).thenReturn(row)
        `when`(replies.saveAndFlush(row)).thenReturn(row)

        val result = service.updateReply(inquiryId, replyId, request)

        assertEquals(request.body, result.body)
        assertEquals(replyId, result.id)
        assertEquals(inquiryId, result.inquiryId)
        assertEquals(Instant.parse("2026-01-01T00:00:00Z"), result.createdAt)
        assertTrue(result.updatedAt.isAfter(result.createdAt))
        verify(replies).saveAndFlush(row)
    }

    @Test
    fun `invalid reply update preserves original body and timestamps`() {
        val row = reply()
        `when`(replies.findByIdAndInquiryId(replyId, inquiryId)).thenReturn(row)
        `when`(replies.saveAndFlush(row)).thenReturn(row)

        for (body in blankTexts + "답\u0000변") {
            assertThrows(IllegalArgumentException::class.java) { service.updateReply(inquiryId, replyId, InquiryReplyRequest(body)) }
            assertEquals("이전 답변", row.body)
            assertEquals(row.createdAt, row.updatedAt)
        }
        verify(replies, never()).saveAndFlush(row)
    }

    @Test
    fun `reply delete is parent-scoped and flushes the versioned entity deletion`() {
        val row = reply()
        `when`(replies.findByIdAndInquiryId(replyId, inquiryId)).thenReturn(row)

        service.deleteReply(inquiryId, replyId)

        val order = inOrder(replies)
        order.verify(replies).findByIdAndInquiryId(replyId, inquiryId)
        order.verify(replies).delete(row)
        order.verify(replies).flush()
        verifyNoInteractions(inquiries)
    }

    @Test
    fun `missing reply delete fails rather than reporting deletion success`() {
        assertThrows(NoSuchElementException::class.java) { service.deleteReply(inquiryId, replyId) }
        verify(replies, never()).delete(any(InquiryReplyEntity::class.java) ?: reply())
        verify(replies, never()).flush()
    }

    @Test
    fun `optimistic conflict from reply update is propagated`() {
        val row = reply()
        val conflict = OptimisticLockingFailureException("concurrent version")
        `when`(replies.findByIdAndInquiryId(replyId, inquiryId)).thenReturn(row)
        `when`(replies.saveAndFlush(row)).thenThrow(conflict)

        assertSame(conflict, assertThrows(OptimisticLockingFailureException::class.java) {
            service.updateReply(inquiryId, replyId, request)
        })
    }
}
