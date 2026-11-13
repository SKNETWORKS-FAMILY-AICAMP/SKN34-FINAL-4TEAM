package ai.storyfork.content.world

import ai.storyfork.content.world.domain.*
import ai.storyfork.content.world.relationship.Neo4jRelationshipConfig
import ai.storyfork.content.world.relationship.Neo4jRelationshipRepository
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
            assertThrows(IllegalArgumentException::class.java) { service.draft(created.worldId,actor,0) }
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
