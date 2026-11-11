package ai.storyfork.core.auth

import ai.storyfork.core.auth.scheduler.WithdrawalCompletionJob
import ai.storyfork.core.auth.service.WithdrawalCompletionService
import java.sql.Timestamp
import java.time.Instant
import java.time.temporal.ChronoUnit
import java.util.UUID
import org.junit.jupiter.api.Assertions.*
import org.junit.jupiter.api.Test
import org.junit.jupiter.api.condition.EnabledIfEnvironmentVariable
import org.springframework.beans.factory.annotation.Autowired
import org.springframework.boot.test.context.SpringBootTest
import org.springframework.boot.webmvc.test.autoconfigure.AutoConfigureMockMvc
import org.springframework.http.MediaType
import org.springframework.jdbc.core.JdbcTemplate
import org.springframework.security.crypto.bcrypt.BCryptPasswordEncoder
import org.springframework.test.web.servlet.MockMvc
import org.springframework.test.web.servlet.request.MockHttpServletRequestBuilder
import org.springframework.test.web.servlet.request.MockMvcRequestBuilders.*
import org.springframework.test.web.servlet.result.MockMvcResultMatchers.*

/** 유예 만료 탈퇴 요청의 완료 처리(Core 단독 범위)를 PostgreSQL 위에서 확인한다. */
@SpringBootTest
@AutoConfigureMockMvc
@EnabledIfEnvironmentVariable(named = "AUTH_INTEGRATION_TEST", matches = "true")
class WithdrawalCompletionIntegrationTest {
    @Autowired lateinit var mvc: MockMvc
    @Autowired lateinit var jdbc: JdbcTemplate
    @Autowired lateinit var job: WithdrawalCompletionJob
    @Autowired lateinit var completion: WithdrawalCompletionService

    private class Member(val id: UUID, val email: String)

    private fun member(): Member {
        val id = UUID.randomUUID()
        val email = "${UUID.randomUUID()}@example.invalid"
        jdbc.update("insert into auth_member(id,email,password_hash,nickname) values (?,?,?,?)", id, email, BCryptPasswordEncoder().encode("test-password"), "Reader")
        return Member(id, email)
    }
    private fun session(m: Member) = jdbc.update("insert into auth_session(id,member_id,device_label,created_at,expires_at) values (?,?,?,now(),now() + interval '1 day')", UUID.randomUUID(), m.id, "test")
    private fun challenge(m: Member) = jdbc.update("insert into auth_profile_challenge(member_id,purpose,target_email,token_hash,expires_at) values (?,?,?,?,now() + interval '1 day')", m.id, "email", "new@example.invalid", "a".repeat(64))

    /** 요청 시각을 기준으로 dueDays일 뒤가 기한인 탈퇴 요청을 넣는다. 음수면 이미 기한이 지난 요청이다. */
    private fun withdrawal(m: Member, dueDays: Long, status: String = "PENDING", reason: String? = "bye"): UUID {
        val id = UUID.randomUUID()
        val due = Instant.now().plus(dueDays, ChronoUnit.DAYS)
        jdbc.update("insert into auth_withdrawal(id,member_id,requested_at,due_at,reason,status) values (?,?,?,?,?,?)",
            id, m.id, Timestamp.from(due.minus(30, ChronoUnit.DAYS)), Timestamp.from(due), reason, status)
        return id
    }
    private fun status(id: UUID) = jdbc.queryForObject("select status from auth_withdrawal where id = ?", String::class.java, id)
    private fun csrf(request: MockHttpServletRequestBuilder): MockHttpServletRequestBuilder {
        val response = mvc.perform(get("/api/v1/auth/csrf")).andReturn().response
        return request.cookie(requireNotNull(response.getCookie("XSRF-TOKEN"))).header("X-CSRF-TOKEN", response.contentAsString.substringAfter("\"csrfToken\":\"").substringBefore('"'))
    }
    private fun login(email: String) = mvc.perform(csrf(post("/api/v1/auth/login")).contentType(MediaType.APPLICATION_JSON)
        .content("""{"email":"$email","password":"test-password"}"""))

    @Test
    fun `an expired request anonymizes the account and blocks every way back in`() {
        val m = member(); session(m); session(m); challenge(m)
        val w = withdrawal(m, -1)

        assertEquals(1, completion.dueIds(Instant.now(), 100).count { it == w })
        assertTrue(completion.complete(w, Instant.now()))

        val row = jdbc.queryForMap("select email, nickname, password_hash from auth_member where id = ?", m.id)
        assertEquals("withdrawn-${m.id}@withdrawn.invalid", row["email"])
        assertEquals("탈퇴한 회원", row["nickname"])
        assertFalse(BCryptPasswordEncoder().matches("test-password", row["password_hash"] as String))
        assertEquals("COMPLETED", status(w))
        assertNotNull(jdbc.queryForObject("select completed_at from auth_withdrawal where id = ?", Timestamp::class.java, w))
        assertEquals("bye", jdbc.queryForObject("select reason from auth_withdrawal where id = ?", String::class.java, w))
        assertEquals(0, jdbc.queryForObject("select count(*) from auth_session where member_id = ? and revoked = false", Int::class.java, m.id))
        assertEquals(0, jdbc.queryForObject("select count(*) from auth_profile_challenge where member_id = ?", Int::class.java, m.id))
        login(m.email).andExpect(status().isUnauthorized())
        assertFalse(completion.complete(w, Instant.now()))
    }

    @Test
    fun `only requests past their due time are completed by the job`() {
        val due = member(); val waiting = member(); val restored = member()
        val dueId = withdrawal(due, -1); val waitingId = withdrawal(waiting, 5); val restoredId = withdrawal(restored, -1, "RESTORED")

        assertTrue(job.runOnce(Instant.now()) >= 1)

        assertEquals("COMPLETED", status(dueId))
        assertEquals("PENDING", status(waitingId))
        assertEquals("RESTORED", status(restoredId))
        assertEquals(waiting.email, jdbc.queryForObject("select email from auth_member where id = ?", String::class.java, waiting.id))
        assertEquals(restored.email, jdbc.queryForObject("select email from auth_member where id = ?", String::class.java, restored.id))
    }

    @Test
    fun `a request that was restored or is not due yet is left alone even when its id is known`() {
        val m = member(); val future = withdrawal(m, 3)
        assertFalse(completion.complete(future, Instant.now()))
        assertEquals("PENDING", status(future))
        val other = member(); val restored = withdrawal(other, -2, "RESTORED")
        assertFalse(completion.complete(restored, Instant.now()))
        assertEquals(other.email, jdbc.queryForObject("select email from auth_member where id = ?", String::class.java, other.id))
        assertFalse(completion.complete(UUID.randomUUID(), Instant.now()))
    }

    @Test
    fun `the original email can be used again after completion`() {
        val m = member(); val w = withdrawal(m, -1)
        assertTrue(completion.complete(w, Instant.now()))
        assertFalse(jdbc.queryForObject("select count(*) from auth_member where email = ?", Int::class.java, m.email)!! > 0)
    }
}
