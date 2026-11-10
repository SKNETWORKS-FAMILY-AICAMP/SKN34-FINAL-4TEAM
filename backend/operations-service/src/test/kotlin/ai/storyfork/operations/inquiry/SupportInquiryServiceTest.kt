package ai.storyfork.operations.inquiry

import ai.storyfork.operations._common.blankTexts
import ai.storyfork.operations.inquiry.entity.InquiryEntity
import ai.storyfork.operations.inquiry.entity.InquiryReplyEntity
import ai.storyfork.operations.inquiry.repository.InquiryReplyRepository
import ai.storyfork.operations.inquiry.repository.InquiryRepository
import ai.storyfork.operations.inquiry.service.SupportInquiryService
import ai.storyfork.operations.inquiry.service.dto.SupportInquiryRequest
import ai.storyfork.operations.inquiry.service.dto.SupportInquiryStatus.ANSWERED
import ai.storyfork.operations.inquiry.service.dto.SupportInquiryStatus.WAITING
import ai.storyfork.operations.inquiry.service.dto.SupportReplyRequest
import ai.storyfork.operations.member.repository.AdminPermissionRepository
import ai.storyfork.operations.security.OperationsMember
import java.time.Instant
import java.util.Optional
import java.util.UUID
import org.junit.jupiter.api.Assertions.*
import org.junit.jupiter.api.Test
import org.mockito.ArgumentCaptor
import org.mockito.Mockito.*
import org.springframework.data.domain.PageRequest
import org.springframework.http.HttpStatus
import org.springframework.web.server.ResponseStatusException

/** Mocked repositories: no Spring context, HTTP or database. */
class SupportInquiryServiceTest {
    private val inquiries = mock(InquiryRepository::class.java)
    private val replies = mock(InquiryReplyRepository::class.java)
    private val permissions = mock(AdminPermissionRepository::class.java)
    private val service = SupportInquiryService(inquiries, replies, permissions)

    private val author = OperationsMember(UUID.randomUUID(), false)
    private val stranger = OperationsMember(UUID.randomUUID(), false)
    private val admin = OperationsMember(UUID.randomUUID(), true)
    private val operatorWithoutFeedback = OperationsMember(UUID.randomUUID(), true)
    private val newest = PageRequest.ofSize(100)
    private val inquiryId = UUID.randomUUID()
    private val replyId = UUID.randomUUID()
    private val answer = SupportReplyRequest("답변 본문")

    private fun inquiry(id: UUID = inquiryId, owner: UUID? = author.memberId) = InquiryEntity(
        id = id, title = "제목", body = "본문", category = "이용", memberId = owner, createdAt = Instant.parse("2026-01-01T00:00:00Z"),
    )

    private fun reply(id: UUID = replyId, parent: UUID = inquiryId, text: String = "답변") =
        InquiryReplyEntity(id = id, inquiryId = parent, body = text, createdAt = Instant.parse("2026-01-02T00:00:00Z"))

    private fun givenInquiry(row: InquiryEntity = inquiry()): InquiryEntity = row.also {
        `when`(inquiries.findByIdAndMemberIdIsNotNull(it.id)).thenReturn(it)
    }

    private fun givenReplies(parents: List<UUID>, vararg rows: InquiryReplyEntity) {
        `when`(replies.findAllByInquiryIdInOrderByCreatedAtAscIdAsc(parents)).thenReturn(rows.toList())
    }

    private fun givenFeedback() {
        `when`(permissions.existsByMemberIdAndPermission(admin.memberId, "feedback")).thenReturn(true)
        // A non-operator must stay denied even if a stale permission row exists.
        `when`(permissions.existsByMemberIdAndPermission(author.memberId, "feedback")).thenReturn(true)
        `when`(permissions.existsByMemberIdAndPermission(stranger.memberId, "feedback")).thenReturn(true)
    }

    private fun assertStatus(status: HttpStatus, call: () -> Unit) {
        assertEquals(status, assertThrows(ResponseStatusException::class.java) { call() }.statusCode)
    }

    @Test
    fun `create stores the caller as owner with trimmed category and title and starts WAITING`() {
        `when`(inquiries.saveAndFlush(any(InquiryEntity::class.java) ?: inquiry())).thenAnswer { it.arguments[0] }

        val result = service.create(author, SupportInquiryRequest(" 이용 ", " 로그인 문의 ", " 본문 "))

        val captor = ArgumentCaptor.forClass(InquiryEntity::class.java)
        verify(inquiries).saveAndFlush(captor.capture())
        assertEquals(author.memberId, captor.value.memberId)
        assertEquals("이용", captor.value.category)
        assertEquals("로그인 문의", captor.value.title)
        assertEquals(" 본문 ", captor.value.body)
        assertEquals(author.memberId, result.memberId)
        assertEquals(WAITING, result.status)
        assertTrue(result.replies.isEmpty())
        assertEquals(result.createdAt, result.updatedAt)
        verifyNoInteractions(replies, permissions)
    }

    // 길이는 요청 DTO의 @Size가 거절한다(RequestValidationTest). 서비스는 공백(@NotBlank가 놓치는 NBSP류 포함)과 U+0000을 거절한다.
    @Test
    fun `create rejects blank or NUL fields before saving anything`() {
        val ok = SupportInquiryRequest("이용", "제목", "본문")
        val invalid = blankTexts.flatMap { listOf(ok.copy(category = it), ok.copy(title = it), ok.copy(body = it)) } + listOf(
            ok.copy(category = "이\u0000용"), ok.copy(title = "제\u0000목"), ok.copy(body = "본\u0000문"),
        )

        invalid.forEach { assertThrows(IllegalArgumentException::class.java) { service.create(author, it) } }

        verifyNoInteractions(inquiries, replies)
    }

    @Test
    fun `mine returns only the callers inquiries newest first with all replies loaded in one query`() {
        val newer = inquiry(id = UUID.randomUUID())
        val older = inquiry(id = UUID.randomUUID())
        `when`(inquiries.findAllByMemberIdOrderByCreatedAtDescIdDesc(author.memberId, newest)).thenReturn(listOf(newer, older))
        givenReplies(listOf(newer.id, older.id), reply(UUID.randomUUID(), newer.id, "첫 답변"), reply(UUID.randomUUID(), newer.id, "둘째 답변"))

        val result = service.mine(author)

        assertEquals(listOf(newer.id, older.id), result.items.map { it.id })
        assertEquals(listOf(ANSWERED, WAITING), result.items.map { it.status })
        assertEquals(listOf("첫 답변", "둘째 답변"), result.items[0].replies.map { it.body })
        assertTrue(result.items[1].replies.isEmpty())
        verify(replies).findAllByInquiryIdInOrderByCreatedAtAscIdAsc(listOf(newer.id, older.id))
        verifyNoMoreInteractions(replies)
        verifyNoInteractions(permissions)
    }

    @Test
    fun `mine with no inquiries skips the reply lookup`() {
        `when`(inquiries.findAllByMemberIdOrderByCreatedAtDescIdDesc(author.memberId, newest)).thenReturn(emptyList())

        assertTrue(service.mine(author).items.isEmpty())

        verifyNoInteractions(replies)
    }

    @Test
    fun `detail maps the SupportInquiry fields for the author and for feedback admins`() {
        val row = givenInquiry()
        givenFeedback()
        val stored = reply(text = "첫 답변")
        givenReplies(listOf(inquiryId), stored, reply(UUID.randomUUID(), text = "둘째 답변"))

        for (viewer in listOf(author, admin)) {
            val result = service.detail(viewer, inquiryId)

            assertEquals(inquiryId, result.id)
            assertEquals(author.memberId, result.memberId)
            assertEquals(listOf(row.category, row.title, row.body), listOf(result.category, result.title, result.body))
            assertEquals(listOf(row.createdAt, row.updatedAt), listOf(result.createdAt, result.updatedAt))
            assertEquals(ANSWERED, result.status)
            assertEquals(listOf("첫 답변", "둘째 답변"), result.replies.map { it.body })
            assertEquals(listOf(replyId, stored.createdAt, stored.updatedAt),
                result.replies[0].let { listOf(it.id, it.createdAt, it.updatedAt) })
        }
    }

    @Test
    fun `detail without replies is WAITING and the author needs no permission lookup`() {
        givenInquiry()
        givenReplies(listOf(inquiryId))

        val result = service.detail(author, inquiryId)

        assertEquals(WAITING, result.status)
        assertTrue(result.replies.isEmpty())
        verifyNoInteractions(permissions)
    }

    @Test
    fun `detail hides other peoples inquiries as not found`() {
        givenInquiry()
        givenFeedback()

        for (viewer in listOf(stranger, operatorWithoutFeedback)) {
            assertThrows(NoSuchElementException::class.java) { service.detail(viewer, inquiryId) }
        }

        verifyNoInteractions(replies)
    }

    @Test
    fun `legacy service token inquiries without an owner are not found for admins or members`() {
        givenFeedback()
        // An unfiltered lookup would find the row; the member API must only use the member_id IS NOT NULL query.
        `when`(inquiries.findById(inquiryId)).thenReturn(Optional.of(inquiry(owner = null)))

        assertThrows(NoSuchElementException::class.java) { service.detail(admin, inquiryId) }
        assertThrows(NoSuchElementException::class.java) { service.detail(author, inquiryId) }
        assertThrows(NoSuchElementException::class.java) { service.reply(admin, inquiryId, answer) }
        assertThrows(NoSuchElementException::class.java) { service.updateReply(admin, inquiryId, replyId, answer) }
        assertThrows(NoSuchElementException::class.java) { service.deleteReply(admin, inquiryId, replyId) }

        verifyNoInteractions(replies)
    }

    @Test
    fun `admin list is limited to operators holding feedback permission`() {
        givenFeedback()

        for (viewer in listOf(author, stranger, operatorWithoutFeedback)) {
            assertStatus(HttpStatus.FORBIDDEN) { service.list(viewer, null) }
        }

        verifyNoInteractions(inquiries, replies)
    }

    @Test
    fun `admin list filters by status in the database so the limit applies after filtering`() {
        givenFeedback()
        val waiting = inquiry(id = UUID.randomUUID())
        val answered = inquiry(id = UUID.randomUUID())
        `when`(inquiries.findWaitingMemberInquiries(newest)).thenReturn(listOf(waiting))
        `when`(inquiries.findAnsweredMemberInquiries(newest)).thenReturn(listOf(answered))
        `when`(inquiries.findAllByMemberIdIsNotNullOrderByCreatedAtDescIdDesc(newest)).thenReturn(listOf(answered, waiting))
        givenReplies(listOf(waiting.id))
        givenReplies(listOf(answered.id), reply(parent = answered.id))
        givenReplies(listOf(answered.id, waiting.id), reply(parent = answered.id))

        assertEquals(listOf(waiting.id to WAITING), service.list(admin, WAITING).items.map { it.id to it.status })
        assertEquals(listOf(answered.id to ANSWERED), service.list(admin, ANSWERED).items.map { it.id to it.status })
        assertEquals(listOf(answered.id to ANSWERED, waiting.id to WAITING), service.list(admin, null).items.map { it.id to it.status })

        verify(inquiries).findWaitingMemberInquiries(newest)
        verify(inquiries).findAnsweredMemberInquiries(newest)
        verify(inquiries).findAllByMemberIdIsNotNullOrderByCreatedAtDescIdDesc(newest)
        verifyNoMoreInteractions(inquiries)
    }

    @Test
    fun `reply endpoints are admin only and answer 403 before validating or looking anything up`() {
        givenFeedback()

        for (viewer in listOf(author, stranger, operatorWithoutFeedback)) {
            assertStatus(HttpStatus.FORBIDDEN) { service.reply(viewer, inquiryId, answer) }
            assertStatus(HttpStatus.FORBIDDEN) { service.updateReply(viewer, inquiryId, replyId, answer) }
            assertStatus(HttpStatus.FORBIDDEN) { service.deleteReply(viewer, inquiryId, replyId) }
        }
        assertStatus(HttpStatus.FORBIDDEN) { service.reply(author, inquiryId, SupportReplyRequest(" ")) }

        verifyNoInteractions(inquiries, replies)
    }

    @Test
    fun `invalid reply bodies are rejected before touching replies`() {
        givenInquiry()
        givenFeedback()

        for (text in blankTexts + "답\u0000변") {
            assertThrows(IllegalArgumentException::class.java) { service.reply(admin, inquiryId, SupportReplyRequest(text)) }
            assertThrows(IllegalArgumentException::class.java) { service.updateReply(admin, inquiryId, replyId, SupportReplyRequest(text)) }
        }

        verifyNoInteractions(replies)
    }

    @Test
    fun `reply stores the answer under the inquiry and returns the whole inquiry as ANSWERED`() {
        val row = givenInquiry()
        givenFeedback()
        val stored = mutableListOf<InquiryReplyEntity>()
        `when`(replies.saveAndFlush(any(InquiryReplyEntity::class.java) ?: reply())).thenAnswer {
            (it.arguments[0] as InquiryReplyEntity).also { saved -> stored.add(saved) }
        }
        `when`(replies.findAllByInquiryIdInOrderByCreatedAtAscIdAsc(listOf(inquiryId))).thenAnswer { stored.toList() }

        val result = service.reply(admin, inquiryId, answer)

        assertEquals(listOf(inquiryId to "답변 본문"), stored.map { it.inquiryId to it.body })
        assertEquals(ANSWERED, result.status)
        assertEquals(listOf("답변 본문"), result.replies.map { it.body })
        assertEquals(row.updatedAt, result.updatedAt)
        verify(inquiries, never()).saveAndFlush(any(InquiryEntity::class.java) ?: row)
    }

    @Test
    fun `update replaces only the reply body and refreshes its updatedAt`() {
        val row = givenInquiry()
        givenFeedback()
        val stored = reply(text = "이전 답변")
        `when`(replies.findByIdAndInquiryId(replyId, inquiryId)).thenReturn(stored)
        `when`(replies.saveAndFlush(stored)).thenReturn(stored)
        givenReplies(listOf(inquiryId), stored)

        val result = service.updateReply(admin, inquiryId, replyId, SupportReplyRequest("수정한 답변"))

        assertEquals(listOf("수정한 답변"), result.replies.map { it.body })
        assertEquals(stored.createdAt, result.replies.single().createdAt)
        assertTrue(result.replies.single().updatedAt.isAfter(stored.createdAt))
        assertEquals(ANSWERED, result.status)
        assertEquals(row.updatedAt, result.updatedAt)
        verify(inquiries, never()).saveAndFlush(any(InquiryEntity::class.java) ?: row)
    }

    @Test
    fun `a reply id from another inquiry is not found and nothing changes`() {
        givenInquiry()
        givenFeedback()
        // An unscoped lookup would find the reply of another inquiry; only the (id, inquiryId) lookup may be used.
        `when`(replies.findById(replyId)).thenReturn(Optional.of(reply(parent = UUID.randomUUID())))

        assertThrows(NoSuchElementException::class.java) { service.updateReply(admin, inquiryId, replyId, answer) }
        assertThrows(NoSuchElementException::class.java) { service.deleteReply(admin, inquiryId, replyId) }

        verify(replies, times(2)).findByIdAndInquiryId(replyId, inquiryId)
        verify(replies, never()).saveAndFlush(any(InquiryReplyEntity::class.java) ?: reply())
        verify(replies, never()).delete(any(InquiryReplyEntity::class.java) ?: reply())
        verify(replies, never()).flush()
    }

    @Test
    fun `deleting the only reply flushes first and turns the inquiry back to WAITING`() {
        givenInquiry()
        givenFeedback()
        val stored = reply()
        `when`(replies.findByIdAndInquiryId(replyId, inquiryId)).thenReturn(stored)
        givenReplies(listOf(inquiryId))

        val result = service.deleteReply(admin, inquiryId, replyId)

        assertEquals(WAITING, result.status)
        assertTrue(result.replies.isEmpty())
        val order = inOrder(replies)
        order.verify(replies).delete(stored)
        order.verify(replies).flush()
        order.verify(replies).findAllByInquiryIdInOrderByCreatedAtAscIdAsc(listOf(inquiryId))
    }

    @Test
    fun `deleting one of several replies keeps the inquiry ANSWERED`() {
        givenInquiry()
        givenFeedback()
        val remaining = reply(UUID.randomUUID(), text = "남은 답변")
        `when`(replies.findByIdAndInquiryId(replyId, inquiryId)).thenReturn(reply())
        givenReplies(listOf(inquiryId), remaining)

        val result = service.deleteReply(admin, inquiryId, replyId)

        assertEquals(ANSWERED, result.status)
        assertEquals(listOf("남은 답변"), result.replies.map { it.body })
    }
}
