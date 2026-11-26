package ai.storyfork.core.notification

import ai.storyfork.core.auth.repository.MemberRepository
import ai.storyfork.core.notification.domain.NoticeEventType
import ai.storyfork.core.notification.domain.NoticeKind
import ai.storyfork.core.notification.entity.NoticeEntity
import ai.storyfork.core.notification.entity.NoticePreferenceEntity
import ai.storyfork.core.notification.repository.NoticePreferenceRepository
import ai.storyfork.core.notification.repository.NoticeRepository
import ai.storyfork.core.notification.service.NoticeService
import ai.storyfork.core.notification.service.NoticeStream
import ai.storyfork.core.notification.service.dto.NoticeCreateRequest
import java.time.Instant
import java.time.temporal.ChronoUnit
import java.util.UUID
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertNull
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.Test
import org.mockito.ArgumentMatchers
import org.mockito.Mockito.mock
import org.mockito.Mockito.mockingDetails
import org.mockito.Mockito.verify
import org.mockito.Mockito.verifyNoInteractions
import org.mockito.Mockito.`when`
import org.springframework.data.domain.PageRequest
import org.springframework.transaction.support.TransactionSynchronizationManager

/**
 * ai-tool 알림 묶음 규칙(#553 결정 5)을 DB 없이 확인한다. '읽지 않은'·'삭제되지 않은' 조건과 시각 갱신 자체는
 * 저장소 쿼리의 몫이라 NoticeEventIntegrationTest가 실제 DB로 확인한다.
 */
class NoticeBundleServiceTest {
    private val me = UUID.randomUUID()
    private val notices = mock(NoticeRepository::class.java)
    private val preferences = mock(NoticePreferenceRepository::class.java)
    private val stream = mock(NoticeStream::class.java)
    private val service = NoticeService(notices, preferences, mock(MemberRepository::class.java), stream)

    private fun <T : Any> eq(value: T): T = ArgumentMatchers.eq(value) ?: value
    private fun anyTime(): Instant = ArgumentMatchers.any(Instant::class.java) ?: Instant.EPOCH

    private fun request(targetType: String = "work", targetId: String = "w1", recipient: UUID = me) =
        NoticeCreateRequest(recipient, NoticeKind.AI_TOOL, "AI가 MCP로 작품을 수정했어요", targetType, targetId, UUID.randomUUID())

    private fun unread(targetType: String = "work", targetId: String = "w1") = NoticeEntity(
        UUID.randomUUID(), me, NoticeKind.AI_TOOL.code, "AI가 MCP로 작품을 수정했어요", targetType, targetId,
        Instant.parse("2026-11-19T00:00:00Z"), sourceEventId = UUID.randomUUID(),
    )

    /** 이 회원의 이 대상에 읽지 않은 알림 [row]가 있다고 꾸민다: 시각을 올린 행은 1개이고 다시 읽으면 그 행이 나온다. */
    private fun givenUnread(row: NoticeEntity) {
        givenNewRowsAreSaved() // 묶지 않고 새 행을 만들면 저장 스텁이 받아 주고, 아래 단언이 그것을 잡는다.
        `when`(notices.bumpUnread(eq(me), eq("ai-tool"), eq(row.targetType!!), eq(row.targetId!!), anyTime())).thenReturn(1)
        `when`(notices.groupItems(me, "ai-tool", row.targetType!!, row.targetId!!, PageRequest.of(0, 1))).thenReturn(listOf(row))
    }

    private fun givenNewRowsAreSaved() {
        `when`(notices.saveAndFlush(ArgumentMatchers.any(NoticeEntity::class.java))).thenAnswer { it.arguments[0] }
    }

    private fun calls(method: String) = mockingDetails(notices).invocations.filter { it.method.name == method }.map { it.arguments.toList() }
    private fun savedRows() = calls("saveAndFlush").map { it.single() as NoticeEntity }

    @Test
    fun `an unread notice for the same target is moved up and answered instead of adding a row`() {
        val existing = unread()
        givenUnread(existing)
        val before = Instant.now().truncatedTo(ChronoUnit.MICROS)

        val response = service.create(request())

        assertEquals(existing.id.toString(), response?.id)
        assertEquals(false, response?.read)
        assertTrue(savedRows().isEmpty())
        val bump = calls("bumpUnread").single()
        assertEquals(listOf<Any>(me, "ai-tool", "work", "w1"), bump.take(4))
        val at = bump[4] as Instant
        assertTrue(at >= before && at <= Instant.now(), "the notice is moved to now: $at")
        assertEquals(at.truncatedTo(ChronoUnit.MICROS), at)
        verify(stream).notifyChanged(me)
    }

    @Test
    fun `the refresh signal goes out only after the transaction commits`() {
        givenUnread(unread())
        TransactionSynchronizationManager.initSynchronization()
        try {
            service.create(request())
            assertTrue(savedRows().isEmpty(), "merged into the unread notice, not inserted")
            verifyNoInteractions(stream)
            TransactionSynchronizationManager.getSynchronizations().forEach { it.afterCommit() }
            verify(stream).notifyChanged(me)
        } finally {
            TransactionSynchronizationManager.clearSynchronization()
        }
    }

    @Test
    fun `with no unread notice for the target - for example after it was read - a new row is created with the event id`() {
        givenNewRowsAreSaved()
        val request = request()

        val response = service.create(request)

        val row = savedRows().single()
        assertEquals(response?.id, row.id.toString())
        assertEquals(listOf("ai-tool", "work", "w1", request.sourceEventId), listOf(row.kind, row.targetType, row.targetId, row.sourceEventId))
        verify(stream).notifyChanged(me)
    }

    @Test
    fun `another target or another member is never merged into an unread notice`() {
        givenUnread(unread(targetId = "w1"))
        givenNewRowsAreSaved()
        val other = UUID.randomUUID()

        listOf(request(targetId = "w2"), request(targetType = "world"), request(recipient = other)).forEach { service.create(it) }

        assertEquals(3, savedRows().size)
        assertEquals(listOf("w2", "w1", "w1"), savedRows().map { it.targetId })
        assertEquals(listOf("work", "world", "work"), savedRows().map { it.targetType })
        assertEquals(listOf(me, me, other), calls("bumpUnread").map { it[0] })
    }

    @Test
    fun `a member who turned the category off gets no notice and no signal even with an unread one`() {
        givenUnread(unread())
        `when`(preferences.findAllByMemberId(me)).thenReturn(listOf(NoticePreferenceEntity(me, "ai-tool", false)))

        assertNull(service.create(request()))

        verifyNoInteractions(notices)
        verifyNoInteractions(stream)
    }

    @Test
    fun `every other kind of notice, including operator actions, always gets its own row`() {
        givenNewRowsAreSaved()
        val others = NoticeEventType.entries.filter { it.kind != NoticeKind.AI_TOOL }
        assertTrue(others.map { it.code }.containsAll(listOf(
            "content.operator.work-restricted", "content.operator.work-unrestricted", "content.operator.comment-hidden", "content.operator.comment-restored",
        )))

        others.forEach { type -> repeat(2) { service.create(NoticeCreateRequest(me, type.kind, type.summary, type.targetType, "t-1", UUID.randomUUID())) } }

        assertEquals(others.size * 2, savedRows().size)
        assertTrue(calls("bumpUnread").isEmpty())
    }

    @Test
    fun `a bundled change counts itself, opens the latest episode and says how many more changes there are`() {
        val existing = unread().apply { targetEpisode = 3 }
        givenUnread(existing)

        service.create(request().copy(summary = "AI가 MCP로 「별의 숲」 5화 원고를 수정했어요", targetEpisode = 5, bundleSubject = "「별의 숲」 5화 원고"))
        service.create(request().copy(summary = "AI가 MCP로 「별의 숲」 플롯을 수정했어요", targetEpisode = null, bundleSubject = "「별의 숲」 플롯"))

        assertTrue(savedRows().isEmpty())
        assertEquals(2, existing.bundledCount)
        assertEquals(null, existing.targetEpisode)
        assertEquals("AI가 MCP로 「별의 숲」 플롯 외 2건을 수정했어요", existing.summary)
    }

    @Test
    fun `an event without a phrase still counts in the bundle but keeps the summary`() {
        val existing = unread()
        givenUnread(existing)

        val response = service.create(request())

        assertEquals(1, existing.bundledCount)
        assertEquals("AI가 MCP로 작품을 수정했어요", existing.summary)
        assertEquals("AI가 MCP로 작품을 수정했어요", response?.summary)
    }

    @Test
    fun `a new row keeps the episode to open`() {
        givenNewRowsAreSaved()

        val response = service.create(request().copy(targetEpisode = 4))

        assertEquals(4, savedRows().single().targetEpisode)
        assertEquals(0, savedRows().single().bundledCount)
        assertEquals(4, response?.targetEpisode)
    }
}
