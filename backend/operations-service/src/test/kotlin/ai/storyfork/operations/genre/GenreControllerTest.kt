package ai.storyfork.operations.genre

import ai.storyfork.operations.genre.controller.GenreController
import ai.storyfork.operations.genre.service.GenreService
import ai.storyfork.operations.genre.service.dto.GenreCreateRequest
import ai.storyfork.operations.genre.service.dto.GenreOrderRequest
import ai.storyfork.operations.genre.service.dto.GenreUpdateRequest
import ai.storyfork.operations.security.OperationsMember
import java.util.UUID
import org.junit.jupiter.api.Assertions.*
import org.junit.jupiter.api.Test
import org.mockito.Mockito.*
import tools.jackson.module.kotlin.jacksonMapperBuilder

/** Spring context나 HTTP 서버 없이 인증 회원·경로 값·본문이 서비스에 그대로 가고 서비스 결과가 그대로 나오는지 확인한다. */
class GenreControllerTest {
    private val service = mock(GenreService::class.java)
    private val controller = GenreController(service)
    private val member = OperationsMember(UUID.randomUUID(), true)
    private val mapper = jacksonMapperBuilder().build()
    private val rows = mapper.readTree("""[{"code":"genre-01","name":"판타지"}]""")
    private val row = mapper.readTree("""{"code":"genre-31","name":"사이버펑크"}""")

    @Test
    fun `every route passes the authenticated member, the path code and the body on and returns the service JSON as is`() {
        val create = GenreCreateRequest("사이버펑크", "🤖")
        val update = GenreUpdateRequest(featured = true)
        val order = GenreOrderRequest(listOf("genre-02", "genre-01"))
        `when`(service.list(member)).thenReturn(rows)
        `when`(service.create(member, create)).thenReturn(row)
        `when`(service.update(member, "genre-31", update)).thenReturn(row)
        `when`(service.reorder(member, order)).thenReturn(rows)

        assertSame(rows, controller.list(member))
        assertSame(row, controller.create(member, create))
        assertSame(row, controller.update(member, "genre-31", update))
        assertSame(rows, controller.reorder(member, order))
    }
}
