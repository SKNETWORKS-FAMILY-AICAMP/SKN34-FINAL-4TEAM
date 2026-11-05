package ai.storyfork.core.notification

import ai.storyfork.core.notification.service.InvalidNoticeEventException
import ai.storyfork.core.notification.service.NoticeEventService
import ai.storyfork.core.notification.service.NoticeService
import ai.storyfork.core.notification.service.dto.NoticeEventMessage
import ai.storyfork.core.notification.service.dto.NoticeEventResult
import ai.storyfork.core.notification.service.dto.NoticeEventTarget
import ai.storyfork.core.notification.service.dto.NoticeListRequest
import java.time.Instant
import java.util.UUID
import java.util.concurrent.CountDownLatch
import java.util.concurrent.Executors
import java.util.concurrent.TimeUnit
import org.junit.jupiter.api.Assertions.*
import org.junit.jupiter.api.Test
import org.junit.jupiter.api.condition.EnabledIfEnvironmentVariable
import org.springframework.beans.factory.annotation.Autowired
import org.springframework.boot.test.context.SpringBootTest
import org.springframework.jdbc.core.JdbcTemplate
import org.springframework.security.crypto.bcrypt.BCryptPasswordEncoder

/** 사건 소비 규칙을 브로커 없이 서비스 단에서 검증한다. 브로커 연결은 격리 Compose 검증에서 따로 확인한다. */
@SpringBootTest
@EnabledIfEnvironmentVariable(named = "AUTH_INTEGRATION_TEST", matches = "true")
class NoticeEventIntegrationTest {
    @Autowired lateinit var events: NoticeEventService
    @Autowired lateinit var notices: NoticeService
    @Autowired lateinit var jdbc: JdbcTemplate

    private fun member(): UUID {
        val id = UUID.randomUUID()
        jdbc.update("insert into auth_member(id,email,password_hash,nickname) values (?,?,?,?)", id, "${UUID.randomUUID()}@example.invalid", BCryptPasswordEncoder().encode("test-password"), "Reader")
        return id
    }
    private fun message(recipient: UUID, eventId: UUID = UUID.randomUUID(), work: String = "work-1") = NoticeEventMessage(
        schemaVersion = 1, eventId = eventId.toString(), type = "content.world.changed", occurredAt = Instant.now().toString(),
        recipientId = recipient.toString(), target = NoticeEventTarget("work", work),
    )
    private fun rows(eventId: UUID) = jdbc.queryForObject("select count(*) from notification where source_event_id = ?", Int::class.java, eventId)

    @Test
    fun `a world change event creates one reading notice that targets the work`() {
        val me = member(); val eventId = UUID.randomUUID()
        assertEquals(NoticeEventResult.CREATED, events.handle(message(me, eventId, "work-42")))
        val item = notices.list(me, NoticeListRequest()).items.single()
        assertEquals("reading", item.kind); assertEquals("work", item.targetType); assertEquals("work-42", item.targetId); assertFalse(item.read)
        assertEquals(1L, notices.unreadCount(me).count)
        assertEquals(1, rows(eventId))
    }

    @Test
    fun `redelivery of the same event does not create a second notice`() {
        val me = member(); val eventId = UUID.randomUUID()
        assertEquals(NoticeEventResult.CREATED, events.handle(message(me, eventId)))
        assertEquals(NoticeEventResult.DUPLICATE, events.handle(message(me, eventId)))
        assertEquals(1, rows(eventId))
    }

    @Test
    fun `the same event arriving concurrently is stored once`() {
        val me = member(); val eventId = UUID.randomUUID(); val workers = 8
        val start = CountDownLatch(1); val pool = Executors.newFixedThreadPool(workers)
        try {
            val futures = (1..workers).map { pool.submit<NoticeEventResult> { start.await(); events.handle(message(me, eventId)) } }
            start.countDown()
            val results = futures.map { it.get(20, TimeUnit.SECONDS) }
            assertEquals(1, results.count { it == NoticeEventResult.CREATED }, results.toString())
            assertEquals(workers - 1, results.count { it == NoticeEventResult.DUPLICATE }, results.toString())
            assertEquals(1, rows(eventId))
        } finally { pool.shutdownNow() }
    }

    @Test
    fun `a notice the member deleted is not brought back by redelivery`() {
        val me = member(); val eventId = UUID.randomUUID()
        events.handle(message(me, eventId))
        notices.delete(me, UUID.fromString(notices.list(me, NoticeListRequest()).items.single().id))
        assertEquals(NoticeEventResult.DUPLICATE, events.handle(message(me, eventId)))
        assertTrue(notices.list(me, NoticeListRequest()).items.isEmpty())
        assertEquals(0L, notices.unreadCount(me).count)
    }

    @Test
    fun `an event is skipped when the member turned that category off`() {
        val me = member(); val eventId = UUID.randomUUID()
        jdbc.update("insert into notification_preference(member_id, kind, enabled) values (?, 'reading', false)", me)
        assertEquals(NoticeEventResult.SKIPPED_PREFERENCE, events.handle(message(me, eventId)))
        assertEquals(0, rows(eventId))
    }

    @Test
    fun `an event for an unknown member is dropped without a notice`() {
        val eventId = UUID.randomUUID()
        assertEquals(NoticeEventResult.DROPPED_UNKNOWN_MEMBER, events.handle(message(UUID.randomUUID(), eventId)))
        assertEquals(0, rows(eventId))
    }

    @Test
    fun `contract violations are rejected and create nothing`() {
        val me = member(); val eventId = UUID.randomUUID(); val ok = message(me, eventId)
        val bad = listOf(
            ok.copy(schemaVersion = 2), ok.copy(schemaVersion = null), ok.copy(eventId = "not-a-uuid"), ok.copy(eventId = null),
            ok.copy(type = "content.unknown"), ok.copy(type = null), ok.copy(recipientId = "x"), ok.copy(occurredAt = "yesterday"),
            ok.copy(target = null), ok.copy(target = NoticeEventTarget("episode", "e1")), ok.copy(target = NoticeEventTarget("work", " ")),
            ok.copy(target = NoticeEventTarget("work", "x".repeat(101))),
        )
        bad.forEach { assertThrows(InvalidNoticeEventException::class.java) { events.handle(it) } }
        assertEquals(0, rows(eventId))
        assertTrue(notices.list(me, NoticeListRequest()).items.isEmpty())
    }
}
