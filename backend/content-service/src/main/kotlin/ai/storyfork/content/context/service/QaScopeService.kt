package ai.storyfork.content.context.service

import ai.storyfork.content._common.exception.ContentFailure
import ai.storyfork.content._common.exception.checkContent
import ai.storyfork.content.context.service.dto.QaEpisodeRef
import ai.storyfork.content.context.service.dto.QaScope
import ai.storyfork.content.context.service.dto.QaScopeRequest
import ai.storyfork.content.publication.service.PublicationService
import ai.storyfork.content.work.service.WorkAccessService
import org.springframework.stereotype.Service

/** Story Context / Q&A의 원고 읽기 범위를 확정한다. 원고 Vector 검색도 이 범위를 선필터로 쓴다. */
@Service
class QaScopeService(
    private val access: WorkAccessService,
    private val publication: PublicationService,
) {
    /** [owner]는 Core가 검증한 Principal 이름(회원 UUID)이며 null이면 공개 독자다. */
    fun resolve(workId: String, owner: String?, request: QaScopeRequest): QaScope {
        val basis = request.episode ?: throw ContentFailure(422, "기준 회차를 선택해 주세요.")
        checkContent(basis >= 1, message = "기준 회차를 선택해 주세요.")
        checkContent(request.episodeVersionId.isNotBlank() && request.episodeVersionId.length <= 100, message = "기준 회차 판본을 선택해 주세요.")

        val work = if (owner == null) access.published(workId) else access.own(workId, owner)
        val readable = publication.publishedEpisodes(workId).items
            .filterNot { owner == null && it.inherited && work.source?.deleted == true }
        val chosen = readable.find { it.number == basis } ?: throw ContentFailure(422, "공개된 회차를 기준으로 선택해 주세요.")
        checkContent(chosen.versionId == request.episodeVersionId, 409, "기준 회차 판본이 변경됐어요. 최신 회차를 다시 불러와 주세요.")
        return QaScope(work.id, work.source?.workId, basis, chosen.versionId,
            readable.filter { it.number <= basis }.map { QaEpisodeRef(it.number, it.versionId) })
    }
}
