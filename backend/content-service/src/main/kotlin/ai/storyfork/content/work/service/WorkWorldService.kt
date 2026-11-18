package ai.storyfork.content.work.service

import ai.storyfork.content._common.exception.ContentFailure
import ai.storyfork.content._common.exception.checkContent
import ai.storyfork.content.fork.repository.ForkWorldReferenceRepository
import ai.storyfork.content.publication.service.PublicationService
import ai.storyfork.content.work.repository.WorkRepository
import ai.storyfork.content.work.service.dto.WorkWorldLinkResponse
import ai.storyfork.content.world.domain.readerUpto
import ai.storyfork.content.world.service.PublicWorldService
import ai.storyfork.content.world.service.dto.InheritedWorldResponse
import ai.storyfork.content.world.service.dto.ReaderWorldCardsResponse
import ai.storyfork.content.world.service.dto.WorldCoverImage
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
    private val studios: StudioWorldRepository, private val publicWorlds: PublicWorldService, private val references: ForkWorldReferenceRepository,
    @Qualifier("contentTransactions") private val transaction: TransactionTemplate,
) {
    /**
     * 요청자 [owner]의 작품에 요청자의 세계관을 연결한다. [worldId]가 null이면 해제한다. 작품이든 세계관이든 없거나 남의 것이면(지운 세계관 포함) 404다.
     * 그 세계관이 이미 다른 작품에 연결돼 있으면 409 `WORLD_ALREADY_LINKED`이며, 판정은 UNIQUE 제약이 한다(동시 요청도 같은 답이다).
     * 같은 세계관을 다시 연결해도 결과가 같고 작품 revision은 올리지 않는다.
     */
    fun link(workId: String, owner: String, worldId: UUID?): WorkWorldLinkResponse {
        if (worldId != null && studios.findById(worldId).orElse(null)?.takeIf { it.deletedAt == null }?.ownerSubject?.toString() != owner) throw ContentFailure(404, "세계관을 찾을 수 없어요.")
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
        val (worldId, basis) = readerBasis(workId, upto)
        return if (worldId == null) ReaderWorldCardsResponse(workId, null, basis) else publicWorlds.readerCards(workId, worldId, basis)
    }

    /**
     * Fork [workId]가 자기 세계관 없이 이어받는 원작 세계관이다(읽기 전용, DEC-32·37, #365). 요청자 [owner]의 Fork여야 하며 아니면 404, [upto] 값 오류는 어떤 조회보다 먼저 422다.
     * 이어받는 조건은 Fork에 자기 연결 세계관이 없고, 추종(`following`) 중이며, 삭제되지 않은 원작에 세계관이 연결돼 있을 때다. 하나라도 아니면 [InheritedWorldResponse.worldId]가 null이다
     * (자기 세계관이 우선이고 독립한 Fork는 이어받지 않는다). 지식 상한은 Fork 기준 회차이며 [upto]가 더 작으면 그 회차까지다(Fork의 자기 회차 내용은 원작 세계관에 없다).
     * 카드·관계는 [PublicWorldService.inheritedWorld]가 유효 공개 회차·상한 회차로 거른다.
     */
    fun inheritedWorld(workId: String, owner: String, upto: String?): InheritedWorldResponse {
        val requested = readerUpto(upto)
        val (worldId, basis) = checkNotNull(transaction.execute {
            val source = access.own(workId, owner).source?.takeUnless { it.deleted }
            val following = references.findById(workId).orElse(null)?.referenceStatus == "following"
            val inherited = source?.takeIf { following && works.findById(workId).orElseThrow().worldStudioId == null }
            inherited?.let { works.findById(it.workId).orElseThrow().worldStudioId } to (source?.episode ?: 0)
        })
        return if (worldId == null) InheritedWorldResponse(workId, null, 0)
        else publicWorlds.inheritedWorld(workId, worldId, minOf(requested ?: basis, basis))
    }

    /**
     * 독자 설정 위키 카드의 이미지다(#401). [readerCards]와 같은 기준(공개 작품·연결 세계관·기준 회차)으로 보이는 카드 중 하나가 [imageId]로 가리키는 이미지일 때만 돌려주고,
     * 그 밖(공개가 아닌 작품·연결 없음 포함)은 404다. 없는(삭제된) 작품은 404, [upto] 값 오류는 어떤 조회보다 먼저 422다.
     */
    fun readerCardImage(workId: String, imageId: UUID, upto: String?): WorldCoverImage {
        val (worldId, basis) = readerBasis(workId, upto)
        return publicWorlds.readerCardImage(worldId ?: throw ContentFailure(404, "이미지를 찾을 수 없습니다."), basis, imageId)
    }

    /** 독자 설정 위키의 기준이다: 연결된 세계관(공개가 아닌 작품·연결 없음은 null)과 기준 회차(요청 회차, 발행된 마지막 회차를 넘지 못한다). */
    private fun readerBasis(workId: String, upto: String?): Pair<UUID?, Int> {
        val requested = readerUpto(upto)
        val (worldId, published) = checkNotNull(transaction.execute {
            val work = access.get(workId)
            checkContent(!work.deleted, 404, "작품을 찾을 수 없어요.")
            if (!work.publiclyVisible()) null to 0
            else works.findById(workId).orElseThrow().worldStudioId to (publication.publishedEpisodes(workId).items.maxOfOrNull { it.number } ?: 0)
        })
        return worldId to minOf(requested ?: published, published)
    }
}
