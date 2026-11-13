package ai.storyfork.core.notification

import ai.storyfork.core.auth.repository.MemberRepository
import ai.storyfork.core.notification.entity.NoticeEntity
import ai.storyfork.core.notification.repository.NoticeGroupRow
import ai.storyfork.core.notification.repository.NoticePreferenceRepository
import ai.storyfork.core.notification.repository.NoticeRepository
import ai.storyfork.core.notification.service.NoticeException
import ai.storyfork.core.notification.service.NoticeService
import ai.storyfork.core.notification.service.NoticeStream
import ai.storyfork.core.notification.service.dto.NoticeGroupItemsRequest
import ai.storyfork.core.notification.service.dto.NoticeGroupListRequest
import java.time.Instant
import java.util.UUID
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertNull
import org.junit.jupiter.api.Assertions.assertThrows
import org.junit.jupiter.api.Test
import org.mockito.Mockito.mock
import org.mockito.Mockito.verifyNoInteractions
import org.mockito.Mockito.`when`
import org.springframework.data.domain.PageRequest

/** 알림 상세·묶음 조회 서비스 규칙을 DB 없이 확인한다. 실제 쿼리와 HTTP 동작은 NoticeGroupIntegrationTest가 맡는다. */
class NoticeGroupServiceTest {
    private val me = UUID.randomUUID()
    private val notices = mock(NoticeRepository::class.java)
    private val service = NoticeService(notices, mock(NoticePreferenceRepository::class.java), mock(MemberRepository::class.java), mock(NoticeStream::class.java))

    private fun notice(summary: String, id: UUID = UUID.randomUUID()) =
        NoticeEntity(id, me, "creation", summary, "work", "w1", Instant.parse("2026-11-11T00:00:00Z"))

    @Test
    fun `unknown kind is rejected before any query`() {
        val exception = assertThrows(NoticeException::class.java) {
            service.groupItems(me, NoticeGroupItemsRequest(kind = "unknown", targetType = "work", targetId = "w1"))
        }
        assertEquals(NoticeException.Reason.INVALID, exception.reason)
        verifyNoInteractions(notices)
    }

    @Test
    fun `group items are limited by the request and never report a next cursor`() {
        `when`(notices.groupItems(me, "creation", "work", "w1", PageRequest.of(0, 2))).thenReturn(listOf(notice("new"), notice("old")))
        val response = service.groupItems(me, NoticeGroupItemsRequest(kind = "creation", targetType = "work", targetId = "w1", limit = 2))
        assertEquals(listOf("new", "old"), response.items.map { it.summary })
        assertNull(response.nextCursor)
    }

    @Test
    fun `a group carries its counts and the summary of its newest notice`() {
        val row = mock(NoticeGroupRow::class.java)
        `when`(row.kind).thenReturn("creation")
        `when`(row.targetType).thenReturn("work")
        `when`(row.targetId).thenReturn("w1")
        `when`(row.total).thenReturn(3L)
        `when`(row.unread).thenReturn(2L)
        `when`(row.latestAt).thenReturn(Instant.parse("2026-11-11T00:00:00Z"))
        `when`(notices.groupSummaries(me, PageRequest.of(0, 5))).thenReturn(listOf(row))
        `when`(notices.groupItems(me, "creation", "work", "w1", PageRequest.of(0, 1))).thenReturn(listOf(notice("comment 3")))

        val group = service.groups(me, NoticeGroupListRequest(limit = 5)).items.single()
        assertEquals(3L, group.count)
        assertEquals(2L, group.unreadCount)
        assertEquals("comment 3", group.latestSummary)
    }

    @Test
    fun `a group whose notices were all deleted meanwhile is left out`() {
        val row = mock(NoticeGroupRow::class.java)
        `when`(row.kind).thenReturn("creation")
        `when`(row.targetType).thenReturn("work")
        `when`(row.targetId).thenReturn("w1")
        `when`(notices.groupSummaries(me, PageRequest.of(0, 20))).thenReturn(listOf(row))
        `when`(notices.groupItems(me, "creation", "work", "w1", PageRequest.of(0, 1))).thenReturn(emptyList())

        assertEquals(0, service.groups(me, NoticeGroupListRequest()).items.size)
    }

    @Test
    fun `detail hides missing and deleted notices and does not touch the read mark`() {
        val live = notice("hello")
        val gone = notice("gone").also { it.deletedAt = Instant.now() }
        `when`(notices.findByIdAndRecipientId(live.id, me)).thenReturn(live)
        `when`(notices.findByIdAndRecipientId(gone.id, me)).thenReturn(gone)

        assertEquals("hello", service.get(me, live.id).summary)
        assertNull(live.readAt)
        listOf(gone.id, UUID.randomUUID()).forEach {
            assertEquals(NoticeException.Reason.NOT_FOUND, assertThrows(NoticeException::class.java) { service.get(me, it) }.reason)
        }
    }
}
