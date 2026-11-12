package ai.storyfork.content.work.service

import ai.storyfork.content._common.exception.ContentFailure
import ai.storyfork.content._common.exception.checkContent
import ai.storyfork.content.publication.service.PublicationService
import ai.storyfork.content.work.repository.WorkRepository
import ai.storyfork.content.work.service.dto.WorkWorldLinkResponse
import ai.storyfork.content.world.domain.readerUpto
import ai.storyfork.content.world.service.PublicWorldService
import ai.storyfork.content.world.service.dto.ReaderWorldCardsResponse
import ai.storyfork.content.world.studio.repository.StudioWorldRepository
import java.util.UUID
import org.springframework.beans.factory.annotation.Qualifier
import org.springframework.dao.DataIntegrityViolationException
import org.springframework.stereotype.Service
import org.springframework.transaction.support.TransactionTemplate

/**
 * 세계관(WorldStudio)과 소설의 1:1 연결(DEC-46)과 그 연결로 읽는 독자 설정 위키다. 연결은 `work.world_studio_id`(UNIQUE) 하나에만 저장한다.
 * 작품은 Content, 세계관은 WorldStudio 트랜잭션이라 둘을 겹치지 않고 차례로 연다([ai.storyfork.content.episode.service.EpisodeWorldBasisService]와 같은 방식).
 */
@Service
class WorkWorldService(
    private val access: WorkAccessService, private val works: WorkRepository, private val publication: PublicationService,
    private val studios: StudioWorldRepository, private val publicWorlds: PublicWorldService,
    @Qualifier("contentTransactions") private val transaction: TransactionTemplate,
) {
    /**
     * 요청자 [owner]의 작품에 요청자의 세계관을 연결한다. [worldId]가 null이면 해제한다. 작품이든 세계관이든 없거나 남의 것이면 404다.
     * 그 세계관이 이미 다른 작품에 연결돼 있으면 409 `WORLD_ALREADY_LINKED`이며, 판정은 UNIQUE 제약이 한다(동시 요청도 같은 답이다).
     * 같은 세계관을 다시 연결해도 결과가 같고 작품 revision은 올리지 않는다.
     */
    fun link(workId: String, owner: String, worldId: UUID?): WorkWorldLinkResponse {
        if (worldId != null && studios.findById(worldId).orElse(null)?.ownerSubject?.toString() != owner) throw ContentFailure(404, "세계관을 찾을 수 없어요.")
        try {
            transaction.executeWithoutResult {
                access.own(workId, owner)
                val row = works.findById(workId).orElseThrow()
                row.worldStudioId = worldId
                works.saveAndFlush(row)
            }
        } catch (_: DataIntegrityViolationException) {
            // 이 트랜잭션이 쓰는 값은 world_studio_id 하나라, 제약 위반은 그 세계관을 다른 작품이 쥐고 있다는 뜻이다.
            throw ContentFailure(409, "이미 다른 소설에 연결된 세계관이에요.", "WORLD_ALREADY_LINKED")
        }
        return WorkWorldLinkResponse(workId, worldId)
    }

    /** [worldIds] 가운데 작품에 연결된 세계관과 그 작품 id다. 삭제된 작품은 삭제할 때 연결이 해제돼 나오지 않는다. */
    fun linkedWorkIds(worldIds: Collection<UUID>): Map<UUID, String> =
        if (worldIds.isEmpty()) emptyMap()
        else works.findAllByWorldStudioIdIn(worldIds).mapNotNull { work -> work.worldStudioId?.let { it to work.id } }.toMap()

    /**
     * 공개 소설의 독자에게 [upto]화 기준으로 보이는 연결 세계관의 설정 카드다. 기준은 발행된 마지막 회차를 넘지 못하고 [upto]가 없으면 그 마지막 회차다.
     * 없는(삭제된) 작품은 404, 값 오류는 어떤 조회보다 먼저 422다. 공개가 아닌 작품은 연결 여부도 알리지 않고 빈 목록을, 연결이 없는 작품도 빈 목록을 돌려준다.
     * 발행 회차 번호만 쓰므로 독자용 본문 가공([ai.storyfork.content.work.service.dto.WorkAccessResult.readerEpisodes])은 거치지 않는다.
     */
    fun readerCards(workId: String, upto: String?): ReaderWorldCardsResponse {
        val requested = readerUpto(upto)
        val (worldId, published) = checkNotNull(transaction.execute {
            val work = access.get(workId)
            checkContent(!work.deleted, 404, "작품을 찾을 수 없어요.")
            if (!work.publiclyVisible()) null to 0
            else works.findById(workId).orElseThrow().worldStudioId to (publication.publishedEpisodes(workId).items.maxOfOrNull { it.number } ?: 0)
        })
        val basis = minOf(requested ?: published, published)
        return if (worldId == null) ReaderWorldCardsResponse(workId, null, basis) else publicWorlds.readerCards(workId, worldId, basis)
    }
}
