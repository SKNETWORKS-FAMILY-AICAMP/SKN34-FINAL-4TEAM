package ai.storyfork.content.mcp

import ai.storyfork.content.plan.service.StoryPlanService
import ai.storyfork.content.plan.service.dto.StoryPlanListResponse
import ai.storyfork.content.plan.service.dto.StoryPlanRequest
import ai.storyfork.content.plan.service.dto.StoryPlanResponse
import io.modelcontextprotocol.common.McpTransportContext
import org.springframework.ai.mcp.annotation.McpTool
import org.springframework.ai.mcp.annotation.McpToolParam
import org.springframework.stereotype.Component

/**
 * 작품의 비공개 플롯·장면 계획 도구다. 기존 [StoryPlanService] 함수를 그대로 호출하는 어댑터이며 원고·세계관 정본은 바꾸지 않는다.
 * 모두 소유자 전용이라 호출자는 `context.requireCaller()`로만 얻는다. 계약: docs/design/content-mcp-contract.md
 */
@Component
class StoryPlanMcpTools(private val service: StoryPlanService) {
    @McpTool(
        name = "story_plan_list",
        description = "작품의 플롯·장면 계획 목록(GET /api/v1/works/{workId}/story-plans). 소유자만 읽을 수 있고 타인 작품은 404다.",
        annotations = McpTool.McpAnnotations(readOnlyHint = true),
    )
    fun list(context: McpTransportContext, @McpToolParam(description = "작품 ID") workId: String): StoryPlanListResponse =
        mcpTool { service.list(workId, context.requireCaller().memberId) }

    @McpTool(
        name = "story_plan_read",
        description = "계획 상세(GET /api/v1/works/{workId}/story-plans/{id}). 소유자만 읽을 수 있고 다른 작품·삭제된 계획은 404다.",
        annotations = McpTool.McpAnnotations(readOnlyHint = true),
    )
    fun read(
        context: McpTransportContext,
        @McpToolParam(description = "작품 ID") workId: String,
        @McpToolParam(description = "계획 ID") id: String,
    ): StoryPlanResponse = mcpTool { service.read(workId, context.requireCaller().memberId, id) }

    @McpTool(
        name = "story_plan_create",
        description = "플롯 또는 장면 계획 생성(POST /api/v1/works/{workId}/story-plans). 소유권·소속 플롯·참조를 검사하며 잘못된 입력은 422다.",
    )
    fun create(
        context: McpTransportContext,
        @McpToolParam(description = "작품 ID") workId: String,
        @McpToolParam(description = PLAN_INPUT) data: StoryPlanRequest,
    ): StoryPlanResponse = mcpTool { service.create(workId, context.requireCaller().memberId, data.validated()) }

    @McpTool(
        name = "story_plan_update",
        description = "계획 수정(PUT /api/v1/works/{workId}/story-plans/{id}). 소유자만 가능하며 종류·소속 플롯은 바꿀 수 없고 편집 충돌은 409, 참조 오류는 422다.",
    )
    fun update(
        context: McpTransportContext,
        @McpToolParam(description = "작품 ID") workId: String,
        @McpToolParam(description = "계획 ID") id: String,
        @McpToolParam(description = PLAN_INPUT) data: StoryPlanRequest,
    ): StoryPlanResponse = mcpTool { service.update(workId, context.requireCaller().memberId, id, data.validated()) }

    @McpTool(
        name = "story_plan_delete",
        description = "계획 삭제(DELETE /api/v1/works/{workId}/story-plans/{id}). 논리 삭제이며 소유자만 가능하다. 편집 충돌이나 하위 장면이 남아 있으면 409다.",
    )
    fun delete(
        context: McpTransportContext,
        @McpToolParam(description = "작품 ID") workId: String,
        @McpToolParam(description = "계획 ID") id: String,
        @McpToolParam(description = "읽은 계획의 revision") revision: Int,
    ) = mcpTool { service.delete(workId, context.requireCaller().memberId, id, revision) }
}

private const val PLAN_INPUT =
    "계획 입력(kind: plot|scene, title 필수·120자 이하, 장면은 parentId에 소속 플롯 ID, content 8,000자 이하, " +
        "장면만 선택: episodeNumber·characterIds·placeIds(각 30개 이하), revision: 새 계획은 0·수정은 읽은 revision)"
