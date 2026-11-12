package ai.storyfork.content.world.service

import ai.storyfork.content._common.exception.ContentFailure
import ai.storyfork.content.attachment.client.AttachmentStorageClient
import ai.storyfork.content.auth.service.CoreNicknameService
import ai.storyfork.content.auth.service.WITHDRAWN_MEMBER_NAME
import ai.storyfork.content.world.domain.WORLD_GENRES
import ai.storyfork.content.world.domain.WorldStudioFailure
import ai.storyfork.content.world.domain.coverStorage
import ai.storyfork.content.world.domain.isListed
import ai.storyfork.content.world.domain.publicWorldPage
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
 * 공개 세계관의 비로그인 읽기 전용 조회다. 마지막 저장 버전의 활성 카드와 Neo4j 현재 관계만 보여 주며
 * 비공개·초안뿐인·없는 세계관은 모두 404로 숨긴다. PostgreSQL은 읽기 전용 짧은 트랜잭션이고 Neo4j·Core·객체 저장소(표지) 호출은 그 밖이다.
 */
@Service
class PublicWorldService(
    private val worlds: StudioWorldRepository, private val revisions: WorldRevisionRepository,
    private val revisionCards: WorldRevisionCardRepository, private val cardVersions: SettingCardVersionRepository,
    private val states: WorldRelationshipStateRepository, private val graph: Neo4jRelationshipRepository,
    private val nicknames: CoreNicknameService, private val storage: AttachmentStorageClient,
    @Qualifier("worldStudioTransactionManager") manager: PlatformTransactionManager,
) {
    private val transaction = TransactionTemplate(manager).apply { isReadOnly = true }
    private fun <T : Any> tx(action: () -> T): T = transaction.execute { action() }
    private fun notFound() = ContentFailure(404, "세계관을 찾을 수 없습니다.")

    private class Snapshot(val world: StudioWorld, val revision: WorldRevision, val cards: List<SettingCardVersion>, val state: WorldRelationshipState?)
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
                    revisionCards.activeCardIds(revisionIds).groupBy({ it[0] as UUID }, { it[1] as UUID }),
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

    /** 공개 세계관의 마지막 저장 버전 카드와 현재 관계를 돌려준다. 공개가 아니거나 저장 버전이 없거나 없으면 404다. */
    fun detail(id: UUID): PublicWorldResponse {
        val seen = tx { snapshot(id) }
        val author = authors(listOf(seen.world.ownerSubject)).getValue(seen.world.ownerSubject)
        val relations = currentRelationships(id, seen.state, seen.cards.map { it.cardId }.toSet())
        return PublicWorldResponse(id, seen.revision.name, seen.revision.description, seen.world.genre, author, seen.world.published(), seen.revision.revisionNo,
            seen.cards.map { PublicWorldCardResponse(it.cardId, it.fields.title, it.fields.body, it.fields.cardType, it.fields.aliases.toList(), it.fields.tags.toList()) },
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

    /** 상세와 표지가 같이 쓰는 공개 기준이다: 공개이고 확정(sealed)된 현재 버전이 있는 세계관. 아니면 404다. 읽기 트랜잭션 안에서 부른다. */
    private fun listedWorld(id: UUID): Pair<StudioWorld, WorldRevision> {
        val world = worlds.findById(id).orElse(null)?.takeIf { isListed(it.visibility, it.currentRevisionId) } ?: throw notFound()
        val revision = revisions.findByIdAndWorldId(world.currentRevisionId ?: throw notFound(), id)?.takeIf { it.sealed } ?: throw notFound()
        return world to revision
    }

    private fun snapshot(id: UUID): Snapshot {
        val (world, revision) = listedWorld(id)
        val versionIds = revisionCards.findAllByIdRevisionId(revision.id).map { it.versionId }
        val cards = cardVersions.findAllById(versionIds).filter { it.fields.lifecycle == "active" }.sortedBy { it.cardId.toString() }
        return Snapshot(world, revision, cards, states.findById(id).orElse(null))
    }

    /** Neo4j 현재 관계 중 양 끝이 공개 카드인 것이다. 미전환·미완료·토큰 불일치·조회 실패는 null이며 호출자가 unavailable로 알린다. */
    private fun currentRelationships(worldId: UUID, state: WorldRelationshipState?, cardIds: Set<UUID>): List<RelationshipPayload>? {
        if (state == null || !state.completed) return null
        return try {
            graph.read(worldId).takeIf { it.worldId == worldId && it.version == state.graphVersion }?.let { visibleRelationships(it.relationships, cardIds) }
        } catch (_: WorldStudioFailure) { null }
    }

    /** 작가 표시명은 저장하지 않고 Core에서 한 번에 조회한다. Core에 없으면 탈퇴한 회원이고, 호출 실패는 대체 이름 없이 그대로 전파한다. */
    private fun authors(owners: List<UUID>): Map<UUID, String> {
        val found = nicknames.nicknames(owners.map { it.toString() })
        return owners.associateWith { found[it.toString()] ?: WITHDRAWN_MEMBER_NAME }
    }

    private fun StudioWorld.published() = requireNotNull(publishedAt) { "공개 세계관에는 공개 시각이 있다." }.toString()
}
