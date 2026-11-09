package ai.storyfork.core.notification

import ai.storyfork.core.notification.domain.NoticeEventType
import ai.storyfork.core.notification.messaging.NoticeOutboxRelay
import ai.storyfork.core.notification.service.NoticeEventPublisher
import ai.storyfork.core.notification.service.NoticeEventService
import ai.storyfork.core.notification.service.NoticeOutboxService
import ai.storyfork.core.notification.service.dto.NoticeEventMessage
import ai.storyfork.core.notification.service.dto.NoticeEventResult
import java.util.UUID
import org.junit.jupiter.api.Assertions.*
import org.junit.jupiter.api.Assumptions.assumeTrue
import org.junit.jupiter.api.Test
import org.junit.jupiter.api.condition.EnabledIfEnvironmentVariable
import org.springframework.beans.factory.annotation.Autowired
import org.springframework.boot.test.context.SpringBootTest
import org.springframework.jdbc.core.JdbcTemplate
import org.springframework.security.crypto.bcrypt.BCryptPasswordEncoder
import org.springframework.transaction.IllegalTransactionStateException
import org.springframework.transaction.PlatformTransactionManager
import org.springframework.transaction.support.TransactionTemplate

/** Outbox 기록·재시도·중복 반영을 브로커 없이 검증한다. 발행기는 가짜로 바꿔 끼우고 주기 실행은 끈다. */
@SpringBootTest(properties = [
    "app.notification.outbox.relay-enabled=false",
    "app.notification.outbox.max-attempts=2",
    "app.notification.outbox.retry-base-delay=PT0S",
])
@EnabledIfEnvironmentVariable(named = "AUTH_INTEGRATION_TEST", matches = "true")
class NoticeOutboxIntegrationTest {
    @Autowired lateinit var outbox: NoticeOutboxService
    @Autowired lateinit var events: NoticeEventService
    @Autowired lateinit var jdbc: JdbcTemplate
    @Autowired lateinit var transactionManager: PlatformTransactionManager

    private fun member(): UUID {
        val id = UUID.randomUUID()
        jdbc.update("insert into auth_member(id,email,password_hash,nickname) values (?,?,?,?)", id, "${UUID.randomUUID()}@example.invalid", BCryptPasswordEncoder().encode("test-password"), "Reader")
        return id
    }
    private fun enqueue(recipient: UUID, work: String = "work-1"): UUID =
        TransactionTemplate(transactionManager).execute { outbox.enqueue(NoticeEventType.WORLD_CHANGED, recipient, work) }
    private fun row(id: UUID) = jdbc.queryForMap("select status, attempts, last_error from notification_outbox where id = ?", id)
    private fun relay(publisher: NoticeEventPublisher) = NoticeOutboxRelay(outbox, publisher, true, 1000)

    /** 발행기는 DB의 모든 대기 행을 처리하므로, 남의 대기 사건이 있는 DB(공유 개발 DB 등)에서는 이 테스트를 건너뛴다. */
    private fun onlyOurRowsPending() =
        assumeTrue(jdbc.queryForObject("select count(*) from notification_outbox where status = 'PENDING'", Int::class.java) == 0, "다른 대기 사건이 있는 DB에서는 실행하지 않는다")

    @Test
    fun `enqueue refuses to run without a surrounding business transaction`() {
        assertThrows(IllegalTransactionStateException::class.java) { outbox.enqueue(NoticeEventType.WORLD_CHANGED, member(), "work-1") }
    }

    @Test
    fun `an event recorded in a rolled back transaction leaves no outbox row`() {
        val me = member(); var id: UUID? = null
        assertThrows(IllegalStateException::class.java) {
            TransactionTemplate(transactionManager).executeWithoutResult {
                id = outbox.enqueue(NoticeEventType.WORLD_CHANGED, me, "work-1")
                throw IllegalStateException("business rule failed")
            }
        }
        assertEquals(0, jdbc.queryForObject("select count(*) from notification_outbox where id = ?", Int::class.java, id))
    }

    @Test
    fun `a sent event follows the contract and is stored by the consumer exactly once`() {
        onlyOurRowsPending()
        val me = member(); val id = enqueue(me, "work-42")
        val sent = mutableListOf<NoticeEventMessage>()
        relay { sent += it }.relayOnce()

        val message = sent.single { it.eventId == id.toString() }
        assertEquals(1, message.schemaVersion); assertEquals("content.world.changed", message.type)
        assertEquals(me.toString(), message.recipientId); assertEquals("work", message.target?.type); assertEquals("work-42", message.target?.id)
        assertEquals("SENT", row(id)["status"])
        assertEquals(NoticeEventResult.CREATED, events.handle(message))
        assertEquals(NoticeEventResult.DUPLICATE, events.handle(message))
        assertEquals(1, jdbc.queryForObject("select count(*) from notification where source_event_id = ?", Int::class.java, id))
    }

    @Test
    fun `a failed publish is retried with the same event id until it succeeds`() {
        onlyOurRowsPending()
        val me = member(); val id = enqueue(me)
        relay { if (it.eventId == id.toString()) throw IllegalStateException("broker down") }.relayOnce()
        assertEquals("PENDING", row(id)["status"]); assertEquals(1, row(id)["attempts"]); assertEquals("IllegalStateException", row(id)["last_error"])

        val seen = mutableListOf<String?>()
        relay { seen += it.eventId }.relayOnce()
        assertTrue(id.toString() in seen)
        assertEquals("SENT", row(id)["status"])
    }

    @Test
    fun `an event that keeps failing stops at the attempt limit and is left as FAILED`() {
        onlyOurRowsPending()
        val me = member(); val id = enqueue(me)
        val failing = relay { if (it.eventId == id.toString()) throw IllegalStateException("broker down") }
        failing.relayOnce(); failing.relayOnce()
        assertEquals("FAILED", row(id)["status"]); assertEquals(2, row(id)["attempts"])

        val seen = mutableListOf<String?>()
        relay { seen += it.eventId }.relayOnce()
        assertFalse(id.toString() in seen)
    }
}
