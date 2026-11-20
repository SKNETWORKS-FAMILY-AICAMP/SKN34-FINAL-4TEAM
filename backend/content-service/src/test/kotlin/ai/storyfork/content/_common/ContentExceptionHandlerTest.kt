package ai.storyfork.content._common

import ai.storyfork.content._common.exception.ContentExceptionHandler
import ai.storyfork.content._common.exception.ContentFailure
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Test
import org.springframework.http.MediaType

class ContentExceptionHandlerTest {
    @Test
    fun `a content failure keeps its status and always answers with JSON so an event-stream request is not turned into a 500`() {
        val response = ContentExceptionHandler().failure(ContentFailure(422, "이 세계관의 설정 카드가 아니에요."))
        assertEquals(422, response.statusCode.value())
        assertEquals(MediaType.APPLICATION_JSON, response.headers.contentType)
        assertEquals("이 세계관의 설정 카드가 아니에요.", response.body!!.detail)
    }
}
