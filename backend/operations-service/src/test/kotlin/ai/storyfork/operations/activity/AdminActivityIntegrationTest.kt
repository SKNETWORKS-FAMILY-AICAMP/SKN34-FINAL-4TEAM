package ai.storyfork.operations.activity

import ai.storyfork.operations._common.client.CoreClient
import ai.storyfork.operations.member.service.dto.MemberItem
import ai.storyfork.operations.member.service.dto.MemberListResponse
import ai.storyfork.operations.security.OperationsMember
import java.net.URI
import java.net.http.HttpClient
import java.net.http.HttpRequest
import java.net.http.HttpResponse
import java.sql.Timestamp
import java.time.Duration
import java.time.Instant
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
 * CI-only HTTP/PostgreSQL coverage of Flyway V7, the real member Bearer chain, the `admins` permission, the newest-first
 * list and one real admin action (notices) writing its record. Core is a test double; cleanup touches only rows this test created.
 */
@SpringBootTest(webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT, properties = [
    "DATABASE_URL=\${TEST_OPERATIONS_DATABASE_URL}",
    "DATABASE_USER=\${TEST_OPERATIONS_DATABASE_USER:operations_test}",
    "DATABASE_PASSWORD=\${TEST_OPERATIONS_DATABASE_PASSWORD:}",
    "OPERATIONS_SERVICE_TOKEN=admin-activity-ci-service-token-not-a-production-secret",
])
@EnabledIfEnvironmentVariable(named = "TEST_OPERATIONS_DATABASE_URL", matches = ".+")
class AdminActivityIntegrationTest {
    @LocalServerPort private var port = 0
    @MockitoBean lateinit var core: CoreClient
    @Autowired private lateinit var jdbc: JdbcTemplate
    @Autowired private lateinit var json: JsonMapper
    private val client = HttpClient.newBuilder().connectTimeout(Duration.ofSeconds(10)).build()
    private val activities = "/api/v1/operations/admin/activities"
    private val serviceToken = "admin-activity-ci-service-token-not-a-production-secret"

    /** Every row this test inserts has a target id starting with it, which is also how cleanup finds them. */
    private val runId = UUID.randomUUID().toString()
    private val createdNotices = mutableListOf<UUID>()

    // Sample admin seeded by Core; operations V4 grants it every permission, including `admins` and `notices`.
    private val adminId = UUID.fromString("5f0c2c7e-8a51-4d6b-9a39-1f4f2b6d0a01")
    private val adminBearer = "Bearer admin-access"
    private val memberBearer = "Bearer member-access"
    private val operatorBearer = "Bearer operator-access"

    @BeforeEach
    fun coreVerifiesTheTestBearers() {
        `when`(core.verify(adminBearer)).thenReturn(OperationsMember(adminId, true))
        `when`(core.verify(memberBearer)).thenReturn(OperationsMember(UUID.randomUUID(), false))
        // A Core operator that holds no permission row.
        `when`(core.verify(operatorBearer)).thenReturn(OperationsMember(UUID.randomUUID(), true))
        `when`(core.members(adminBearer, "ADMIN", null, null)).thenReturn(
            MemberListResponse(listOf(MemberItem(adminId, "admin@example.test", "운영 관리자", "ADMIN", false, Instant.EPOCH))),
        )
    }

    @AfterEach
    fun cleanOnlyCreatedRows() {
        jdbc.update("DELETE FROM operations.admin_activity WHERE target_id LIKE ?", "$runId%")
        for (id in createdNotices) {
            jdbc.update("DELETE FROM operations.admin_activity WHERE target_id = ?", id.toString())
            jdbc.update("DELETE FROM operations.notice WHERE id = ?", id)
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

    private fun insert(actor: UUID, action: String, targetId: String, detail: String?, createdAt: Instant) {
        jdbc.update(
            "INSERT INTO operations.admin_activity (id, actor_id, action, target_type, target_id, detail, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
            UUID.randomUUID(), actor, action, "NOTICE", targetId, detail, Timestamp.from(createdAt),
        )
    }

    // Jackson 3 JsonNode has its own member map(Function) that wins over Iterable.map, so iterate through values().
    private fun items(response: HttpResponse<String>) = json.readTree(response.body()).path("items").values().toList()

    @Test
    fun `the list needs a Core verified Bearer and the admins permission`() {
        assertEquals(401, send("GET", activities).statusCode())
        // The service token only authorizes the service-to-server API, never this member route.
        assertEquals(401, send("GET", activities, withServiceToken = true).statusCode())
        assertEquals(403, send("GET", activities, memberBearer).statusCode())
        assertEquals(403, send("GET", activities, operatorBearer).statusCode())
        assertEquals(200, send("GET", activities, adminBearer).statusCode())
    }

    @Test
    fun `an admin lists the newest rows first with the current nickname and null for an unknown admin`() {
        // The list is the newest 100 of the shared test database, so these rows are dated ahead of every other test's rows.
        val now = Instant.now()
        insert(UUID.randomUUID(), "MEMBER_RESTRICT", "$runId-old", null, now.plusSeconds(60))
        insert(adminId, "NOTICE_CREATE", "$runId-new", "새 공지", now.plusSeconds(120))

        val response = send("GET", activities, adminBearer)

        assertEquals(200, response.statusCode(), response.body())
        val mine = items(response).filter { it.path("targetId").asString().startsWith(runId) }
        assertEquals(listOf("$runId-new", "$runId-old"), mine.map { it.path("targetId").asString() })
        assertEquals("운영 관리자", mine[0].path("actorNickname").asString())
        assertEquals("새 공지", mine[0].path("detail").asString())
        assertTrue(mine[1].path("actorNickname").isNull)
        assertTrue(mine[1].path("detail").isNull)
    }

    @Test
    fun `changing a notice as an admin records it and the list shows the newest change first`() {
        val base = "/api/v1/operations/admin/notices"
        val created = send("POST", base, adminBearer, """{"title":"활동 기록 공지","body":"본문"}""")
        assertEquals(201, created.statusCode(), created.body())
        val id = UUID.fromString(json.readTree(created.body()).path("id").asString()).also { createdNotices.add(it) }
        assertEquals(200, send("PUT", "$base/$id", adminBearer, """{"title":"수정한 공지","body":"본문"}""").statusCode())
        // A read and a rejected change are not recorded.
        assertEquals(200, send("GET", "$base/$id", adminBearer).statusCode())
        assertEquals(403, send("PUT", "$base/$id", memberBearer, """{"title":"가로채기","body":"본문"}""").statusCode())
        assertEquals(204, send("DELETE", "$base/$id", adminBearer).statusCode())

        val mine = items(send("GET", activities, adminBearer)).filter { it.path("targetId").asString() == id.toString() }

        assertEquals(listOf("NOTICE_DELETE", "NOTICE_UPDATE", "NOTICE_CREATE"), mine.map { it.path("action").asString() })
        assertEquals(listOf(null, "수정한 공지", "활동 기록 공지"), mine.map { it.path("detail").takeUnless { detail -> detail.isNull }?.asString() })
        assertEquals(setOf(adminId.toString()), mine.map { it.path("actorId").asString() }.toSet())
        assertEquals(setOf("NOTICE"), mine.map { it.path("targetType").asString() }.toSet())
    }
}
