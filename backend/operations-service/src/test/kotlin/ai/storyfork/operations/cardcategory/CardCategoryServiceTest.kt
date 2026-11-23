package ai.storyfork.operations.cardcategory

import ai.storyfork.operations._common.client.ContentClient
import ai.storyfork.operations._common.client.UpstreamRejection
import ai.storyfork.operations.activity.service.AdminActivityService
import ai.storyfork.operations.cardcategory.service.CardCategoryService
import ai.storyfork.operations.cardcategory.service.dto.CardCategoryCreateRequest
import ai.storyfork.operations.cardcategory.service.dto.CardCategoryOrderRequest
import ai.storyfork.operations.cardcategory.service.dto.CardCategoryUpdateRequest
import ai.storyfork.operations.member.repository.AdminPermissionRepository
import ai.storyfork.operations.security.OperationsMember
import java.util.UUID
import org.junit.jupiter.api.Assertions.*
import org.junit.jupiter.api.Test
import org.mockito.Mockito.*
import org.springframework.http.HttpStatus
import org.springframework.web.server.ResponseStatusException
import tools.jackson.module.kotlin.jacksonMapperBuilder

/** Content 클라이언트·권한 저장소·활동 기록은 Mockito 대역이다. Spring 컨텍스트·HTTP·DB가 없다. */
class CardCategoryServiceTest {
    private val content = mock(ContentClient::class.java)
    private val permissions = mock(AdminPermissionRepository::class.java)
    private val activities = mock(AdminActivityService::class.java)
    private val service = CardCategoryService(content, permissions, activities)
    private val mapper = jacksonMapperBuilder().build()
    private val admin = OperationsMember(UUID.randomUUID(), true)
    private val operatorWithoutWorks = OperationsMember(UUID.randomUUID(), true)
    private val staleGrant = OperationsMember(UUID.randomUUID(), false)
    private val rows = mapper.readTree("""[{"code":"object","name":"물건"},{"code":"character","name":"인물"}]""")
    private val row = mapper.readTree("""{"code":"card-category-9","name":"도구","icon":"🔧","active":true,"position":9,"cardCount":0}""")

    private fun grantWorks(vararg members: OperationsMember) = members.forEach {
        `when`(permissions.existsByMemberIdAndPermission(it.memberId, "works")).thenReturn(true)
    }

    private fun status(call: () -> Unit) = assertThrows(ResponseStatusException::class.java) { call() }.statusCode

    @Test
    fun `list returns the Content list untouched and records nothing`() {
        grantWorks(admin)
        `when`(content.cardCategories()).thenReturn(rows)

        assertSame(rows, service.list(admin))
        verifyNoInteractions(activities)
    }

    @Test
    fun `create returns the new category untouched and records its code and name after Content succeeded`() {
        grantWorks(admin)
        val request = CardCategoryCreateRequest("도구", "🔧")
        `when`(content.createCardCategory(request)).thenReturn(row)

        assertSame(row, service.create(admin, request))

        val order = inOrder(content, activities)
        order.verify(content).createCardCategory(request)
        order.verify(activities).record(admin, "card_category.create", "card_category", "card-category-9", "도구")
        verifyNoMoreInteractions(activities)
    }

    @Test
    fun `update records the path code with the name Content answered`() {
        grantWorks(admin)
        val request = CardCategoryUpdateRequest(active = false)
        `when`(content.updateCardCategory("card-category-9", request)).thenReturn(row)

        assertSame(row, service.update(admin, "card-category-9", request))

        val order = inOrder(content, activities)
        order.verify(content).updateCardCategory("card-category-9", request)
        order.verify(activities).record(admin, "card_category.update", "card_category", "card-category-9", "도구")
        verifyNoMoreInteractions(activities)
    }

    @Test
    fun `reorder records the new order of codes and returns Content's answer untouched`() {
        grantWorks(admin)
        val request = CardCategoryOrderRequest(listOf("object", "character"))
        `when`(content.reorderCardCategories(request.codes)).thenReturn(rows)

        assertSame(rows, service.reorder(admin, request))

        val order = inOrder(content, activities)
        order.verify(content).reorderCardCategories(request.codes)
        order.verify(activities).record(admin, "card_category.reorder", "card_category", "order", "object,character")
        verifyNoMoreInteractions(activities)
    }

    @Test
    fun `an operator without works permission or a stale grant without operator is denied before Content`() {
        grantWorks(staleGrant)
        for (member in listOf(operatorWithoutWorks, staleGrant)) {
            assertEquals(HttpStatus.FORBIDDEN, status { service.list(member) })
            assertEquals(HttpStatus.FORBIDDEN, status { service.create(member, CardCategoryCreateRequest("가")) })
            assertEquals(HttpStatus.FORBIDDEN, status { service.update(member, "object", CardCategoryUpdateRequest(active = true)) })
            assertEquals(HttpStatus.FORBIDDEN, status { service.reorder(member, CardCategoryOrderRequest(listOf("object"))) })
        }
        verifyNoInteractions(content, activities)
    }

    @Test
    fun `a Content failure or rejection reaches the caller untouched and leaves no activity`() {
        grantWorks(admin)
        val rejection = UpstreamRejection(HttpStatus.CONFLICT, "같은 이름의 카테고리가 이미 있어요.", IllegalStateException("cause"), "CARD_CATEGORY_NAME_TAKEN")
        `when`(content.createCardCategory(CardCategoryCreateRequest("인물"))).thenThrow(rejection)
        `when`(content.updateCardCategory("nope", CardCategoryUpdateRequest(active = true))).thenThrow(ResponseStatusException(HttpStatus.NOT_FOUND))
        `when`(content.reorderCardCategories(listOf("object"))).thenThrow(ResponseStatusException(HttpStatus.BAD_GATEWAY))
        `when`(content.cardCategories()).thenThrow(ResponseStatusException(HttpStatus.BAD_GATEWAY))

        assertSame(rejection, assertThrows(UpstreamRejection::class.java) { service.create(admin, CardCategoryCreateRequest("인물")) })
        assertEquals(HttpStatus.NOT_FOUND, status { service.update(admin, "nope", CardCategoryUpdateRequest(active = true)) })
        assertEquals(HttpStatus.BAD_GATEWAY, status { service.reorder(admin, CardCategoryOrderRequest(listOf("object"))) })
        assertEquals(HttpStatus.BAD_GATEWAY, status { service.list(admin) })
        verifyNoInteractions(activities)
    }
}
