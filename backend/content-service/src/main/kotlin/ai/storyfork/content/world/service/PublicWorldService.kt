package ai.storyfork.content.world.service

import ai.storyfork.content._common.exception.ContentFailure
import ai.storyfork.content.attachment.client.AttachmentStorageClient
import ai.storyfork.content.attachment.repository.ContentImageRepository
import ai.storyfork.content.auth.service.CoreNicknameService
import ai.storyfork.content.auth.service.WITHDRAWN_MEMBER_NAME
import ai.storyfork.content.publication.service.PublicationService
import ai.storyfork.content.search.service.SearchCandidates
import ai.storyfork.content.work.repository.WorkRepository
import ai.storyfork.content.work.service.WorkAccessService
import ai.storyfork.content.work.service.dto.WorkAccessResult
import ai.storyfork.content.world.domain.WORLD_GENRES
import ai.storyfork.content.world.domain.WorldStudioFailure
import ai.storyfork.content.world.domain.cardImageId
import ai.storyfork.content.world.domain.coverStorage
import ai.storyfork.content.world.domain.isListed
import ai.storyfork.content.world.domain.matchesCard
import ai.storyfork.content.world.domain.matchesWorld
import ai.storyfork.content.world.domain.publicWorldPage
import ai.storyfork.content.world.domain.searchTerm
import ai.storyfork.content.world.domain.shownCardEpisode
import ai.storyfork.content.world.domain.visibleRelationships
import ai.storyfork.content.world.relationship.Neo4jRelationshipRepository
import ai.storyfork.content.world.service.dto.*
import ai.storyfork.content.world.studio.entity.*
import ai.storyfork.content.world.studio.repository.*
import java.util.UUID
import org.springframework.beans.factory.annotation.Qualifier
import org.springframework.data.domain.Page
import org.springframework.data.domain.PageImpl
import org.springframework.data.domain.PageRequest
import org.springframework.data.domain.Pageable
import org.springframework.stereotype.Service
import org.springframework.transaction.PlatformTransactionManager
import org.springframework.transaction.support.TransactionTemplate

/**
 * 공개 세계관의 비로그인 읽기 전용 조회다. 마지막 저장 버전에서 기준 회차 이하로 공개된 카드(삭제되지 않았고 유효 공개 회차가 기준 회차 이하, [shownCardEpisode])와
 * 그 카드끼리의 기준 회차 시점 Neo4j 관계만 보여 주며 비공개·초안뿐인·없는 세계관은 모두 404로 숨긴다. 보일 카드가 하나도 없는 공개 세계관은 카드 없이 그대로 나온다.
 * 기준 회차(DEC-53)는 연결된 소설이 공개 작품이면 발행된 마지막 회차, 공개 작품이 아니면 0, 연결이 없으면 1이다.
 * 상세에는 연결된 소설이 공개 작품일 때만 그 최소 정보를 싣는다(#329).
 * 검색(#505): [list]의 q와 [cards]는 같은 공개 기준으로 전체(색인이 켜져 있으면 [SearchCandidates]의 후보)를 읽어 메모리에서 거르고, 색인 호출은 읽기 트랜잭션 밖이다.
 * PostgreSQL은 읽기 전용 짧은 트랜잭션이고 Neo4j·Core·객체 저장소(표지)·작품(Content 트랜잭션) 호출은 그 밖이다.
 */
@Service
class PublicWorldService(
    private val worlds: StudioWorldRepository, private val revisions: WorldRevisionRepository,
    private val revisionCards: WorldRevisionCardRepository, private val cardVersions: SettingCardVersionRepository, private val images: SettingCardImageRepository,
    private val states: WorldRelationshipStateRepository, private val expandedSeeds: ExpandedSeedProgressRepository, private val graph: Neo4jRelationshipRepository,
    private val nicknames: CoreNicknameService, private val storage: AttachmentStorageClient,
    private val works: WorkRepository, private val workAccess: WorkAccessService, private val workImages: ContentImageRepository, private val publication: PublicationService,
    private val search: SearchCandidates,
    @Qualifier("worldStudioTransactionManager") manager: PlatformTransactionManager,
) {
    private val transaction = TransactionTemplate(manager).apply { isReadOnly = true }
    private fun <T : Any> tx(action: () -> T): T = transaction.execute { action() }
    private fun notFound() = ContentFailure(404, "세계관을 찾을 수 없습니다.")

    /** [cards]는 확정 버전의 모든 카드 버전이다. 보일 카드는 기준 회차를 안 뒤 [shownAt]이 고른다. */
    private class Snapshot(val world: StudioWorld, val revision: WorldRevision, val cards: List<SettingCardVersion>, val state: WorldRelationshipState?)
    /** 기준 회차에 보이는 카드와 그 유효 공개 회차의 쌍이다. */
    private class ReaderSnapshot(val cards: List<Pair<SettingCardVersion, Int>>, val state: WorldRelationshipState?, val revisionId:UUID? = null)
    private class Listing(val page: Page<StudioWorld>, val revisions: Map<UUID, WorldRevision>, val cards: Map<UUID, List<SettingCardVersion>>, val states: Map<UUID, WorldRelationshipState>)
    /** q로 거른 세계관의 한 페이지와, 거르려고 전체 작가를 한 번에 조회한 닉네임이다(페이지 항목이 그대로 쓴다). */
    private class Matched(val page: Page<StudioWorld>, val names: Map<String, String>)

    /**
     * 공개이고 확정된 현재 버전이 있는 세계관만(상세와 같은 기준) 최근 공개순으로 돌려준다. genre가 없거나 비어 있으면 전체다. 값 오류는 422다.
     * [q]가 있으면(앞뒤 공백을 자르며 공백뿐이면 없는 것과 같다) 확정 버전의 이름·설명이나 작가 닉네임에 대소문자 무시로 들어 있는 세계관만 거른 뒤 페이지를 자르고 total도 거른 수다(#505).
     */
    fun list(genre: String?, q: String?, page: String?, size: String?): PublicWorldPageResponse {
        val code = genre?.takeIf { it.isNotBlank() }?.also { if (it !in WORLD_GENRES) throw ContentFailure(422, "genre 값을 확인해 주세요.") }
        val request = publicWorldPage(page, size)
        // q가 있으면 공개 세계관 전체(색인이 켜져 있으면 그 후보)에서 거른 한 페이지다. 페이지의 카드·관계 수는 아래에서 그 한 페이지만 센다. q가 없으면 쿼리가 페이지를 자른다.
        val matched = searchTerm(q)?.let { matchingWorlds(code, it, request) }
        val found = tx {
            val worldPage = matched?.page ?: if (code == null) worlds.listed(request) else worlds.listedByGenre(code, request)
            if (worldPage.content.isEmpty()) Listing(worldPage, emptyMap(), emptyMap(), emptyMap())
            else {
                val revisionIds = worldPage.content.mapNotNull { it.currentRevisionId }
                Listing(worldPage, revisions.findAllById(revisionIds).filter { it.sealed }.associateBy { it.id },
                    revisionCards.cardVersionsOf(revisionIds).groupBy({ it[0] as UUID }, { it[1] as SettingCardVersion }),
                    states.findAllById(worldPage.content.map { it.id }).associateBy { it.worldId })
            }
        }
        // 확정(sealed)되지 않은 현재 버전은 상세처럼 숨긴다(FK는 버전의 존재·소속만 보장한다).
        // ponytail: total은 쿼리 기준이라 이때 items보다 클 수 있다. currentRevisionId는 확정 뒤에만 정해져 지금은 생기지 않으며, 생기면 목록 쿼리에 sealed 조건을 둔다.
        val shown = found.page.content.filter { it.currentRevisionId in found.revisions }
        val names = matched?.names ?: authors(shown.map { it.ownerSubject.toString() }.distinct())
        // 기준 회차는 페이지 전체에 쿼리 둘로 센다. ponytail: Neo4j는 세계관마다 한 번씩 읽는다(한 쪽 최대 100번). 느려지면 한 쿼리로 묶는 배치 조회를 둔다.
        val bases = basisEpisodes(shown.map { it.id })
        val items = shown.map { world ->
            val revision = found.revisions.getValue(requireNotNull(world.currentRevisionId))
            // 카드·관계 수는 상세와 같은 기준 회차의 같은 카드 집합이다(DEC-53).
            val basis = bases.getValue(world.id)
            val cardIds = shownAt(found.cards[revision.id].orEmpty(), basis).map { it.first.cardId }.toSet()
            PublicWorldSummaryResponse(world.id, revision.name, revision.description, world.genre, names.getValue(world.ownerSubject.toString()),
                cardIds.size, currentRelationships(world.id, found.states[world.id], revision.id, cardIds, basis)?.size, world.published(), world.coverObjectKey != null)
        }
        return PublicWorldPageResponse(items, request.pageNumber, request.pageSize, found.page.totalElements)
    }

    /**
     * 공개 세계관(목록과 같은 기준)의 설정 카드 중 **상세와 같은 기준 회차([shownAt])로 독자에게 보이는 카드**에서 제목·별칭·태그(본문 제외)에 [q]가 대소문자 무시로 들어 있는 것을
     * 세계관 최근 공개순 → 카드 제목순으로 돌려준다(#505). [q]가 없거나 공백이면 422다. 색인이 켜져 있으면 그 후보 세계관만 읽고 보이는지 판정은 같다. 작가 닉네임은 쓰지 않아 Core를 부르지 않는다.
     * ponytail: 공개 세계관 전체를 읽어 메모리에서 거른 뒤 자른다(시연 규모). 세계관·카드가 늘면 SQL 조건과 색인으로 옮긴다.
     */
    fun cards(q: String?, page: String?, size: String?): PublicWorldCardSearchResponse {
        val term = searchTerm(q) ?: throw ContentFailure(422, "q 값을 확인해 주세요.")
        val request = publicWorldPage(page, size)
        val candidates = search.cardWorlds(term) // 색인 호출은 읽기 트랜잭션 밖이다
        val listed = tx { listedAll(null, candidates) }
        val shown = shownCards(listed)
        val hits = listed.flatMap { (world, revision) ->
            shown.getValue(world.id).filter { matchesCard(it.fields.title, it.fields.aliases, it.fields.tags, term) }
                .sortedWith(compareBy({ it.fields.title }, { it.cardId.toString() }))
                .map { PublicWorldCardSearchItem(world.id, revision.name, it.cardId, it.fields.title, it.fields.cardType, it.fields.aliases.toList(), it.fields.tags.toList(), cardImageId(it.fields.semanticMetadata)) }
        }
        return PublicWorldCardSearchResponse(hits.drop(request.offset.toInt()).take(request.pageSize), request.pageNumber, request.pageSize, hits.size.toLong())
    }

    /**
     * 검색 색인이 맞출 공개 세계관 전체와 그 세계관의 보이는 카드(상세와 같은 기준 회차)다. 작가 닉네임은 Core에서 한 번에 조회한다.
     * 목록 검색·[cards]와 같은 읽기라 색인에는 검색이 보여 줄 수 있는 것만 들어간다.
     */
    fun searchEntries(): List<PublicWorldSearchEntry> {
        val listed = tx { listedAll(null, null) }
        val names = authors(listed.map { it.first.ownerSubject.toString() }.distinct())
        val shown = shownCards(listed)
        return listed.map { (world, revision) ->
            PublicWorldSearchEntry(world.id, revision.name, revision.description, names.getValue(world.ownerSubject.toString()),
                shown.getValue(world.id).map { PublicWorldSearchCard(it.cardId, it.fields.title, it.fields.aliases.toList(), it.fields.tags.toList()) })
        }
    }

    /**
     * 공개 세계관 전체(색인이 켜져 있으면 그 후보)에서 확정 버전의 이름·설명이나 작가 닉네임에 [term]이 들어 있는 것만 최근 공개순으로 모아 [request] 구간을 자른다. total은 거른 수다.
     * ponytail: 전체를 읽어 메모리에서 거른다(시연 규모, 작가 닉네임 조회도 전체 대상). 세계관이 늘면 SQL 조건과 색인으로 옮긴다.
     */
    private fun matchingWorlds(code: String?, term: String, request: PageRequest): Matched {
        val candidates = search.worlds(term) // 색인 호출은 읽기 트랜잭션 밖이다
        val listed = tx { listedAll(code, candidates) }
        val names = authors(listed.map { it.first.ownerSubject.toString() }.distinct())
        val hits = listed.filter { (world, revision) -> matchesWorld(revision.name, revision.description, names.getValue(world.ownerSubject.toString()), term) }.map { it.first }
        return Matched(PageImpl(hits.drop(request.offset.toInt()).take(request.pageSize), request, hits.size.toLong()), names)
    }

    /**
     * 공개 세계관 전체(장르 [code]가 있으면 그 장르)를 최근 공개순으로, 확정(sealed)된 현재 버전과 함께 돌려준다. 목록 쿼리를 자르지 않고(unpaged) 읽어 공개·삭제 조건이 [list]와 같다.
     * [only]가 있으면(색인이 찾은 후보) 그 세계관만 읽고 같은 조건·순서로 거른다. 읽기 트랜잭션 안에서 부른다.
     */
    private fun listedAll(code: String?, only: Set<UUID>?): List<Pair<StudioWorld, WorldRevision>> {
        val rows = if (only == null) (if (code == null) worlds.listed(Pageable.unpaged()) else worlds.listedByGenre(code, Pageable.unpaged())).content
        else worlds.findAllById(only).filter { it.deletedAt == null && isListed(it.visibility, it.currentRevisionId) && (code == null || it.genre == code) }
            .sortedWith(compareByDescending<StudioWorld> { it.publishedAt }.thenBy { it.id })
        val sealed = revisions.findAllById(rows.mapNotNull { it.currentRevisionId }).filter { it.sealed }.associateBy { it.id }
        return rows.mapNotNull { world -> sealed[world.currentRevisionId]?.let { world to it } }
    }

    /** [listed] 세계관마다 기준 회차(DEC-53)에 보이는 카드다([shownAt], 상세와 같은 함수). 카드는 읽기 트랜잭션에서 한 번에 읽고 기준 회차는 Content 쿼리 둘로 센다(트랜잭션 밖). */
    private fun shownCards(listed: List<Pair<StudioWorld, WorldRevision>>): Map<UUID, List<SettingCardVersion>> {
        if (listed.isEmpty()) return emptyMap()
        val rows = tx { revisionCards.cardVersionsOf(listed.map { it.second.id }) }.groupBy({ it[0] as UUID }, { it[1] as SettingCardVersion })
        val bases = basisEpisodes(listed.map { it.first.id })
        return listed.associate { (world, revision) -> world.id to shownAt(rows[revision.id].orEmpty(), bases.getValue(world.id)).map { it.first } }
    }

    /**
     * 공개 세계관의 마지막 저장 버전에서 기준 회차 이하로 공개된 카드와 그 카드끼리의 기준 회차 시점 관계를 돌려준다(DEC-53). 공개가 아니거나 저장 버전이 없거나 없으면 404다.
     * 이 세계관에 연결된 소설(1:1, DEC-46)은 **공개 작품일 때만** 최소 정보로 싣고, 비공개·제한·삭제 작품이거나 연결이 없으면 null이다(#329).
     */
    fun detail(id: UUID): PublicWorldResponse {
        val seen = tx { snapshot(id) }
        // 연결의 정본은 작품 쪽(Content 트랜잭션)이라 WorldStudio 읽기 트랜잭션을 닫은 뒤 따로 읽는다. 소설 작가명은 세계관 작가와 같은 Core 조회 한 번에 채운다.
        val linked = linkedWork(id)
        val work = linked?.takeIf { it.publiclyVisible() }
        val basis = basisEpisode(linked)
        val cards = shownAt(seen.cards, basis).map { it.first }
        val owner = seen.world.ownerSubject.toString()
        val names = authors(listOfNotNull(owner, work?.ownerId).distinct())
        val relations = currentRelationships(id, seen.state, seen.revision.id, cards.map { it.cardId }.toSet(), basis)
        return PublicWorldResponse(id, seen.revision.name, seen.revision.description, seen.world.genre, names.getValue(owner), seen.world.published(), seen.revision.revisionNo,
            cards.map { PublicWorldCardResponse(it.cardId, it.fields.title, it.fields.body, it.fields.cardType, it.fields.aliases.toList(), it.fields.tags.toList(), cardImageId(it.fields.semanticMetadata)) },
            // 양 끝이 보이는 카드인 관계만 남았으므로 끝점은 비어 있지 않다.
            relations.orEmpty().map(::publicRelationship),
            if (relations == null) "unavailable" else "current", seen.world.coverObjectKey != null,
            work?.let { PublicWorldLinkedWorkResponse(it.id, it.title, names.getValue(it.ownerId), workImages.countByWorkIdAndEpisodeNo(it.id, 0) > 0) })
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
     * 연결된 소설 [workId]의 독자에게 [upto]화 기준으로 보이는 카드와 그 카드끼리의 [upto]화 시점 관계다(DEC-46·51·53). 세계관의 공개 범위와 무관하게
     * 확정된 현재 버전의 카드 중 유효 공개 회차가 [upto] 이하인 것만 고른다. 세계관이 없거나 확정 버전이 없거나 보일 카드가 없으면 빈 목록이고 Neo4j를 읽지 않는다.
     * 작품의 공개 여부와 기준 회차(발행된 회차 안)는 호출자([ai.storyfork.content.work.service.WorkWorldService])가 먼저 정한다.
     */
    fun readerCards(workId: String, worldId: UUID, upto: Int): ReaderWorldCardsResponse {
        val seen = tx { readerSnapshot(worldId, upto) }
        if (seen.cards.isEmpty()) return ReaderWorldCardsResponse(workId, worldId, upto,
            relationshipStatus=if(seen.revisionId!=null && tx { expansionPending(worldId) }) "unavailable" else "current")
        // 독자에게 보이는 기준 회차까지의 관계만 읽는다(카드와 같은 기준이라 관계 스포일러도 막힌다, DEC-51).
        val relations = currentRelationships(worldId, seen.state, requireNotNull(seen.revisionId), seen.cards.map { it.first.cardId }.toSet(), upto)
        return ReaderWorldCardsResponse(workId, worldId, upto,
            seen.cards.map { (card, from) -> ReaderWorldCardResponse(card.cardId, card.fields.title, card.fields.body, card.fields.cardType, card.fields.aliases.toList(), card.fields.tags.toList(), from, cardImageId(card.fields.semanticMetadata)) },
            // 양 끝이 독자에게 보이는 카드인 관계만 남았으므로 끝점은 비어 있지 않다.
            relations.orEmpty().map(::publicRelationship),
            if (relations == null) "unavailable" else "current")
    }

    /**
     * Fork [workId]가 이어받는 원작 세계관 [worldId]의 카드와 관계다(읽기 전용, #365). [readerCards]와 같은 카드 집합(확정된 현재 버전의 카드 중 유효 공개 회차가 [upto] 이하, DEC-53)이고
     * 상한만 Fork 기준 회차다. 관계는 그 카드끼리의 [upto]화 시점(DEC-51) 것만 남긴다.
     * 인물 문서·카드 메타데이터·관계 본문 같은 작가용 값은 싣지 않는다. 방향·부정 여부는 관계의 뜻이라 남긴다. 작품·Fork 여부는 호출자([ai.storyfork.content.work.service.WorkWorldService])가 먼저 정한다.
     */
    fun inheritedWorld(workId: String, worldId: UUID, upto: Int): InheritedWorldResponse {
        val seen = tx { readerSnapshot(worldId, upto) }
        if (seen.cards.isEmpty()) return InheritedWorldResponse(workId, worldId, upto)
        val relations = currentRelationships(worldId, seen.state, requireNotNull(seen.revisionId), seen.cards.map { it.first.cardId }.toSet(), upto)
        return InheritedWorldResponse(workId, worldId, upto,
            seen.cards.map { (card, from) ->
                CardPayload(card.cardId, card.fields.title, card.fields.body, card.fields.cardType, card.fields.areaCode, card.fields.classification,
                    card.fields.aliases.toList(), card.fields.tags.toList(), mapOf("revealFromEpisode" to from), "public", "active")
            },
            relations.orEmpty().map { it.copy(body = "", semanticMetadata = emptyMap()) },
            if (relations == null) "unavailable" else "current", seen.state?.graphVersion ?: 0)
    }

    /**
     * 공개 세계관 [id]의 설정 카드 이미지다(#401). 상세와 같은 기준(공개·확정 버전·기준 회차)이고, 상세에 보이는 카드 중 하나가 [imageId]로 가리키는 이미지일 때만 돌려준다.
     * 그 밖(비공개·확정 버전 없음·기준 회차 뒤나 작가 전용 카드·삭제 카드·초안에만 있는 참조·없는 이미지)은 404다.
     */
    fun cardImage(id: UUID, imageId: UUID): WorldCoverImage {
        val seen = tx { snapshot(id) }
        return pointedImage(id, imageId, shownAt(seen.cards, basisEpisode(linkedWork(id))).map { it.first })
    }

    /**
     * 독자 설정 위키 카드의 이미지다(#401). [readerCards]와 같은 기준([upto]화에 보이는 카드)의 카드 중 하나가 [imageId]로 가리키는 이미지일 때만 돌려주고, 세계관·카드의 공개 범위는 보지 않는다.
     * 작품의 공개 여부와 기준 회차는 호출자([ai.storyfork.content.work.service.WorkWorldService])가 먼저 정한다.
     */
    fun readerCardImage(worldId: UUID, upto: Int, imageId: UUID) = pointedImage(worldId, imageId, tx { readerSnapshot(worldId, upto).cards }.map { it.first })

    /** 보이는 [cards] 중 하나가 가리키는, 이 세계관이 올린 이미지다. 그 밖은 404이고 객체 저장소 실패는 그 상태 그대로다. */
    private fun pointedImage(worldId: UUID, imageId: UUID, cards: List<SettingCardVersion>): WorldCoverImage {
        if (cards.none { cardImageId(it.fields.semanticMetadata) == imageId }) throw notFound()
        val image = tx { images.findById(imageId).orElse(null)?.takeIf { it.worldId == worldId } ?: throw notFound() }
        return WorldCoverImage(coverStorage { storage.read(image.objectKey).bytes }, image.contentType)
    }

    /** [upto]화 기준으로 보이는 카드(유효 공개 회차와 함께)와 관계 상태다. 확정 버전이 없거나 지운 세계관이면 비어 있다. 읽기 트랜잭션 안에서 부른다. */
    private fun readerSnapshot(worldId: UUID, upto: Int): ReaderSnapshot {
        val revision = worlds.findById(worldId).orElse(null)?.takeIf { it.deletedAt == null }?.currentRevisionId?.let { revisions.findByIdAndWorldId(it, worldId) }?.takeIf { it.sealed }
            ?: return ReaderSnapshot(emptyList(), null)
        return ReaderSnapshot(shownAt(cardVersions.findAllById(revisionCards.findAllByIdRevisionId(revision.id).map { it.versionId }), upto)
            .sortedBy { it.first.cardId.toString() }, states.findById(worldId).orElse(null),revision.id)
    }

    /** [cards] 중 기준 회차 [basis]화에 보이는 카드와 그 유효 공개 회차의 쌍이다. 독자 위키·공개 세계관·가져오기·Fork 이어받기가 모두 이 한 곳을 거친다(DEC-53). */
    private fun shownAt(cards: List<SettingCardVersion>, basis: Int) =
        cards.mapNotNull { card -> shownCardEpisode(card.fields.lifecycle, card.fields.visibility, card.fields.semanticMetadata, basis)?.let { card to it } }

    /** 상세와 표지가 같이 쓰는 공개 기준이다: 공개이고 확정(sealed)된 현재 버전이 있는 세계관. 아니면 404다. 읽기 트랜잭션 안에서 부른다. */
    private fun listedWorld(id: UUID): Pair<StudioWorld, WorldRevision> {
        val world = worlds.findById(id).orElse(null)?.takeIf { it.deletedAt == null && isListed(it.visibility, it.currentRevisionId) } ?: throw notFound()
        val revision = revisions.findByIdAndWorldId(world.currentRevisionId ?: throw notFound(), id)?.takeIf { it.sealed } ?: throw notFound()
        return world to revision
    }

    private fun snapshot(id: UUID): Snapshot {
        val (world, revision) = listedWorld(id)
        val versionIds = revisionCards.findAllByIdRevisionId(revision.id).map { it.versionId }
        val cards = cardVersions.findAllById(versionIds).sortedBy { it.cardId.toString() }
        return Snapshot(world, revision, cards, states.findById(id).orElse(null))
    }

    /** Neo4j 관계 중 [episode]화 시점(null이면 최신)의 것으로 양 끝이 [cardIds](보이는 카드)에 있는 것이다. 미전환·미완료·토큰 불일치·조회 실패는 null이며 호출자가 unavailable로 알린다. */
    private fun expansionPending(worldId:UUID)=expandedSeeds.findById(worldId).orElse(null)?.completed==false

    private fun publicRelationship(it:RelationshipPayload)=PublicWorldRelationshipResponse(it.id,it.sourceCardId!!,it.targetCardId!!,
        it.label,it.category,it.body,it.direction,it.polarity)

    private fun currentRelationships(worldId: UUID, state: WorldRelationshipState?, revisionId:UUID, cardIds: Set<UUID>, episode: Int? = null): List<RelationshipPayload>? {
        if (state == null || !state.completed) return null
        val version=state.graphVersion;val key=state.requestKey;val hash=state.requestHash
        if(tx { expansionPending(worldId) }) return null
        return try {
            val stored=graph.read(worldId, episode)
            if(stored.worldId!=worldId || stored.version!=version || stored.key!=key || stored.hash!=hash) return null
            val valid=tx {
                val latest=states.findById(worldId).orElse(null)
                !expansionPending(worldId) && worlds.findById(worldId).orElse(null)?.currentRevisionId==revisionId &&
                    latest!=null && latest.completed && latest.graphVersion==version && latest.requestKey==key && latest.requestHash==hash
            }
            if(valid) visibleRelationships(stored.relationships,cardIds) else null
        } catch (_: WorldStudioFailure) { null }
    }

    /** 세계관 [worldId]에 연결된 소설(`work.world_studio_id`)의 접근 결과다. 연결이 없으면 null이다. 작품은 Content 트랜잭션이라 WorldStudio 읽기 트랜잭션([tx]) 밖에서 부른다. */
    private fun linkedWork(worldId: UUID): WorkAccessResult? =
        works.findAllByWorldStudioIdIn(listOf(worldId)).firstOrNull()?.let { workAccess.get(it.id) }

    /**
     * [worldIds] 각각의 기준 회차를 목록 한 페이지 전체에 쿼리 둘로 센다([basisEpisode]와 같은 값): 연결된 작품 조회 하나와 그 가운데 공개 작품의 발행된 마지막 회차 조회 하나다.
     * 연결된 소설이 공개 작품이면 발행된 마지막 회차(없으면 0), 공개 작품이 아니면 0, 연결이 없으면 1이다. 작품은 Content 트랜잭션이라 WorldStudio 읽기 트랜잭션 밖에서 부른다.
     */
    private fun basisEpisodes(worldIds: List<UUID>): Map<UUID, Int> {
        if (worldIds.isEmpty()) return emptyMap()
        val linked = works.findAllByWorldStudioIdIn(worldIds).associate { checkNotNull(it.worldStudioId) to it.id }
        val published = if (linked.isEmpty()) emptyMap() else works.lastPublishedOfPublicWorks(linked.values.toList()).associate { it[0] as String to (it[1] as Number).toInt() }
        return worldIds.associateWith { world -> linked[world]?.let { published[it] ?: 0 } ?: 1 }
    }

    /**
     * 공개 세계관 하나의 기준 회차(DEC-53)다: 연결된 소설 [linked]가 공개 작품([WorkAccessResult.publiclyVisible])이면 발행된 마지막 회차(없으면 0), 공개 작품이 아니면(비공개·제한·삭제) 0,
     * 연결이 없으면 1이다. 독자 위키의 기준([ai.storyfork.content.work.service.WorkWorldService])과 같은 값이다. 발행을 중단하면 마지막 발행 회차가 내려가 보이던 카드가 다시 숨는다.
     */
    private fun basisEpisode(linked: WorkAccessResult?): Int = when {
        linked == null -> 1
        !linked.publiclyVisible() -> 0
        else -> publication.publishedEpisodes(linked.id).items.maxOfOrNull { it.number } ?: 0
    }

    /** 작가 표시명은 저장하지 않고 Core에서 한 번에 조회한다. Core에 없으면 탈퇴한 회원이고, 호출 실패는 대체 이름 없이 그대로 전파한다. */
    private fun authors(owners: List<String>): Map<String, String> {
        val found = nicknames.nicknames(owners)
        return owners.associateWith { found[it] ?: WITHDRAWN_MEMBER_NAME }
    }

    private fun StudioWorld.published() = requireNotNull(publishedAt) { "공개 세계관에는 공개 시각이 있다." }.toString()
}
