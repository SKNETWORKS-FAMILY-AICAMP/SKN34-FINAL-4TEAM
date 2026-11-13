package ai.storyfork.content.mcp

import ai.storyfork.content.context.service.ContextService
import ai.storyfork.content.context.service.dto.ContextRequest
import ai.storyfork.content.context.service.dto.StoryContextResponse
import ai.storyfork.content.episode.service.dto.DraftResponse
import ai.storyfork.content.fork.service.ForkService
import ai.storyfork.content.fork.service.dto.ChangeRequest
import ai.storyfork.content.fork.service.dto.ForkRequest
import ai.storyfork.content.notice.service.WorkNoticeService
import ai.storyfork.content.notice.service.dto.WorkNoticeListResponse
import ai.storyfork.content.notice.service.dto.WorkNoticeRequest
import ai.storyfork.content.notice.service.dto.WorkNoticeResponse
import ai.storyfork.content.proposal.service.ProposalService
import ai.storyfork.content.proposal.service.dto.AcceptProposalRequest
import ai.storyfork.content.proposal.service.dto.ProposalRequest
import ai.storyfork.content.proposal.service.dto.ProposalResponse
import ai.storyfork.content.work.service.WorkService
import ai.storyfork.content.work.service.WorkWorldService
import ai.storyfork.content.work.service.dto.CreateWorkRequest
import ai.storyfork.content.work.service.dto.HistoryResponse
import ai.storyfork.content.work.service.dto.PolicyRequest
import ai.storyfork.content.work.service.dto.UpdateWorkRequest
import ai.storyfork.content.work.service.dto.WorkListResponse
import ai.storyfork.content.work.service.dto.WorkRankingResponse
import ai.storyfork.content.work.service.dto.WorkResponse
import ai.storyfork.content.work.service.dto.WorkWorldLinkResponse
import ai.storyfork.content.world.service.dto.ReaderWorldCardsResponse
import ai.storyfork.content.world.service.dto.WorldResponse
import io.modelcontextprotocol.common.McpTransportContext
import java.util.UUID
import org.springframework.ai.mcp.annotation.McpTool
import org.springframework.ai.mcp.annotation.McpToolParam
import org.springframework.stereotype.Component

/**
 * 작품·소식·Fork·문맥·AI 제안 도구다. 기존 Service 함수를 그대로 호출하는 어댑터이며 새 규칙·인가를 두지 않는다. 계약: docs/design/content-mcp-contract.md
 * 형식: 공개 도구는 [mcpTool]만 감싸고, 사용자 도구는 `context: McpTransportContext`를 받아 `context.requireCaller()`로만 회원을 얻는다.
 * 컨트롤러에 `@Valid`가 있는 입력 DTO는 `.validated()`로 같은 제약을 검사한다. 작품 계획(`story_plan_*`)은 [StoryPlanMcpTools]다.
 */
@Component
class WorkMcpTools(
    private val service: WorkService,
    private val worldLinks: WorkWorldService,
    private val notices: WorkNoticeService,
    private val forks: ForkService,
    private val contexts: ContextService,
    private val proposals: ProposalService,
) {
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

    @McpTool(
        name = "work_list_mine",
        description = "내 작품 목록(GET /api/v1/works). 인증한 사용자가 소유한 삭제되지 않은 작품(원작·Fork)을 최신 생성순으로 돌려준다.",
        annotations = McpTool.McpAnnotations(readOnlyHint = true),
    )
    fun listMine(context: McpTransportContext): WorkListResponse = mcpTool { service.list(context.requireCaller().memberId) }

    @McpTool(
        name = "work_create",
        description = "비공개 작품 생성(POST /api/v1/works). 인증한 사용자 소유로 만들며 세계관·1회차 초안도 함께 만든다. 입력 오류는 422다.",
    )
    fun create(
        context: McpTransportContext,
        @McpToolParam(description = "작품 생성 입력(title 필수·120자 이하, summary 2000자 이하, 선택: creationType·genres·hashtags·rightsConfirmed)") data: CreateWorkRequest,
    ): WorkResponse = mcpTool { service.create(context.requireCaller().memberId, data.validated()) }

    @McpTool(
        name = "work_read",
        description = "내 작품 상세(GET /api/v1/works/{id}). 소유자만 읽을 수 있고 없거나 남의 작품은 404다.",
        annotations = McpTool.McpAnnotations(readOnlyHint = true),
    )
    fun read(context: McpTransportContext, @McpToolParam(description = "작품 ID") id: String): WorkResponse =
        mcpTool { service.read(id, context.requireCaller().memberId) }

    @McpTool(
        name = "work_update",
        description = "작품 제목·소개(와 선택으로 장르·해시태그) 수정(PUT /api/v1/works/{id}). 소유자만 가능하며 revision이 다르면 409, 입력 오류는 422다.",
    )
    fun update(
        context: McpTransportContext,
        @McpToolParam(description = "작품 ID") id: String,
        @McpToolParam(description = "작품 수정 입력(title 필수·120자 이하, summary 2000자 이하, revision 필수: 읽은 작품의 revision, 선택: genres·hashtags — 생략하면 기존 값 유지)") data: UpdateWorkRequest,
    ): WorkResponse = mcpTool { service.update(id, context.requireCaller().memberId, data.validated()) }

    @McpTool(
        name = "work_delete",
        description = "작품 삭제(DELETE /api/v1/works/{id}). 소프트 삭제이며 원작·Fork 모두 소유자만 가능하다. 없거나 남의 작품은 404다. 확인 없이 즉시 반영된다.",
    )
    fun delete(context: McpTransportContext, @McpToolParam(description = "작품 ID") id: String) =
        mcpTool { service.delete(id, context.requireCaller().memberId) }

    @McpTool(
        name = "work_stop_fork_publication",
        description = "Fork 작품 공개 중단(DELETE /api/v1/works/{id}/fork-publication). Fork 소유자만 가능하며 발행된 회차·기록은 보존하고 대기 중인 예약 발행은 취소한다. Fork가 아니면 404다.",
    )
    fun stopForkPublication(context: McpTransportContext, @McpToolParam(description = "Fork 작품 ID") id: String) =
        mcpTool { service.stopForkPublication(id, context.requireCaller().memberId) }

    @McpTool(
        name = "work_history",
        description = "작품 이력(GET /api/v1/works/{id}/history). 저장 버전·AI 제안·분기 정책·발행 이력을 한 번에 돌려준다. 소유자만 가능하다.",
        annotations = McpTool.McpAnnotations(readOnlyHint = true),
    )
    fun history(context: McpTransportContext, @McpToolParam(description = "작품 ID") id: String): HistoryResponse =
        mcpTool { service.history(id, context.requireCaller().memberId) }

    @McpTool(
        name = "work_update_policy",
        description = "원작의 분기(Fork) 허용 정책 변경(PUT /api/v1/works/{id}/policy). 소유자만 가능하며 Fork 작품은 403, revision이 다르면 409, 입력 오류는 422다.",
    )
    fun updatePolicy(
        context: McpTransportContext,
        @McpToolParam(description = "작품 ID") id: String,
        @McpToolParam(description = "정책 입력(revision·allowFork·allowForkPublication 필수, 선택: episodeScope all|from|selected·fromEpisode·episodes)") data: PolicyRequest,
    ): WorkResponse = mcpTool { service.policy(id, context.requireCaller().memberId, data.validated()) }

    @McpTool(
        name = "work_public_ranking",
        description = "최근 24시간 조회 기준 실시간 인기(top)·급상승(rising) 공개 작품 최대 10개(GET /api/v1/public/works/ranking). 인증이 필요 없고 잘못된 kind는 422다.",
        annotations = McpTool.McpAnnotations(readOnlyHint = true),
    )
    fun publicRanking(@McpToolParam(description = "랭킹 종류: top|rising") kind: String): WorkListResponse = mcpTool { service.ranking(kind) }

    @McpTool(
        name = "work_public_rankings",
        description = "기간·종류·범위별 공개 작품 랭킹과 계산 시각(GET /api/v1/public/works/rankings). 인증이 필요 없고 kind는 필수이며 잘못된 값은 422다.",
        annotations = McpTool.McpAnnotations(readOnlyHint = true),
    )
    fun publicRankings(
        @McpToolParam(description = "랭킹 종류: view|rising|popular|latest|updated") kind: String,
        @McpToolParam(description = "기간: day|week|month (기본 day)", required = false) period: String?,
        @McpToolParam(description = "범위: all|original|fork (기본 all)", required = false) type: String?,
        @McpToolParam(description = "최대 개수(1~50, 기본 10)", required = false) limit: String?,
    ): WorkRankingResponse = mcpTool { service.rankings(kind, period, type, limit) }

    @McpTool(
        name = "work_public_read",
        description = "공개 작품 상세(GET /api/v1/public/works/{id}). 인증 없이 읽을 수 있고 Bearer가 있으면 그 회원의 좋아요 여부(liked)도 채운다. 비공개·없는 작품은 404다.",
        annotations = McpTool.McpAnnotations(readOnlyHint = true),
    )
    fun publicRead(context: McpTransportContext, @McpToolParam(description = "작품 ID") id: String): WorkResponse =
        mcpTool { service.publicRead(id, context.callerOrNull()?.memberId) }

    @McpTool(
        name = "work_link_world_studio",
        description = "작품에 WorldStudio 세계관 연결·해제(PUT /api/v1/works/{id}/world-studio). 작품과 세계관 모두 본인 소유여야 하며 아니면 404, 이미 다른 작품에 연결된 세계관이면 409 WORLD_ALREADY_LINKED다.",
    )
    fun linkWorldStudio(
        context: McpTransportContext,
        @McpToolParam(description = "작품 ID") id: String,
        @McpToolParam(description = "연결할 세계관(WorldStudio) UUID. 생략하면 연결을 해제한다", required = false) worldId: String?,
    ): WorkWorldLinkResponse = mcpTool { worldLinks.link(id, context.requireCaller().memberId, uuidOrNull(worldId)) }

    @McpTool(
        name = "work_public_world_cards",
        description = "공개 작품의 독자 설정 위키(GET /api/v1/public/works/{id}/world-cards). 인증이 필요 없다. 독자 공개 회차가 upto 이하인 카드와 그 카드끼리의 현재 관계만 돌려주고, 없는 작품은 404, upto 값 오류는 422다.",
        annotations = McpTool.McpAnnotations(readOnlyHint = true),
    )
    fun publicWorldCards(
        @McpToolParam(description = "작품 ID") id: String,
        @McpToolParam(description = "이 회차까지 독자에게 공개된 카드만(1 이상, 생략하면 마지막 발행 회차)", required = false) upto: String?,
    ): ReaderWorldCardsResponse = mcpTool { worldLinks.readerCards(id, upto) }

    @McpTool(
        name = "work_notice_public_list",
        description = "공개 작품의 소식 목록(GET /api/v1/public/works/{id}/notices). 인증이 필요 없다. 고정 먼저, 그 안에서 최신순이며 비공개·없는 작품은 404다.",
        annotations = McpTool.McpAnnotations(readOnlyHint = true),
    )
    fun noticePublicList(@McpToolParam(description = "작품 ID") id: String): WorkNoticeListResponse = mcpTool { notices.list(id) }

    @McpTool(
        name = "work_notice_create",
        description = "작품 소식 작성(POST /api/v1/works/{id}/notices). 작품 소유자와 운영자만 가능하며 그 밖은 403, 입력 오류는 422, 없는 작품은 404다.",
    )
    fun noticeCreate(
        context: McpTransportContext,
        @McpToolParam(description = "작품 ID") id: String,
        @McpToolParam(description = NOTICE_INPUT) data: WorkNoticeRequest,
    ): WorkNoticeResponse = mcpTool {
        val caller = context.requireCaller()
        notices.create(id, caller.memberId, caller.operator, data)
    }

    @McpTool(
        name = "work_notice_update",
        description = "작품 소식 전체 수정(PUT /api/v1/works/{id}/notices/{noticeId}). 고정 설정·해제도 포함한다. 소유자·운영자만 가능하며 다른 작품의 소식이거나 삭제됐으면 404다.",
    )
    fun noticeUpdate(
        context: McpTransportContext,
        @McpToolParam(description = "작품 ID") id: String,
        @McpToolParam(description = "소식 ID") noticeId: String,
        @McpToolParam(description = NOTICE_INPUT) data: WorkNoticeRequest,
    ): WorkNoticeResponse = mcpTool {
        val caller = context.requireCaller()
        notices.update(id, noticeId, caller.memberId, caller.operator, data)
    }

    @McpTool(
        name = "work_notice_delete",
        description = "작품 소식 삭제(DELETE /api/v1/works/{id}/notices/{noticeId}). 소프트 삭제이며 소유자·운영자만 가능하다. 다른 작품의 소식이거나 이미 삭제됐으면 404다.",
    )
    fun noticeDelete(
        context: McpTransportContext,
        @McpToolParam(description = "작품 ID") id: String,
        @McpToolParam(description = "소식 ID") noticeId: String,
    ) = mcpTool {
        val caller = context.requireCaller()
        notices.delete(id, noticeId, caller.memberId, caller.operator)
    }

    @McpTool(
        name = "work_fork_create",
        description = "공개 원작에서 Fork 작품 생성(POST /api/v1/works/{id}/forks). 기준 회차를 보존하며 정책 위반은 403, 이미 만든 Fork가 있으면 409, 입력 오류는 422다.",
    )
    fun forkCreate(
        context: McpTransportContext,
        @McpToolParam(description = "원작 ID") id: String,
        @McpToolParam(description = "Fork 입력(episode: 기준 회차 1 이상, title 필수·120자 이하, summary·direction 2000자 이하)") data: ForkRequest,
    ): WorkResponse = mcpTool { forks.create(id, context.requireCaller().memberId, data.validated()) }

    @McpTool(
        name = "work_fork_world_change",
        description = "Fork의 원본 변경 적용·거절 기록(POST /api/v1/works/{id}/world/changes). Fork 소유자만 가능하며 기준이 바뀌었거나 이미 적용한 변경은 409다. 갱신된 세계관을 돌려준다.",
    )
    fun forkWorldChange(
        context: McpTransportContext,
        @McpToolParam(description = "Fork 작품 ID") id: String,
        @McpToolParam(description = "변경 선택 입력(revision: 읽은 세계관의 revision, changeId, decision: apply|reject)") data: ChangeRequest,
    ): WorldResponse = mcpTool { forks.decideChange(id, context.requireCaller().memberId, data.validated()) }

    @McpTool(
        name = "work_context_read",
        description = "작성자용 허용 문맥(GET /api/v1/works/{id}/context). 소유자만 읽을 수 있고 기준 회차(episode)까지 허용된 설정·원문 발췌를 돌려주며 범위·문맥 한도 오류는 422다.",
        annotations = McpTool.McpAnnotations(readOnlyHint = true),
    )
    fun contextRead(
        context: McpTransportContext,
        @McpToolParam(description = "작품 ID") id: String,
        @McpToolParam(description = "기준 회차(1 이상)") episode: Int,
        @McpToolParam(description = "원문 발췌를 고를 검색어", required = false) query: String?,
        @McpToolParam(description = "인물 시점으로 좁힐 인물 이름. 생략하면 전체 문맥", required = false) character: String?,
    ): StoryContextResponse = mcpTool { contexts.read(id, context.requireCaller().memberId, contextRequest(episode, query, character)) }

    @McpTool(
        name = "work_context_public_read",
        description = "독자용 허용 문맥(GET /api/v1/public/works/{id}/context). 인증이 필요 없고 발행된 범위의 허용 문맥만 돌려준다. 비공개 작품은 404, 잘못된 범위는 422다.",
        annotations = McpTool.McpAnnotations(readOnlyHint = true),
    )
    fun contextPublicRead(
        @McpToolParam(description = "작품 ID") id: String,
        @McpToolParam(description = "기준 회차(1 이상, 발행된 회차)") episode: Int,
        @McpToolParam(description = "원문 발췌를 고를 검색어", required = false) query: String?,
        @McpToolParam(description = "인물 시점으로 좁힐 인물 이름. 생략하면 전체 문맥", required = false) character: String?,
    ): StoryContextResponse = mcpTool { contexts.read(id, null, contextRequest(episode, query, character)) }

    @McpTool(
        name = "work_proposal_create",
        description = "AI 제안 생성(POST /api/v1/works/{id}/proposals). 소유자만 가능하고 OpenAI 전송·비용 동의(consent)가 필요하며 원고는 바꾸지 않는다. 기준 충돌은 409, 외부 AI 장애는 503이다.",
    )
    fun proposalCreate(
        context: McpTransportContext,
        @McpToolParam(description = "작품 ID") id: String,
        @McpToolParam(description = "제안 입력(revision: 읽은 작품의 revision, prompt 필수·2000자 이하, consent: true 필요, 선택: episode·character)") data: ProposalRequest,
    ): ProposalResponse = mcpTool { proposals.propose(id, context.requireCaller().memberId, data.validated()) }

    @McpTool(
        name = "work_proposal_accept",
        description = "AI 제안을 원고에 반영(POST /api/v1/works/{id}/proposals/{pid}/accept). 소유자만 가능하며 새 버전으로 저장하고 갱신된 초안을 돌려준다. 만료·중복·문맥 충돌은 409다.",
    )
    fun proposalAccept(
        context: McpTransportContext,
        @McpToolParam(description = "작품 ID") id: String,
        @McpToolParam(description = "제안 ID") proposalId: String,
        @McpToolParam(description = "반영 입력(revision: 제안 응답의 revision. 현재 작품 revision과 같아야 한다)") data: AcceptProposalRequest,
    ): DraftResponse = mcpTool { proposals.accept(id, proposalId, context.requireCaller().memberId, data.validated().revision) }

    /** 컨트롤러의 `@Valid @ModelAttribute`와 같다. 선택 인자의 기본값은 빈 문자열이다. */
    private fun contextRequest(episode: Int, query: String?, character: String?) = ContextRequest(episode, query.orEmpty(), character.orEmpty()).validated()

    /** 컨트롤러가 JSON 본문에서 UUID를 읽지 못하면 내리는 400과 같다. 입력 값은 되돌려 주지 않는다. */
    private fun uuidOrNull(value: String?): UUID? =
        try {
            value?.let(UUID::fromString)
        } catch (_: IllegalArgumentException) {
            throw McpToolFailure(400, null, "요청 형식과 필수 항목을 확인해 주세요.")
        }
}

private const val NOTICE_INPUT = "소식 입력(category: info|hiatus|event, title 1~200자, body 1~20,000자, pinned: 상단 고정 여부)"
