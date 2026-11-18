package ai.storyfork.content.world

import ai.storyfork.content.world.domain.*
import ai.storyfork.content.world.relationship.Neo4jRelationshipConfig
import ai.storyfork.content.world.relationship.Neo4jRelationshipRepository
import ai.storyfork.content.world.studio.repository.*
import ai.storyfork.content.world.service.GenreTemplate
import ai.storyfork.content.world.service.GenreTemplateRepair
import ai.storyfork.content.world.service.GenreTemplateSeeder
import ai.storyfork.content.world.service.WorldStudioService
import ai.storyfork.content.world.service.ExpandedTemplateSeeder
import ai.storyfork.content.world.service.ExpandedWorld
import ai.storyfork.content.world.service.ExpandedChunk
import ai.storyfork.content.world.service.ExpandedManifest
import ai.storyfork.content.world.service.GenreTemplateCard
import ai.storyfork.content.world.service.WorldReviewService
import ai.storyfork.content.world.service.WorldReviewInput
import ai.storyfork.content.world.service.expandedRequests
import ai.storyfork.content.world.service.dto.*
import jakarta.persistence.EntityManagerFactory
import java.util.UUID
import java.util.concurrent.Callable
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit
import java.util.concurrent.Executors
import javax.sql.DataSource
import org.junit.jupiter.api.Assertions.*
import org.junit.jupiter.api.Test
import org.junit.jupiter.api.condition.EnabledIfEnvironmentVariable
import org.springframework.boot.test.util.TestPropertyValues
import org.springframework.context.annotation.AnnotationConfigApplicationContext
import org.springframework.core.io.ClassPathResource
import org.springframework.boot.SpringApplication
import org.springframework.boot.context.event.ApplicationReadyEvent
import java.time.Duration
import org.springframework.transaction.PlatformTransactionManager
import tools.jackson.databind.json.JsonMapper
import tools.jackson.module.kotlin.KotlinModule

/** CI only: isolated PostgreSQL plus real Neo4j. No production/legacy data transition. */
@EnabledIfEnvironmentVariable(named="TEST_WORLDSTUDIO_DATABASE_URL",matches=".+")
class WorldStudioServicePostgresTest {
    private fun context(db:WorldStudioPostgresFixture)=AnnotationConfigApplicationContext().apply {
        TestPropertyValues.of("DATABASE_URL=${db.url}","DATABASE_USER=${System.getenv("TEST_WORLDSTUDIO_DATABASE_USER")}",
            "DATABASE_PASSWORD=${System.getenv("TEST_WORLDSTUDIO_DATABASE_PASSWORD")}",
            "app.worldstudio.neo4j.uri=${System.getenv("NEO4J_URI")}","app.worldstudio.neo4j.username=neo4j",
            "app.worldstudio.neo4j.password=${System.getenv("NEO4J_PASSWORD")}").applyTo(this)
        beanFactory.registerSingleton("jsonMapper",JsonMapper.builder().addModule(KotlinModule.Builder().build()).build())
        register(ai.storyfork.content._common.config.ContentDatabaseConfig::class.java,WorldStudioConfig::class.java,
            Neo4jRelationshipConfig::class.java,Neo4jRelationshipRepository::class.java,WorldStudioService::class.java)
        refresh()
    }
    @Test fun `one ready event reaches expansion for 26 freshly seeded worlds`() {
        WorldStudioPostgresFixture("independent").use { db -> context(db).use { ctx ->
            val service=ctx.getBean(WorldStudioService::class.java);val mapper=ctx.getBean(JsonMapper::class.java)
            val owner=GenreTemplateSeeder.TEMPLATE_OWNER
            val fixtures=(1..26).map { i -> GenreTemplate("startup_$i",UUID.randomUUID(),"세계 $i","설명",
                listOf(GenreTemplateCard(UUID.randomUUID(),"장소 $i","원본","location"))) }
            val original=org.mockito.Mockito.spy(GenreTemplateSeeder(service,mapper))
            val expanded=org.mockito.Mockito.spy(ExpandedTemplateSeeder(service,mapper,true))
            org.mockito.Mockito.doAnswer {
                fixtures.forEach { template ->
                    service.createTemplate(CreateWorldRequest(template.name,template.description,template.worldId))
                    val edit=service.edit(template.worldId,owner,EditWorldDraftRequest(0,template.name,template.description,
                        GenreTemplateRepair.payloads(template),key="genre-template-${template.genre}"))
                    service.save(template.worldId,owner,SaveWorldRequest(edit.draftRevision,"genre-template-${template.genre}"))
                };null
            }.`when`(original).seed()
            org.mockito.Mockito.doAnswer {
                fixtures.forEach { template ->
                    val old=template.cards.single();val extra=GenreTemplateCard(UUID.randomUUID(),"추가","후보","other")
                    val world=ExpandedWorld(template.genre,template.worldId,template.name,template.description,listOf("one.json"))
                    expanded.seedWorld(world,listOf(ExpandedChunk(listOf(old.copy(body="확장 본문"),extra),emptyList())),null,template,template)
                };null
            }.`when`(expanded).seed()
            AnnotationConfigApplicationContext().use { events ->
                events.beanFactory.registerSingleton("expanded",expanded);events.beanFactory.registerSingleton("original",original);events.refresh()
                events.publishEvent(ApplicationReadyEvent(SpringApplication(),emptyArray(),events,Duration.ZERO))
            }
            assertEquals(26,fixtures.count { template -> ctx.getBean(ExpandedSeedProgressRepository::class.java).findById(template.worldId).orElse(null)?.completed==true })
            fixtures.forEach { template ->
                val draft=service.draft(template.worldId,owner)
                assertEquals(2,draft.cards.count { it.lifecycle=="active" });assertEquals("확장 본문",draft.cards.single { it.id==template.cards.single().id }.body)
            }
        } }
    }
    @Test fun `expanded chunks recover graph acknowledgement loss and publish only the complete version`() {
        WorldStudioPostgresFixture("independent").use { db -> context(db).use { ctx ->
            val owner=GenreTemplateSeeder.TEMPLATE_OWNER;val id=UUID.randomUUID()
            val world=ExpandedWorld("new_tradition",id,"새 세계","설명",listOf("one.json","two.json"))
            val first=GenreTemplateCard(UUID.randomUUID(),"인물","인물 출처","character","성격")
            val second=GenreTemplateCard(UUID.randomUUID(),"장소","장소 출처","location")
            val relation=RelationshipPayload(UUID.randomUUID(),first.id,second.id,"structural","출처에 적힌 단방향 관계",label="연결",direction="directed",polarity="asserted")
            val chunks=listOf(ExpandedChunk(listOf(first),listOf(relation)),ExpandedChunk(listOf(second),emptyList()))
            val graph=org.mockito.Mockito.spy(ctx.getBean(Neo4jRelationshipRepository::class.java))
            var fail=true
            org.mockito.Mockito.doAnswer { call ->
                val result=call.callRealMethod()
                if(call.getArgument<Long>(1)==0L && fail) { fail=false;throw WorldStudioFailure.unavailable() }
                result
            }.`when`(graph).replace(org.mockito.ArgumentMatchers.any(UUID::class.java) ?: UUID(0,0),org.mockito.ArgumentMatchers.anyLong(),
                org.mockito.ArgumentMatchers.anyString(),org.mockito.ArgumentMatchers.anyString(),org.mockito.ArgumentMatchers.anyList(),org.mockito.ArgumentMatchers.any<Int>())
            val service=WorldStudioService(ctx.getBean(StudioWorldRepository::class.java),ctx.getBean(WorldDraftRepository::class.java),
                ctx.getBean(SettingCardRepository::class.java),ctx.getBean(SettingCardDraftRepository::class.java),ctx.getBean(SettingCardVersionRepository::class.java),
                ctx.getBean(WorldRevisionRepository::class.java),ctx.getBean(WorldRevisionCardRepository::class.java),ctx.getBean(WorldSaveRequestRepository::class.java),
                ctx.getBean(WorldRelationshipStateRepository::class.java),ctx.getBean(TemplatePublicationOnceRepository::class.java),ctx.getBean(ExpandedSeedProgressRepository::class.java),
                ctx.getBean(InitialWorldApplicationRepository::class.java),ctx.getBean(SettingCardImageRepository::class.java),graph,
                ctx.getBean("worldStudioTransactionManager",PlatformTransactionManager::class.java),ctx.getBean(JsonMapper::class.java))
            val seeder=ExpandedTemplateSeeder(service,ctx.getBean(JsonMapper::class.java),true)
            assertThrows(WorldStudioFailure::class.java) { seeder.seedWorld(world,chunks) }
            val entity=ctx.getBean(StudioWorldRepository::class.java).findById(id).orElseThrow()
            assertEquals("private",entity.visibility);assertNull(entity.currentRevisionId)
            val digest=ctx.getBean(ExpandedSeedProgressRepository::class.java).findById(id).orElseThrow().inputHash
            val original=expandedRequests(world,chunks).first()
            assertThrows(WorldConflict::class.java) { service.editExpanded(id,digest,0,original.copy(cards=original.cards.map { it.copy(body="다른 요청") })) }
            assertThrows(WorldConflict::class.java) { seeder.seedWorld(world,chunks.mapIndexed { i,c -> if(i==0) c.copy(cards=listOf(first.copy(body="다른 입력"))) else c }) }
            seeder.seedWorld(world,chunks)
            val draft=service.draft(id,owner)
            assertEquals("public",draft.visibility);assertEquals(setOf(first.id,second.id),draft.cards.map { it.id }.toSet())
            assertEquals(listOf(relation),draft.relationships)
            val saved=service.revision(id,owner,draft.currentRevisionId!!)
            assertEquals(setOf(first.id,second.id),saved.cards.map { it.card.id }.toSet())
            seeder.seedWorld(world,chunks)
            assertEquals(saved.revisionId,service.draft(id,owner).currentRevisionId)
            assertEquals(saved.revisionId,service.saveExpanded(id,digest,3,SaveWorldRequest(3,"expanded-$id-save")).revisionId)
            assertThrows(WorldConflict::class.java) { service.saveExpanded(id,digest,4,SaveWorldRequest(4,"expanded-$id-save")) }
            val publicService=ai.storyfork.content.world.service.PublicWorldService(ctx.getBean(StudioWorldRepository::class.java),
                ctx.getBean(WorldRevisionRepository::class.java),ctx.getBean(WorldRevisionCardRepository::class.java),
                ctx.getBean(SettingCardVersionRepository::class.java),ctx.getBean(SettingCardImageRepository::class.java),
                ctx.getBean(WorldRelationshipStateRepository::class.java),ctx.getBean(ExpandedSeedProgressRepository::class.java),ctx.getBean(Neo4jRelationshipRepository::class.java),
                org.mockito.Mockito.mock(ai.storyfork.content.auth.service.CoreNicknameService::class.java),
                org.mockito.Mockito.mock(ai.storyfork.content.attachment.client.AttachmentStorageClient::class.java),
                org.mockito.Mockito.mock(ai.storyfork.content.work.repository.WorkRepository::class.java),
                org.mockito.Mockito.mock(ai.storyfork.content.work.service.WorkAccessService::class.java),
                org.mockito.Mockito.mock(ai.storyfork.content.attachment.repository.ContentImageRepository::class.java),
                org.mockito.Mockito.mock(ai.storyfork.content.publication.service.PublicationService::class.java),
                ctx.getBean("worldStudioTransactionManager",PlatformTransactionManager::class.java))
            val visible=publicService.detail(id)
            assertEquals(setOf(first.id,second.id),visible.cards.map { it.id }.toSet())
            assertEquals(listOf(PublicWorldRelationshipResponse(relation.id,first.id,second.id,relation.label,relation.category,relation.body,relation.direction,relation.polarity)),visible.relationships)
        } }
    }
    @Test fun `expanded seeder preserves a preexisting world and an explicit private choice`() {
        WorldStudioPostgresFixture("independent").use { db -> context(db).use { ctx ->
            val service=ctx.getBean(WorldStudioService::class.java);val mapper=ctx.getBean(JsonMapper::class.java)
            val owner=GenreTemplateSeeder.TEMPLATE_OWNER;val id=UUID.randomUUID()
            service.create(owner,CreateWorldRequest("기존","원문",id))
            val before=service.draft(id,owner)
            val world=ExpandedWorld("history",id,"신규","다름",listOf("one.json"))
            val chunks=listOf(ExpandedChunk(listOf(GenreTemplateCard(UUID.randomUUID(),"카드","본문","other")),emptyList()))
            ExpandedTemplateSeeder(service,mapper,true).seedWorld(world,chunks)
            assertEquals(before,service.draft(id,owner))
            val newId=UUID.randomUUID()
            assertEquals(0,service.startExpanded(CreateWorldRequest("신규","",newId),"digest"))
            assertThrows(WorldConflict::class.java) { service.publication(newId,owner,PublicationRequest("private",null)) }
            val after=service.draft(newId,owner)
            assertThrows(WorldConflict::class.java) { service.edit(newId,owner,EditWorldDraftRequest(0,"신규","",key="test")) }
            assertEquals(after,service.draft(newId,owner))
        } }
    }
    @Test fun `disabled restart completes the already started manifest world without creating new worlds`() {
        WorldStudioPostgresFixture("independent").use { db ->
            val mapper=JsonMapper.builder().addModule(KotlinModule.Builder().build()).build()
            val manifest=ClassPathResource("sample-worlds-expanded/manifest.json").inputStream.use { mapper.readValue(it,ExpandedManifest::class.java) }
            val world=manifest.worlds.single { it.genre=="hawaiian_tradition" }
            val other=manifest.worlds.single { it.genre=="persian_tradition" }
            val chunks=world.chunks.map { name -> ClassPathResource("sample-worlds-expanded/$name").inputStream.use { mapper.readValue(it,ExpandedChunk::class.java) } }
            context(db).use { ctx ->
                val service=org.mockito.Mockito.spy(ctx.getBean(WorldStudioService::class.java));var lost=true
                org.mockito.Mockito.doAnswer { call -> val result=call.callRealMethod()
                    if(call.getArgument<Int>(2)==0 && lost) { lost=false;throw WorldStudioFailure.unavailable() };result
                }.`when`(service).editExpanded(org.mockito.ArgumentMatchers.any(UUID::class.java) ?: UUID(0,0),org.mockito.ArgumentMatchers.anyString(),
                    org.mockito.ArgumentMatchers.anyInt(),org.mockito.ArgumentMatchers.any() ?: EditWorldDraftRequest(0,"",""))
                assertThrows(WorldStudioFailure::class.java) { ExpandedTemplateSeeder(service,mapper,true).seedWorld(world,chunks) }
                assertEquals(1,ctx.getBean(ExpandedSeedProgressRepository::class.java).findById(world.worldId).orElseThrow().nextChunk)
            }
            context(db).use { ctx ->
                val service=ctx.getBean(WorldStudioService::class.java)
                ExpandedTemplateSeeder(service,mapper,false).seed()
                assertTrue(ctx.getBean(ExpandedSeedProgressRepository::class.java).findById(world.worldId).orElseThrow().completed)
                assertEquals(chunks.sumOf { it.cards.size },service.draft(world.worldId,GenreTemplateSeeder.TEMPLATE_OWNER).cards.size)
                assertTrue(ctx.getBean(StudioWorldRepository::class.java).findById(other.worldId).isEmpty)
            }
        }
    }
    @Test fun `AI review rejects an incomplete expansion and succeeds after it finishes`() {
        WorldStudioPostgresFixture("independent").use { db -> context(db).use { ctx ->
            val service=ctx.getBean(WorldStudioService::class.java);val owner=GenreTemplateSeeder.TEMPLATE_OWNER;val id=UUID.randomUUID()
            service.startExpanded(CreateWorldRequest("검토 세계","",id),"digest")
            val ai=org.mockito.Mockito.mock(ai.storyfork.content.world.client.InitialWorldExtractionClient::class.java)
            val review=WorldReviewService(service,ai)
            assertThrows(WorldConflict::class.java) { review.review(id,owner,true) }
            org.mockito.Mockito.verifyNoInteractions(ai)
            val card=CardPayload(UUID.randomUUID(),"인물","본문","character","basic",visibility="public")
            val edit=service.editExpanded(id,"digest",0,EditWorldDraftRequest(0,"검토 세계","",listOf(card),key="expanded-$id-0"))
            service.saveExpanded(id,"digest",1,SaveWorldRequest(edit.draftRevision,"expanded-$id-save"))
            val input=WorldReviewInput.fromDraft(service.draft(id,owner))
            org.mockito.Mockito.`when`(ai.review(input)).thenReturn("""{"findings":[],"model":"test"}""")
            assertEquals(1,review.review(id,owner,true).reviewedCards)
        } }
    }
    @Test fun `pristine existing template preserves its confirmed version and adds relations`() {
        WorldStudioPostgresFixture("independent").use { db -> context(db).use { ctx ->
            val service=ctx.getBean(WorldStudioService::class.java);val mapper=ctx.getBean(JsonMapper::class.java)
            val owner=GenreTemplateSeeder.TEMPLATE_OWNER;val id=UUID.randomUUID()
            val person=GenreTemplateCard(UUID.randomUUID(),"인물","기존 본문","character")
            val baseline=GenreTemplate("old",id,"기존 세계","설명",listOf(person))
            val current=baseline.copy(cards=listOf(person.copy(soul="기존 성격")))
            service.createTemplate(CreateWorldRequest(baseline.name,baseline.description,id))
            val initial=service.edit(id,owner,EditWorldDraftRequest(0,baseline.name,baseline.description,GenreTemplateRepair.payloads(baseline),key="genre-template-old"))
            service.save(id,owner,SaveWorldRequest(initial.draftRevision,"genre-template-old"))
            GenreTemplateRepair(service).repairSoul(null,baseline,current)
            val before=service.draft(id,owner);val old=service.revision(id,owner,before.currentRevisionId!!)
            val extra=GenreTemplateCard(UUID.randomUUID(),"장소","새 본문","location")
            val world=ExpandedWorld("old",id,"확장 세계","확장 설명",listOf("one.json"))
            val card=current.cards.single().copy(body="마크다운 본문")
            val relation=RelationshipPayload(UUID.randomUUID(),card.id,extra.id,"structural","출처 근거",label="연결",direction="directed")
            val seeder=ExpandedTemplateSeeder(service,mapper,true)
            seeder.seedWorld(world,listOf(ExpandedChunk(listOf(card,extra),listOf(relation))),null,baseline,current)
            val after=service.draft(id,owner)
            assertEquals("public",after.visibility);assertNotEquals(old.revisionId,after.currentRevisionId)
            assertEquals(old,service.revision(id,owner,old.revisionId))
            assertEquals("기존 본문",old.cards.single().card.body)
            assertEquals("마크다운 본문",after.cards.single { it.id==person.id }.body)
            assertEquals(listOf(relation),after.relationships)
            seeder.seedWorld(world,listOf(ExpandedChunk(listOf(card,extra),listOf(relation))),null,baseline,current)
            assertEquals(after,service.draft(id,owner))
        } }
    }
    @Test fun `private choice during an existing template chunk conflicts and can be retried after completion`() {
        WorldStudioPostgresFixture("independent").use { db -> context(db).use { ctx ->
            val owner=GenreTemplateSeeder.TEMPLATE_OWNER;val id=UUID.randomUUID()
            val base=GenreTemplate("race",id,"원본","",listOf(GenreTemplateCard(UUID.randomUUID(),"인물","원문","character")))
            val current=base.copy(cards=base.cards.map { it.copy(soul="성격") })
            val ordinary=ctx.getBean(WorldStudioService::class.java)
            ordinary.createTemplate(CreateWorldRequest(base.name,base.description,id))
            val edit=ordinary.edit(id,owner,EditWorldDraftRequest(0,base.name,base.description,GenreTemplateRepair.payloads(base),key="genre-template-race"))
            ordinary.save(id,owner,SaveWorldRequest(edit.draftRevision,"genre-template-race"))
            GenreTemplateRepair(ordinary).repairSoul(null,base,current)
            val original=ordinary.draft(id,owner).currentRevisionId
            val entered=CountDownLatch(1);val release=CountDownLatch(1)
            val graph=org.mockito.Mockito.spy(ctx.getBean(Neo4jRelationshipRepository::class.java))
            org.mockito.Mockito.doAnswer { call ->
                val result=call.callRealMethod()
                if(call.getArgument<Long>(1)==2L) { entered.countDown();check(release.await(10,TimeUnit.SECONDS)) }
                result
            }.`when`(graph).replace(org.mockito.ArgumentMatchers.any(UUID::class.java) ?: UUID(0,0),org.mockito.ArgumentMatchers.anyLong(),
                org.mockito.ArgumentMatchers.anyString(),org.mockito.ArgumentMatchers.anyString(),org.mockito.ArgumentMatchers.anyList(),org.mockito.ArgumentMatchers.any<Int>())
            val guarded=WorldStudioService(ctx.getBean(StudioWorldRepository::class.java),ctx.getBean(WorldDraftRepository::class.java),
                ctx.getBean(SettingCardRepository::class.java),ctx.getBean(SettingCardDraftRepository::class.java),ctx.getBean(SettingCardVersionRepository::class.java),
                ctx.getBean(WorldRevisionRepository::class.java),ctx.getBean(WorldRevisionCardRepository::class.java),ctx.getBean(WorldSaveRequestRepository::class.java),
                ctx.getBean(WorldRelationshipStateRepository::class.java),ctx.getBean(TemplatePublicationOnceRepository::class.java),ctx.getBean(ExpandedSeedProgressRepository::class.java),
                ctx.getBean(InitialWorldApplicationRepository::class.java),ctx.getBean(SettingCardImageRepository::class.java),graph,
                ctx.getBean("worldStudioTransactionManager",PlatformTransactionManager::class.java),ctx.getBean(JsonMapper::class.java))
            val world=ExpandedWorld("race",id,"확장","",listOf("one.json"))
            val chunk=ExpandedChunk(current.cards.map { it.copy(body="새 본문") },emptyList())
            Executors.newSingleThreadExecutor().use { pool ->
                val running=pool.submit<Throwable?> { runCatching { ExpandedTemplateSeeder(guarded,ctx.getBean(JsonMapper::class.java),true).seedWorld(world,listOf(chunk),null,base,current) }.exceptionOrNull() }
                try { assertTrue(entered.await(10,TimeUnit.SECONDS));assertThrows(WorldConflict::class.java) { ordinary.publication(id,owner,PublicationRequest("private",null)) } }
                finally { release.countDown() }
                assertNull(running.get(10,TimeUnit.SECONDS))
            }
            val worldAfter=ctx.getBean(StudioWorldRepository::class.java).findById(id).orElseThrow()
            assertEquals("public",worldAfter.visibility);assertNotEquals(original,worldAfter.currentRevisionId)
            assertTrue(ctx.getBean(ExpandedSeedProgressRepository::class.java).findById(id).orElseThrow().completed)
            assertEquals("private",ordinary.publication(id,owner,PublicationRequest("private",null)).visibility)
        } }
    }
    @Test fun `preexisting historical pending edit is not replaced by expanded create`() {
        WorldStudioPostgresFixture("independent").use { db -> context(db).use { ctx ->
            val owner=GenreTemplateSeeder.TEMPLATE_OWNER;val id=UUID.randomUUID()
            val mapper=ctx.getBean(JsonMapper::class.java)
            val template=historicalSyntheticFixtures().single { it.genre=="korea_history" }
                .let { it.copy(worldId=id,cards=it.cards.map { card -> card.copy(id=UUID.randomUUID()) }) }
            val old=CreateWorldRequest(template.name,template.description,id)
            val ordinary=ctx.getBean(WorldStudioService::class.java);ordinary.create(owner,old)
            val graph=org.mockito.Mockito.spy(ctx.getBean(Neo4jRelationshipRepository::class.java))
            var fail=true
            org.mockito.Mockito.doAnswer { call ->
                val result=call.callRealMethod()
                if(fail) { fail=false;throw WorldStudioFailure.unavailable() };result
            }.`when`(graph).replace(org.mockito.ArgumentMatchers.any(UUID::class.java) ?: UUID(0,0),org.mockito.ArgumentMatchers.anyLong(),
                org.mockito.ArgumentMatchers.anyString(),org.mockito.ArgumentMatchers.anyString(),org.mockito.ArgumentMatchers.anyList(),org.mockito.ArgumentMatchers.any<Int>())
            val interrupted=WorldStudioService(ctx.getBean(StudioWorldRepository::class.java),ctx.getBean(WorldDraftRepository::class.java),
                ctx.getBean(SettingCardRepository::class.java),ctx.getBean(SettingCardDraftRepository::class.java),ctx.getBean(SettingCardVersionRepository::class.java),
                ctx.getBean(WorldRevisionRepository::class.java),ctx.getBean(WorldRevisionCardRepository::class.java),ctx.getBean(WorldSaveRequestRepository::class.java),
                ctx.getBean(WorldRelationshipStateRepository::class.java),ctx.getBean(TemplatePublicationOnceRepository::class.java),ctx.getBean(ExpandedSeedProgressRepository::class.java),
                ctx.getBean(InitialWorldApplicationRepository::class.java),ctx.getBean(SettingCardImageRepository::class.java),graph,
                ctx.getBean("worldStudioTransactionManager",PlatformTransactionManager::class.java),ctx.getBean(JsonMapper::class.java))
            val original=EditWorldDraftRequest(0,old.name,old.description,GenreTemplateRepair.soulPayloads(template),key="genre-template-korea_history")
            assertThrows(WorldStudioFailure::class.java) { interrupted.edit(id,owner,original) }
            val before=ctx.getBean(WorldRelationshipStateRepository::class.java).findById(id).orElseThrow()
            val receipt=listOf(before.creationHash,before.requestKey,before.requestHash)
            val replacement=ExpandedWorld("korea_history",id,"한국 역사","검토 후보",listOf("one.json"))
            assertThrows(WorldStudioFailure::class.java) { ExpandedTemplateSeeder(ordinary,mapper,true).seedHistorical(replacement,
                listOf(ExpandedChunk(listOf(GenreTemplateCard(UUID.randomUUID(),"후보","본문","other")),emptyList())),historicalFixture(template,mapper)) }
            val after=ctx.getBean(WorldRelationshipStateRepository::class.java).findById(id).orElseThrow()
            assertFalse(after.completed);assertEquals(receipt,listOf(after.creationHash,after.requestKey,after.requestHash))
            assertTrue(ctx.getBean(ExpandedSeedProgressRepository::class.java).findById(id).isEmpty)
            assertEquals(original.cards.map { it.id }.toSet(),ordinary.edit(id,owner,original).cards.map { it.id }.toSet())
            assertEquals("private",ordinary.draft(id,owner).visibility)
        } }
    }
    @Test fun `all seven saved historical originals retain old cards and private choices after expansion`() {
        WorldStudioPostgresFixture("independent").use { db -> context(db).use { ctx ->
            val service=ctx.getBean(WorldStudioService::class.java);val mapper=ctx.getBean(JsonMapper::class.java)
            val owner=GenreTemplateSeeder.TEMPLATE_OWNER
            val frozen=historicalSyntheticFixtures()
            assertEquals(7,frozen.size);assertEquals(158,frozen.sumOf { it.cards.size })
            frozen.forEach { source ->
                val id=UUID.randomUUID()
                val original=source.copy(worldId=id,cards=source.cards.map { card -> card.copy(id=UUID.randomUUID()) })
                service.create(owner,CreateWorldRequest(original.name,original.description,id))
                val key="genre-template-${original.genre}"
                val oldEdit=service.edit(id,owner,EditWorldDraftRequest(0,original.name,original.description,GenreTemplateRepair.soulPayloads(original),key=key))
                val old=service.save(id,owner,SaveWorldRequest(oldEdit.draftRevision,key))
                val candidate=GenreTemplateCard(UUID.randomUUID(),"추가","후보 본문","other")
                val expanded=ExpandedWorld(original.genre,id,"새 역사","후보",listOf("one.json"))
                ExpandedTemplateSeeder(service,mapper,true).seedHistorical(expanded,listOf(ExpandedChunk(listOf(candidate),emptyList())),historicalFixture(original,mapper))
                val after=service.draft(id,owner)
                assertEquals("private",after.visibility)
                assertEquals(original.cards.map { it.id }.toSet()+candidate.id,after.cards.map { it.id }.toSet())
                assertEquals(old,service.revision(id,owner,old.revisionId))
                assertEquals(2,service.revision(id,owner,after.currentRevisionId!!).revisionNo)
                assertEquals("후보 본문",after.cards.single { it.id==candidate.id }.body)
            }
        } }
    }
    @Test fun `historical fingerprint does not overwrite a changed saved card`() {
        WorldStudioPostgresFixture("independent").use { db -> context(db).use { ctx ->
            val service=ctx.getBean(WorldStudioService::class.java);val mapper=ctx.getBean(JsonMapper::class.java)
            val owner=GenreTemplateSeeder.TEMPLATE_OWNER;val id=UUID.randomUUID()
            val original=GenreTemplate("korea_history",id,"합성 역사","설명",listOf(GenreTemplateCard(UUID.randomUUID(),"인물","본문","character","성격")))
            val key="genre-template-korea_history";val fingerprint=historicalFixture(original,mapper)
            service.create(owner,CreateWorldRequest(original.name,original.description,id))
            val old=service.edit(id,owner,EditWorldDraftRequest(0,original.name,original.description,GenreTemplateRepair.soulPayloads(original),key=key))
            val revision=service.save(id,owner,SaveWorldRequest(old.draftRevision,key))
            val changed=old.cards.single().copy(body="본문x")
            service.edit(id,owner,EditWorldDraftRequest(2,original.name,original.description,listOf(changed),key="user-edit"))
            val before=service.draft(id,owner)
            val expanded=ExpandedWorld(original.genre,id,"확장","설명",listOf("one.json"))
            ExpandedTemplateSeeder(service,mapper,true).seedHistorical(expanded,listOf(ExpandedChunk(listOf(GenreTemplateCard(UUID.randomUUID(),"후보","본문","other")),emptyList())),fingerprint)
            assertEquals(before,service.draft(id,owner))
            assertEquals(revision.revisionId,service.draft(id,owner).currentRevisionId)
            assertTrue(ctx.getBean(ExpandedSeedProgressRepository::class.java).findById(id).isEmpty)
        } }
    }
    @Test fun `historical user publication choice excludes expansion`() {
        WorldStudioPostgresFixture("independent").use { db -> context(db).use { ctx ->
            val service=ctx.getBean(WorldStudioService::class.java);val mapper=ctx.getBean(JsonMapper::class.java)
            val owner=GenreTemplateSeeder.TEMPLATE_OWNER;val id=UUID.randomUUID()
            val original=GenreTemplate("usa_history",id,"옛 역사","설명",listOf(GenreTemplateCard(UUID.randomUUID(),"장소","본문","location")))
            service.create(owner,CreateWorldRequest(original.name,original.description,id))
            val edited=service.edit(id,owner,EditWorldDraftRequest(0,original.name,original.description,GenreTemplateRepair.soulPayloads(original),key="genre-template-usa_history"))
            service.save(id,owner,SaveWorldRequest(edited.draftRevision,"genre-template-usa_history"))
            service.publication(id,owner,PublicationRequest("private",null))
            val before=service.draft(id,owner)
            val expanded=ExpandedWorld(original.genre,id,"새 역사","",listOf("one.json"))
            ExpandedTemplateSeeder(service,mapper,true).seedHistorical(expanded,listOf(ExpandedChunk(listOf(GenreTemplateCard(UUID.randomUUID(),"추가","본문","other")),emptyList())),historicalFixture(original,mapper))
            assertEquals(before,service.draft(id,owner));assertTrue(ctx.getBean(ExpandedSeedProgressRepository::class.java).findById(id).isEmpty)
        } }
    }
    @Test fun `concurrent original expansions converge without replacing the old revision`() {
        WorldStudioPostgresFixture("independent").use { db -> context(db).use { ctx ->
            val service=ctx.getBean(WorldStudioService::class.java);val owner=GenreTemplateSeeder.TEMPLATE_OWNER;val id=UUID.randomUUID()
            val person=GenreTemplateCard(UUID.randomUUID(),"인물","원문","character")
            val base=GenreTemplate("concurrent",id,"세계","",listOf(person))
            val current=base.copy(cards=listOf(person.copy(soul="성격")))
            service.createTemplate(CreateWorldRequest(base.name,base.description,id))
            val edit=service.edit(id,owner,EditWorldDraftRequest(0,base.name,base.description,GenreTemplateRepair.payloads(base),key="genre-template-concurrent"))
            service.save(id,owner,SaveWorldRequest(edit.draftRevision,"genre-template-concurrent"))
            GenreTemplateRepair(service).repairSoul(null,base,current)
            val old=service.draft(id,owner).currentRevisionId!!
            val world=ExpandedWorld("concurrent",id,"확장 세계","",listOf("one.json","two.json"))
            val chunks=listOf(ExpandedChunk(listOf(current.cards.single().copy(body="새 본문")),emptyList()),
                ExpandedChunk(listOf(GenreTemplateCard(UUID.randomUUID(),"추가","본문","other")),emptyList()))
            val seeder=ExpandedTemplateSeeder(service,ctx.getBean(JsonMapper::class.java),true)
            val start=CountDownLatch(1)
            Executors.newFixedThreadPool(2).use { pool ->
                val jobs=List(2) { pool.submit<Throwable?> { start.await();runCatching { seeder.seedWorld(world,chunks,null,base,current) }.exceptionOrNull() } }
                start.countDown()
                jobs.map { it.get(30,TimeUnit.SECONDS) }.filterNotNull().forEach { assertTrue(it is WorldConflict || it is WorldStudioFailure,it.toString()) }
            }
            seeder.seedWorld(world,chunks,null,base,current)
            val after=service.draft(id,owner)
            assertEquals("public",after.visibility);assertEquals(2,after.cards.size);assertNotEquals(old,after.currentRevisionId)
            assertEquals("원문",service.revision(id,owner,old).cards.single().card.body)
            assertEquals(3,service.revision(id,owner,after.currentRevisionId!!).revisionNo)
        } }
    }
    @Test fun `public relation reads hide partial expansion and reject completion during graph read`() {
        WorldStudioPostgresFixture("independent").use { db -> context(db).use { ctx ->
            val service=ctx.getBean(WorldStudioService::class.java);val owner=GenreTemplateSeeder.TEMPLATE_OWNER;val id=UUID.randomUUID()
            val a=GenreTemplateCard(UUID.randomUUID(),"하나","원문","character")
            val b=GenreTemplateCard(UUID.randomUUID(),"둘","원문","character")
            val base=GenreTemplate("visibility",id,"원본","",listOf(a,b))
            val current=base.copy(cards=base.cards.map { it.copy(soul="성격") })
            service.createTemplate(CreateWorldRequest(base.name,base.description,id))
            val edit=service.edit(id,owner,EditWorldDraftRequest(0,base.name,base.description,GenreTemplateRepair.payloads(base),key="genre-template-visibility"))
            service.save(id,owner,SaveWorldRequest(edit.draftRevision,"genre-template-visibility"))
            GenreTemplateRepair(service).repairSoul(null,base,current)
            val old=service.draft(id,owner)
            val entered=CountDownLatch(1);val release=CountDownLatch(1)
            val slow=org.mockito.Mockito.spy(ctx.getBean(Neo4jRelationshipRepository::class.java))
            org.mockito.Mockito.doAnswer { call -> val result=call.callRealMethod();entered.countDown();check(release.await(10,TimeUnit.SECONDS));result }
                .`when`(slow).read(id,1) // 공개 상세는 기준 회차 시점으로 읽는다(DEC-53): 연결된 소설이 없는 세계관의 기준 회차는 1화라 최신(null)이 아니다
            fun publicView(graph:Neo4jRelationshipRepository)=ai.storyfork.content.world.service.PublicWorldService(ctx.getBean(StudioWorldRepository::class.java),
                ctx.getBean(WorldRevisionRepository::class.java),ctx.getBean(WorldRevisionCardRepository::class.java),
                ctx.getBean(SettingCardVersionRepository::class.java),ctx.getBean(SettingCardImageRepository::class.java),
                ctx.getBean(WorldRelationshipStateRepository::class.java),ctx.getBean(ExpandedSeedProgressRepository::class.java),graph,
                org.mockito.Mockito.mock(ai.storyfork.content.auth.service.CoreNicknameService::class.java),
                org.mockito.Mockito.mock(ai.storyfork.content.attachment.client.AttachmentStorageClient::class.java),
                org.mockito.Mockito.mock(ai.storyfork.content.work.repository.WorkRepository::class.java),
                org.mockito.Mockito.mock(ai.storyfork.content.work.service.WorkAccessService::class.java),
                org.mockito.Mockito.mock(ai.storyfork.content.attachment.repository.ContentImageRepository::class.java),
                org.mockito.Mockito.mock(ai.storyfork.content.publication.service.PublicationService::class.java),
                ctx.getBean("worldStudioTransactionManager",PlatformTransactionManager::class.java))
            val view=publicView(ctx.getBean(Neo4jRelationshipRepository::class.java))
            Executors.newSingleThreadExecutor().use { pool ->
                val running=pool.submit<PublicWorldResponse> { publicView(slow).detail(id) }
                try {
                    assertTrue(entered.await(10,TimeUnit.SECONDS))
                    assertEquals(0,service.startPristineExpanded("digest",null,base,current))
                    val pending=view.detail(id)
                    assertEquals("unavailable",pending.relationshipStatus);assertTrue(pending.relationships.isEmpty())
                    assertEquals(setOf(a.id,b.id),pending.cards.map { it.id }.toSet())
                    assertNull(view.list(null,null,"100").items.single { it.id==id }.relationshipCount)
                    assertEquals("unavailable",view.readerCards("work",id,1).relationshipStatus)
                    assertThrows(WorldConflict::class.java) { service.edit(id,owner,EditWorldDraftRequest(old.draftRevision,base.name,base.description,key="author-edit")) }
                    assertThrows(WorldConflict::class.java) { service.save(id,owner,SaveWorldRequest(old.draftRevision,"author-save")) }
                    val relation=RelationshipPayload(UUID.randomUUID(),a.id,b.id,"structural","출처",label="관계",direction="directed")
                    val changed=service.editExpanded(id,"digest",0,EditWorldDraftRequest(old.draftRevision,base.name,base.description,
                        relationships=listOf(relation),key="expanded-$id-0"))
                    assertEquals("unavailable",view.detail(id).relationshipStatus)
                    assertThrows(WorldConflict::class.java) { service.publication(id,owner,PublicationRequest("private",null)) }
                    service.saveExpanded(id,"digest",1,SaveWorldRequest(changed.draftRevision,"expanded-$id-save"))
                    assertEquals(listOf(relation.id),view.detail(id).relationships.map { it.id })
                } finally { release.countDown() }
                assertEquals("unavailable",running.get(10,TimeUnit.SECONDS).relationshipStatus)
            }
        } }
    }
    @Test fun `all manifest cards and relations reach public confirmed worlds`() {
        WorldStudioPostgresFixture("independent").use { db -> context(db).use { ctx ->
            val mapper=ctx.getBean(JsonMapper::class.java);val service=ctx.getBean(WorldStudioService::class.java)
            val manifest=ClassPathResource("sample-worlds-expanded/manifest.json").inputStream.use { mapper.readValue(it,ExpandedManifest::class.java) }
            val legacy=GenreTemplateSeeder(service,mapper)
            val old=legacy.loadLegacy().associateBy { it.worldId }
            val baseline=legacy.loadV2().associateBy { it.worldId }
            val current=legacy.load().associateBy { it.worldId }
            val seeder=ExpandedTemplateSeeder(service,mapper,true)
            val publicService=ai.storyfork.content.world.service.PublicWorldService(ctx.getBean(StudioWorldRepository::class.java),
                ctx.getBean(WorldRevisionRepository::class.java),ctx.getBean(WorldRevisionCardRepository::class.java),
                ctx.getBean(SettingCardVersionRepository::class.java),ctx.getBean(SettingCardImageRepository::class.java),
                ctx.getBean(WorldRelationshipStateRepository::class.java),ctx.getBean(ExpandedSeedProgressRepository::class.java),ctx.getBean(Neo4jRelationshipRepository::class.java),
                org.mockito.Mockito.mock(ai.storyfork.content.auth.service.CoreNicknameService::class.java),
                org.mockito.Mockito.mock(ai.storyfork.content.attachment.client.AttachmentStorageClient::class.java),
                org.mockito.Mockito.mock(ai.storyfork.content.work.repository.WorkRepository::class.java),
                org.mockito.Mockito.mock(ai.storyfork.content.work.service.WorkAccessService::class.java),
                org.mockito.Mockito.mock(ai.storyfork.content.attachment.repository.ContentImageRepository::class.java),
                org.mockito.Mockito.mock(ai.storyfork.content.publication.service.PublicationService::class.java),
                ctx.getBean("worldStudioTransactionManager",PlatformTransactionManager::class.java))
            assertEquals(36,manifest.worlds.size)
            assertEquals(16461,manifest.worlds.sumOf { world -> world.chunks.sumOf { name ->
                ClassPathResource("sample-worlds-expanded/$name").inputStream.use { mapper.readValue(it,ExpandedChunk::class.java).cards.size }
            } })
            assertEquals(4216,manifest.worlds.sumOf { world -> world.chunks.sumOf { name ->
                ClassPathResource("sample-worlds-expanded/$name").inputStream.use { mapper.readValue(it,ExpandedChunk::class.java).relationships.size }
            } })
            manifest.worlds.forEach { source ->
                val prefix=UUID.randomUUID().toString()
                fun isolated(id:UUID)=UUID.nameUUIDFromBytes("$prefix:$id".toByteArray())
                val chunks=source.chunks.map { name ->
                    val chunk=ClassPathResource("sample-worlds-expanded/$name").inputStream.use { mapper.readValue(it,ExpandedChunk::class.java) }
                    ExpandedChunk(chunk.cards.map { it.copy(id=isolated(it.id)) },chunk.relationships.map {
                        it.copy(id=isolated(it.id),sourceCardId=it.sourceCardId?.let(::isolated),targetCardId=it.targetCardId?.let(::isolated))
                    })
                }
                val world=source.copy(worldId=UUID.randomUUID())
                fun mapped(template:GenreTemplate?)=template?.copy(worldId=world.worldId,cards=template.cards.map { it.copy(id=isolated(it.id)) })
                val prior=mapped(old[source.worldId]);val frozen=mapped(baseline[source.worldId]);val latest=mapped(current[source.worldId])
                if(frozen!=null && latest!=null) {
                    val first=prior ?: frozen
                    service.createTemplate(CreateWorldRequest(first.name,first.description,world.worldId))
                    val initial=if(prior!=null) prior.cards.map { CardPayload(it.id,it.title,it.body,it.cardType,"basic",visibility="public") }
                        else GenreTemplateRepair.payloads(frozen)
                    val key="genre-template-${first.genre}"
                    val edit=service.edit(world.worldId,GenreTemplateSeeder.TEMPLATE_OWNER,EditWorldDraftRequest(0,first.name,first.description,initial,key=key))
                    service.save(world.worldId,GenreTemplateSeeder.TEMPLATE_OWNER,SaveWorldRequest(edit.draftRevision,key))
                    val repair=GenreTemplateRepair(service)
                    if(prior!=null) repair.repair(prior,frozen)
                    repair.repairSoul(prior,frozen,latest)
                    seeder.seedWorld(world,chunks,prior,frozen,latest)
                } else seeder.seedWorld(world,chunks)
                val visible=publicService.detail(world.worldId)
                assertEquals(chunks.flatMap { it.cards }.associate { it.id to it.body },visible.cards.associate { it.id to it.text },source.genre)
                val expected=chunks.flatMap { it.relationships }
                assertEquals(expected.associateBy { it.id },service.draft(world.worldId,GenreTemplateSeeder.TEMPLATE_OWNER).relationships.associateBy { it.id },source.genre)
                assertEquals(expected.associate { it.id to PublicWorldRelationshipResponse(it.id,it.sourceCardId!!,it.targetCardId!!,it.label,it.category,it.body,it.direction,it.polarity) },
                    visible.relationships.associateBy { it.id },source.genre)
                assertEquals("current",visible.relationshipStatus)
            }
        } }
    }
    @Test fun `chunked relations remain readable after crossing the per request limit`() {
        WorldStudioPostgresFixture("independent").use { db -> context(db).use { ctx ->
            val service=ctx.getBean(WorldStudioService::class.java)
            val owner=GenreTemplateSeeder.TEMPLATE_OWNER
            val id=UUID.randomUUID();val a=UUID.randomUUID();val b=UUID.randomUUID()
            service.createTemplate(CreateWorldRequest("관계 샘플","",id))
            val cards=listOf(CardPayload(a,"인물 A","설명","character","basic",visibility="public"),
                CardPayload(b,"인물 B","설명","character","basic",visibility="public"))
            val relations=(1..1001).map { RelationshipPayload(UUID.randomUUID(),a,b,"structural",label="관계") }
            val first=service.edit(id,owner,EditWorldDraftRequest(0,"관계 샘플","",cards,relations.take(1000),key="first"))
            val second=service.edit(id,owner,EditWorldDraftRequest(first.draftRevision,"관계 샘플","",relationships=relations.drop(1000),key="second"))
            service.save(id,owner,SaveWorldRequest(second.draftRevision,"save"))
            assertEquals(relations.map { it.id }.toSet(),service.draft(id,owner).relationships.map { it.id }.toSet())
            val publicService=ai.storyfork.content.world.service.PublicWorldService(ctx.getBean(StudioWorldRepository::class.java),
                ctx.getBean(WorldRevisionRepository::class.java),ctx.getBean(WorldRevisionCardRepository::class.java),
                ctx.getBean(SettingCardVersionRepository::class.java),ctx.getBean(SettingCardImageRepository::class.java),
                ctx.getBean(WorldRelationshipStateRepository::class.java),ctx.getBean(ExpandedSeedProgressRepository::class.java),ctx.getBean(Neo4jRelationshipRepository::class.java),
                org.mockito.Mockito.mock(ai.storyfork.content.auth.service.CoreNicknameService::class.java),
                org.mockito.Mockito.mock(ai.storyfork.content.attachment.client.AttachmentStorageClient::class.java),
                org.mockito.Mockito.mock(ai.storyfork.content.work.repository.WorkRepository::class.java),
                org.mockito.Mockito.mock(ai.storyfork.content.work.service.WorkAccessService::class.java),
                org.mockito.Mockito.mock(ai.storyfork.content.attachment.repository.ContentImageRepository::class.java),
                org.mockito.Mockito.mock(ai.storyfork.content.publication.service.PublicationService::class.java),
                ctx.getBean("worldStudioTransactionManager",PlatformTransactionManager::class.java))
            val published=publicService.detail(id)
            assertEquals(cards.map { it.id }.toSet(),published.cards.map { it.id }.toSet())
            assertEquals(relations.map { it.id }.toSet(),published.relationships.map { it.id }.toSet())
        } }
    }
    @Test fun `new myth seeds final typed cards once and preserves later author edits`() {
        WorldStudioPostgresFixture("independent").use { db ->
            val mapper = JsonMapper.builder().addModule(KotlinModule.Builder().build()).build()
            val owner = GenreTemplateSeeder.TEMPLATE_OWNER
            val worldId = UUID.randomUUID()
            var revisionId = UUID.randomUUID()
            var template: GenreTemplate? = null
            fun seeded(service: WorldStudioService): GenreTemplateSeeder {
                val seeder = org.mockito.Mockito.spy(GenreTemplateSeeder(service, mapper))
                if (template == null) template = seeder.load().first { it.genre == "norse_mythology" }.let { t ->
                    t.copy(worldId = worldId, cards = t.cards.map { it.copy(id = UUID.randomUUID()) })
                }
                org.mockito.Mockito.doReturn(emptyList<GenreTemplate>()).`when`(seeder).loadLegacy()
                val frozen = template!!.copy(cards = template!!.cards.map { it.copy(soul = null) })
                org.mockito.Mockito.doReturn(listOf(frozen)).`when`(seeder).loadV2()
                org.mockito.Mockito.doReturn(listOf(template!!)).`when`(seeder).load()
                return seeder
            }
            context(db).use { ctx ->
                val service = ctx.getBean(WorldStudioService::class.java)
                val seeder = seeded(service)
                seeder.seed()
                val draft = service.draft(worldId, owner)
                assertEquals(4L, draft.draftRevision)
                assertEquals(GenreTemplateRepair.soulPayloads(template!!).toSet(), draft.cards.toSet())
                revisionId = draft.currentRevisionId!!
                val saved = service.revision(worldId, owner, revisionId)
                assertEquals(2L, saved.revisionNo)
                assertEquals(draft.cards.toSet(), saved.cards.map { it.card }.toSet())
                val first = service.revision(worldId, owner, saved.parentRevisionId!!)
                assertEquals(1L, first.revisionNo)
                assertEquals(GenreTemplateRepair.payloads(template!!).toSet(), first.cards.map { it.card }.toSet())
                assertTrue(first.cards.none { it.card.semanticMetadata.containsKey("characterDocs") })
                saved.cards.filter { it.card.cardType == "character" }.forEach { card ->
                    val soul = template!!.cards.single { it.id == card.card.id }.soul
                    assertEquals(mapOf("soul" to soul, "goal" to "", "episodes" to emptyMap<String, String>()), card.card.semanticMetadata["characterDocs"])
                }
                seeder.seed()
                assertEquals(draft, service.draft(worldId, owner))
            }
            context(db).use { ctx ->
                val service = ctx.getBean(WorldStudioService::class.java)
                val seeder = seeded(service)
                seeder.seed()
                val draft = service.draft(worldId, owner)
                assertEquals(revisionId, draft.currentRevisionId)
                val card = draft.cards.first().copy(body = "사용자가 고친 설명")
                service.edit(worldId, owner, EditWorldDraftRequest(4, draft.name, draft.description, listOf(card), key = "author-edit"))
                val changed = service.draft(worldId, owner)
                seeder.seed()
                assertEquals(changed, service.draft(worldId, owner))
            }
        }
    }
    @Test fun `new template creation and marker commit or roll back together`() {
        WorldStudioPostgresFixture("independent").use { db -> context(db).use { ctx ->
            val service=ctx.getBean(WorldStudioService::class.java);val id=UUID.randomUUID()
            db.connect().use { c -> WorldStudioPostgresFixture.sql(c,"""CREATE FUNCTION worldstudio.qa_fail_new_marker() RETURNS trigger LANGUAGE plpgsql AS ${'$'}${'$'} BEGIN RAISE EXCEPTION 'fail marker'; END; ${'$'}${'$'};
                CREATE TRIGGER qa_fail_new_marker BEFORE INSERT ON worldstudio.template_publication_once FOR EACH ROW EXECUTE FUNCTION worldstudio.qa_fail_new_marker();""") }
            assertThrows(RuntimeException::class.java) { service.createTemplate(CreateWorldRequest("새 샘플","",id)) }
            db.connect().use { c -> assertEquals(listOf("0"),WorldStudioPostgresFixture.rows(c,"SELECT count(*) FROM worldstudio.world WHERE id='$id'"))
                assertEquals(listOf("0"),WorldStudioPostgresFixture.rows(c,"SELECT count(*) FROM worldstudio.template_publication_once WHERE world_id='$id'"))
                WorldStudioPostgresFixture.sql(c,"DROP TRIGGER qa_fail_new_marker ON worldstudio.template_publication_once") }
            assertEquals("public",service.createTemplate(CreateWorldRequest("새 샘플","",id)).visibility)
            db.connect().use { c -> assertEquals(listOf("1"),WorldStudioPostgresFixture.rows(c,"SELECT count(*) FROM worldstudio.template_publication_once WHERE world_id='$id'")) }
        } }
    }
    @Test fun `legacy template publication rolls back atomically serializes and preserves later private choice across restart`() {
        WorldStudioPostgresFixture("independent").use { db ->
            val owner=GenreTemplateSeeder.TEMPLATE_OWNER
            val template=GenreTemplate("fixture",UUID.randomUUID(),"옛 샘플","설명",
                listOf(ai.storyfork.content.world.service.GenreTemplateCard(UUID.randomUUID(),"장소","원문","location")))
            fun markerCount()=db.connect().use { c -> WorldStudioPostgresFixture.rows(c,
                "SELECT count(*) FROM worldstudio.template_publication_once WHERE world_id='${template.worldId}'").single().toInt() }
            context(db).use { ctx ->
                val service=ctx.getBean(WorldStudioService::class.java)
                val created=service.create(owner,CreateWorldRequest(template.name,template.description,template.worldId))
                val card=template.cards.single().let { CardPayload(it.id,it.title,it.body,it.cardType,"basic",visibility="public") }
                val edited=service.edit(template.worldId,owner,EditWorldDraftRequest(created.draftRevision,template.name,template.description,listOf(card),key="genre-template-fixture"))
                service.save(template.worldId,owner,SaveWorldRequest(edited.draftRevision,"genre-template-fixture"))
                db.connect().use { c -> WorldStudioPostgresFixture.sql(c,"""CREATE FUNCTION worldstudio.qa_fail_marker() RETURNS trigger LANGUAGE plpgsql AS ${'$'}${'$'} BEGIN RAISE EXCEPTION 'fail marker'; END; ${'$'}${'$'};
                    CREATE TRIGGER qa_fail_marker BEFORE INSERT ON worldstudio.template_publication_once FOR EACH ROW EXECUTE FUNCTION worldstudio.qa_fail_marker();""") }
                assertThrows(RuntimeException::class.java) { service.publishPristineTemplate(template,null,null) }
                assertEquals("private",service.draft(template.worldId,owner).visibility);assertEquals(0,markerCount())
                db.connect().use { c -> WorldStudioPostgresFixture.sql(c,"DROP TRIGGER qa_fail_marker ON worldstudio.template_publication_once") }
                Executors.newFixedThreadPool(2).use { pool ->
                    pool.invokeAll(List(2) { Callable { service.publishPristineTemplate(template,null,null) } }).forEach { it.get() }
                }
                assertEquals("public",service.draft(template.worldId,owner).visibility);assertEquals(1,markerCount())
                service.publication(template.worldId,owner,PublicationRequest("private",null))
            }
            context(db).use { ctx ->
                val service=ctx.getBean(WorldStudioService::class.java)
                service.publishPristineTemplate(template,null,null)
                assertEquals("private",service.draft(template.worldId,owner).visibility);assertEquals(1,markerCount())
            }
        }
    }
    @Test fun `legacy private cards edits and graph mismatch are never automatically published`() {
        WorldStudioPostgresFixture("independent").use { db -> context(db).use { ctx ->
            val service=ctx.getBean(WorldStudioService::class.java);val graph=ctx.getBean(Neo4jRelationshipRepository::class.java)
            val owner=GenreTemplateSeeder.TEMPLATE_OWNER
            fun fixture(genre:String,visibility:String="public"):GenreTemplate {
                val t=GenreTemplate(genre,UUID.randomUUID(),"샘플","설명",
                    listOf(ai.storyfork.content.world.service.GenreTemplateCard(UUID.randomUUID(),"인물","원문","character")))
                service.create(owner,CreateWorldRequest(t.name,t.description,t.worldId))
                val card=t.cards.single().let { CardPayload(it.id,it.title,it.body,it.cardType,"basic",visibility=visibility) }
                val edit=service.edit(t.worldId,owner,EditWorldDraftRequest(0,t.name,t.description,listOf(card),key="genre-template-$genre"))
                service.save(t.worldId,owner,SaveWorldRequest(edit.draftRevision,"genre-template-$genre"));return t
            }
            val privateCard=fixture("private","private")
            service.publishPristineTemplate(privateCard,null,null)
            assertEquals("private",service.draft(privateCard.worldId,owner).visibility)
            val untouched=fixture("untouched")
            service.publishPristineTemplate(untouched,null,null)
            service.publication(untouched.worldId,owner,PublicationRequest("private",null))
            val changed=fixture("changed")
            val before=service.draft(changed.worldId,owner)
            service.edit(changed.worldId,owner,EditWorldDraftRequest(before.draftRevision,before.name,before.description,
                listOf(before.cards.single().copy(body="변경")),key="author"))
            service.publishPristineTemplate(changed,null,null)
            assertEquals("private",service.draft(changed.worldId,owner).visibility)
            service.publishPristineTemplate(untouched,null,null)
            assertEquals("private",service.draft(untouched.worldId,owner).visibility)
            val mismatch=fixture("mismatch")
            graph.replace(mismatch.worldId,1,"other","other",emptyList())
            assertThrows(WorldStudioFailure::class.java) { service.publishPristineTemplate(mismatch,null,null) }
            db.connect().use { c -> assertEquals(listOf("0"),WorldStudioPostgresFixture.rows(c,
                "SELECT count(*) FROM worldstudio.template_publication_once WHERE world_id='${mismatch.worldId}'")) }
        } }
    }
    @Test fun `private choice while graph is read wins over migration`() {
        WorldStudioPostgresFixture("independent").use { db -> context(db).use { ctx ->
            val service=ctx.getBean(WorldStudioService::class.java);val owner=GenreTemplateSeeder.TEMPLATE_OWNER
            val card=ai.storyfork.content.world.service.GenreTemplateCard(UUID.randomUUID(),"장소","원문","location")
            val template=GenreTemplate("choice",UUID.randomUUID(),"세계","설명",listOf(card))
            service.create(owner,CreateWorldRequest(template.name,template.description,template.worldId))
            val edit=service.edit(template.worldId,owner,EditWorldDraftRequest(0,template.name,template.description,
                listOf(CardPayload(card.id,card.title,card.body,card.cardType,"basic",visibility="public")),key="genre-template-choice"))
            service.save(template.worldId,owner,SaveWorldRequest(edit.draftRevision,"genre-template-choice"))
            val entered=CountDownLatch(1);val release=CountDownLatch(1)
            val slow=org.mockito.Mockito.spy(ctx.getBean(Neo4jRelationshipRepository::class.java))
            org.mockito.Mockito.doAnswer { invocation -> val result=invocation.callRealMethod();entered.countDown()
                check(release.await(10,TimeUnit.SECONDS));result }.`when`(slow).read(template.worldId)
            val migration=WorldStudioService(ctx.getBean(StudioWorldRepository::class.java),ctx.getBean(WorldDraftRepository::class.java),
                ctx.getBean(SettingCardRepository::class.java),ctx.getBean(SettingCardDraftRepository::class.java),ctx.getBean(SettingCardVersionRepository::class.java),
                ctx.getBean(WorldRevisionRepository::class.java),ctx.getBean(WorldRevisionCardRepository::class.java),ctx.getBean(WorldSaveRequestRepository::class.java),
                ctx.getBean(WorldRelationshipStateRepository::class.java),ctx.getBean(TemplatePublicationOnceRepository::class.java),ctx.getBean(ExpandedSeedProgressRepository::class.java),
                ctx.getBean(InitialWorldApplicationRepository::class.java),ctx.getBean(SettingCardImageRepository::class.java),slow,
                ctx.getBean("worldStudioTransactionManager",PlatformTransactionManager::class.java),ctx.getBean(JsonMapper::class.java))
            Executors.newSingleThreadExecutor().use { pool ->
                val future=pool.submit { migration.publishPristineTemplate(template,null,null) }
                try { assertTrue(entered.await(10,TimeUnit.SECONDS));service.publication(template.worldId,owner,PublicationRequest("private",null)) }
                finally { release.countDown() }
                future.get(10,TimeUnit.SECONDS)
            }
            assertEquals("private",service.draft(template.worldId,owner).visibility)
            service.publishPristineTemplate(template,null,null)
            assertEquals("private",service.draft(template.worldId,owner).visibility)
        } }
    }
    @Test fun `frozen v1 v2 and soul history is eligible without changing card history`() {
        WorldStudioPostgresFixture("independent").use { db -> context(db).use { ctx ->
            val service=ctx.getBean(WorldStudioService::class.java);val owner=GenreTemplateSeeder.TEMPLATE_OWNER
            val old=ai.storyfork.content.world.service.GenreTemplateCard(UUID.randomUUID(),"옛 장소","원문","location")
            val person=ai.storyfork.content.world.service.GenreTemplateCard(UUID.randomUUID(),"인물","원문","character")
            val legacy=GenreTemplate("history",UUID.randomUUID(),"세계","설명",listOf(old))
            val baseline=legacy.copy(cards=listOf(person));val current=baseline.copy(cards=listOf(person.copy(soul="차분하다")))
            service.create(owner,CreateWorldRequest(legacy.name,legacy.description,legacy.worldId))
            val edited=service.edit(legacy.worldId,owner,EditWorldDraftRequest(0,legacy.name,legacy.description,
                listOf(CardPayload(old.id,old.title,old.body,old.cardType,"basic",visibility="public")),key="genre-template-history"))
            service.save(legacy.worldId,owner,SaveWorldRequest(edited.draftRevision,"genre-template-history"))
            val repair=GenreTemplateRepair(service);repair.repair(legacy,baseline);repair.repairSoul(legacy,baseline,current)
            val before=service.draft(legacy.worldId,owner);val saved=service.revision(legacy.worldId,owner,before.currentRevisionId!!)
            service.publishPristineTemplate(legacy,baseline,current)
            val after=service.draft(legacy.worldId,owner)
            assertEquals("public",after.visibility);assertEquals(before.cards,after.cards)
            assertEquals(saved,service.revision(legacy.worldId,owner,before.currentRevisionId!!))
            assertTrue(saved.cards.any { it.card.lifecycle=="removed" })
        } }
    }
    @Test fun `startup migrates the worldstudio schema once and validates it`() {
        WorldStudioPostgresFixture("independent").use { db ->
            context(db).use { ctx -> assertTrue(ctx.containsBean("worldStudioService")) }
            context(db).close()
            assertEquals(0,db.studio().migrate().migrationsExecuted)
        }
    }
    @Test fun `current relation CRUD survives restart without PostgreSQL relationship copies or history`() {
        WorldStudioPostgresFixture("independent").use { db ->
            db.studio().migrate();val actor=UUID.randomUUID();val card=UUID.randomUUID();val target=UUID.randomUUID()
            val original=CardPayload(card,"홍길동","  원문 | 보존\n다음 줄","character","basic",aliases=listOf("길동","길동"),tags=listOf("둘","하나"))
            val place=CardPayload(target,"본거지","비밀 장소","location","space")
            val relationship=RelationshipPayload(UUID.randomUUID(),card,target,"emotional","신뢰하면서도 경계한다",direction="directed",polarity="asserted")
            val create=CreateWorldRequest("홍길동전","작품 없이 시작");var first=UUID.randomUUID();var last=0L
            context(db).use { ctx ->
                assertEquals(1,ctx.getBeansOfType(DataSource::class.java).size);assertEquals(1,ctx.getBeansOfType(EntityManagerFactory::class.java).size)
                assertEquals(1,ctx.getBeansOfType(PlatformTransactionManager::class.java).size);assertFalse(ctx.containsBean("worldStudioDataSource"))
                val service=ctx.getBean(WorldStudioService::class.java);val created=service.create(actor,create)
                assertEquals(created,service.create(actor,create))
                val more=listOf("organization","ability","object","rule","event","other").mapIndexed { i,type ->
                    CardPayload(UUID.randomUUID(),type,"각 유형 원문",type,listOf("history","society","culture","special","conflict","basic")[i]) }
                val edit=EditWorldDraftRequest(created.draftRevision,created.name,created.description,listOf(original,place)+more,listOf(relationship),"edit-1",true)
                val edited=service.edit(create.id,actor,edit);assertEquals(edited,service.edit(create.id,actor,edit))
                assertEquals(listOf(relationship),edited.relationships)
                val incomplete=service.edit(create.id,actor,EditWorldDraftRequest(edited.draftRevision,edited.name,"",listOf(original.copy(body="")),key="incomplete"))
                assertThrows(IllegalArgumentException::class.java) { service.save(create.id,actor,SaveWorldRequest(incomplete.draftRevision,"invalid")) }
                assertEquals(incomplete,service.draft(create.id,actor))
                val fixed=service.edit(create.id,actor,EditWorldDraftRequest(incomplete.draftRevision,incomplete.name,"",listOf(original),key="fixed"))
                val saved=service.save(create.id,actor,SaveWorldRequest(fixed.draftRevision,"save-1"));first=saved.revisionId
                assertEquals(8,saved.cards.map { it.card.cardType }.toSet().size);assertEquals(7,saved.cards.map { it.card.areaCode }.toSet().size)
                assertNull(saved.relationships);assertEquals("not_recorded",saved.relationshipStatus)
                assertEquals(saved,service.save(create.id,actor,SaveWorldRequest(fixed.draftRevision,"save-1")))
                assertThrows(WorldConflict::class.java) { service.save(create.id,actor,SaveWorldRequest(fixed.draftRevision+1,"save-1")) }
                assertThrows(WorldNotFound::class.java) { service.draft(create.id,UUID.randomUUID()) }
                assertThrows(WorldNotFound::class.java) { service.revision(create.id,UUID.randomUUID(),first) }
                val before=service.draft(create.id,actor)
                val changed=service.edit(create.id,actor,EditWorldDraftRequest(before.draftRevision,before.name,"",relationships=listOf(relationship.copy(body="変更",direction="symmetric")),key="update"))
                assertEquals("symmetric",changed.relationships.single().direction)
                val removed=service.edit(create.id,actor,EditWorldDraftRequest(changed.draftRevision,changed.name,"",changed.cards,emptyList(),"delete",true))
                assertTrue(removed.relationships.isEmpty());assertEquals(original,service.revision(create.id,actor,first).cards.single { it.card.id==card }.card)
                assertThrows(WorldNotFound::class.java) { service.restore(create.id,actor,UUID.randomUUID(),RestoreWorldRequest(removed.draftRevision)) }
                // Card revision commit failures still roll back pointer, manifest and request atomically within PostgreSQL.
                db.connect().use { c -> WorldStudioPostgresFixture.sql(c,"""CREATE FUNCTION worldstudio.qa_fail_commit() RETURNS trigger LANGUAGE plpgsql AS ${'$'}${'$'} BEGIN IF NEW.request_key='fail-late' THEN RAISE EXCEPTION 'synthetic late failure' USING ERRCODE='23514'; END IF; RETURN NULL; END; ${'$'}${'$'};
                    CREATE CONSTRAINT TRIGGER qa_fail_commit AFTER INSERT ON worldstudio.world_save_request DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION worldstudio.qa_fail_commit();""") }
                assertThrows(RuntimeException::class.java) { service.save(create.id,actor,SaveWorldRequest(removed.draftRevision,"fail-late")) };assertEquals(removed,service.draft(create.id,actor))
                val another=service.create(actor,CreateWorldRequest("別世界"))
                assertThrows(WorldNotFound::class.java) { service.edit(another.worldId,actor,EditWorldDraftRequest(0,another.name,"",listOf(original),key="foreign")) }
                // DEC-51: 연결은 두 카드 사이에만 있으니 다른 세계관의 관계 ID를 재사용하는 요청도 이 세계관의 실제 카드 둘을 끝점으로 쓴다.
                val mine=listOf(CardPayload(UUID.randomUUID(),"다른 인물","원문","character","basic"),CardPayload(UUID.randomUUID(),"다른 장소","원문","location","space"))
                val collision=EditWorldDraftRequest(0,another.name,"",mine,listOf(relationship.copy(sourceCardId=mine[0].id,targetCardId=mine[1].id)),"foreign-relation",true)
                assertEquals("WORLD_WRITE_REJECTED",assertThrows(WorldStudioFailure::class.java) { service.edit(another.worldId,actor,collision) }.code)
                assertEquals(another,service.draft(another.worldId,actor))
                val corrected=collision.copy(key="corrected",relationships=listOf(collision.relationships.single().copy(id=UUID.randomUUID())))
                assertEquals(1L,service.edit(another.worldId,actor,corrected).draftRevision)
                assertEquals(removed,service.draft(create.id,actor))
                assertEquals("WORLD_WRITE_REJECTED",assertThrows(WorldStudioFailure::class.java) { service.edit(create.id,actor,EditWorldDraftRequest(0,"stale","",key="stale")) }.code)
                last=removed.draftRevision
            }
            context(db).use { ctx -> val service=ctx.getBean(WorldStudioService::class.java)
                assertEquals(first,service.revision(create.id,actor,first).revisionId);assertEquals(last,service.draft(create.id,actor).draftRevision)
                val confirmedContext=service.confirmedContext(create.id,actor,first)
                assertEquals(original,confirmedContext.cards.single {it.card.id==card}.card)
                assertEquals(first,confirmedContext.revisionId);assertEquals("not_recorded",confirmedContext.relationshipStatus)
                assertFalse(confirmedContext.currentRelationshipsIncluded)

                assertTrue(service.draft(create.id,actor).relationships.isEmpty()) }
            db.connect().use { c ->
                for(table in listOf("relationship","relationship_draft","relationship_version","world_revision_relationship"))
                    assertEquals(listOf("0"),WorldStudioPostgresFixture.rows(c,"SELECT count(*) FROM worldstudio.$table"))
                assertEquals(listOf("1"),WorldStudioPostgresFixture.rows(c,"SELECT count(*) FROM worldstudio.world_revision"))
                assertEquals(listOf("8"),WorldStudioPostgresFixture.rows(c,"SELECT count(*) FROM worldstudio.setting_card_version"))
                assertEquals(listOf("0"),WorldStudioPostgresFixture.rows(c,"SELECT count(*) FROM worldstudio.world_save_request WHERE request_key='fail-late'"))
            }
        }
    }
    @Test fun `relations are recorded per episode and every episode reads its own connections`() {
        WorldStudioPostgresFixture("independent").use { db -> db.studio().migrate();context(db).use { ctx ->
            val service=ctx.getBean(WorldStudioService::class.java);val actor=UUID.randomUUID();val created=service.create(actor,CreateWorldRequest("회차별 관계"))
            val cards=listOf("가","나","다").map { CardPayload(UUID.randomUUID(),it,"원문","character","basic") }
            val (a,b,c)=cards.map { it.id }
            val friend=RelationshipPayload(UUID.randomUUID(),a,b,"structural","친구",label="friend_of")
            val enemy=friend.copy(body="적",label="enemy_of")
            val lover=RelationshipPayload(UUID.randomUUID(),b,c,"emotional","연인")
            var revision=created.draftRevision;var n=0
            fun edit(episode:Int?,vararg rows:RelationshipPayload,cards:List<CardPayload> = emptyList()):Set<RelationshipPayload> {
                val saved=service.edit(created.worldId,actor,EditWorldDraftRequest(revision,created.name,"",cards,rows.toList(),"episode-${n++}",false,episode))
                revision=saved.draftRevision;return saved.relationships.toSet()
            }
            fun at(episode:Int?)=service.draft(created.worldId,actor,episode).relationships.toSet()
            // 연결이 아직 없으면 회차를 생략해도 1화에 쓴다.
            assertEquals(setOf(friend),edit(null,friend,cards=cards))
            // 3화: 친구가 적이 되고 새 관계가 생긴다. 응답은 저장한 회차 기준이다.
            assertEquals(setOf(enemy,lover),edit(3,enemy,lover))
            assertEquals(setOf(friend),at(1));assertEquals(setOf(friend),at(2))
            assertEquals(setOf(enemy,lover),at(3));assertEquals(setOf(enemy,lover),at(4));assertEquals(setOf(enemy,lover),at(null))
            // 5화: 새 관계가 끝난다. 4화 이전은 그대로고 최신은 끝난 뒤다.
            assertEquals(setOf(enemy),edit(5,lover.copy(lifecycle="removed")))
            assertEquals(setOf(enemy,lover),at(4));assertEquals(setOf(enemy),at(5));assertEquals(setOf(enemy),at(null))
            // 2화를 고쳐도 3화 이후 연결은 바뀌지 않는다.
            val early=friend.copy(body="막역한 친구")
            assertEquals(setOf(early),edit(2,early))
            assertEquals(setOf(early),at(2));assertEquals(setOf(friend),at(1));assertEquals(setOf(enemy,lover),at(3));assertEquals(setOf(enemy),at(null))
            // 같은 회차를 다시 저장하면 덮어쓰고, 끝점이 바뀌어도 그 회차에는 연결이 하나만 남는다(둘이면 조회가 실패한다).
            assertEquals(setOf(enemy.copy(body="철천지원수")),edit(5,enemy.copy(body="철천지원수")))
            val moved=enemy.copy(body="다른 사람과 원수",targetCardId=c)
            assertEquals(setOf(moved),edit(5,moved));assertEquals(setOf(moved),at(null));assertEquals(setOf(enemy,lover),at(4))
            // 끝난 관계를 같은 ID로 다시 쓰면 되살아난다.
            assertEquals(setOf(moved,lover),edit(6,lover));assertEquals(setOf(moved),at(5))
        } }
    }
    @Test fun `Neo4j success followed by PostgreSQL commit failure stays pending until exact replay`() {
        WorldStudioPostgresFixture("independent").use { db -> db.studio().migrate();context(db).use { ctx ->
            val service=ctx.getBean(WorldStudioService::class.java);val actor=UUID.randomUUID();val created=service.create(actor,CreateWorldRequest("retry"))
            val request=EditWorldDraftRequest(created.draftRevision,"after","",key="pending",replace=true)
            db.connect().use { c -> WorldStudioPostgresFixture.sql(c,"""CREATE FUNCTION worldstudio.qa_fail_edit() RETURNS trigger LANGUAGE plpgsql AS ${'$'}${'$'} BEGIN RAISE EXCEPTION 'synthetic finalization failure'; END; ${'$'}${'$'};
                CREATE CONSTRAINT TRIGGER qa_fail_edit AFTER UPDATE ON worldstudio.world_draft DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION worldstudio.qa_fail_edit();""") }
            assertThrows(RuntimeException::class.java) { service.edit(created.worldId,actor,request) }
            assertEquals("RELATIONSHIP_WRITE_INCOMPLETE",assertThrows(WorldStudioFailure::class.java) { service.draft(created.worldId,actor) }.code)
            assertThrows(WorldConflict::class.java) { service.edit(created.worldId,actor,request.copy(name="different")) }
            db.connect().use { c -> WorldStudioPostgresFixture.sql(c,"DROP TRIGGER qa_fail_edit ON worldstudio.world_draft") }
            val recovered=service.edit(created.worldId,actor,request);assertEquals("after",recovered.name);assertEquals(created.draftRevision+1,recovered.draftRevision)
            assertEquals(recovered,service.edit(created.worldId,actor,request))
        } }
    }
    @Test fun `simultaneous card saves serialize and duplicate requests create one revision`() {
        WorldStudioPostgresFixture("independent").use { db -> db.studio().migrate();context(db).use { ctx ->
            val service=ctx.getBean(WorldStudioService::class.java);val actor=UUID.randomUUID();val created=service.create(actor,CreateWorldRequest("同時"))
            Executors.newFixedThreadPool(2).use { pool ->
                val jobs=pool.invokeAll(List(2) { Callable { service.save(created.worldId,actor,SaveWorldRequest(created.draftRevision,"same")) } })
                assertEquals(jobs[0].get().revisionId,jobs[1].get().revisionId)
                val current=service.draft(created.worldId,actor)
                val competing=pool.invokeAll(List(2) { i -> Callable { try { service.save(created.worldId,actor,SaveWorldRequest(current.draftRevision,"key-$i"));"saved" } catch(_:WorldConflict) { "conflict" } } })
                assertEquals(listOf("conflict","saved"),competing.map { it.get() }.sorted())
            }
        } }
    }
}
