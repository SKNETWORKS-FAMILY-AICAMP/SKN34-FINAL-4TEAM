package ai.storyfork.content.auth

import ai.storyfork.content.auth.config.AiRunServiceTokenFilter
import org.junit.jupiter.api.Assertions.*
import org.junit.jupiter.api.Test
import org.springframework.mock.web.MockHttpServletRequest
import org.springframework.mock.web.MockHttpServletResponse
import org.springframework.security.core.context.SecurityContextHolder

class AiRunServiceTokenFilterTest {
    private val token="fixture-service-token-at-least-32-characters"
    @Test fun `only one configured service token passes and credentials are cleared`() {
        for (values in listOf(emptyList(),listOf("wrong"),listOf(token,token),listOf(token))) {
            val request=MockHttpServletRequest()
            values.forEach {request.addHeader("X-Internal-Token",it)}
            val response=MockHttpServletResponse()
            var called=false
            AiRunServiceTokenFilter(token).doFilter(request,response) {_,_ ->
                called=true
                assertEquals("AI_RUN_SERVICE",SecurityContextHolder.getContext().authentication!!.authorities.single().authority)
            }
            assertEquals(values==listOf(token),called)
            assertNull(SecurityContextHolder.getContext().authentication)
            if(!called) assertEquals(403,response.status)
        }
    }
}
