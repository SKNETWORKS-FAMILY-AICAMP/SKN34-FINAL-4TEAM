package ai.storyfork.content.world

import ai.storyfork.content.world.client.InitialWorldExtractionClient
import ai.storyfork.content.world.controller.InitialWorldAnalysisController
import ai.storyfork.content.world.domain.*
import ai.storyfork.content.world.relationship.*
import ai.storyfork.content.world.service.*
import ai.storyfork.content.world.service.dto.*
import ai.storyfork.content.world.studio.entity.*
import ai.storyfork.content.world.studio.repository.*
import com.sun.net.httpserver.HttpServer
import java.net.InetSocketAddress
import java.net.URI
import java.security.MessageDigest
import java.security.Principal
import java.time.Instant
import java.time.Duration
import java.time.Clock
import java.time.ZoneId
import java.time.ZoneOffset
import java.util.UUID
import java.util.concurrent.*
import java.util.concurrent.atomic.AtomicInteger
import org.junit.jupiter.api.Assertions.*
import org.junit.jupiter.api.Test
import org.junit.jupiter.api.condition.EnabledIfEnvironmentVariable
import org.springframework.boot.test.util.TestPropertyValues
import org.springframework.context.annotation.AnnotationConfigApplicationContext
import org.springframework.transaction.PlatformTransactionManager
import org.springframework.transaction.support.TransactionTemplate
import org.springframework.web.client.RestClient
import tools.jackson.databind.json.JsonMapper
import tools.jackson.module.kotlin.KotlinModule
import ai.storyfork.content._common.helper.buildRestClient

/** CI의 폐기 가능한 PostgreSQL/Neo4j와 실제 loopback HTTP 대역만 사용한다. */
@EnabledIfEnvironmentVariable(named="TEST_WORLDSTUDIO_DATABASE_URL",matches=".+")
class InitialWorldAnalysisPostgresTest {
    private val mapper=JsonMapper.builder().addModule(KotlinModule.Builder().build()).build()
    private val actor=UUID.randomUUID()
    private fun output(input:InitialWorldInput):String {
        val source=input.sources.first { it.field=="body" && it.text.startsWith("홍😀") }
        val quote=source.text
        val hash=MessageDigest.getInstance("SHA-256").digest(quote.toByteArray()).joinToString("") { "%02x".format(it.toInt() and 255) }
        return mapper.writeValueAsString(InitialWorldOutput("initial-world.v1",listOf(InitialWorldCandidateOutput(
            "fact-1","fact","보존","원문 사실",source.ownerId,emptyList(),"ai_extraction",
            listOf(InitialWorldEvidence(source.sourceId,0,quote.length.toLong(),quote,hash)),null,"","","asserted")),emptyList()))
    }
    private inner class Stub:AutoCloseable {
        val count=AtomicInteger()
        @Volatile var action:(InitialWorldInput)->Pair<Int,String> = { 200 to output(it) }
        @Volatile var error:Throwable?=null
        val server=HttpServer.create(InetSocketAddress("127.0.0.1",0),0).apply {
            createContext("/internal/v1/initial-world/extractions") { exchange ->
                try {
                    count.incrementAndGet()
                    assertEquals("ci-token",exchange.requestHeaders.getFirst("X-Internal-Token"))
                    val input=mapper.readValue(exchange.requestBody.readAllBytes(),InitialWorldInput::class.java)
                    val (status,body)=action(input)
                    if(status!=0) {
                        val bytes=body.toByteArray()
                        exchange.responseHeaders.add("Content-Type","application/json")
                        exchange.sendResponseHeaders(status,bytes.size.toLong());exchange.responseBody.write(bytes)
                    }
                } catch(e:Throwable) { error=e }
                finally { exchange.close() }
            }
            start()
        }
        fun client()=InitialWorldExtractionClient(buildRestClient(RestClient.builder(),
            URI.create("http://127.0.0.1:${server.address.port}"),Duration.ofSeconds(1),Duration.ofSeconds(15)),"ci-token")
        override fun close() { server.stop(0);error?.let { throw AssertionError("stub failure",it) } }
    }
    private fun context(db:WorldStudioPostgresFixture,stub:Stub,clock:Clock=Clock.systemUTC())=AnnotationConfigApplicationContext().apply {
        TestPropertyValues.of("DATABASE_URL=${db.url}","DATABASE_USER=${System.getenv("TEST_WORLDSTUDIO_DATABASE_USER")}",
            "DATABASE_PASSWORD=${System.getenv("TEST_WORLDSTUDIO_DATABASE_PASSWORD")}",
            "app.worldstudio.neo4j.uri=${System.getenv("NEO4J_URI")}","app.worldstudio.neo4j.username=neo4j",
            "app.worldstudio.neo4j.password=${System.getenv("NEO4J_PASSWORD")}").applyTo(this)
        beanFactory.registerSingleton("jsonMapper",mapper)
        beanFactory.registerSingleton("initialWorldAnalysisClock",clock)
        beanFactory.registerSingleton("initialWorldExtractionClient",stub.client())
        register(ai.storyfork.content._common.config.ContentDatabaseConfig::class.java,WorldStudioConfig::class.java,
            Neo4jRelationshipConfig::class.java,Neo4jRelationshipRepository::class.java,WorldStudioService::class.java,
            InitialWorldAnalysisService::class.java)
        refresh()
    }
    private fun seed(ctx:AnnotationConfigApplicationContext):WorldDraftResponse {
        val studio=ctx.getBean(WorldStudioService::class.java)
        val world=studio.create(actor,CreateWorldRequest("5-C 회귀","초기 원문"))
        val first=CardPayload(UUID.randomUUID(),"홍길동","홍😀\r\n길동은 활빈당에 있다.","character","basic")
        val second=CardPayload(UUID.randomUUID(),"활빈당","조직 원문","organization","society")
        return studio.edit(world.worldId,actor,EditWorldDraftRequest(world.draftRevision,world.name,world.description,
            listOf(first,second),listOf(RelationshipPayload(UUID.randomUUID(),first.id,second.id,"structural","속한다",
                "소속","directed","asserted")),"seed",false))
    }
    private fun sql(db:WorldStudioPostgresFixture,sql:String)=db.connect().use { WorldStudioPostgresFixture.sql(it,sql) }

    @Test fun `concurrent duplicate runs once outside lock and survives lost reply and restart`() {
        WorldStudioPostgresFixture("independent").use { db -> Stub().use { stub ->
            lateinit var saved:WorldDraftResponse
            lateinit var completed:InitialWorldAnalysisResponse
            context(db,stub).use { ctx ->
                saved=seed(ctx)
                val service=ctx.getBean(InitialWorldAnalysisService::class.java)
                val entered=CountDownLatch(1);val release=CountDownLatch(1)
                stub.action={ input ->
                    assertEquals(saved.worldId,input.worldId)
                    assertEquals(saved.draftRevision,input.basis.draftRevision)
                    assertEquals(saved.relationshipVersion,input.basis.relationshipVersion)
                    // The HTTP callback can take the same world row lock: no PG lock spans the call.
                    db.connect().use { c -> c.autoCommit=false
                        WorldStudioPostgresFixture.sql(c,"SELECT id FROM worldstudio.world WHERE id='${saved.worldId}' FOR UPDATE NOWAIT")
                        assertEquals(listOf("running"),WorldStudioPostgresFixture.rows(c,"SELECT execution_status FROM worldstudio.initial_analysis WHERE id='${input.analysisId}'"))
                        c.rollback()
                    }
                    entered.countDown();assertTrue(release.await(10,TimeUnit.SECONDS));200 to output(input)
                }
                val request=InitialWorldAnalysisRequest("same",saved.draftRevision)
                val executor=Executors.newSingleThreadExecutor()
                try {
                    val first=executor.submit<InitialWorldAnalysisRead> { service.analyze(saved.worldId,actor,request) }
                    assertTrue(entered.await(10,TimeUnit.SECONDS))
                    val controller=InitialWorldAnalysisController(service)
                    val pending=controller.analyze(saved.worldId,Principal { actor.toString() },request)
                    assertEquals(202,pending.statusCode.value());assertNotNull(pending.headers.location)
                    assertThrows(WorldConflict::class.java) { service.analyze(saved.worldId,actor,request.copy(expectedDraftRevision=99)) }
                    release.countDown();completed=first.get(20,TimeUnit.SECONDS).body
                } finally { release.countDown();executor.shutdownNow() }
                assertEquals("completed",completed.executionStatus);assertEquals(1,stub.count.get())
                // The caller may discard the original HTTP response: same key retrieves identical UUIDs.
                assertEquals(completed,service.analyze(saved.worldId,actor,request).body)
                assertEquals(1,service.candidates(saved.worldId,actor,completed.analysisId).size)
                assertEquals(saved,ctx.getBean(WorldStudioService::class.java).draft(saved.worldId,actor))
                assertThrows(WorldNotFound::class.java) { service.get(saved.worldId,UUID.randomUUID(),completed.analysisId) }
                val other=ctx.getBean(WorldStudioService::class.java).create(actor,CreateWorldRequest("다른 세계"))
                assertThrows(WorldNotFound::class.java) { service.get(other.worldId,actor,completed.analysisId) }
            }
            context(db,stub).use { ctx ->
                val service=ctx.getBean(InitialWorldAnalysisService::class.java)
                assertEquals(completed,service.get(saved.worldId,actor,completed.analysisId).body)
                assertEquals(listOf(completed),service.list(saved.worldId,actor))
                sql(db,"UPDATE worldstudio.world_draft SET draft_revision=draft_revision+1 WHERE world_id='${saved.worldId}'")
                assertEquals("stale",service.get(saved.worldId,actor,completed.analysisId).body.freshness)
                assertEquals(completed.candidateIds,service.analyze(saved.worldId,actor,InitialWorldAnalysisRequest("same",saved.draftRevision)).body.candidateIds)
                assertEquals(1,stub.count.get())
            }
        } }
    }

    @Test fun `invalid outputs timeout transport loss and rollback never leave partial candidates`() {
        WorldStudioPostgresFixture("independent").use { db -> Stub().use { stub -> context(db,stub).use { ctx ->
            val saved=seed(ctx);val service=ctx.getBean(InitialWorldAnalysisService::class.java)
            val cases=listOf<Pair<Int,(InitialWorldInput)->String>>(
                200 to { _:InitialWorldInput -> "{" },
                200 to { i:InitialWorldInput -> output(i).replace("홍😀","다른") },
                200 to { i:InitialWorldInput -> output(i).replace(i.entities.single { it.entityType=="character" }.cardId.toString(),UUID.randomUUID().toString()) },
                504 to { _:InitialWorldInput -> "{}" },
                0 to { _:InitialWorldInput -> "" })
            cases.forEachIndexed { index,(status,body) ->
                stub.action={ status to body(it) }
                val request=InitialWorldAnalysisRequest("failure-$index",saved.draftRevision)
                val result=service.analyze(saved.worldId,actor,request)
                assertEquals(if(index<3) "failed" else "unknown",result.body.executionStatus)
                assertNotNull(result.failureCode);assertNull(result.body.output);assertTrue(result.body.candidateIds.isEmpty())
                val calls=stub.count.get();assertEquals(result,service.analyze(saved.worldId,actor,request));assertEquals(calls,stub.count.get())
            }
            sql(db,"CREATE FUNCTION worldstudio.reject_completion() RETURNS trigger LANGUAGE plpgsql AS 'BEGIN IF NEW.execution_status=''completed'' THEN RAISE EXCEPTION ''injected commit failure''; END IF; RETURN NEW; END'; CREATE TRIGGER reject_completion BEFORE UPDATE ON worldstudio.initial_analysis FOR EACH ROW EXECUTE FUNCTION worldstudio.reject_completion()")
            stub.action={ 200 to output(it) }
            val rollback=service.analyze(saved.worldId,actor,InitialWorldAnalysisRequest("rollback",saved.draftRevision))
            assertEquals("unknown",rollback.body.executionStatus);assertEquals("RESULT_COMMIT_UNCONFIRMED",rollback.failureCode)
            db.connect().use { assertEquals(listOf("0"),WorldStudioPostgresFixture.rows(it,"SELECT count(*) FROM worldstudio.initial_candidate")) }
            assertEquals(saved,ctx.getBean(WorldStudioService::class.java).draft(saved.worldId,actor))
        } } }
    }

    @Test fun `process death expires on read and changed basis remains stale without a new call`() {
        WorldStudioPostgresFixture("independent").use { db -> Stub().use { stub -> context(db,stub).use { ctx ->
            val saved=seed(ctx);val studio=ctx.getBean(WorldStudioService::class.java)
            val input=studio.prepareInitialWorldInput(saved.worldId,actor,UUID.randomUUID())
            val tx=TransactionTemplate(ctx.getBean("worldStudioTransactionManager",PlatformTransactionManager::class.java))
            @Suppress("UNCHECKED_CAST")
            val json=mapper.convertValue(input,Map::class.java) as Map<String,Any?>
            tx.executeWithoutResult { ctx.getBean(InitialWorldAnalysisRepository::class.java).saveAndFlush(InitialWorldAnalysis(
                id=input.analysisId,worldId=input.worldId,requestKey="dead",requestHash="a".repeat(64),draftRevision=input.basis.draftRevision,
                relationshipVersion=input.basis.relationshipVersion,currentRevisionId=input.basis.currentRevisionId,inputSnapshot=json,
                createdAt=Instant.now().minusSeconds(100),deadline=Instant.now().minusSeconds(10))) }
            val service=ctx.getBean(InitialWorldAnalysisService::class.java)
            val expired=service.get(saved.worldId,actor,input.analysisId)
            assertEquals("unknown",expired.body.executionStatus);assertEquals("RUN_LEASE_EXPIRED",expired.failureCode)
            assertEquals(0,stub.count.get())
            stub.action={ i ->
                sql(db,"UPDATE worldstudio.relationship_state SET graph_version=graph_version+1 WHERE world_id='${saved.worldId}'")
                200 to output(i)
            }
            val result=service.analyze(saved.worldId,actor,InitialWorldAnalysisRequest("stale",saved.draftRevision))
            assertEquals("completed",result.body.executionStatus);assertEquals("stale",result.body.freshness)
        } } }
    }
    @Test fun `late response is never completed and lost commit acknowledgment returns persisted result`() {
        WorldStudioPostgresFixture("independent").use { db -> Stub().use { stub ->
            val clock=object:Clock() {
                var time=Instant.now()
                override fun instant()=time
                override fun getZone():ZoneId=ZoneOffset.UTC
                override fun withZone(zone:ZoneId):Clock=this
            }
            context(db,stub,clock).use { ctx ->
                val saved=seed(ctx);val service=ctx.getBean(InitialWorldAnalysisService::class.java)
                stub.action={ i -> clock.time=clock.time.plusSeconds(100);200 to output(i) }
                val late=service.analyze(saved.worldId,actor,InitialWorldAnalysisRequest("late",saved.draftRevision))
                assertEquals("unknown",late.body.executionStatus);assertEquals("RUN_LEASE_EXPIRED",late.failureCode)
                assertTrue(service.candidates(saved.worldId,actor,late.body.analysisId).isEmpty())
                val delegate=ctx.getBean("worldStudioTransactionManager",PlatformTransactionManager::class.java)
                val loseAck=java.util.concurrent.atomic.AtomicBoolean(false)
                val manager=object:PlatformTransactionManager {
                    override fun getTransaction(definition:org.springframework.transaction.TransactionDefinition?)=delegate.getTransaction(definition)
                    override fun rollback(status:org.springframework.transaction.TransactionStatus)=delegate.rollback(status)
                    override fun commit(status:org.springframework.transaction.TransactionStatus) {
                        delegate.commit(status)
                        if(loseAck.getAndSet(false)) throw org.springframework.transaction.TransactionSystemException("lost commit acknowledgement")
                    }
                }
                val wrapped=InitialWorldAnalysisService(ctx.getBean(WorldStudioService::class.java),ctx.getBean(StudioWorldRepository::class.java),
                    ctx.getBean(WorldDraftRepository::class.java),ctx.getBean(WorldRelationshipStateRepository::class.java),
                    ctx.getBean(InitialWorldAnalysisRepository::class.java),ctx.getBean(InitialWorldCandidateRepository::class.java),
                    stub.client(),mapper,manager,clock)
                stub.action={ i -> loseAck.set(true);200 to output(i) }
                val request=InitialWorldAnalysisRequest("lost-ack",saved.draftRevision)
                val completed=wrapped.analyze(saved.worldId,actor,request)
                assertEquals("completed",completed.body.executionStatus)
                assertEquals(completed,wrapped.analyze(saved.worldId,actor,request))
                assertEquals(1,service.candidates(saved.worldId,actor,completed.body.analysisId).size)
                assertEquals(2,stub.count.get())
            }
        } }
    }

}
