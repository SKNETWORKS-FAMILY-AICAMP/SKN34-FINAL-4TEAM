package ai.storyfork.operations.notice

import ai.storyfork.operations.notice.entity.NoticeEntity
import ai.storyfork.operations.notice.repository.NoticeRepository
import jakarta.persistence.EntityManager
import java.time.Instant
import java.util.UUID
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertFalse
import org.junit.jupiter.api.Assertions.assertThrows
import org.junit.jupiter.api.Test
import org.junit.jupiter.api.condition.EnabledIfEnvironmentVariable
import org.springframework.beans.factory.annotation.Autowired
import org.springframework.boot.test.context.SpringBootTest
import org.springframework.boot.webmvc.test.autoconfigure.AutoConfigureMockMvc
import org.springframework.http.MediaType
import org.springframework.orm.ObjectOptimisticLockingFailureException
import org.springframework.test.web.servlet.MockMvc
import org.springframework.test.web.servlet.request.MockHttpServletRequestBuilder
import org.springframework.test.web.servlet.request.MockMvcRequestBuilders.delete
import org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get
import org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post
import org.springframework.test.web.servlet.request.MockMvcRequestBuilders.put
import org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath
import org.springframework.test.web.servlet.result.MockMvcResultMatchers.status
import org.springframework.transaction.annotation.Transactional
import tools.jackson.databind.json.JsonMapper

/** 격리된 CI PostgreSQL에서만 공지 영속성·MVC·서비스 토큰 경계를 검증한다. */
@SpringBootTest(properties = [
    "DATABASE_URL=\${TEST_OPERATIONS_DATABASE_URL}",
    "DATABASE_USER=\${TEST_OPERATIONS_DATABASE_USER:operations_test}",
    "DATABASE_PASSWORD=\${TEST_OPERATIONS_DATABASE_PASSWORD:}",
    "OPERATIONS_SERVICE_TOKEN=notice-integration-service-token-at-least-32",
])
@AutoConfigureMockMvc
@Transactional
@EnabledIfEnvironmentVariable(named = "TEST_OPERATIONS_DATABASE_URL", matches = ".+")
class NoticeCrudIntegrationTest {
    @Autowired lateinit var mvc: MockMvc
    @Autowired lateinit var repository: NoticeRepository
    @Autowired lateinit var entityManager: EntityManager
    @Autowired lateinit var json: JsonMapper

    @Test
    fun `authorized CRUD persists plain text and preserves the creation timestamp`() {
        val body = "<b>일반 텍스트</b>\n 줄바꿈 "
        val created = mvc.perform(authorized(post(base)).content(payload("제목", body)))
            .andExpect(status().isCreated()).andReturn().response
        val result = json.readTree(created.contentAsString)
        val id = UUID.fromString(result.path("id").asText())
        assertEquals("$base/$id", created.getHeader("Location"))
        entityManager.clear()
        val stored = repository.findById(id).orElseThrow()
        assertEquals(body, stored.body)
        assertEquals(result.path("createdAt").asText(), result.path("updatedAt").asText())
        val createdAt = stored.createdAt

        mvc.perform(authorized(get("$base/$id")))
            .andExpect(status().isOk()).andExpect(jsonPath("$.body").value(body))
        mvc.perform(authorized(put("$base/$id")).content(payload("수정 제목", "수정 본문")))
            .andExpect(status().isOk()).andExpect(jsonPath("$.title").value("수정 제목"))
            .andExpect(jsonPath("$.body").value("수정 본문"))
        entityManager.clear()
        val updated = repository.findById(id).orElseThrow()
        assertEquals(createdAt, updated.createdAt)
        assertFalse(updated.updatedAt.isBefore(createdAt))
        assertEquals("수정 본문", updated.body)

        mvc.perform(authorized(delete("$base/$id"))).andExpect(status().isNoContent())
        entityManager.flush()
        entityManager.clear()
        assertFalse(repository.existsById(id))
        mvc.perform(authorized(get("$base/$id"))).andExpect(status().isNotFound())
    }

    @Test
    fun `list has bounded explicit metadata and stable UUID order for equal timestamps`() {
        val timestamp = Instant.parse("2100-01-01T00:00:00Z")
        val ids = (1L..3L).map { UUID(0, it) }
        ids.forEach { id ->
            repository.saveAndFlush(NoticeEntity(id = id, title = "목록", body = "본문", createdAt = timestamp))
        }
        entityManager.clear()

        mvc.perform(authorized(get(base)))
            .andExpect(status().isOk()).andExpect(jsonPath("$.size").value(20))
            .andExpect(jsonPath("$.page").value(0)).andExpect(jsonPath("$.totalElements").isNumber())
            .andExpect(jsonPath("$.totalPages").isNumber())
        mvc.perform(authorized(get(base).param("size", "2").param("sort", "title,asc")))
            .andExpect(status().isOk()).andExpect(jsonPath("$.items.length()").value(2))
            .andExpect(jsonPath("$.items[0].id").value(ids[2].toString()))
            .andExpect(jsonPath("$.items[1].id").value(ids[1].toString()))
        mvc.perform(authorized(get(base).param("size", "2").param("page", "1")))
            .andExpect(status().isOk()).andExpect(jsonPath("$.items[0].id").value(ids[0].toString()))
        mvc.perform(authorized(get(base).param("size", "10000")))
            .andExpect(status().isOk()).andExpect(jsonPath("$.size").value(100))
    }

    @Test
    fun `every notice operation rejects missing or wrong service credentials`() {
        val id = UUID.randomUUID()
        val requests = listOf<() -> MockHttpServletRequestBuilder>(
            { get(base) }, { get("$base/$id") },
            { post(base).content(payload("제목", "본문")) },
            { put("$base/$id").content(payload("제목", "본문")) },
            { delete("$base/$id") },
        )
        requests.forEach { request ->
            mvc.perform(request().contentType(MediaType.APPLICATION_JSON).header("X-User-Id", id))
                .andExpect(status().isUnauthorized())
            mvc.perform(request().contentType(MediaType.APPLICATION_JSON).header(tokenHeader, "incorrect-token"))
                .andExpect(status().isUnauthorized())
        }
    }

    @Test
    fun `invalid complete replacements return 400 without mutating the persisted notice`() {
        val entity = repository.saveAndFlush(NoticeEntity(title = "기존 제목", body = "기존 본문"))
        val invalid = listOf(
            payload("", "본문"), payload(" \t\n", "본문"), payload("가".repeat(201), "본문"),
            payload("제목", ""), payload("제목", " \t\n"), payload("제목", "나".repeat(20_001)),
            payload("제\u0000목", "본문"), payload("제목", "본\u0000문"),
            "{}", """{"title":"새 제목"}""", """{"title":null,"body":"본문"}""",
        )
        invalid.forEach { content ->
            mvc.perform(authorized(post(base)).content(content)).andExpect(status().isBadRequest())
            mvc.perform(authorized(put("$base/${entity.id}")).content(content)).andExpect(status().isBadRequest())
        }
        entityManager.clear()
        val unchanged = repository.findById(entity.id).orElseThrow()
        assertEquals("기존 제목", unchanged.title)
        assertEquals("기존 본문", unchanged.body)
        mvc.perform(authorized(get("$base/not-a-uuid"))).andExpect(status().isBadRequest())
    }

    @Test
    fun `missing notices return 404 for detail replacement and deletion`() {
        val path = "$base/${UUID.randomUUID()}"
        mvc.perform(authorized(get(path))).andExpect(status().isNotFound())
        mvc.perform(authorized(put(path)).content(payload("제목", "본문"))).andExpect(status().isNotFound())
        mvc.perform(authorized(delete(path))).andExpect(status().isNotFound())
    }

    @Test
    fun `the persisted JPA version prevents a stale entity from overwriting a newer update`() {
        val stale = repository.saveAndFlush(NoticeEntity(title = "원본", body = "본문"))
        entityManager.detach(stale)
        val current = repository.findById(stale.id).orElseThrow()
        current.title = "최신 변경"
        repository.flush()
        entityManager.clear()
        stale.title = "오래된 변경"

        assertThrows(ObjectOptimisticLockingFailureException::class.java) { repository.saveAndFlush(stale) }
    }

    private fun authorized(request: MockHttpServletRequestBuilder): MockHttpServletRequestBuilder =
        request.header(tokenHeader, token).contentType(MediaType.APPLICATION_JSON)

    private fun payload(title: String, body: String): String = json.writeValueAsString(mapOf("title" to title, "body" to body))

    companion object {
        private const val base = "/api/v1/operations/notices"
        private const val tokenHeader = "X-Operations-Service-Token"
        private const val token = "notice-integration-service-token-at-least-32"
    }
}
