package ai.storyfork.content.context.service

import ai.storyfork.content._common.exception.ContentFailure
import ai.storyfork.content._common.exception.checkContent
import ai.storyfork.content.context.service.dto.QaEpisodeRef
import ai.storyfork.content.context.service.dto.QaScope
import ai.storyfork.content.context.service.dto.QaScopeRequest
import ai.storyfork.content.context.service.dto.QaWorldRef
import ai.storyfork.content.episode.repository.EpisodeRepository
import ai.storyfork.content.publication.service.PublicationService
import ai.storyfork.content.work.service.WorkAccessService
import ai.storyfork.content.world.domain.WorldNotFound
import ai.storyfork.content.world.domain.WorldStudioFailure
import ai.storyfork.content.world.service.WorldStudioService
import java.util.UUID
import org.springframework.stereotype.Service

/** Story Context / Q&A의 읽기 범위를 확정한다. 이후 원고 Vector 검색도 이 범위를 선필터로 쓴다. */
@Service
class QaScopeService(
    private val access: WorkAccessService,
    private val publication: PublicationService,
    private val episodes: EpisodeRepository,
    private val worlds: WorldStudioService,
) {
    /** [owner]는 Core가 검증한 Principal 이름(회원 UUID)이며 null이면 공개 독자다. */
    fun resolve(workId: String, owner: String?, request: QaScopeRequest): QaScope {
        val basis = request.episode ?: throw ContentFailure(422, "기준 회차를 선택해 주세요.")
        checkContent(basis >= 1, message = "기준 회차를 선택해 주세요.")
        checkContent(request.target == "manuscript" || request.target == "relationship", message = "질문 대상을 확인해 주세요.")
        checkContent(request.episodeVersionId.isNotBlank() && request.episodeVersionId.length <= 100, message = "기준 회차 판본을 선택해 주세요.")
        val relationship = request.target == "relationship"
        // 관계는 Neo4j 현재 상태 하나만 정본이다(#132). 회차 시점 관계를 현재 그래프로 추측하지 않는다.
        if (relationship && request.relationshipAt != "current") throw failure(WorldStudioFailure.history())

        val work = if (owner == null) access.published(workId) else access.own(workId, owner)
        val readable = publication.publishedEpisodes(workId).items
            .filterNot { owner == null && it.inherited && work.source?.deleted == true }
        val chosen = readable.find { it.number == basis } ?: throw ContentFailure(422, "공개된 회차를 기준으로 선택해 주세요.")
        checkContent(chosen.versionId == request.episodeVersionId, 409, "기준 회차 판본이 변경됐어요. 최신 회차를 다시 불러와 주세요.")
        return QaScope(work.id, work.source?.workId, basis, chosen.versionId,
            readable.filter { it.number <= basis }.map { QaEpisodeRef(it.number, it.versionId) },
            if (relationship) linkedWorld(workId, owner, basis) else null)
    }

    private fun linkedWorld(workId: String, owner: String?, basis: Int): QaWorldRef {
        // shortcut: 독자용 세계관 관계 공개 범위가 정해지지 않아 작가만 허용한다. 회차별 관계 공개 정책이 확정되면 확장.
        checkContent(owner != null, 403, "세계관 관계 질문은 아직 작가만 사용할 수 있어요.")
        val worldId = episodes.findByWorkIdAndSequence(workId, basis)?.basisWorldId
            ?: throw ContentFailure(422, "기준 회차에 연결된 세계관이 없어 관계를 확인할 수 없어요.", "WORLD_LINK_REQUIRED")
        val draft = try { worlds.draft(worldId, UUID.fromString(owner)) }
            catch (_: WorldNotFound) { throw ContentFailure(404, "연결된 세계관을 찾을 수 없어요.") }
            catch (error: WorldStudioFailure) { throw failure(error) }
        return QaWorldRef(worldId, draft.relationshipVersion)
    }

    /** WorldStudio 전용 오류를 같은 code·상태로 Content 공개 오류 형식에 옮긴다. */
    private fun failure(error: WorldStudioFailure) = ContentFailure(when (error.reason) {
        WorldStudioFailure.Reason.INCOMPLETE, WorldStudioFailure.Reason.UNAVAILABLE -> 503
        else -> 409
    }, error.detail, error.code)
}
