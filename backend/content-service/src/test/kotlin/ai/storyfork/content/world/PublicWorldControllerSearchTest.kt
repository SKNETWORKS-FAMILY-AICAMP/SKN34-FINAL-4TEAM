package ai.storyfork.content.world

import ai.storyfork.content.world.controller.PublicWorldController
import ai.storyfork.content.world.service.PublicWorldService
import ai.storyfork.content.world.service.dto.PublicWorldCardSearchResponse
import ai.storyfork.content.world.service.dto.PublicWorldPageResponse
import org.junit.jupiter.api.Assertions.*
import org.junit.jupiter.api.Test
import org.mockito.Mockito.*
import org.springframework.core.annotation.AnnotatedElementUtils
import org.springframework.http.server.PathContainer
import org.springframework.web.bind.annotation.GetMapping
import org.springframework.web.bind.annotation.RequestMapping
import org.springframework.web.util.pattern.PathPattern
import org.springframework.web.util.pattern.PathPatternParser

/** 공개 세계관 검색 컨트롤러의 바인딩(#505): 쿼리는 문자열 그대로 서비스로 가고, 리터럴 cards 경로는 세계관 ID 경로보다 먼저 맞는다. 서비스는 대역이다. */
class PublicWorldControllerSearchTest {
    private val service = mock(PublicWorldService::class.java)
    private val controller = PublicWorldController(service)

    @Test fun `list and card search hand q, genre and paging to the service as plain strings`() {
        val page = PublicWorldPageResponse(emptyList(), 0, 24, 0)
        `when`(service.list("fantasy", "달빛", "1", "10")).thenReturn(page)
        assertSame(page, controller.list("fantasy", "달빛", "1", "10"))
        verify(service).list("fantasy", "달빛", "1", "10")

        val cards = PublicWorldCardSearchResponse(emptyList(), 0, 24, 0)
        `when`(service.cards("인물", "2", "5")).thenReturn(cards)
        assertSame(cards, controller.cards("인물", "2", "5"))
        verify(service).cards("인물", "2", "5")
    }

    @Test fun `the literal cards route is more specific than the world id route`() {
        val base = AnnotatedElementUtils.findMergedAnnotation(PublicWorldController::class.java, RequestMapping::class.java)!!.value.single()
        fun route(method: String): PathPattern {
            val mapping = AnnotatedElementUtils.findMergedAnnotation(PublicWorldController::class.java.methods.single { it.name == method }, GetMapping::class.java)!!
            return PathPatternParser().parse(base + mapping.value.single())
        }
        val cards = route("cards")
        val byId = route("read")
        assertTrue(PathPattern.SPECIFICITY_COMPARATOR.compare(cards, byId) < 0)
        assertTrue(cards.matches(PathContainer.parsePath("/api/v1/public/world-studios/cards")))
    }
}
