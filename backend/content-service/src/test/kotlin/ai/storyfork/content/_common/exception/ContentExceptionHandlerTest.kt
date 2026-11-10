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

    @Test fun `a coded failure also answers with its code while an uncoded one keeps the detail-only body`() {
        val mapper = tools.jackson.databind.json.JsonMapper.builder().findAndAddModules().build()
        val coded = ContentExceptionHandler().failure(ContentFailure(409, "숨겨진 댓글이에요.", "COMMENT_HIDDEN"))
        val plain = ContentExceptionHandler().failure(ContentFailure(404, "댓글을 찾을 수 없어요."))

        assertEquals(409, coded.statusCode.value())
        assertEquals("""{"detail":"숨겨진 댓글이에요.","code":"COMMENT_HIDDEN"}""", mapper.writeValueAsString(coded.body))
        assertEquals(404, plain.statusCode.value())
        assertEquals("""{"detail":"댓글을 찾을 수 없어요."}""", mapper.writeValueAsString(plain.body))
    }
}
