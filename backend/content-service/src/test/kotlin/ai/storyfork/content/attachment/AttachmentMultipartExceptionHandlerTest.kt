package ai.storyfork.content.attachment

import ai.storyfork.content.attachment.controller.AttachmentMultipartExceptionHandler
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.Test
import org.springframework.mock.web.MockHttpServletRequest

class AttachmentMultipartExceptionHandlerTest {
    private val handler = AttachmentMultipartExceptionHandler()
    private fun tooLarge(path: String) = handler.tooLarge(MockHttpServletRequest("POST", path))

    @Test fun `attachment uploads keep the 10 MiB message`() {
        val response = tooLarge("/api/v1/works/w/settings/s/attachments")
        assertEquals(413, response.statusCode.value())
        assertEquals("ATTACHMENT_TOO_LARGE", response.body?.code)
        assertTrue("10 MiB" in response.body!!.detail)
    }

    @Test fun `manuscript imports report the TXT and EPUB limits instead`() {
        for (path in listOf("/api/v1/works/w/manuscript-imports", "/api/v1/works/w/manuscript-imports/preview")) {
            val response = tooLarge(path)
            assertEquals(413, response.statusCode.value(), path)
            val detail = response.body!!.detail
            assertTrue("TXT" in detail && "10MB" in detail && "EPUB" in detail && "50MB" in detail, detail)
        }
    }
}
