package ai.storyfork.content.mcp

import io.modelcontextprotocol.common.McpTransportContext
import org.junit.jupiter.api.AfterEach
import org.junit.jupiter.api.Assertions.*
import org.junit.jupiter.api.Test
import org.springframework.security.authentication.AnonymousAuthenticationToken
import org.springframework.security.authentication.UsernamePasswordAuthenticationToken
import org.springframework.security.core.Authentication
import org.springframework.security.core.authority.SimpleGrantedAuthority
import org.springframework.security.core.context.SecurityContextHolder
import java.util.UUID

/** Spring context·HTTP 없이 SecurityContext → transport context → 도구의 호출자 전달만 확인한다. */
class ContentMcpAuthTest {
    @AfterEach fun clear() = SecurityContextHolder.clearContext()

    private fun signIn(authentication: Authentication?) {
        val context = SecurityContextHolder.createEmptyContext()
        context.authentication = authentication
        SecurityContextHolder.setContext(context)
    }

    // ContentAuthenticationFilter가 만드는 인증과 같은 모양이다: Principal 이름은 회원 UUID, 운영자는 ROLE_OPERATOR.
    private fun member(id: String, operator: Boolean) = UsernamePasswordAuthenticationToken.authenticated(
        id, null, if (operator) listOf(SimpleGrantedAuthority("ROLE_OPERATOR")) else emptyList())

    @Test fun `the verified member and operator flag move into the transport context`() {
        for (operator in listOf(true, false)) {
            val id = UUID.randomUUID().toString()
            signIn(member(id, operator))

            val context = mcpCallerContext()

            assertEquals(McpCaller(id, operator), context.requireCaller(), "operator=$operator")
            assertEquals(McpCaller(id, operator), context.callerOrNull(), "operator=$operator")
        }
    }

    @Test fun `the caller survives the request thread because tools may run elsewhere`() {
        val id = UUID.randomUUID().toString()
        signIn(member(id, false))
        val context = mcpCallerContext()

        SecurityContextHolder.clearContext()
        var seen: McpCaller? = null
        Thread { seen = context.callerOrNull() }.also { it.start() }.join()

        assertEquals(McpCaller(id, false), seen)
    }

    @Test fun `anonymous and unauthenticated requests carry no caller`() {
        val anonymous = AnonymousAuthenticationToken("key", "anonymousUser", listOf(SimpleGrantedAuthority("ROLE_ANONYMOUS")))
        val notYetVerified = UsernamePasswordAuthenticationToken.unauthenticated("someone", "credentials")
        for ((label, authentication) in mapOf("none" to null, "anonymous" to anonymous, "unauthenticated" to notYetVerified)) {
            signIn(authentication)

            val context = mcpCallerContext()

            assertNull(context.callerOrNull(), label)
        }
    }

    @Test fun `a user tool without a caller fails as authentication required`() {
        val failure = assertThrows(McpToolFailure::class.java) { McpTransportContext.EMPTY.requireCaller() }

        assertEquals(401, failure.status)
        assertEquals("AUTHENTICATION_REQUIRED", failure.code)
    }
}
