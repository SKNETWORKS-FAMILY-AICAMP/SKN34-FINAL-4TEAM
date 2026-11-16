package ai.storyfork.operations._common

import ai.storyfork.operations._common.client.ContentClient
import ai.storyfork.operations._common.client.CoreAdminRequest
import ai.storyfork.operations._common.client.CoreClient
import ai.storyfork.operations._common.client.UpstreamRejection
import ai.storyfork.operations._common.client.operationsRestClient
import ai.storyfork.operations.security.OperationsMember
import ai.storyfork.operations.work.service.dto.OperationsWork
import java.util.UUID
import org.junit.jupiter.api.Assertions.*
import org.junit.jupiter.api.Test
import org.springframework.http.HttpMethod
import org.springframework.http.HttpStatus
import org.springframework.http.MediaType
import org.springframework.test.web.client.MockRestServiceServer
import org.springframework.test.web.client.match.MockRestRequestMatchers.*
import org.springframework.test.web.client.response.MockRestResponseCreators.*
import org.springframework.web.server.ResponseStatusException
import tools.jackson.module.kotlin.jacksonMapperBuilder

/** In-memory MockRestServiceServer only: no Spring context, socket or database. */
class OperationsClientsIntegrationTest {
    private val token = "ops-test-token-0123456789abcdef0123"
    private val mapper = jacksonMapperBuilder().build()
    private val id = UUID.randomUUID()
    private val bearer = "Bearer admin-access"

    private fun core(): Pair<CoreClient, MockRestServiceServer> {
        val builder = operationsRestClient("http://core.test", token, mapper)
        val server = MockRestServiceServer.bindTo(builder).build()
        return CoreClient(builder.build()) to server
    }

    private fun content(): Pair<ContentClient, MockRestServiceServer> {
        val builder = operationsRestClient("http://content.test", token, mapper)
        val server = MockRestServiceServer.bindTo(builder).build()
        return ContentClient(builder.build()) to server
    }

    private fun status(call: () -> Unit): Int = assertThrows(ResponseStatusException::class.java) { call() }.statusCode.value()

    private val memberJson = """{"id":"$id","email":"a@example.test","nickname":"닉","role":"ADMIN","restricted":true,"createdAt":"2026-01-01T00:00:00Z"}"""

    @Test
    fun `verify forwards the member bearer with the service token and reads the operator flag`() {
        val (client, server) = core()
        server.expect(requestTo("http://core.test/internal/v1/auth/verify")).andExpect(method(HttpMethod.POST))
            .andExpect(header("Authorization", bearer)).andExpect(header("X-Operations-Service-Token", token))
            .andRespond(withSuccess("""{"memberId":"$id","operator":true}""", MediaType.APPLICATION_JSON))

        assertEquals(OperationsMember(id, true), client.verify(bearer))
        server.verify()
    }

    @Test
    fun `verify keeps 401 and 403 and maps any other failure to 502`() {
        for ((upstream, expected) in listOf(HttpStatus.UNAUTHORIZED to 401, HttpStatus.FORBIDDEN to 403,
            HttpStatus.NOT_FOUND to 502, HttpStatus.INTERNAL_SERVER_ERROR to 502)) {
            val (client, server) = core()
            server.expect(requestTo("http://core.test/internal/v1/auth/verify")).andRespond(withStatus(upstream))
            assertEquals(expected, status { client.verify(bearer) }, upstream.toString())
        }
        val (client, server) = core()
        server.expect(requestTo("http://core.test/internal/v1/auth/verify")).andRespond(withSuccess("not-json", MediaType.APPLICATION_JSON))
        assertEquals(502, status { client.verify(bearer) })
    }

    @Test
    fun `member search percent-encodes plus signs so Core does not read them as spaces`() {
        val (client, server) = core()
        server.expect(requestTo("http://core.test/internal/v1/members?q=a%2Bb%40x.com"))
            .andRespond(withSuccess("""{"items":[]}""", MediaType.APPLICATION_JSON))
        assertTrue(client.members(bearer, null, "a+b@x.com", null).items.isEmpty())
        server.verify()
    }

    @Test
    fun `Core member calls forward the admin bearer and query and parse MemberItem`() {
        val (client, server) = core()
        server.expect(requestTo("http://core.test/internal/v1/members?role=ADMIN&q=kim"))
            .andExpect(method(HttpMethod.GET)).andExpect(header("Authorization", bearer)).andExpect(header("X-Operations-Service-Token", token))
            .andRespond(withSuccess("""{"items":[$memberJson]}""", MediaType.APPLICATION_JSON))
        server.expect(requestTo("http://core.test/internal/v1/members/$id/restriction")).andExpect(method(HttpMethod.PUT))
            .andRespond(withSuccess(memberJson, MediaType.APPLICATION_JSON))
        server.expect(requestTo("http://core.test/internal/v1/members/admins")).andExpect(method(HttpMethod.POST))
            .andExpect(jsonPath("$.email").value("n@example.test")).andExpect(jsonPath("$.password").value("password1"))
            .andRespond(withStatus(HttpStatus.CREATED).contentType(MediaType.APPLICATION_JSON).body(memberJson))

        assertEquals("ADMIN", client.members(bearer, "ADMIN", "kim", null).items.single().role)
        assertTrue(client.restrict(bearer, id).restricted)
        assertEquals(id, client.createAdmin(bearer, CoreAdminRequest("n@example.test", "새", "password1")).id)
        server.verify()
    }

    @Test
    fun `Core and Content preserve 400 404 409 and map other failures to 502`() {
        for ((upstream, expected) in listOf(HttpStatus.BAD_REQUEST to 400, HttpStatus.NOT_FOUND to 404, HttpStatus.CONFLICT to 409,
            HttpStatus.UNAUTHORIZED to 502, HttpStatus.FORBIDDEN to 502, HttpStatus.SERVICE_UNAVAILABLE to 502)) {
            val (core, coreServer) = core()
            coreServer.expect(requestTo("http://core.test/internal/v1/members/$id/restriction")).andRespond(withStatus(upstream))
            assertEquals(expected, status { core.unrestrict(bearer, id) }, upstream.toString())
            val (content, contentServer) = content()
            contentServer.expect(requestTo("http://content.test/internal/v1/works/$id")).andRespond(withStatus(upstream))
            assertEquals(expected, status { content.work(id) }, upstream.toString())
        }
    }

    @Test
    fun `Content calls send only the service token and parse the work`() {
        val (client, server) = content()
        val owner = UUID.randomUUID()
        val body = """{"workId":"$id","ownerId":"$owner","title":"작품","restricted":true}"""
        server.expect(requestTo("http://content.test/internal/v1/works/$id/restriction")).andExpect(method(HttpMethod.PUT))
            .andExpect(header("X-Operations-Service-Token", token))
            .andExpect { assertNull(it.headers.getFirst("Authorization")) }
            .andRespond(withSuccess(body, MediaType.APPLICATION_JSON))
        server.expect(requestTo("http://content.test/internal/v1/works/$id/restriction")).andExpect(method(HttpMethod.DELETE))
            .andRespond(withSuccess(body.replace("true", "false"), MediaType.APPLICATION_JSON))

        val restricted = client.restrict(id)
        assertEquals(owner.toString(), restricted.ownerId)
        assertTrue(restricted.restricted)
        assertFalse(client.unrestrict(id).restricted)
        server.verify()
    }

    @Test
    fun `Content work list sends only the service token parses OperationsWorkList and maps failure to 502`() {
        val (client, server) = content()
        val owner = "ops-list-owner"
        val body = """
            {"items":[{"workId":"$id","ownerId":"$owner","title":"작품","authorName":"작가","originKind":"fork",
            "creationType":"external_derivative","rightsConfirmed":true,"visibility":"public","restricted":false}]}
        """.trimIndent()
        server.expect(requestTo("http://content.test/internal/v1/works")).andExpect(method(HttpMethod.GET))
            .andExpect(header("X-Operations-Service-Token", token))
            .andExpect { assertNull(it.headers.getFirst("Authorization")) }
            .andRespond(withSuccess(body, MediaType.APPLICATION_JSON))

        assertEquals(listOf(OperationsWork(id, owner, "작품", "작가", "fork", "external_derivative", true, "public", false)), client.works().items)
        server.verify()

        val (failing, failingServer) = content()
        failingServer.expect(requestTo("http://content.test/internal/v1/works")).andRespond(withStatus(HttpStatus.SERVICE_UNAVAILABLE))
        assertEquals(502, status { failing.works() })
    }

    @Test
    fun `fork integrity sends only the service token and parses the report`() {
        val (client, server) = content()
        val hash = "a".repeat(64)
        server.expect(requestTo("http://content.test/internal/v1/works/$id/fork-integrity")).andExpect(method(HttpMethod.GET))
            .andExpect(header("X-Operations-Service-Token", token))
            .andExpect { assertNull(it.headers.getFirst("Authorization")) }
            .andRespond(withSuccess("""{"basisEpisode":2,"forkHash":"$hash","sourceHash":"$hash","matches":true,"characterStateStatus":"unavailable"}""", MediaType.APPLICATION_JSON))

        val report = client.forkIntegrity(id)
        assertEquals(2, report.basisEpisode)
        assertTrue(report.matches)
        server.verify()
    }

    @Test
    fun `fork integrity keeps Content's own failure text for 400 404 and 409 while other Content calls keep only the status`() {
        val text = "원작의 고정 기준 기록을 확인할 수 없어요."
        for (upstream in listOf(HttpStatus.BAD_REQUEST, HttpStatus.NOT_FOUND, HttpStatus.CONFLICT)) {
            val (client, server) = content()
            for (path in listOf("$id/fork-integrity", "$id")) {
                server.expect(requestTo("http://content.test/internal/v1/works/$path"))
                    .andRespond(withStatus(upstream).contentType(MediaType.APPLICATION_JSON).body("""{"detail":"$text"}"""))
            }

            val rejected = assertThrows(UpstreamRejection::class.java) { client.forkIntegrity(id) }
            assertEquals(upstream.value(), rejected.statusCode.value(), upstream.toString())
            assertEquals(text, rejected.userMessage, upstream.toString())
            assertFalse(assertThrows(ResponseStatusException::class.java) { client.work(id) } is UpstreamRejection, upstream.toString())
            server.verify()
        }
    }

    @Test
    fun `fork integrity maps Content failures other than 400 404 and 409 to 502 without the text`() {
        for (upstream in listOf(HttpStatus.FORBIDDEN, HttpStatus.SERVICE_UNAVAILABLE)) {
            val (client, server) = content()
            server.expect(requestTo("http://content.test/internal/v1/works/$id/fork-integrity"))
                .andRespond(withStatus(upstream).contentType(MediaType.APPLICATION_JSON).body("""{"detail":"private text"}"""))

            val failure = assertThrows(ResponseStatusException::class.java) { client.forkIntegrity(id) }
            assertEquals(502, failure.statusCode.value(), upstream.toString())
            assertFalse(failure is UpstreamRejection, upstream.toString())
        }
    }

    @Test
    fun `Content comment calls send only the service token and parse non-UUID ids`() {
        val (client, server) = content()
        val row = """
            {"commentId":"ops-comment-1","workId":"ops-work-1","workTitle":"작품","episodeNumber":3,"authorId":"ops-comment-author",
            "authorName":"작가","body":"원문","likeCount":2,"hidden":false,"createdAt":"2026-11-10T01:02:03Z"}
        """.trimIndent()
        server.expect(requestTo("http://content.test/internal/v1/comments")).andExpect(method(HttpMethod.GET))
            .andExpect(header("X-Operations-Service-Token", token))
            .andExpect { assertNull(it.headers.getFirst("Authorization")) }
            .andRespond(withSuccess("""{"items":[$row]}""", MediaType.APPLICATION_JSON))
        server.expect(requestTo("http://content.test/internal/v1/comments/ops-comment-1/hidden")).andExpect(method(HttpMethod.PUT))
            .andExpect(header("X-Operations-Service-Token", token))
            .andExpect { assertNull(it.headers.getFirst("Authorization")) }
            .andRespond(withSuccess(row.replace("\"hidden\":false", "\"hidden\":true"), MediaType.APPLICATION_JSON))
        server.expect(requestTo("http://content.test/internal/v1/comments/ops-comment-1/hidden")).andExpect(method(HttpMethod.DELETE))
            .andRespond(withSuccess(row, MediaType.APPLICATION_JSON))

        val listed = client.listComments().items.single()
        assertEquals("ops-comment-author", listed.authorId)
        assertFalse(listed.hidden)
        assertTrue(client.hideComment("ops-comment-1").hidden)
        assertFalse(client.unhideComment("ops-comment-1").hidden)
        server.verify()
    }

    @Test
    fun `Content comment calls keep 404 and map other failures to 502`() {
        for ((upstream, expected) in listOf(HttpStatus.NOT_FOUND to 404, HttpStatus.SERVICE_UNAVAILABLE to 502)) {
            val (client, server) = content()
            server.expect(requestTo("http://content.test/internal/v1/comments")).andRespond(withStatus(upstream))
            server.expect(requestTo("http://content.test/internal/v1/comments/ops-comment-1/hidden")).andExpect(method(HttpMethod.PUT)).andRespond(withStatus(upstream))
            server.expect(requestTo("http://content.test/internal/v1/comments/ops-comment-1/hidden")).andExpect(method(HttpMethod.DELETE)).andRespond(withStatus(upstream))

            assertEquals(expected, status { client.listComments() }, upstream.toString())
            assertEquals(expected, status { client.hideComment("ops-comment-1") }, upstream.toString())
            assertEquals(expected, status { client.unhideComment("ops-comment-1") }, upstream.toString())
        }
    }
}
