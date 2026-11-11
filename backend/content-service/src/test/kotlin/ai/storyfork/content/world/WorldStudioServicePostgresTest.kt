package ai.storyfork.content.world

import ai.storyfork.content.world.domain.*
import ai.storyfork.content.world.relationship.Neo4jRelationshipConfig
import ai.storyfork.content.world.relationship.Neo4jRelationshipRepository
import ai.storyfork.content.world.service.GenreTemplate
import ai.storyfork.content.world.service.GenreTemplateRepair
import ai.storyfork.content.world.service.GenreTemplateSeeder
import ai.storyfork.content.world.service.WorldStudioService
import ai.storyfork.content.world.service.dto.*
import jakarta.persistence.EntityManagerFactory
import java.util.UUID
import java.util.concurrent.Callable
import java.util.concurrent.Executors
import javax.sql.DataSource
import org.junit.jupiter.api.Assertions.*
import org.junit.jupiter.api.Test
import org.junit.jupiter.api.condition.EnabledIfEnvironmentVariable
import org.springframework.boot.test.util.TestPropertyValues
import org.springframework.context.annotation.AnnotationConfigApplicationContext
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
                org.mockito.Mockito.doReturn(listOf(template!!)).`when`(seeder).load()
                return seeder
            }
            context(db).use { ctx ->
                val service = ctx.getBean(WorldStudioService::class.java)
                val seeder = seeded(service)
                seeder.seed()
                val draft = service.draft(worldId, owner)
                assertEquals(2L, draft.draftRevision)
                assertEquals(GenreTemplateRepair.payloads(template!!).toSet(), draft.cards.toSet())
                revisionId = draft.currentRevisionId!!
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
                service.edit(worldId, owner, EditWorldDraftRequest(2, draft.name, draft.description, listOf(card), key = "author-edit"))
                val changed = service.draft(worldId, owner)
                seeder.seed()
                assertEquals(changed, service.draft(worldId, owner))
            }
        }
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
                assertEquals("RELATIONSHIP_HISTORY_UNSUPPORTED",assertThrows(WorldStudioFailure::class.java) { service.restore(create.id,actor,RestoreWorldRequest(removed.draftRevision,"restore",first)) }.code)
                // Card revision commit failures still roll back pointer, manifest and request atomically within PostgreSQL.
                db.connect().use { c -> WorldStudioPostgresFixture.sql(c,"""CREATE FUNCTION worldstudio.qa_fail_commit() RETURNS trigger LANGUAGE plpgsql AS ${'$'}${'$'} BEGIN IF NEW.request_key='fail-late' THEN RAISE EXCEPTION 'synthetic late failure' USING ERRCODE='23514'; END IF; RETURN NULL; END; ${'$'}${'$'};
                    CREATE CONSTRAINT TRIGGER qa_fail_commit AFTER INSERT ON worldstudio.world_save_request DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION worldstudio.qa_fail_commit();""") }
                assertThrows(RuntimeException::class.java) { service.save(create.id,actor,SaveWorldRequest(removed.draftRevision,"fail-late")) };assertEquals(removed,service.draft(create.id,actor))
                val another=service.create(actor,CreateWorldRequest("別世界"))
                assertThrows(WorldNotFound::class.java) { service.edit(another.worldId,actor,EditWorldDraftRequest(0,another.name,"",listOf(original),key="foreign")) }
                val collision=EditWorldDraftRequest(0,another.name,"",relationships=listOf(relationship.copy(sourceCardId=null,targetCardId=null)),key="foreign-relation",replace=true)
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
