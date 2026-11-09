package ai.storyfork.operations.inquiry

import ai.storyfork.operations.inquiry.entity.InquiryEntity
import ai.storyfork.operations.inquiry.repository.InquiryReplyRepository
import ai.storyfork.operations.inquiry.repository.InquiryRepository
import ai.storyfork.operations.inquiry.service.InquiryService
import ai.storyfork.operations.inquiry.service.dto.InquiryRequest
import java.time.Instant
import java.util.Optional
import java.util.UUID
import java.util.stream.Stream
import org.junit.jupiter.api.Assertions.*
import org.junit.jupiter.api.Test
import org.junit.jupiter.params.ParameterizedTest
import org.junit.jupiter.params.provider.MethodSource
import org.mockito.Mockito.*
import org.springframework.dao.DataIntegrityViolationException
import org.springframework.dao.OptimisticLockingFailureException
import org.springframework.data.domain.PageImpl
import org.springframework.data.domain.PageRequest
import org.springframework.data.domain.Sort
import org.springframework.web.server.ResponseStatusException

class InquiryServiceTest {
    private val inquiries = mock(InquiryRepository::class.java)
    private val replies = mock(InquiryReplyRepository::class.java)
    private val service = InquiryService(inquiries, replies)
    private val id = UUID.randomUUID()
    private val request = InquiryRequest("문의 제목", "문의 본문", "자유 분류")

    private fun inquiry() = InquiryEntity(
        id = id, title = "이전 제목", body = "이전 본문", category = "이전 분류",
        createdAt = Instant.parse("2026-01-01T00:00:00Z"),
    )

    @Test
    fun `create stores operator record and returns a UUID and UTC timestamps`() {
        `when`(inquiries.saveAndFlush(any(InquiryEntity::class.java) ?: inquiry())).thenAnswer { it.arguments[0] }
        val before = Instant.now()

        val result = service.create(InquiryRequest(" 문의 제목 ", " 문의 본문 ", " 자유 분류 "))

        assertNotNull(result.id)
        assertEquals("문의 제목", result.title)
        assertEquals(" 문의 본문 ", result.body)
        assertEquals("자유 분류", result.category)
        assertFalse(result.createdAt.isBefore(before.minusMillis(1)))
        assertFalse(result.createdAt.isAfter(Instant.now()))
        assertEquals(result.createdAt, result.updatedAt)
        verifyNoInteractions(replies)
    }

    @Test
    fun `create accepts the inclusive title body and category bounds`() {
        `when`(inquiries.saveAndFlush(any(InquiryEntity::class.java) ?: inquiry())).thenAnswer { it.arguments[0] }

        val result = service.create(InquiryRequest("t".repeat(200), "b".repeat(20000), "c".repeat(50)))

        assertEquals(200, result.title.length)
        assertEquals(20000, result.body.length)
        assertEquals(50, result.category.length)
    }

    @ParameterizedTest
    @MethodSource("nullCharacterRequests")
    fun `null character creation is rejected before touching repositories`(input: InquiryRequest) {
        `when`(inquiries.saveAndFlush(any(InquiryEntity::class.java) ?: inquiry())).thenAnswer { it.arguments[0] }

        assertThrows(IllegalArgumentException::class.java) { service.create(input) }

        verifyNoInteractions(inquiries, replies)
    }

    @ParameterizedTest
    @MethodSource("nullCharacterRequests")
    fun `null character update preserves every original field`(input: InquiryRequest) {
        val row = inquiry()
        val updatedAt = row.updatedAt
        `when`(inquiries.findById(id)).thenReturn(Optional.of(row))
        `when`(inquiries.saveAndFlush(row)).thenReturn(row)

        assertThrows(IllegalArgumentException::class.java) { service.update(id, input) }

        assertEquals("이전 제목", row.title)
        assertEquals("이전 본문", row.body)
        assertEquals("이전 분류", row.category)
        assertEquals(updatedAt, row.updatedAt)
        verifyNoInteractions(inquiries, replies)
    }

    @Test
    fun `list overrides client sort with stable creation time and UUID order`() {
        val bounded = PageRequest.of(2, 100, Sort.by(Sort.Direction.DESC, "createdAt", "id"))
        `when`(inquiries.findAll(bounded)).thenReturn(PageImpl(listOf(inquiry()), bounded, 501))

        val result = service.list(PageRequest.of(2, 100, Sort.by("body")))

        assertEquals(listOf(id), result.items.map { it.id })
        assertEquals(2, result.page)
        assertEquals(100, result.size)
        assertEquals(501L, result.totalElements)
        assertEquals(6, result.totalPages)
        verify(inquiries).findAll(bounded)
    }

    @Test
    fun `read returns explicit record fields`() {
        val row = inquiry()
        `when`(inquiries.findById(id)).thenReturn(Optional.of(row))

        val result = service.read(id)

        assertEquals(id, result.id)
        assertEquals(row.title, result.title)
        assertEquals(row.body, result.body)
        assertEquals(row.category, result.category)
        assertEquals(row.createdAt, result.createdAt)
        assertEquals(row.updatedAt, result.updatedAt)
    }

    @Test
    fun `read missing inquiry fails instead of returning an empty record`() {
        `when`(inquiries.findById(id)).thenReturn(Optional.empty())
        assertThrows(NoSuchElementException::class.java) { service.read(id) }
    }

    @Test
    fun `update replaces all writable fields but preserves UUID and creation time`() {
        val row = inquiry()
        `when`(inquiries.findById(id)).thenReturn(Optional.of(row))
        `when`(inquiries.saveAndFlush(row)).thenReturn(row)

        val result = service.update(id, request)

        assertEquals(id, result.id)
        assertEquals(request.title, result.title)
        assertEquals(request.body, result.body)
        assertEquals(request.category, result.category)
        assertEquals(Instant.parse("2026-01-01T00:00:00Z"), result.createdAt)
        assertTrue(result.updatedAt.isAfter(result.createdAt))
        verify(inquiries).saveAndFlush(row)
    }

    @Test
    fun `update missing inquiry does not upsert`() {
        `when`(inquiries.findById(id)).thenReturn(Optional.empty())

        assertThrows(NoSuchElementException::class.java) { service.update(id, request) }

        verify(inquiries, never()).saveAndFlush(any(InquiryEntity::class.java) ?: inquiry())
    }

    @Test
    fun `delete removes and flushes an inquiry with no replies`() {
        val row = inquiry()
        `when`(inquiries.findById(id)).thenReturn(Optional.of(row))
        `when`(replies.existsByInquiryId(id)).thenReturn(false)

        service.delete(id)

        val order = inOrder(replies, inquiries)
        order.verify(inquiries).findById(id)
        order.verify(replies).existsByInquiryId(id)
        order.verify(inquiries).delete(row)
        order.verify(inquiries).flush()
        verify(replies, never()).deleteAll()
    }

    @Test
    fun `delete refuses an inquiry with replies and instructs explicit reply-first deletion`() {
        val row = inquiry()
        `when`(inquiries.findById(id)).thenReturn(Optional.of(row))
        `when`(replies.existsByInquiryId(id)).thenReturn(true)

        val failure = assertThrows(ResponseStatusException::class.java) { service.delete(id) }

        assertEquals(409, failure.statusCode.value())
        assertEquals("Delete replies first.", failure.reason)
        verify(inquiries, never()).delete(row)
        verify(inquiries, never()).flush()
        verify(replies, never()).deleteAll()
    }

    @Test
    fun `delete missing inquiry does not inspect replies`() {
        `when`(inquiries.findById(id)).thenReturn(Optional.empty())

        assertThrows(NoSuchElementException::class.java) { service.delete(id) }

        verifyNoInteractions(replies)
    }

    @Test
    fun `optimistic conflict from update is not swallowed`() {
        val row = inquiry()
        val conflict = OptimisticLockingFailureException("concurrent version")
        `when`(inquiries.findById(id)).thenReturn(Optional.of(row))
        `when`(inquiries.saveAndFlush(row)).thenThrow(conflict)

        assertSame(conflict, assertThrows(OptimisticLockingFailureException::class.java) { service.update(id, request) })
    }

    @Test
    fun `reply creation racing with inquiry deletion remains an integrity conflict`() {
        val row = inquiry()
        val conflict = DataIntegrityViolationException("reply foreign key")
        `when`(inquiries.findById(id)).thenReturn(Optional.of(row))
        doThrow(conflict).`when`(inquiries).flush()

        assertSame(conflict, assertThrows(DataIntegrityViolationException::class.java) { service.delete(id) })
    }

    companion object {
        @JvmStatic
        fun nullCharacterRequests(): Stream<InquiryRequest> = Stream.of(
            InquiryRequest("제\u0000목", "본문", "분류"),
            InquiryRequest("제목", "본\u0000문", "분류"),
            InquiryRequest("제목", "본문", "분\u0000류"),
        )
    }
}
