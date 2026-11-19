package ai.storyfork.content.mcp

import ai.storyfork.content.work.service.WorkWorldService
import ai.storyfork.content.world.controller.WorldStudioExceptionHandler
import ai.storyfork.content.world.domain.WorldConflict
import ai.storyfork.content.world.domain.WorldMetadataInvalid
import ai.storyfork.content.world.domain.WorldNotFound
import ai.storyfork.content.world.domain.WorldStudioFailure
import ai.storyfork.content.world.domain.episodeFromText
import ai.storyfork.content.world.service.AnalysisStorageUnconfirmed
import ai.storyfork.content.world.service.InitialWorldAnalysisService
import ai.storyfork.content.world.service.InitialWorldApplicationService
import ai.storyfork.content.world.service.InitialWorldReviewConflict
import ai.storyfork.content.world.service.PublicWorldService
import ai.storyfork.content.world.service.WorldStudioService
import ai.storyfork.content.world.service.dto.*
import io.modelcontextprotocol.common.McpTransportContext
import java.util.UUID
import org.springframework.ai.mcp.annotation.McpTool
import org.springframework.ai.mcp.annotation.McpToolParam
import org.springframework.dao.DataAccessException
import org.springframework.http.ResponseEntity
import org.springframework.stereotype.Component
import org.springframework.transaction.TransactionException

/**
 * 독립 세계관(WorldStudio)·공개 세계관·분석·승인 반영 도구다. 기존 Service 함수를 그대로 호출하는 어댑터이며 새 규칙·인가를 두지 않는다.
 * 계약: docs/design/content-mcp-contract.md. 형식은 [WorkMcpTools]와 같고, WorldStudio 계열 Controller가 `@ExceptionHandler`로 바꾸는 예외는
 * 아래 [studioTool]·[analysisTool]이 같은 상태·code·detail의 도구 오류로 옮긴다. 표지 3개는 파일 처리라 계약 범위 밖이다.
 */
@Component
class WorldStudioMcpTools(
    private val studio: WorldStudioService,
    private val links: WorkWorldService,
    private val publicWorlds: PublicWorldService,
    private val analyses: InitialWorldAnalysisService,
    private val applications: InitialWorldApplicationService,
) {
    @McpTool(
        name = "world_studio_list",
        description = "내 세계관(WorldStudio) 요약 목록을 조회한다(GET /api/v1/world-studios). 관계 저장소 전환 전·미완료 상태도 relationshipStatus로 알려 주고, 연결된 소설이 있으면 linkedWorkId를 채운다.",
        annotations = McpTool.McpAnnotations(readOnlyHint = true),
    )
    fun list(context: McpTransportContext): List<WorldStudioSummaryResponse> = studioTool {
        val rows = studio.list(context.callerUuid())
        val linked = links.linkedWorkIds(rows.map { it.worldId })
        rows.map { it.copy(linkedWorkId = linked[it.worldId]) }
    }

    @McpTool(
        name = "world_studio_create",
        description = "새 세계관을 만든다(POST /api/v1/world-studios). id를 생략하면 새로 만들고 재시도에는 같은 id·같은 입력을 다시 보내면 중복 없이 같은 세계관을 돌려주며, 입력 오류는 422·같은 id에 다른 입력은 409다. 응답의 draftRevision(0)이 첫 저장(world_studio_edit_draft)의 expectedDraftRevision이다.",
    )
    fun create(
        context: McpTransportContext,
        @McpToolParam(description = "생성 입력: name(필수, 1~100자)·description(선택, 20,000자 이하)·id(선택, 재시도 식별용 UUID)") request: CreateWorldRequest,
    ): WorldDraftResponse = studioTool { linked(studio.create(context.callerUuid(), request)) }

    @McpTool(
        name = "world_studio_read",
        description = "세계관의 현재 초안(카드·관계·공개 설정)을 조회한다(GET /api/v1/world-studios/{id}). 관계는 episode(선택)화 시점의 것이며 생략하면 최신 회차다. relationshipEpisodes는 관계 id마다 그 시점 관계가 시작된 회차('N화부터')다. 소유자만 가능하며 남의 세계관은 404, episode 값 오류는 422, 관계 저장소 전환 필요·불일치는 409, 관계 저장 미완료는 503이다. 카드에는 삭제한 것(lifecycle=removed)도 들어 있다(지난 회차 관계의 끝점일 수 있다). draftRevision이 다음 저장의 expectedDraftRevision이고 카드·관계 semanticMetadata의 키 뜻은 world_studio_edit_draft의 request 설명을 본다. 관계 source → target 「label」은 'target은 source의 label'로 읽는다.",
        annotations = McpTool.McpAnnotations(readOnlyHint = true),
    )
    fun read(
        context: McpTransportContext,
        @McpToolParam(description = "세계관 ID(UUID)") id: String,
        @McpToolParam(description = "관계를 볼 회차 순번(연결된 소설의 회차, 1 이상의 정수). 생략하면 최신 회차", required = false) episode: String?,
    ): WorldDraftResponse = studioTool { linked(studio.draft(uuidArg(id), context.callerUuid(), episodeFromText(episode))) }

    @McpTool(
        name = "world_studio_edit_draft",
        description = "세계관 초안(이름·설명·카드·관계)을 저장한다(PUT /api/v1/world-studios/{id}/draft). 카드·관계는 부분 수정이 아니라 통째로 덮어쓴다: 고칠 항목은 world_studio_read로 읽은 전체에서 바꿀 필드만 고쳐 보내고(semanticMetadata는 허용 키만 그대로 두고 허용하지 않는 옛 키는 뺀다), 빠뜨린 선택 필드는 기본값(분류 비움·별칭과 태그 없음·비공개·semanticMetadata 빈 객체)으로 바뀐다. name·description도 바꾸지 않을 때는 읽은 값을 다시 보내야 하고 보낸 값으로 덮어쓴다. 기본(replace=false)은 보낸 카드·관계만 추가·갱신한다. replace=true는 보낸 것이 전부라는 뜻이라 보내지 않은 카드는 삭제되고 보내지 않은 관계는 그 회차에서 끝나니 일부만 고칠 때는 쓰지 않는다. 관계는 episode(선택)화 시점의 것이며 생략하면 최신 회차다. 관계마다 다른 회차에 기록하려면 relationshipEpisodes(관계 id → 'N화부터')를 준다. 설정 삭제(lifecycle=removed·replace=true에서 생략)는 episode를 생략한 최신 회차에서만 하며 지정하면 422다. 소유자만 가능하며 expectedDraftRevision(world_studio_read 또는 직전 저장 응답의 draftRevision, 저장에 성공하면 1 늘어난다)이 어긋나면 409이고, 결과를 못 받으면 같은 key·같은 입력으로 재시도한다. 입력 오류는 422이며 semanticMetadata의 허용 키·형식을 어기면 detail에 카드·관계 id와 키 이름이 나온다(허용 키는 request 설명을 본다).",
    )
    fun editDraft(
        context: McpTransportContext,
        @McpToolParam(description = "세계관 ID(UUID)") id: String,
        @McpToolParam(description = EDIT_DRAFT_INPUT) request: EditWorldDraftRequest,
    ): WorldDraftResponse = studioTool { linked(studio.edit(uuidArg(id), context.callerUuid(), request)) }

    @McpTool(
        name = "world_studio_save_revision",
        description = "세계관 초안의 카드·설정을 불변 버전으로 확정한다(POST /api/v1/world-studios/{id}/revisions). 소유자만 가능하며 expectedDraftRevision이 어긋나면 409이고 같은 key·같은 입력의 재시도는 같은 버전을 돌려준다(관계의 과거 상태는 저장하지 않는다). 확정하면 draftRevision이 1 늘어나 다음 저장은 새 값을 읽어 써야 하고, 활성 카드 가운데 title 또는 body가 빈 것이 있으면 422다. 공개 세계관·독자 설정 위키·이어받기는 초안이 아니라 마지막 확정 버전의 카드를 보여 주므로 고친 내용을 독자에게 보이려면 확정해야 한다.",
    )
    fun saveRevision(
        context: McpTransportContext,
        @McpToolParam(description = "세계관 ID(UUID)") id: String,
        @McpToolParam(description = "확정 입력: expectedDraftRevision(world_studio_read의 draftRevision)·key(1~200바이트, 재시도 식별용)") request: SaveWorldRequest,
    ): WorldRevisionResponse = studioTool { studio.save(uuidArg(id), context.callerUuid(), request) }

    @McpTool(
        name = "world_studio_update_publication",
        description = "세계관의 공개 범위(private|public)와 장르를 바꾼다(PUT /api/v1/world-studios/{id}/publication). 소유자만 가능하며 확정한 버전이 없으면 설정만 되고 listed=false이고, 남의 세계관은 404·값 오류는 422다. 공개해도 작가 전용 카드(revealFromEpisode가 없고 visibility도 private)는 독자에게 보이지 않는다.",
    )
    fun updatePublication(
        context: McpTransportContext,
        @McpToolParam(description = "세계관 ID(UUID)") id: String,
        @McpToolParam(description = "공개 입력: visibility(private|public)·genre(fantasy|sf|wuxia|romance|modern|classic|mystery, 선택)") request: PublicationRequest,
    ): PublicationResponse = studioTool { studio.publication(uuidArg(id), context.callerUuid(), request) }

    @McpTool(
        name = "world_studio_revisions",
        description = "세계관의 확정 버전 목록(버전 ID·번호·저장 시각)을 최신순으로 조회한다(GET /api/v1/world-studios/{id}/revisions). 소유자만 가능하다.",
        annotations = McpTool.McpAnnotations(readOnlyHint = true),
    )
    fun revisions(context: McpTransportContext, @McpToolParam(description = "세계관 ID(UUID)") id: String): List<WorldRevisionSummaryResponse> =
        studioTool { studio.revisionSummaries(uuidArg(id), context.callerUuid()) }

    @McpTool(
        name = "world_studio_revision_read",
        description = "확정된 세계관 버전 하나의 카드·설정을 조회한다(GET /api/v1/world-studios/{id}/revisions/{revisionId}). 소유자만 가능하며 현재 관계를 과거 관계로 섞지 않고 없는 버전은 404다. 확정 버전으로 초안을 되돌리는 도구는 없다(화면 전용).",
        annotations = McpTool.McpAnnotations(readOnlyHint = true),
    )
    fun revisionRead(
        context: McpTransportContext,
        @McpToolParam(description = "세계관 ID(UUID)") id: String,
        @McpToolParam(description = "확정 버전 ID(UUID)") revisionId: String,
    ): WorldRevisionResponse = studioTool { studio.revision(uuidArg(id), context.callerUuid(), uuidArg(revisionId)) }

    @McpTool(
        name = "world_studio_public_list",
        description = "공개 세계관 목록을 최근 공개순으로 조회한다(GET /api/v1/public/world-studios). 인증이 필요 없고 genre(코드)·page(0부터)·size(1~100, 기본 24)는 선택이며 값 오류는 422다.",
        annotations = McpTool.McpAnnotations(readOnlyHint = true),
    )
    fun publicList(
        @McpToolParam(description = "장르 코드(fantasy|sf|wuxia|romance|modern|classic|mystery). 생략하면 전체", required = false) genre: String?,
        @McpToolParam(description = "쪽 번호(0부터)", required = false) page: String?,
        @McpToolParam(description = "쪽 크기(1~100, 기본 24)", required = false) size: String?,
    ): PublicWorldPageResponse = mcpTool { publicWorlds.list(genre, null, page, size) }

    @McpTool(
        name = "world_studio_public_read",
        description = "공개 세계관 하나를 조회한다(GET /api/v1/public/world-studios/{id}). 인증이 필요 없고 마지막 확정 버전에서 기준 회차(연결된 공개 소설의 발행된 마지막 회차, 연결이 없으면 1화) 이하로 공개된 카드와 그 카드끼리의 그 시점 관계(관계마다 기준 회차까지의 변화 history 포함)만 돌려주며 비공개·확정 버전 없음·없는 세계관은 404다.",
        annotations = McpTool.McpAnnotations(readOnlyHint = true),
    )
    fun publicRead(@McpToolParam(description = "세계관 ID(UUID)") id: String): PublicWorldResponse = mcpTool { publicWorlds.detail(uuidArg(id)) }

    @McpTool(
        name = "world_analysis_create",
        description = "세계관 초안 원문을 AI로 분석해 설정 후보를 만든다(POST /api/v1/world-studios/{worldId}/analyses). 소유자만 가능하고 같은 key는 저장된 결과를 돌려주며(executionStatus가 running이면 world_analysis_read로 확인), 분석 실패(502)·결과 미확인(503)은 도구 오류이니 같은 key로 다시 실행하지 않는다.",
    )
    fun createAnalysis(
        context: McpTransportContext,
        @McpToolParam(description = "세계관 ID(UUID)") worldId: String,
        @McpToolParam(description = "분석 입력: key(영숫자·:_- 1~200자, 재시도 식별용)·expectedDraftRevision(world_studio_read의 draftRevision)") request: InitialWorldAnalysisRequest,
    ): InitialWorldAnalysisResponse = analysisTool {
        val read = analyses.analyze(uuidArg(worldId), context.callerUuid(), request)
        val body = read.body
        // 컨트롤러는 본문(AnalysisResponse)에 더해 failed를 502, unknown을 503으로 답한다. 본문만 돌려주면 실패가 성공처럼 보이므로 같은 상태의 도구 오류로 낸다.
        val status = when (body.executionStatus) {
            "failed" -> 502
            "unknown" -> 503
            else -> return@analysisTool body
        }
        throw McpToolFailure(status, read.failureCode,
            "분석을 끝내지 못했어요(실행 상태 ${body.executionStatus}, 분석 ID ${body.analysisId}). 같은 key로 다시 실행하지 말고 world_analysis_read로 확인해 주세요.")
    }

    @McpTool(
        name = "world_analysis_list",
        description = "세계관의 분석 목록을 최신순으로 조회한다(GET /api/v1/world-studios/{worldId}/analyses). 소유자만 가능하다.",
        annotations = McpTool.McpAnnotations(readOnlyHint = true),
    )
    fun listAnalyses(context: McpTransportContext, @McpToolParam(description = "세계관 ID(UUID)") worldId: String): List<InitialWorldAnalysisResponse> =
        analysisTool { analyses.list(uuidArg(worldId), context.callerUuid()) }

    @McpTool(
        name = "world_analysis_read",
        description = "분석 하나를 조회한다(GET /api/v1/world-studios/{worldId}/analyses/{analysisId}). 소유자만 가능하고 executionStatus(running|completed|failed|unknown)가 성공 여부를, freshness가 stale이면 그 뒤 초안이 바뀌었음을 나타낸다.",
        annotations = McpTool.McpAnnotations(readOnlyHint = true),
    )
    fun readAnalysis(
        context: McpTransportContext,
        @McpToolParam(description = "세계관 ID(UUID)") worldId: String,
        @McpToolParam(description = "분석 ID(UUID)") analysisId: String,
    ): InitialWorldAnalysisResponse = analysisTool { analyses.get(uuidArg(worldId), context.callerUuid(), uuidArg(analysisId)).body }

    @McpTool(
        name = "world_analysis_candidates",
        description = "분석이 만든 설정 후보 목록을 조회한다(GET /api/v1/world-studios/{worldId}/analyses/{analysisId}/candidates). 소유자만 가능하며 완료 전이거나 실패한 분석은 빈 목록이다.",
        annotations = McpTool.McpAnnotations(readOnlyHint = true),
    )
    fun analysisCandidates(
        context: McpTransportContext,
        @McpToolParam(description = "세계관 ID(UUID)") worldId: String,
        @McpToolParam(description = "분석 ID(UUID)") analysisId: String,
    ): List<InitialWorldStoredCandidate> = analysisTool { analyses.candidates(uuidArg(worldId), context.callerUuid(), uuidArg(analysisId)) }

    @McpTool(
        name = "world_analysis_decide",
        description = "분석 후보 하나의 검토 결정(approve|edit|hold|reject)을 기록한다(POST /api/v1/world-studios/{worldId}/analyses/{analysisId}/candidates/{candidateId}/decisions). 소유자만 가능하고 초안 반영·확정 저장은 하지 않으며, 같은 key의 재시도는 저장된 결정을 돌려주고 결정 순서가 어긋나거나 분석이 오래됐으면 409다.",
    )
    fun decide(
        context: McpTransportContext,
        @McpToolParam(description = "세계관 ID(UUID)") worldId: String,
        @McpToolParam(description = "분석 ID(UUID)") analysisId: String,
        @McpToolParam(description = "후보 ID(UUID, world_analysis_candidates의 candidateId)") candidateId: String,
        @McpToolParam(description = "결정 입력: key(재시도 식별용)·expectedDecisionSequence(이 후보의 마지막 결정 번호, 처음이면 0)·action(approve|edit|hold|reject)·editedCandidate(action이 edit일 때만 후보 전체, 아니면 null이되 키는 생략하지 말 것)·comment") request: InitialWorldDecisionRequest,
    ): InitialWorldDecisionRecord = analysisTool { analyses.decide(uuidArg(worldId), context.callerUuid(), uuidArg(analysisId), uuidArg(candidateId), request) }

    @McpTool(
        name = "world_analysis_apply",
        description = "승인한 분석 후보를 세계관 초안에 추가한다(POST /api/v1/world-studios/{worldId}/analyses/{analysisId}/applications). 소유자만 가능하고 같은 key·같은 입력은 저장된 요청을 이어서 처리하며, 반영하지 못했거나 결과를 확인하지 못하면(503) 도구 오류이니 world_analysis_application_read로 확인한다. 반영된 카드·관계에는 semanticMetadata.preprocessing(분석 출처)이 붙으니 이후 world_studio_edit_draft로 그 카드를 고칠 때 이 값을 그대로 돌려보낸다.",
    )
    fun applyAnalysis(
        context: McpTransportContext,
        @McpToolParam(description = "세계관 ID(UUID)") worldId: String,
        @McpToolParam(description = "분석 ID(UUID)") analysisId: String,
        @McpToolParam(description = "반영 입력: key(재시도 식별용)·expectedDraftRevision(분석 때의 draftRevision)·candidates(승인한 후보의 candidateId와 마지막 decisionSequence 목록)") request: InitialWorldApplicationRequest,
    ): InitialWorldApplicationResponse = studioTool {
        val receipt = applications.apply(uuidArg(worldId), context.callerUuid(), uuidArg(analysisId), request)
        // 컨트롤러는 applied를 200, applying을 202로 답하고 POST의 그 밖 상태(failed·unknown)는 503이다. 실패를 성공처럼 보이지 않게 같은 상태의 도구 오류로 낸다.
        if (receipt.status != "applied" && receipt.status != "applying") throw McpToolFailure(503, null,
            "반영을 끝내지 못했어요(상태 ${receipt.status}, 반영 ID ${receipt.applicationId}). world_analysis_application_read로 확인하거나 같은 요청으로 다시 호출해 주세요.")
        receipt
    }

    @McpTool(
        name = "world_analysis_application_read",
        description = "분석 후보 반영 기록(receipt)을 조회한다(GET /api/v1/world-studios/{worldId}/analyses/{analysisId}/applications/{applicationId}). 소유자만 가능하며 저장을 다시 실행하지 않는다.",
        annotations = McpTool.McpAnnotations(readOnlyHint = true),
    )
    fun readApplication(
        context: McpTransportContext,
        @McpToolParam(description = "세계관 ID(UUID)") worldId: String,
        @McpToolParam(description = "분석 ID(UUID)") analysisId: String,
        @McpToolParam(description = "반영 ID(UUID)") applicationId: String,
    ): InitialWorldApplicationResponse = studioTool { applications.get(uuidArg(worldId), context.callerUuid(), uuidArg(analysisId), uuidArg(applicationId)) }

    /** 컨트롤러와 같은 응답이다: 연결된 소설(1:1)은 Content 쪽 정본이라 저장 뒤 따로 읽어 붙인다. */
    private fun linked(draft: WorldDraftResponse) = draft.copy(linkedWorkId = links.linkedWorkIds(listOf(draft.worldId))[draft.worldId])
}

// 컨트롤러는 Principal 이름(회원 UUID)을 UUID로 바꿔 쓴다.
private fun McpTransportContext.callerUuid(): UUID = UUID.fromString(requireCaller().memberId)

// 컨트롤러의 `@PathVariable UUID`는 형식이 틀리면 400(요청 형식과 필수 항목을 확인해 주세요.)이다.
private fun uuidArg(value: String): UUID =
    try { UUID.fromString(value) } catch (_: IllegalArgumentException) { throw McpToolFailure(400, null, "요청 형식과 필수 항목을 확인해 주세요.") }

private val studioErrors = WorldStudioExceptionHandler()

private fun ResponseEntity<WorldStudioErrorResponse>.toToolFailure() = McpToolFailure(statusCode.value(), body!!.code, body!!.detail)

/**
 * WorldStudioController·InitialWorldApplicationController(와 InitialWorldAnalysisController)에 적용되는 [WorldStudioExceptionHandler]의
 * 상태·code·detail을 그대로 도구 오류로 옮긴다(핸들러를 재사용해 어긋나지 않게 한다). 입력·SQL 등 예외 메시지는 담지 않는다.
 */
private fun <T> studioTool(call: () -> T): T = mcpTool {
    try {
        call()
    } catch (e: InitialWorldReviewConflict) {
        throw studioErrors.reviewConflict(e).toToolFailure()
    } catch (e: WorldStudioFailure) {
        throw studioErrors.failure(e).toToolFailure()
    } catch (e: WorldNotFound) {
        throw studioErrors.missing().toToolFailure()
    } catch (e: WorldConflict) {
        throw studioErrors.conflict().toToolFailure()
    } catch (e: WorldMetadataInvalid) {
        throw studioErrors.metadataInvalid(e).toToolFailure()
    } catch (e: IllegalArgumentException) {
        throw studioErrors.invalid().toToolFailure()
    } catch (e: DataAccessException) {
        throw studioErrors.persistence().toToolFailure()
    } catch (e: TransactionException) {
        throw studioErrors.persistence().toToolFailure()
    }
}

/** InitialWorldAnalysisController가 자기 `@ExceptionHandler`로 공통 핸들러와 다르게 답하는 두 경우다(분석 도구 5개). */
private fun <T> analysisTool(call: () -> T): T = studioTool {
    try {
        call()
    } catch (e: InitialWorldReviewConflict) {
        // ANALYSIS_STALE 문장은 공통 핸들러와 같으니 그쪽에 맡기고, 그 밖의 코드만 '검토' 문장을 쓴다.
        if (e.code == "ANALYSIS_STALE") throw e
        throw McpToolFailure(409, e.code, "완료된 분석 후보만 검토할 수 있습니다.")
    } catch (e: AnalysisStorageUnconfirmed) {
        throw McpToolFailure(503, "ANALYSIS_STORAGE_UNCONFIRMED", "저장 결과를 확인하지 못했습니다. 동일 키로 조회하고 새 키로 자동 실행하지 마세요.")
    }
}

// world_studio_edit_draft의 request 설명이다. 도구 설명은 동작·함정을, 이 필드 사전은 입력 칸의 규칙을 싣는다. semanticMetadata 허용 키는 world/domain/SemanticMetadata.kt와 같다(WorldStudioMcpToolsTest가 어긋남을 막는다).
private const val EDIT_DRAFT_INPUT =
    "초안 입력: expectedDraftRevision(world_studio_read 또는 직전 저장 응답의 draftRevision)·name(1~100자)·description(20,000자 이하)·" +
        "key(필수, 1~200바이트, 요청마다 새 값(UUID 권장). 결과를 못 받았을 때만 같은 key·같은 입력으로 다시 보내며 같은 key·같은 expectedDraftRevision에 다른 입력은 409)·" +
        "replace(false면 보낸 카드·관계만 추가·갱신, true면 보내지 않은 카드는 삭제하고 보내지 않은 관계는 그 회차에서 끝냄)·" +
        "cards(한 요청에 최대 1000개, 세계관 전체 활성 카드 10,000개까지. id는 새 카드면 호출자가 만든 UUID. title 200자·body 3,000자·classification 50자 이하, aliases·tags는 각 100개 이하(항목당 200자). " +
        "cardType=character|location|organization|ability|object|rule|event|other, areaCode=basic|space|history|society|culture|special|conflict, lifecycle=active|removed, " +
        "visibility=private|public(독자 공개는 revealFromEpisode로 정하고, visibility=public이면서 revealFromEpisode가 없으면 1화부터 공개로 읽는 옛 방식). " +
        "확정 저장(world_studio_save_revision)하려면 활성 카드의 title·body가 비어 있으면 안 됨. " +
        "카드 본문에서 다른 카드를 가리킬 때는 [보이는 글자](card:<카드 UUID>)로 쓰며(글자는 1~200자, 대괄호·줄바꿈 없음) 독자에게 아직 공개되지 않은 카드를 가리키는 링크는 공개 응답에서 글자만 남음)·" +
        "relationships(한 요청에 최대 1000개, 세계관 전체 활성 관계 10,000개까지. id는 새 관계면 호출자가 만든 UUID. label 200자·body 3,000자 이하. sourceCardId·targetCardId는 이 세계관의 서로 다른 카드이며 둘 다 필요(삭제하는 관계는 비워도 됨). " +
        "category=structural|emotional|identity, direction=directed|symmetric, polarity=asserted|denied('그 관계가 아니다'라는 기록). " +
        "관계 source → target 「label」은 'target은 source의 label'로 읽는다(예: source=홍길동, target=홍 판서, label=아버지 → 홍 판서는 홍길동의 아버지). label은 명사형 관계명으로 쓰고 서로 같은 관계(친구·형제)는 direction=symmetric으로 한 번만 쓴다. " +
        "body는 독자에게 보이는 관계 설명이므로 비밀은 쓰지 않고 인물의 characterDocs.episodes에 쓴다. " +
        "identity는 「동일 인물」로 sourceCardId=다른 이름 인물 카드·targetCardId=본체 인물 카드·direction=directed이고 episode 또는 그 관계의 relationshipEpisodes 값이 필요하며(끝내는 identity는 episode) 사슬·순환·한 카드에 본체 둘은 422)·" +
        "episode(선택, 연결된 소설의 회차 순번 1 이상. relationships는 그 회차 시점의 관계이며 바뀐 것만 그 회차에 기록하고 생략하면 최신 회차)·" +
        "relationshipEpisodes(선택, 관계 id → 그 관계의 'N화부터' 1 이상의 정수 JSON 값. 이 요청에서 삭제하지 않는 관계에만 줄 수 있고 모르는 id·삭제 관계·1 미만이거나 정수가 아닌 값(소수·문자열)은 422이며, 준 관계는 episode가 아니라 그 회차에 기록하고 안 준 관계와 삭제는 episode를 따른다)·" +
        "semanticMetadata(카드·관계, 선택, 기본 {})의 최상위 키는 아래만 허용하고 다른 키나 모양이 틀린 값은 422다(detail에 카드/관계 id와 키 이름이 나온다). " +
        "카드: revealFromEpisode(1 이상의 정수. 연결된 소설의 그 회차부터 독자에게 공개, 없으면 작가 전용)·" +
        "characterDocs(cardType=character만. soul·goal·episodes 세 키뿐이며 soul·goal은 문자열, episodes는 \"0\"(이야기 시작 전)·\"1\"… 회차 번호 문자열 → 그 회차의 기억 글. 문서마다 3,000자 이하. 인물의 IDENTITY는 카드 body이고 옛 memory 키는 episodes의 \"0\"으로 옮겨 보낸다)·" +
        "imageId(이 세계관에 올린 카드 이미지의 UUID, null이면 이미지 없음)·importedFrom(가져온 출처 {worldId, worldName, authorNickname, revisionNo, cardId}). " +
        "카드·관계의 studio·preprocessing과 관계의 evidence는 화면·분석·템플릿이 쓰는 값이다: 새 카드·관계에는 넣지 말고, 기존 것을 고칠 때는 world_studio_read로 읽은 값을 고치지 말고 그대로 돌려보낸다(빼면 화면의 시간 표기·순서·관계 종류가 지워진다). 관계의 허용 키는 studio·preprocessing·evidence뿐이다. " +
        "읽은 semanticMetadata에 허용하지 않는 키나 모양이 틀린 값(예: 임의로 넣은 키, 옛 characterDocs.memory)이 있으면 그 키만 빼고 보낸다(422가 카드/관계 id와 키 이름을 알려 준다)."
