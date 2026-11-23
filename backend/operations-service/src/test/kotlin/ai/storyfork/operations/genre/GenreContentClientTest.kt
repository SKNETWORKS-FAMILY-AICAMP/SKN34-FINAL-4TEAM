package ai.storyfork.operations.genre

import ai.storyfork.operations._common.RecordingRequestFactory
import ai.storyfork.operations._common.Reply
import ai.storyfork.operations._common.client.ContentClient
import ai.storyfork.operations._common.client.UpstreamRejection
import ai.storyfork.operations._common.client.operationsRestClient
import ai.storyfork.operations.genre.service.dto.GenreCreateRequest
import ai.storyfork.operations.genre.service.dto.GenreUpdateRequest
import java.net.ConnectException
import org.junit.jupiter.api.Assertions.*
import org.junit.jupiter.api.Test
import org.springframework.http.HttpMethod
import org.springframework.web.server.ResponseStatusException
import tools.jackson.module.kotlin.jacksonMapperBuilder

/** 메모리 요청 팩토리로 Content 장르 내부 호출의 메서드·경로·헤더·본문과 오류 변환을 확인한다. 소켓·서버·Spring 컨텍스트가 없다. */
class GenreContentClientTest {
    private val mapper = jacksonMapperBuilder().build()

    private fun client(factory: RecordingRequestFactory) =
        ContentClient(operationsRestClient("http://content.test", "ops-token-1", mapper).requestFactory(factory).build())

    private fun status(call: () -> Unit) = assertThrows(ResponseStatusException::class.java) { call() }.statusCode.value()

    /** 네 호출을 한 번씩. */
    private fun allCalls(client: ContentClient): List<() -> Unit> = listOf(
        { client.genres() },
        { client.createGenre(GenreCreateRequest("가")) },
        { client.updateGenre("genre-01", GenreUpdateRequest(active = true)) },
        { client.reorderGenres(listOf("genre-01")) },
    )

    @Test
    fun `the genre list is read with only the service token and returned as Content sent it`() {
        val rows = """[{"code":"genre-01","name":"판타지","emoji":"✨","active":true,"featured":true,"position":1,"workCount":3,"worldCount":1,"future":"kept"}]"""
        val factory = RecordingRequestFactory { Reply(200, rows) }

        val list = client(factory).genres()

        val call = factory.calls.single()
        assertEquals(HttpMethod.GET, call.method)
        assertEquals("/internal/v1/genres", call.uri.path)
        assertEquals("ops-token-1", call.headers.getFirst("X-Operations-Service-Token"))
        assertNull(call.headers.getFirst("Authorization"))
        assertEquals(mapper.readTree(rows), list)
    }

    @Test
    fun `a new genre is posted with its name and, only when there is one, its emoji`() {
        val factory = RecordingRequestFactory { Reply(201, """{"code":"genre-31","name":"사이버펑크","emoji":"🤖"}""") }

        val created = client(factory).createGenre(GenreCreateRequest("사이버펑크", "🤖"))
        client(factory).createGenre(GenreCreateRequest("스팀펑크"))

        assertEquals("genre-31", created.path("code").asString())
        assertEquals(listOf(HttpMethod.POST, HttpMethod.POST), factory.calls.map { it.method })
        assertEquals(listOf("/internal/v1/genres", "/internal/v1/genres"), factory.calls.map { it.uri.path })
        assertEquals("ops-token-1", factory.calls[0].headers.getFirst("X-Operations-Service-Token"))
        assertEquals("application/json", factory.calls[0].headers.contentType.toString())
        assertEquals(mapper.readTree("""{"name":"사이버펑크","emoji":"🤖"}"""), mapper.readTree(factory.calls[0].body))
        assertEquals(mapper.readTree("""{"name":"스팀펑크"}"""), mapper.readTree(factory.calls[1].body))
    }

    @Test
    fun `a genre change is patched with only the fields that were sent, keeping false and an empty icon`() {
        val factory = RecordingRequestFactory { Reply(200, """{"code":"genre-05","name":"무협"}""") }

        client(factory).updateGenre("genre-05", GenreUpdateRequest(active = false))
        client(factory).updateGenre("genre-05", GenreUpdateRequest(name = "신무협", emoji = "", featured = true))

        assertEquals(listOf(HttpMethod.PATCH, HttpMethod.PATCH), factory.calls.map { it.method })
        assertEquals(listOf("/internal/v1/genres/genre-05", "/internal/v1/genres/genre-05"), factory.calls.map { it.uri.path })
        assertEquals("ops-token-1", factory.calls[0].headers.getFirst("X-Operations-Service-Token"))
        // false and "" are values (hide the genre, clear the icon): only the fields that are null are left out.
        assertEquals(mapper.readTree("""{"active":false}"""), mapper.readTree(factory.calls[0].body))
        assertEquals(mapper.readTree("""{"name":"신무협","emoji":"","featured":true}"""), mapper.readTree(factory.calls[1].body))
    }

    @Test
    fun `the new order is put as the code list and Content's answer is returned as is`() {
        val answer = """[{"code":"genre-02"},{"code":"genre-01"}]"""
        val factory = RecordingRequestFactory { Reply(200, answer) }

        assertEquals(mapper.readTree(answer), client(factory).reorderGenres(listOf("genre-02", "genre-01")))

        val call = factory.calls.single()
        assertEquals(HttpMethod.PUT, call.method)
        assertEquals("/internal/v1/genres/order", call.uri.path)
        assertEquals("ops-token-1", call.headers.getFirst("X-Operations-Service-Token"))
        assertEquals(mapper.readTree("""{"codes":["genre-02","genre-01"]}"""), mapper.readTree(call.body))
    }

    @Test
    fun `400 404 409 and 422 keep their status and every other failure or a lost connection is 502`() {
        for ((upstream, expected) in listOf(400 to 400, 404 to 404, 409 to 409, 422 to 422, 401 to 502, 403 to 502, 500 to 502, 503 to 502)) {
            val client = client(RecordingRequestFactory { Reply(upstream, """{"detail":"x"}""") })
            for (call in allCalls(client)) assertEquals(expected, status(call), upstream.toString())
        }
        val lost = client(RecordingRequestFactory { throw ConnectException("refused") })
        for (call in allCalls(lost)) assertEquals(502, status(call))
    }

    @Test
    fun `an empty answer is a 502 for every call, never a success`() {
        val client = client(RecordingRequestFactory { Reply(200, "") })

        for (call in allCalls(client)) assertEquals(502, status(call))
    }

    @Test
    fun `a Content rejection keeps its own message and code`() {
        val detail = "홈에는 장르를 최대 6개까지 보여 줄 수 있어요."
        val limited = client(RecordingRequestFactory { Reply(409, """{"detail":"$detail","code":"GENRE_FEATURED_LIMIT"}""") })

        val rejected = assertThrows(UpstreamRejection::class.java) { limited.updateGenre("genre-05", GenreUpdateRequest(featured = true)) }

        assertEquals(409, rejected.statusCode.value())
        assertEquals(detail, rejected.userMessage)
        assertEquals("GENRE_FEATURED_LIMIT", rejected.code)
    }
}
