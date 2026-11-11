package ai.storyfork.core.notification

import ai.storyfork.core.notification.domain.NoticeKind
import java.util.UUID
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

/** 알림 상세 조회와 묶음 알림 조회(UC-27 3단계)의 HTTP 동작을 PostgreSQL 위에서 확인한다. */
@SpringBootTest
@AutoConfigureMockMvc
@EnabledIfEnvironmentVariable(named = "AUTH_INTEGRATION_TEST", matches = "true")
class NoticeGroupIntegrationTest {
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
    private fun bearer(m: Member): String {
        val response = mvc.perform(csrf(post("/api/v1/auth/login")).contentType(MediaType.APPLICATION_JSON)
            .content("{\"email\":\"${m.email}\",\"password\":\"test-password\"}")).andReturn().response
        return "Bearer " + response.contentAsString.substringAfter("\"accessToken\":\"").substringBefore('"')
    }
    private fun json(request: MockHttpServletRequestBuilder, auth: String) =
        csrf(request).header("Authorization", auth).contentType(MediaType.APPLICATION_JSON).content("")

    /** 도착 시각을 지금보다 secondsAgo초 전으로 직접 넣어 최신순 결과를 결정적으로 만든다. */
    private fun insert(m: Member, kind: NoticeKind, summary: String, secondsAgo: Long, type: String? = null, target: String? = null): String {
        val id = UUID.randomUUID()
        jdbc.update("insert into notification(id,recipient_id,kind,summary,target_type,target_id,created_at) values (?,?,?,?,?,?,?)",
            id, m.id, kind.code, summary, type, target, java.sql.Timestamp.from(java.time.Instant.now().minusSeconds(secondsAgo)))
        return id.toString()
    }

    @Test
    fun `detail returns only the owners live notice and does not mark it read`() {
        val me = member(); val other = member(); val auth = bearer(me)
        val id = insert(me, NoticeKind.RESULT, "hello", 10, "episode", "e1")
        mvc.perform(get("/api/v1/me/notifications/$id").header("Authorization", auth))
            .andExpect(status().isOk()).andExpect(jsonPath("$.id").value(id)).andExpect(jsonPath("$.summary").value("hello"))
            .andExpect(jsonPath("$.targetType").value("episode")).andExpect(jsonPath("$.targetId").value("e1")).andExpect(jsonPath("$.read").value(false))
        mvc.perform(get("/api/v1/me/notifications/unread-count").header("Authorization", auth)).andExpect(jsonPath("$.count").value(1))
        mvc.perform(get("/api/v1/me/notifications/$id").header("Authorization", bearer(other))).andExpect(status().isNotFound())
        mvc.perform(get("/api/v1/me/notifications/${UUID.randomUUID()}").header("Authorization", auth)).andExpect(status().isNotFound())
        mvc.perform(get("/api/v1/me/notifications/not-a-uuid").header("Authorization", auth)).andExpect(status().isNotFound())
        mvc.perform(get("/api/v1/me/notifications/$id")).andExpect(status().isUnauthorized())
        mvc.perform(json(delete("/api/v1/me/notifications/$id"), auth)).andExpect(status().isNoContent())
        mvc.perform(get("/api/v1/me/notifications/$id").header("Authorization", auth)).andExpect(status().isNotFound())
    }

    @Test
    fun `groups fold the same kind and target with counts and keep other members out`() {
        val me = member(); val other = member(); val auth = bearer(me)
        val firstComment = insert(me, NoticeKind.CREATION, "comment 1", 50, "work", "w1")
        insert(me, NoticeKind.CREATION, "comment 2", 40, "work", "w1")
        insert(me, NoticeKind.CREATION, "comment 3", 10, "work", "w1")
        insert(me, NoticeKind.CREATION, "other work", 20, "work", "w2")
        insert(me, NoticeKind.READING, "same target other kind", 5, "work", "w1")
        insert(me, NoticeKind.RESULT, "no target", 1)
        insert(other, NoticeKind.CREATION, "not mine", 1, "work", "w1")
        mvc.perform(json(patch("/api/v1/me/notifications/$firstComment/read"), auth)).andExpect(status().isNoContent())

        mvc.perform(get("/api/v1/me/notifications/groups").header("Authorization", auth))
            .andExpect(status().isOk()).andExpect(jsonPath("$.items.length()").value(3))
            .andExpect(jsonPath("$.items[0].kind").value("reading")).andExpect(jsonPath("$.items[0].count").value(1))
            .andExpect(jsonPath("$.items[1].kind").value("creation")).andExpect(jsonPath("$.items[1].targetId").value("w1"))
            .andExpect(jsonPath("$.items[1].count").value(3)).andExpect(jsonPath("$.items[1].unreadCount").value(2))
            .andExpect(jsonPath("$.items[1].latestSummary").value("comment 3"))
            .andExpect(jsonPath("$.items[2].targetId").value("w2"))
        mvc.perform(get("/api/v1/me/notifications/groups?limit=1").header("Authorization", auth)).andExpect(jsonPath("$.items.length()").value(1))
        mvc.perform(get("/api/v1/me/notifications/groups?limit=0").header("Authorization", auth)).andExpect(status().isBadRequest())
        mvc.perform(get("/api/v1/me/notifications/groups")).andExpect(status().isUnauthorized())
    }

    @Test
    fun `deleted notices leave their group`() {
        val me = member(); val auth = bearer(me)
        val gone = insert(me, NoticeKind.CREATION, "gone", 5, "work", "w1")
        insert(me, NoticeKind.CREATION, "stays", 20, "work", "w1")
        mvc.perform(json(delete("/api/v1/me/notifications/$gone"), auth)).andExpect(status().isNoContent())
        mvc.perform(get("/api/v1/me/notifications/groups").header("Authorization", auth))
            .andExpect(jsonPath("$.items[0].count").value(1)).andExpect(jsonPath("$.items[0].latestSummary").value("stays"))
        val only = insert(me, NoticeKind.CREATION, "only", 1, "work", "w9")
        mvc.perform(json(delete("/api/v1/me/notifications/$only"), auth)).andExpect(status().isNoContent())
        mvc.perform(get("/api/v1/me/notifications/groups").header("Authorization", auth)).andExpect(jsonPath("$.items.length()").value(1))
    }

    @Test
    fun `group items list only the matching live notices newest first and reject missing filters`() {
        val me = member(); val auth = bearer(me)
        val oldest = insert(me, NoticeKind.CREATION, "first", 30, "work", "w1")
        val newest = insert(me, NoticeKind.CREATION, "second", 10, "work", "w1")
        insert(me, NoticeKind.CREATION, "elsewhere", 5, "work", "w2")
        insert(me, NoticeKind.READING, "other kind", 5, "work", "w1")
        val deleted = insert(me, NoticeKind.CREATION, "deleted", 1, "work", "w1")
        mvc.perform(json(delete("/api/v1/me/notifications/$deleted"), auth)).andExpect(status().isNoContent())

        mvc.perform(get("/api/v1/me/notifications/groups/items").param("kind", "creation").param("targetType", "work").param("targetId", "w1").header("Authorization", auth))
            .andExpect(status().isOk()).andExpect(jsonPath("$.items.length()").value(2))
            .andExpect(jsonPath("$.items[0].id").value(newest)).andExpect(jsonPath("$.items[1].id").value(oldest)).andExpect(jsonPath("$.nextCursor").isEmpty())
        mvc.perform(get("/api/v1/me/notifications/groups/items").param("kind", "creation").header("Authorization", auth)).andExpect(status().isBadRequest())
        mvc.perform(get("/api/v1/me/notifications/groups/items").param("kind", "creation").param("targetType", "work").param("targetId", "w1").param("limit", "0").header("Authorization", auth))
            .andExpect(status().isBadRequest())
        mvc.perform(get("/api/v1/me/notifications/groups/items").param("kind", "creation").param("targetType", "work").param("targetId", "w1")).andExpect(status().isUnauthorized())
        mvc.perform(get("/api/v1/me/notifications/groups/items").param("kind", "creation").param("targetType", "work").param("targetId", "none").header("Authorization", auth))
            .andExpect(status().isOk()).andExpect(jsonPath("$.items.length()").value(0))
    }
}
