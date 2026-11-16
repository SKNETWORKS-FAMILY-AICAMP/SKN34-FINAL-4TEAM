package ai.storyfork.content.mcp

import ai.storyfork.content._common.exception.ContentFailure
import ai.storyfork.content.auth.client.exception.CoreAuthException
import jakarta.validation.Validation
import org.slf4j.LoggerFactory

private val log = LoggerFactory.getLogger("ai.storyfork.content.mcp.ContentMcpErrors")

/**
 * 도구 오류다. Spring AI는 오류 텍스트를 `메시지 + 줄바꿈 + 최하위 원인 메시지`로 만들므로
 * 첫 줄에 HTTP API와 같은 상태(와 코드), 둘째 줄에 detail이 나오도록 detail을 원인에 둔다.
 */
class McpToolFailure(val status: Int, val code: String?, detail: String) :
    RuntimeException("HTTP $status" + (code?.let { " $it" } ?: ""), RuntimeException(detail))

private val validator = Validation.buildDefaultValidatorFactory().validator

/**
 * 컨트롤러의 `@Valid @RequestBody`에 해당한다. MCP 인자는 그 검사를 거치지 않으므로 DTO 입력은 Service에 넘기기 전에 이 함수로 검증한다.
 * 위반하면 HTTP API와 같은 422 문장에 위반한 필드 이름을 붙여 알리며 입력 값은 되돌려 주지 않는다.
 */
fun <T : Any> T.validated(): T {
    val fields = validator.validate(this).map { it.propertyPath.toString() }.distinct().sorted()
    if (fields.isNotEmpty()) throw McpToolFailure(422, null, "입력 길이·회차·필수 항목을 확인해 주세요: ${fields.joinToString()}")
    return this
}

/**
 * 도구 안의 Service 호출을 감싼다. 공통 예외([ContentFailure]·[CoreAuthException])를 상태·코드·detail이 있는 [McpToolFailure]로 바꾸며
 * 실패를 성공으로 바꾸지 않는다. 그 밖의 예외는 메시지에 입력·원고 본문이 섞일 수 있어 내용 없이 500으로만 알린다.
 * 기능별 예외(예: WorldStudio)는 그 기능의 도구 클래스에서 [McpToolFailure]로 바꿔 던진다.
 */
fun <T> mcpTool(call: () -> T): T = try {
    call()
} catch (e: McpToolFailure) {
    throw e
} catch (e: ContentFailure) {
    throw McpToolFailure(e.status, e.code, e.message)
} catch (e: CoreAuthException) {
    throw McpToolFailure(e.status, e.code, e.message.orEmpty())
} catch (e: Exception) {
    // 메시지·스택 전체에는 입력이 담길 수 있어 예외 종류와 첫 위치만 남긴다.
    log.error("MCP 도구 호출 실패: {} at {}", e.javaClass.name, e.stackTrace.firstOrNull())
    throw McpToolFailure(500, null, "요청을 처리하지 못했어요.")
}
