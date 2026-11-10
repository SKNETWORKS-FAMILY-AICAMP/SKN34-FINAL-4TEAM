package ai.storyfork.operations.notice

import ai.storyfork.operations._common.blankTexts
import ai.storyfork.operations.notice.entity.NoticeEntity
import ai.storyfork.operations.notice.repository.NoticeRepository
import ai.storyfork.operations.notice.service.NoticeService
import ai.storyfork.operations.notice.service.dto.NoticeRequest
import java.time.Instant
import java.time.temporal.ChronoUnit
import java.util.Optional
import java.util.UUID
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertFalse
import org.junit.jupiter.api.Assertions.assertSame
import org.junit.jupiter.api.Assertions.assertThrows
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.Test
import org.junit.jupiter.params.ParameterizedTest
import org.junit.jupiter.params.provider.MethodSource
import org.mockito.ArgumentMatchers.any
import org.mockito.Mockito.doAnswer
import org.mockito.Mockito.doThrow
import org.mockito.Mockito.mock
import org.mockito.Mockito.verify
import org.mockito.Mockito.verifyNoInteractions
import org.mockito.Mockito.`when`
import org.springframework.data.domain.PageImpl
import org.springframework.data.domain.PageRequest
import org.springframework.data.domain.Sort
import org.springframework.orm.ObjectOptimisticLockingFailureException

/** Spring·HTTP·DB 없이 공지 저장소를 대역으로 격리하는 단위 회귀 테스트다. */
class NoticeServiceTest {
    private val repository = mock(NoticeRepository::class.java)
    private val service = NoticeService(repository)
    private val sort = Sort.by(Sort.Order.desc("createdAt"), Sort.Order.desc("id"))

    @Test
    fun `create persists plain text without altering its whitespace`() {
        var saved: NoticeEntity? = null
        doAnswer { invocation ->
            invocation.getArgument<NoticeEntity>(0).also { saved = it }
        }.`when`(repository).saveAndFlush(any())
        val before = Instant.now().truncatedTo(ChronoUnit.MICROS)
        val request = NoticeRequest(" 공지 제목 ", "<b>문자 그대로</b>\n 본문 ")

        val result = service.create(request)

        val entity = requireNotNull(saved)
        assertEquals(entity.id, result.id)
        assertEquals(request.title, entity.title)
        assertEquals(request.body, result.body)
        assertEquals(entity.createdAt, result.createdAt)
        assertEquals(result.createdAt, result.updatedAt)
        assertEquals(result.createdAt.truncatedTo(ChronoUnit.MICROS), result.createdAt)
        assertFalse(result.createdAt.isBefore(before))
        assertFalse(result.createdAt.isAfter(Instant.now()))
    }

    @Test
    fun `maximum title and body lengths are accepted`() {
        doAnswer { it.getArgument<NoticeEntity>(0) }.`when`(repository).saveAndFlush(any())
        val request = NoticeRequest("가".repeat(200), "나".repeat(20_000))

        val result = service.create(request)

        assertEquals(request.title, result.title)
        assertEquals(request.body, result.body)
    }

    @ParameterizedTest
    @MethodSource("invalidRequests")
    fun `create rejects invalid content before accessing persistence`(request: NoticeRequest) {
        doAnswer { it.getArgument<NoticeEntity>(0) }.`when`(repository).saveAndFlush(any())

        assertThrows(IllegalArgumentException::class.java) { service.create(request) }

        verifyNoInteractions(repository)
    }

    @Test
    fun `read maps the persisted notice to an explicit response`() {
        val entity = notice()
        `when`(repository.findById(entity.id)).thenReturn(Optional.of(entity))

        val result = service.read(entity.id)

        assertEquals(entity.id, result.id)
        assertEquals(entity.title, result.title)
        assertEquals(entity.body, result.body)
        assertEquals(entity.createdAt, result.createdAt)
        assertEquals(entity.updatedAt, result.updatedAt)
    }

    @Test
    fun `list returns explicit page metadata`() {
        val entity = notice()
        val bounded = PageRequest.of(0, 20, sort)
        `when`(repository.findAll(bounded)).thenReturn(PageImpl(listOf(entity), bounded, 21))

        val result = service.list(PageRequest.of(0, 20))

        assertEquals(listOf(entity.id), result.items.map { it.id })
        assertEquals(0, result.page)
        assertEquals(20, result.size)
        assertEquals(21L, result.totalElements)
        assertEquals(2, result.totalPages)
        verify(repository).findAll(bounded)
    }

    @Test
    fun `list ignores the caller sort and uses a stable timestamp and UUID sort`() {
        val requested = PageRequest.of(2, 100, Sort.by("title"))
        val bounded = PageRequest.of(2, 100, sort)
        `when`(repository.findAll(bounded)).thenReturn(PageImpl(emptyList(), bounded, 0))

        val result = service.list(requested)

        assertEquals(2, result.page)
        assertEquals(100, result.size)
        assertTrue(result.items.isEmpty())
        verify(repository).findAll(bounded)
    }

    @Test
    fun `update replaces title and body while preserving identity and creation time`() {
        val entity = notice()
        val createdAt = entity.createdAt
        val before = Instant.now().truncatedTo(ChronoUnit.MICROS)
        `when`(repository.findById(entity.id)).thenReturn(Optional.of(entity))
        `when`(repository.saveAndFlush(entity)).thenReturn(entity)

        val result = service.update(entity.id, NoticeRequest("새 제목", "새 본문"))

        assertEquals(entity.id, result.id)
        assertEquals(createdAt, result.createdAt)
        assertEquals("새 제목", result.title)
        assertEquals("새 본문", result.body)
        assertFalse(result.updatedAt.isBefore(before))
        assertEquals(result.updatedAt.truncatedTo(ChronoUnit.MICROS), result.updatedAt)
        verify(repository).saveAndFlush(entity)
    }

    @ParameterizedTest
    @MethodSource("invalidRequests")
    fun `update validates every field before reading or mutating the notice`(request: NoticeRequest) {
        val entity = notice()

        assertThrows(IllegalArgumentException::class.java) { service.update(entity.id, request) }

        assertEquals("기존 제목", entity.title)
        assertEquals("기존 본문", entity.body)
        verifyNoInteractions(repository)
    }

    @Test
    fun `missing read update and delete return not found`() {
        val id = UUID.randomUUID()
        `when`(repository.findById(id)).thenReturn(Optional.empty())
        val actions = listOf<() -> Unit>(
            { service.read(id) },
            { service.update(id, NoticeRequest("제목", "본문")) },
            { service.delete(id) },
        )

        actions.forEach { action ->
            assertThrows(NoSuchElementException::class.java) { action() }
        }
    }

    @Test
    fun `delete removes the loaded versioned entity`() {
        val entity = notice()
        `when`(repository.findById(entity.id)).thenReturn(Optional.of(entity))

        service.delete(entity.id)

        verify(repository).delete(entity)
    }

    @Test
    fun `an optimistic update conflict is propagated for the shared 409 handler`() {
        val entity = notice()
        val conflict = ObjectOptimisticLockingFailureException(NoticeEntity::class.java, entity.id)
        `when`(repository.findById(entity.id)).thenReturn(Optional.of(entity))
        `when`(repository.saveAndFlush(entity)).thenThrow(conflict)

        val failure = assertThrows(ObjectOptimisticLockingFailureException::class.java) {
            service.update(entity.id, NoticeRequest("제목", "본문"))
        }

        assertSame(conflict, failure)
    }

    @Test
    fun `a persistence failure is not replaced with a successful response`() {
        val entity = notice()
        val failure = IllegalStateException("persistence unavailable")
        `when`(repository.findById(entity.id)).thenReturn(Optional.of(entity))
        doThrow(failure).`when`(repository).delete(entity)

        assertSame(failure, assertThrows(IllegalStateException::class.java) { service.delete(entity.id) })
    }

    private fun notice() = NoticeEntity(
        title = "기존 제목",
        body = "기존 본문",
        createdAt = Instant.parse("2026-01-01T00:00:00Z"),
    )

    companion object {
        // 길이는 NoticeRequest의 @Size가 거절한다(RequestValidationTest). 서비스는 공백(@NotBlank가 놓치는 NBSP류 포함)과 U+0000을 거절한다.
        @JvmStatic
        fun invalidRequests(): List<NoticeRequest> =
            blankTexts.flatMap { listOf(NoticeRequest(it, "본문"), NoticeRequest("제목", it)) } + listOf(
                NoticeRequest("제\u0000목", "본문"),
                NoticeRequest("제목", "본\u0000문"),
            )
    }
}
