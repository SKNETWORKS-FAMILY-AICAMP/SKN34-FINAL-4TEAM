package ai.storyfork.content._common.exception

import ai.storyfork.content._common.service.dto.ContentErrorResponse
import ai.storyfork.content.auth.client.exception.CoreAuthException
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Test

class ContentExceptionHandlerTest {
    @Test fun `Core lookup failures keep their own status and a safe detail instead of becoming a 500`() {
        for (status in listOf(502, 503, 504)) {
            val response = ContentExceptionHandler().core(CoreAuthException(status, "CORE_MEMBER_FAILURE", "회원 정보 서비스를 사용할 수 없습니다."))

            assertEquals(status, response.statusCode.value())
            assertEquals(ContentErrorResponse("회원 정보 서비스를 사용할 수 없습니다."), response.body)
        }
    }
}
