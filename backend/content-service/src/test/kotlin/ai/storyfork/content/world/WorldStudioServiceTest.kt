package ai.storyfork.content.world

import ai.storyfork.content.world.domain.WorldConflict
import ai.storyfork.content.world.domain.WorldNotFound
import ai.storyfork.content.world.domain.WorldRestoreBlocked
import ai.storyfork.content.world.domain.WorldStudioFailure
import ai.storyfork.content.world.relationship.Neo4jRelationshipRepository
import ai.storyfork.content.world.studio.entity.*
import ai.storyfork.content.world.studio.repository.*
import ai.storyfork.content.world.service.WorldStudioService
import ai.storyfork.content.world.service.GenreTemplateRepair
import ai.storyfork.content.world.service.GenreTemplateSeeder
import ai.storyfork.content.world.service.GenreTemplate
import ai.storyfork.content.world.service.GenreTemplateCard
import ai.storyfork.content.world.service.dto.*
import java.security.MessageDigest
import java.util.Optional
import java.util.UUID
import org.junit.jupiter.api.Assertions.*
import org.junit.jupiter.api.Test
import org.mockito.ArgumentCaptor
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
    private val templatePublications=mock(TemplatePublicationOnceRepository::class.java)
    private val expandedSeeds=mock(ExpandedSeedProgressRepository::class.java)
    private val images=mock(SettingCardImageRepository::class.java)
    private val graph=mock(Neo4jRelationshipRepository::class.java)
    private val manager=mock(PlatformTransactionManager::class.java).also {
        `when`(it.getTransaction(any())).thenAnswer { SimpleTransactionStatus() }
    }
    private val mapper=JsonMapper.builder().addModule(KotlinModule.Builder().build()).build()
    private val service=WorldStudioService(worlds,drafts,cards,cardDrafts,cardVersions,revisions,revisionCards,requests,states,templatePublications,expandedSeeds,mock(InitialWorldApplicationRepository::class.java),images,graph,manager,mapper)
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
    @Test fun `active expansion rejects ordinary edits saves and publication`() {
        owned()
        `when`(expandedSeeds.findById(world)).thenReturn(Optional.of(ExpandedSeedProgress(world,"hash")))
        assertThrows(WorldConflict::class.java) { service.edit(world,actor,EditWorldDraftRequest(2,"x","",key="author")) }
        assertThrows(WorldConflict::class.java) { service.save(world,actor,SaveWorldRequest(2,"save")) }
        assertThrows(WorldConflict::class.java) { service.publication(world,actor,PublicationRequest("private",null)) }
        val input=ai.storyfork.content.world.service.InitialWorldInput("v1",UUID.randomUUID(),world,
            ai.storyfork.content.world.service.InitialWorldBasis(2,3,null,"hash"),emptyList(),emptyList())
        assertThrows(WorldConflict::class.java) { service.withInitialWorldInput(actor,input) { it } }
        verify(graph,never()).replace(anyUUID(),anyLong(),anyString(),anyString(),anyList(),anyEpisode())
    }
    @Test fun `review draft rejects an unfinished expansion and succeeds after completion`() {
        owned()
        val progress=ExpandedSeedProgress(world,"hash")
        `when`(expandedSeeds.findById(world)).thenReturn(Optional.of(progress))
        assertThrows(WorldConflict::class.java) { service.draftForReview(world,actor) }
        progress.completed=true
        assertEquals(draft.draftRevision,service.draftForReview(world,actor).draftRevision)
    }
    @Test fun `review draft rejects expansion that starts during graph read`() {
        owned()
        `when`(expandedSeeds.findById(world)).thenReturn(Optional.empty(),Optional.of(ExpandedSeedProgress(world,"hash")))
        assertThrows(WorldConflict::class.java) { service.draftForReview(world,actor) }
    }
    @Test fun `expanded creation ignores preexisting world and retries its own incomplete creation`() {
        val owner=GenreTemplateSeeder.TEMPLATE_OWNER
        val request=CreateWorldRequest("신규","설명",world)
        var entity:StudioWorld?=StudioWorld(world,owner)
        var marker:ExpandedSeedProgress?=null
        var savedDraft:WorldDraft?=null
        var savedState:WorldRelationshipState?=null
        `when`(worlds.findById(world)).thenAnswer { Optional.ofNullable(entity) }
        `when`(worlds.lockOwned(world,owner)).thenAnswer { entity }
        `when`(expandedSeeds.findById(world)).thenAnswer { Optional.ofNullable(marker) }
        `when`(worlds.saveAndFlush(any())).thenAnswer { (it.arguments[0] as StudioWorld).also { value -> entity=value } }
        `when`(expandedSeeds.saveAndFlush(any())).thenAnswer { (it.arguments[0] as ExpandedSeedProgress).also { value -> marker=value } }
        `when`(drafts.saveAndFlush(any())).thenAnswer { (it.arguments[0] as WorldDraft).also { value -> savedDraft=value } }
        `when`(states.saveAndFlush(any())).thenAnswer { (it.arguments[0] as WorldRelationshipState).also { value -> savedState=value } }
        `when`(drafts.findById(world)).thenAnswer { Optional.ofNullable(savedDraft) }
        `when`(states.findById(world)).thenAnswer { Optional.ofNullable(savedState) }
        var fail=true
        doAnswer { if(fail) { fail=false;throw WorldStudioFailure.unavailable() }
            RelationshipStateResult(world,0,it.arguments[2] as String,it.arguments[3] as String,emptyList())
        }.`when`(graph).replace(anyUUID(),anyLong(),anyString(),anyString(),anyList(),anyEpisode())
        assertNull(service.startExpanded(request,"digest"))
        verify(worlds,never()).saveAndFlush(any())
        entity=null
        assertThrows(WorldStudioFailure::class.java) { service.startExpanded(request,"digest") }
        assertNotNull(marker)
        assertEquals(0,service.startExpanded(request,"digest"))
        assertThrows(WorldConflict::class.java) { service.startExpanded(request,"different") }
        assertEquals(0,marker!!.nextChunk)
    }
    @Test fun `expanded chunk cannot overwrite a missing marker changed digest or owner choice`() {
        val owner=GenreTemplateSeeder.TEMPLATE_OWNER
        val entity=StudioWorld(world,owner)
        val marker=ExpandedSeedProgress(world,"original")
        `when`(worlds.lockOwned(world,owner)).thenReturn(entity)
        `when`(drafts.findById(world)).thenReturn(Optional.of(WorldDraft(worldId=world,name="세계")))
        `when`(states.findById(world)).thenReturn(Optional.of(state))
        val request=EditWorldDraftRequest(0,"세계","",key="expanded-$world-0")
        `when`(expandedSeeds.findById(world)).thenReturn(Optional.empty())
        assertThrows(WorldConflict::class.java) { service.editExpanded(world,"original",0,request) }
        `when`(expandedSeeds.findById(world)).thenReturn(Optional.of(marker))
        assertThrows(WorldConflict::class.java) { service.editExpanded(world,"changed",0,request) }
        entity.ownerMetadataVersion=1
        assertThrows(WorldConflict::class.java) { service.editExpanded(world,"original",0,request) }
        verify(graph,never()).replace(anyUUID(),anyLong(),anyString(),anyString(),anyList(),anyEpisode())
    }
    @Test fun `sample creation retry preserves hash and later private choice while ordinary worlds remain private`() {
        val template = GenreTemplateSeeder(mock(WorldStudioService::class.java), mapper).loadLegacy().first()
        val id = template.worldId
        val owner = GenreTemplateSeeder.TEMPLATE_OWNER
        var storedWorld: StudioWorld? = null
        var storedDraft: WorldDraft? = null
        var storedState: WorldRelationshipState? = null
        `when`(worlds.findById(id)).thenAnswer { Optional.ofNullable(storedWorld) }
        `when`(worlds.lockOwned(id, owner)).thenAnswer { storedWorld?.takeIf { w -> w.ownerSubject == owner } }
        `when`(worlds.saveAndFlush(any())).thenAnswer { (it.arguments[0] as StudioWorld).also { w -> storedWorld = w } }
        `when`(drafts.saveAndFlush(any())).thenAnswer { (it.arguments[0] as WorldDraft).also { d -> storedDraft = d } }
        `when`(states.saveAndFlush(any())).thenAnswer { (it.arguments[0] as WorldRelationshipState).also { s -> storedState = s } }
        `when`(drafts.findById(id)).thenAnswer { Optional.ofNullable(storedDraft) }
        `when`(states.findById(id)).thenAnswer { Optional.ofNullable(storedState) }
        var interrupted = true
        doAnswer {
            if (interrupted) { interrupted = false; throw WorldStudioFailure.unavailable() }
            RelationshipStateResult(id, 0, it.arguments[2] as String, it.arguments[3] as String, emptyList())
        }.`when`(graph).replace(anyUUID(), anyLong(), anyString(), anyString(), anyList(), anyEpisode())
        `when`(graph.read(id)).thenAnswer { RelationshipStateResult(id, 0, storedState!!.requestKey, storedState!!.requestHash, emptyList()) }
        assertThrows(WorldStudioFailure::class.java) { service.createTemplate(CreateWorldRequest(template.name, template.description, id)) }
        assertEquals("public", storedWorld!!.visibility)
        assertNotNull(storedWorld!!.publishedAt)
        verify(templatePublications).saveAndFlush(any())
        val hash = storedState!!.creationHash
        val request = CreateWorldRequest(template.name, template.description, id)
        val originalHash = MessageDigest.getInstance("SHA-256").digest(mapper.writeValueAsBytes(listOf("create", id, request)))
            .joinToString("") { "%02x".format(it) }
        assertEquals(originalHash, hash)
        assertEquals("public", service.createTemplate(CreateWorldRequest(template.name, template.description, id)).visibility)
        assertEquals(hash, storedState!!.creationHash)
        storedWorld!!.currentRevisionId = UUID.randomUUID()
        storedWorld!!.visibility = "private"
        storedWorld!!.publishedAt = null
        repeat(2) { assertEquals("private", service.createTemplate(CreateWorldRequest(template.name, template.description, id)).visibility) }
        assertThrows(WorldConflict::class.java) { service.createTemplate(request.copy(description = "다른 입력")) }
        storedWorld = StudioWorld(id, UUID.randomUUID(), visibility = "private")
        assertThrows(WorldNotFound::class.java) { service.createTemplate(CreateWorldRequest(template.name, template.description, id)) }
        assertEquals("private", storedWorld!!.visibility)

        val ordinary = UUID.randomUUID()
        `when`(worlds.findById(ordinary)).thenReturn(Optional.empty())
        interrupted = true
        assertThrows(WorldStudioFailure::class.java) { service.create(actor, CreateWorldRequest("일반 세계관", id = ordinary)) }
        assertEquals("private", storedWorld!!.visibility)
        assertNull(storedWorld!!.publishedAt)
    }
    @Test fun `soul repair persists through real edit and save after graph interruption`() {
        val owner = GenreTemplateSeeder.TEMPLATE_OWNER
        val oldCard = GenreTemplateCard(UUID.randomUUID(), "이전 카드", "이전 본문", "other")
        val character = GenreTemplateCard(UUID.randomUUID(), "인물", "인물의 정체성", "character")
        val setting = GenreTemplateCard(UUID.randomUUID(), "장소", "장소의 본문", "location")
        val legacy = GenreTemplate("test", world, "세계", "설명", listOf(oldCard))
        val baseline = legacy.copy(cards = listOf(character, setting))
        val target = baseline.copy(cards = listOf(character.copy(soul = "차분하게 말한다"), setting))
        val previousId = UUID.randomUUID()
        val baselineId = UUID.randomUUID()
        val studioWorld = StudioWorld(world, owner, baselineId)
        draft.name = baseline.name; draft.description = baseline.description
        draft.draftRevision = 4; draft.baseWorldRevisionId = baselineId
        state.graphVersion = 2; state.completed = true
        val oldPayload = CardPayload(oldCard.id, oldCard.title, oldCard.body, oldCard.cardType, "basic", visibility = "public")
        val baselinePayload = GenreTemplateRepair.payloads(baseline) + oldPayload.copy(lifecycle = "removed")
        fun fields(card: CardPayload) = CardFields(card.title, card.body, card.cardType, card.areaCode, card.classification,
            card.aliases, card.tags, card.semanticMetadata, card.visibility, card.lifecycle)
        val stored = baselinePayload.associate { it.id to SettingCardDraft(it.id, world, fields(it)) }.toMutableMap()
        val first = WorldRevision(previousId, world, 1, legacy.name, legacy.description, sealed = true)
        val second = WorldRevision(baselineId, world, 2, baseline.name, baseline.description, previousId, sealed = true)
        val storedRevisions = mutableMapOf(previousId to first, baselineId to second)
        val firstVersions = listOf(SettingCardVersion(cardId = oldCard.id, worldId = world, versionNo = 1, fields = fields(oldPayload)))
        val secondVersions = baselinePayload.map { SettingCardVersion(cardId = it.id, worldId = world,
            versionNo = if (it.id == oldCard.id) 2 else 1, fields = fields(it)) }
        val storedVersions = (firstVersions + secondVersions).associateBy { it.id }.toMutableMap()
        val manifests = mutableMapOf(
            previousId to firstVersions.map { WorldRevisionCard(RevisionCardKey(previousId, it.cardId), world, it.id) },
            baselineId to secondVersions.map { WorldRevisionCard(RevisionCardKey(baselineId, it.cardId), world, it.id) },
        )
        `when`(worlds.lockOwned(world, owner)).thenReturn(studioWorld)
        `when`(drafts.findById(world)).thenReturn(Optional.of(draft))
        `when`(states.findById(world)).thenReturn(Optional.of(state))
        `when`(cardDrafts.findAllByWorldId(world)).thenAnswer { stored.values.toList() }
        `when`(cardDrafts.findById(anyUUID())).thenAnswer { Optional.ofNullable(stored[it.arguments[0] as UUID]) }
        `when`(cardDrafts.save(any())).thenAnswer { (it.arguments[0] as SettingCardDraft).also { value -> stored[value.cardId] = value } }
        `when`(cards.findById(anyUUID())).thenAnswer { Optional.of(SettingCard(it.arguments[0] as UUID, world)) }
        `when`(revisions.findByIdAndWorldId(anyUUID(), anyUUID())).thenAnswer { storedRevisions[it.arguments[0] as UUID] }
        `when`(revisions.findFirstByWorldIdOrderByRevisionNoDesc(world)).thenReturn(second)
        `when`(revisions.saveAndFlush(any())).thenAnswer { (it.arguments[0] as WorldRevision).also { value -> storedRevisions[value.id] = value } }
        `when`(cardVersions.findAllById(any<Iterable<UUID>>())).thenAnswer { (it.arguments[0] as Iterable<UUID>).map { id -> storedVersions.getValue(id) } }
        `when`(cardVersions.versionNumbers(world)).thenReturn(listOf(arrayOf(oldCard.id, 2L), arrayOf(character.id, 1L), arrayOf(setting.id, 1L)))
        `when`(cardVersions.saveAll(any<Iterable<SettingCardVersion>>())).thenAnswer {
            (it.arguments[0] as Iterable<SettingCardVersion>).toList().also { values -> values.forEach { value -> storedVersions[value.id] = value } }
        }
        `when`(revisionCards.findAllByIdRevisionId(anyUUID())).thenAnswer { manifests[it.arguments[0] as UUID].orEmpty() }
        `when`(revisionCards.saveAll(any<Iterable<WorldRevisionCard>>())).thenAnswer {
            (it.arguments[0] as Iterable<WorldRevisionCard>).toList().also { values -> manifests[values.first().id.revisionId] = values }
        }
        var graphVersion = 2L
        var interrupted = true
        `when`(graph.read(world)).thenAnswer { RelationshipStateResult(world, graphVersion, state.requestKey, state.requestHash, emptyList()) }
        doAnswer {
            if (interrupted) { interrupted = false; throw WorldStudioFailure.unavailable() }
            graphVersion = 3
            RelationshipStateResult(world, graphVersion, it.arguments[2] as String, it.arguments[3] as String, emptyList())
        }.`when`(graph).replace(anyUUID(), anyLong(), anyString(), anyString(), anyList(), anyEpisode())
        val repair = GenreTemplateRepair(service)
        assertThrows(WorldStudioFailure::class.java) { repair.repairSoul(legacy, baseline, target) }
        assertFalse(state.completed)
        assertEquals(4L, draft.draftRevision)
        assertEquals(baselineId, studioWorld.currentRevisionId)
        assertEquals(baselinePayload.toSet(), service.revision(world, owner, baselineId).cards.map { it.card }.toSet())
        val pendingHash = state.requestHash
        repair.repairSoul(legacy, baseline, target)
        assertTrue(state.completed)
        assertEquals(pendingHash, state.requestHash)
        val result = service.draft(world, owner)
        val saved = service.revision(world, owner, studioWorld.currentRevisionId!!)
        val expectedDocs = mapOf("soul" to "차분하게 말한다", "goal" to "", "episodes" to emptyMap<String, String>())
        assertEquals(6L, result.draftRevision)
        assertEquals(3L, saved.revisionNo)
        assertEquals(baselineId, saved.parentRevisionId)
        assertEquals(result.cards.toSet(), saved.cards.map { it.card }.toSet())
        assertEquals((GenreTemplateRepair.soulPayloads(target) + oldPayload.copy(lifecycle = "removed")).toSet(), result.cards.toSet())
        assertEquals(setOf(character.id, setting.id, oldCard.id), result.cards.map { it.id }.toSet())
        assertEquals(2L, saved.cards.single { it.card.id == character.id }.versionNo)
        assertEquals(3L, saved.cards.single { it.card.id == oldCard.id }.versionNo)
        assertEquals(expectedDocs, result.cards.single { it.id == character.id }.semanticMetadata["characterDocs"])
        assertEquals(expectedDocs, saved.cards.single { it.card.id == character.id }.card.semanticMetadata["characterDocs"])
        assertEquals(character.body, result.cards.single { it.id == character.id }.body)
        assertEquals(oldPayload.copy(lifecycle = "removed"), result.cards.single { it.id == oldCard.id })
        assertEquals(oldPayload.copy(lifecycle = "removed"), saved.cards.single { it.card.id == oldCard.id }.card)
        assertEquals(oldPayload, service.revision(world, owner, previousId).cards.single().card)
        assertEquals(baselinePayload.toSet(), service.revision(world, owner, baselineId).cards.map { it.card }.toSet())
        repair.repairSoul(legacy, baseline, target)
        verify(graph, times(2)).replace(anyUUID(), anyLong(), anyString(), anyString(), anyList(), anyEpisode())
    }
    @Test fun `template repair replaces old active cards while retaining their history and retrying`() {
        val seeder = GenreTemplateSeeder(mock(WorldStudioService::class.java), mapper)
        val legacy = seeder.loadLegacy().first().copy(worldId = world)
        val target = seeder.load().first().copy(worldId = world)
        val owner = GenreTemplateSeeder.TEMPLATE_OWNER
        val revisionId = UUID.randomUUID()
        val studioWorld = StudioWorld(world, owner, revisionId)
        draft.name = legacy.name; draft.description = legacy.description; draft.baseWorldRevisionId = revisionId
        val stored = legacy.cards.associate { c -> c.id to SettingCardDraft(c.id, world,
            CardFields(c.title, c.body, c.cardType, "basic", visibility = "public")) }.toMutableMap()
        `when`(worlds.lockOwned(world, owner)).thenReturn(studioWorld)
        `when`(drafts.findById(world)).thenReturn(Optional.of(draft))
        `when`(states.findById(world)).thenReturn(Optional.of(state))
        `when`(cardDrafts.findAllByWorldId(world)).thenAnswer { stored.values.toList() }
        `when`(cardDrafts.findById(anyUUID())).thenAnswer { Optional.ofNullable(stored[it.arguments[0] as UUID]) }
        `when`(cardDrafts.save(any())).thenAnswer { val c = it.arguments[0] as SettingCardDraft; stored[c.cardId] = c; c }
        `when`(cards.findById(anyUUID())).thenReturn(Optional.empty())
        `when`(cards.saveAndFlush(any())).thenAnswer { it.arguments[0] }
        `when`(graph.read(world)).thenAnswer { RelationshipStateResult(world, state.graphVersion, state.requestKey, state.requestHash, emptyList()) }
        doAnswer { RelationshipStateResult(world, 4, it.arguments[2] as String, it.arguments[3] as String, emptyList()) }
            .`when`(graph).replace(anyUUID(), anyLong(), anyString(), anyString(), anyList(), anyEpisode())
        val previous = WorldRevision(revisionId, world, 1, legacy.name, legacy.description, sealed = true)
        val previousVersions = legacy.cards.map { SettingCardVersion(cardId = it.id, worldId = world, versionNo = 1,
            fields = CardFields(it.title, it.body, it.cardType, "basic", visibility = "public")) }
        var next: WorldRevision? = null
        var versions = emptyList<SettingCardVersion>()
        var manifest = emptyList<WorldRevisionCard>()
        `when`(revisions.findFirstByWorldIdOrderByRevisionNoDesc(world)).thenReturn(previous)
        `when`(revisions.saveAndFlush(any())).thenAnswer { (it.arguments[0] as WorldRevision).also { value -> next = value } }
        `when`(revisions.findByIdAndWorldId(anyUUID(), anyUUID())).thenAnswer { next?.takeIf { revision -> revision.id == it.arguments[0] } }
        `when`(cardVersions.saveAll(any<Iterable<SettingCardVersion>>())).thenAnswer { (it.arguments[0] as Iterable<SettingCardVersion>).toList().also { value -> versions = value } }
        `when`(revisionCards.saveAll(any<Iterable<WorldRevisionCard>>())).thenAnswer { (it.arguments[0] as Iterable<WorldRevisionCard>).toList().also { value -> manifest = value } }
        `when`(revisionCards.findAllByIdRevisionId(anyUUID())).thenAnswer { manifest }
        `when`(cardVersions.findAllById(any<Iterable<UUID>>())).thenAnswer { versions }
        val realService = spy(service)
        val key = "genre-template-${legacy.genre}-repair-v2"
        doThrow(WorldStudioFailure.unavailable()).doCallRealMethod()
            .`when`(realService).save(world, owner, SaveWorldRequest(3, key))

        assertThrows(WorldStudioFailure::class.java) { GenreTemplateRepair(realService).repair(legacy, target) }
        assertEquals(target.cards.map { it.id }.toSet(), stored.values.filter { it.fields.lifecycle == "active" }.map { it.cardId }.toSet())
        assertEquals(legacy.cards.map { it.id }.toSet(), stored.values.filter { it.fields.lifecycle == "removed" }.map { it.cardId }.toSet())
        assertEquals(revisionId, studioWorld.currentRevisionId)
        assertEquals(revisionId, draft.baseWorldRevisionId)
        verifyNoInteractions(revisions, revisionCards, cardVersions)
        GenreTemplateRepair(realService).repair(legacy, target)
        verify(realService, times(2)).save(world, owner, SaveWorldRequest(3, key))
        assertEquals(revisionId, next!!.parentRevisionId)
        assertEquals(next!!.id, studioWorld.currentRevisionId)
        assertTrue(previous.sealed)
        assertEquals(legacy.cards.map { it.body }, previousVersions.map { it.fields.body })
        assertEquals(legacy.cards.map { it.id }.toSet(), versions.filter { it.fields.lifecycle == "removed" }.map { it.cardId }.toSet())
        assertEquals(target.cards.map { it.id }.toSet(), versions.filter { it.fields.lifecycle == "active" }.map { it.cardId }.toSet())
    }
    private data class TemplateFixture(val template: GenreTemplate, val world: StudioWorld, val draft: WorldDraft,
        val state: WorldRelationshipState, val cards: List<SettingCardDraft>, val marked: MutableSet<UUID>)
    private fun pristineTemplateFixture(historical:GenreTemplate?=null): TemplateFixture {
        val template=historical ?: GenreTemplateSeeder(mock(WorldStudioService::class.java),mapper).loadLegacy().first()
        val id=template.worldId; val owner=GenreTemplateSeeder.TEMPLATE_OWNER; val saved=UUID.randomUUID()
        val world=StudioWorld(id,owner,saved); val draft=WorldDraft(id,template.name,template.description,2,saved)
        val payloads=if(historical==null) template.cards.map { CardPayload(it.id,it.title,it.body,it.cardType,"basic",visibility="public") }
            else GenreTemplateRepair.soulPayloads(template)
        val key="genre-template-${template.genre}"
        val edit=EditWorldDraftRequest(0,template.name,template.description,payloads,key=key)
        fun hash(op:String,value:Any)=MessageDigest.getInstance("SHA-256").digest(mapper.writeValueAsBytes(listOf(op,id,value)))
            .joinToString("") { "%02x".format(it) }
        val state=WorldRelationshipState(id,1,hash("create",CreateWorldRequest(template.name,template.description,id)),
            key,hash("edit",edit),0,true)
        val drafts=payloads.map { SettingCardDraft(it.id,id,CardFields(it.title,it.body,it.cardType,it.areaCode,it.classification,it.aliases,it.tags,it.semanticMetadata,it.visibility,it.lifecycle)) }
        val versions=drafts.map { SettingCardVersion(cardId=it.cardId,worldId=id,versionNo=1,fields=it.fields) }
        val revision=WorldRevision(saved,id,1,template.name,template.description,sealed=true)
        val save=WorldSaveRequest(WorldSaveKey(id,key),hash("save",SaveWorldRequest(1,key)),saved)
        val marked=mutableSetOf<UUID>()
        `when`(worlds.findById(id)).thenReturn(Optional.of(world))
        `when`(worlds.lockOwned(id,owner)).thenReturn(world)
        `when`(this.drafts.findById(id)).thenReturn(Optional.of(draft))
        `when`(states.findById(id)).thenReturn(Optional.of(state))
        `when`(cardDrafts.findAllByWorldId(id)).thenReturn(drafts)
        `when`(cards.findAllByWorldId(id)).thenReturn(payloads.map { SettingCard(it.id,id) })
        `when`(cardVersions.findAllByWorldId(id)).thenReturn(versions)
        `when`(cardVersions.findAllById(any<Iterable<UUID>>())).thenReturn(versions)
        `when`(revisions.findAllByWorldId(id)).thenReturn(listOf(revision))
        `when`(revisions.findByIdAndWorldId(saved,id)).thenReturn(revision)
        `when`(revisionCards.findAllByIdRevisionId(saved)).thenReturn(versions.map { WorldRevisionCard(RevisionCardKey(saved,it.cardId),id,it.id) })
        `when`(requests.findAllByIdWorldId(id)).thenReturn(listOf(save))
        `when`(graph.read(id)).thenAnswer { RelationshipStateResult(id,state.graphVersion,state.requestKey,state.requestHash,emptyList()) }
        `when`(graph.readWithHistory(id)).thenAnswer { RelationshipStateResult(id,state.graphVersion,state.requestKey,state.requestHash,emptyList()) to false }
        `when`(templatePublications.existsById(id)).thenAnswer { id in marked }
        `when`(templatePublications.saveAndFlush(any())).thenAnswer { (it.arguments[0] as TemplatePublicationOnce).also { m -> marked.add(m.worldId) } }
        return TemplateFixture(template,world,draft,state,drafts,marked)
    }
    @Test fun `existing original expands only after verifying its untouched history and publication marker`() {
        val f=pristineTemplateFixture()
        f.world.visibility="public";f.world.publishedAt=java.time.Instant.now();f.marked.add(f.world.id)
        var progress:ExpandedSeedProgress?=null
        `when`(expandedSeeds.findById(f.world.id)).thenAnswer { Optional.ofNullable(progress) }
        `when`(expandedSeeds.saveAndFlush(any())).thenAnswer { (it.arguments[0] as ExpandedSeedProgress).also { value -> progress=value } }
        assertEquals(0,service.startPristineExpanded("digest",f.template,null,null))
        assertEquals(f.draft.draftRevision,progress!!.baseDraftRevision)
        assertEquals(f.state.graphVersion,progress!!.baseGraphVersion)
        assertEquals(f.world.currentRevisionId,progress!!.baseRevisionId)
        assertEquals("public",f.world.visibility)
        f.world.ownerMetadataVersion=1
        assertThrows(WorldConflict::class.java) { service.startPristineExpanded("digest",f.template,null,null) }
    }
    @Test fun `unmarked saved historical original can start expansion without changing private choice`() {
        val history=ai.storyfork.content.world.service.GenreTemplate("korea_history",UUID.randomUUID(),"역사","설명",
            listOf(GenreTemplateCard(UUID.randomUUID(),"옛 카드","본문","other")))
        val f=pristineTemplateFixture(history)
        var progress:ExpandedSeedProgress?=null
        `when`(expandedSeeds.findById(history.worldId)).thenAnswer { Optional.ofNullable(progress) }
        `when`(expandedSeeds.saveAndFlush(any())).thenAnswer { (it.arguments[0] as ExpandedSeedProgress).also { value -> progress=value } }
        assertEquals(0,service.startHistoricalExpanded(CreateWorldRequest("확장","설명",history.worldId),"digest",historicalFixture(history,mapper)))
        assertEquals("private",f.world.visibility);assertEquals(f.world.currentRevisionId,progress!!.baseRevisionId)
    }
    @Test fun `historical public setting before publication tracking is preserved`() {
        val history=GenreTemplate("usa_history",UUID.randomUUID(),"역사","설명",listOf(GenreTemplateCard(UUID.randomUUID(),"옛 카드","본문","other")))
        val f=pristineTemplateFixture(history);f.world.visibility="public";f.world.publishedAt=java.time.Instant.now()
        var progress:ExpandedSeedProgress?=null
        `when`(expandedSeeds.findById(history.worldId)).thenAnswer { Optional.ofNullable(progress) }
        `when`(expandedSeeds.saveAndFlush(any())).thenAnswer { (it.arguments[0] as ExpandedSeedProgress).also { value -> progress=value } }
        assertEquals(0,service.startHistoricalExpanded(CreateWorldRequest("확장","설명",history.worldId),"digest",historicalFixture(history,mapper)))
        assertEquals("public",f.world.visibility);assertEquals("public",progress!!.baseVisibility)
    }
    @Test fun `historical fingerprints reject changes to body soul ids order version and request history`() {
        for (change in listOf("body","soul","delete","id","order","version","request")) {
            reset(templatePublications)
            val history=GenreTemplate("korea_history",UUID.randomUUID(),"역사","설명",listOf(
                GenreTemplateCard(UUID.randomUUID(),"인물","본문","character","성격"),
                GenreTemplateCard(UUID.randomUUID(),"장소","내용","location")))
            val f=pristineTemplateFixture(history)
            var fingerprint=historicalFixture(history,mapper)
            `when`(expandedSeeds.findById(history.worldId)).thenReturn(Optional.empty())
            when(change) {
                "body" -> f.cards[0].fields.body+="x"
                "soul" -> f.cards[0].fields.semanticMetadata=f.cards[0].fields.semanticMetadata +
                    ("characterDocs" to mapOf("soul" to "성격x","goal" to "","episodes" to emptyMap<String,String>()))
                "delete" -> `when`(cardDrafts.findAllByWorldId(history.worldId)).thenReturn(f.cards.drop(1))
                "id" -> fingerprint=fingerprint.copy(cards=listOf(fingerprint.cards[0].copy(id=UUID.randomUUID()),fingerprint.cards[1]))
                "order" -> fingerprint=fingerprint.copy(cards=fingerprint.cards.reversed())
                "version" -> {
                    val versions=cardVersions.findAllByWorldId(history.worldId)
                    val changed=versions.mapIndexed { index,v -> if(index==0) SettingCardVersion(v.id,v.cardId,v.worldId,2,v.fields) else v }
                    `when`(cardVersions.findAllById(any<Iterable<UUID>>())).thenReturn(changed)
                }
                "request" -> `when`(requests.findAllByIdWorldId(history.worldId)).thenReturn(emptyList())
            }
            assertNull(service.startHistoricalExpanded(CreateWorldRequest("확장","설명",history.worldId),"digest",fingerprint),change)
            verify(expandedSeeds,never()).saveAndFlush(any())
        }
    }
    @Test fun `existing expansion holds changed cards or any relationship history`() {
        val f=pristineTemplateFixture();f.marked.add(f.world.id)
        `when`(expandedSeeds.findById(f.world.id)).thenReturn(Optional.empty())
        f.cards.first().fields.body="사용자 변경"
        assertNull(service.startPristineExpanded("digest",f.template,null,null))
        f.cards.first().fields.body=f.template.cards.first().body
        `when`(graph.readWithHistory(f.world.id)).thenReturn(RelationshipStateResult(f.world.id,f.state.graphVersion,
            f.state.requestKey,f.state.requestHash,emptyList()) to true)
        assertNull(service.startPristineExpanded("digest",f.template,null,null))
        verify(expandedSeeds,never()).saveAndFlush(any())
    }
    @Test fun `pristine private template is published once and later private choice survives`() {
        val f=pristineTemplateFixture()
        service.publishPristineTemplate(f.template,null,null)
        assertEquals("public",f.world.visibility);assertNotNull(f.world.publishedAt);assertTrue(f.template.worldId in f.marked)
        f.world.visibility="private";f.world.publishedAt=null
        service.publishPristineTemplate(f.template,null,null)
        assertEquals("private",f.world.visibility);assertNull(f.world.publishedAt)
    }
    @Test fun `changed or private cards are permanently skipped even if restored`() {
        val f=pristineTemplateFixture();f.cards.first().fields.visibility="private"
        service.publishPristineTemplate(f.template,null,null)
        assertEquals("private",f.world.visibility);assertTrue(f.template.worldId in f.marked)
        f.cards.first().fields.visibility="public"
        service.publishPristineTemplate(f.template,null,null)
        assertEquals("private",f.world.visibility)
    }
    @Test fun `current genre and cover or altered history prevent publication`() {
        val f=pristineTemplateFixture();f.world.genre="fantasy"
        service.publishPristineTemplate(f.template,null,null)
        assertEquals("private",f.world.visibility);assertTrue(f.template.worldId in f.marked)
    }
    @Test fun `mismatched original creation hash is excluded`() {
        val f=pristineTemplateFixture();val state=WorldRelationshipState(f.template.worldId,1,"wrong",f.state.requestKey,f.state.requestHash,0,true)
        `when`(states.findById(f.template.worldId)).thenReturn(Optional.of(state))
        service.publishPristineTemplate(f.template,null,null)
        assertEquals("private",f.world.visibility);assertTrue(f.template.worldId in f.marked)
    }
    @Test fun `already public template keeps genre and publication time`() {
        val f=pristineTemplateFixture();f.world.visibility="public";f.world.genre="sf";f.world.publishedAt=java.time.Instant.EPOCH
        service.publishPristineTemplate(f.template,null,null)
        assertEquals("sf",f.world.genre);assertEquals(java.time.Instant.EPOCH,f.world.publishedAt);assertTrue(f.template.worldId in f.marked)
        verifyNoInteractions(graph)
    }
    @Test fun `cover is excluded`() {
        val f=pristineTemplateFixture();f.world.coverObjectKey="cover";f.world.coverContentType="image/png"
        service.publishPristineTemplate(f.template,null,null)
        assertEquals("private",f.world.visibility);assertTrue(f.template.worldId in f.marked)
    }
    @Test fun `unexpected save history is excluded`() {
        val f=pristineTemplateFixture()
        `when`(requests.findAllByIdWorldId(f.template.worldId)).thenReturn(emptyList())
        service.publishPristineTemplate(f.template,null,null)
        assertEquals("private",f.world.visibility);assertTrue(f.template.worldId in f.marked)
    }
    @Test fun `transient graph failure retries and publishes pristine sample`() {
        val f=pristineTemplateFixture();val id=f.template.worldId
        `when`(graph.read(id)).thenThrow(WorldStudioFailure.unavailable())
            .thenAnswer { RelationshipStateResult(id,f.state.graphVersion,f.state.requestKey,f.state.requestHash,emptyList()) }
        assertThrows(WorldStudioFailure::class.java) { service.publishPristineTemplate(f.template,null,null) }
        assertTrue(f.marked.isEmpty())
        service.publishPristineTemplate(f.template,null,null)
        assertEquals("public",f.world.visibility);assertTrue(id in f.marked)
    }
    @Test fun `pending request retries and publishes after completion`() {
        val f=pristineTemplateFixture();f.state.completed=false
        service.publishPristineTemplate(f.template,null,null)
        assertTrue(f.marked.isEmpty())
        f.state.completed=true
        service.publishPristineTemplate(f.template,null,null)
        assertEquals("public",f.world.visibility);assertTrue(f.template.worldId in f.marked)
    }
    @Test fun `request becoming pending during graph read is retried after completion`() {
        val f=pristineTemplateFixture();val id=f.template.worldId
        `when`(graph.readWithHistory(id)).thenAnswer {
            f.state.completed=false
            RelationshipStateResult(id,1,f.state.requestKey,f.state.requestHash,emptyList()) to false
        }.thenAnswer { RelationshipStateResult(id,1,f.state.requestKey,f.state.requestHash,emptyList()) to false }
        service.publishPristineTemplate(f.template,null,null)
        assertTrue(f.marked.isEmpty());assertEquals("private",f.world.visibility)
        f.state.completed=true
        service.publishPristineTemplate(f.template,null,null)
        assertEquals("public",f.world.visibility);assertTrue(id in f.marked)
    }
    @Test fun `another completion during an outage is never overwritten`() {
        val f=pristineTemplateFixture();val id=f.template.worldId
        `when`(graph.read(id)).thenAnswer {
            f.marked.add(id);f.world.visibility="private"
            throw WorldStudioFailure.unavailable()
        }
        assertThrows(WorldStudioFailure::class.java) { service.publishPristineTemplate(f.template,null,null) }
        service.publishPristineTemplate(f.template,null,null)
        assertEquals("private",f.world.visibility);verify(templatePublications,never()).saveAndFlush(any())
    }
    @Test fun `private choice during outage permanently prevents retry publication`() {
        val f=pristineTemplateFixture();val id=f.template.worldId
        `when`(graph.read(id)).thenThrow(WorldStudioFailure.unavailable())
            .thenAnswer { RelationshipStateResult(id,f.state.graphVersion,f.state.requestKey,f.state.requestHash,emptyList()) }
        assertThrows(WorldStudioFailure::class.java) { service.publishPristineTemplate(f.template,null,null) }
        assertTrue(f.marked.isEmpty())
        service.publication(id,GenreTemplateSeeder.TEMPLATE_OWNER,PublicationRequest("private",null))
        service.publishPristineTemplate(f.template,null,null)
        assertTrue(id in f.marked);assertEquals("private",f.world.visibility)
    }
    @Test fun `second graph token mismatch is reported and permanently skipped`() {
        val f=pristineTemplateFixture();val id=f.template.worldId
        `when`(graph.readWithHistory(id)).thenReturn(RelationshipStateResult(id,1,f.state.requestKey,"wrong",emptyList()) to false)
        assertThrows(WorldStudioFailure::class.java) { service.publishPristineTemplate(f.template,null,null) }
        assertTrue(id in f.marked);assertEquals("private",f.world.visibility)
    }
    @Test fun `change after graph read is permanently skipped`() {
        val f=pristineTemplateFixture();val id=f.template.worldId
        `when`(graph.readWithHistory(id)).thenAnswer { f.draft.draftRevision++
            RelationshipStateResult(id,1,f.state.requestKey,f.state.requestHash,emptyList()) to false }
        service.publishPristineTemplate(f.template,null,null)
        assertTrue(id in f.marked);assertEquals("private",f.world.visibility)
    }

    @Test fun `a concurrent unchanged private choice is not overwritten`() {
        val f=pristineTemplateFixture();val id=f.template.worldId
        `when`(graph.readWithHistory(id)).thenAnswer {
            service.publication(id,GenreTemplateSeeder.TEMPLATE_OWNER,PublicationRequest("private",null))
            RelationshipStateResult(id,1,f.state.requestKey,f.state.requestHash,emptyList()) to false
        }
        service.publishPristineTemplate(f.template,null,null)
        assertEquals("private",f.world.visibility);assertEquals(1L,f.world.ownerMetadataVersion);assertTrue(id in f.marked)
    }
    @Test fun `private choice made before migration is also preserved`() {
        val f=pristineTemplateFixture()
        service.publication(f.template.worldId,GenreTemplateSeeder.TEMPLATE_OWNER,PublicationRequest("private",null))
        service.publishPristineTemplate(f.template,null,null)
        assertEquals("private",f.world.visibility);assertTrue(f.template.worldId in f.marked)
    }
    @Test fun `cover delete records an explicit owner choice even when already absent`() {
        val f=pristineTemplateFixture()
        val covers=ai.storyfork.content.world.service.WorldCoverService(worlds,
            mock(ai.storyfork.content.attachment.client.AttachmentStorageClient::class.java),expandedSeeds,manager)
        covers.delete(f.template.worldId,GenreTemplateSeeder.TEMPLATE_OWNER)
        assertEquals(1L,f.world.ownerMetadataVersion)
        service.publishPristineTemplate(f.template,null,null)
        assertEquals("private",f.world.visibility);assertTrue(f.template.worldId in f.marked)
    }
    @Test fun `failed cover upload still records the choice before storage`() {
        val f=pristineTemplateFixture()
        val storage=mock(ai.storyfork.content.attachment.client.AttachmentStorageClient::class.java)
        doThrow(IllegalStateException("storage offline")).`when`(storage).upload(anyString(),any() ?: ai.storyfork.content.attachment.client.dto.AttachmentObjectPayload(byteArrayOf(1),"image/png"))
        val covers=ai.storyfork.content.world.service.WorldCoverService(worlds,storage,expandedSeeds,manager)
        assertThrows(RuntimeException::class.java) { covers.put(f.template.worldId,GenreTemplateSeeder.TEMPLATE_OWNER,
            ai.storyfork.content.world.domain.WorldCoverFile(byteArrayOf(1),"image/png")) }
        assertEquals(1L,f.world.ownerMetadataVersion)
        service.publishPristineTemplate(f.template,null,null)
        assertEquals("private",f.world.visibility);assertTrue(f.template.worldId in f.marked)
    }
    @Test fun `historical relationships exclude an otherwise empty current graph`() {
        val f=pristineTemplateFixture()
        `when`(graph.readWithHistory(f.template.worldId)).thenReturn(RelationshipStateResult(f.template.worldId,1,f.state.requestKey,f.state.requestHash,emptyList()) to true)
        service.publishPristineTemplate(f.template,null,null)
        assertEquals("private",f.world.visibility);assertTrue(f.template.worldId in f.marked)
    }
    @Test fun `foreign owner cannot be marked or published`() {
        val f=pristineTemplateFixture()
        `when`(worlds.lockOwned(f.template.worldId,GenreTemplateSeeder.TEMPLATE_OWNER)).thenReturn(null)
        assertThrows(WorldNotFound::class.java) { service.publishPristineTemplate(f.template,null,null) }
        assertTrue(f.marked.isEmpty());assertEquals("private",f.world.visibility)
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
    // --- 설정 카드 대표 이미지(#401): 카드 semanticMetadata.imageId는 이 세계관이 올린 이미지만 가리킬 수 있다 ---
    private fun withImage(image:Any?)=CardPayload(UUID.randomUUID(),"인물","원문","character","basic",semanticMetadata=mapOf("imageId" to image))
    private fun worldsImage(image:UUID,owner:UUID=world)=SettingCardImage(image,owner,"world-card-images/${image}","image/png")
    @Test fun `a card image id that is not a UUID is an input error before anything is read or prepared`() {
        owned()
        for(bad in listOf("","x","1-1-1-1-1",42,true,mapOf("id" to "x"))) {
            assertThrows(IllegalArgumentException::class.java) { service.edit(world,actor,EditWorldDraftRequest(2,"x","",listOf(withImage(bad)),key="bad-image")) }
        }
        verifyNoInteractions(images)
        assertTrue(state.completed);verify(states,never()).flush()
        verify(graph,never()).replace(anyUUID(),anyLong(),anyString(),anyString(),anyList(),anyEpisode())
    }
    @Test fun `an image of another world or an unknown image is an input error and the previous draft stays`() {
        owned()
        val mine=UUID.randomUUID();val foreign=UUID.randomUUID();val unknown=UUID.randomUUID()
        `when`(images.findAllById(any())).thenReturn(listOf(worldsImage(mine),worldsImage(foreign,owner=UUID.randomUUID())))
        for(other in listOf(foreign,unknown)) {
            assertThrows(IllegalArgumentException::class.java) {
                service.edit(world,actor,EditWorldDraftRequest(2,"x","",listOf(withImage(mine.toString()),withImage(other.toString())),key="other-image"))
            }
        }
        assertTrue(state.completed);verify(states,never()).flush()
        verify(cards,never()).saveAndFlush(any());verify(cardDrafts,never()).save(any())
        verify(graph,never()).replace(anyUUID(),anyLong(),anyString(),anyString(),anyList(),anyEpisode())
        assertEquals(2L,draft.draftRevision);assertEquals("편집본",draft.name)
    }
    @Test fun `an image of this world is saved with the card`() {
        owned()
        val image=UUID.randomUUID()
        `when`(images.findAllById(any())).thenReturn(listOf(worldsImage(image)))
        doAnswer { RelationshipStateResult(world,4,state.requestKey,state.requestHash,emptyList()) }.`when`(graph).replace(anyUUID(),anyLong(),anyString(),anyString(),anyList(),anyEpisode())
        val saved=service.edit(world,actor,EditWorldDraftRequest(2,"x","",listOf(withImage(image.toString())),key="with-image"))
        val row=ArgumentCaptor.forClass(SettingCardDraft::class.java)
        verify(cardDrafts).save(row.capture() ?: SettingCardDraft(UUID(0,0),world,CardFields()))
        assertEquals(mapOf<String,Any?>("imageId" to image.toString()),row.value.fields.semanticMetadata)
        assertEquals(3L,saved.draftRevision)
    }
    @Test fun `a null image id is no image and never asks the image table`() {
        owned()
        `when`(graph.replace(anyUUID(),anyLong(),anyString(),anyString(),anyList(),anyEpisode())).thenThrow(WorldStudioFailure.unavailable())
        // 입력 검증을 통과해 그래프 저장까지 갔다는 뜻이다(입력 오류가 아니다).
        assertThrows(WorldStudioFailure::class.java) { service.edit(world,actor,EditWorldDraftRequest(2,"x","",listOf(withImage(null)),key="null-image")) }
        verifyNoInteractions(images)
    }
    @Test fun `a card without an image id never asks the image table`() {
        owned()
        `when`(graph.replace(anyUUID(),anyLong(),anyString(),anyString(),anyList(),anyEpisode())).thenThrow(WorldStudioFailure.unavailable())
        assertThrows(WorldStudioFailure::class.java) { service.edit(world,actor,EditWorldDraftRequest(2,"x","",listOf(CardPayload(UUID.randomUUID(),"인물","원문","character","basic")),key="plain")) }
        verifyNoInteractions(images)
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
    @Test fun `large upsert changes only requested cards after a graph failure and retry`() {
        owned()
        val original=(1..10000).map { cardDraft(UUID.randomUUID()) }
        val unchanged=original.drop(2)
        val oldTime=java.time.Instant.parse("2020-01-01T00:00:00Z")
        original.forEach { it.updatedAt=oldTime }
        val oldFields=unchanged.map { it.fields }
        val stored=original.associateBy { it.cardId }.toMutableMap()
        `when`(cardDrafts.findAllByWorldId(world)).thenAnswer { stored.values.toList() }
        `when`(cardDrafts.findById(anyUUID())).thenAnswer { Optional.ofNullable(stored[it.arguments[0] as UUID]) }
        `when`(cardDrafts.save(any())).thenAnswer { (it.arguments[0] as SettingCardDraft).also { card -> stored[card.cardId]=card } }
        `when`(cards.findById(anyUUID())).thenAnswer { Optional.ofNullable(stored[it.arguments[0] as UUID]?.let { card -> SettingCard(card.cardId,world) }) }
        var interrupted=true
        doAnswer {
            if(interrupted) { interrupted=false;throw WorldStudioFailure.unavailable() }
            RelationshipStateResult(world,4,state.requestKey,state.requestHash,emptyList())
        }.`when`(graph).replace(anyUUID(),anyLong(),anyString(),anyString(),anyList(),anyEpisode())
        val newId=UUID.randomUUID()
        val changes=listOf(payload(original[0].cardId).copy(body="수정"),payload(original[1].cardId,"removed"),payload(newId))
        val request=EditWorldDraftRequest(2,"x","",changes,key="large-upsert")
        assertThrows(WorldStudioFailure::class.java) { service.edit(world,actor,request) }
        assertEquals(oldTime,original[0].updatedAt);assertFalse(state.completed);assertFalse(stored.containsKey(newId))
        assertEquals(3L,service.edit(world,actor,request).draftRevision)
        assertEquals("수정",stored.getValue(original[0].cardId).fields.body)
        assertEquals("removed",stored.getValue(original[1].cardId).fields.lifecycle)
        assertEquals("원문",stored.getValue(newId).fields.body)
        assertTrue(unchanged.all { it.updatedAt==oldTime });assertEquals(oldFields,unchanged.map { it.fields })
        verify(cardDrafts,times(3)).findById(anyUUID())
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
    // --- 확정 버전으로 카드 되돌리기(2026-11-17): 카드만 초안으로, 관계·새 확정 버전 없음 ---
    private val revisionId=UUID.randomUUID();private val cardD=UUID.randomUUID();private val cardE=UUID.randomUUID()
    private fun fieldsOf(title:String,body:String="본문",visibility:String="private",lifecycle:String="active",meta:Map<String,Any?> = emptyMap())=
        CardFields(title=title,body=body,cardType="character",areaCode="basic",visibility=visibility,lifecycle=lifecycle,semanticMetadata=meta)
    /**
     * 확정 버전 R의 카드는 A(내용이 달라짐)·B(지금은 삭제 상태)·E(같음)이고, 지금 초안은 A·B(삭제)·C(R에 없던 활성 카드)·D(R에 없고 이미 삭제)·E다.
     * 초안 행은 같은 객체를 돌려줘 서비스가 바꾼 값을 그대로 읽을 수 있다.
     */
    private fun restoring():List<SettingCardDraft> {
        owned()
        val rows=listOf(SettingCardDraft(cardA,world,fieldsOf("가람 수정","수정한 내용")),SettingCardDraft(cardB,world,fieldsOf("나래 삭제됨",lifecycle="removed")),
            SettingCardDraft(cardC,world,fieldsOf("다온")),SettingCardDraft(cardD,world,fieldsOf("지난 삭제",lifecycle="removed")),SettingCardDraft(cardE,world,fieldsOf("이든","같음")))
        val versions=listOf(SettingCardVersion(cardId=cardA,worldId=world,versionNo=1,fields=fieldsOf("가람 확정","확정 당시 내용","public",meta=mapOf("revealFromEpisode" to 2))),
            SettingCardVersion(cardId=cardB,worldId=world,versionNo=1,fields=fieldsOf("나래 확정")),SettingCardVersion(cardId=cardE,worldId=world,versionNo=1,fields=fieldsOf("이든","같음")))
        `when`(revisions.findByIdAndWorldId(revisionId,world)).thenReturn(WorldRevision(revisionId,world,3,"확정 이름","확정 설명",sealed=true))
        `when`(revisionCards.findAllByIdRevisionId(revisionId)).thenReturn(versions.map { WorldRevisionCard(RevisionCardKey(revisionId,it.cardId),world,it.id) })
        `when`(cardVersions.findAllById(any<Iterable<UUID>>())).thenAnswer { ids -> versions.filter { it.id in (ids.arguments[0] as Iterable<*>) } }
        `when`(cardDrafts.findAllByWorldId(world)).thenReturn(rows)
        return rows
    }
    private fun restore(expected:Long=2)=service.restore(world,actor,revisionId,RestoreWorldRequest(expected))
    private fun untouched(rows:List<SettingCardDraft>) {
        assertEquals(2L,draft.draftRevision);assertNull(draft.baseWorldRevisionId)
        assertEquals(listOf("가람 수정","나래 삭제됨","다온","지난 삭제","이든"),rows.map { it.fields.title });assertEquals("active",rows[2].fields.lifecycle)
        verify(cardDrafts,never()).save(any());verify(cardDrafts,never()).flush()
    }

    @Test fun `restore puts the confirmed version's cards in the draft and removes the cards it lacks without touching name relations or revisions`() {
        val rows=restoring();val relation=RelationshipPayload(UUID.randomUUID(),cardA,cardE,"structural",label="동료");at(null,relation)
        val result=restore()
        fun row(id:UUID)=rows.single { it.cardId==id }.fields
        // 그 버전의 카드는 내용·공개 범위·semanticMetadata 그대로, 지워졌던 카드는 다시 활성이다.
        assertEquals(listOf("가람 확정","확정 당시 내용","public",mapOf("revealFromEpisode" to 2),"active"),row(cardA).let { listOf(it.title,it.body,it.visibility,it.semanticMetadata,it.lifecycle) })
        assertEquals(listOf("나래 확정","active"),row(cardB).let { listOf(it.title,it.lifecycle) })
        assertEquals(listOf("이든","같음","active"),row(cardE).let { listOf(it.title,it.body,it.lifecycle) })
        // 그 버전에 없던 활성 카드는 내용을 둔 채 삭제 상태가 되고, 이미 삭제된 카드는 그대로다.
        assertEquals(listOf("다온","removed"),row(cardC).let { listOf(it.title,it.lifecycle) })
        assertEquals(listOf("지난 삭제","removed"),row(cardD).let { listOf(it.title,it.lifecycle) })
        // 초안 revision만 오르고 이름·설명은 그대로이며 초안의 기준 확정 버전은 되돌린 버전이다.
        assertEquals(3L,draft.draftRevision);assertEquals(revisionId,draft.baseWorldRevisionId);assertEquals("편집본",draft.name)
        // 응답은 기존 초안 응답이고 관계는 현재 그대로다. 관계 쓰기·새 확정 버전·요청 기록은 없다.
        assertEquals(3L,result.draftRevision);assertEquals(listOf(relation),result.relationships);assertEquals(5,result.cards.size);assertEquals(3L,state.graphVersion)
        verify(graph,never()).replace(anyUUID(),anyLong(),anyString(),anyString(),anyList(),anyEpisode())
        verify(revisions,never()).saveAndFlush(any());verify(cardVersions,never()).saveAll(any<Iterable<SettingCardVersion>>());verifyNoInteractions(requests)
    }
    @Test fun `restore is refused and changes nothing while a current relation still ends on a card the version lacks`() {
        val rows=restoring();at(null,RelationshipPayload(UUID.randomUUID(),cardA,cardC,"structural",label="동료"))
        assertEquals(listOf("다온"),assertThrows(WorldRestoreBlocked::class.java) { restore() }.titles)
        untouched(rows)
    }
    @Test fun `restore against a stale draft revision is a conflict before Neo4j is read`() {
        val rows=restoring()
        assertThrows(WorldConflict::class.java) { restore(1) }
        untouched(rows);verify(graph,never()).read(anyUUID(),anyEpisode())
    }
    @Test fun `restore of a revision that is missing or not sealed is not found`() {
        val rows=restoring();val unsealed=UUID.randomUUID()
        `when`(revisions.findByIdAndWorldId(unsealed,world)).thenReturn(WorldRevision(unsealed,world,4,"봉인 전","",sealed=false))
        for(id in listOf(UUID.randomUUID(),unsealed)) assertThrows(WorldNotFound::class.java) { service.restore(world,actor,id,RestoreWorldRequest(2)) }
        untouched(rows)
    }
    @Test fun `only the owner can restore and a foreign caller reads nothing`() {
        restoring()
        assertThrows(WorldNotFound::class.java) { service.restore(world,UUID.randomUUID(),revisionId,RestoreWorldRequest(2)) }
        verifyNoInteractions(graph,revisionCards,cardVersions);verify(revisions,never()).findByIdAndWorldId(anyUUID(),anyUUID())
    }
    @Test fun `restore waits for an unfinished relation write the way a confirmed save does`() {
        val rows=restoring();state.completed=false
        assertEquals("RELATIONSHIP_WRITE_INCOMPLETE",assertThrows(WorldStudioFailure::class.java) { restore() }.code)
        untouched(rows)
    }
    @Test fun `restore does nothing when Neo4j holds another relation state than the draft`() {
        val rows=restoring();`when`(graph.read(world,null)).thenReturn(RelationshipStateResult(world,4,"other","other",emptyList()))
        assertEquals("RELATIONSHIP_VERSION_MISMATCH",assertThrows(WorldStudioFailure::class.java) { restore() }.code)
        untouched(rows)
    }

    // --- 세계관 삭제(2026-11-17): 소프트 삭제, 연결된 소설이 있으면 거절 ---
    @Test fun `delete only marks the world deleted and removes no row`() {
        val entity=StudioWorld(world,actor);`when`(worlds.lockOwned(world,actor)).thenReturn(entity)
        service.delete(world,actor,linked=false)
        assertNotNull(entity.deletedAt)
        verify(worlds).lockOwned(world,actor);verifyNoMoreInteractions(worlds);verifyNoInteractions(drafts,cardDrafts,cardVersions,revisions,revisionCards,states,graph)
    }
    @Test fun `delete is refused with WORLD_LINKED while a novel is connected and the world stays`() {
        val entity=StudioWorld(world,actor);`when`(worlds.lockOwned(world,actor)).thenReturn(entity)
        val failure=assertThrows(WorldStudioFailure::class.java) { service.delete(world,actor,linked=true) }
        assertEquals(WorldStudioFailure.Reason.LINKED,failure.reason);assertEquals("WORLD_LINKED",failure.code);assertNull(entity.deletedAt)
    }
    @Test fun `only the owner can delete`() {
        val entity=StudioWorld(world,actor);`when`(worlds.lockOwned(world,actor)).thenReturn(entity)
        assertThrows(WorldNotFound::class.java) { service.delete(world,UUID.randomUUID(),linked=false) }
        assertNull(entity.deletedAt)
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
        `when`(graph.read(world)).thenAnswer { state.completed=false;RelationshipStateResult(world,3,state.requestKey,state.requestHash,emptyList()) }
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
        `when`(worlds.findAllByOwnerSubjectAndDeletedAtIsNullOrderByCreatedAtDesc(actor)).thenReturn(listOf(entity))
        val summary=service.list(actor).single()
        assertEquals("public",summary.visibility);assertEquals("sf",summary.genre)
        val detail=service.draft(world,actor)
        assertEquals("public",detail.visibility);assertEquals("sf",detail.genre)
        assertEquals("private",WorldStudioSummaryResponse(world,"n","d",0,"current").visibility)
    }

    @Test fun `owner summaries count only the active draft cards`() {
        owned()
        val entity=StudioWorld(world,actor)
        `when`(worlds.findAllByOwnerSubjectAndDeletedAtIsNullOrderByCreatedAtDesc(actor)).thenReturn(listOf(entity))
        `when`(cardDrafts.countByWorldIdAndFieldsLifecycle(world,"active")).thenReturn(3L)
        assertEquals(3L,service.list(actor).single().cardCount)
        assertEquals(0L,WorldStudioSummaryResponse(world,"n","d",0,"current").cardCount)
    }

    @Test fun `owner summaries and the world detail say whether a cover is stored`() {
        owned()
        val entity=StudioWorld(world,actor,coverObjectKey="world-covers/a",coverContentType="image/png")
        `when`(worlds.lockOwned(world,actor)).thenReturn(entity)
        `when`(worlds.findAllByOwnerSubjectAndDeletedAtIsNullOrderByCreatedAtDesc(actor)).thenReturn(listOf(entity))
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

    @Test fun `relationship replacement at the limit is validated before graph preparation`() {
        owned()
        `when`(cardDrafts.findAllByWorldId(world)).thenReturn(listOf(cardDraft(cardA),cardDraft(cardB)))
        val existing=(1..10000).map { RelationshipPayload(UUID.randomUUID(),cardA,cardB,"structural","관계") }
        val added=RelationshipPayload(UUID.randomUUID(),cardA,cardB,"emotional","새 관계")
        var graphRelations=existing
        `when`(graph.read(world,null)).thenAnswer { RelationshipStateResult(world,state.graphVersion,state.requestKey,state.requestHash,graphRelations) }
        assertThrows(IllegalArgumentException::class.java) { service.edit(world,actor,EditWorldDraftRequest(2,"x","",relationships=listOf(added),key="over")) }
        assertTrue(state.completed);assertEquals("previous",state.requestKey);assertEquals(2L,draft.draftRevision)
        verify(states,never()).flush();verify(graph,never()).replace(anyUUID(),anyLong(),anyString(),anyString(),anyList(),anyEpisode())
        doAnswer {
            @Suppress("UNCHECKED_CAST")
            graphRelations=it.arguments[4] as List<RelationshipPayload>
            RelationshipStateResult(world,4,state.requestKey,state.requestHash,graphRelations)
        }.`when`(graph).replace(anyUUID(),anyLong(),anyString(),anyString(),anyList(),anyEpisode())
        val updates=listOf(existing.first().copy(lifecycle="removed",sourceCardId=null,targetCardId=null),added)
        val saved=assertDoesNotThrow<WorldDraftResponse> { service.edit(world,actor,EditWorldDraftRequest(2,"x","",relationships=updates,key="swap")) }
        assertEquals(existing.drop(1)+added,saved.relationships)
        verify(graph,times(1)).replace(anyUUID(),anyLong(),anyString(),anyString(),anyList(),anyEpisode())
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
    @Test fun `active card total allows ten thousand after upserts and removals`() {
        owned()
        val existing=(1..9999).map { cardDraft(UUID.randomUUID()) }
        val removed=cardDraft(UUID.randomUUID(),"removed")
        `when`(cardDrafts.findAllByWorldId(world)).thenReturn(existing+removed)
        graphKeeps()
        val added=payload(UUID.randomUUID())
        val saved=assertDoesNotThrow<WorldDraftResponse> { service.edit(world,actor,EditWorldDraftRequest(2,"x","",listOf(added),key="ten-thousand")) }
        assertEquals(3L,saved.draftRevision)
        draft.draftRevision=2;state.graphVersion=3
        val tenThousand=existing+cardDraft(added.id)+removed
        `when`(cardDrafts.findAllByWorldId(world)).thenReturn(tenThousand)
        val updates=listOf(payload(existing[0].cardId).copy(title="수정"),payload(existing[1].cardId,"removed"),payload(removed.cardId))
        assertEquals(3L,service.edit(world,actor,EditWorldDraftRequest(2,"x","",updates,key="update-at-limit")).draftRevision)
    }
    @Test fun `active card total rejects ten thousand and one before preparing any writes`() {
        owned()
        val existing=(1..10000).map { cardDraft(UUID.randomUUID()) }
        `when`(cardDrafts.findAllByWorldId(world)).thenReturn(existing)
        val error=assertThrows(IllegalArgumentException::class.java) {
            service.edit(world,actor,EditWorldDraftRequest(2,"변경","",listOf(payload(UUID.randomUUID())),key="over-limit"))
        }
        assertEquals("설정 카드는 10,000개까지 저장할 수 있습니다.",error.message)
        nothingPrepared();assertEquals("previous",state.requestKey);assertEquals("previous",state.requestHash)
    }
    @Test fun `a single request still rejects one thousand and one cards and duplicate ids`() {
        val one=payload(UUID.randomUUID())
        val tooMany=(1..1001).map { payload(UUID.randomUUID()) }
        assertThrows(IllegalArgumentException::class.java) { service.edit(world,actor,EditWorldDraftRequest(2,"x","",tooMany,key="too-many")) }
        assertThrows(IllegalArgumentException::class.java) { service.edit(world,actor,EditWorldDraftRequest(2,"x","",listOf(one,one),key="duplicate")) }
        verifyNoInteractions(worlds,graph)
    }
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
