package ai.storyfork.content.world

import ai.storyfork.content.world.domain.WorldConflict
import ai.storyfork.content.world.domain.WorldNotFound
import ai.storyfork.content.world.domain.WorldStudioFailure
import ai.storyfork.content.world.relationship.Neo4jRelationshipRepository
import ai.storyfork.content.world.studio.entity.*
import ai.storyfork.content.world.studio.repository.*
import ai.storyfork.content.world.service.WorldStudioService
import ai.storyfork.content.world.service.dto.*
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

class WorldStudioServiceTest {
    private val worlds=mock(StudioWorldRepository::class.java)
    private val drafts=mock(WorldDraftRepository::class.java)
    private val cards=mock(SettingCardRepository::class.java)
    private val cardDrafts=mock(SettingCardDraftRepository::class.java)
    private val cardVersions=mock(SettingCardVersionRepository::class.java)
    private val revisions=mock(WorldRevisionRepository::class.java)
    private val revisionCards=mock(WorldRevisionCardRepository::class.java)
    private val requests=mock(WorldSaveRequestRepository::class.java)
    private val states=mock(WorldRelationshipStateRepository::class.java)
    private val graph=mock(Neo4jRelationshipRepository::class.java)
    private val manager=mock(PlatformTransactionManager::class.java).also {
        `when`(it.getTransaction(any())).thenAnswer { SimpleTransactionStatus() }
    }
    private val mapper=JsonMapper.builder().addModule(KotlinModule.Builder().build()).build()
    private val service=WorldStudioService(worlds,drafts,cards,cardDrafts,cardVersions,revisions,revisionCards,requests,states,graph,manager,mapper)
    private val world=UUID.randomUUID()
    private val actor=UUID.randomUUID()
    private val draft=WorldDraft(worldId=world,name="편집본",draftRevision=2)
    private val state=WorldRelationshipState(world,3,"creation","previous","previous",1,true)
    private fun owned(marker:Boolean=true) {
        `when`(worlds.lockOwned(world,actor)).thenReturn(StudioWorld(world,actor))
        `when`(drafts.findById(world)).thenReturn(Optional.of(draft))
        `when`(states.findById(world)).thenReturn(if(marker) Optional.of(state) else Optional.empty())
        `when`(graph.read(world)).thenAnswer { RelationshipStateResult(world,state.graphVersion,state.requestKey,state.requestHash,emptyList()) }
    }
    @Test fun `unowned world fails before reading draft or Neo4j`() {
        assertThrows(WorldNotFound::class.java) { service.draft(world,actor) }
        verifyNoInteractions(drafts,states,graph)
    }
    @Test fun `legacy draft without a Neo4j marker is not an empty successful graph`() {
        owned(false)
        val failure=assertThrows(WorldStudioFailure::class.java) { service.draft(world,actor) }
        assertEquals("RELATIONSHIP_MIGRATION_REQUIRED",failure.code)
        verifyNoInteractions(graph)
    }
    @Test fun `pending and mismatched graph states fail closed`() {
        owned();state.completed=false
        assertEquals("RELATIONSHIP_WRITE_INCOMPLETE",assertThrows(WorldStudioFailure::class.java) { service.draft(world,actor) }.code)
        verifyNoInteractions(graph)
        state.completed=true
        `when`(graph.read(world)).thenReturn(RelationshipStateResult(world,4,"other","other",emptyList()))
        assertEquals("RELATIONSHIP_VERSION_MISMATCH",assertThrows(WorldStudioFailure::class.java) { service.draft(world,actor) }.code)
    }
    @Test fun `matching token with foreign graph endpoints is not a coherent current view`() {
        owned()
        val foreign=RelationshipPayload(UUID.randomUUID(),UUID.randomUUID(),UUID.randomUUID(),"structural","foreign")
        `when`(graph.read(world)).thenReturn(RelationshipStateResult(world,3,"previous","previous",listOf(foreign)))
        assertEquals("RELATIONSHIP_VERSION_MISMATCH",assertThrows(WorldStudioFailure::class.java) { service.draft(world,actor) }.code)
        verify(states,never()).flush()
    }
    @Test fun `stale input and foreign cards fail before any graph mutation`() {
        owned()
        val stale=assertThrows(WorldStudioFailure::class.java) { service.edit(world,actor,EditWorldDraftRequest(1,"x","",key="stale")) }
        assertEquals("WORLD_WRITE_REJECTED",stale.code);assertEquals(WorldStudioFailure.Reason.REJECTED,stale.reason)
        assertTrue(state.completed);verify(states,never()).flush()
        val card=CardPayload(UUID.randomUUID(),"외부 인물","원문","character","basic")
        `when`(cards.findById(card.id)).thenReturn(Optional.of(SettingCard(card.id,UUID.randomUUID())))
        assertThrows(WorldNotFound::class.java) { service.edit(world,actor,EditWorldDraftRequest(2,"x","",listOf(card),key="foreign")) }
        verify(graph,never()).replace(anyUUID(),anyLong(),anyString(),anyString(),anyList())
        assertEquals(2L,draft.draftRevision)
    }
    @Test fun `graph failure leaves a retriable receipt and does not change PostgreSQL draft content`() {
        owned()
        val request=EditWorldDraftRequest(2,"저장할 이름","",key="retry",replace=true)
        `when`(graph.replace(anyUUID(),anyLong(),anyString(),anyString(),anyList())).thenThrow(WorldStudioFailure.unavailable())
        assertThrows(WorldStudioFailure::class.java) { service.edit(world,actor,request) }
        assertFalse(state.completed);assertEquals("retry",state.requestKey)
        assertEquals("편집본",draft.name);assertEquals(2L,draft.draftRevision)
        assertEquals("RELATIONSHIP_WRITE_INCOMPLETE",assertThrows(WorldStudioFailure::class.java) { service.draft(world,actor) }.code)
        assertThrows(WorldConflict::class.java) { service.edit(world,actor,request.copy(name="다른 요청")) }
        // Simulate lost Neo4j acknowledgement: its current state already has this request.
        `when`(graph.read(world)).thenAnswer { RelationshipStateResult(world,4,state.requestKey,state.requestHash,emptyList()) }
        doAnswer { RelationshipStateResult(world,4,state.requestKey,state.requestHash,emptyList()) }.`when`(graph).replace(anyUUID(),anyLong(),anyString(),anyString(),anyList())
        val saved=service.edit(world,actor,request)
        assertTrue(state.completed);assertEquals(4L,state.graphVersion);assertEquals(3L,saved.draftRevision)
        assertEquals("저장할 이름",saved.name)
        assertEquals(saved,service.edit(world,actor,request))
        assertEquals(3L,draft.draftRevision)
    }
    @Test fun `definite foreign graph identity rejection releases only its receipt without changing the current draft`() {
        owned()
        val relation=RelationshipPayload(UUID.randomUUID(),null,null,"emotional","거절된 관계")
        val request=EditWorldDraftRequest(2,"거절된 이름","",relationships=listOf(relation),key="foreign",replace=true)
        `when`(graph.replace(anyUUID(),anyLong(),anyString(),anyString(),anyList())).thenAnswer {
            assertFalse(state.completed);assertEquals("foreign",state.requestKey)
            verify(manager,times(2)).commit(any())
            throw WorldNotFound()
        }
        val failure=assertThrows(WorldStudioFailure::class.java) { service.edit(world,actor,request) }
        assertEquals("WORLD_WRITE_REJECTED",failure.code)
        assertTrue(state.completed);assertEquals(3L,state.graphVersion)
        assertEquals("",state.requestKey);assertEquals("",state.requestHash);assertEquals(-1L,state.expectedDraftRevision)
        assertEquals("편집본",service.draft(world,actor).name);assertEquals(2L,draft.draftRevision)
        verify(cardDrafts,never()).save(any());verify(cardDrafts,never()).flush()
        doAnswer { RelationshipStateResult(world,4,state.requestKey,state.requestHash,emptyList()) }.`when`(graph).replace(anyUUID(),anyLong(),anyString(),anyString(),anyList())
        val saved=service.edit(world,actor,request.copy(name="수정",relationships=emptyList(),key="corrected"))
        assertEquals("수정",saved.name);assertEquals(3L,saved.draftRevision)
    }
    @Test fun `rejection recovery never clears a different pending receipt`() {
        owned()
        `when`(graph.replace(anyUUID(),anyLong(),anyString(),anyString(),anyList())).thenAnswer {
            state.requestKey="racing";state.requestHash="other"
            throw WorldNotFound()
        }
        val failure=assertThrows(WorldStudioFailure::class.java) { service.edit(world,actor,EditWorldDraftRequest(2,"x","",key="rejected")) }
        assertEquals("RELATIONSHIP_WRITE_INCOMPLETE",failure.code)
        assertFalse(state.completed);assertEquals("racing",state.requestKey);assertEquals("other",state.requestHash)
        assertEquals(3L,state.graphVersion);assertEquals(2L,draft.draftRevision)
    }
    @Test fun `rejection is not reported as safely released if its PostgreSQL recovery commit fails`() {
        owned();var commits=0
        doAnswer { if(++commits==3)throw org.springframework.transaction.TransactionSystemException("unconfirmed recovery");null }.`when`(manager).commit(any())
        `when`(graph.replace(anyUUID(),anyLong(),anyString(),anyString(),anyList())).thenThrow(WorldNotFound())
        assertThrows(org.springframework.transaction.TransactionSystemException::class.java) { service.edit(world,actor,EditWorldDraftRequest(2,"x","",key="rejected")) }
    }
    @Test fun `stale revision discovered just before prepare is explicitly rejected without a new receipt`() {
        owned()
        `when`(graph.read(world)).thenAnswer {
            draft.draftRevision=3;state.graphVersion=4
            RelationshipStateResult(world,3,"previous","previous",emptyList())
        }
        assertEquals("WORLD_WRITE_REJECTED",assertThrows(WorldStudioFailure::class.java) { service.edit(world,actor,EditWorldDraftRequest(2,"x","",key="stale")) }.code)
        assertTrue(state.completed);assertEquals("previous",state.requestKey)
        verify(states,never()).flush();verify(graph,never()).replace(anyUUID(),anyLong(),anyString(),anyString(),anyList())
    }
    @Test fun `a revision conflict on an existing pending receipt is not a definite rejection`() {
        owned()
        val request=EditWorldDraftRequest(2,"x","",key="pending")
        `when`(graph.replace(anyUUID(),anyLong(),anyString(),anyString(),anyList())).thenThrow(WorldStudioFailure.unavailable())
        assertThrows(WorldStudioFailure::class.java) { service.edit(world,actor,request) }
        draft.draftRevision=3
        assertThrows(WorldConflict::class.java) { service.edit(world,actor,request) }
        assertFalse(state.completed);assertEquals("pending",state.requestKey)
    }
    @Test fun `concurrent completion of the same request before prepare is not labeled unapplied`() {
        owned()
        val request=EditWorldDraftRequest(2,"x","",key="pending")
        `when`(graph.replace(anyUUID(),anyLong(),anyString(),anyString(),anyList())).thenThrow(WorldStudioFailure.unavailable())
        assertThrows(WorldStudioFailure::class.java) { service.edit(world,actor,request) }
        `when`(graph.read(world)).thenAnswer {
            state.completed=true;state.graphVersion=4;draft.draftRevision=3
            RelationshipStateResult(world,4,state.requestKey,state.requestHash,emptyList())
        }
        assertThrows(WorldConflict::class.java) { service.edit(world,actor,request) }
        assertTrue(state.completed);assertEquals("pending",state.requestKey);assertEquals(4L,state.graphVersion)
    }
    @Test fun `an already acknowledged graph write can never be released as a rejected write`() {
        owned()
        val request=EditWorldDraftRequest(2,"x","",key="pending")
        `when`(graph.replace(anyUUID(),anyLong(),anyString(),anyString(),anyList())).thenThrow(WorldStudioFailure.unavailable())
        assertThrows(WorldStudioFailure::class.java) { service.edit(world,actor,request) }
        `when`(graph.read(world)).thenAnswer { RelationshipStateResult(world,4,state.requestKey,state.requestHash,emptyList()) }
        doThrow(WorldNotFound()).`when`(graph).replace(anyUUID(),anyLong(),anyString(),anyString(),anyList())
        assertEquals("RELATIONSHIP_VERSION_MISMATCH",assertThrows(WorldStudioFailure::class.java) { service.edit(world,actor,request) }.code)
        assertFalse(state.completed);assertEquals("pending",state.requestKey);assertEquals(3L,state.graphVersion)
    }
    @Test fun `no surrounding Spring transaction can span the Neo4j calls`() {
        assertNull(WorldStudioService::class.java.getAnnotation(org.springframework.transaction.annotation.Transactional::class.java))
        owned();service.draft(world,actor)
        val ordered=inOrder(manager,graph)
        ordered.verify(manager).commit(any())
        ordered.verify(graph).read(world)
    }
    @Test fun `whole world restore is explicitly unsupported rather than restoring current relations as history`() {
        owned()
        val failure=assertThrows(WorldStudioFailure::class.java) { service.restore(world,actor,RestoreWorldRequest(2,"restore",UUID.randomUUID())) }
        assertEquals("RELATIONSHIP_HISTORY_UNSUPPORTED",failure.code)
        verifyNoInteractions(graph,cardVersions,revisionCards,requests)
    }
    @Test fun `new card identities are reserved before graph writes so another world cannot capture a pending id`() {
        owned()
        val card=CardPayload(UUID.randomUUID(),"인물","원문","character","basic")
        `when`(cards.findById(card.id)).thenReturn(Optional.empty())
        `when`(cards.saveAndFlush(any())).thenAnswer { it.arguments[0] }
        `when`(graph.replace(anyUUID(),anyLong(),anyString(),anyString(),anyList())).thenThrow(WorldStudioFailure.unavailable())
        assertThrows(WorldStudioFailure::class.java) { service.edit(world,actor,EditWorldDraftRequest(2,"x","",listOf(card),key="reserve")) }
        val ordered=inOrder(cards,graph)
        ordered.verify(cards).saveAndFlush(any())
        ordered.verify(graph).replace(anyUUID(),anyLong(),anyString(),anyString(),anyList())
        verify(cardDrafts,never()).save(any())
    }
    @Test fun `racing prepare during graph read never installs a successful mismatched view`() {
        owned()
        `when`(graph.read(world)).thenAnswer { state.completed=false;RelationshipStateResult(world,3,"old","old",emptyList()) }
        assertEquals("RELATIONSHIP_WRITE_INCOMPLETE",assertThrows(WorldStudioFailure::class.java) { service.draft(world,actor) }.code)
    }
    @Test fun `invalid relationship membership and enums never prepare or mutate stores`() {
        owned()
        val invalid=RelationshipPayload(UUID.randomUUID(),UUID.randomUUID(),UUID.randomUUID(),"emotional","text",direction="directed")
        assertThrows(IllegalArgumentException::class.java) { service.edit(world,actor,EditWorldDraftRequest(2,"x","",relationships=listOf(invalid),key="invalid")) }
        assertTrue(state.completed)
        verify(states,never()).flush()
        verify(graph,never()).replace(anyUUID(),anyLong(),anyString(),anyString(),anyList())
    }
    private fun anyUUID():UUID=any(UUID::class.java) ?: UUID(0,0)

    @Test fun `initial input uses owner and remains unchanged while validated under the world lock`() {
        owned()
        draft.description="홍😀\r\n길동"
        val original=service.prepareInitialWorldInput(world,actor,UUID.randomUUID())
        val result=service.withInitialWorldInput(actor,original) {
            verify(worlds,atLeast(3)).lockOwned(world,actor)
            verify(manager,atLeastOnce()).getTransaction(any())
            // The two draft reads have committed, while the validation/use transaction has not.
            verify(manager,times(2)).commit(any())
            assertEquals("홍😀\r\n길동",draft.description)
            "used"
        }
        assertEquals("used",result)
        assertEquals("홍😀\r\n길동",draft.description)
        verify(graph,never()).replace(anyUUID(),anyLong(),anyString(),anyString(),anyList())
        verify(cardDrafts,never()).save(any())
        verify(states,never()).flush()
    }

    @Test fun `initial input rejects unauthorized stale and incomplete state before callback`() {
        owned()
        val original=service.prepareInitialWorldInput(world,actor,UUID.randomUUID())
        var calls=0
        assertThrows(WorldNotFound::class.java) { service.withInitialWorldInput(UUID.randomUUID(),original) { calls++; "bad" } }
        draft.draftRevision++
        assertThrows(WorldConflict::class.java) { service.withInitialWorldInput(actor,original) { calls++; "bad" } }
        draft.draftRevision--
        state.graphVersion++
        assertThrows(WorldConflict::class.java) { service.withInitialWorldInput(actor,original) { calls++; "bad" } }
        state.graphVersion--
        draft.description="수정된 원문"
        assertThrows(WorldConflict::class.java) { service.withInitialWorldInput(actor,original) { calls++; "bad" } }
        draft.description=""
        state.completed=false
        assertEquals("RELATIONSHIP_WRITE_INCOMPLETE",assertThrows(WorldStudioFailure::class.java) { service.withInitialWorldInput(actor,original) { calls++; "bad" } }.code)
        assertEquals(0,calls)
        verify(graph,never()).replace(anyUUID(),anyLong(),anyString(),anyString(),anyList())
    }

    @Test fun `initial input rejects current revision change even when draft and graph versions are unchanged`() {
        owned()
        val current=StudioWorld(world,actor)
        `when`(worlds.lockOwned(world,actor)).thenReturn(current)
        val original=service.prepareInitialWorldInput(world,actor,UUID.randomUUID())
        current.currentRevisionId=UUID.randomUUID()
        assertThrows(WorldConflict::class.java) { service.withInitialWorldInput(actor,original) { fail<String>("must not use a stale input") } }
    }

    @Test fun `callback receives a fresh snapshot instead of caller mutable lists`() {
        owned()
        draft.description="원문😀"
        val card=SettingCardDraft(UUID.randomUUID(),world,CardFields(title="인물",cardType="character",aliases=listOf("별명")))
        `when`(cardDrafts.findAllByWorldId(world)).thenReturn(listOf(card))
        val original=service.prepareInitialWorldInput(world,actor,UUID.randomUUID())
        val callerSources=original.sources.toMutableList()
        val callerAliases=original.entities.single().aliases.toMutableList()
        val callerEntities=original.entities.map { it.copy(aliases=callerAliases) }.toMutableList()
        val supplied=original.copy(sources=callerSources,entities=callerEntities)
        service.withInitialWorldInput(actor,supplied) { safe ->
            callerSources.clear()
            callerAliases.clear()
            callerEntities.clear()
            assertEquals(original.sources,safe.sources)
            assertNotSame(callerSources,safe.sources)
            assertEquals(listOf("별명"),safe.entities.single().aliases)
            "used"
        }
    }
}
