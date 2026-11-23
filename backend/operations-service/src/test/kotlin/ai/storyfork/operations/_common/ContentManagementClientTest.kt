package ai.storyfork.operations._common

import ai.storyfork.operations._common.client.ContentClient
import ai.storyfork.operations._common.client.UpstreamRejection
import ai.storyfork.operations._common.client.operationsRestClient
import ai.storyfork.operations.cardcategory.service.dto.CardCategoryCreateRequest
import ai.storyfork.operations.cardcategory.service.dto.CardCategoryUpdateRequest
import java.net.ConnectException
import java.util.UUID
import org.junit.jupiter.api.Assertions.*
import org.junit.jupiter.api.Test
import org.springframework.http.HttpMethod
import org.springframework.web.server.ResponseStatusException
import tools.jackson.module.kotlin.jacksonMapperBuilder

/** 메모리 요청 팩토리로 Content 회차·세계관·카드 카테고리 내부 호출의 메서드·경로·헤더·본문과 오류 변환을 확인한다. 소켓·서버·Spring 컨텍스트가 없다. */
class ContentManagementClientTest {
    private val mapper = jacksonMapperBuilder().build()
    private val workId = UUID.fromString("0b6f1c52-3c1c-4a5e-8f64-6d1b3f8b7a11")
    private val worldId = UUID.fromString("7d0f9d0e-5c0e-4c88-9d4e-2b8f2f7a9c33")

    private fun client(factory: RecordingRequestFactory) =
        ContentClient(operationsRestClient("http://content.test", "ops-token-1", mapper).requestFactory(factory).build())

    private fun status(call: () -> Unit) = assertThrows(ResponseStatusException::class.java) { call() }.statusCode.value()

    /** 열 호출을 한 번씩. */
    private fun allCalls(client: ContentClient): List<() -> Unit> = listOf(
        { client.episodes(workId) },
        { client.restrictEpisode(workId, 2) },
        { client.unrestrictEpisode(workId, 2) },
        { client.worldStudios() },
        { client.restrictWorld(worldId) },
        { client.unrestrictWorld(worldId) },
        { client.cardCategories() },
        { client.createCardCategory(CardCategoryCreateRequest("도구")) },
        { client.updateCardCategory("object", CardCategoryUpdateRequest(active = false)) },
        { client.reorderCardCategories(listOf("object")) },
    )

    /** 서비스 토큰만 보내고 회원 Bearer는 보내지 않는다. */
    private fun assertServiceTokenOnly(call: RecordedCall) {
        assertEquals("ops-token-1", call.headers.getFirst("X-Operations-Service-Token"))
        assertNull(call.headers.getFirst("Authorization"))
    }

    @Test
    fun `the episode list is read with only the service token and returned as Content sent it`() {
        val rows = """[{"number":1,"title":"1화","publicationStatus":"published","restricted":false,"inherited":false,"future":"kept"}]"""
        val factory = RecordingRequestFactory { Reply(200, rows) }

        val list = client(factory).episodes(workId)

        val call = factory.calls.single()
        assertEquals(HttpMethod.GET, call.method)
        assertEquals("/internal/v1/works/${workId}/episodes", call.uri.path)
        assertServiceTokenOnly(call)
        assertEquals(mapper.readTree(rows), list)
    }

    @Test
    fun `an episode is restricted with PUT and released with DELETE on its own restriction path`() {
        val element = """{"number":2,"title":"2화","publicationStatus":"published","restricted":true,"inherited":false}"""
        val factory = RecordingRequestFactory { Reply(200, element) }

        val restricted = client(factory).restrictEpisode(workId, 2)
        val released = client(factory).unrestrictEpisode(workId, 2)

        assertEquals(listOf(HttpMethod.PUT, HttpMethod.DELETE), factory.calls.map { it.method })
        assertEquals(listOf("/internal/v1/works/${workId}/episodes/2/restriction"), factory.calls.map { it.uri.path }.distinct())
        factory.calls.forEach { assertServiceTokenOnly(it) }
        assertEquals(mapper.readTree(element), restricted)
        assertEquals(mapper.readTree(element), released)
    }

    @Test
    fun `the world list is read with only the service token and returned as Content sent it`() {
        val rows = """[{"worldId":"${worldId}","ownerId":"5f0c2c7e-8a51-4d6b-9a39-1f4f2b6d0a02","name":"별빛 세계","visibility":"public","published":true,"restricted":false,"genre":null,"createdAt":"2026-11-20T00:00:00Z"}]"""
        val factory = RecordingRequestFactory { Reply(200, rows) }

        val list = client(factory).worldStudios()

        val call = factory.calls.single()
        assertEquals(HttpMethod.GET, call.method)
        assertEquals("/internal/v1/world-studios", call.uri.path)
        assertServiceTokenOnly(call)
        assertEquals(mapper.readTree(rows), list)
    }

    @Test
    fun `a world is restricted with PUT and released with DELETE on its own restriction path`() {
        val element = """{"worldId":"${worldId}","name":"별빛 세계","restricted":true}"""
        val factory = RecordingRequestFactory { Reply(200, element) }

        val restricted = client(factory).restrictWorld(worldId)
        val released = client(factory).unrestrictWorld(worldId)

        assertEquals(listOf(HttpMethod.PUT, HttpMethod.DELETE), factory.calls.map { it.method })
        assertEquals(listOf("/internal/v1/world-studios/${worldId}/restriction"), factory.calls.map { it.uri.path }.distinct())
        factory.calls.forEach { assertServiceTokenOnly(it) }
        assertEquals(mapper.readTree(element), restricted)
        assertEquals(mapper.readTree(element), released)
    }

    @Test
    fun `the card category list is read with only the service token and returned as Content sent it`() {
        val rows = """[{"code":"character","name":"인물","icon":"🧑","active":true,"position":1,"cardCount":4,"future":"kept"}]"""
        val factory = RecordingRequestFactory { Reply(200, rows) }

        val list = client(factory).cardCategories()

        val call = factory.calls.single()
        assertEquals(HttpMethod.GET, call.method)
        assertEquals("/internal/v1/card-categories", call.uri.path)
        assertServiceTokenOnly(call)
        assertEquals(mapper.readTree(rows), list)
    }

    @Test
    fun `a new card category is posted with its name and, only when there is one, its icon`() {
        val factory = RecordingRequestFactory { Reply(201, """{"code":"card-category-9","name":"도구","icon":"🔧"}""") }

        val created = client(factory).createCardCategory(CardCategoryCreateRequest("도구", "🔧"))
        client(factory).createCardCategory(CardCategoryCreateRequest("탈것"))

        assertEquals("card-category-9", created.path("code").asString())
        assertEquals(listOf(HttpMethod.POST, HttpMethod.POST), factory.calls.map { it.method })
        assertEquals(listOf("/internal/v1/card-categories"), factory.calls.map { it.uri.path }.distinct())
        assertServiceTokenOnly(factory.calls[0])
        assertEquals("application/json", factory.calls[0].headers.contentType.toString())
        assertEquals(mapper.readTree("""{"name":"도구","icon":"🔧"}"""), mapper.readTree(factory.calls[0].body))
        assertEquals(mapper.readTree("""{"name":"탈것"}"""), mapper.readTree(factory.calls[1].body))
    }

    @Test
    fun `a card category change is patched with only the fields that were sent, keeping false and an empty icon`() {
        val factory = RecordingRequestFactory { Reply(200, """{"code":"object","name":"물건"}""") }

        client(factory).updateCardCategory("object", CardCategoryUpdateRequest(active = false))
        client(factory).updateCardCategory("object", CardCategoryUpdateRequest(name = "소지품", icon = ""))

        assertEquals(listOf(HttpMethod.PATCH, HttpMethod.PATCH), factory.calls.map { it.method })
        assertEquals(listOf("/internal/v1/card-categories/object"), factory.calls.map { it.uri.path }.distinct())
        assertServiceTokenOnly(factory.calls[0])
        // false and "" are values (hide the category, clear the icon): only the fields that are null are left out.
        assertEquals(mapper.readTree("""{"active":false}"""), mapper.readTree(factory.calls[0].body))
        assertEquals(mapper.readTree("""{"name":"소지품","icon":""}"""), mapper.readTree(factory.calls[1].body))
    }

    @Test
    fun `the new card category order is put as the code list and Content's answer is returned as is`() {
        val answer = """[{"code":"object"},{"code":"character"}]"""
        val factory = RecordingRequestFactory { Reply(200, answer) }

        assertEquals(mapper.readTree(answer), client(factory).reorderCardCategories(listOf("object", "character")))

        val call = factory.calls.single()
        assertEquals(HttpMethod.PUT, call.method)
        assertEquals("/internal/v1/card-categories/order", call.uri.path)
        assertServiceTokenOnly(call)
        assertEquals(mapper.readTree("""{"codes":["object","character"]}"""), mapper.readTree(call.body))
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
    fun `a Content rejection keeps its own message and code on every call`() {
        val detail = "원작 회차를 제한해야 해요."
        val client = client(RecordingRequestFactory { Reply(409, """{"detail":"${detail}","code":"EPISODE_INHERITED"}""") })

        for (call in allCalls(client)) {
            val rejected = assertThrows(UpstreamRejection::class.java) { call() }
            assertEquals(409, rejected.statusCode.value())
            assertEquals(detail, rejected.userMessage)
            assertEquals("EPISODE_INHERITED", rejected.code)
        }
    }
}
