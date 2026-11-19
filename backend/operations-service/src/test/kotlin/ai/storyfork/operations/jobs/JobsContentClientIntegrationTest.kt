package ai.storyfork.operations.jobs

import ai.storyfork.operations._common.client.ContentClient
import ai.storyfork.operations._common.client.operationsRestClient
import ai.storyfork.operations.jobs.service.dto.ContentPreprocessingJob
import org.junit.jupiter.api.Assertions.*
import org.junit.jupiter.api.Test
import org.springframework.http.HttpMethod
import org.springframework.http.HttpStatus
import org.springframework.http.MediaType
import org.springframework.test.web.client.MockRestServiceServer
import org.springframework.test.web.client.match.MockRestRequestMatchers.*
import org.springframework.test.web.client.response.MockRestResponseCreators.*
import org.springframework.web.server.ResponseStatusException
import tools.jackson.databind.DeserializationFeature
import tools.jackson.module.kotlin.jacksonMapperBuilder

/** In-memory MockRestServiceServer only: no Spring context, socket or database. */
class JobsContentClientIntegrationTest {
    private val token = "ops-test-token-0123456789abcdef0123"
    // The mapper Spring Boot builds ignores unknown properties, so the Content client must too.
    private val mapper = jacksonMapperBuilder().disable(DeserializationFeature.FAIL_ON_UNKNOWN_PROPERTIES).build()

    private fun content(): Pair<ContentClient, MockRestServiceServer> {
        val builder = operationsRestClient("http://content.test", token, mapper)
        val server = MockRestServiceServer.bindTo(builder).build()
        return ContentClient(builder.build()) to server
    }

    private fun status(call: () -> Unit): Int = assertThrows(ResponseStatusException::class.java) { call() }.statusCode.value()

    private val jobJson = """{"id":"job-1","workId":"work-1","status":"loading","done":3,"total":10,"failedEpisodes":[4],
        "startedAt":"2026-03-10T01:02:03Z","finishedAt":null,"error":null,"memberId":"not used"}"""

    @Test
    fun `the job list is read from the first page of the given size with only the service token and parsed`() {
        val (client, server) = content()
        server.expect(requestTo("http://content.test/internal/v1/preprocessing-jobs?page=0&size=100")).andExpect(method(HttpMethod.GET))
            .andExpect(header("X-Operations-Service-Token", token))
            .andExpect { assertNull(it.headers.getFirst("Authorization")) }
            .andRespond(withSuccess("""{"items":[$jobJson],"total":7}""", MediaType.APPLICATION_JSON))

        val list = client.preprocessingJobs(100)

        assertEquals(ContentPreprocessingJob("job-1", "work-1", "loading", 3, 10, listOf(4), java.time.Instant.parse("2026-03-10T01:02:03Z"), null), list.items.single())
        server.verify()
    }

    @Test
    fun `a retry posts to the job and parses the updated job`() {
        val (client, server) = content()
        server.expect(requestTo("http://content.test/internal/v1/preprocessing-jobs/job-1/retry")).andExpect(method(HttpMethod.POST))
            .andExpect(header("X-Operations-Service-Token", token))
            .andRespond(withStatus(HttpStatus.ACCEPTED).contentType(MediaType.APPLICATION_JSON).body(jobJson))

        assertEquals("loading", client.retryPreprocessingJob("job-1").status)
        server.verify()
    }

    @Test
    fun `Content 400 404 409 keep their status and every other failure or an empty body is 502`() {
        for ((upstream, expected) in listOf(HttpStatus.BAD_REQUEST to 400, HttpStatus.NOT_FOUND to 404, HttpStatus.CONFLICT to 409,
            HttpStatus.UNAUTHORIZED to 502, HttpStatus.SERVICE_UNAVAILABLE to 502)) {
            val (client, server) = content()
            server.expect(requestTo("http://content.test/internal/v1/preprocessing-jobs/job-1/retry")).andRespond(withStatus(upstream))
            assertEquals(expected, status { client.retryPreprocessingJob("job-1") }, upstream.toString())
            val (listClient, listServer) = content()
            listServer.expect(requestTo("http://content.test/internal/v1/preprocessing-jobs?page=0&size=100")).andRespond(withStatus(upstream))
            assertEquals(expected, status { listClient.preprocessingJobs(100) }, upstream.toString())
        }
        val (client, server) = content()
        server.expect(requestTo("http://content.test/internal/v1/preprocessing-jobs?page=0&size=100")).andRespond(withSuccess("not-json", MediaType.APPLICATION_JSON))
        assertEquals(502, status { client.preprocessingJobs(100) })
    }
}
