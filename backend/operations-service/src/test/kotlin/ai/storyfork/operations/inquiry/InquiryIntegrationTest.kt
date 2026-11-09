package ai.storyfork.operations.inquiry

import ai.storyfork.operations.inquiry.entity.InquiryEntity
import ai.storyfork.operations.inquiry.entity.InquiryReplyEntity
import ai.storyfork.operations.inquiry.repository.InquiryReplyRepository
import ai.storyfork.operations.inquiry.repository.InquiryRepository
import java.net.URI
import java.net.http.HttpClient
import java.net.http.HttpRequest
import java.net.http.HttpResponse
import java.time.Duration
import java.util.UUID
import org.junit.jupiter.api.AfterEach
import org.junit.jupiter.api.Assertions.*
import org.junit.jupiter.api.Test
import org.junit.jupiter.api.condition.EnabledIfEnvironmentVariable
import org.springframework.beans.factory.annotation.Autowired
import org.springframework.boot.test.context.SpringBootTest
import org.springframework.boot.test.web.server.LocalServerPort
import org.springframework.dao.DataIntegrityViolationException
import org.springframework.dao.OptimisticLockingFailureException
import org.springframework.jdbc.core.JdbcTemplate
import tools.jackson.databind.json.JsonMapper

/** CI-only HTTP/PostgreSQL coverage; cleanup touches only inquiry UUIDs created by this test. */
@SpringBootTest(webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT, properties = [
    "DATABASE_URL=\${TEST_OPERATIONS_DATABASE_URL}",
    "DATABASE_USER=\${TEST_OPERATIONS_DATABASE_USER:operations_test}",
    "DATABASE_PASSWORD=\${TEST_OPERATIONS_DATABASE_PASSWORD:}",
    "OPERATIONS_SERVICE_TOKEN=inquiry-ci-service-token-not-a-production-secret",
])
@EnabledIfEnvironmentVariable(named = "TEST_OPERATIONS_DATABASE_URL", matches = ".+")
class InquiryIntegrationTest {
    @LocalServerPort private var port = 0
    @Autowired private lateinit var inquiries: InquiryRepository
    @Autowired private lateinit var replies: InquiryReplyRepository
    @Autowired private lateinit var jdbc: JdbcTemplate
    @Autowired private lateinit var json: JsonMapper
    private val createdIds = mutableListOf<UUID>()
    private val client = HttpClient.newBuilder().connectTimeout(Duration.ofSeconds(10)).build()
    private val base = "/api/v1/operations/inquiries"

    private fun send(method: String, path: String, body: String? = null, authenticated: Boolean = true): HttpResponse<String> {
        val request = HttpRequest.newBuilder(URI.create("http://127.0.0.1:$port$path"))
            .timeout(Duration.ofSeconds(10)).header("Accept", "application/json")
        if (authenticated) request.header("X-Operations-Service-Token", "inquiry-ci-service-token-not-a-production-secret")
        if (body != null) request.header("Content-Type", "application/json")
        return client.send(request.method(method, body?.let(HttpRequest.BodyPublishers::ofString) ?: HttpRequest.BodyPublishers.noBody()).build(), HttpResponse.BodyHandlers.ofString())
    }

    private fun create(): UUID {
        val response = send("POST", base, """{"title":"문의","body":"본문","category":"자유 분류"}""")
        assertEquals(201, response.statusCode(), response.body())
        return UUID.fromString(json.readTree(response.body()).path("id").asText()).also { id ->
            createdIds.add(id)
            assertEquals("$base/$id", response.headers().firstValue("Location").orElseThrow())
        }
    }

    @AfterEach
    fun cleanOnlyCreatedRecords() {
        for (id in createdIds) {
            jdbc.update("DELETE FROM operations.inquiry_reply WHERE inquiry_id = ?", id)
            jdbc.update("DELETE FROM operations.inquiry WHERE id = ?", id)
        }
    }

    @Test
    fun `HTTP CRUD enforces parent scoping and explicit reply-first inquiry deletion`() {
        val parent = create()
        val otherParent = create()
        val detail = send("GET", "$base/$parent")
        assertEquals(200, detail.statusCode(), detail.body())
        val createdAt = json.readTree(detail.body()).path("createdAt").asText()
        val list = send("GET", "$base?size=1000&sort=body,asc")
        assertEquals(200, list.statusCode(), list.body())
        assertEquals(100, json.readTree(list.body()).path("size").asInt())
        assertTrue(json.readTree(list.body()).path("items").isArray)

        val reply = send("POST", "$base/$parent/replies", """{"body":"운영 답변"}""")
        assertEquals(201, reply.statusCode(), reply.body())
        val replyId = json.readTree(reply.body()).path("id").asText()
        val replyPath = "$base/$parent/replies/$replyId"
        assertEquals(replyPath, reply.headers().firstValue("Location").orElseThrow())
        assertEquals(200, send("GET", replyPath).statusCode())
        val replyList = send("GET", "$base/$parent/replies")
        assertEquals(200, replyList.statusCode(), replyList.body())
        assertEquals(20, json.readTree(replyList.body()).path("size").asInt())
        assertEquals(1, json.readTree(replyList.body()).path("items").size())
        val otherList = send("GET", "$base/$otherParent/replies")
        assertEquals(200, otherList.statusCode(), otherList.body())
        assertEquals(0, json.readTree(otherList.body()).path("items").size())

        for (method in listOf("GET", "PUT", "DELETE")) {
            val response = send(method, "$base/$otherParent/replies/$replyId", if (method == "PUT") """{"body":"잘못된 변경"}""" else null)
            assertEquals(404, response.statusCode(), response.body())
        }
        assertEquals("운영 답변", json.readTree(send("GET", replyPath).body()).path("body").asText())
        assertEquals(409, send("DELETE", "$base/$parent").statusCode())
        assertEquals(200, send("GET", replyPath).statusCode())

        val invalid = send("PUT", "$base/$parent", """{"title":"변경 금지","body":"본문","category":" "}""")
        assertEquals(400, invalid.statusCode(), invalid.body())
        assertEquals("문의", json.readTree(send("GET", "$base/$parent").body()).path("title").asText())
        val updated = send("PUT", "$base/$parent", """{"title":"수정 문의","body":"새 본문","category":"새 자유 분류"}""")
        assertEquals(200, updated.statusCode(), updated.body())
        assertEquals("수정 문의", json.readTree(updated.body()).path("title").asText())
        assertEquals(createdAt, json.readTree(updated.body()).path("createdAt").asText())
        assertEquals(400, send("PUT", replyPath, """{"body":" "}""").statusCode())
        assertEquals("운영 답변", json.readTree(send("GET", replyPath).body()).path("body").asText())
        val updatedReply = send("PUT", replyPath, """{"body":"수정 답변"}""")
        assertEquals(200, updatedReply.statusCode(), updatedReply.body())
        assertEquals("수정 답변", json.readTree(updatedReply.body()).path("body").asText())
        assertEquals(204, send("DELETE", replyPath).statusCode())
        assertEquals(404, send("GET", replyPath).statusCode())
        assertEquals(204, send("DELETE", "$base/$parent").statusCode())
        assertEquals(404, send("GET", "$base/$parent").statusCode())
        assertEquals(404, send("GET", "$base/$parent/replies").statusCode())
    }

    @Test
    fun `HTTP rejects anonymous invalid and missing-resource requests without disclosing input`() {
        assertEquals(401, send("GET", base, authenticated = false).statusCode())
        assertEquals(401, send("POST", base, "{}", authenticated = false).statusCode())
        val invalid = send("POST", base, """{"title":"private-input","body":"","category":"category"}""")
        assertEquals(400, invalid.statusCode(), invalid.body())
        assertFalse(invalid.body().contains("private-input"))
        assertEquals(400, send("POST", base, "{}").statusCode())
        assertEquals(400, send("GET", "$base/not-a-uuid").statusCode())
        val missing = UUID.randomUUID()
        for (method in listOf("GET", "PUT", "DELETE")) {
            assertEquals(404, send(method, "$base/$missing", if (method == "PUT") """{"title":"t","body":"b","category":"c"}""" else null).statusCode())
        }
        assertEquals(404, send("POST", "$base/$missing/replies", """{"body":"답변"}""").statusCode())
    }

    @Test
    fun `PostgreSQL restricts parent deletion and optimistic versions protect inquiries and replies`() {
        val parent = inquiries.saveAndFlush(InquiryEntity(title = "DB 문의", body = "본문", category = "자유 분류"))
        createdIds.add(parent.id)
        val reply = replies.saveAndFlush(InquiryReplyEntity(inquiryId = parent.id, body = "답변"))
        assertNotNull(parent.version)
        assertNotNull(reply.version)
        assertNull(replies.findByIdAndInquiryId(reply.id, UUID.randomUUID()))
        assertThrows(DataIntegrityViolationException::class.java) { inquiries.deleteById(parent.id) }
        assertTrue(inquiries.existsById(parent.id))
        assertTrue(replies.existsById(reply.id))

        val inquiryFirst = inquiries.findById(parent.id).orElseThrow()
        val inquiryStale = inquiries.findById(parent.id).orElseThrow()
        inquiryFirst.title = "새 제목"
        inquiries.saveAndFlush(inquiryFirst)
        inquiryStale.body = "오래된 원고 변경"
        assertThrows(OptimisticLockingFailureException::class.java) { inquiries.saveAndFlush(inquiryStale) }
        assertEquals("새 제목", inquiries.findById(parent.id).orElseThrow().title)

        val replyFirst = replies.findByIdAndInquiryId(reply.id, parent.id)!!
        val replyStale = replies.findByIdAndInquiryId(reply.id, parent.id)!!
        replyFirst.body = "새 답변"
        replies.saveAndFlush(replyFirst)
        replyStale.body = "오래된 답변 변경"
        assertThrows(OptimisticLockingFailureException::class.java) { replies.saveAndFlush(replyStale) }
        assertEquals("새 답변", replies.findByIdAndInquiryId(reply.id, parent.id)!!.body)
    }
}
