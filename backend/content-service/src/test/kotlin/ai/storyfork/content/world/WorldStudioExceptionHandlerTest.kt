package ai.storyfork.content.world

import ai.storyfork.content.world.controller.WorldStudioExceptionHandler
import ai.storyfork.content.world.domain.WorldRestoreBlocked
import ai.storyfork.content.world.domain.WorldStudioFailure
import ai.storyfork.content.world.domain.WorldStudioFailure.Reason
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertFalse
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.Test
import org.springframework.web.server.ResponseStatusException

class WorldStudioExceptionHandlerTest {
    private val handler=WorldStudioExceptionHandler()

    @Test fun `every failure reason keeps its HTTP status and public body`() {
        val expected=mapOf(
            Reason.MIGRATION to 409,Reason.REJECTED to 409,Reason.MISMATCH to 409,Reason.HISTORY to 409,Reason.LINKED to 409,
            Reason.INCOMPLETE to 503,Reason.UNAVAILABLE to 503
        )
        assertEquals(expected.keys,Reason.values().toSet())
        expected.forEach { (reason,status) ->
            val response=handler.failure(WorldStudioFailure(reason))
            assertEquals(status,response.statusCode.value())
            assertEquals(reason.code,response.body?.code)
            assertEquals(reason.detail,response.body?.detail)
        }
    }

    @Test fun `deleting a linked world is 409 WORLD_LINKED and says how to unlink`() {
        val response=handler.failure(WorldStudioFailure.linked())
        assertEquals(409,response.statusCode.value());assertEquals("WORLD_LINKED",response.body?.code)
        assertTrue(response.body!!.detail.contains("작품 관리에서 연결을 해제한 뒤 삭제하세요"))
    }

    @Test fun `a blocked restore is 409 WORLD_RESTORE_BLOCKED naming the cards whose relations must be ended first`() {
        val response=handler.restoreBlocked(WorldRestoreBlocked(listOf("다온","이든","")))
        assertEquals(409,response.statusCode.value());assertEquals("WORLD_RESTORE_BLOCKED",response.body?.code)
        val detail=response.body!!.detail
        assertTrue(detail.contains("다온, 이든, 이름 없는 설정"));assertTrue(detail.contains("관계를 먼저"))
    }

    @Test fun `a long list of blocked cards is cut to five names and a count`() {
        val detail=handler.restoreBlocked(WorldRestoreBlocked((1..8).map { "카드$it" })).body!!.detail
        assertTrue(detail.contains("카드1, 카드2, 카드3, 카드4, 카드5 외 3개"));assertFalse(detail.contains("카드6"))
    }

    @Test fun `failure is not a Spring web exception`() {
        assertFalse(ResponseStatusException::class.java.isAssignableFrom(WorldStudioFailure::class.java))
    }
}
