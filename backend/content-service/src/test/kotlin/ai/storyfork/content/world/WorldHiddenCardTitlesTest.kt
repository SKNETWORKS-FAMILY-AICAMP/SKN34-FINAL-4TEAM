package ai.storyfork.content.world

import ai.storyfork.content.attachment.client.AttachmentStorageClient
import ai.storyfork.content.attachment.repository.ContentImageRepository
import ai.storyfork.content.auth.service.CoreNicknameService
import ai.storyfork.content.publication.service.PublicationService
import ai.storyfork.content.search.service.SearchCandidates
import ai.storyfork.content.work.repository.WorkRepository
import ai.storyfork.content.work.service.WorkAccessService
import ai.storyfork.content.world.relationship.Neo4jRelationshipRepository
import ai.storyfork.content.world.service.PublicWorldService
import ai.storyfork.content.world.studio.entity.*
import ai.storyfork.content.world.studio.repository.*
import java.time.Instant
import java.util.Optional
import java.util.UUID
import org.junit.jupiter.api.Assertions.*
import org.junit.jupiter.api.Test
import org.mockito.ArgumentMatchers.any
import org.mockito.Mockito.*
import org.springframework.transaction.PlatformTransactionManager
import org.springframework.transaction.support.SimpleTransactionStatus

/**
 * 운영 누설 비교 기준(DEC-55)인 '기준 회차에 독자에게 안 보이는 카드 제목'을 확인한다. 보이는 쪽의 정본은 DEC-53 [ai.storyfork.content.world.domain.shownCardEpisode] 하나이므로,
 * 안 보이는 쪽은 Fork 이어받기 출구(같은 함수)가 돌려주는 카드의 여집합과 같아야 한다. 저장소는 대역이고 실제 쿼리는 CI 통합 테스트가 확인한다.
 */
class WorldHiddenCardTitlesTest {
    private val worlds = mock(StudioWorldRepository::class.java)
    private val revisions = mock(WorldRevisionRepository::class.java)
    private val revisionCards = mock(WorldRevisionCardRepository::class.java)
    private val cardVersions = mock(SettingCardVersionRepository::class.java)
    private val states = mock(WorldRelationshipStateRepository::class.java)
    private val manager = mock(PlatformTransactionManager::class.java).also {
        `when`(it.getTransaction(any())).thenAnswer { SimpleTransactionStatus() }
    }
    private val service = PublicWorldService(worlds, revisions, revisionCards, cardVersions, mock(SettingCardImageRepository::class.java), states, mock(ExpandedSeedProgressRepository::class.java),
        mock(Neo4jRelationshipRepository::class.java), mock(CoreNicknameService::class.java), mock(AttachmentStorageClient::class.java), mock(WorkRepository::class.java),
        mock(WorkAccessService::class.java), mock(ContentImageRepository::class.java), mock(PublicationService::class.java), SearchCandidates(null), manager)

    private val worldId = UUID.randomUUID()
    private val revisionId = UUID.randomUUID()

    private fun card(title: String, visibility: String = "private", metadata: Map<String, Any?> = emptyMap(), lifecycle: String = "active") =
        SettingCardVersion(cardId = UUID.randomUUID(), worldId = worldId, versionNo = 1, fields = CardFields(title = title, visibility = visibility, semanticMetadata = metadata, lifecycle = lifecycle))

    /** 공개 범위 조합 전부: 회차 없는 공개(1화부터)·3화 공개·5화 공개·작가 전용·깨진 공개 회차(null·문자열)·삭제 카드다. */
    private val cards = listOf(
        card("옛 공개", "public"),
        card("3화 공개", "private", mapOf("revealFromEpisode" to 3)),
        card("5화 공개", "public", mapOf("revealFromEpisode" to 5)),
        card("작가 전용"),
        card("깨진 공개 null", "public", mapOf("revealFromEpisode" to null)),
        card("깨진 공개 문자열", "public", mapOf("revealFromEpisode" to "2")),
        card("지운 카드", "public", mapOf("revealFromEpisode" to 1), lifecycle = "removed"),
    )

    private fun sealedWorld(deleted: Boolean = false, sealed: Boolean = true) {
        `when`(worlds.findById(worldId)).thenReturn(Optional.of(StudioWorld(worldId, UUID.randomUUID(), revisionId, visibility = "private", deletedAt = Instant.now().takeIf { deleted })))
        `when`(revisions.findByIdAndWorldId(revisionId, worldId)).thenReturn(WorldRevision(id = revisionId, worldId = worldId, revisionNo = 2, name = "원작 세계", description = "", sealed = sealed))
        `when`(revisionCards.findAllByIdRevisionId(revisionId)).thenReturn(cards.map { WorldRevisionCard(RevisionCardKey(revisionId, it.cardId), worldId, it.id) })
        `when`(cardVersions.findAllById(cards.map { it.id })).thenReturn(cards)
        `when`(states.findById(worldId)).thenReturn(Optional.empty())
    }

    @Test fun `the cards a reader cannot see at the basis episode are listed by title and grow shorter as the basis moves on`() {
        sealedWorld()

        assertEquals(listOf("3화 공개", "5화 공개", "깨진 공개 null", "깨진 공개 문자열", "작가 전용"), service.hiddenCardTitles(worldId, 2))
        assertEquals(listOf("5화 공개", "깨진 공개 null", "깨진 공개 문자열", "작가 전용"), service.hiddenCardTitles(worldId, 3))
        assertEquals(listOf("깨진 공개 null", "깨진 공개 문자열", "작가 전용"), service.hiddenCardTitles(worldId, 5))
    }

    @Test fun `hidden titles are exactly the active cards the Fork inheriting exit does not show`() {
        sealedWorld()
        val active = cards.filter { it.fields.lifecycle == "active" }.map { it.fields.title }.toSet()

        (1..6).forEach { basis ->
            val shown = service.inheritedWorld("fork", worldId, basis).cards.map { it.title }.toSet()
            val hidden = service.hiddenCardTitles(worldId, basis).toSet()

            assertEquals(active, shown + hidden, "기준 회차 $basis")
            assertTrue(shown.intersect(hidden).isEmpty(), "기준 회차 $basis 겹침")
        }
    }

    @Test fun `a deleted world an unsealed revision and an unknown world have nothing hidden`() {
        sealedWorld(deleted = true)
        assertEquals(emptyList<String>(), service.hiddenCardTitles(worldId, 2))

        sealedWorld(sealed = false)
        assertEquals(emptyList<String>(), service.hiddenCardTitles(worldId, 2))

        assertEquals(emptyList<String>(), service.hiddenCardTitles(UUID.randomUUID(), 2))
    }
}
