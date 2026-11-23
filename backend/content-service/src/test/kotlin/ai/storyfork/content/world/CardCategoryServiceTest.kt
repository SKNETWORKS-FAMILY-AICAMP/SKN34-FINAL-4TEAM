package ai.storyfork.content.world

import ai.storyfork.content._common.exception.ContentFailure
import ai.storyfork.content.world.service.CardCategoryService
import ai.storyfork.content.world.service.dto.*
import ai.storyfork.content.world.studio.entity.CardCategory
import ai.storyfork.content.world.studio.repository.CardCategoryRepository
import ai.storyfork.content.world.studio.repository.SettingCardDraftRepository
import org.junit.jupiter.api.Assertions.*
import org.junit.jupiter.api.Test
import org.mockito.ArgumentMatchers.any
import org.mockito.Mockito.*
import org.springframework.data.domain.Sort
import org.springframework.transaction.PlatformTransactionManager
import org.springframework.transaction.support.SimpleTransactionStatus

/** 세계관 카드 카테고리 관리 서비스를 DB 없이 검증한다. 장르(DEC-56)와 같은 규칙에 홈 노출 한도만 없다. */
class CardCategoryServiceTest {
    private val categories = mock(CardCategoryRepository::class.java)
    private val cardDrafts = mock(SettingCardDraftRepository::class.java)
    private val manager = mock(PlatformTransactionManager::class.java).also {
        `when`(it.getTransaction(any())).thenAnswer { SimpleTransactionStatus() }
    }
    private val service = CardCategoryService(categories, cardDrafts, manager)

    private fun row(n: Int, name: String = "카테고리$n", active: Boolean = true, icon: String? = null) =
        CardCategory("category-%02d".format(n), name, icon, active, n)
    /** 운영 쓰기가 잠그고 읽는 전체 카테고리와, 응답을 만드는 순서대로의 목록이다. */
    private fun table(vararg rows: CardCategory): List<CardCategory> {
        val all = rows.toList()
        `when`(categories.lockAll()).thenReturn(all)
        `when`(categories.findAll(any(Sort::class.java))).thenAnswer { all.sortedBy { it.position } }
        return all
    }
    private fun saved() = mockingDetails(categories).invocations.filter { it.method.name == "saveAndFlush" }.map { it.getArgument<CardCategory>(0) }
    private fun failure(block: () -> Unit) = assertThrows(ContentFailure::class.java, block)
    private fun fields(c: CardCategory) = listOf(c.code, c.name, c.icon, c.active, c.position)

    @Test fun `the public list is every category in order including hidden ones with the active flag`() {
        table(row(1, "추리 단서", icon = "🔎"), row(2, "숨김", active = false))
        assertEquals(listOf(PublicCardCategoryResponse("category-01", "추리 단서", "🔎", 1, true), PublicCardCategoryResponse("category-02", "숨김", null, 2, false)), service.publicList())
    }

    @Test fun `the operator list shows every category with card counts from one query`() {
        table(row(1, "추리 단서"), row(2, "숨김", active = false))
        `when`(cardDrafts.cardCounts()).thenReturn(listOf(arrayOf<Any>("category-01", 4L)))

        assertEquals(listOf(CardCategoryResponse("category-01", "추리 단서", null, true, 1, 4), CardCategoryResponse("category-02", "숨김", null, false, 2, 0)), service.list())
        verify(cardDrafts, times(1)).cardCounts()
    }

    // --- 추가 ---
    @Test fun `a new category goes to the end as an active category and its code follows the largest category number`() {
        table(CardCategory("character", "인물", null, true, 1), row(3, "셋"), row(5, "다섯"))

        val created = service.create(CardCategoryCreateRequest("  추리 단서 ", " 🔎 "))

        assertEquals(CardCategoryResponse("category-06", "추리 단서", "🔎", true, 6, 0), created)
        assertEquals(listOf(listOf("category-06", "추리 단서", "🔎", true, 6)), saved().map { fields(it) })
    }

    @Test fun `the first custom category is category-01 because the default codes are not numbered`() {
        table(CardCategory("character", "인물", null, true, 1), CardCategory("other", "기타", null, true, 2))
        assertEquals("category-01", service.create(CardCategoryCreateRequest("추리 단서")).code)
    }

    @Test fun `a duplicate name is 409 CARD_CATEGORY_NAME_TAKEN and nothing is saved`() {
        table(CardCategory("character", "인물", null, true, 1))
        val failure = failure { service.create(CardCategoryCreateRequest("인물")) }
        assertEquals(409 to "CARD_CATEGORY_NAME_TAKEN", failure.status to failure.code)
        assertTrue(saved().isEmpty())
    }

    @Test fun `a bad name or icon is 422 before any lookup`() {
        listOf(CardCategoryCreateRequest(null), CardCategoryCreateRequest("  "), CardCategoryCreateRequest("가".repeat(31)), CardCategoryCreateRequest("추리", "😀".repeat(9))).forEach {
            assertEquals(422, failure { service.create(it) }.status)
        }
        verifyNoInteractions(categories)
    }

    // --- 수정 ---
    @Test fun `an update changes only the sent fields and an empty icon clears it`() {
        val rows = table(row(1, "추리 단서", icon = "🔎"), row(2, "무대"))
        assertEquals(CardCategoryResponse("category-01", "단서", "🔎", true, 1, 0), service.update("category-01", CardCategoryUpdateRequest(name = " 단서 ")))
        service.update("category-01", CardCategoryUpdateRequest(icon = ""))
        assertNull(rows[0].icon)
        service.update("category-01", CardCategoryUpdateRequest(icon = "🌙"))
        assertEquals("🌙", rows[0].icon)
        service.update("category-02", CardCategoryUpdateRequest(active = false))
        assertEquals(listOf("category-02", "무대", null, false, 2), fields(rows[1]))
        assertEquals(listOf("category-01", "단서", "🌙", true, 1), fields(rows[0]))
    }

    @Test fun `a default category can be hidden and shown again like any other`() {
        val rows = table(CardCategory("ability", "능력", null, true, 1))
        service.update("ability", CardCategoryUpdateRequest(active = false))
        assertFalse(rows[0].active)
        service.update("ability", CardCategoryUpdateRequest(active = true))
        assertTrue(rows[0].active)
    }

    @Test fun `renaming to another category's name is 409 but keeping its own name is fine`() {
        val rows = table(row(1, "추리 단서"), row(2, "무대"))
        val failure = failure { service.update("category-01", CardCategoryUpdateRequest(name = "무대")) }
        assertEquals(409 to "CARD_CATEGORY_NAME_TAKEN", failure.status to failure.code)
        assertEquals("추리 단서", rows[0].name)
        service.update("category-01", CardCategoryUpdateRequest(name = " 추리 단서 "))
        assertEquals("추리 단서", rows[0].name)
    }

    @Test fun `an unknown code is 404 and a bad name or icon is 422 before any lookup`() {
        table(row(1))
        assertEquals(404, failure { service.update("category-99", CardCategoryUpdateRequest(active = false)) }.status)
        assertTrue(saved().isEmpty())
        clearInvocations(categories)
        listOf(CardCategoryUpdateRequest(name = ""), CardCategoryUpdateRequest(name = "가".repeat(31)), CardCategoryUpdateRequest(icon = "😀".repeat(9))).forEach {
            assertEquals(422, failure { service.update("category-01", it) }.status)
        }
        verifyNoInteractions(categories)
    }

    // --- 순서 ---
    @Test fun `an order rewrites every position from 1 and answers with the new order`() {
        val rows = table(row(1, "하나"), row(2, "둘", active = false), row(3, "셋"))
        val result = service.reorder(CardCategoryOrderRequest(listOf("category-03", "category-01", "category-02")))
        assertEquals(listOf(2, 3, 1), rows.map { it.position })
        assertEquals(listOf("category-03", "category-01", "category-02"), result.map { it.code })
        assertEquals(listOf(1, 2, 3), result.map { it.position })
    }

    @Test fun `an order that misses duplicates or invents a code is 422 and changes nothing`() {
        val rows = table(row(1), row(2), row(3))
        val before = rows.map { it.position }
        listOf(
            CardCategoryOrderRequest(null),
            CardCategoryOrderRequest(emptyList()),
            CardCategoryOrderRequest(listOf("category-01", "category-02")),
            CardCategoryOrderRequest(listOf("category-01", "category-02", "category-02")),
            CardCategoryOrderRequest(listOf("category-01", "category-02", "category-03", "category-03")),
            CardCategoryOrderRequest(listOf("category-01", "category-02", "category-99")),
        ).forEachIndexed { i, request -> assertEquals(422, failure { service.reorder(request) }.status, "case $i") }
        assertEquals(before, rows.map { it.position })
    }
}
