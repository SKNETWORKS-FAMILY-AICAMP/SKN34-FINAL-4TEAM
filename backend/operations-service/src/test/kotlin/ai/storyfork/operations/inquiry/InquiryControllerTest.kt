package ai.storyfork.operations.inquiry

import ai.storyfork.operations.inquiry.controller.InquiryController
import ai.storyfork.operations.inquiry.service.InquiryService
import ai.storyfork.operations.inquiry.service.dto.InquiryReplyRequest
import ai.storyfork.operations.inquiry.service.dto.InquiryReplyResponse
import ai.storyfork.operations.inquiry.service.dto.InquiryRequest
import ai.storyfork.operations.inquiry.service.dto.InquiryResponse
import java.time.Instant
import java.util.UUID
import org.junit.jupiter.api.Assertions.*
import org.junit.jupiter.api.Test
import org.mockito.Mockito.*

class InquiryControllerTest {
    private val service = mock(InquiryService::class.java)
    private val controller = InquiryController(service)
    private val inquiryId = UUID.randomUUID()
    private val replyId = UUID.randomUUID()

    @Test
    fun `inquiry creation returns 201 and the new resource Location`() {
        val request = InquiryRequest("제목", "본문", "분류")
        val response = InquiryResponse(inquiryId, request.title, request.body, request.category, Instant.EPOCH, Instant.EPOCH)
        `when`(service.create(request)).thenReturn(response)

        val result = controller.create(request)

        assertEquals(201, result.statusCode.value())
        assertEquals("/api/v1/operations/inquiries/$inquiryId", result.headers.location.toString())
        assertSame(response, result.body)
    }

    @Test
    fun `reply creation returns 201 with the nested parent-scoped Location`() {
        val request = InquiryReplyRequest("답변")
        val response = InquiryReplyResponse(replyId, inquiryId, request.body, Instant.EPOCH, Instant.EPOCH)
        `when`(service.createReply(inquiryId, request)).thenReturn(response)

        val result = controller.createReply(inquiryId, request)

        assertEquals(201, result.statusCode.value())
        assertEquals("/api/v1/operations/inquiries/$inquiryId/replies/$replyId", result.headers.location.toString())
        assertSame(response, result.body)
    }

    @Test
    fun `reply mutations forward both parent and reply UUIDs`() {
        val request = InquiryReplyRequest("새 답변")
        val response = InquiryReplyResponse(replyId, inquiryId, request.body, Instant.EPOCH, Instant.EPOCH)
        `when`(service.updateReply(inquiryId, replyId, request)).thenReturn(response)

        assertSame(response, controller.updateReply(inquiryId, replyId, request))
        controller.deleteReply(inquiryId, replyId)

        verify(service).updateReply(inquiryId, replyId, request)
        verify(service).deleteReply(inquiryId, replyId)
    }
}
