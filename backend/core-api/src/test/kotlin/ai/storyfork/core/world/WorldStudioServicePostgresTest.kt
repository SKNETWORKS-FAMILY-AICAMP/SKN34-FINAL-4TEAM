package ai.storyfork.core.world

import ai.storyfork.core.world.domain.WorldConflict
import ai.storyfork.core.world.domain.WorldNotFound
import ai.storyfork.core.world.service.WorldStudioService
import ai.storyfork.core.world.service.dto.*
import ai.storyfork.core.auth.config.AuthPersistenceConfig
import ai.storyfork.core.auth.entity.AuthMember
import ai.storyfork.core.auth.repository.MemberRepository
import ai.storyfork.core.world.studio.repository.StudioWorldRepository
import org.flywaydb.core.Flyway
import javax.sql.DataSource
import org.springframework.boot.autoconfigure.EnableAutoConfiguration
import org.springframework.boot.test.context.TestConfiguration
import org.springframework.transaction.PlatformTransactionManager
import org.springframework.aop.support.AopUtils
import jakarta.persistence.EntityManagerFactory
import java.util.UUID
import java.util.concurrent.Callable
import java.util.concurrent.Executors
import org.junit.jupiter.api.Assertions.*
import org.junit.jupiter.api.Test
import org.junit.jupiter.api.condition.EnabledIfEnvironmentVariable
import org.springframework.boot.test.util.TestPropertyValues
import org.springframework.context.annotation.AnnotationConfigApplicationContext

@EnabledIfEnvironmentVariable(named="TEST_WORLDSTUDIO_DATABASE_URL",matches=".+")
class WorldStudioServicePostgresTest {
    @TestConfiguration(proxyBeanMethods=false)
    @EnableAutoConfiguration
    class CoreJpaTestConfig

    private fun auth(db:WorldStudioPostgresFixture) {
        Flyway.configure().dataSource(db.url,System.getenv("TEST_WORLDSTUDIO_DATABASE_USER"),System.getenv("TEST_WORLDSTUDIO_DATABASE_PASSWORD"))
            .locations("classpath:db/migration/auth").load().migrate()
    }
    private fun context(db:WorldStudioPostgresFixture,enabled:Boolean=true)=AnnotationConfigApplicationContext().apply {
        TestPropertyValues.of("app.worldstudio.enabled=$enabled","spring.datasource.url=${db.url}",
            "spring.datasource.username=${System.getenv("TEST_WORLDSTUDIO_DATABASE_USER")}",
            "spring.datasource.password=${System.getenv("TEST_WORLDSTUDIO_DATABASE_PASSWORD")}",
            // CI의 다른 Auth context와 같은 임시 PostgreSQL을 사용하므로 테스트 풀만 제한한다.
            "spring.datasource.hikari.maximum-pool-size=3","spring.datasource.hikari.minimum-idle=0",
            "spring.datasource.hikari.data-source-properties.logServerErrorDetail=false",
            "spring.jpa.hibernate.ddl-auto=validate","spring.flyway.enabled=false").applyTo(this)
        register(CoreJpaTestConfig::class.java,AuthPersistenceConfig::class.java,WorldStudioConfig::class.java,WorldStudioService::class.java)
        refresh()
    }

    @Test fun `disabled feature validates Auth with no worldstudio schema and creates no WorldStudio beans`() {
        WorldStudioPostgresFixture("independent").use { db ->
            auth(db)
            context(db,false).use { ctx ->
                assertFalse(ctx.containsBean("worldStudioService"))
                assertTrue(ctx.getBeansOfType(StudioWorldRepository::class.java).isEmpty())
                assertEquals(setOf("ai.storyfork.core.auth.entity"),ctx.getBean(EntityManagerFactory::class.java).metamodel.entities.map { it.javaType.packageName }.toSet())
                assertEquals(1,ctx.getBeansOfType(DataSource::class.java).size)
                db.connect().use { c -> assertEquals(listOf("0"),WorldStudioPostgresFixture.rows(c,"SELECT count(*) FROM pg_namespace WHERE nspname='worldstudio'")) }
            }
        }
    }
    @Test fun `enabled feature fails validate if explicit migration has not completed`() {
        WorldStudioPostgresFixture("independent").use { db ->
            auth(db)
            assertThrows(RuntimeException::class.java) { context(db).close() }
            db.connect().use { c -> assertEquals(listOf("0"),WorldStudioPostgresFixture.rows(c,"SELECT count(*) FROM pg_namespace WHERE nspname='worldstudio'")) }
        }
    }
    @Test fun `Core default JPA saves restores and rolls back WorldStudio without Content`() {
        WorldStudioPostgresFixture("independent").use { db ->
            auth(db);db.studio().migrate()
            val actor=UUID.randomUUID();val card=UUID.randomUUID();val location=UUID.randomUUID();val relation=UUID.randomUUID()
            var world=UUID.randomUUID();var first=UUID.randomUUID();var lastDraftRevision=0L
            context(db).use { ctx ->
                val service=ctx.getBean(WorldStudioService::class.java)
                assertTrue(AopUtils.isAopProxy(service))
                assertEquals(1,ctx.getBeansOfType(DataSource::class.java).size)
                assertEquals(1,ctx.getBeansOfType(EntityManagerFactory::class.java).size)
                assertEquals(1,ctx.getBeansOfType(PlatformTransactionManager::class.java).size)
                assertFalse(ctx.containsBean("worldStudioDataSource"))
                val members=ctx.getBean(MemberRepository::class.java)
                val member=AuthMember(UUID.randomUUID(),"qa@example.invalid","synthetic-hash","QA")
                members.saveAndFlush(member)
                val created=service.create(actor,CreateWorldRequest("홍길동전","작품 없이 시작"));world=created.worldId
                val original=CardPayload(card,"홍길동","  원문 | 보존\n다음 줄","character","basic",aliases=listOf("길동","길동"),tags=listOf("둘","하나"),semanticMetadata=mapOf("kind" to "claim"))
                val place=CardPayload(location,"활빈당 본거지","비밀 장소","location","space")
                val more=listOf("organization","ability","object","rule","event","other").mapIndexed { index,type ->
                    CardPayload(UUID.randomUUID(),type,"각 유형의 원문",type,listOf("history","society","culture","special","conflict","basic")[index])
                }
                val feeling=RelationshipPayload(relation,card,location,"emotional","신뢰하면서도 경계한다",direction="directed",polarity="asserted")
                var edited=service.edit(world,actor,EditWorldDraftRequest(created.draftRevision,"홍길동전","작품 없이 시작",listOf(original,place)+more,listOf(feeling)))
                val incomplete=service.edit(world,actor,EditWorldDraftRequest(edited.draftRevision,edited.name,edited.description,listOf(original.copy(body=""))))
                assertThrows(IllegalArgumentException::class.java) { service.save(world,actor,SaveWorldRequest(incomplete.draftRevision,"invalid")) }
                assertEquals(incomplete,service.draft(world,actor))
                edited=service.edit(world,actor,EditWorldDraftRequest(incomplete.draftRevision,incomplete.name,incomplete.description,listOf(original)))
                val saved=service.save(world,actor,SaveWorldRequest(edited.draftRevision,"save-1"));first=saved.revisionId
                assertEquals(8,saved.cards.map { it.card.cardType }.toSet().size)
                assertEquals(7,saved.cards.map { it.card.areaCode }.toSet().size)
                assertEquals(saved,service.save(world,actor,SaveWorldRequest(edited.draftRevision,"save-1")))
                assertThrows(WorldConflict::class.java) { service.save(world,actor,SaveWorldRequest(edited.draftRevision+1,"save-1")) }
                assertThrows(WorldNotFound::class.java) { service.draft(world,UUID.randomUUID()) }
                assertThrows(WorldNotFound::class.java) { service.revision(world,UUID.randomUUID(),first) }
                val draft=service.draft(world,actor)
                val publicDraft=service.edit(world,actor,EditWorldDraftRequest(draft.draftRevision,draft.name,draft.description,listOf(original.copy(body="수정 원문",visibility="public")),emptyList()))
                val second=service.save(world,actor,SaveWorldRequest(publicDraft.draftRevision,"save-2"))
                assertEquals("public",second.cards.single { it.card.id==card }.card.visibility)
                val current=service.draft(world,actor)
                val restored=service.restore(world,actor,RestoreWorldRequest(current.draftRevision,"restore-1",first))
                val restoredCard=restored.cards.single { it.card.id==card }
                assertEquals(original,restoredCard.card)
                assertEquals(saved.cards.single { it.card.id==card }.versionId,restoredCard.restoredFromVersionId)
                assertNotEquals(saved.cards.single { it.card.id==card }.versionId,restoredCard.versionId)
                assertEquals(3L,restoredCard.versionNo)
                assertEquals(feeling,restored.relationships.single().relationship)
                assertEquals(first,restored.restoredFromRevisionId)
                assertEquals("public",service.revision(world,actor,second.revisionId).cards.single { it.card.id==card }.card.visibility)
                val before=service.draft(world,actor)
                // A late commit failure must roll back the whole JPA save, including pointer and idempotency row.
                db.connect().use { c -> WorldStudioPostgresFixture.sql(c,"""CREATE FUNCTION worldstudio.qa_fail_commit() RETURNS trigger LANGUAGE plpgsql AS ${'$'}${'$'} BEGIN IF NEW.request_key='fail-late' THEN RAISE EXCEPTION 'synthetic late failure' USING ERRCODE='23514'; END IF; RETURN NULL; END; ${'$'}${'$'};
                    CREATE CONSTRAINT TRIGGER qa_fail_commit AFTER INSERT ON worldstudio.world_save_request DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION worldstudio.qa_fail_commit();""") }
                assertThrows(RuntimeException::class.java) { service.save(world,actor,SaveWorldRequest(before.draftRevision,"fail-late")) }
                assertEquals(before,service.draft(world,actor))
                val another=service.create(actor,CreateWorldRequest("별도 세계관",""))
                val transientCard=CardPayload(UUID.randomUUID(),"작성 중","첫 카드","character","basic")
                assertThrows(IllegalArgumentException::class.java) {
                    service.edit(another.worldId,actor,EditWorldDraftRequest(another.draftRevision,another.name,"",listOf(transientCard,transientCard.copy(id=UUID.randomUUID(),cardType="invalid"))))
                }
                assertEquals(another,service.draft(another.worldId,actor))
                db.connect().use { c -> assertEquals(listOf("0"),WorldStudioPostgresFixture.rows(c,"SELECT count(*) FROM worldstudio.setting_card WHERE id='${transientCard.id}'")) }
                assertThrows(WorldNotFound::class.java) { service.restore(another.worldId,actor,RestoreWorldRequest(another.draftRevision,"cross-world",first)) }
                assertThrows(WorldNotFound::class.java) { service.edit(another.worldId,actor,EditWorldDraftRequest(another.draftRevision,another.name,"",listOf(original))) }
                assertEquals(another,service.draft(another.worldId,actor))
                assertThrows(WorldConflict::class.java) { service.edit(world,actor,EditWorldDraftRequest(before.draftRevision-1,"덮어쓰기","")) }
                assertEquals(before,service.draft(world,actor))
                assertThrows(RuntimeException::class.java) { service.restore(world,actor,RestoreWorldRequest(before.draftRevision,"fail-late",first)) }
                assertEquals(before,service.draft(world,actor))
                assertEquals(member.nickname,members.findById(member.id).orElseThrow().nickname)
                lastDraftRevision=before.draftRevision
                assertEquals(setOf("ai.storyfork.core.world.studio.entity","ai.storyfork.core.auth.entity"),ctx.getBean(EntityManagerFactory::class.java).metamodel.entities.map { it.javaType.packageName }.toSet())
            }
            context(db).use { fresh ->
                val service=fresh.getBean(WorldStudioService::class.java)
                assertEquals(first,service.revision(world,actor,first).revisionId)
                assertEquals(lastDraftRevision,service.draft(world,actor).draftRevision)
            }
            db.connect().use { c ->
                assertEquals(listOf("0"),WorldStudioPostgresFixture.rows(c,"SELECT count(*) FROM pg_tables WHERE schemaname='public' AND tablename IN ('content_schema_history','work_current')"))
                assertEquals(listOf("3"),WorldStudioPostgresFixture.rows(c,"SELECT count(*) FROM worldstudio.world_revision"))
                assertEquals(listOf("24"),WorldStudioPostgresFixture.rows(c,"SELECT count(*) FROM worldstudio.setting_card_version"))
                assertEquals(listOf("3"),WorldStudioPostgresFixture.rows(c,"SELECT count(*) FROM worldstudio.relationship_version"))
                assertEquals(listOf("0"),WorldStudioPostgresFixture.rows(c,"SELECT count(*) FROM worldstudio.world_save_request WHERE request_key='fail-late'"))
            }
        }
    }
    @Test fun `simultaneous retries serialize on the owned world and create only one revision`() {
        WorldStudioPostgresFixture("independent").use { db ->
            auth(db);db.studio().migrate()
            context(db).use { ctx ->
                val service=ctx.getBean(WorldStudioService::class.java);val actor=UUID.randomUUID()
                val created=service.create(actor,CreateWorldRequest("동시 저장",""))
                Executors.newFixedThreadPool(2).use { pool ->
                    val jobs=pool.invokeAll(List(2) { Callable { service.save(created.worldId,actor,SaveWorldRequest(created.draftRevision,"same-key")) } })
                    assertEquals(jobs[0].get().revisionId,jobs[1].get().revisionId)
                    val current=service.draft(created.worldId,actor)
                    val competing=pool.invokeAll(List(2) { index -> Callable {
                        try { service.save(created.worldId,actor,SaveWorldRequest(current.draftRevision,"competing-$index"));"saved" }
                        catch(_:WorldConflict) { "conflict" }
                    } })
                    assertEquals(listOf("conflict","saved"),competing.map { it.get() }.sorted())
                }
            }
            db.connect().use { c -> assertEquals(listOf("2"),WorldStudioPostgresFixture.rows(c,"SELECT count(*) FROM worldstudio.world_revision")) }
        }
    }
}
