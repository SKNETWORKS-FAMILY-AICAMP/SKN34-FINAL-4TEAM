package ai.storyfork.content.world

import ai.storyfork.content.auth.service.CoreNicknameService
import ai.storyfork.content.attachment.client.AttachmentStorageClient
import ai.storyfork.content.attachment.repository.ContentImageRepository
import ai.storyfork.content.publication.service.PublicationService
import ai.storyfork.content.work.repository.WorkRepository
import ai.storyfork.content.work.service.WorkAccessService
import ai.storyfork.content.world.domain.visibleRelationships
import ai.storyfork.content.world.relationship.Neo4jRelationshipRepository
import ai.storyfork.content.world.service.PublicWorldService
import ai.storyfork.content.world.service.WorldStudioService
import ai.storyfork.content.world.service.dto.*
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
import tools.jackson.databind.json.JsonMapper
import tools.jackson.module.kotlin.KotlinModule

/**
 * 「동일 인물」(category=identity, #485): 다른 이름 카드 → 본체 카드. 저장 규칙(WorldStudioService.edit)과 공개 쪽 거르기·Fork 이어받기를 본다.
 * 저장소·Neo4j는 대역이고 실제 HTTP·DB는 CI가 확인한다.
 */
class IdentityRelationshipTest {
    // --- 저장 규칙 -----------------------------------------------------------------------------------------------------
    private val worlds=mock(StudioWorldRepository::class.java)
    private val drafts=mock(WorldDraftRepository::class.java)
    private val cards=mock(SettingCardRepository::class.java)
    private val cardDrafts=mock(SettingCardDraftRepository::class.java)
    private val states=mock(WorldRelationshipStateRepository::class.java)
    private val graph=mock(Neo4jRelationshipRepository::class.java)
    private val manager=mock(PlatformTransactionManager::class.java).also { `when`(it.getTransaction(any())).thenAnswer { SimpleTransactionStatus() } }
    private val mapper=JsonMapper.builder().addModule(KotlinModule.Builder().build()).build()
    private val service=WorldStudioService(worlds,drafts,cards,cardDrafts,mock(SettingCardVersionRepository::class.java),mock(WorldRevisionRepository::class.java),
        mock(WorldRevisionCardRepository::class.java),mock(WorldSaveRequestRepository::class.java),states,mock(TemplatePublicationOnceRepository::class.java),
        mock(ExpandedSeedProgressRepository::class.java),mock(InitialWorldApplicationRepository::class.java),mock(SettingCardImageRepository::class.java),graph,manager,mapper)
    private val world=UUID.randomUUID()
    private val actor=UUID.randomUUID()
    private val draft=WorldDraft(worldId=world,name="편집본",draftRevision=2)
    private val state=WorldRelationshipState(world,3,"creation","previous","previous",1,true)
    private val mask=UUID.randomUUID();private val body=UUID.randomUUID();private val other=UUID.randomUUID();private val place=UUID.randomUUID()

    private fun cardDraft(id:UUID,type:String="character")=SettingCardDraft(id,world,CardFields(title="카드",cardType=type,lifecycle="active"))
    private fun identity(source:UUID=mask,target:UUID=body,direction:String?="directed")=
        RelationshipPayload(UUID.randomUUID(),source,target,"identity",label="동일 인물",direction=direction)
    private fun at(episode:Int?,vararg relations:RelationshipPayload) {
        `when`(graph.read(world,episode)).thenAnswer { RelationshipStateResult(world,state.graphVersion,state.requestKey,state.requestHash,relations.toList()) }
    }
    /** 가면·본체·다른 인물은 인물 카드, 장소는 인물이 아닌 카드다. */
    private fun owned() {
        `when`(worlds.lockOwned(world,actor)).thenReturn(StudioWorld(world,actor))
        `when`(drafts.findById(world)).thenReturn(Optional.of(draft))
        `when`(states.findById(world)).thenReturn(Optional.of(state))
        `when`(graph.read(world)).thenAnswer { RelationshipStateResult(world,state.graphVersion,state.requestKey,state.requestHash,emptyList()) }
        `when`(cardDrafts.findAllByWorldId(world)).thenReturn(listOf(cardDraft(mask),cardDraft(body),cardDraft(other),cardDraft(place,"location")))
        // 저장 회차가 최신이면 저장한 뒤의 최신 시점 관계는 저장한 목록 그대로다. 달라지는 경우는 각 테스트가 다시 정한다.
        `when`(graph.readAfter(anyUUID(),anyList(),anyEpisode())).thenAnswer { RelationshipStateResult(world,state.graphVersion,state.requestKey,state.requestHash,it.arguments[1] as List<RelationshipPayload>) }
    }
    private fun anyUUID():UUID=any(UUID::class.java) ?: UUID(0,0)
    private fun anyEpisode():Int?=any()
    private fun graphKeeps(vararg kept:RelationshipPayload):MutableList<List<Any?>> {
        val sent=mutableListOf<List<Any?>>()
        doAnswer { sent+=it.arguments.toList();RelationshipStateResult(world,4,state.requestKey,state.requestHash,kept.toList()) }
            .`when`(graph).replace(anyUUID(),anyLong(),anyString(),anyString(),anyList(),anyEpisode())
        return sent
    }
    private fun rejected(request:EditWorldDraftRequest) {
        assertThrows(IllegalArgumentException::class.java) { service.edit(world,actor,request) }
        assertTrue(state.completed);verify(states,never()).flush()
        verify(graph,never()).replace(anyUUID(),anyLong(),anyString(),anyString(),anyList(),anyEpisode())
    }
    private fun save(vararg relations:RelationshipPayload,episode:Int?=4,key:String="identity")=
        EditWorldDraftRequest(2,"x","",relationships=relations.toList(),key=key,episode=episode)

    @Test fun `an identity relation from the other-name card to the body card is saved at the episode it was given`() {
        owned();at(4)
        val relation=identity();val sent=graphKeeps(relation)
        assertEquals(3L,service.edit(world,actor,save(relation)).draftRevision)
        assertEquals(4,sent.single()[5]);assertEquals(listOf(relation),sent.single()[4])
    }
    @Test fun `several other names of one body are fine`() {
        owned();at(4)
        val relations=listOf(identity(mask,body),identity(other,body));val sent=graphKeeps(*relations.toTypedArray())
        assertEquals(3L,service.edit(world,actor,save(*relations.toTypedArray())).draftRevision)
        assertEquals(relations,sent.single()[4])
    }
    @Test fun `an identity relation without an episode is an input error and never takes the default episode`() {
        owned();at(null)
        rejected(save(identity(),episode=null))
    }
    @Test fun `an identity relation needs a directed relation between two character cards`() {
        owned();at(4)
        rejected(save(identity(mask,place)))
        rejected(save(identity(place,body)))
        rejected(save(identity(direction="symmetric")))
        rejected(save(identity(direction=null)))
        rejected(save(identity(mask,mask)))
    }
    @Test fun `a card cannot be turned into a non-character while it is an end of an identity relation`() {
        owned();at(4,identity())
        rejected(EditWorldDraftRequest(2,"x","",listOf(CardPayload(body,"본체","원문","location","basic")),key="retype",episode=4))
    }
    @Test fun `retyping a body card is refused even when the saved episode comes before the identity starts`() {
        owned();at(3)                                  // 3화 시점에는 identity가 없다(4화부터 이어져 있다)
        val later=identity()
        `when`(graph.readAfter(anyUUID(),anyList(),anyEpisode())).thenAnswer { RelationshipStateResult(world,state.graphVersion,state.requestKey,state.requestHash,listOf(later)) }
        val retype=listOf(CardPayload(body,"본체","원문","location","basic"))
        rejected(EditWorldDraftRequest(2,"x","",retype,key="retype-early",episode=3))   // 저장 결과의 최신 시점 identity의 끝점이 인물이 아니게 된다
        rejected(EditWorldDraftRequest(2,"x","",listOf(CardPayload(mask,"가면","원문","object","basic")),key="retype-mask",episode=3))
    }
    @Test fun `retyping a card no identity touches is saved, and cards that stay characters never read the latest episode`() {
        owned();at(3);val sent=graphKeeps()
        `when`(graph.readAfter(anyUUID(),anyList(),anyEpisode())).thenAnswer { RelationshipStateResult(world,state.graphVersion,state.requestKey,state.requestHash,listOf(identity())) }
        assertEquals(3L,service.edit(world,actor,EditWorldDraftRequest(2,"x","",listOf(CardPayload(other,"카드","원문","location","basic")),key="retype-other",episode=3)).draftRevision)
        assertEquals(3,sent.single()[5])
        draft.draftRevision=2;state.graphVersion=3
        clearInvocations(graph);at(3);graphKeeps()
        service.edit(world,actor,EditWorldDraftRequest(2,"x","",listOf(CardPayload(body,"본체","새 원문","character","basic")),key="text-only",episode=3))
        verify(graph,never()).readAfter(anyUUID(),anyList(),anyEpisode())
    }
    @Test fun `a chain or a cycle of identities is rejected`() {
        owned();at(4,identity(mask,body))
        rejected(save(identity(body,other)))             // 본체가 다시 다른 카드의 다른 이름이다
        rejected(save(identity(other,mask)))             // 다른 이름 카드가 본체가 된다
        rejected(save(identity(body,mask)))              // 서로가 서로의 다른 이름이다(순환)
        rejected(save(identity(body,other),identity(other,place)))   // 한 요청 안의 사슬
    }
    @Test fun `an other-name card has one body only`() {
        owned();at(4,identity(mask,body))
        rejected(save(identity(mask,other)))
    }
    @Test fun `leaving an identity relation as it is needs no episode for an unrelated edit`() {
        owned();val kept=identity();at(null,kept);val sent=graphKeeps(kept)
        val edit=EditWorldDraftRequest(2,"x","",listOf(CardPayload(other,"카드","새 원문","character","basic")),key="plain")
        assertEquals(3L,service.edit(world,actor,edit).draftRevision)
        assertEquals(listOf(kept),sent.single()[4]);assertNull(sent.single()[5])
    }
    @Test fun `ending or changing an identity relation needs an episode too, and with one it is saved`() {
        owned();val kept=identity();at(null,kept);at(4,kept);val sent=graphKeeps()
        rejected(EditWorldDraftRequest(2,"x","",relationships=listOf(kept.copy(lifecycle="removed")),key="end"))              // 끝내기
        rejected(EditWorldDraftRequest(2,"x","",relationships=listOf(kept.copy(targetCardId=other)),key="move"))              // 바꾸기
        rejected(EditWorldDraftRequest(2,"x","",replace=true,key="omit"))                                                     // 빼먹어서 끝내기
        val end=EditWorldDraftRequest(2,"x","",relationships=listOf(kept.copy(lifecycle="removed")),key="end-4",episode=4)
        assertEquals(3L,service.edit(world,actor,end).draftRevision)
        assertEquals(emptyList<RelationshipPayload>(),sent.single()[4])
    }
    @Test fun `the chain check reads the latest episode after the save, not the episode that is saved at`() {
        owned()
        // 2화 시점에는 가면→본체뿐이라 본체→다른 카드(2화)를 더하면 그 시점으로는 사슬이다. 하지만 5화에 가면→본체가 끝나 최신 시점에는 사슬이 없다.
        at(2,identity(mask,body));val chained=identity(body,other);val sent=graphKeeps(chained)
        `when`(graph.readAfter(anyUUID(),anyList(),anyEpisode())).thenAnswer { RelationshipStateResult(world,state.graphVersion,state.requestKey,state.requestHash,listOf(chained)) }
        assertEquals(3L,service.edit(world,actor,save(chained,episode=2)).draftRevision)
        assertEquals(2,sent.single()[5])
    }
    @Test fun `a chain made only by a later episode is rejected even when the saved episode shows none`() {
        owned();at(2);val tail=identity(body,other)
        // 5화에 이미 가면→본체가 있어 저장한 뒤의 최신 시점은 사슬이다.
        `when`(graph.readAfter(anyUUID(),anyList(),anyEpisode())).thenAnswer { RelationshipStateResult(world,state.graphVersion,state.requestKey,state.requestHash,listOf(identity(mask,body),tail)) }
        rejected(save(tail,episode=2))
    }
    @Test fun `a denied identity relation is not a link, so it neither chains nor doubles a body`() {
        owned();at(4)
        val denied=identity(mask,body).copy(polarity="denied");val asserted=identity(body,other);val sent=graphKeeps(denied,asserted)
        assertEquals(3L,service.edit(world,actor,save(denied,asserted)).draftRevision)
        assertEquals(listOf(denied,asserted),sent.single()[4])
    }
    @Test fun `a denied identity relation still has to be a directed relation between characters`() {
        owned();at(4)
        rejected(save(identity(mask,body).copy(polarity="denied",direction="symmetric")))
        rejected(save(identity(mask,place).copy(polarity="denied")))
    }

    // --- 공개 쪽: 기존 끝점 거르기 규칙이면 충분하다 -----------------------------------------------------------------------
    @Test fun `an identity relation is public only when both its ends are shown cards`() {
        val relation=identity()
        assertEquals(listOf(relation),visibleRelationships(listOf(relation),setOf(mask,body)))
        assertTrue(visibleRelationships(listOf(relation),setOf(mask)).isEmpty())
        assertTrue(visibleRelationships(listOf(relation),setOf(body)).isEmpty())
    }

    private val storage=mock(AttachmentStorageClient::class.java)
    private val revisions=mock(WorldRevisionRepository::class.java)
    private val revisionCards=mock(WorldRevisionCardRepository::class.java)
    private val cardVersions=mock(SettingCardVersionRepository::class.java)
    private val publicGraph=mock(Neo4jRelationshipRepository::class.java)
    private val publicWorlds=mock(StudioWorldRepository::class.java)
    private val publicStates=mock(WorldRelationshipStateRepository::class.java)
    private val publicService=PublicWorldService(publicWorlds,revisions,revisionCards,cardVersions,mock(SettingCardImageRepository::class.java),publicStates,
        mock(ExpandedSeedProgressRepository::class.java),publicGraph,mock(CoreNicknameService::class.java),storage,mock(WorkRepository::class.java),
        mock(WorkAccessService::class.java),mock(ContentImageRepository::class.java),mock(PublicationService::class.java),manager)
    /** 가면 카드는 1화, 본체 카드는 [revealBody]화부터 독자에게 보인다. 둘 다 공개 카드이고 identity 관계 하나가 있다. */
    private fun sealed(revealBody:Int):Pair<UUID,RelationshipPayload> {
        val id=UUID.randomUUID();val revisionId=UUID.randomUUID()
        fun version(card:UUID,title:String,reveal:Int)=SettingCardVersion(cardId=card,worldId=id,versionNo=1,fields=CardFields(title=title,body="${title} 본문",cardType="character",
            semanticMetadata=mapOf("revealFromEpisode" to reveal),visibility="public",lifecycle="active"))
        val versions=listOf(version(mask,"가면",1),version(body,"본체",revealBody))
        val relation=RelationshipPayload(UUID.randomUUID(),mask,body,"identity","작가 메모","동일 인물","directed","asserted",mapOf("studio" to "작가용"))
        `when`(publicWorlds.findById(id)).thenReturn(Optional.of(StudioWorld(id,UUID.randomUUID(),revisionId,visibility="public",publishedAt=Instant.now())))
        `when`(revisions.findByIdAndWorldId(revisionId,id)).thenReturn(WorldRevision(id=revisionId,worldId=id,revisionNo=1,name="세계",description="",sealed=true))
        `when`(revisionCards.findAllByIdRevisionId(revisionId)).thenReturn(versions.map { WorldRevisionCard(RevisionCardKey(revisionId,it.cardId),id,it.id) })
        `when`(cardVersions.findAllById(versions.map { it.id })).thenReturn(versions)
        `when`(publicStates.findById(id)).thenReturn(Optional.of(WorldRelationshipState(id,3,"creation","key","hash",1,true)))
        listOf<Int?>(null,2,5).forEach { episode -> `when`(publicGraph.read(id,episode)).thenReturn(RelationshipStateResult(id,3,"key","hash",listOf(relation))) }
        return id to relation
    }
    @Test fun `readers see the identity relation only once the body card is revealed too`() {
        val (id,relation)=sealed(revealBody=5)
        assertTrue(publicService.readerCards("work",id,2).relationships.isEmpty())
        val revealed=publicService.readerCards("work",id,5).relationships.single()
        assertEquals(listOf("identity","directed","동일 인물"),listOf(revealed.category,revealed.direction,revealed.label))
        assertEquals(listOf(relation.sourceCardId,relation.targetCardId),listOf(revealed.sourceCardId,revealed.targetCardId))
    }
    @Test fun `a fork inherits the identity relation with its category and direction but not the author's text`() {
        val (id,relation)=sealed(revealBody=1)
        val inherited=publicService.inheritedWorld("fork",id,2).relationships.single()
        assertEquals(relation.copy(body="",semanticMetadata=emptyMap()),inherited)
        assertEquals("identity",inherited.category)
    }
}
