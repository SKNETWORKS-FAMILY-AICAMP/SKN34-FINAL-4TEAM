package ai.storyfork.content.mcp

import ai.storyfork.content.work.service.WorkService
import ai.storyfork.content.work.service.dto.WorkListResponse
import org.springframework.ai.mcp.annotation.McpTool
import org.springframework.ai.mcp.annotation.McpToolParam
import org.springframework.stereotype.Component

/**
 * 작품 도구다. 기존 [WorkService] 함수를 그대로 호출하는 어댑터이며 새 규칙·인가를 두지 않는다. 계약: docs/design/content-mcp-contract.md
 * 형식: 공개 도구는 [mcpTool]만 감싸고, 사용자 도구는 `context: McpTransportContext`를 받아 `context.requireCaller()`로만 회원을 얻는다.
 */
@Component
class WorkMcpTools(private val service: WorkService) {
    @McpTool(
        name = "work_public_list",
        description = "공개 작품 목록(GET /api/v1/public/works). 인증이 필요 없다. 인자를 모두 생략하면 최신순 전체를 돌려준다.",
        annotations = McpTool.McpAnnotations(readOnlyHint = true),
    )
    fun publicList(
        @McpToolParam(description = "제목·작가명·해시태그·장르 부분 일치 검색어", required = false) q: String?,
        @McpToolParam(description = "검색 범위: all|title|author|tag|genre (기본 all)", required = false) f: String?,
        @McpToolParam(description = "정렬: latest|like|view (기본 latest)", required = false) sort: String?,
        @McpToolParam(description = "쪽 번호(0부터). page·size 중 하나라도 주면 그 구간만 돌려준다", required = false) page: String?,
        @McpToolParam(description = "쪽 크기(1~100, 기본 20)", required = false) size: String?,
    ): WorkListResponse = mcpTool { service.publicList(q, f, sort, page, size) }
}
