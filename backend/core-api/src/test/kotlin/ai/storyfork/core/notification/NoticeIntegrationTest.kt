package ai.storyfork.core.notification

import ai.storyfork.core.notification.domain.NoticeKind
import ai.storyfork.core.notification.service.NoticeService
import ai.storyfork.core.notification.service.dto.NoticeCreateRequest
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

@SpringBootTest
@AutoConfigureMockMvc
@EnabledIfEnvironmentVariable(named = "AUTH_INTEGRATION_TEST", matches = "true")
class NoticeIntegrationTest {
    @Autowired lateinit var mvc: MockMvc
    @Autowired lateinit var jdbc: JdbcTemplate
    @Autowired lateinit var notices: NoticeService

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
    private fun bearer(m: Member): String {
        val response = mvc.perform(csrf(post("/api/v1/auth/login")).contentType(MediaType.APPLICATION_JSON)
            .content("""{"email":"${m.email}","password":"test-password"}""")).andReturn().response
        return "Bearer " + response.contentAsString.substringAfter("\"accessToken\":\"").substringBefore('"')
    }
    private fun json(request: MockHttpServletRequestBuilder, auth: String, body: String) =
        csrf(request).header("Authorization", auth).contentType(MediaType.APPLICATION_JSON).content(body)
    private fun add(m: Member, summary: String, kind: NoticeKind = NoticeKind.RESULT) =
        requireNotNull(notices.create(NoticeCreateRequest(m.id, kind, summary))).id

    @Test
    fun `anonymous requests are rejected`() {
        mvc.perform(get("/api/v1/me/notifications")).andExpect(status().isUnauthorized())
        mvc.perform(get("/api/v1/me/notification-preferences")).andExpect(status().isUnauthorized())
    }

    @Test
    fun `stream signals only its owner and only after a notice is saved`() {
        val me = member(); val other = member(); val auth = bearer(me)
        val opened = mvc.perform(get("/api/v1/me/notifications/stream").header("Authorization", auth).accept(MediaType.TEXT_EVENT_STREAM))
            .andExpect(request().asyncStarted()).andReturn()
        assertTrue(opened.response.contentAsString.contains("event:ready"))
        add(other, "not mine")
        assertFalse(opened.response.contentAsString.contains("event:changed"))
        add(me, "mine")
        assertEquals(1, Regex("event:changed").findAll(opened.response.contentAsString).count())
        mvc.perform(get("/api/v1/me/notifications/stream").accept(MediaType.TEXT_EVENT_STREAM)).andExpect(status().isUnauthorized())
    }

    @Test
    fun `list returns only own notices newest first with cursor paging`() {
        val me = member(); val other = member(); val auth = bearer(me)
        val first = add(me, "first"); val second = add(me, "second"); val third = add(me, "third"); add(other, "not mine")
        val page1 = mvc.perform(get("/api/v1/me/notifications?limit=2").header("Authorization", auth))
            .andExpect(status().isOk()).andExpect(jsonPath("$.items.length()").value(2))
            .andExpect(jsonPath("$.items[0].id").value(third)).andExpect(jsonPath("$.items[1].id").value(second))
            .andExpect(jsonPath("$.items[0].read").value(false)).andReturn().response.contentAsString
        val cursor = page1.substringAfter("\"nextCursor\":\"").substringBefore('"')
        mvc.perform(get("/api/v1/me/notifications").param("limit", "2").param("cursor", cursor).header("Authorization", auth))
            .andExpect(status().isOk()).andExpect(jsonPath("$.items.length()").value(1))
            .andExpect(jsonPath("$.items[0].id").value(first)).andExpect(jsonPath("$.nextCursor").isEmpty())
        mvc.perform(get("/api/v1/me/notifications?cursor=broken").header("Authorization", auth)).andExpect(status().isBadRequest())
        mvc.perform(get("/api/v1/me/notifications?limit=0").header("Authorization", auth)).andExpect(status().isBadRequest())
    }

    @Test
    fun `cursor paging keeps notices with identical createdAt exactly once`() {
        val me = member(); val auth = bearer(me)
        val at = java.time.Instant.now().truncatedTo(java.time.temporal.ChronoUnit.MICROS)
        val ids = (1..3).map { UUID.randomUUID() }
        ids.forEach {
            jdbc.update("insert into notification(id,recipient_id,kind,summary,created_at) values (?,?,?,?,?)",
                it, me.id, NoticeKind.RESULT.code, "same time", java.sql.Timestamp.from(at))
        }
        val page1 = mvc.perform(get("/api/v1/me/notifications?limit=2").header("Authorization", auth))
            .andExpect(status().isOk()).andExpect(jsonPath("$.items.length()").value(2)).andReturn().response.contentAsString
        val cursor = page1.substringAfter("\"nextCursor\":\"").substringBefore('"')
        val page2 = mvc.perform(get("/api/v1/me/notifications").param("limit", "2").param("cursor", cursor).header("Authorization", auth))
            .andExpect(status().isOk()).andExpect(jsonPath("$.items.length()").value(1)).andReturn().response.contentAsString
        val seen = Regex("\"id\":\"([0-9a-f-]{36})\"").findAll(page1 + page2).map { it.groupValues[1] }.toList()
        assertEquals(3, seen.size)
        assertEquals(ids.map { it.toString() }.toSet(), seen.toSet())
    }

    @Test
    fun `read is idempotent and other members get 404`() {
        val me = member(); val other = member(); val auth = bearer(me)
        val id = add(me, "hello")
        mvc.perform(get("/api/v1/me/notifications/unread-count").header("Authorization", auth)).andExpect(jsonPath("$.count").value(1))
        mvc.perform(json(patch("/api/v1/me/notifications/$id/read"), auth, "")).andExpect(status().isNoContent())
        mvc.perform(json(patch("/api/v1/me/notifications/$id/read"), auth, "")).andExpect(status().isNoContent())
        mvc.perform(get("/api/v1/me/notifications/unread-count").header("Authorization", auth)).andExpect(jsonPath("$.count").value(0))
        mvc.perform(json(patch("/api/v1/me/notifications/$id/read"), bearer(other), "")).andExpect(status().isNotFound())
        mvc.perform(json(delete("/api/v1/me/notifications/$id"), bearer(other), "")).andExpect(status().isNotFound())
        mvc.perform(json(patch("/api/v1/me/notifications/${UUID.randomUUID()}/read"), auth, "")).andExpect(status().isNotFound())
    }

    @Test
    fun `read-all only touches notices up to the given time`() {
        val me = member(); val auth = bearer(me)
        add(me, "old")
        val boundary = jdbc.queryForObject("select now()", java.sql.Timestamp::class.java)!!.toInstant()
        Thread.sleep(50)
        add(me, "newer")
        mvc.perform(json(post("/api/v1/me/notifications/read-all"), auth, """{"upTo":"$boundary"}""")).andExpect(status().isNoContent())
        mvc.perform(get("/api/v1/me/notifications/unread-count").header("Authorization", auth)).andExpect(jsonPath("$.count").value(1))
        mvc.perform(json(post("/api/v1/me/notifications/read-all"), auth, "{}")).andExpect(status().isBadRequest())
    }

    @Test
    fun `delete hides the notice but keeps the row`() {
        val me = member(); val auth = bearer(me)
        val id = add(me, "bye")
        mvc.perform(json(delete("/api/v1/me/notifications/$id"), auth, "")).andExpect(status().isNoContent())
        mvc.perform(json(delete("/api/v1/me/notifications/$id"), auth, "")).andExpect(status().isNoContent())
        mvc.perform(get("/api/v1/me/notifications").header("Authorization", auth)).andExpect(jsonPath("$.items.length()").value(0))
        mvc.perform(get("/api/v1/me/notifications/unread-count").header("Authorization", auth)).andExpect(jsonPath("$.count").value(0))
        mvc.perform(json(patch("/api/v1/me/notifications/$id/read"), auth, "")).andExpect(status().isNotFound())
        assertEquals(1, jdbc.queryForObject("select count(*) from notification where id = ?::uuid and deleted_at is not null", Int::class.java, id))
    }

    @Test
    fun `preferences default to enabled and only reading and creation can be disabled`() {
        val me = member(); val auth = bearer(me)
        mvc.perform(get("/api/v1/me/notification-preferences").header("Authorization", auth)).andExpect(status().isOk())
            .andExpect(jsonPath("$.items.length()").value(5)).andExpect(jsonPath("$.items[?(@.kind=='creation')].enabled").value(true))
            .andExpect(jsonPath("$.items[?(@.kind=='result')].mutable").value(false))
        mvc.perform(json(put("/api/v1/me/notification-preferences"), auth, """{"items":[{"kind":"result","enabled":false}]}""")).andExpect(status().isBadRequest())
        mvc.perform(json(put("/api/v1/me/notification-preferences"), auth, """{"items":[{"kind":"nope","enabled":false}]}""")).andExpect(status().isBadRequest())
        mvc.perform(json(put("/api/v1/me/notification-preferences"), auth, """{"items":[{"kind":"creation","enabled":false},{"kind":"creation","enabled":true}]}""")).andExpect(status().isBadRequest())
        mvc.perform(json(put("/api/v1/me/notification-preferences"), auth, """{"items":[]}""")).andExpect(status().isBadRequest())
        mvc.perform(json(put("/api/v1/me/notification-preferences"), auth, """{"items":[{"kind":"creation","enabled":false}]}""")).andExpect(status().isOk())
            .andExpect(jsonPath("$.items[?(@.kind=='creation')].enabled").value(false))
    }

    @Test
    fun `concurrent first preference saves for the same member and category both succeed`() {
        val pool = java.util.concurrent.Executors.newFixedThreadPool(8)
        try {
            repeat(6) {
                val me = member(); val auth = bearer(me)
                val start = java.util.concurrent.CountDownLatch(1)
                val body = """{"items":[{"kind":"creation","enabled":false}]}"""
                val calls = (1..4).map {
                    pool.submit<Int> {
                        start.await()
                        mvc.perform(json(put("/api/v1/me/notification-preferences"), auth, body)).andReturn().response.status
                    }
                }
                start.countDown()
                assertEquals(listOf(200, 200, 200, 200), calls.map { it.get() })
                assertEquals(1, jdbc.queryForObject("select count(*) from notification_preference where member_id = ?", Int::class.java, me.id))
            }
        } finally {
            pool.shutdownNow()
        }
    }

    @Test
    fun `disabled categories are not created but earlier notices stay`() {
        val me = member(); val auth = bearer(me)
        add(me, "before", NoticeKind.CREATION)
        mvc.perform(json(put("/api/v1/me/notification-preferences"), auth, """{"items":[{"kind":"creation","enabled":false}]}""")).andExpect(status().isOk())
        assertNull(notices.create(NoticeCreateRequest(me.id, NoticeKind.CREATION, "after")))
        assertNotNull(notices.create(NoticeCreateRequest(me.id, NoticeKind.RESULT, "always")))
        mvc.perform(get("/api/v1/me/notifications").header("Authorization", auth)).andExpect(jsonPath("$.items.length()").value(2))
    }
}
