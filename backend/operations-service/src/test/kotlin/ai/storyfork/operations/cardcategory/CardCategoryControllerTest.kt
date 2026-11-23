package ai.storyfork.operations.cardcategory

import ai.storyfork.operations.cardcategory.controller.CardCategoryController
import ai.storyfork.operations.cardcategory.service.CardCategoryService
import ai.storyfork.operations.cardcategory.service.dto.CardCategoryCreateRequest
import ai.storyfork.operations.cardcategory.service.dto.CardCategoryOrderRequest
import ai.storyfork.operations.cardcategory.service.dto.CardCategoryUpdateRequest
import ai.storyfork.operations.security.OperationsMember
import java.util.UUID
import org.junit.jupiter.api.Assertions.*
import org.junit.jupiter.api.Test
import org.mockito.Mockito.*
import tools.jackson.module.kotlin.jacksonMapperBuilder

/** Spring context나 HTTP 서버 없이 인증 회원·경로 값·본문이 서비스에 그대로 가고 서비스 결과가 그대로 나오는지 확인한다. */
class CardCategoryControllerTest {
    private val service = mock(CardCategoryService::class.java)
    private val controller = CardCategoryController(service)
    private val member = OperationsMember(UUID.randomUUID(), true)
    private val mapper = jacksonMapperBuilder().build()
    private val rows = mapper.readTree("""[{"code":"object","name":"물건"}]""")
    private val row = mapper.readTree("""{"code":"card-category-9","name":"도구"}""")

    @Test
    fun `every route passes the authenticated member, the path code and the body on and returns the service JSON as is`() {
        val create = CardCategoryCreateRequest("도구", "🔧")
        val update = CardCategoryUpdateRequest(active = false)
        val order = CardCategoryOrderRequest(listOf("object", "character"))
        `when`(service.list(member)).thenReturn(rows)
        `when`(service.create(member, create)).thenReturn(row)
        `when`(service.update(member, "card-category-9", update)).thenReturn(row)
        `when`(service.reorder(member, order)).thenReturn(rows)

        assertSame(rows, controller.list(member))
        assertSame(row, controller.create(member, create))
        assertSame(row, controller.update(member, "card-category-9", update))
        assertSame(rows, controller.reorder(member, order))
    }
}
