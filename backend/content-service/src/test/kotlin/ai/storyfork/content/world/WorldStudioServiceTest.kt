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
    private val service=WorldStudioService(worlds,drafts,cards,cardDrafts,cardVersions,revisions,revisionCards,requests,states,mock(InitialWorldApplicationRepository::class.java),graph,manager,mapper)
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
        verify(graph,never()).replace(anyUUID(),anyLong(),anyString(),anyString(),anyList(),anyEpisode())
        assertEquals(2L,draft.draftRevision)
    }
    @Test fun `graph failure leaves a retriable receipt and does not change PostgreSQL draft content`() {
        owned()
        val request=EditWorldDraftRequest(2,"저장할 이름","",key="retry",replace=true)
        `when`(graph.replace(anyUUID(),anyLong(),anyString(),anyString(),anyList(),anyEpisode())).thenThrow(WorldStudioFailure.unavailable())
        assertThrows(WorldStudioFailure::class.java) { service.edit(world,actor,request) }
        assertFalse(state.completed);assertEquals("retry",state.requestKey)
        assertEquals("편집본",draft.name);assertEquals(2L,draft.draftRevision)
        assertEquals("RELATIONSHIP_WRITE_INCOMPLETE",assertThrows(WorldStudioFailure::class.java) { service.draft(world,actor) }.code)
        assertThrows(WorldConflict::class.java) { service.edit(world,actor,request.copy(name="다른 요청")) }
        // Simulate lost Neo4j acknowledgement: its current state already has this request.
        `when`(graph.read(world)).thenAnswer { RelationshipStateResult(world,4,state.requestKey,state.requestHash,emptyList()) }
        doAnswer { RelationshipStateResult(world,4,state.requestKey,state.requestHash,emptyList()) }.`when`(graph).replace(anyUUID(),anyLong(),anyString(),anyString(),anyList(),anyEpisode())
        val saved=service.edit(world,actor,request)
        assertTrue(state.completed);assertEquals(4L,state.graphVersion);assertEquals(3L,saved.draftRevision)
        assertEquals("저장할 이름",saved.name)
        assertEquals(saved,service.edit(world,actor,request))
        assertEquals(3L,draft.draftRevision)
    }
    @Test fun `definite foreign graph identity rejection releases only its receipt without changing the current draft`() {
        owned()
        val first=CardPayload(UUID.randomUUID(),"가","원문","character","basic");val second=first.copy(id=UUID.randomUUID(),title="나")
        val relation=RelationshipPayload(UUID.randomUUID(),first.id,second.id,"emotional","거절된 관계")
        val request=EditWorldDraftRequest(2,"거절된 이름","",listOf(first,second),listOf(relation),"foreign",true)
        `when`(graph.replace(anyUUID(),anyLong(),anyString(),anyString(),anyList(),anyEpisode())).thenAnswer {
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
        doAnswer { RelationshipStateResult(world,4,state.requestKey,state.requestHash,emptyList()) }.`when`(graph).replace(anyUUID(),anyLong(),anyString(),anyString(),anyList(),anyEpisode())
        val saved=service.edit(world,actor,request.copy(name="수정",relationships=emptyList(),key="corrected"))
        assertEquals("수정",saved.name);assertEquals(3L,saved.draftRevision)
    }
    @Test fun `rejection recovery never clears a different pending receipt`() {
        owned()
        `when`(graph.replace(anyUUID(),anyLong(),anyString(),anyString(),anyList(),anyEpisode())).thenAnswer {
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
        `when`(graph.replace(anyUUID(),anyLong(),anyString(),anyString(),anyList(),anyEpisode())).thenThrow(WorldNotFound())
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
        verify(states,never()).flush();verify(graph,never()).replace(anyUUID(),anyLong(),anyString(),anyString(),anyList(),anyEpisode())
    }
    @Test fun `a revision conflict on an existing pending receipt is not a definite rejection`() {
        owned()
        val request=EditWorldDraftRequest(2,"x","",key="pending")
        `when`(graph.replace(anyUUID(),anyLong(),anyString(),anyString(),anyList(),anyEpisode())).thenThrow(WorldStudioFailure.unavailable())
        assertThrows(WorldStudioFailure::class.java) { service.edit(world,actor,request) }
        draft.draftRevision=3
        assertThrows(WorldConflict::class.java) { service.edit(world,actor,request) }
        assertFalse(state.completed);assertEquals("pending",state.requestKey)
    }
    @Test fun `concurrent completion of the same request before prepare is not labeled unapplied`() {
        owned()
        val request=EditWorldDraftRequest(2,"x","",key="pending")
        `when`(graph.replace(anyUUID(),anyLong(),anyString(),anyString(),anyList(),anyEpisode())).thenThrow(WorldStudioFailure.unavailable())
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
        `when`(graph.replace(anyUUID(),anyLong(),anyString(),anyString(),anyList(),anyEpisode())).thenThrow(WorldStudioFailure.unavailable())
        assertThrows(WorldStudioFailure::class.java) { service.edit(world,actor,request) }
        `when`(graph.read(world)).thenAnswer { RelationshipStateResult(world,4,state.requestKey,state.requestHash,emptyList()) }
        doThrow(WorldNotFound()).`when`(graph).replace(anyUUID(),anyLong(),anyString(),anyString(),anyList(),anyEpisode())
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
        `when`(graph.replace(anyUUID(),anyLong(),anyString(),anyString(),anyList(),anyEpisode())).thenThrow(WorldStudioFailure.unavailable())
        assertThrows(WorldStudioFailure::class.java) { service.edit(world,actor,EditWorldDraftRequest(2,"x","",listOf(card),key="reserve")) }
        val ordered=inOrder(cards,graph)
        ordered.verify(cards).saveAndFlush(any())
        ordered.verify(graph).replace(anyUUID(),anyLong(),anyString(),anyString(),anyList(),anyEpisode())
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
        verify(graph,never()).replace(anyUUID(),anyLong(),anyString(),anyString(),anyList(),anyEpisode())
    }
    private fun anyUUID():UUID=any(UUID::class.java) ?: UUID(0,0)
    /** 회차(null=최신)는 어떤 값이든 맞는 매처다. */
    private fun anyEpisode():Int?=any()

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
        verify(graph,never()).replace(anyUUID(),anyLong(),anyString(),anyString(),anyList(),anyEpisode())
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
        verify(graph,never()).replace(anyUUID(),anyLong(),anyString(),anyString(),anyList(),anyEpisode())
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

    @Test fun `confirmed context preserves frozen sources and applied semantics without reading drafts candidates or graph`() {
        owned()
        val person=UUID.randomUUID();val place=UUID.randomUUID();val id=UUID.randomUUID()
        val metadata=mapOf("preprocessing" to mapOf("semanticType" to "goal","provenance" to "author_revision",
            "analysisId" to UUID.randomUUID().toString(),"candidateId" to UUID.randomUUID().toString(),"decisionSequence" to 3,"evidence" to emptyList<Any>()),
            "studio" to mapOf("item" to mapOf("subjectId" to person.toString(),"relatedIds" to listOf(place.toString()))))
        val versions=listOf(
            SettingCardVersion(cardId=person,worldId=world,versionNo=1,fields=CardFields(title="홍길동",body="원문😀",cardType="character")),
            SettingCardVersion(cardId=place,worldId=world,versionNo=1,fields=CardFields(title="율도국",body="장소",cardType="location")),
            SettingCardVersion(cardId=UUID.randomUUID(),worldId=world,versionNo=2,fields=CardFields(title="목표",body="나라를 세우려 한다",semanticMetadata=metadata)),
            SettingCardVersion(cardId=UUID.randomUUID(),worldId=world,versionNo=1,fields=CardFields(title="삭제",body="제외",lifecycle="removed")))
        val revision=WorldRevision(id=id,worldId=world,revisionNo=1,name="확정",description="확정 설명",sealed=true)
        `when`(revisions.findByIdAndWorldId(id,world)).thenReturn(revision)
        `when`(revisionCards.findAllByIdRevisionId(id)).thenReturn(versions.map {WorldRevisionCard(RevisionCardKey(id,it.cardId),world,it.id)})
        `when`(cardVersions.findAllById(versions.map {it.id})).thenReturn(versions)
        val before=service.confirmedContext(world,actor,id)
        draft.description="나중에 쓴 초안";draft.draftRevision++
        state.graphVersion++;state.completed=false
        assertEquals(before,service.confirmedContext(world,actor,id))
        assertEquals(world,before.worldId);assertEquals(id,before.revisionId);assertEquals(actor,before.authorizedSubject)
        assertEquals("owner_confirmed_settings",before.scope);assertEquals("확정 설명",before.description)
        assertEquals(3,before.cards.size);assertEquals(1,before.excludedRemovedCardCount)
        assertEquals(metadata,before.cards.single {it.card.title=="목표"}.card.semanticMetadata)
        assertEquals(versions.take(3).map {it.id}.toSet(),before.cards.map {it.versionId}.toSet())
        assertEquals(setOf(person,place),before.cards.filter {it.card.cardType in setOf("character","location")}.map {it.card.id}.toSet())
        assertEquals("not_recorded",before.relationshipStatus);assertFalse(before.currentRelationshipsIncluded);assertFalse(before.completeWorldContext)
        verifyNoInteractions(drafts,cardDrafts,cards,states,graph,requests)
    }

    @Test fun `confirmed context denies other owners and missing foreign or unsealed revisions`() {
        assertThrows(WorldNotFound::class.java) {service.confirmedContext(world,UUID.randomUUID(),UUID.randomUUID())}
        verifyNoInteractions(revisions,revisionCards,cardVersions,graph)
        owned();val id=UUID.randomUUID()
        assertThrows(WorldNotFound::class.java) {service.confirmedContext(world,actor,id)}
        `when`(revisions.findByIdAndWorldId(id,world)).thenReturn(WorldRevision(id=id,worldId=world,revisionNo=1,name="미확정",description="",sealed=false))
        assertThrows(WorldNotFound::class.java) {service.confirmedContext(world,actor,id)}
        verifyNoInteractions(revisionCards,cardVersions,graph)
    }

    // --- 세계관 단위 공개 설정(DEC-45) ---
    private fun publish(entity:StudioWorld,visibility:String,genre:String?):PublicationResponse {
        `when`(worlds.lockOwned(world,actor)).thenReturn(entity)
        return service.publication(world,actor,PublicationRequest(visibility,genre))
    }

    @Test fun `owner publishes with a genre and a world without a saved revision is reported as not listed`() {
        val entity=StudioWorld(world,actor)
        val result=publish(entity,"public","fantasy")
        assertNotNull(entity.publishedAt)
        assertEquals(PublicationResponse(world,"public","fantasy",entity.publishedAt.toString(),false),result)
        assertEquals("public",entity.visibility);assertEquals("fantasy",entity.genre)
        verifyNoInteractions(graph,revisionCards,cardVersions)
    }

    @Test fun `publishing again keeps publishedAt, private clears it, and the genre is stored as sent`() {
        val entity=StudioWorld(world,actor,currentRevisionId=UUID.randomUUID())
        val first=publish(entity,"public","fantasy")
        assertTrue(first.listed)
        val again=publish(entity,"public","sf")
        assertEquals(first.publishedAt,again.publishedAt);assertEquals("sf",again.genre)
        val hidden=publish(entity,"private","sf")
        assertNull(hidden.publishedAt);assertNull(entity.publishedAt);assertFalse(hidden.listed);assertEquals("sf",entity.genre)
        val republished=publish(entity,"public",null)
        assertNotNull(republished.publishedAt);assertNull(republished.genre);assertTrue(republished.listed)
    }

    @Test fun `invalid publication bodies fail as input errors before the world is even locked`() {
        listOf(PublicationRequest(null,null),PublicationRequest("friends",null),PublicationRequest("public","romcom"),PublicationRequest("public"," sf")).forEach {
            assertThrows(IllegalArgumentException::class.java) { service.publication(world,actor,it) }
        }
        verifyNoInteractions(worlds)
    }

    @Test fun `only the owner can change publication`() {
        assertThrows(WorldNotFound::class.java) { service.publication(world,UUID.randomUUID(),PublicationRequest("public",null)) }
    }

    @Test fun `owner summaries and the world detail carry visibility and genre`() {
        owned()
        val entity=StudioWorld(world,actor,visibility="public",genre="sf",publishedAt=java.time.Instant.now())
        `when`(worlds.lockOwned(world,actor)).thenReturn(entity)
        `when`(worlds.findAllByOwnerSubjectOrderByCreatedAtDesc(actor)).thenReturn(listOf(entity))
        val summary=service.list(actor).single()
        assertEquals("public",summary.visibility);assertEquals("sf",summary.genre)
        val detail=service.draft(world,actor)
        assertEquals("public",detail.visibility);assertEquals("sf",detail.genre)
        assertEquals("private",WorldStudioSummaryResponse(world,"n","d",0,"current").visibility)
    }

    @Test fun `owner summaries and the world detail say whether a cover is stored`() {
        owned()
        val entity=StudioWorld(world,actor,coverObjectKey="world-covers/a",coverContentType="image/png")
        `when`(worlds.lockOwned(world,actor)).thenReturn(entity)
        `when`(worlds.findAllByOwnerSubjectOrderByCreatedAtDesc(actor)).thenReturn(listOf(entity))
        assertTrue(service.list(actor).single().hasCover)
        assertTrue(service.draft(world,actor).hasCover)
        entity.coverObjectKey=null;entity.coverContentType=null
        assertFalse(service.list(actor).single().hasCover)
        assertFalse(service.draft(world,actor).hasCover)
    }
    // --- 회차별 관계(DEC-51) ---
    private val cardA=UUID.randomUUID();private val cardB=UUID.randomUUID();private val cardC=UUID.randomUUID()
    private fun cardDraft(id:UUID,lifecycle:String="active")=SettingCardDraft(id,world,CardFields(title="카드",cardType="character",lifecycle=lifecycle))
    private fun at(episode:Int?,vararg relations:RelationshipPayload) {
        `when`(graph.read(world,episode)).thenAnswer { RelationshipStateResult(world,state.graphVersion,state.requestKey,state.requestHash,relations.toList()) }
    }

    @Test fun `the owner reads the relations as of an episode`() {
        owned()
        `when`(cardDrafts.findAllByWorldId(world)).thenReturn(listOf(cardDraft(cardA),cardDraft(cardB)))
        val early=RelationshipPayload(UUID.randomUUID(),cardA,cardB,"structural","초반 관계")
        at(2,early)
        assertEquals(listOf(early),service.draft(world,actor,2).relationships)
        verify(graph).read(world,2)
        assertTrue(service.draft(world,actor).relationships.isEmpty())
        verify(graph).read(world,null)
    }
    @Test fun `a past episode may point at a card that was removed later but never at a foreign one`() {
        owned()
        `when`(cardDrafts.findAllByWorldId(world)).thenReturn(listOf(cardDraft(cardA),cardDraft(cardB,"removed")))
        val past=RelationshipPayload(UUID.randomUUID(),cardA,cardB,"structural","그때는 있던 관계")
        at(2,past)
        assertEquals(listOf(past),service.draft(world,actor,2).relationships)
        at(2,past.copy(targetCardId=cardC))
        assertEquals("RELATIONSHIP_VERSION_MISMATCH",assertThrows(WorldStudioFailure::class.java) { service.draft(world,actor,2) }.code)
    }
    @Test fun `an edit merges with the relations of its episode, saves them there and answers for that episode`() {
        owned()
        `when`(cardDrafts.findAllByWorldId(world)).thenReturn(listOf(cardDraft(cardA),cardDraft(cardB),cardDraft(cardC)))
        val existing=RelationshipPayload(UUID.randomUUID(),cardA,cardB,"structural","3화의 관계")
        val added=RelationshipPayload(UUID.randomUUID(),cardA,cardC,"structural","새 관계")
        at(3,existing)
        val sent=mutableListOf<List<Any?>>()
        doAnswer { sent+=it.arguments.toList();RelationshipStateResult(world,4,state.requestKey,state.requestHash,listOf(existing,added)) }
            .`when`(graph).replace(anyUUID(),anyLong(),anyString(),anyString(),anyList(),anyEpisode())
        val saved=service.edit(world,actor,EditWorldDraftRequest(2,"x","",relationships=listOf(added),key="episode-3",episode=3))
        assertEquals(3,sent.single()[5]);assertEquals(listOf(existing,added),sent.single()[4]);assertEquals(3L,sent.single()[1])
        verify(graph,never()).read(world,null)
        assertEquals(3L,saved.draftRevision)
    }
    @Test fun `an edit without an episode merges with and saves the latest relations`() {
        owned()
        val sent=mutableListOf<List<Any?>>()
        `when`(graph.replace(anyUUID(),anyLong(),anyString(),anyString(),anyList(),anyEpisode())).thenAnswer { sent+=it.arguments.toList();throw WorldStudioFailure.unavailable() }
        assertThrows(WorldStudioFailure::class.java) { service.edit(world,actor,EditWorldDraftRequest(2,"x","",key="latest")) }
        verify(graph).read(world,null)
        assertNull(sent.single()[5]);assertEquals(3L,sent.single()[1]);assertEquals(emptyList<RelationshipPayload>(),sent.single()[4])
    }
    @Test fun `an episode below 1 is an input error before anything is prepared`() {
        owned()
        for(invalid in listOf(0,-1)) assertThrows(IllegalArgumentException::class.java) { service.edit(world,actor,EditWorldDraftRequest(2,"x","",key="bad",episode=invalid)) }
        assertTrue(state.completed);verify(states,never()).flush()
        verify(graph,never()).replace(anyUUID(),anyLong(),anyString(),anyString(),anyList(),anyEpisode())
    }
    @Test fun `an incomplete relationship is rejected as an input error before anything is prepared`() {
        owned()
        val incomplete=RelationshipPayload(UUID.randomUUID(),cardA,null,"structural","끝이 비었다")
        assertThrows(IllegalArgumentException::class.java) { service.edit(world,actor,EditWorldDraftRequest(2,"x","",listOf(CardPayload(cardA,"가","원문","character","basic")),listOf(incomplete),"incomplete")) }
        assertTrue(state.completed);verify(states,never()).flush()
        verify(graph,never()).replace(anyUUID(),anyLong(),anyString(),anyString(),anyList(),anyEpisode())
    }
    private val keptToRemoved=RelationshipPayload(UUID.randomUUID(),cardA,cardB,"structural","B가 삭제되기 전부터 있던 관계")
    private val live=RelationshipPayload(UUID.randomUUID(),cardA,cardC,"structural","살아 있는 관계")
    private fun removedCardB() { `when`(cardDrafts.findAllByWorldId(world)).thenReturn(listOf(cardDraft(cardA),cardDraft(cardB,"removed"),cardDraft(cardC))) }

    @Test fun `an edit that leaves a relation to a removed card as it is still changes the other relations`() {
        owned();removedCardB()
        val changed=live.copy(body="바뀐 내용")
        at(3,keptToRemoved,live)
        val sent=mutableListOf<List<Any?>>()
        doAnswer { sent+=it.arguments.toList();RelationshipStateResult(world,4,state.requestKey,state.requestHash,listOf(keptToRemoved,changed)) }
            .`when`(graph).replace(anyUUID(),anyLong(),anyString(),anyString(),anyList(),anyEpisode())
        val saved=service.edit(world,actor,EditWorldDraftRequest(2,"x","",relationships=listOf(changed),key="keep-removed",episode=3))
        assertEquals(listOf(keptToRemoved,changed),sent.single()[4]);assertEquals(3L,saved.draftRevision)
    }
    @Test fun `a new or changed relation needs two active cards and every relation needs cards of this world`() {
        owned();removedCardB()
        at(3,keptToRemoved,live)
        // 새 관계, 끝점을 삭제 카드로 옮긴 관계, 삭제 카드를 끝점으로 둔 채 내용을 바꾼 관계는 모두 거절한다.
        for(relation in listOf(RelationshipPayload(UUID.randomUUID(),cardC,cardB,"structural","새 관계"),live.copy(targetCardId=cardB),keptToRemoved.copy(body="바뀐 내용")))
            assertThrows(IllegalArgumentException::class.java) { service.edit(world,actor,EditWorldDraftRequest(2,"x","",relationships=listOf(relation),key="removed-end",episode=3)) }
        // 그대로 둔 관계라도 다른 세계관의 카드를 끝점으로 가지면 거절한다.
        at(3,keptToRemoved.copy(targetCardId=UUID.randomUUID()))
        assertThrows(IllegalArgumentException::class.java) { service.edit(world,actor,EditWorldDraftRequest(2,"x","",key="foreign-end",episode=3)) }
        assertTrue(state.completed);verify(states,never()).flush()
        verify(graph,never()).replace(anyUUID(),anyLong(),anyString(),anyString(),anyList(),anyEpisode())
    }
    @Test fun `retrying an acknowledged edit accepts the relation that stays on a removed card`() {
        owned();removedCardB()
        val changed=live.copy(body="바뀐 내용");at(3,keptToRemoved,live)
        val request=EditWorldDraftRequest(2,"x","",relationships=listOf(changed),key="retry-removed",episode=3)
        `when`(graph.replace(anyUUID(),anyLong(),anyString(),anyString(),anyList(),anyEpisode())).thenThrow(WorldStudioFailure.unavailable())
        assertThrows(WorldStudioFailure::class.java) { service.edit(world,actor,request) }
        // Neo4j는 썼지만 응답을 잃었다: 그 회차 관계에 요청이 이미 들어 있다.
        val applied=RelationshipStateResult(world,4,state.requestKey,state.requestHash,listOf(keptToRemoved,changed))
        `when`(graph.read(world,3)).thenReturn(applied)
        doReturn(applied).`when`(graph).replace(anyUUID(),anyLong(),anyString(),anyString(),anyList(),anyEpisode())
        assertEquals(3L,service.edit(world,actor,request).draftRevision)
    }

    // --- 이번 요청이 삭제하는 카드에 이어진 관계(#341) ---
    private fun payload(id:UUID,lifecycle:String="active")=CardPayload(id,"카드","원문","character","basic",lifecycle=lifecycle)
    /** A·B·C가 모두 활성이고 B에 이어진 관계(keptToRemoved)와 살아 있는 관계(live)가 최신(3화 시점도 같다)에 있다. */
    private fun relationOnB() { owned();`when`(cardDrafts.findAllByWorldId(world)).thenReturn(listOf(cardDraft(cardA),cardDraft(cardB),cardDraft(cardC)));at(3,keptToRemoved,live);at(null,keptToRemoved,live) }
    /** 저장소가 [kept]만 남긴 결과를 돌려주게 하고, 저장소로 보낸 인자를 쌓아 돌려준다. */
    private fun graphKeeps(vararg kept:RelationshipPayload):MutableList<List<Any?>> {
        val sent=mutableListOf<List<Any?>>()
        doAnswer { sent+=it.arguments.toList();RelationshipStateResult(world,4,state.requestKey,state.requestHash,kept.toList()) }
            .`when`(graph).replace(anyUUID(),anyLong(),anyString(),anyString(),anyList(),anyEpisode())
        return sent
    }
    private fun nothingPrepared() {
        assertTrue(state.completed);assertEquals(2L,draft.draftRevision);assertEquals("편집본",draft.name)
        verify(states,never()).flush();verify(cards,never()).saveAndFlush(any());verify(cardDrafts,never()).save(any())
        verify(graph,never()).replace(anyUUID(),anyLong(),anyString(),anyString(),anyList(),anyEpisode())
    }

    @Test fun `deleting a card while a relation still ends on it is an input error before anything is prepared`() {
        relationOnB()
        // upsert는 최신 관계를 그대로 두고, replace=true도 같은 관계를 다시 보내면 그대로다.
        val upsert=EditWorldDraftRequest(2,"x","",listOf(payload(cardB,"removed")),key="keep-upsert")
        val replace=EditWorldDraftRequest(2,"x","",listOf(payload(cardA),payload(cardB,"removed"),payload(cardC)),listOf(keptToRemoved,live),"keep-replace",true)
        for(request in listOf(upsert,replace)) assertThrows(IllegalArgumentException::class.java) { service.edit(world,actor,request) }
        nothingPrepared()
    }
    @Test fun `deleting a card while naming an episode is an input error before anything is prepared`() {
        relationOnB()
        // 그 회차에서 B에 이어진 관계를 끝내거나 replace=true로 빼도 거절한다. 그 회차 시점으로는 최신 관계에 B가 남는지 알 수 없다.
        val ended=EditWorldDraftRequest(2,"x","",listOf(payload(cardB,"removed")),listOf(keptToRemoved.copy(lifecycle="removed")),"past-delete",episode=3)
        val omitted=EditWorldDraftRequest(2,"x","",listOf(payload(cardA),payload(cardC)),listOf(live),"past-omit",true,3)
        for(request in listOf(ended,omitted)) assertThrows(IllegalArgumentException::class.java) { service.edit(world,actor,request) }
        nothingPrepared()
    }
    @Test fun `deleting a card on the latest episode is saved once the relation that ends on it is ended or left out`() {
        relationOnB();val sent=graphKeeps(live)
        listOf(
            EditWorldDraftRequest(2,"x","",listOf(payload(cardB,"removed")),listOf(keptToRemoved.copy(lifecycle="removed")),"end-relation"),
            EditWorldDraftRequest(2,"x","",listOf(payload(cardA),payload(cardB,"removed"),payload(cardC)),listOf(live),"omit-relation",true),
        ).forEach { request ->
            assertEquals(3L,service.edit(world,actor,request).draftRevision);assertEquals(listOf(live),sent.last()[4])
            draft.draftRevision=2;state.graphVersion=3 // 다음 요청이 같은 처음 상태에서 시작하게 한다.
        }
    }
    @Test fun `a relation that stays on a card deleted earlier does not block deleting another card`() {
        owned();removedCardB();at(null,keptToRemoved,live);val sent=graphKeeps(keptToRemoved)
        val saved=service.edit(world,actor,EditWorldDraftRequest(2,"x","",listOf(payload(cardC,"removed")),listOf(live.copy(lifecycle="removed")),"delete-another"))
        assertEquals(listOf(keptToRemoved),sent.single()[4]);assertEquals(3L,saved.draftRevision)
    }

    @Test fun `a retry is not rejected for relations the graph already holds`() {
        relationOnB()
        val request=EditWorldDraftRequest(2,"x","",listOf(payload(cardB,"removed")),listOf(keptToRemoved.copy(lifecycle="removed")),"retry-delete")
        `when`(graph.replace(anyUUID(),anyLong(),anyString(),anyString(),anyList(),anyEpisode())).thenThrow(WorldStudioFailure.unavailable())
        assertThrows(WorldStudioFailure::class.java) { service.edit(world,actor,request) }
        // Neo4j는 썼지만 응답을 잃었다. 이 규칙 전의 저장이 B에 이어진 관계를 남긴 채 써졌어도, 이미 쓴 요청은 재시도로 끝낼 수 있어야 한다.
        val applied=RelationshipStateResult(world,4,state.requestKey,state.requestHash,listOf(keptToRemoved,live))
        `when`(graph.read(world,null)).thenReturn(applied)
        doReturn(applied).`when`(graph).replace(anyUUID(),anyLong(),anyString(),anyString(),anyList(),anyEpisode())
        assertEquals(3L,service.edit(world,actor,request).draftRevision)
    }
}
