package ai.storyfork.content.mcp

import ai.storyfork.content.episode.service.EpisodeService
import ai.storyfork.content.episode.service.EpisodeWorldBasisService
import ai.storyfork.content.episode.service.dto.CreateEpisodeRequest
import ai.storyfork.content.episode.service.dto.DraftRequest
import ai.storyfork.content.episode.service.dto.DraftResponse
import ai.storyfork.content.episode.service.dto.EpisodeListResponse
import ai.storyfork.content.episode.service.dto.EpisodeOrderScopeResponse
import ai.storyfork.content.episode.service.dto.EpisodeResponse
import ai.storyfork.content.episode.service.dto.EpisodeWorldBasisRequest
import ai.storyfork.content.episode.service.dto.EpisodeWorldBasisResponse
import ai.storyfork.content.episode_version.service.EpisodeVersionService
import ai.storyfork.content.episode_version.service.dto.RevertRequest
import ai.storyfork.content.publication.service.PublicationScheduleService
import ai.storyfork.content.publication.service.PublicationService
import ai.storyfork.content.publication.service.dto.PublicationScheduleRequest
import ai.storyfork.content.publication.service.dto.PublicationScheduleResponse
import ai.storyfork.content.publication.service.dto.PublicationVisibilityRequest
import ai.storyfork.content.publication.service.dto.PublishRequest
import ai.storyfork.content.work.service.WorkService
import ai.storyfork.content.work.service.dto.WorkResponse
import io.modelcontextprotocol.common.McpTransportContext
import java.util.UUID
import org.springframework.ai.mcp.annotation.McpTool
import org.springframework.ai.mcp.annotation.McpToolParam
import org.springframework.stereotype.Component

/**
 * 회차 도구다. 회차·기준 세계관·저장 버전·발행·예약 발행의 기존 Service 함수를 그대로 호출하는 어댑터이며 새 규칙·인가를 두지 않는다.
 * 모두 사용자 도구라 회원은 `context.requireCaller()`로만 얻고 도구 인자로 받지 않는다. 계약: docs/design/content-mcp-contract.md
 * 삭제·예약 취소처럼 본문이 없는(204) API는 Spring AI 기본 완료 응답(`"Done"`)을 돌려준다.
 */
@Component
class EpisodeMcpTools(
    private val episodes: EpisodeService,
    private val worldBasis: EpisodeWorldBasisService,
    private val versions: EpisodeVersionService,
    private val publication: PublicationService,
    private val schedules: PublicationScheduleService,
    private val works: WorkService,
) {
    @McpTool(
        name = "episode_list",
        description = "작품의 회차 목록(GET /api/v1/works/{id}/episodes). 작품 소유자만 가능하며 접근할 수 없는 작품은 404다.",
        annotations = McpTool.McpAnnotations(readOnlyHint = true),
    )
    fun list(
        context: McpTransportContext,
        @McpToolParam(description = "작품 ID") id: String,
    ): EpisodeListResponse = mcpTool { episodes.list(id, context.requireCaller().memberId) }

    @McpTool(
        name = "episode_create",
        description = "작품의 다음 번호 회차를 제목만으로 만든다(POST /api/v1/works/{id}/episodes). 소유자만 가능하며 제목이 비었거나 120자를 넘으면 422다.",
    )
    fun create(
        context: McpTransportContext,
        @McpToolParam(description = "작품 ID") id: String,
        @McpToolParam(description = "새 회차 입력: title(1~120자)") data: CreateEpisodeRequest,
    ): EpisodeResponse = mcpTool { episodes.create(id, context.requireCaller().memberId, data.validated()) }

    @McpTool(
        name = "episode_read",
        description = "회차 한 건의 초안·저장 버전·발행 상태(GET /api/v1/works/{id}/episodes/{number}). 소유자만 가능하며 작품·회차가 없으면 404다.",
        annotations = McpTool.McpAnnotations(readOnlyHint = true),
    )
    fun read(
        context: McpTransportContext,
        @McpToolParam(description = "작품 ID") id: String,
        @McpToolParam(description = "회차 번호(1부터)") number: Int,
    ): EpisodeResponse = mcpTool { episodes.read(id, context.requireCaller().memberId, number) }

    @McpTool(
        name = "episode_update_draft",
        description = "회차 초안(제목·본문·작가의 말)만 수정한다(PUT /api/v1/works/{id}/episodes/{number}/draft). 소유자만 가능하며 상속 회차는 403, revision이 최신이 아니면 409, 입력 오류는 422다.",
    )
    fun updateDraft(
        context: McpTransportContext,
        @McpToolParam(description = "작품 ID") id: String,
        @McpToolParam(description = "회차 번호(1부터)") number: Int,
        @McpToolParam(description = "초안 입력: title(1~120자)·body(40,000자 이하)·revision(읽은 draft.revision)·authorNote(2,000자 이하, 선택)") data: DraftRequest,
    ): EpisodeResponse = mcpTool { episodes.update(id, context.requireCaller().memberId, number, data.validated()) }

    @McpTool(
        name = "episode_order_scope",
        description = "회차 순서를 바꿀 때의 후보 번호와 제한 사유를 조회한다(GET /api/v1/works/{id}/episodes/{number}/order-scope). 소유자만 가능하며 실제 이동은 하지 않는다.",
        annotations = McpTool.McpAnnotations(readOnlyHint = true),
    )
    fun orderScope(
        context: McpTransportContext,
        @McpToolParam(description = "작품 ID") id: String,
        @McpToolParam(description = "회차 번호(1부터)") number: Int,
    ): EpisodeOrderScopeResponse = mcpTool { episodes.orderScope(id, context.requireCaller().memberId, number) }

    @McpTool(
        name = "episode_delete_draft",
        description = "회차의 작업 초안만 지운다(DELETE /api/v1/works/{id}/episodes/{number}/draft). 저장 버전은 보존되며 소유자만 가능하고, 상속 회차는 403, 초안이 바뀌었으면(revision 불일치) 409다.",
    )
    fun deleteDraft(
        context: McpTransportContext,
        @McpToolParam(description = "작품 ID") id: String,
        @McpToolParam(description = "회차 번호(1부터)") number: Int,
        @McpToolParam(description = "지울 초안의 수정 번호(읽은 draft.revision)") revision: Int,
    ) = mcpTool { episodes.deleteDraft(id, context.requireCaller().memberId, number, revision) }

    @McpTool(
        name = "episode_delete",
        description = "참조 없는 마지막 회차를 소프트 삭제한다(DELETE /api/v1/works/{id}/episodes/{number}). 소유자만 가능하며 상속 회차는 403, 마지막이 아니거나 저장 버전·발행본·이미지·참조가 있거나 revision이 다르면 409다.",
    )
    fun delete(
        context: McpTransportContext,
        @McpToolParam(description = "작품 ID") id: String,
        @McpToolParam(description = "회차 번호(1부터)") number: Int,
        @McpToolParam(description = "삭제할 회차의 수정 번호(읽은 draft.revision)") revision: Int,
    ) = mcpTool { episodes.deleteEpisode(id, context.requireCaller().memberId, number, revision) }

    @McpTool(
        name = "episode_world_basis_read",
        description = "회차가 기준으로 삼는 소유 세계관의 확정 버전과 수정 번호를 조회한다(GET /api/v1/works/{id}/episodes/{number}/world-basis). 소유자만 가능하다.",
        annotations = McpTool.McpAnnotations(readOnlyHint = true),
    )
    fun worldBasisRead(
        context: McpTransportContext,
        @McpToolParam(description = "작품 ID") id: String,
        @McpToolParam(description = "회차 번호(1부터)") number: Int,
    ): EpisodeWorldBasisResponse = mcpTool { worldBasis.read(id, UUID.fromString(context.requireCaller().memberId), number) }

    @McpTool(
        name = "episode_world_basis_choose",
        description = "집필 회차의 기준 세계관 확정 버전을 선택한다(PUT /api/v1/works/{id}/episodes/{number}/world-basis). 소유한 세계관의 확정 버전만 가능하며 없으면 404, 상속 회차는 403, 수정 번호가 바뀌었으면 409다.",
    )
    fun worldBasisChoose(
        context: McpTransportContext,
        @McpToolParam(description = "작품 ID") id: String,
        @McpToolParam(description = "회차 번호(1부터)") number: Int,
        @McpToolParam(description = "기준 입력: worldId(세계관 UUID)·revisionId(확정 버전 UUID)·revision(읽은 수정 번호)") data: EpisodeWorldBasisRequest,
    ): EpisodeWorldBasisResponse = mcpTool { worldBasis.choose(id, UUID.fromString(context.requireCaller().memberId), number, data.validated()) }

    @McpTool(
        name = "episode_version_save",
        description = "입력 원고를 새 저장 버전으로 저장하며 발행은 하지 않는다(POST /api/v1/works/{id}/episodes/{number}/versions). 소유자만 가능하며 상속 회차는 403, revision 충돌은 409, 입력 오류는 422다.",
    )
    fun versionSave(
        context: McpTransportContext,
        @McpToolParam(description = "작품 ID") id: String,
        @McpToolParam(description = "회차 번호(1부터)") number: Int,
        @McpToolParam(description = "저장할 원고: title(1~120자)·body(40,000자 이하)·revision(읽은 draft.revision)·authorNote(2,000자 이하, 선택)") data: DraftRequest,
    ): EpisodeResponse = mcpTool { versions.save(id, context.requireCaller().memberId, number, data.validated()) }

    @McpTool(
        name = "episode_version_restore",
        description = "선택한 저장 버전을 새 버전으로 복원한다(POST /api/v1/works/{id}/episodes/{number}/restore). 소유자만 가능하며 상속 회차는 403, 없는 버전은 404, revision 충돌은 409다.",
    )
    fun versionRestore(
        context: McpTransportContext,
        @McpToolParam(description = "작품 ID") id: String,
        @McpToolParam(description = "회차 번호(1부터)") number: Int,
        @McpToolParam(description = "복원 입력: versionId(저장 버전 ID)·revision(읽은 draft.revision)") data: RevertRequest,
    ): EpisodeResponse = mcpTool { versions.restore(id, context.requireCaller().memberId, number, data.validated()) }

    @McpTool(
        name = "episode_save_current_draft",
        description = "작품 단위 작성 계약으로 현재 작성 회차를 저장 버전으로 저장하고 초안을 돌려준다(PUT /api/v1/works/{id}/draft). revision은 회차가 아니라 작품 기준이며 소유권 위반은 404, 충돌은 409다.",
    )
    fun saveCurrentDraft(
        context: McpTransportContext,
        @McpToolParam(description = "작품 ID") id: String,
        @McpToolParam(description = "저장할 원고: title(1~120자)·body(40,000자 이하)·revision(작품 revision)·authorNote(2,000자 이하, 선택)") data: DraftRequest,
    ): DraftResponse = mcpTool { versions.saveCurrent(id, context.requireCaller().memberId, data.validated()).draft }

    @McpTool(
        name = "episode_publish",
        description = "선택한 저장 버전을 발행한다(POST /api/v1/works/{id}/episodes/{number}/publish). 소유자의 권리 확인(rightsConfirmed)이 필요하며 정책 위반은 403, 버전·순서·revision 충돌은 409다.",
    )
    fun publish(
        context: McpTransportContext,
        @McpToolParam(description = "작품 ID") id: String,
        @McpToolParam(description = "회차 번호(1부터)") number: Int,
        @McpToolParam(description = "발행 입력: versionId(발행할 저장 버전 ID)·revision(읽은 draft.revision)·rightsConfirmed(권리 확인)") data: PublishRequest,
    ): EpisodeResponse = mcpTool { publication.publishEpisode(id, context.requireCaller().memberId, number, data.validated()) }

    @McpTool(
        name = "episode_update_visibility",
        description = "발행된 회차를 공개 중단(visible=false)하거나 다시 공개(visible=true)한다(PUT /api/v1/works/{id}/episodes/{number}/visibility). 소유자만 가능하며 재공개는 권리 확인이 필요하고 권리 위반은 403, revision·상태 충돌은 409다.",
    )
    fun updateVisibility(
        context: McpTransportContext,
        @McpToolParam(description = "작품 ID") id: String,
        @McpToolParam(description = "회차 번호(1부터)") number: Int,
        @McpToolParam(description = "공개 상태 입력: visible(true=재공개, false=중단)·revision(읽은 draft.revision)·rightsConfirmed(재공개 때 필수)") data: PublicationVisibilityRequest,
    ): EpisodeResponse = mcpTool { publication.visibility(id, context.requireCaller().memberId, number, data.validated()) }

    @McpTool(
        name = "episode_publish_current",
        description = "작품 단위 발행 계약으로 현재 작성 회차의 저장 버전을 발행하고 갱신된 작품을 돌려준다(POST /api/v1/works/{id}/publish). 소유자의 권리 확인이 필요하며 기준 충돌은 409다.",
    )
    fun publishCurrent(
        context: McpTransportContext,
        @McpToolParam(description = "작품 ID") id: String,
        @McpToolParam(description = "발행 입력: versionId(발행할 저장 버전 ID)·revision(작품 revision)·rightsConfirmed(권리 확인)·allowFork·allowForkPublication(선택)") data: PublishRequest,
    ): WorkResponse = mcpTool {
        val memberId = context.requireCaller().memberId
        publication.publishCurrent(id, memberId, data.validated())
        works.read(id, memberId)
    }

    @McpTool(
        name = "episode_schedule_list",
        description = "회차의 예약 발행 목록을 최근 예약부터 돌려준다(GET /api/v1/works/{id}/episodes/{number}/publication-schedules). 소유자만 가능하다.",
        annotations = McpTool.McpAnnotations(readOnlyHint = true),
    )
    fun scheduleList(
        context: McpTransportContext,
        @McpToolParam(description = "작품 ID") id: String,
        @McpToolParam(description = "회차 번호(1부터)") number: Int,
    ): List<PublicationScheduleResponse> = mcpTool { schedules.list(id, context.requireCaller().memberId, number) }

    @McpTool(
        name = "episode_schedule_create",
        description = "저장 버전의 예약 발행을 등록한다(POST /api/v1/works/{id}/episodes/{number}/publication-schedules). 소유자만 가능하며 미래 시각과 권리 확인이 필요하고(위반 422), 상속 회차는 403, 대기 중인 예약이 이미 있으면 409다.",
    )
    fun scheduleCreate(
        context: McpTransportContext,
        @McpToolParam(description = "작품 ID") id: String,
        @McpToolParam(description = "회차 번호(1부터)") number: Int,
        @McpToolParam(description = "예약 입력: versionId(저장 버전 ID)·scheduledAt(미래 시각, ISO-8601 예: 2030-01-02T03:04:05Z)·rightsConfirmed(권리 확인)") data: PublicationScheduleRequest,
    ): PublicationScheduleResponse = mcpTool { schedules.create(id, context.requireCaller().memberId, number, data.validated()) }

    @McpTool(
        name = "episode_schedule_update",
        description = "대기 중인 예약의 저장 버전·시각을 바꾼다(PUT /api/v1/works/{id}/episodes/{number}/publication-schedules/{scheduleId}). 소유자만 가능하며 읽은 예약 revision이 필요하고(없으면 400) 이미 처리됐거나 revision이 다르면 409다.",
    )
    fun scheduleUpdate(
        context: McpTransportContext,
        @McpToolParam(description = "작품 ID") id: String,
        @McpToolParam(description = "회차 번호(1부터)") number: Int,
        @McpToolParam(description = "예약 ID") scheduleId: String,
        @McpToolParam(description = "예약 입력: versionId(저장 버전 ID)·scheduledAt(미래 시각, ISO-8601)·rightsConfirmed(권리 확인)·revision(읽은 예약 revision)") data: PublicationScheduleRequest,
    ): PublicationScheduleResponse = mcpTool { schedules.update(id, context.requireCaller().memberId, number, scheduleId, data.validated()) }

    @McpTool(
        name = "episode_schedule_cancel",
        description = "대기 중인 예약을 취소한다(DELETE /api/v1/works/{id}/episodes/{number}/publication-schedules/{scheduleId}). 소유자만 가능하며 이미 처리됐거나 revision이 다르면 409, revision이 음수면 422다.",
    )
    fun scheduleCancel(
        context: McpTransportContext,
        @McpToolParam(description = "작품 ID") id: String,
        @McpToolParam(description = "회차 번호(1부터)") number: Int,
        @McpToolParam(description = "예약 ID") scheduleId: String,
        @McpToolParam(description = "취소할 예약의 revision(예약 응답의 revision, 0 이상)") revision: Int,
    ) = mcpTool {
        val memberId = context.requireCaller().memberId
        // 컨트롤러의 `@RequestParam @Min(0)`은 MCP 인자에 걸리지 않아 같은 422로 직접 막는다(문장은 validated()와 같다).
        if (revision < 0) throw McpToolFailure(422, null, "입력 길이·회차·필수 항목을 확인해 주세요: revision")
        schedules.cancel(id, memberId, number, scheduleId, revision)
    }
}
