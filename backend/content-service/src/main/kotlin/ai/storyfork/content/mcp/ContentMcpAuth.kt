package ai.storyfork.content.mcp

import ai.storyfork.content.auth.config.OPERATOR_AUTHORITY
import io.modelcontextprotocol.common.McpTransportContext
import org.springframework.security.authentication.AnonymousAuthenticationToken
import org.springframework.security.core.context.SecurityContextHolder

/** MCP 도구를 호출한 사용자다. 값은 기존 `ContentAuthenticationFilter`가 검증한 Bearer에서만 오며 도구 인자로는 받지 않는다. */
data class McpCaller(val memberId: String, val operator: Boolean)

private const val CALLER_KEY = "storyfork.mcp.caller"

/**
 * 요청 스레드에서 호출해 인증 결과를 transport context로 옮긴다(Transport의 context extractor가 요청마다 부른다).
 * 도구는 요청 스레드가 아닐 수 있어 SecurityContextHolder를 직접 읽지 않는다. 인증이 없거나 익명이면 호출자를 싣지 않는다.
 */
fun mcpCallerContext(): McpTransportContext {
    val authentication = SecurityContextHolder.getContext().authentication
    if (authentication == null || !authentication.isAuthenticated || authentication is AnonymousAuthenticationToken) return McpTransportContext.EMPTY
    val operator = authentication.authorities.any { it.authority == OPERATOR_AUTHORITY }
    return McpTransportContext.create(mapOf(CALLER_KEY to McpCaller(authentication.name, operator)))
}

/** 공개 조회가 회원을 선택으로 받을 때(예: `WorkService.publicRead(id, member)`)의 호출자다. 익명이면 null이다. */
fun McpTransportContext.callerOrNull(): McpCaller? = get(CALLER_KEY) as? McpCaller

/** 사용자 도구의 호출자다. 인증이 없으면 401 도구 오류를 던진다. */
fun McpTransportContext.requireCaller(): McpCaller =
    callerOrNull() ?: throw McpToolFailure(401, "AUTHENTICATION_REQUIRED", "인증이 필요해요. 사용자 Bearer 토큰과 함께 호출해 주세요.")
