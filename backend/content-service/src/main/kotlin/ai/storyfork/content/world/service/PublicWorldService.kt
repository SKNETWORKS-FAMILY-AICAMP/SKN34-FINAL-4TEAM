package ai.storyfork.content.world.service

import ai.storyfork.content._common.exception.ContentFailure
import ai.storyfork.content.attachment.client.AttachmentStorageClient
import ai.storyfork.content.auth.service.CoreNicknameService
import ai.storyfork.content.auth.service.WITHDRAWN_MEMBER_NAME
import ai.storyfork.content.world.domain.WORLD_GENRES
import ai.storyfork.content.world.domain.WorldStudioFailure
import ai.storyfork.content.world.domain.cardImageId
import ai.storyfork.content.world.domain.coverStorage
import ai.storyfork.content.world.domain.isListed
import ai.storyfork.content.world.domain.isPublicCard
import ai.storyfork.content.world.domain.publicWorldPage
import ai.storyfork.content.world.domain.readerCardEpisode
import ai.storyfork.content.world.domain.visibleRelationships
import ai.storyfork.content.world.relationship.Neo4jRelationshipRepository
import ai.storyfork.content.world.service.dto.*
import ai.storyfork.content.world.studio.entity.*
import ai.storyfork.content.world.studio.repository.*
import java.util.UUID
import org.springframework.beans.factory.annotation.Qualifier
import org.springframework.data.domain.Page
import org.springframework.stereotype.Service
import org.springframework.transaction.PlatformTransactionManager
import org.springframework.transaction.support.TransactionTemplate

/**
 * 공개 세계관의 비로그인 읽기 전용 조회다. 마지막 저장 버전의 공개 카드(삭제되지 않았고 소유자가 공개로 바꾼 카드, DEC-46)와
 * 그 카드끼리의 Neo4j 현재 관계만 보여 주며 비공개·초안뿐인·없는 세계관은 모두 404로 숨긴다. 공개 카드가 하나도 없는 공개 세계관은 카드 없이 그대로 나온다.
 * PostgreSQL은 읽기 전용 짧은 트랜잭션이고 Neo4j·Core·객체 저장소(표지) 호출은 그 밖이다.
 */
@Service
class PublicWorldService(
    private val worlds: StudioWorldRepository, private val revisions: WorldRevisionRepository,
    private val revisionCards: WorldRevisionCardRepository, private val cardVersions: SettingCardVersionRepository, private val images: SettingCardImageRepository,
    private val states: WorldRelationshipStateRepository, private val graph: Neo4jRelationshipRepository,
    private val nicknames: CoreNicknameService, private val storage: AttachmentStorageClient,
    @Qualifier("worldStudioTransactionManager") manager: PlatformTransactionManager,
) {
    private val transaction = TransactionTemplate(manager).apply { isReadOnly = true }
    private fun <T : Any> tx(action: () -> T): T = transaction.execute { action() }
    private fun notFound() = ContentFailure(404, "세계관을 찾을 수 없습니다.")

    private class Snapshot(val world: StudioWorld, val revision: WorldRevision, val cards: List<SettingCardVersion>, val state: WorldRelationshipState?)
    /** 독자에게 보이는 카드와 그 독자 공개 회차의 쌍이다. */
    private class ReaderSnapshot(val cards: List<Pair<SettingCardVersion, Int>>, val state: WorldRelationshipState?)
    private class Listing(val page: Page<StudioWorld>, val revisions: Map<UUID, WorldRevision>, val cardIds: Map<UUID, List<UUID>>, val states: Map<UUID, WorldRelationshipState>)

    /** 공개이고 확정된 현재 버전이 있는 세계관만(상세와 같은 기준) 최근 공개순으로 돌려준다. genre가 없거나 비어 있으면 전체다. 값 오류는 422다. */
    fun list(genre: String?, page: String?, size: String?): PublicWorldPageResponse {
        val code = genre?.takeIf { it.isNotBlank() }?.also { if (it !in WORLD_GENRES) throw ContentFailure(422, "genre 값을 확인해 주세요.") }
        val request = publicWorldPage(page, size)
        val found = tx {
            val worldPage = if (code == null) worlds.listed(request) else worlds.listedByGenre(code, request)
            if (worldPage.content.isEmpty()) Listing(worldPage, emptyMap(), emptyMap(), emptyMap())
            else {
                val revisionIds = worldPage.content.mapNotNull { it.currentRevisionId }
                Listing(worldPage, revisions.findAllById(revisionIds).filter { it.sealed }.associateBy { it.id },
                    revisionCards.publicCardIds(revisionIds).groupBy({ it[0] as UUID }, { it[1] as UUID }),
                    states.findAllById(worldPage.content.map { it.id }).associateBy { it.worldId })
            }
        }
        // 확정(sealed)되지 않은 현재 버전은 상세처럼 숨긴다(FK는 버전의 존재·소속만 보장한다).
        // ponytail: total은 쿼리 기준이라 이때 items보다 클 수 있다. currentRevisionId는 확정 뒤에만 정해져 지금은 생기지 않으며, 생기면 목록 쿼리에 sealed 조건을 둔다.
        val shown = found.page.content.filter { it.currentRevisionId in found.revisions }
        val names = authors(shown.map { it.ownerSubject }.distinct())
        // ponytail: 세계관마다 Neo4j를 한 번씩 읽는다(한 쪽 최대 100번). 느려지면 한 쿼리로 묶는 배치 조회를 둔다.
        val items = shown.map { world ->
            val revision = found.revisions.getValue(requireNotNull(world.currentRevisionId))
            val cardIds = found.cardIds[revision.id].orEmpty().toSet()
            PublicWorldSummaryResponse(world.id, revision.name, revision.description, world.genre, names.getValue(world.ownerSubject),
                cardIds.size, currentRelationships(world.id, found.states[world.id], cardIds)?.size ?: 0, world.published(), world.coverObjectKey != null)
        }
        return PublicWorldPageResponse(items, request.pageNumber, request.pageSize, found.page.totalElements)
    }

    /** 공개 세계관의 마지막 저장 버전에 있는 공개 카드와 그 카드끼리의 현재 관계를 돌려준다. 공개가 아니거나 저장 버전이 없거나 없으면 404다. */
    fun detail(id: UUID): PublicWorldResponse {
        val seen = tx { snapshot(id) }
        val author = authors(listOf(seen.world.ownerSubject)).getValue(seen.world.ownerSubject)
        val relations = currentRelationships(id, seen.state, seen.cards.map { it.cardId }.toSet())
        return PublicWorldResponse(id, seen.revision.name, seen.revision.description, seen.world.genre, author, seen.world.published(), seen.revision.revisionNo,
            seen.cards.map { PublicWorldCardResponse(it.cardId, it.fields.title, it.fields.body, it.fields.cardType, it.fields.aliases.toList(), it.fields.tags.toList(), cardImageId(it.fields.semanticMetadata)) },
            // 양 끝이 공개 카드인 관계만 남았으므로 끝점은 비어 있지 않다.
            relations.orEmpty().map { PublicWorldRelationshipResponse(it.id, it.sourceCardId!!, it.targetCardId!!, it.label) },
            if (relations == null) "unavailable" else "current", seen.world.coverObjectKey != null)
    }

    /** 공개 세계관의 표지 이미지다. 상세와 같은 기준(공개·확정 버전)이며 비공개·확정 버전 없음·표지 없음·없는 세계관은 404이고, 객체 저장소 실패는 그 상태 그대로다. */
    fun cover(id: UUID): WorldCoverImage {
        val world = tx { listedWorld(id).first }
        val key = world.coverObjectKey
        val type = world.coverContentType
        if (key == null || type == null) throw notFound()
        return WorldCoverImage(coverStorage { storage.read(key).bytes }, type)
    }

    /**
     * 연결된 소설 [workId]의 독자에게 [upto]화 기준으로 보이는 카드와 그 카드끼리의 [upto]화 시점 관계다(DEC-46·51). 세계관·카드의 공개 범위와 무관하게
     * 확정된 현재 버전의 카드 중 독자 공개 회차가 [upto] 이하인 것만 고른다. 세계관이 없거나 확정 버전이 없거나 보일 카드가 없으면 빈 목록이고 Neo4j를 읽지 않는다.
     * 작품의 공개 여부와 기준 회차(발행된 회차 안)는 호출자([ai.storyfork.content.work.service.WorkWorldService])가 먼저 정한다.
     */
    fun readerCards(workId: String, worldId: UUID, upto: Int): ReaderWorldCardsResponse {
        val seen = tx { readerSnapshot(worldId, upto) }
        if (seen.cards.isEmpty()) return ReaderWorldCardsResponse(workId, worldId, upto)
        // 독자에게 보이는 기준 회차까지의 관계만 읽는다(카드와 같은 기준이라 관계 스포일러도 막힌다, DEC-51).
        val relations = currentRelationships(worldId, seen.state, seen.cards.map { it.first.cardId }.toSet(), upto)
        return ReaderWorldCardsResponse(workId, worldId, upto,
            seen.cards.map { (card, from) -> ReaderWorldCardResponse(card.cardId, card.fields.title, card.fields.body, card.fields.cardType, card.fields.aliases.toList(), card.fields.tags.toList(), from, cardImageId(card.fields.semanticMetadata)) },
            // 양 끝이 독자에게 보이는 카드인 관계만 남았으므로 끝점은 비어 있지 않다.
            relations.orEmpty().map { PublicWorldRelationshipResponse(it.id, it.sourceCardId!!, it.targetCardId!!, it.label) },
            if (relations == null) "unavailable" else "current")
    }

    /**
     * Fork [workId]가 이어받는 원작 세계관 [worldId]의 카드와 관계다(읽기 전용, #365). [readerCards]와 같은 기준(확정된 현재 버전의 카드 중 독자 공개 회차가 [upto] 이하)에
     * 공개 카드(`visibility=public`)만 더 고르고, 관계는 그 카드끼리의 [upto]화 시점(DEC-51) 것만 남긴다. 비공개 카드는 독자 공개 회차가 있어도 이어받지 않는다.
     * 인물 문서·카드 메타데이터·관계 본문 같은 작가용 값은 싣지 않는다. 방향·부정 여부는 관계의 뜻이라 남긴다. 작품·Fork 여부는 호출자([ai.storyfork.content.work.service.WorkWorldService])가 먼저 정한다.
     */
    fun inheritedWorld(workId: String, worldId: UUID, upto: Int): InheritedWorldResponse {
        val seen = tx { readerSnapshot(worldId, upto) }
        val cards = seen.cards.filter { (card, _) -> isPublicCard(card.fields.lifecycle, card.fields.visibility) }
        if (cards.isEmpty()) return InheritedWorldResponse(workId, worldId, upto)
        val relations = currentRelationships(worldId, seen.state, cards.map { it.first.cardId }.toSet(), upto)
        return InheritedWorldResponse(workId, worldId, upto,
            cards.map { (card, from) ->
                CardPayload(card.cardId, card.fields.title, card.fields.body, card.fields.cardType, card.fields.areaCode, card.fields.classification,
                    card.fields.aliases.toList(), card.fields.tags.toList(), mapOf("revealFromEpisode" to from), "public", "active")
            },
            relations.orEmpty().map { it.copy(body = "", semanticMetadata = emptyMap()) },
            if (relations == null) "unavailable" else "current", seen.state?.graphVersion ?: 0)
    }

    /**
     * 공개 세계관 [id]의 설정 카드 이미지다(#401). 상세와 같은 기준(공개·확정 버전)이고, 그 확정 버전의 공개·활성 카드 중 하나가 [imageId]로 가리키는 이미지일 때만 돌려준다.
     * 그 밖(비공개·확정 버전 없음·비공개 카드·삭제 카드·초안에만 있는 참조·없는 이미지)은 404다.
     */
    fun cardImage(id: UUID, imageId: UUID) = pointedImage(id, imageId) { snapshot(id).cards }

    /**
     * 독자 설정 위키 카드의 이미지다(#401). [readerCards]와 같은 기준([upto]화에 보이는 카드)의 카드 중 하나가 [imageId]로 가리키는 이미지일 때만 돌려주고, 세계관·카드의 공개 범위는 보지 않는다.
     * 작품의 공개 여부와 기준 회차는 호출자([ai.storyfork.content.work.service.WorkWorldService])가 먼저 정한다.
     */
    fun readerCardImage(worldId: UUID, upto: Int, imageId: UUID) = pointedImage(worldId, imageId) { readerSnapshot(worldId, upto).cards.map { it.first } }

    /** 읽기 트랜잭션 안에서 고른 [cards] 중 하나가 가리키는, 이 세계관이 올린 이미지다. 그 밖은 404이고 객체 저장소 실패는 그 상태 그대로다. */
    private fun pointedImage(worldId: UUID, imageId: UUID, cards: () -> List<SettingCardVersion>): WorldCoverImage {
        val image = tx {
            if (cards().none { cardImageId(it.fields.semanticMetadata) == imageId }) throw notFound()
            images.findById(imageId).orElse(null)?.takeIf { it.worldId == worldId } ?: throw notFound()
        }
        return WorldCoverImage(coverStorage { storage.read(image.objectKey).bytes }, image.contentType)
    }

    /** [upto]화 기준으로 독자에게 보이는 카드(독자 공개 회차와 함께)와 관계 상태다. 확정 버전이 없으면 비어 있다. 읽기 트랜잭션 안에서 부른다. */
    private fun readerSnapshot(worldId: UUID, upto: Int): ReaderSnapshot {
        val revision = worlds.findById(worldId).orElse(null)?.currentRevisionId?.let { revisions.findByIdAndWorldId(it, worldId) }?.takeIf { it.sealed }
            ?: return ReaderSnapshot(emptyList(), null)
        return ReaderSnapshot(cardVersions.findAllById(revisionCards.findAllByIdRevisionId(revision.id).map { it.versionId })
            .mapNotNull { card -> readerCardEpisode(card.fields.lifecycle, card.fields.semanticMetadata, upto)?.let { card to it } }
            .sortedBy { it.first.cardId.toString() }, states.findById(worldId).orElse(null))
    }

    /** 상세와 표지가 같이 쓰는 공개 기준이다: 공개이고 확정(sealed)된 현재 버전이 있는 세계관. 아니면 404다. 읽기 트랜잭션 안에서 부른다. */
    private fun listedWorld(id: UUID): Pair<StudioWorld, WorldRevision> {
        val world = worlds.findById(id).orElse(null)?.takeIf { isListed(it.visibility, it.currentRevisionId) } ?: throw notFound()
        val revision = revisions.findByIdAndWorldId(world.currentRevisionId ?: throw notFound(), id)?.takeIf { it.sealed } ?: throw notFound()
        return world to revision
    }

    private fun snapshot(id: UUID): Snapshot {
        val (world, revision) = listedWorld(id)
        val versionIds = revisionCards.findAllByIdRevisionId(revision.id).map { it.versionId }
        val cards = cardVersions.findAllById(versionIds).filter { isPublicCard(it.fields.lifecycle, it.fields.visibility) }.sortedBy { it.cardId.toString() }
        return Snapshot(world, revision, cards, states.findById(id).orElse(null))
    }

    /** Neo4j 관계 중 [episode]화 시점(null이면 최신)의 것으로 양 끝이 [cardIds](보이는 카드)에 있는 것이다. 미전환·미완료·토큰 불일치·조회 실패는 null이며 호출자가 unavailable로 알린다. */
    private fun currentRelationships(worldId: UUID, state: WorldRelationshipState?, cardIds: Set<UUID>, episode: Int? = null): List<RelationshipPayload>? {
        if (state == null || !state.completed) return null
        return try {
            graph.read(worldId, episode).takeIf { it.worldId == worldId && it.version == state.graphVersion }?.let { visibleRelationships(it.relationships, cardIds) }
        } catch (_: WorldStudioFailure) { null }
    }

    /** 작가 표시명은 저장하지 않고 Core에서 한 번에 조회한다. Core에 없으면 탈퇴한 회원이고, 호출 실패는 대체 이름 없이 그대로 전파한다. */
    private fun authors(owners: List<UUID>): Map<UUID, String> {
        val found = nicknames.nicknames(owners.map { it.toString() })
        return owners.associateWith { found[it.toString()] ?: WITHDRAWN_MEMBER_NAME }
    }

    private fun StudioWorld.published() = requireNotNull(publishedAt) { "공개 세계관에는 공개 시각이 있다." }.toString()
}
