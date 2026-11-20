package ai.storyfork.content.world

import ai.storyfork.content.ContentServiceApplication
import ai.storyfork.content.auth.client.CoreAuthClient
import ai.storyfork.content.auth.client.VerifiedMemberResponse
import ai.storyfork.content.fixture.CsrfFixture
import ai.storyfork.content.world.client.InitialWorldExtractionClient
import ai.storyfork.content.world.service.*
import ai.storyfork.content.world.service.dto.*
import ai.storyfork.content.world.studio.entity.ManuscriptBuildJob
import ai.storyfork.content.world.studio.entity.ManuscriptBuildLoadStep
import ai.storyfork.content.world.studio.repository.ManuscriptBuildJobRepository
import ai.storyfork.content.world.studio.repository.ManuscriptBuildLoadStepRepository
import java.net.URI
import java.net.http.*
import java.nio.file.Files
import java.nio.file.Path
import java.security.MessageDigest
import java.util.UUID
import org.junit.jupiter.api.Assertions.*
import org.junit.jupiter.api.Test
import org.junit.jupiter.api.condition.EnabledIfEnvironmentVariable
import org.mockito.Mockito.*
import org.springframework.boot.builder.SpringApplicationBuilder
import org.springframework.boot.test.context.TestConfiguration
import org.springframework.context.annotation.Bean
import org.springframework.context.annotation.Primary
import tools.jackson.databind.json.JsonMapper

/** 사용자 요청에 따른 격리 QA: 실제 Content HTTP/DB, 인증과 AI만 대역. */
@EnabledIfEnvironmentVariable(named="TEST_WORLDSTUDIO_DATABASE_URL", matches=".+")
class InitialBuildHttpIntegrationTest {
    @TestConfiguration(proxyBeanMethods=false)
    class Doubles {
        // 이 수용 테스트는 별도 QA 작품만 사용한다. 고정 ID 장르 샘플 적재는 대상이 아니다.
        @Bean fun qaNoGenreSeed()=org.springframework.beans.factory.config.BeanFactoryPostProcessor { factory ->
            val registry=factory as org.springframework.beans.factory.support.BeanDefinitionRegistry
            if(registry.containsBeanDefinition("genreTemplateSeeder")) registry.removeBeanDefinition("genreTemplateSeeder")
        }
        @Bean @Primary fun qaAuth():CoreAuthClient=mock(CoreAuthClient::class.java)
        @Bean @Primary fun qaExtraction():InitialWorldExtractionClient=mock(InitialWorldExtractionClient::class.java)
    }

    @Test fun `direct input approval application and explicit revision use actual HTTP and databases`() {
        WorldStudioPostgresFixture("coexist").use { db ->
            db.studio().migrate()
            fun startContent() = SpringApplicationBuilder(ContentServiceApplication::class.java,Doubles::class.java).run(
                "--server.port=${System.getenv("MANUSCRIPT_QA_CONTENT_PORT") ?: "18761"}", "--DATABASE_URL=${db.url}",
                "--DATABASE_USER=${System.getenv("TEST_WORLDSTUDIO_DATABASE_USER")}",
                "--DATABASE_PASSWORD=${System.getenv("TEST_WORLDSTUDIO_DATABASE_PASSWORD")}",
                "--CONTENT_CORE_AUTH_TOKEN=qa-service-credential-at-least-32-characters",
                "--OPERATIONS_SERVICE_TOKEN=qa-only-operations-token-32-characters",
                "--app.manuscript-build.enabled=true","--INTERNAL_TOKEN=qa-only-manuscript-internal-token-32-chars",
                "--app.ai-service.base-url=${System.getenv("MANUSCRIPT_QA_AI_URL") ?: "http://host.docker.internal:8769"}")
            var ctx = startContent()
            try {
                val mapper=ctx.getBean(JsonMapper::class.java)
                val owner=UUID.randomUUID()
                fun authenticateOwner() {
                    `when`(ctx.getBean(CoreAuthClient::class.java).verify("Bearer $owner")).thenReturn(VerifiedMemberResponse(owner))
                    `when`(ctx.getBean(CoreAuthClient::class.java).nicknames(ai.storyfork.content.auth.client.dto.NicknamesPayload(listOf(owner.toString()))))
                        .thenReturn(ai.storyfork.content.auth.client.dto.NicknamesResponse(mapOf(owner.toString() to "QA 작가")))
                }
                authenticateOwner()
                val extraction=ctx.getBean(InitialWorldExtractionClient::class.java)
                val matcherPlaceholder=mock(InitialWorldInput::class.java)
                doAnswer { invocation ->
                    val input=invocation.getArgument<InitialWorldInput>(0)
                    val source=input.sources.first { it.field=="body" && it.text=="홍길동은 활빈당의 의적이다." }
                    val hash=MessageDigest.getInstance("SHA-256").digest(source.text.toByteArray()).joinToString("") { "%02x".format(it.toInt() and 255) }
                    mapper.writeValueAsString(InitialWorldOutput("initial-world.v1",listOf(InitialWorldCandidateOutput(
                        "fact-qa","fact","의적","홍길동은 활빈당의 의적이다.",source.ownerId,emptyList(),"ai_extraction",
                        listOf(InitialWorldEvidence(source.sourceId,0,source.text.length.toLong(),source.text,hash)),null,"","","asserted")),emptyList()))
                }.`when`(extraction).extract(org.mockito.ArgumentMatchers.any(InitialWorldInput::class.java) ?: matcherPlaceholder)
                val client=HttpClient.newHttpClient()
                val host="http://127.0.0.1:${ctx.environment.getProperty("local.server.port")}"
                val evidence=mutableListOf<Map<String,Any>>()
                fun send(path:String,method:String="GET",body:Any?=null,expected:Int=200):tools.jackson.databind.JsonNode {
                    val request=HttpRequest.newBuilder(URI.create(host+path)).header("Content-Type","application/json")
                        .header("Authorization","Bearer $owner")
                    if(method!="GET") request.header("Cookie",CsrfFixture.cookie).header("X-CSRF-TOKEN",CsrfFixture.token())
                    request.method(method,if(body==null) HttpRequest.BodyPublishers.noBody() else HttpRequest.BodyPublishers.ofString(mapper.writeValueAsString(body)))
                    val response=client.send(request.build(),HttpResponse.BodyHandlers.ofString())
                    evidence+=mapOf("method" to method,"path" to path,"request" to (body ?: ""),"status" to response.statusCode(),"response" to response.body())
                    Files.createDirectories(Path.of("build/qa"))
                    Files.writeString(Path.of("build/qa/direct-http.json"),mapper.writeValueAsString(evidence))
                    assertEquals(expected,response.statusCode(),response.body())
                    val data=mapper.readTree(response.body())
                    if(path.endsWith("/world-preprocessing") && response.statusCode() in 200..299 && data.path("build").isObject) {
                        val detail=data.path("build")
                        assertEquals(data.path("id").asString(),detail.path("jobId").asString())
                        return detail
                    }
                    return data
                }
                val world=CreateWorldRequest("홍길동전 QA","직접 입력 대역 검증")
                send("/api/v1/world-studios","POST",world)
                val base="/api/v1/world-studios/${world.id}"
                val hero=CardPayload(UUID.randomUUID(),"홍길동","홍길동은 활빈당의 의적이다.","character","basic")
                val place=CardPayload(UUID.randomUUID(),"산채","활빈당의 산채","location","basic")
                val edge=RelationshipPayload(UUID.randomUUID(),hero.id,place.id,"structural",label="거주",direction="directed",polarity="asserted")
                send("$base/draft","PUT",EditWorldDraftRequest(0,world.name,world.description,listOf(hero,place),listOf(edge),"qa-seed",false))
                val analysis=send("$base/analyses","POST",InitialWorldAnalysisRequest("qa-analysis",1))
                assertEquals("completed",analysis.path("executionStatus").asString())
                val aid=analysis.path("analysisId").asString()
                val cid=UUID.fromString(analysis.path("candidateIds").path("fact-qa").asString())
                val ap="$base/analyses/$aid"
                val original=mapper.treeToValue(analysis.path("output").path("candidates").get(0),InitialWorldCandidateOutput::class.java)
                val edited=original.copy(text="작가가 수정한 의적 설정",provenance="author_revision",evidence=emptyList())
                for((i,action) in listOf("hold","reject","edit","approve").withIndex()) {
                    val decision=send("$ap/candidates/$cid/decisions","POST",InitialWorldDecisionRequest("qa-$action",i.toLong(),action,if(action=="edit") edited else null,"QA"))
                    if(action=="edit") assertEquals("pending",decision.path("state").asString())
                }
                val request=InitialWorldApplicationRequest("qa-apply",1,listOf(InitialWorldSelection(cid,4)))
                val receipt=send("$ap/applications","POST",request)
                assertEquals("applied",receipt.path("status").asString())
                assertEquals(receipt,send("$ap/applications","POST",request))
                val draft=send(base)
                assertEquals(3,draft.path("cards").size())
                assertEquals(1,draft.path("relationships").size())
                assertEquals(edge.id.toString(),draft.path("relationships").get(0).path("id").asString())
                val saved=send("$base/revisions","POST",SaveWorldRequest(draft.path("draftRevision").asLong(),"qa-confirm"))
                assertFalse(saved.isNull)
                assertEquals(1,send("$base/revisions").size())
                val rows=db.connect().use { c -> WorldStudioPostgresFixture.rows(c,"SELECT count(*) FROM worldstudio.initial_decision WHERE candidate_id='$cid'") }
                assertEquals(listOf("4"),rows)
                val cards=db.connect().use { c -> WorldStudioPostgresFixture.rows(c,"SELECT row_to_json(c)::text FROM worldstudio.setting_card_draft c WHERE world_id='${world.id}' ORDER BY card_id") }
                val edges=ctx.getBean(org.neo4j.driver.Driver::class.java).session().use { session ->
                    session.run("MATCH (a:StudioCard)-[e:RELATED {worldId: \$world}]->(b:StudioCard) RETURN a.id AS source, b.id AS target, e.relationId AS id, e.fromEpisode AS episode, e.ended AS ended, e.payload AS payload",mapOf("world" to world.id.toString())).list { it.asMap() }
                }
                assertEquals(1,edges.size)
                assertEquals(hero.id.toString(),edges.single()["source"])
                assertEquals(place.id.toString(),edges.single()["target"])
                assertEquals(false,edges.single()["ended"])
                Files.writeString(Path.of("build/qa/direct-db.json"),mapper.writeValueAsString(mapOf("worldId" to world.id,"candidateId" to cid,"decisionCount" to rows,"postgresCards" to cards,"neo4jRelations" to edges)))
                // 결과 기록 서비스의 실제 JPA 왕복. 이것은 원고 업로드/자동 적재 수용 테스트가 아니다.
                val source=ManuscriptBuildSource(1,"qa-episode","qa-version","QA 원고","길동은 산채에 왔다.")
                val scratchWork=send("/api/v1/works","POST",mapOf("title" to "결과 저장 QA"),201).path("id").asString()
                val scratchJob=UUID.randomUUID()
                db.connect().use { c ->
                    WorldStudioPostgresFixture.sql(c,"INSERT INTO preprocessing_job(id,work_id,world_id,member_id,status,total,created_at) VALUES ('$scratchJob','$scratchWork','${world.id}','$owner','queued',1,now())")
                }
                val job=ctx.getBean(ManuscriptBuildJobRepository::class.java).saveAndFlush(ManuscriptBuildJob(
                    id=scratchJob,workId=scratchWork,worldId=world.id,ownerSubject=owner,requestKey="qa-manifest",requestHash="a".repeat(64),
                    manifest=mapOf("episodes" to listOf(mapOf("number" to 1,"episodeId" to source.episodeId,"versionId" to source.versionId,"title" to source.title,"body" to source.body,"sourceHash" to source.hash))),
                    status="queued"))
                val execution=ctx.getBean(ManuscriptBuildExecution::class.java)
                val workers=java.util.concurrent.Executors.newFixedThreadPool(2)
                val start=java.util.concurrent.CountDownLatch(1)
                val claims=try {
                    val futures=(1..2).map {
                        workers.submit<UUID?> {
                            start.await()
                            val now=java.time.Instant.now()
                            try { execution.claim(job.id,owner,now,now.plusSeconds(300)) }
                            catch (_:RuntimeException) { null }
                        }
                    }
                    start.countDown()
                    futures.map { it.get(30,java.util.concurrent.TimeUnit.SECONDS) }.filterNotNull()
                } finally { workers.shutdownNow() }
                assertEquals(1,claims.size,"실제 DB 동시 접수에서 실행권은 한 번만 발급되어야 한다")
                val token=claims.single()
                val result=ManuscriptEpisodeResult(ManuscriptBuildResultBasis(1,source.versionId,source.hash),
                    listOf(ManuscriptQuote(0,source.body.length,source.body)),mapOf("deferred" to listOf("대상 판정 보류")))
                val store=ctx.getBean(ManuscriptBuildResultStore::class.java)
                val recorded=store.record(job.id,owner,token,result)
                assertEquals(recorded.id,store.record(job.id,owner,token,result).id)
                assertEquals(listOf(result),store.read(job.id,owner))
                execution.fail(job.id,owner,token,"MODEL_TIMEOUT")
                val retryTime=java.time.Instant.now()
                val retryToken=execution.claim(job.id,owner,retryTime,retryTime.plusSeconds(300),token)
                assertNotEquals(token,retryToken)
                assertEquals(listOf(result),store.read(job.id,owner),"재실행은 영속 성공 결과를 보존한다")
                assertEquals(recorded.id,store.record(job.id,owner,retryToken,result).id)
                val storedResults=db.connect().use { c -> WorldStudioPostgresFixture.rows(c,"SELECT row_to_json(r)::text FROM worldstudio.manuscript_build_result r WHERE job_id='${job.id}'") }
                assertEquals(1,storedResults.size)
                Files.writeString(Path.of("build/qa/manuscript-result-db.json"),mapper.writeValueAsString(mapOf("jobId" to job.id,"resultId" to recorded.id,"rows" to storedResults)))
                // 명시적으로 준비한 부분 추가의 분산 저장 경계. 자동 정체 병합의 검증과 구분한다.
                val studio=ctx.getBean(WorldStudioService::class.java)
                val basis=studio.draft(world.id,owner)
                val added=CardPayload(UUID.randomUUID(),"산채 도착","길동은 산채에 왔다.","event","history")
                val addedEdge=RelationshipPayload(UUID.randomUUID(),hero.id,added.id,"structural",label="참여",direction="directed",polarity="asserted")
                val addition=EditWorldDraftRequest(basis.draftRevision,basis.name,basis.description,listOf(added),listOf(addedEdge),"qa-manuscript-load",false,1)
                @Suppress("UNCHECKED_CAST")
                val additionJson=mapper.readValue(mapper.writeValueAsBytes(addition),Map::class.java) as Map<String,Any?>
                val step=ManuscriptBuildLoadStep(jobId=job.id,sequence=1,requestPayload=additionJson,requestHash=studio.manuscriptRequestHash(world.id,addition))
                val transaction=org.springframework.transaction.support.TransactionTemplate(ctx.getBean("worldStudioTransactionManager",org.springframework.transaction.PlatformTransactionManager::class.java))
                transaction.executeWithoutResult {
                    ctx.getBean(ai.storyfork.content.world.studio.repository.StudioWorldRepository::class.java).lockOwned(world.id,owner)
                    ctx.getBean(ManuscriptBuildJobRepository::class.java).findById(job.id).orElseThrow().status="loading"
                    ctx.getBean(ManuscriptBuildLoadStepRepository::class.java).saveAndFlush(step)
                }
                db.connect().use { c ->
                    WorldStudioPostgresFixture.sql(c,"CREATE FUNCTION worldstudio.qa_fail_load() RETURNS trigger LANGUAGE plpgsql AS 'BEGIN IF NEW.status=''applied'' THEN RAISE EXCEPTION ''QA completion failure''; END IF; RETURN NEW; END'; CREATE TRIGGER qa_fail_load BEFORE UPDATE ON worldstudio.manuscript_build_load_step FOR EACH ROW EXECUTE FUNCTION worldstudio.qa_fail_load()")
                }
                assertThrows(RuntimeException::class.java) { studio.editManuscriptAddition(world.id,owner,step.id) }
                assertEquals(basis.relationshipVersion+1,ctx.getBean(ai.storyfork.content.world.relationship.Neo4jRelationshipRepository::class.java).read(world.id).version)
                db.connect().use { c ->
                    assertEquals(listOf(basis.draftRevision.toString()),WorldStudioPostgresFixture.rows(c,"SELECT draft_revision FROM worldstudio.world_draft WHERE world_id='${world.id}'"))
                    assertEquals(listOf("unknown"),WorldStudioPostgresFixture.rows(c,"SELECT status FROM worldstudio.manuscript_build_load_step WHERE id='${step.id}'"))
                    WorldStudioPostgresFixture.sql(c,"DROP TRIGGER qa_fail_load ON worldstudio.manuscript_build_load_step; DROP FUNCTION worldstudio.qa_fail_load()")
                }
                val recovered=studio.editManuscriptAddition(world.id,owner,step.id)
                val after=studio.draft(world.id,owner)
                assertEquals(basis.draftRevision+1,after.draftRevision)
                assertEquals(4,after.cards.size);assertEquals(2,after.relationships.size)
                assertEquals(hero,after.cards.single { it.id==hero.id })
                assertEquals(place,after.cards.single { it.id==place.id })
                assertEquals(edge,after.relationships.single { it.id==edge.id })
                studio.edit(world.id,owner,EditWorldDraftRequest(after.draftRevision,after.name,after.description,key="qa-later-edit"))
                assertEquals(recovered,studio.editManuscriptAddition(world.id,owner,step.id))
                assertEquals(3,studio.revision(world.id,owner,UUID.fromString(saved.path("revisionId").asString())).cards.size)
                val completed=db.connect().use { c -> WorldStudioPostgresFixture.rows(c,"SELECT row_to_json(s)::text FROM worldstudio.manuscript_build_load_step s WHERE id='${step.id}'") }
                Files.writeString(Path.of("build/qa/manuscript-step-db.json"),mapper.writeValueAsString(mapOf("jobId" to job.id,"stepId" to step.id,"receipt" to recovered,"rows" to completed)))
                // 실제 TXT 업로드 → 미발행 저장 버전 → 최초 입력 스냅샷.
                for(episodeCount in listOf(4,10)) {
                val work=send("/api/v1/works","POST",mapOf("title" to "원고 이관 QA"),201)
                val workId=work.path("id").asString()
                val uploadPath="/api/v1/works/$workId/manuscript-imports/bulk"
                val uploadBasis=send(uploadPath)
                val originals=(1..episodeCount).map { n ->
                    checkNotNull(javaClass.getResourceAsStream("/initial-build/episode-${n.toString().padStart(2,'0')}.txt")).use { it.readBytes() }
                }
                val boundary="qa-manuscript-boundary"
                val bytes=java.io.ByteArrayOutputStream()
                fun write(text:String) { bytes.write(text.toByteArray(Charsets.UTF_8)) }
                originals.forEachIndexed { i,body ->
                    write("--$boundary\r\nContent-Disposition: form-data; name=\"files\"; filename=\"episode-${i+1}.txt\"\r\nContent-Type: text/plain; charset=utf-8\r\n\r\n")
                    bytes.write(body);write("\r\n")
                }
                val uploadRequest=mapOf("rightsConfirmed" to true,"expectedWorkRevision" to uploadBasis.path("workRevision").asInt(),
                    "items" to (1..episodeCount).map { mapOf("number" to it,"title" to "QA ${it}화") })
                write("--$boundary\r\nContent-Disposition: form-data; name=\"request\"\r\nContent-Type: application/json\r\n\r\n${mapper.writeValueAsString(uploadRequest)}\r\n--$boundary--\r\n")
                val uploaded=client.send(HttpRequest.newBuilder(URI.create(host+uploadPath))
                    .header("Authorization","Bearer $owner").header("Cookie",CsrfFixture.cookie).header("X-CSRF-TOKEN",CsrfFixture.token())
                    .header("Content-Type","multipart/form-data; boundary=$boundary").POST(HttpRequest.BodyPublishers.ofByteArray(bytes.toByteArray())).build(),HttpResponse.BodyHandlers.ofString())
                Files.writeString(Path.of("build/qa/manuscript-upload-http-$episodeCount.json"),mapper.writeValueAsString(mapOf("path" to uploadPath,"request" to uploadRequest,"status" to uploaded.statusCode(),"response" to uploaded.body())))
                assertEquals(200,uploaded.statusCode(),uploaded.body())
                val uploadResult=mapper.readTree(uploaded.body())
                assertEquals(episodeCount,uploadResult.path("results").size())
                val uploadRows=(0 until uploadResult.path("results").size()).map { uploadResult.path("results").get(it) }
                assertTrue(uploadRows.all { it.path("status").asString() in setOf("created","versioned") },uploaded.body())
                val snapshot=ctx.getBean(ManuscriptBuildSnapshot::class.java).read(workId,owner.toString())
                assertEquals((1..episodeCount).toList(),snapshot.episodes.map { it.number })
                assertEquals(uploadRows.map { it.path("versionId").asString() },snapshot.episodes.map { it.versionId })
                assertEquals(originals.map { String(it,Charsets.UTF_8).replace("\r\n","\n").replace('\r','\n') },snapshot.episodes.map { it.body })
                val published=db.connect().use { c -> WorldStudioPostgresFixture.rows(c,"SELECT count(*) FROM episode_current WHERE work_id='$workId' AND published_version_id IS NOT NULL") }
                assertEquals(listOf("0"),published)
                Files.writeString(Path.of("build/qa/manuscript-upload-db-$episodeCount.json"),mapper.writeValueAsString(mapOf("workId" to workId,"snapshot" to snapshot,"publishedCount" to published)))
                val manuscriptWorld=UUID.randomUUID()
                send("/api/v1/world-studios","POST",CreateWorldRequest(id=manuscriptWorld,name="원고 최초 구축 QA",description="합성 원고 4화"))
                send("/api/v1/works/$workId/world-studio","PUT",mapOf("worldId" to manuscriptWorld))
                val jobPath="/api/v1/works/$workId/world-preprocessing"
                val stranger=UUID.randomUUID()
                `when`(ctx.getBean(CoreAuthClient::class.java).verify("Bearer $stranger")).thenReturn(VerifiedMemberResponse(stranger))
                val denied=client.send(HttpRequest.newBuilder(URI.create(host+jobPath)).header("Authorization","Bearer $stranger").GET().build(),HttpResponse.BodyHandlers.ofString())
                assertTrue(denied.statusCode() in setOf(403,404),denied.body())
                val buildRequest=mapOf("worldId" to manuscriptWorld,"key" to "qa-first-build","consent" to true)
                val qaUrl=System.getenv("MANUSCRIPT_QA_AI_URL") ?: "http://host.docker.internal:8769"
                fun modelCalls()=mapper.readTree(client.send(HttpRequest.newBuilder(URI.create("$qaUrl/qa/calls")).GET().build(),HttpResponse.BodyHandlers.ofString()).body()).size()
                val callStart=modelCalls()
                if(episodeCount==4) client.send(HttpRequest.newBuilder(URI.create("$qaUrl/qa/fail-next/2")).POST(HttpRequest.BodyPublishers.noBody()).build(),HttpResponse.BodyHandlers.ofString())
                val accepted=send(jobPath,"POST",buildRequest,202)
                assertEquals(manuscriptWorld.toString(),accepted.path("worldId").asString())
                fun awaitBuild(recovering:Boolean=false):tools.jackson.databind.JsonNode {
                    var row=send(jobPath)
                    val until=System.nanoTime()+java.time.Duration.ofSeconds(60).toNanos()
                    while(row.path("status").asString() in (listOf("queued","running","loading")+if(recovering) listOf("unknown") else emptyList()) && System.nanoTime()<until) {
                        Thread.sleep(150);row=send(jobPath)
                    }
                    return row
                }
                var progress=awaitBuild()
                if(episodeCount==4) {
                    assertEquals("failed",progress.path("status").asString(),progress.toString())
                    assertEquals("AI_TIMEOUT",progress.path("failureCode").asString())
                    assertEquals(3,progress.path("completedEpisodes").asInt())
                    val attempts=modelCalls()
                    send(jobPath,"POST",buildRequest,202)
                    assertEquals(attempts,modelCalls(),"새 키나 자동 재시도를 만들지 않는다")
                    db.connect().use { c ->
                        WorldStudioPostgresFixture.sql(c,"CREATE FUNCTION worldstudio.qa_fail_load() RETURNS trigger LANGUAGE plpgsql AS 'BEGIN IF NEW.status=''applied'' THEN RAISE EXCEPTION ''QA completion failure''; END IF; RETURN NEW; END'; CREATE TRIGGER qa_fail_load BEFORE UPDATE ON worldstudio.manuscript_build_load_step FOR EACH ROW EXECUTE FUNCTION worldstudio.qa_fail_load()")
                    }
                    send(jobPath,"POST",buildRequest+mapOf("resumeToken" to progress.path("executionToken").asString()),202)
                    progress=awaitBuild()
                    assertEquals("unknown",progress.path("status").asString(),progress.toString())
                    assertEquals(4,progress.path("completedEpisodes").asInt())
                    assertEquals(0,progress.path("receipts").size())
                    assertEquals(callStart+5,modelCalls(),"성공한 1화는 다시 추출하지 않는다")
                    db.connect().use { c ->
                        assertEquals(listOf("0"),WorldStudioPostgresFixture.rows(c,"SELECT count(*) FROM worldstudio.setting_card_draft WHERE world_id='$manuscriptWorld'"))
                        WorldStudioPostgresFixture.sql(c,"DROP TRIGGER qa_fail_load ON worldstudio.manuscript_build_load_step; DROP FUNCTION worldstudio.qa_fail_load()")
                    }
                    val pendingJob = UUID.fromString(progress.path("jobId").asString())
                    fun reservation() = db.connect().use { c ->
                        WorldStudioPostgresFixture.rows(c, "SELECT id::text || request_hash || request_payload::text FROM worldstudio.manuscript_build_load_step WHERE job_id='$pendingJob' ORDER BY sequence")
                    }
                    val reserved = reservation()
                    assertTrue(reserved.isNotEmpty())
                    val orphanWork = send("/api/v1/works","POST",mapOf("title" to "입력 고정 전 중단 QA"),201).path("id").asString()
                    val orphanId = UUID.randomUUID()
                    db.connect().use { c ->
                        WorldStudioPostgresFixture.sql(c,"INSERT INTO preprocessing_job(id,work_id,member_id,status,total,created_at) VALUES ('$orphanId','$orphanWork','$owner','queued',4,now())")
                        assertEquals(listOf("loading"), WorldStudioPostgresFixture.rows(c,"SELECT status FROM preprocessing_job WHERE id='$pendingJob'"))
                    }
                    // Keep PostgreSQL, Neo4j and the provider running; discard the entire Content application context.
                    ctx.close()
                    ctx = startContent()
                    authenticateOwner()
                    val orphanPath = "/api/v1/works/$orphanWork/world-preprocessing"
                    val orphan = send(orphanPath)
                    assertEquals(orphanId.toString(), orphan.path("id").asString())
                    assertEquals("manual_review", orphan.path("recovery").asString())
                    assertEquals("PREPROCESSING_SNAPSHOT_MISSING", send(orphanPath,"POST",expected=409).path("code").asString())
                    val retry = client.send(HttpRequest.newBuilder(URI.create("$host/internal/v1/preprocessing-jobs/$orphanId/retry"))
                        .header("X-Operations-Service-Token","qa-only-operations-token-32-characters")
                        .POST(HttpRequest.BodyPublishers.noBody()).build(), HttpResponse.BodyHandlers.ofString())
                    assertEquals(409,retry.statusCode(),retry.body())
                    assertEquals("PREPROCESSING_SNAPSHOT_MISSING", mapper.readTree(retry.body()).path("code").asString())
                    assertEquals(listOf("queued"), db.connect().use { c -> WorldStudioPostgresFixture.rows(c,"SELECT status FROM preprocessing_job WHERE work_id='$orphanWork'") })
                    assertEquals("unknown",send(jobPath).path("status").asString())
                    val beforeRecovery=modelCalls()
                    send(jobPath,"POST",buildRequest,202)
                    progress=awaitBuild(true)
                    assertEquals(reserved, reservation())
                    assertEquals(beforeRecovery,modelCalls(),"적재 복구는 모델을 재호출하지 않는다")
                }
                assertEquals("completed",progress.path("status").asString(),progress.toString())
                assertEquals(episodeCount,progress.path("completedEpisodes").asInt())
                val repeated=send(jobPath,"POST",buildRequest,202)
                assertEquals(progress.path("receipts"),repeated.path("receipts"))
                send(jobPath,"POST",buildRequest+mapOf("key" to "different-key"),409)
                val built=mapper.convertValue(send("/api/v1/world-studios/$manuscriptWorld"),WorldDraftResponse::class.java)
                Files.writeString(Path.of("build/qa/manuscript-draft.json"),mapper.writeValueAsString(built))
                Files.writeString(Path.of("build/qa/manuscript-draft-episode1.json"),mapper.writeValueAsString(send("/api/v1/world-studios/$manuscriptWorld?episode=1")))
                assertEquals(if(episodeCount==4) 6 else 8,built.cards.size)
                assertTrue(built.cards.all { it.visibility=="private" && "revealFromEpisode" !in it.semanticMetadata })
                assertTrue(built.cards.all { "manuscriptBuild" in it.semanticMetadata && "studio" in it.semanticMetadata })
                assertEquals(if(episodeCount==4) 0 else 1,built.relationships.size)
                val builtHero=built.cards.single { it.title=="길동" }
                val aliases=built.cards.filter { it.title=="홍길동" }
                assertEquals(2,aliases.size)
                fun info(card:CardPayload)=mapper.valueToTree<tools.jackson.databind.JsonNode>(card.semanticMetadata["preprocessing"])
                val merchant=aliases.single { info(it).path("firstEpisode").asInt()==2 }
                val alias=aliases.single { info(it).path("firstEpisode").asInt()==1 }
                val candidate=info(alias).path("identityCandidates").get(0)
                assertEquals(alias.id.toString(),candidate.path("fromCardId").asString())
                assertEquals(builtHero.id.toString(),candidate.path("toCardId").asString())
                assertEquals(1,candidate.path("episode").asInt())
                assertTrue(candidate.path("sourceId").asString().isNotBlank())
                assertEquals("길동은 홍길동이라고도 불린다.",candidate.path("quote").asString())
                assertTrue(built.relationships.none { it.category=="identity" })
                assertNotEquals(builtHero.id,merchant.id)
                val heroDocs:tools.jackson.databind.JsonNode=mapper.valueToTree(builtHero.semanticMetadata["characterDocs"])
                assertFalse(heroDocs.path("goal").asString().contains("다스리고"))
                assertTrue(heroDocs.path("episodes").path("3").asString().contains("다스리고"))
                assertFalse(mapper.writeValueAsString(merchant.semanticMetadata["characterDocs"]).contains("비밀 지도"))
                if(episodeCount==10) {
                    assertFalse(heroDocs.toString().contains("10화의 암호"))
                    assertTrue(mapper.writeValueAsString(merchant.semanticMetadata["characterDocs"]).contains("10화의 암호"))
                    for((title,first) in listOf("산채" to 5,"부채" to 6)) {
                        val metadata=built.cards.single { it.title==title }.semanticMetadata["preprocessing"] as Map<*,*>
                        assertEquals(first,metadata["firstEpisode"])
                    }
                    assertEquals(0,send("/api/v1/world-studios/$manuscriptWorld?episode=8").path("relationships").size())
                    assertEquals(1,send("/api/v1/world-studios/$manuscriptWorld?episode=9").path("relationships").size())
                }
                assertEquals(1,send("/api/v1/world-studios/$manuscriptWorld?episode=1").path("relationships").size())
                val firstRevision=send("/api/v1/world-studios/$manuscriptWorld/revisions","POST",SaveWorldRequest(built.draftRevision,"qa-manuscript-confirm"))
                val afterConfirm=send("/api/v1/world-studios/$manuscriptWorld")
                val revisedCards=built.cards.mapIndexed { index,c -> if(index==0) {
                    val studioMeta=c.semanticMetadata["studio"] as Map<*,*>
                    val item=studioMeta["item"] as Map<*,*>
                    val text=c.body+"\n작가 수정"
                    c.copy(body=text,semanticMetadata=c.semanticMetadata+("studio" to (studioMeta+("item" to (item+mapOf("text" to text,"authorText" to text,"origin" to "author_addition","evidence" to emptyList<Any>(),"orderEvidence" to emptyList<Any>()))))))
                } else c }
                val editedBuild=mapper.convertValue(send("/api/v1/world-studios/$manuscriptWorld/draft","PUT",
                    EditWorldDraftRequest(afterConfirm.path("draftRevision").asLong(),built.name,built.description,revisedCards,built.relationships,"qa-author-edit",true)),WorldDraftResponse::class.java)
                assertEquals(revisedCards,editedBuild.cards)
                send("/api/v1/world-studios/$manuscriptWorld/revisions","POST",SaveWorldRequest(editedBuild.draftRevision,"qa-manuscript-confirm-2"))
                val oldBuild=send("/api/v1/world-studios/$manuscriptWorld/revisions/${firstRevision.path("revisionId").asString()}")
                assertFalse(oldBuild.toString().contains("작가 수정"))
                assertEquals(progress.path("receipts"),send(jobPath,"POST",buildRequest,202).path("receipts"))
                val resultRows=db.connect().use { c -> WorldStudioPostgresFixture.rows(c,"SELECT row_to_json(r)::text FROM worldstudio.manuscript_build_result r WHERE job_id='${progress.path("jobId").asString()}' ORDER BY kind,episode") }
                assertEquals(episodeCount+2,resultRows.size)
                val buildEdges=ctx.getBean(org.neo4j.driver.Driver::class.java).session().use { s ->
                    s.run("MATCH (a:StudioCard)-[e:RELATED {worldId: \$world}]->(b:StudioCard) RETURN a.id AS source,b.id AS target,e.relationId AS id,e.fromEpisode AS episode,e.ended AS ended",mapOf("world" to manuscriptWorld.toString())).list { it.asMap() }
                }
                assertEquals(if(episodeCount==4) 2 else 5,buildEdges.size)
                Files.writeString(Path.of("build/qa/connected-build-http-$episodeCount.json"),mapper.writeValueAsString(evidence))
                Files.writeString(Path.of("build/qa/connected-build-db-$episodeCount.json"),mapper.writeValueAsString(mapOf("workId" to workId,"progress" to progress,"draft" to built,"results" to resultRows,"neo4j" to buildEdges)))
                // Separate author edit after the extraction receipt and pre-approval graph have been recorded.
                val approvedAt=episodeCount+1
                val authorEdge=RelationshipPayload(UUID.randomUUID(),alias.id,builtHero.id,"identity",label="동일 인물",direction="directed")
                val latest=send("/api/v1/world-studios/$manuscriptWorld")
                val approveRequest=EditWorldDraftRequest(latest.path("draftRevision").asLong(),built.name,built.description,
                    relationships=listOf(authorEdge),key="qa-author-identity",replace=false,episode=approvedAt)
                send("/api/v1/world-studios/$manuscriptWorld/draft","PUT",approveRequest)
                val beforeApproval=send("/api/v1/world-studios/$manuscriptWorld?episode=$episodeCount")
                assertFalse(beforeApproval.path("relationships").any { it.path("category").asString()=="identity" })
                val approved=send("/api/v1/world-studios/$manuscriptWorld?episode=$approvedAt").path("relationships")
                assertEquals(authorEdge.id.toString(),approved.single { it.path("category").asString()=="identity" }.path("id").asString())
                }
                val boundary="qa-epub-boundary"
                val epubWork=send("/api/v1/works","POST",mapOf("title" to "EPUB 이관 QA"),201).path("id").asString()
                val epubBytes=checkNotNull(javaClass.getResourceAsStream("/initial-build/four-episodes.epub")).use { it.readBytes() }
                val epubEvidence=mutableListOf<Map<String,Any>>()
                fun epubPost(path:String,requestBody:Any?=null):tools.jackson.databind.JsonNode {
                    val content=java.io.ByteArrayOutputStream()
                    fun text(value:String) { content.write(value.toByteArray(Charsets.UTF_8)) }
                    text("--$boundary\r\nContent-Disposition: form-data; name=\"file\"; filename=\"qa.epub\"\r\nContent-Type: application/epub+zip\r\n\r\n")
                    content.write(epubBytes);text("\r\n")
                    if(requestBody!=null) text("--$boundary\r\nContent-Disposition: form-data; name=\"request\"\r\nContent-Type: application/json\r\n\r\n${mapper.writeValueAsString(requestBody)}\r\n")
                    text("--$boundary--\r\n")
                    val response=client.send(HttpRequest.newBuilder(URI.create(host+path)).header("Authorization","Bearer $owner")
                        .header("Cookie",CsrfFixture.cookie).header("X-CSRF-TOKEN",CsrfFixture.token())
                        .header("Content-Type","multipart/form-data; boundary=$boundary").POST(HttpRequest.BodyPublishers.ofByteArray(content.toByteArray())).build(),HttpResponse.BodyHandlers.ofString())
                    epubEvidence+=mapOf("path" to path,"request" to (requestBody ?: "preview"),"status" to response.statusCode(),"response" to response.body())
                    Files.writeString(Path.of("build/qa/manuscript-epub-http.json"),mapper.writeValueAsString(epubEvidence))
                    assertEquals(200,response.statusCode(),response.body())
                    return mapper.readTree(response.body())
                }
                val epubPath="/api/v1/works/$epubWork/manuscript-imports"
                val preview=epubPost("$epubPath/preview")
                assertEquals(4,preview.path("episodes").size())
                val confirmed=epubPost(epubPath,mapOf("rightsConfirmed" to true,"items" to (0 until preview.path("episodes").size()).map { i ->
                    val row=preview.path("episodes").get(i)
                    mapOf("number" to i+1,"title" to row.path("title").asString(),"from" to row.path("from").asInt(),"to" to row.path("to").asInt()) }))
                assertEquals(4,confirmed.path("succeeded").asInt(),confirmed.toString())
                assertEquals(0,confirmed.path("failed").asInt())
                val epubSnapshot=ctx.getBean(ManuscriptBuildSnapshot::class.java).read(epubWork,owner.toString())
                fun whitespace(text:String)=text.replace(Regex("\\s+")," ").trim()
                assertEquals((1..4).map { whitespace(checkNotNull(javaClass.getResourceAsStream("/initial-build/episode-" + it.toString().padStart(2,'0') + ".txt")).use { stream -> String(stream.readBytes(),Charsets.UTF_8) }) },epubSnapshot.episodes.map { whitespace(it.body) })
                val epubPublished=db.connect().use { c -> WorldStudioPostgresFixture.rows(c,"SELECT count(*) FROM episode_current WHERE work_id='$epubWork' AND published_version_id IS NOT NULL") }
                assertEquals(listOf("0"),epubPublished)
                Files.writeString(Path.of("build/qa/manuscript-epub-db.json"),mapper.writeValueAsString(mapOf("workId" to epubWork,"snapshot" to epubSnapshot,"publishedCount" to epubPublished)))
            } finally {
                ctx.close()
            }
        }
    }
}
