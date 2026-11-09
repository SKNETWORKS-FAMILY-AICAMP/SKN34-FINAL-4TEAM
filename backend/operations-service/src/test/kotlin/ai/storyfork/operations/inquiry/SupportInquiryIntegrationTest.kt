package ai.storyfork.operations.inquiry

import ai.storyfork.operations._common.client.CoreClient
import ai.storyfork.operations.security.OperationsMember
import java.net.URI
import java.net.http.HttpClient
import java.net.http.HttpRequest
import java.net.http.HttpResponse
import java.time.Duration
import java.util.UUID
import org.junit.jupiter.api.AfterEach
import org.junit.jupiter.api.Assertions.*
import org.junit.jupiter.api.BeforeEach
import org.junit.jupiter.api.Test
import org.junit.jupiter.api.condition.EnabledIfEnvironmentVariable
import org.mockito.Mockito.*
import org.springframework.beans.factory.annotation.Autowired
import org.springframework.boot.test.context.SpringBootTest
import org.springframework.boot.test.web.server.LocalServerPort
import org.springframework.jdbc.core.JdbcTemplate
import org.springframework.test.context.bean.override.mockito.MockitoBean
import tools.jackson.databind.json.JsonMapper

/**
 * CI-only HTTP/PostgreSQL coverage of the real member Bearer chain, controller, service, JPQL status filters and
 * Flyway V6. Core's Bearer verification is a test double; cleanup touches only inquiry UUIDs created by this test.
 */
@SpringBootTest(webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT, properties = [
    "DATABASE_URL=\${TEST_OPERATIONS_DATABASE_URL}",
    "DATABASE_USER=\${TEST_OPERATIONS_DATABASE_USER:operations_test}",
    "DATABASE_PASSWORD=\${TEST_OPERATIONS_DATABASE_PASSWORD:}",
    "OPERATIONS_SERVICE_TOKEN=support-inquiry-ci-service-token-not-a-production-secret",
])
@EnabledIfEnvironmentVariable(named = "TEST_OPERATIONS_DATABASE_URL", matches = ".+")
class SupportInquiryIntegrationTest {
    @LocalServerPort private var port = 0
    @MockitoBean lateinit var core: CoreClient
    @Autowired private lateinit var jdbc: JdbcTemplate
    @Autowired private lateinit var json: JsonMapper
    private val createdIds = mutableListOf<UUID>()
    private val client = HttpClient.newBuilder().connectTimeout(Duration.ofSeconds(10)).build()
    private val base = "/api/v1/operations/support/inquiries"
    private val serviceToken = "support-inquiry-ci-service-token-not-a-production-secret"

    private val memberId = UUID.randomUUID()
    private val strangerId = UUID.randomUUID()
    // Sample admin seeded by Core; operations V4 grants it every permission, including `feedback`.
    private val adminId = UUID.fromString("5f0c2c7e-8a51-4d6b-9a39-1f4f2b6d0a01")
    private val memberBearer = "Bearer member-access"
    private val strangerBearer = "Bearer stranger-access"
    private val adminBearer = "Bearer admin-access"

    @BeforeEach
    fun coreVerifiesTheTestBearers() {
        `when`(core.verify(memberBearer)).thenReturn(OperationsMember(memberId, false))
        `when`(core.verify(strangerBearer)).thenReturn(OperationsMember(strangerId, false))
        `when`(core.verify(adminBearer)).thenReturn(OperationsMember(adminId, true))
    }

    @AfterEach
    fun cleanOnlyCreatedRecords() {
        for (id in createdIds) {
            jdbc.update("DELETE FROM operations.inquiry_reply WHERE inquiry_id = ?", id)
            jdbc.update("DELETE FROM operations.inquiry WHERE id = ?", id)
        }
    }

    private fun send(method: String, path: String, bearer: String? = null, body: String? = null, withServiceToken: Boolean = false): HttpResponse<String> {
        val request = HttpRequest.newBuilder(URI.create("http://127.0.0.1:$port$path"))
            .timeout(Duration.ofSeconds(10)).header("Accept", "application/json")
        if (bearer != null) request.header("Authorization", bearer)
        if (withServiceToken) request.header("X-Operations-Service-Token", serviceToken)
        if (body != null) request.header("Content-Type", "application/json")
        val publisher = body?.let(HttpRequest.BodyPublishers::ofString) ?: HttpRequest.BodyPublishers.noBody()
        return client.send(request.method(method, publisher).build(), HttpResponse.BodyHandlers.ofString())
    }

    private fun tree(response: HttpResponse<String>) = json.readTree(response.body())

    // Jackson 3 JsonNode has its own member map(Function) that wins over Iterable.map, so iterate through values().
    private fun itemIds(response: HttpResponse<String>) = tree(response).path("items").values().map { it.path("id").asString() }

    private fun replyBodies(response: HttpResponse<String>) = tree(response).path("replies").values().map { it.path("body").asString() }

    private fun file(title: String = "로그인 문의"): UUID {
        val response = send("POST", base, memberBearer, """{"category":"이용","title":"$title","body":"본문"}""")
        assertEquals(201, response.statusCode(), response.body())
        return UUID.fromString(tree(response).path("id").asString()).also { createdIds.add(it) }
    }

    @Test
    fun `member files an inquiry, an admin answers it and the member then sees it answered`() {
        val created = send("POST", base, memberBearer, """{"category":" 이용 ","title":" 로그인 문의 ","body":"로그인이 안 됩니다"}""")
        assertEquals(201, created.statusCode(), created.body())
        val id = UUID.fromString(tree(created).path("id").asString()).also { createdIds.add(it) }
        assertEquals("WAITING", tree(created).path("status").asString())
        assertEquals("이용", tree(created).path("category").asString())
        assertEquals("로그인 문의", tree(created).path("title").asString())
        assertEquals(memberId.toString(), tree(created).path("memberId").asString())
        assertEquals(0, tree(created).path("replies").size())

        assertTrue(itemIds(send("GET", "$base/mine", memberBearer)).contains(id.toString()))
        assertFalse(itemIds(send("GET", "$base/mine", strangerBearer)).contains(id.toString()))
        assertTrue(itemIds(send("GET", "$base?status=WAITING", adminBearer)).contains(id.toString()))
        assertFalse(itemIds(send("GET", "$base?status=ANSWERED", adminBearer)).contains(id.toString()))

        val answered = send("POST", "$base/$id/replies", adminBearer, """{"body":"확인했습니다"}""")
        assertEquals(201, answered.statusCode(), answered.body())
        assertEquals("ANSWERED", tree(answered).path("status").asString())
        val replyId = tree(answered).path("replies").path(0).path("id").asString()

        val detail = send("GET", "$base/$id", memberBearer)
        assertEquals(200, detail.statusCode(), detail.body())
        assertEquals("ANSWERED", tree(detail).path("status").asString())
        assertEquals(listOf("확인했습니다"), replyBodies(detail))
        assertFalse(itemIds(send("GET", "$base?status=WAITING", adminBearer)).contains(id.toString()))
        assertTrue(itemIds(send("GET", "$base?status=ANSWERED", adminBearer)).contains(id.toString()))

        val edited = send("PUT", "$base/$id/replies/$replyId", adminBearer, """{"body":"수정한 답변"}""")
        assertEquals(200, edited.statusCode(), edited.body())
        assertEquals(listOf("수정한 답변"), replyBodies(edited))

        val removed = send("DELETE", "$base/$id/replies/$replyId", adminBearer)
        assertEquals(200, removed.statusCode(), removed.body())
        assertEquals("WAITING", tree(removed).path("status").asString())
        assertEquals(0, tree(removed).path("replies").size())
    }

    @Test
    fun `ownership and admin permission are enforced and a foreign reply id is not found`() {
        val id = file()
        val other = file("다른 문의")
        val otherReply = send("POST", "$base/$other/replies", adminBearer, """{"body":"다른 문의 답변"}""")
        assertEquals(201, otherReply.statusCode(), otherReply.body())
        val otherReplyId = tree(otherReply).path("replies").path(0).path("id").asString()

        // Members cannot use admin endpoints, not even for their own inquiry.
        assertEquals(403, send("GET", base, memberBearer).statusCode())
        assertEquals(403, send("POST", "$base/$id/replies", memberBearer, """{"body":"자작 답변"}""").statusCode())
        // Another member gets 404; the author and an admin can read it.
        assertEquals(404, send("GET", "$base/$id", strangerBearer).statusCode())
        assertEquals(200, send("GET", "$base/$id", adminBearer).statusCode())
        assertEquals(0, tree(send("GET", "$base/$id", memberBearer)).path("replies").size())

        assertEquals(404, send("PUT", "$base/$id/replies/$otherReplyId", adminBearer, """{"body":"잘못된 수정"}""").statusCode())
        assertEquals(404, send("DELETE", "$base/$id/replies/$otherReplyId", adminBearer).statusCode())
        assertEquals(listOf("다른 문의 답변"), replyBodies(send("GET", "$base/$other", memberBearer)))
    }

    @Test
    fun `invalid input is a 400 and stores nothing`() {
        val id = file()

        // Blank and NUL fields are covered by SupportInquiryServiceTest and the @Size limits by RequestValidationTest;
        // here only the HTTP wiring is checked: missing fields and @Valid on the controller (an oversized value must stop there).
        for (body in listOf("""{"category":"이용","title":"제목"}""", "{}", """{"category":"이용","title":"${"t".repeat(201)}","body":"본문"}"""))
            assertEquals(400, send("POST", base, memberBearer, body).statusCode(), body.take(60))
        assertEquals(400, send("POST", "$base/$id/replies", adminBearer, """{"body":" "}""").statusCode())
        assertEquals(400, send("POST", "$base/$id/replies", adminBearer, """{"body":"${"b".repeat(20001)}"}""").statusCode())
        assertEquals(400, send("GET", "$base?status=DONE", adminBearer).statusCode())

        assertEquals(1, tree(send("GET", "$base/mine", memberBearer)).path("items").size())
        assertEquals(0, tree(send("GET", "$base/$id", memberBearer)).path("replies").size())
    }

    @Test
    fun `requests without a Core verified Bearer are 401 and never reach Core`() {
        val missing = UUID.randomUUID()

        for (path in listOf(base, "$base/mine", "$base/$missing")) {
            assertEquals(401, send("GET", path).statusCode(), path)
            // The service token only authorizes the service-to-server API, never the member support routes.
            assertEquals(401, send("GET", path, withServiceToken = true).statusCode(), path)
        }
        assertEquals(401, send("POST", base, body = """{"category":"이용","title":"제목","body":"본문"}""", withServiceToken = true).statusCode())
        assertEquals(401, send("POST", "$base/$missing/replies", body = """{"body":"답변"}""", withServiceToken = true).statusCode())

        verifyNoInteractions(core)
    }

    @Test
    fun `legacy service token inquiries stay out of the member and admin APIs`() {
        val legacy = send("POST", "/api/v1/operations/inquiries", body = """{"title":"서버 문의","body":"본문","category":"이용"}""", withServiceToken = true)
        assertEquals(201, legacy.statusCode(), legacy.body())
        val id = UUID.fromString(tree(legacy).path("id").asString()).also { createdIds.add(it) }

        assertEquals(404, send("GET", "$base/$id", adminBearer).statusCode())
        assertEquals(404, send("POST", "$base/$id/replies", adminBearer, """{"body":"답변"}""").statusCode())
        assertFalse(itemIds(send("GET", base, adminBearer)).contains(id.toString()))
        assertFalse(itemIds(send("GET", "$base?status=WAITING", adminBearer)).contains(id.toString()))
        // The service token API itself is unchanged.
        assertEquals(200, send("GET", "/api/v1/operations/inquiries/$id", withServiceToken = true).statusCode())
    }
}
