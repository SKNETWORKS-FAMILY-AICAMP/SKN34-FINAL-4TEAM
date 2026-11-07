package ai.storyfork.operations.event

import ai.storyfork.operations.event.entity.EventEntity
import ai.storyfork.operations.event.repository.EventRepository
import jakarta.persistence.EntityManagerFactory
import jakarta.persistence.OptimisticLockException
import jakarta.persistence.RollbackException
import java.net.URI
import java.net.http.HttpClient
import java.net.http.HttpRequest
import java.net.http.HttpResponse
import java.time.Instant
import java.util.UUID
import org.junit.jupiter.api.Assertions.*
import org.junit.jupiter.api.Test
import org.junit.jupiter.api.condition.EnabledIfEnvironmentVariable
import org.springframework.beans.factory.annotation.Autowired
import org.springframework.boot.test.context.SpringBootTest
import org.springframework.boot.test.web.server.LocalServerPort
import org.springframework.test.context.DynamicPropertyRegistry
import org.springframework.test.context.DynamicPropertySource
import tools.jackson.databind.json.JsonMapper

/** 격리 PostgreSQL을 제공하는 CI에서만 실제 HTTP·JPA·Flyway 경계를 검증한다. */
@SpringBootTest(webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT, properties = [
    "app.operations.service-token=event-integration-service-token-at-least-32",
])
@EnabledIfEnvironmentVariable(named = "TEST_OPERATIONS_DATABASE_URL", matches = ".+")
class EventIntegrationTest {
    @LocalServerPort var port = 0
    @Autowired lateinit var events: EventRepository
    @Autowired lateinit var entityManagers: EntityManagerFactory
    @Autowired lateinit var json: JsonMapper
    private val client = HttpClient.newHttpClient()
    private val path = "/api/v1/operations/events"
    private val token = "event-integration-service-token-at-least-32"

    @Test
    fun `HTTP CRUD persists UTC announcements clears optional periods and reports missing rows`() {
        val created = send("POST", path, """{"title":"이벤트","body":"안내","startsAt":"2026-11-05T10:00:00+09:00","endsAt":"2026-11-06T10:00:00+09:00"}""")
        assertEquals(201, created.statusCode(), created.body())
        val initial = json.readTree(created.body())
        val id = UUID.fromString(initial.path("id").asText())
        try {
            assertEquals("$path/$id", created.headers().firstValue("Location").orElseThrow())
            assertEquals("2026-11-05T01:00:00Z", initial.path("startsAt").asText())
            assertEquals("2026-11-06T01:00:00Z", initial.path("endsAt").asText())
            assertTrue(initial.path("createdAt").asText().endsWith("Z"))
            assertTrue(initial.path("updatedAt").asText().endsWith("Z"))
            val stored = events.findById(id).orElseThrow()
            assertEquals("안내", stored.body)
            assertEquals(Instant.parse("2026-11-05T01:00:00Z"), stored.startsAt)
            assertEquals(0L, stored.version)
            assertEquals(200, send("GET", "$path/$id").statusCode())
            val list = send("GET", "$path?size=1000&sort=body,asc")
            assertEquals(200, list.statusCode(), list.body())
            val page = json.readTree(list.body())
            assertEquals(100, page.path("size").asInt())
            assertTrue(page.path("items").any { it.path("id").asText() == id.toString() })
            assertFalse(page.has("content"))
            val defaults = send("GET", path)
            assertEquals(20, json.readTree(defaults.body()).path("size").asInt())

            val updated = send("PUT", "$path/$id", """{"title":"수정 제목","body":"수정 안내"}""")
            assertEquals(200, updated.statusCode(), updated.body())
            val updatedBody = json.readTree(updated.body())
            assertEquals("수정 제목", updatedBody.path("title").asText())
            assertTrue(updatedBody.path("startsAt").isNull)
            assertTrue(updatedBody.path("endsAt").isNull)
            val after = events.findById(id).orElseThrow()
            assertEquals("수정 안내", after.body)
            assertNull(after.startsAt)
            assertNull(after.endsAt)
            assertEquals(stored.createdAt, after.createdAt)
            assertEquals(1L, after.version)

            val deleted = send("DELETE", "$path/$id")
            assertEquals(204, deleted.statusCode(), deleted.body())
            assertEquals("", deleted.body())
            assertFalse(events.existsById(id))
            assertEquals(404, send("GET", "$path/$id").statusCode())
            assertEquals(404, send("PUT", "$path/$id", """{"title":"제목","body":"본문"}""").statusCode())
            assertEquals(404, send("DELETE", "$path/$id").statusCode())
        } finally {
            events.deleteById(id)
        }
    }

    @Test
    fun `invalid HTTP update preserves the original stored row and does not echo inputs`() {
        val original = events.saveAndFlush(EventEntity(
            title = "원래 제목", body = "원래 본문",
            startsAt = Instant.parse("2026-11-05T00:00:00Z"), endsAt = Instant.parse("2026-11-06T00:00:00Z"),
        ))
        try {
            val invalidBodies = listOf(
                """{"title":"","body":"invalid-secret-value"}""",
                """{"title":"제목","body":"   "}""",
                json.writeValueAsString(mapOf("title" to "가".repeat(201), "body" to "본문")),
                json.writeValueAsString(mapOf("title" to "제목", "body" to "나".repeat(20_001))),
                """{"title":"변경","body":"변경","startsAt":"2026-11-07T00:00:00Z","endsAt":"2026-11-06T00:00:00Z"}""",
                """{"title":null,"body":"본문"}""",
                """{"title":"제목"}""",
                """{"title":"제목","body":"본문","startsAt":"not-a-date"}""",
            )
            for (body in invalidBodies) {
                val response = send("PUT", "$path/${original.id}", body)
                assertEquals(400, response.statusCode(), response.body())
                assertFalse(response.body().contains("invalid-secret-value"))
                val unchanged = events.findById(original.id).orElseThrow()
                assertEquals(original.title, unchanged.title)
                assertEquals(original.body, unchanged.body)
                assertEquals(original.startsAt, unchanged.startsAt)
                assertEquals(original.endsAt, unchanged.endsAt)
                assertEquals(original.updatedAt, unchanged.updatedAt)
                assertEquals(original.version, unchanged.version)
            }
            assertEquals(400, send("GET", "$path/not-a-uuid").statusCode())
            assertEquals(400, send("POST", path, """{"title":"제목","body":"본문","startsAt":"2026-11-07T00:00:00Z","endsAt":"2026-11-06T00:00:00Z"}""").statusCode())
        } finally {
            events.deleteById(original.id)
        }
    }

    @Test
    fun `every event route requires the shared service token`() {
        val id = UUID.randomUUID()
        val routes = listOf("GET" to path, "GET" to "$path/$id", "POST" to path, "PUT" to "$path/$id", "DELETE" to "$path/$id")
        for ((method, route) in routes) {
            val body = if (method == "POST" || method == "PUT") """{"title":"제목","body":"본문"}""" else null
            assertEquals(401, send(method, route, body, null).statusCode(), "$method $route")
            assertEquals(401, send(method, route, body, "incorrect-service-token").statusCode(), "$method $route")
        }
    }

    @Test
    fun `equal creation timestamps use UUID as a stable pagination tie breaker`() {
        val time = Instant.parse("2099-01-01T00:00:00Z")
        val rows = List(3) { index -> EventEntity(title = "이벤트 $index", body = "본문", createdAt = time) }
        events.saveAllAndFlush(rows)
        try {
            // CI 로그는 UUID를 가리므로 같은 순서를 제목으로 비교해 실패 원인을 읽을 수 있게 한다.
            val expected = rows.sortedByDescending { it.id.toString() }.map { it.title }
            val first = send("GET", "$path?size=2&sort=title,asc")
            val second = send("GET", "$path?size=2&page=1&sort=title,asc")
            assertEquals(200, first.statusCode(), first.body())
            assertEquals(200, second.statusCode(), second.body())
            assertEquals(expected.take(2), json.readTree(first.body()).path("items").map { it.path("title").asText() }, first.body())
            assertEquals(expected.drop(2), json.readTree(second.body()).path("items").map { it.path("title").asText() }.take(1), second.body())
        } finally {
            events.deleteAllById(rows.map { it.id })
        }
    }

    @Test
    fun `optimistic version rejects a stale writer without losing the first update`() {
        val original = events.saveAndFlush(EventEntity(title = "원래 제목", body = "원래 본문"))
        val first = entityManagers.createEntityManager()
        val second = entityManagers.createEntityManager()
        try {
            first.transaction.begin()
            second.transaction.begin()
            val one = first.find(EventEntity::class.java, original.id)
            val two = second.find(EventEntity::class.java, original.id)
            one.title = "먼저 저장"
            two.title = "늦게 저장"
            first.transaction.commit()
            val failure = assertThrows(RollbackException::class.java) { second.transaction.commit() }
            assertTrue(generateSequence<Throwable>(failure) { it.cause }.any { it is OptimisticLockException })
            val stored = events.findById(original.id).orElseThrow()
            assertEquals("먼저 저장", stored.title)
            assertEquals(1L, stored.version)
        } finally {
            if (first.transaction.isActive) first.transaction.rollback()
            if (second.transaction.isActive) second.transaction.rollback()
            first.close()
            second.close()
            events.deleteById(original.id)
        }
    }

    private fun send(method: String, route: String, body: String? = null, credential: String? = token): HttpResponse<String> {
        val request = HttpRequest.newBuilder(URI.create("http://127.0.0.1:$port$route"))
            .header("Accept", "application/json")
        if (credential != null) request.header("X-Operations-Service-Token", credential)
        if (body != null) request.header("Content-Type", "application/json")
        request.method(method, body?.let(HttpRequest.BodyPublishers::ofString) ?: HttpRequest.BodyPublishers.noBody())
        return client.send(request.build(), HttpResponse.BodyHandlers.ofString())
    }

    companion object {
        @JvmStatic
        @DynamicPropertySource
        fun datasource(registry: DynamicPropertyRegistry) {
            registry.add("spring.datasource.url") { System.getenv("TEST_OPERATIONS_DATABASE_URL") }
            registry.add("spring.datasource.username") { System.getenv("TEST_OPERATIONS_DATABASE_USER") ?: "operations_test" }
            registry.add("spring.datasource.password") { System.getenv("TEST_OPERATIONS_DATABASE_PASSWORD") ?: "" }
        }
    }
}
