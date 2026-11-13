package ai.storyfork.content.mcp

import ai.storyfork.content.episode_version.service.dto.RevertRequest
import ai.storyfork.content.world.service.WorldCheckpointService
import ai.storyfork.content.world.service.WorldService
import ai.storyfork.content.world.service.dto.*
import io.modelcontextprotocol.common.McpTransportContext
import org.springframework.ai.mcp.annotation.McpTool
import org.springframework.ai.mcp.annotation.McpToolParam
import org.springframework.stereotype.Component

/**
 * 작품 세계관(설정집)과 체크포인트 도구다. 기존 [WorldService]·[WorldCheckpointService] 함수를 그대로 호출하는 어댑터이며 새 규칙·인가를 두지 않는다.
 * 계약: docs/design/content-mcp-contract.md. 형식은 [WorkMcpTools]와 같다.
 */
@Component
class WorldMcpTools(private val worlds: WorldService, private val checkpoints: WorldCheckpointService) {
    @McpTool(
        name = "work_world_read",
        description = "작품의 세계관(설정집)을 확정 설정·초안·변경 이력과 이후 저장에 쓰는 revision·sourceToken까지 조회한다(GET /api/v1/works/{id}/world). 작품 소유자만 가능하며 접근할 수 없으면 404다.",
        annotations = McpTool.McpAnnotations(readOnlyHint = true),
    )
    fun read(context: McpTransportContext, @McpToolParam(description = "작품 ID") id: String): WorldResponse =
        mcpTool { worlds.read(id, context.requireCaller().memberId) }

    @McpTool(
        name = "work_world_public_read",
        description = "공개 회차 기준으로 독자에게 보이는 공개 설정만 조회한다(GET /api/v1/public/works/{id}/world). 인증이 필요 없고 미래 정보·비공개 지식은 빠지며 비공개 작품이나 공개되지 않은 회차는 404다.",
        annotations = McpTool.McpAnnotations(readOnlyHint = true),
    )
    fun publicRead(
        @McpToolParam(description = "작품 ID") id: String,
        @McpToolParam(description = "기준 공개 회차 번호(1부터)") episode: Int,
    ): ReadingWorldResponse = mcpTool { worlds.publicRead(id, episode) }

    @McpTool(
        name = "work_setting_draft",
        description = "작품 세계관의 설정 초안을 저장한다(PUT /api/v1/works/{id}/settings/{sid}/draft, 새 설정은 sid에 new). 작품 소유자만 가능하며 revision·sourceToken이 work_world_read 응답과 다르면 409, 입력 오류는 422다.",
    )
    fun draft(
        context: McpTransportContext,
        @McpToolParam(description = "작품 ID") id: String,
        @McpToolParam(description = "설정 ID. 새 설정이면 new") sid: String,
        @McpToolParam(description = "초안 입력: revision(work_world_read의 revision)·setting(설정 내용)·sourceToken(work_world_read의 sourceToken)") data: SettingRequest,
    ): WorldResponse = mcpTool { worlds.saveDraft(id, sid, context.requireCaller().memberId, data.validated()) }

    @McpTool(
        name = "work_setting_commit",
        description = "저장한 설정 초안을 새 버전으로 확정한다(POST /api/v1/works/{id}/settings/{sid}/commit). 작품 소유자만 가능하며 초안이 없거나 revision이 어긋나면 409다.",
    )
    fun commit(
        context: McpTransportContext,
        @McpToolParam(description = "작품 ID") id: String,
        @McpToolParam(description = "설정 ID") sid: String,
        @McpToolParam(description = "기대 revision(work_world_read의 revision)") data: RevisionRequest,
    ): WorldResponse = mcpTool { worlds.commit(id, sid, context.requireCaller().memberId, data.validated().revision) }

    @McpTool(
        name = "work_setting_revert",
        description = "선택한 설정 버전을 새 버전으로 복원한다(POST /api/v1/works/{id}/settings/{sid}/revert). 작품 소유자만 가능하며 없는 버전은 404, 작성 중인 초안이 있거나 revision이 어긋나면 409다.",
    )
    fun revert(
        context: McpTransportContext,
        @McpToolParam(description = "작품 ID") id: String,
        @McpToolParam(description = "설정 ID") sid: String,
        @McpToolParam(description = "복원 입력: revision(work_world_read의 revision)·versionId(복원할 설정 버전 ID)") data: RevertRequest,
    ): WorldResponse = mcpTool { worlds.revert(id, sid, context.requireCaller().memberId, data.validated()) }

    @McpTool(
        name = "world_checkpoint_create",
        description = "작품 세계관의 현재 확정 설정을 체크포인트로 저장한다(POST /api/v1/works/{id}/world/checkpoints). 작품 소유자만 가능하다.",
    )
    fun createCheckpoint(context: McpTransportContext, @McpToolParam(description = "작품 ID") id: String): WorldCheckpointResponse =
        mcpTool { checkpoints.create(id, context.requireCaller().memberId) }

    @McpTool(
        name = "world_checkpoint_list",
        description = "작품 세계관의 체크포인트 목록(ID·저장 시각)을 최신순으로 조회한다(GET /api/v1/works/{id}/world/checkpoints). 작품 소유자만 가능하다.",
        annotations = McpTool.McpAnnotations(readOnlyHint = true),
    )
    fun listCheckpoints(context: McpTransportContext, @McpToolParam(description = "작품 ID") id: String): List<WorldCheckpointSummary> =
        mcpTool { checkpoints.list(id, context.requireCaller().memberId) }

    @McpTool(
        name = "world_checkpoint_read",
        description = "체크포인트 하나에 저장된 설정 목록을 조회한다(GET /api/v1/works/{id}/world/checkpoints/{checkpointId}). 작품 소유자만 가능하며 없는 체크포인트는 404다.",
        annotations = McpTool.McpAnnotations(readOnlyHint = true),
    )
    fun readCheckpoint(
        context: McpTransportContext,
        @McpToolParam(description = "작품 ID") id: String,
        @McpToolParam(description = "체크포인트 ID") checkpointId: String,
    ): WorldCheckpointResponse = mcpTool { checkpoints.read(id, context.requireCaller().memberId, checkpointId) }
}
