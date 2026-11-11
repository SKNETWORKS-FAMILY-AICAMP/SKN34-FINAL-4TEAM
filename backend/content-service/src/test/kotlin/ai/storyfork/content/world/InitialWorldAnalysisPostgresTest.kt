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
            InitialWorldAnalysisService::class.java,InitialWorldApplicationService::class.java)
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
                    stub.client(),mapper,ctx.getBean(InitialWorldDecisionRepository::class.java),ctx.getBean(InitialWorldApplicationItemRepository::class.java),manager,clock)
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

    @Test fun `review history is append only idempotent owner bound and persistent`() {
        WorldStudioPostgresFixture("independent").use { db -> Stub().use { stub ->
            lateinit var world:WorldDraftResponse
            lateinit var analysis:InitialWorldAnalysisResponse
            lateinit var approved:InitialWorldDecisionRecord
            context(db,stub).use { ctx ->
                world=seed(ctx);val service=ctx.getBean(InitialWorldAnalysisService::class.java)
                analysis=service.analyze(world.worldId,actor,InitialWorldAnalysisRequest("review-run",world.draftRevision)).body
                val id=analysis.candidateIds.values.single();val original=analysis.output!!.candidates.single()
                fun decide(key:String,sequence:Long,action:String,edit:InitialWorldCandidateOutput?=null)=
                    service.decide(world.worldId,actor,analysis.analysisId,id,InitialWorldDecisionRequest(key,sequence,action,edit,"작가 의견"))
                approved=decide("approve",0,"approve");assertEquals("approved",approved.state)
                val edited=original.copy(text="작가 수정 원문",provenance="author_revision",evidence=emptyList())
                assertEquals("pending",decide("edit",1,"edit",edited).state)
                assertEquals(edited,decide("approve-edit",2,"approve").content)
                assertEquals("held",decide("hold",3,"hold").state)
                assertEquals("rejected",decide("reject",4,"reject").state)
                assertEquals(approved,decide("approve",0,"approve")) // Replay before checking latest sequence.
                assertThrows(WorldConflict::class.java) { decide("approve",0,"hold") }
                assertThrows(WorldConflict::class.java) { decide("old-approve",1,"approve") }
                assertThrows(WorldNotFound::class.java) { service.decide(world.worldId,UUID.randomUUID(),analysis.analysisId,id,InitialWorldDecisionRequest("no",5,"approve",null,"")) }
                val other=service.analyze(world.worldId,actor,InitialWorldAnalysisRequest("other-run",world.draftRevision)).body
                assertThrows(WorldNotFound::class.java) { service.decide(world.worldId,actor,other.analysisId,id,InitialWorldDecisionRequest("no",5,"approve",null,"")) }
                assertThrows(WorldNotFound::class.java) { service.decide(world.worldId,actor,analysis.analysisId,UUID.randomUUID(),InitialWorldDecisionRequest("no",5,"approve",null,"")) }
                val read=service.get(world.worldId,actor,analysis.analysisId).body
                assertEquals(listOf(1L,2L,3L,4L,5L),read.decisions.map { it.sequence })
                assertEquals(listOf("approved","pending","approved","held","rejected"),read.decisions.map { it.state })
                assertEquals(original,read.output!!.candidates.single())
                assertEquals(edited,read.decisions.last().content)
                assertEquals(world,ctx.getBean(WorldStudioService::class.java).draft(world.worldId,actor))
                db.connect().use { c -> assertEquals(listOf("작가 의견"),WorldStudioPostgresFixture.rows(c,"SELECT DISTINCT comment FROM worldstudio.initial_decision")) }
            }
            context(db,stub).use { ctx ->
                val service=ctx.getBean(InitialWorldAnalysisService::class.java);val id=analysis.candidateIds.values.single()
                assertEquals(5,service.get(world.worldId,actor,analysis.analysisId).body.decisions.size)
                sql(db,"UPDATE worldstudio.world_draft SET draft_revision=draft_revision+1 WHERE world_id='${world.worldId}'")
                assertEquals(approved,service.decide(world.worldId,actor,analysis.analysisId,id,InitialWorldDecisionRequest("approve",0,"approve",null,"작가 의견")))
                assertEquals("ANALYSIS_STALE",assertThrows(InitialWorldReviewConflict::class.java) {
                    service.decide(world.worldId,actor,analysis.analysisId,id,InitialWorldDecisionRequest("stale",5,"approve",null,""))
                }.code)
            }
        } }
    }

    @Test fun `concurrent reviews serialize and failed inserts leave no partial history`() {
        WorldStudioPostgresFixture("independent").use { db -> Stub().use { stub -> context(db,stub).use { ctx ->
            val world=seed(ctx);val service=ctx.getBean(InitialWorldAnalysisService::class.java)
            val analysis=service.analyze(world.worldId,actor,InitialWorldAnalysisRequest("reviews",world.draftRevision)).body
            val id=analysis.candidateIds.values.single()
            val pool=Executors.newFixedThreadPool(2);val start=CountDownLatch(1)
            fun call(key:String)=service.decide(world.worldId,actor,analysis.analysisId,id,InitialWorldDecisionRequest(key,0,"approve",null,""))
            try {
                val futures=(1..2).map { n -> pool.submit<Any> { start.await();try { call("parallel-$n") } catch(e:WorldConflict) { e } } }
                start.countDown();val results=futures.map { it.get(10,TimeUnit.SECONDS) }
                assertEquals(1,results.count { it is InitialWorldDecisionRecord });assertEquals(1,results.count { it is WorldConflict })
            } finally { pool.shutdownNow() }
            assertEquals(1,service.get(world.worldId,actor,analysis.analysisId).body.decisions.size)
            sql(db,"CREATE FUNCTION worldstudio.reject_review() RETURNS trigger LANGUAGE plpgsql AS 'BEGIN RAISE EXCEPTION ''injected review failure''; END'; CREATE TRIGGER reject_review BEFORE INSERT ON worldstudio.initial_decision FOR EACH ROW EXECUTE FUNCTION worldstudio.reject_review()")
            val retry=InitialWorldDecisionRequest("retry",1,"hold",null,"")
            assertThrows(org.springframework.dao.DataAccessException::class.java) { service.decide(world.worldId,actor,analysis.analysisId,id,retry) }
            assertEquals(1,service.get(world.worldId,actor,analysis.analysisId).body.decisions.size)
            sql(db,"DROP TRIGGER reject_review ON worldstudio.initial_decision")
            val saved=service.decide(world.worldId,actor,analysis.analysisId,id,retry)
            assertEquals(saved,service.decide(world.worldId,actor,analysis.analysisId,id,retry))
            assertEquals(2,service.get(world.worldId,actor,analysis.analysisId).body.decisions.size)
            val same=InitialWorldDecisionRequest("same-concurrent",2,"approve",null,"")
            val duplicates=Executors.newFixedThreadPool(2)
            try {
                val calls=(1..2).map { duplicates.submit<InitialWorldDecisionRecord> { service.decide(world.worldId,actor,analysis.analysisId,id,same) } }
                assertEquals(calls[0].get(10,TimeUnit.SECONDS),calls[1].get(10,TimeUnit.SECONDS))
            } finally { duplicates.shutdownNow() }
            val delegate=ctx.getBean("worldStudioTransactionManager",PlatformTransactionManager::class.java)
            val loseAck=java.util.concurrent.atomic.AtomicBoolean(true)
            val manager=object:PlatformTransactionManager {
                override fun getTransaction(definition:org.springframework.transaction.TransactionDefinition?)=delegate.getTransaction(definition)
                override fun rollback(status:org.springframework.transaction.TransactionStatus)=delegate.rollback(status)
                override fun commit(status:org.springframework.transaction.TransactionStatus) {
                    delegate.commit(status)
                    if(loseAck.getAndSet(false)) throw org.springframework.transaction.TransactionSystemException("lost review commit reply")
                }
            }
            val wrapped=InitialWorldAnalysisService(ctx.getBean(WorldStudioService::class.java),ctx.getBean(StudioWorldRepository::class.java),
                ctx.getBean(WorldDraftRepository::class.java),ctx.getBean(WorldRelationshipStateRepository::class.java),
                ctx.getBean(InitialWorldAnalysisRepository::class.java),ctx.getBean(InitialWorldCandidateRepository::class.java),
                stub.client(),mapper,ctx.getBean(InitialWorldDecisionRepository::class.java),ctx.getBean(InitialWorldApplicationItemRepository::class.java),manager,Clock.systemUTC())
            val lost=InitialWorldDecisionRequest("lost-review-reply",3,"hold",null,"")
            assertThrows(org.springframework.transaction.TransactionException::class.java) { wrapped.decide(world.worldId,actor,analysis.analysisId,id,lost) }
            assertEquals(4L,service.decide(world.worldId,actor,analysis.analysisId,id,lost).sequence)
            assertEquals(4,service.get(world.worldId,actor,analysis.analysisId).body.decisions.size)
            val pendingId=UUID.randomUUID();val pendingCandidate=UUID.randomUUID()
            sql(db,"INSERT INTO worldstudio.initial_analysis(id,world_id,request_key,request_hash,draft_revision,relationship_version,input_snapshot,execution_token,deadline) SELECT '$pendingId',world_id,'pending-review',request_hash,draft_revision,relationship_version,input_snapshot,'${UUID.randomUUID()}',now()+interval '90 seconds' FROM worldstudio.initial_analysis WHERE id='${analysis.analysisId}'")
            sql(db,"INSERT INTO worldstudio.initial_candidate(id,world_id,analysis_id,local_ref,content) SELECT '$pendingCandidate',world_id,'$pendingId',local_ref,content FROM worldstudio.initial_candidate WHERE id='$id'")
            assertEquals("ANALYSIS_NOT_COMPLETED",assertThrows(InitialWorldReviewConflict::class.java) {
                service.decide(world.worldId,actor,pendingId,pendingCandidate,InitialWorldDecisionRequest("pending",0,"approve",null,""))
            }.code)
            assertEquals(world,ctx.getBean(WorldStudioService::class.java).draft(world.worldId,actor))
        } } }
    }
    private fun applicationFixture(ctx:AnnotationConfigApplicationContext,stub:Stub):Pair<WorldDraftResponse,InitialWorldAnalysisResponse> {
        val studio=ctx.getBean(WorldStudioService::class.java);val seed=seed(ctx)
        val location=CardPayload(UUID.randomUUID(),"율도국","기존 장소 원문","location","space",aliases=listOf("나라"),tags=listOf("보존"))
        val draft=studio.edit(seed.worldId,actor,EditWorldDraftRequest(seed.draftRevision,seed.name,seed.description,
            seed.cards.map { it.copy(aliases=listOf("기존 별칭"),tags=listOf("기존 태그")) }+location,key="application-seed"))
        studio.save(draft.worldId,actor,SaveWorldRequest(draft.draftRevision,"confirmed-before-application"))
        val saved=studio.draft(draft.worldId,actor)
        stub.action={ input ->
            val fact=mapper.readValue(output(input),InitialWorldOutput::class.java).candidates.single()
            val character=input.entities.single { it.entityType=="character" }.cardId
            val place=input.entities.single { it.entityType=="location" }.cardId
            val organization=input.entities.single { it.entityType=="organization" }.cardId
            val semantic=listOf("fact","rule","event","conjecture","goal","plan").map { fact.copy(localRef=it,type=it,subjectId=character,relatedEntityIds=listOf(place)) }
            val structural=fact.copy(localRef="structural",type="relation",relation=InitialWorldRelation(character,place,"structural","방문","directed","asserted"))
            val emotional=fact.copy(localRef="emotional",type="relation",relation=InitialWorldRelation(character,organization,"emotional","경계","directed","asserted"))
            200 to mapper.writeValueAsString(InitialWorldOutput("initial-world.v1",semantic+structural+emotional,emptyList()))
        }
        val service=ctx.getBean(InitialWorldAnalysisService::class.java)
        val analysis=service.analyze(saved.worldId,actor,InitialWorldAnalysisRequest("application-analysis",saved.draftRevision)).body
        analysis.candidateIds.forEach { (ref,id) -> service.decide(saved.worldId,actor,analysis.analysisId,id,InitialWorldDecisionRequest("approve-$ref",0,"approve",null,"")) }
        return saved to service.get(saved.worldId,actor,analysis.analysisId).body
    }
    private fun applicationRequest(world:WorldDraftResponse,analysis:InitialWorldAnalysisResponse,key:String="apply")=
        InitialWorldApplicationRequest(key,world.draftRevision,analysis.decisions.groupBy { it.candidateId }.values.map { rows ->
            val latest=rows.maxBy { it.sequence };InitialWorldSelection(latest.candidateId,latest.sequence)
        })

    @Test fun `approved additions preserve entities original relations and confirmed version with durable receipt`() {
        WorldStudioPostgresFixture("independent").use { db -> Stub().use { stub -> context(db,stub).use { ctx ->
            val (world,analysis)=applicationFixture(ctx,stub)
            val reviews=ctx.getBean(InitialWorldAnalysisService::class.java);val app=ctx.getBean(InitialWorldApplicationService::class.java)
            val studio=ctx.getBean(WorldStudioService::class.java)
            val confirmed=studio.revision(world.worldId,actor,world.currentRevisionId!!)
            val originalContext=studio.confirmedContext(world.worldId,actor,confirmed.revisionId)
            val candidate=analysis.candidateIds.getValue("fact")
            val edit=analysis.output!!.candidates.first { it.localRef=="fact" }.copy(text="작가가 수정한 사실",provenance="author_revision",evidence=emptyList())
            reviews.decide(world.worldId,actor,analysis.analysisId,candidate,InitialWorldDecisionRequest("edit-fact",1,"edit",edit,""))
            assertThrows(WorldConflict::class.java) { app.apply(world.worldId,actor,analysis.analysisId,applicationRequest(world,analysis)) }
            val pending=reviews.get(world.worldId,actor,analysis.analysisId).body
            assertEquals(originalContext,studio.confirmedContext(world.worldId,actor,confirmed.revisionId))
            assertThrows(WorldConflict::class.java) { app.apply(world.worldId,actor,analysis.analysisId,applicationRequest(world,pending)) }
            reviews.decide(world.worldId,actor,analysis.analysisId,candidate,InitialWorldDecisionRequest("approve-fact-edit",2,"approve",null,""))
            val request=applicationRequest(world,reviews.get(world.worldId,actor,analysis.analysisId).body)
            assertThrows(WorldNotFound::class.java) { app.apply(world.worldId,UUID.randomUUID(),analysis.analysisId,request) }
            val result=app.apply(world.worldId,actor,analysis.analysisId,request)
            assertEquals("applied",result.status);assertEquals(world.draftRevision+1,result.resultDraftRevision)
            assertEquals(6,result.createdCardIds.size);assertEquals(2,result.createdRelationshipIds.size)
            val after=studio.draft(world.worldId,actor)
            assertEquals(world.cards,after.cards.filter { it.id in world.cards.map { c -> c.id } })
            assertEquals(world.relationships,after.relationships.filter { it.id in world.relationships.map { r -> r.id } })
            assertEquals(3,after.relationships.size)
            val emotion=after.relationships.single { it.id in result.createdRelationshipIds && it.category=="emotional" }
            assertEquals("directed",emotion.direction);assertEquals("경계",emotion.label)
            assertEquals(world.currentRevisionId,after.currentRevisionId)
            assertEquals(confirmed,studio.revision(world.worldId,actor,world.currentRevisionId))
            val fact=after.cards.single { (it.semanticMetadata["preprocessing"] as? Map<*,*>)?.get("semanticType")=="fact" }
            assertEquals("작가가 수정한 사실",fact.body)
            assertEquals(emptyList<Any>(),(fact.semanticMetadata["preprocessing"] as Map<*,*>)["evidence"])
            assertEquals(analysis.output,reviews.get(world.worldId,actor,analysis.analysisId).body.output)
            assertEquals(result,app.apply(world.worldId,actor,analysis.analysisId,request))
            assertEquals(result,app.get(world.worldId,actor,analysis.analysisId,result.applicationId))
            assertThrows(WorldConflict::class.java) { app.apply(world.worldId,actor,analysis.analysisId,request.copy(candidates=request.candidates.drop(1))) }
            assertThrows(InitialWorldReviewConflict::class.java) { app.apply(world.worldId,actor,analysis.analysisId,request.copy(key="duplicate-candidates")) }
            studio.edit(world.worldId,actor,EditWorldDraftRequest(after.draftRevision,"나중 편집",after.description,key="later-general-edit"))
            assertEquals(result,app.apply(world.worldId,actor,analysis.analysisId,request)) // Lost success reply remains success after later edits.
            assertEquals(originalContext,studio.confirmedContext(world.worldId,actor,confirmed.revisionId))
            val latest=studio.draft(world.worldId,actor)
            val second=studio.save(world.worldId,actor,SaveWorldRequest(latest.draftRevision,"confirm-applied-context"))
            val appliedContext=studio.confirmedContext(world.worldId,actor,second.revisionId)
            assertEquals(after.cards,appliedContext.cards.map {it.card})
            assertEquals(6,appliedContext.cards.count {it.card.id in result.createdCardIds})
            assertEquals(originalContext,studio.confirmedContext(world.worldId,actor,confirmed.revisionId))
            assertFalse(appliedContext.currentRelationshipsIncluded);assertFalse(appliedContext.completeWorldContext)
            assertEquals("not_recorded",appliedContext.relationshipStatus)
            assertThrows(WorldNotFound::class.java) {studio.confirmedContext(world.worldId,UUID.randomUUID(),second.revisionId)}

        } } }
    }

    @Test fun `Neo4j success and failed PG finalization retain IDs block writers and recover after restart`() {
        WorldStudioPostgresFixture("independent").use { db -> Stub().use { stub ->
            lateinit var world:WorldDraftResponse;lateinit var analysis:InitialWorldAnalysisResponse
            lateinit var request:InitialWorldApplicationRequest;lateinit var prepared:InitialWorldApplicationResponse
            lateinit var payload:String
            context(db,stub).use { ctx ->
                val pair=applicationFixture(ctx,stub);world=pair.first;analysis=pair.second
                request=applicationRequest(world,analysis)
                val app=ctx.getBean(InitialWorldApplicationService::class.java);val studio=ctx.getBean(WorldStudioService::class.java)
                prepared=app.prepare(world.worldId,actor,analysis.analysisId,request)
                assertEquals("applying",prepared.status)
                assertThrows(WorldStudioFailure::class.java) { studio.edit(world.worldId,actor,EditWorldDraftRequest(world.draftRevision,world.name,world.description,key="intruder")) }
                assertThrows(WorldStudioFailure::class.java) { studio.save(world.worldId,actor,SaveWorldRequest(world.draftRevision,"no-confirmation")) }
                assertThrows(WorldConflict::class.java) { ctx.getBean(InitialWorldAnalysisService::class.java).decide(world.worldId,actor,analysis.analysisId,request.candidates.first().candidateId,InitialWorldDecisionRequest("hold-reserved",1,"hold",null,"")) }
                assertThrows(WorldConflict::class.java) { app.prepare(world.worldId,actor,analysis.analysisId,request.copy(key="racing")) }
                sql(db,"CREATE FUNCTION worldstudio.reject_application_completion() RETURNS trigger LANGUAGE plpgsql AS 'BEGIN IF NEW.status=''applied'' THEN RAISE EXCEPTION ''injected PG finalize failure''; END IF; RETURN NEW; END'; CREATE TRIGGER reject_application_completion BEFORE UPDATE ON worldstudio.initial_application FOR EACH ROW EXECUTE FUNCTION worldstudio.reject_application_completion()")
                val result=app.apply(world.worldId,actor,analysis.analysisId,request)
                assertEquals("unknown",result.status);assertEquals(prepared.createdCardIds,result.createdCardIds)
                val graph=ctx.getBean(Neo4jRelationshipRepository::class.java).read(world.worldId)
                assertEquals(world.relationshipVersion+1,graph.version);assertEquals(3,graph.relationships.size)
                db.connect().use { c ->
                    assertEquals(listOf(world.draftRevision.toString()),WorldStudioPostgresFixture.rows(c,"SELECT draft_revision FROM worldstudio.world_draft WHERE world_id='${world.worldId}'"))
                    assertEquals(listOf("false"),WorldStudioPostgresFixture.rows(c,"SELECT completed::text FROM worldstudio.relationship_state WHERE world_id='${world.worldId}'"))
                    assertEquals(listOf(world.cards.size.toString()),WorldStudioPostgresFixture.rows(c,"SELECT count(*) FROM worldstudio.setting_card_draft WHERE world_id='${world.worldId}'"))
                    payload=WorldStudioPostgresFixture.rows(c,"SELECT addition_payload::text FROM worldstudio.initial_application WHERE id='${prepared.applicationId}'").single()
                }
                assertThrows(WorldStudioFailure::class.java) { studio.edit(world.worldId,actor,mapper.readValue(payload,EditWorldDraftRequest::class.java)) }
            }
            context(db,stub).use { ctx ->
                val app=ctx.getBean(InitialWorldApplicationService::class.java)
                assertEquals("unknown",app.get(world.worldId,actor,analysis.analysisId,prepared.applicationId).status)
                sql(db,"DROP TRIGGER reject_application_completion ON worldstudio.initial_application")
                val result=app.apply(world.worldId,actor,analysis.analysisId,request)
                assertEquals("applied",result.status);assertEquals(prepared.createdCardIds,result.createdCardIds);assertEquals(prepared.createdRelationshipIds,result.createdRelationshipIds)
                assertEquals(world.relationshipVersion+1,ctx.getBean(Neo4jRelationshipRepository::class.java).read(world.worldId).version)
                val after=ctx.getBean(WorldStudioService::class.java).draft(world.worldId,actor)
                assertEquals(world.draftRevision+1,after.draftRevision);assertEquals(world.currentRevisionId,after.currentRevisionId)
                db.connect().use { c -> assertEquals(listOf(payload),WorldStudioPostgresFixture.rows(c,"SELECT addition_payload::text FROM worldstudio.initial_application WHERE id='${prepared.applicationId}'")) }
                assertEquals(result,app.apply(world.worldId,actor,analysis.analysisId,request))
            }
        } }
    }
    private fun applicationWith(ctx:AnnotationConfigApplicationContext,graph:Neo4jRelationshipRepository,manager:PlatformTransactionManager):InitialWorldApplicationService {
        val studio=WorldStudioService(ctx.getBean(StudioWorldRepository::class.java),ctx.getBean(WorldDraftRepository::class.java),
            ctx.getBean(SettingCardRepository::class.java),ctx.getBean(SettingCardDraftRepository::class.java),ctx.getBean(SettingCardVersionRepository::class.java),
            ctx.getBean(WorldRevisionRepository::class.java),ctx.getBean(WorldRevisionCardRepository::class.java),ctx.getBean(WorldSaveRequestRepository::class.java),
            ctx.getBean(WorldRelationshipStateRepository::class.java),ctx.getBean(InitialWorldApplicationRepository::class.java),graph,manager,mapper)
        return InitialWorldApplicationService(studio,ctx.getBean(InitialWorldAnalysisService::class.java),ctx.getBean(StudioWorldRepository::class.java),
            ctx.getBean(InitialWorldAnalysisRepository::class.java),ctx.getBean(InitialWorldCandidateRepository::class.java),
            ctx.getBean(InitialWorldApplicationRepository::class.java),ctx.getBean(InitialWorldApplicationItemRepository::class.java),mapper,
            ctx.getBean("worldStudioTransactionManager",PlatformTransactionManager::class.java))
    }
    @Test fun `failures around real Neo4j commit and PG acknowledgement resume the same application concurrently`() {
        WorldStudioPostgresFixture("independent").use { db -> Stub().use { stub -> context(db,stub).use { ctx ->
            for(phase in listOf("before","after","commit")) {
                val (world,analysis)=applicationFixture(ctx,stub);val request=applicationRequest(world,analysis)
                val realGraph=ctx.getBean(Neo4jRelationshipRepository::class.java)
                val graph=org.mockito.Mockito.spy(realGraph)
                val fault=java.util.concurrent.atomic.AtomicBoolean(true)
                val loseAck=java.util.concurrent.atomic.AtomicBoolean(false)
                org.mockito.Mockito.doAnswer { invocation ->
                    val inject=fault.getAndSet(false)
                    if(inject) db.connect().use { c -> c.autoCommit=false
                        WorldStudioPostgresFixture.sql(c,"SELECT id FROM worldstudio.world WHERE id='${world.worldId}' FOR UPDATE NOWAIT");c.rollback()
                    }
                    if(inject && phase=="before") throw WorldStudioFailure.unavailable()
                    val result=invocation.callRealMethod()
                    if(inject && phase=="after") throw WorldStudioFailure.unavailable()
                    if(inject && phase=="commit") loseAck.set(true)
                    result
                }.`when`(graph).replace(org.mockito.ArgumentMatchers.eq(world.worldId) ?: world.worldId,org.mockito.ArgumentMatchers.anyLong(),
                    org.mockito.ArgumentMatchers.anyString(),org.mockito.ArgumentMatchers.anyString(),org.mockito.ArgumentMatchers.anyList())
                val delegate=ctx.getBean("worldStudioTransactionManager",PlatformTransactionManager::class.java)
                val manager=object:PlatformTransactionManager {
                    override fun getTransaction(definition:org.springframework.transaction.TransactionDefinition?)=delegate.getTransaction(definition)
                    override fun rollback(status:org.springframework.transaction.TransactionStatus)=delegate.rollback(status)
                    override fun commit(status:org.springframework.transaction.TransactionStatus) {
                        delegate.commit(status)
                        if(loseAck.getAndSet(false)) throw org.springframework.transaction.TransactionSystemException("lost application commit acknowledgement")
                    }
                }
                val app=applicationWith(ctx,graph,manager)
                val first=app.apply(world.worldId,actor,analysis.analysisId,request)
                assertEquals(if(phase=="commit") "applied" else "unknown",first.status)
                assertEquals(world.relationshipVersion+if(phase=="before") 0 else 1,realGraph.read(world.worldId).version)
                val pool=Executors.newFixedThreadPool(2)
                try {
                    val calls=(1..2).map { pool.submit<InitialWorldApplicationResponse> { app.apply(world.worldId,actor,analysis.analysisId,request) } }
                    val results=calls.map { it.get(20,TimeUnit.SECONDS) }
                    // One caller can observe uncertainty before its peer commits. Both must converge without new IDs.
                    assertTrue(results.any { it.status=="applied" })
                    results.forEach { result ->
                        assertTrue(result.status in listOf("applied","unknown"))
                        assertEquals(first.applicationId,result.applicationId)
                        assertEquals(first.createdCardIds,result.createdCardIds)
                        assertEquals(first.createdRelationshipIds,result.createdRelationshipIds)
                    }
                    val receipt=app.get(world.worldId,actor,analysis.analysisId,first.applicationId)
                    assertEquals("applied",receipt.status)
                    assertEquals(receipt,app.apply(world.worldId,actor,analysis.analysisId,request))
                } finally { pool.shutdownNow() }
                assertEquals(world.relationshipVersion+1,realGraph.read(world.worldId).version)
                assertEquals(world.draftRevision+1,ctx.getBean(WorldStudioService::class.java).draft(world.worldId,actor).draftRevision)
                db.connect().use { c -> assertEquals(listOf("1"),WorldStudioPostgresFixture.rows(c,"SELECT count(*) FROM worldstudio.initial_application WHERE world_id='${world.worldId}'")) }
            }
        } } }
    }
    @Test fun `held rejected and old decisions cannot apply and remaining candidates become stale after partial success`() {
        WorldStudioPostgresFixture("independent").use { db -> Stub().use { stub -> context(db,stub).use { ctx ->
            val (world,analysis)=applicationFixture(ctx,stub)
            val reviews=ctx.getBean(InitialWorldAnalysisService::class.java);val app=ctx.getBean(InitialWorldApplicationService::class.java)
            for((ref,action) in listOf("goal" to "hold","plan" to "reject")) {
                val candidate=analysis.candidateIds.getValue(ref)
                reviews.decide(world.worldId,actor,analysis.analysisId,candidate,InitialWorldDecisionRequest(action,1,action,null,""))
                for(sequence in listOf(1L,2L)) assertThrows(WorldConflict::class.java) {
                    app.apply(world.worldId,actor,analysis.analysisId,InitialWorldApplicationRequest("no-$ref-$sequence",world.draftRevision,listOf(InitialWorldSelection(candidate,sequence))))
                }
            }
            val foreignAnalysis=reviews.analyze(world.worldId,actor,InitialWorldAnalysisRequest("different-analysis",world.draftRevision)).body
            assertThrows(WorldNotFound::class.java) {
                app.apply(world.worldId,actor,analysis.analysisId,InitialWorldApplicationRequest("foreign-candidate",world.draftRevision,listOf(InitialWorldSelection(foreignAnalysis.candidateIds.values.first(),1))))
            }
            val first=InitialWorldApplicationRequest("partial",world.draftRevision,listOf(InitialWorldSelection(analysis.candidateIds.getValue("fact"),1)))
            assertEquals("applied",app.apply(world.worldId,actor,analysis.analysisId,first).status)
            assertEquals("ANALYSIS_STALE",assertThrows(InitialWorldReviewConflict::class.java) {
                app.apply(world.worldId,actor,analysis.analysisId,first.copy(key="remaining",candidates=listOf(InitialWorldSelection(analysis.candidateIds.getValue("rule"),1))))
            }.code)
            assertEquals(world.cards.size+1,ctx.getBean(WorldStudioService::class.java).draft(world.worldId,actor).cards.size)
        } } }
    }
}
