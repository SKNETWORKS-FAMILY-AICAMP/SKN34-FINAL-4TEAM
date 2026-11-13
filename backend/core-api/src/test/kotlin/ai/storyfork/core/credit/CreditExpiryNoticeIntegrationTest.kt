package ai.storyfork.core.credit

import ai.storyfork.core.credit.domain.CreditKind
import ai.storyfork.core.credit.service.CreditExpiryNoticeService
import ai.storyfork.core.credit.service.CreditService
import ai.storyfork.core.notification.service.NoticeEventService
import ai.storyfork.core.notification.service.dto.NoticeEventMessage
import ai.storyfork.core.notification.service.dto.NoticeEventResult
import ai.storyfork.core.notification.service.dto.NoticeEventTarget
import java.math.BigDecimal
import java.time.Instant
import java.time.LocalDate
import java.util.UUID
import org.junit.jupiter.api.AfterEach
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Test
import org.junit.jupiter.api.condition.EnabledIfEnvironmentVariable
import org.springframework.beans.factory.annotation.Autowired
import org.springframework.boot.test.context.SpringBootTest
import org.springframework.jdbc.core.JdbcTemplate

/** 크레딧 소멸 예정 알림 사건 기록을 PostgreSQL 위에서 확인한다(기본 기간 3일). */
@SpringBootTest
@EnabledIfEnvironmentVariable(named = "AUTH_INTEGRATION_TEST", matches = "true")
class CreditExpiryNoticeIntegrationTest {
    @Autowired lateinit var credits: CreditService
    @Autowired lateinit var notices: CreditExpiryNoticeService
    @Autowired lateinit var events: NoticeEventService
    @Autowired lateinit var jdbc: JdbcTemplate

    // 실제 회원의 크레딧과 겹치지 않도록 지난 연도를 쓴다(이 작업은 DB의 모든 지급분을 본다).
    // 이 시각에 받은 이벤트 크레딧은 2001년 12월 1일 00:00 KST(2001-11-30T15:00Z)에 소멸한다.
    private val granted = Instant.parse("2001-11-20T01:00:00Z")
    private val dueSoon = Instant.parse("2001-11-28T00:00:00Z")
    private val members = mutableListOf<UUID>()

    private fun member(): UUID {
        val id = UUID.randomUUID()
        jdbc.update("insert into auth_member(id,email,password_hash,nickname) values (?,?,?,?)", id, "${UUID.randomUUID()}@example.invalid", "x", "Reader")
        return id.also { members += it }
    }
    private fun rows(m: UUID) = jdbc.queryForList("select id, target_id from notification_outbox where recipient_id = ? and event_type = 'core.credit.expiring'", m)

    // 다른 Outbox 테스트가 건너뛰지 않도록 이 테스트 회원의 대기 사건만 보낸 것으로 표시한다.
    @AfterEach
    fun markTestEventsSent() {
        members.forEach { jdbc.update("update notification_outbox set sent_at = now() where sent_at is null and recipient_id = ?", it) }
    }

    @Test
    fun `a member whose credit expires soon gets one notice per expiry date even when the job runs again`() {
        val m = member()
        credits.grant(m, CreditKind.EVENT, BigDecimal("10"), granted)
        credits.grant(m, CreditKind.REWARD, BigDecimal("5"), granted)

        notices.notifyExpiring(Instant.parse("2001-11-20T02:00:00Z"))
        assertEquals(0, rows(m).size, "소멸까지 3일보다 많이 남았으면 기록하지 않는다")

        notices.notifyExpiring(dueSoon)
        notices.notifyExpiring(dueSoon.plusSeconds(3600))
        val recorded = rows(m)
        assertEquals(1, recorded.size)
        assertEquals("2001-12-01", recorded[0]["target_id"])
        assertEquals(CreditExpiryNoticeService.eventId(m, LocalDate.parse("2001-12-01")), recorded[0]["id"])
    }

    @Test
    fun `fully used credit is not announced`() {
        val m = member()
        credits.grant(m, CreditKind.EVENT, BigDecimal("10"), granted)
        credits.spend(m, BigDecimal("10"), "spend-${UUID.randomUUID()}", granted)
        notices.notifyExpiring(dueSoon)
        assertEquals(0, rows(m).size)
    }

    @Test
    fun `the recorded event is accepted by the consumer as a credit notice`() {
        val m = member()
        credits.grant(m, CreditKind.EVENT, BigDecimal("10"), granted)
        notices.notifyExpiring(dueSoon)
        val id = rows(m).single()["id"].toString()
        val message = NoticeEventMessage(1, id, "core.credit.expiring", dueSoon.toString(), m.toString(), NoticeEventTarget("credit-expiry", "2001-12-01"))
        assertEquals(NoticeEventResult.CREATED, events.handle(message))
        assertEquals("credit", jdbc.queryForObject("select kind from notification where recipient_id = ?", String::class.java, m))
    }
}
