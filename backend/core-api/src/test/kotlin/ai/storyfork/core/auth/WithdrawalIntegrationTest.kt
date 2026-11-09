package ai.storyfork.core.auth

import jakarta.servlet.http.Cookie
import java.time.Duration
import java.time.Instant
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
import org.springframework.test.web.servlet.MvcResult
import org.springframework.test.web.servlet.request.MockHttpServletRequestBuilder
import org.springframework.test.web.servlet.request.MockMvcRequestBuilders.*
import org.springframework.test.web.servlet.result.MockMvcResultMatchers.*

@SpringBootTest
@AutoConfigureMockMvc
@EnabledIfEnvironmentVariable(named = "AUTH_INTEGRATION_TEST", matches = "true")
class WithdrawalIntegrationTest {
    @Autowired lateinit var mvc: MockMvc
    @Autowired lateinit var jdbc: JdbcTemplate

    private class Member(val id: UUID, val email: String)

    private fun member(): Member {
        val id = UUID.randomUUID()
        val email = "${UUID.randomUUID()}@example.invalid"
        jdbc.update("insert into auth_member(id,email,password_hash,nickname) values (?,?,?,?)", id, email, BCryptPasswordEncoder().encode("test-password"), "Reader")
        return Member(id, email)
    }
    private fun csrf(request: MockHttpServletRequestBuilder): MockHttpServletRequestBuilder {
        val response = mvc.perform(get("/api/v1/auth/csrf")).andReturn().response
        return request.cookie(requireNotNull(response.getCookie("XSRF-TOKEN"))).header("X-CSRF-TOKEN", response.contentAsString.substringAfter("\"csrfToken\":\"").substringBefore('"'))
    }
    private fun login(m: Member): MvcResult = mvc.perform(csrf(post("/api/v1/auth/login")).contentType(MediaType.APPLICATION_JSON)
        .content("""{"email":"${m.email}","password":"test-password"}""")).andReturn()
    private fun bearer(result: MvcResult) = "Bearer " + result.response.contentAsString.substringAfter("\"accessToken\":\"").substringBefore('"')
    private fun refreshCookie(result: MvcResult): Cookie {
        val header = requireNotNull(result.response.getHeaders("Set-Cookie").find { it.startsWith("refresh_token=") })
        return Cookie("refresh_token", header.substringAfter('=').substringBefore(';'))
    }
    private fun json(request: MockHttpServletRequestBuilder, auth: String, body: String) =
        csrf(request).header("Authorization", auth).contentType(MediaType.APPLICATION_JSON).content(body)

    @Test
    fun `anonymous requests are rejected`() {
        mvc.perform(get("/api/v1/me/withdrawal")).andExpect(status().isUnauthorized())
    }

    @Test
    fun `wrong password is rejected and creates nothing`() {
        val m = member(); val auth = bearer(login(m))
        mvc.perform(json(post("/api/v1/me/withdrawal"), auth, """{"password":"wrong-password"}""")).andExpect(status().isForbidden())
        mvc.perform(json(post("/api/v1/me/withdrawal"), auth, """{"password":""}""")).andExpect(status().isBadRequest())
        mvc.perform(json(post("/api/v1/me/withdrawal"), auth, """{"password":"test-password","reason":"${"x".repeat(301)}"}""")).andExpect(status().isBadRequest())
        assertEquals(0, jdbc.queryForObject("select count(*) from auth_withdrawal where member_id = ?", Int::class.java, m.id))
        mvc.perform(get("/api/v1/me/withdrawal").header("Authorization", auth)).andExpect(jsonPath("$.status").value("NONE"))
    }

    @Test
    fun `request starts a thirty day grace period and revokes refresh sessions`() {
        val m = member(); val result = login(m); val auth = bearer(result); val cookie = refreshCookie(result)
        val secondCookie = refreshCookie(login(m))
        assertNotEquals(cookie.value, secondCookie.value)
        val before = Instant.now()
        mvc.perform(json(post("/api/v1/me/withdrawal"), auth, """{"password":"test-password","reason":" 더 이상 쓰지 않아요 "}"""))
            .andExpect(status().isAccepted()).andExpect(jsonPath("$.status").value("PENDING"))
        val row = jdbc.queryForMap("select requested_at, due_at, reason, status from auth_withdrawal where member_id = ?", m.id)
        val requested = (row["requested_at"] as java.sql.Timestamp).toInstant()
        val due = (row["due_at"] as java.sql.Timestamp).toInstant()
        assertEquals("PENDING", row["status"]); assertEquals("더 이상 쓰지 않아요", row["reason"])
        assertEquals(Duration.ofDays(30), Duration.between(requested, due))
        assertFalse(requested.isBefore(before.minusSeconds(5)))
        // 한 세션만이 아니라 모든 기기의 refresh 세션이 폐기돼야 한다.
        mvc.perform(csrf(post("/api/v1/auth/refresh")).cookie(cookie)).andExpect(status().is4xxClientError())
        mvc.perform(csrf(post("/api/v1/auth/refresh")).cookie(secondCookie)).andExpect(status().is4xxClientError())
        mvc.perform(get("/api/v1/me/withdrawal").header("Authorization", auth)).andExpect(jsonPath("$.status").value("PENDING")).andExpect(jsonPath("$.dueAt").exists())
    }

    @Test
    fun `restore is rejected once the grace period has passed`() {
        val m = member(); val auth = bearer(login(m))
        mvc.perform(json(post("/api/v1/me/withdrawal"), auth, """{"password":"test-password"}""")).andExpect(status().isAccepted())
        jdbc.update("update auth_withdrawal set due_at = now() - interval '1 second' where member_id = ?", m.id)
        val again = bearer(login(m))
        mvc.perform(json(delete("/api/v1/me/withdrawal"), again, "")).andExpect(status().isConflict())
        val row = jdbc.queryForMap("select status, restored_at from auth_withdrawal where member_id = ?", m.id)
        assertEquals("PENDING", row["status"]); assertNull(row["restored_at"])
    }

    @Test
    fun `second request while pending conflicts`() {
        val m = member(); val auth = bearer(login(m))
        val body = """{"password":"test-password"}"""
        mvc.perform(json(post("/api/v1/me/withdrawal"), auth, body)).andExpect(status().isAccepted())
        mvc.perform(json(post("/api/v1/me/withdrawal"), auth, body)).andExpect(status().isConflict())
        assertEquals(1, jdbc.queryForObject("select count(*) from auth_withdrawal where member_id = ? and status = 'PENDING'", Int::class.java, m.id))
    }

    @Test
    fun `member can log in during grace and restore the account`() {
        val m = member(); val auth = bearer(login(m))
        mvc.perform(json(post("/api/v1/me/withdrawal"), auth, """{"password":"test-password"}""")).andExpect(status().isAccepted())
        val again = login(m)
        assertEquals(200, again.response.status)
        val authAgain = bearer(again)
        mvc.perform(json(delete("/api/v1/me/withdrawal"), authAgain, "")).andExpect(status().isNoContent())
        mvc.perform(get("/api/v1/me/withdrawal").header("Authorization", authAgain)).andExpect(jsonPath("$.status").value("NONE"))
        assertEquals("RESTORED", jdbc.queryForObject("select status from auth_withdrawal where member_id = ?", String::class.java, m.id))
        mvc.perform(json(delete("/api/v1/me/withdrawal"), authAgain, "")).andExpect(status().isNotFound())
        mvc.perform(json(post("/api/v1/me/withdrawal"), authAgain, """{"password":"test-password"}""")).andExpect(status().isAccepted())
    }

    @Test
    fun `withdrawal state is private to each member`() {
        val first = member(); val second = member()
        val firstAuth = bearer(login(first)); val secondAuth = bearer(login(second))
        mvc.perform(json(post("/api/v1/me/withdrawal"), firstAuth, """{"password":"test-password"}""")).andExpect(status().isAccepted())
        mvc.perform(get("/api/v1/me/withdrawal").header("Authorization", secondAuth)).andExpect(jsonPath("$.status").value("NONE"))
        mvc.perform(json(delete("/api/v1/me/withdrawal"), secondAuth, "")).andExpect(status().isNotFound())
    }
}
