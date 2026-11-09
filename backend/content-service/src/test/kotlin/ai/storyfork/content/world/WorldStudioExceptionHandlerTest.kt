package ai.storyfork.content.world

import ai.storyfork.content.world.controller.WorldStudioExceptionHandler
import ai.storyfork.content.world.domain.WorldStudioFailure
import ai.storyfork.content.world.domain.WorldStudioFailure.Reason
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertFalse
import org.junit.jupiter.api.Test
import org.springframework.web.server.ResponseStatusException

class WorldStudioExceptionHandlerTest {
    private val handler=WorldStudioExceptionHandler()

    @Test fun `every failure reason keeps its HTTP status and public body`() {
        val expected=mapOf(
            Reason.MIGRATION to 409,Reason.REJECTED to 409,Reason.MISMATCH to 409,Reason.HISTORY to 409,
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

    @Test fun `failure is not a Spring web exception`() {
        assertFalse(ResponseStatusException::class.java.isAssignableFrom(WorldStudioFailure::class.java))
    }
}
