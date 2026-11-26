package ai.storyfork.content.world

import ai.storyfork.content._common.exception.ContentFailure
import ai.storyfork.content.work.entity.WorkEntity
import ai.storyfork.content.work.repository.WorkRepository
import ai.storyfork.content.work.service.WorkAccessService
import ai.storyfork.content.work.service.WorkWorldService
import ai.storyfork.content.work.service.dto.WorkAccessResult
import ai.storyfork.content.world.domain.WorldConflict
import ai.storyfork.content.world.domain.WorldMetadataInvalid
import ai.storyfork.content.world.service.*
import ai.storyfork.content.world.service.dto.*
import ai.storyfork.content.world.studio.entity.ManuscriptBuildJob
import ai.storyfork.content.world.studio.entity.ManuscriptBuildLoadStep
import ai.storyfork.content.world.studio.entity.ManuscriptBuildResult
import ai.storyfork.content.world.studio.entity.StudioWorld
import ai.storyfork.content.world.studio.repository.*
import java.time.Duration
import java.time.Instant
import java.util.Optional
import java.util.UUID
import org.junit.jupiter.api.Assertions.*
import org.junit.jupiter.api.Test
import org.mockito.ArgumentCaptor
import org.mockito.ArgumentMatchers.any
import org.mockito.ArgumentMatchers.eq
import org.mockito.Mockito.*
import org.springframework.transaction.PlatformTransactionManager
import org.springframework.transaction.support.SimpleTransactionStatus
import tools.jackson.databind.json.JsonMapper
import tools.jackson.module.kotlin.KotlinModule

/** 최초 구축 전체 연결의 판단(전제 변경 기록, 접수 거절 사유, 집계)만 DB·AI 없이 검증한다. 저장소와 하위 서비스는 대역이다. */
class ManuscriptBuildServiceTest {
    private val owner=UUID.randomUUID()
    private val worldId=UUID.randomUUID()
    private val workId="work"
    private val access=mock(WorkAccessService::class.java)
    private val works=mock(WorkRepository::class.java)
    private val links=mock(WorkWorldService::class.java)
    private val studio=mock(WorldStudioService::class.java)
    private val snapshot=mock(ManuscriptBuildSnapshot::class.java)
    private val execution=mock(ManuscriptBuildExecution::class.java)
    private val resultStore=mock(ManuscriptBuildResultStore::class.java)
    private val jobs=mock(ManuscriptBuildJobRepository::class.java)
    private val results=mock(ManuscriptBuildResultRepository::class.java)
    private val steps=mock(ManuscriptBuildLoadStepRepository::class.java)
    private val worlds=mock(StudioWorldRepository::class.java)
    private val manager=mock(PlatformTransactionManager::class.java).also { `when`(it.getTransaction(any())).thenAnswer { SimpleTransactionStatus() } }
    private val mapper=JsonMapper.builder().addModule(KotlinModule.Builder().build()).build()
    private val service=ManuscriptBuildService(access,works,links,studio,snapshot,execution,resultStore,jobs,results,steps,worlds,manager,mapper,true)

    private val fixture=mapper.readTree(checkNotNull(javaClass.getResourceAsStream("/initial-build/ai-result.json")))
    private val extractions=(0 until fixture.path("extractions").size()).map { fixture.path("extractions").get(it) }
    private val sources=extractions.mapIndexed { i,node -> ManuscriptBuildSource(node.path("number").asInt(),"episode-$i","version-$i",node.path("title").asString(),node.path("source").asString()) }
    private val emptyDraft=WorldDraftResponse(worldId,0,null,null,"세계관","",emptyList(),emptyList())

    @Suppress("UNCHECKED_CAST") private fun json(value:Any)=mapper.readValue(mapper.writeValueAsBytes(value),Map::class.java) as Map<String,Any?>
    /** 업데이트 작업의 manifest에는 기준 초안이 없고(claim 때 [basis] 칼럼에 고정한다) 최초 구축 작업은 manifest에 둔다. */
    private fun job(status:String,token:UUID?=null,kind:String="initial",basis:WorldDraftResponse?=null,
        episodeSources:List<ManuscriptBuildSource> = sources):ManuscriptBuildJob {
        val episodes=episodeSources.map { mapOf("number" to it.number,"episodeId" to it.episodeId,
            "versionId" to it.versionId,"title" to it.title,"body" to it.body,"sourceHash" to it.hash) }
        val manifest=if(kind=="update") mapOf("episodes" to episodes) else mapOf("basis" to json(emptyDraft),"episodes" to episodes)
        return ManuscriptBuildJob(workId=workId,worldId=worldId,ownerSubject=owner,requestKey="key-1",requestHash="a".repeat(64),
            manifest=manifest,status=status,executionToken=token,deadline=token?.let { Instant.now().plusSeconds(60) },
            kind=kind,basis=basis?.let { json(it) }).also { job ->
            `when`(jobs.worldId(job.id)).thenReturn(worldId)
            `when`(worlds.lockOwned(worldId,owner)).thenReturn(StudioWorld(id=worldId,ownerSubject=owner))
            `when`(jobs.lock(job.id)).thenReturn(job)
            `when`(jobs.findById(job.id)).thenReturn(Optional.of(job))
            `when`(jobs.existsById(job.id)).thenReturn(true)
        }
    }
    private fun saved(job:ManuscriptBuildJob,kind:String,episode:Int,content:Map<String,Any?>)=ManuscriptBuildResult(jobId=job.id,kind=kind,episode=episode,content=content,contentHash="b".repeat(64))

    /** 추출·정체·구조화 결과가 모두 저장된 실행 중 작업이다. 각 시험은 적재 직전 전제 하나만 바꾼다. */
    private fun readyToLoad(kind:String="initial"):Pair<ManuscriptBuildJob,UUID> {
        val token=UUID.randomUUID()
        val job=job("running",token,kind,if(kind=="update") updateBasis else null)
        `when`(snapshot.readPublished(anyString(),anyWanted())).thenReturn(ManuscriptBuildInput(sources))
        `when`(resultStore.read(job.id,owner)).thenReturn(extractions.mapIndexed { i,node -> ManuscriptExtractionVerifier.verify(sources[i],node,mapper) })
        `when`(snapshot.read(workId,owner.toString())).thenReturn(ManuscriptBuildInput(sources))
        `when`(works.findById(workId)).thenReturn(Optional.of(WorkEntity(id=workId,ownerId=owner.toString(),title="작품",worldStudioId=worldId)))
        `when`(results.findByJobIdAndKindAndEpisode(job.id,"payload",0)).thenReturn(saved(job,"payload",0,json(fixture.path("payload"))))
        `when`(results.findByJobIdAndKindAndEpisode(job.id,"identity",0)).thenReturn(saved(job,"identity",0,json(fixture.path("identity"))))
        sources.forEach { `when`(results.findByJobIdAndKindAndEpisode(job.id,"extraction",it.number)).thenReturn(saved(job,"extraction",it.number,emptyMap())) }
        return job to token
    }
    private fun worldChangedWhilePreparing() {
        val action:() -> Any={ 0 }
        doThrow(WorldConflict()).`when`(studio).prepareManuscript(eq(worldId) ?: worldId,eq(owner) ?: owner,any(WorldDraftResponse::class.java) ?: emptyDraft,
            any(Function0::class.java) as? (() -> Any) ?: action)
    }

    // ---- 기능 플래그: 꺼져 있으면 시작 API와 원고 가져오기의 자동 접수가 같은 503으로 거절된다 ----

    @Test fun `a disabled feature flag refuses to freeze the input with 503 before reading the manuscript`() {
        val disabled=ManuscriptBuildService(access,works,links,studio,snapshot,execution,resultStore,jobs,results,steps,worlds,manager,mapper,false)
        val failure=assertThrows(ContentFailure::class.java) { disabled.freeze(workId,owner.toString()) }
        assertEquals(503,failure.status)
        assertEquals("초기 세계관 구축은 아직 활성화되지 않았습니다.",failure.message)
        verifyNoInteractions(snapshot)
    }

    // ---- 적재 직전 전제가 추출 중에 바뀐 경우: 사유를 남겨 재개 불가 실패로 끝낸다 ----

    @Test fun `an edited manuscript fails the job as SOURCE_CHANGED instead of leaving it running`() {
        val (job,token)=readyToLoad()
        `when`(snapshot.read(workId,owner.toString())).thenReturn(ManuscriptBuildInput(sources.dropLast(1)))
        assertThrows(WorldConflict::class.java) { service.load(job.id,token) }
        verify(execution).fail(job.id,owner,token,"SOURCE_CHANGED")
        verifyNoInteractions(studio)
    }
    @Test fun `a manuscript that can no longer be frozen counts as changed too`() {
        val (job,token)=readyToLoad()
        `when`(snapshot.read(workId,owner.toString())).thenThrow(ContentFailure(422,"2화에 저장한 원고가 없어요."))
        assertThrows(WorldConflict::class.java) { service.load(job.id,token) }
        verify(execution).fail(job.id,owner,token,"SOURCE_CHANGED")
    }
    @Test fun `a work linked to another world fails the job as WORLD_LINK_CHANGED`() {
        val (job,token)=readyToLoad()
        `when`(works.findById(workId)).thenReturn(Optional.of(WorkEntity(id=workId,ownerId=owner.toString(),title="작품",worldStudioId=UUID.randomUUID())))
        assertThrows(WorldConflict::class.java) { service.load(job.id,token) }
        verify(execution).fail(job.id,owner,token,"WORLD_LINK_CHANGED")
        verifyNoInteractions(studio)
    }
    @Test fun `a world edited after the input was fixed fails the job as WORLD_CHANGED`() {
        val (job,token)=readyToLoad()
        worldChangedWhilePreparing()
        assertThrows(WorldConflict::class.java) { service.load(job.id,token) }
        verify(execution).fail(job.id,owner,token,"WORLD_CHANGED")
    }

    @Test fun `an execution that expires while reserving load steps fails as EXECUTION_EXPIRED`() {
        val (job,token)=readyToLoad()
        val action:() -> Any={ 0 }
        doAnswer { call ->
            job.deadline=Instant.EPOCH
            call.getArgument<() -> Any>(3).invoke()
        }.`when`(studio).prepareManuscript(eq(worldId) ?: worldId,eq(owner) ?: owner,any(WorldDraftResponse::class.java) ?: emptyDraft,
            any(Function0::class.java) as? (() -> Any) ?: action)

        assertThrows(WorldConflict::class.java) { service.load(job.id,token) }
        verify(execution).fail(job.id,owner,token,"EXECUTION_EXPIRED")
        verifyNoInteractions(steps)
    }

    // ---- 접수: 거절 사유와 세계관 이름 ----

    private fun unlinkedWork(title:String) {
        `when`(access.own(workId,owner.toString())).thenReturn(WorkAccessResult(workId,owner.toString(),title,"",1,worldId.toString(),"private",false,false,null))
        `when`(works.findById(workId)).thenReturn(Optional.of(WorkEntity(id=workId,ownerId=owner.toString(),title=title)))
        `when`(worlds.findById(worldId)).thenReturn(Optional.empty())
    }
    private val request=ManuscriptBuildRequest(worldId,"key-1",true)
    private val input=ManuscriptBuildInput(sources)

    @Test fun `a long work title is cut to the 100 characters a world name allows`() {
        unlinkedWork("가".repeat(150))
        `when`(studio.draft(worldId,owner)).thenReturn(emptyDraft)
        service.prepare(UUID.randomUUID(),workId,owner,request,input)
        verify(studio).create(owner,CreateWorldRequest("가".repeat(100),"",worldId))
    }
    @Test fun `a world that already holds settings is refused with 409 and a reason`() {
        unlinkedWork("작품")
        `when`(studio.draft(worldId,owner)).thenReturn(emptyDraft.copy(cards=listOf(CardPayload(UUID.randomUUID(),"기존","본문","character","basic"))))
        val failure=assertThrows(ContentFailure::class.java) { service.prepare(UUID.randomUUID(),workId,owner,request,input) }
        assertEquals(409,failure.status)
        assertTrue(failure.message.contains("이미 설정이 있는 세계관"),failure.message)
        verifyNoInteractions(links)
        verify(jobs,never()).saveAndFlush(any(ManuscriptBuildJob::class.java))
    }

    // ---- 상태 응답: 제외한 항목 수 ----

    @Test fun `status sums the items the AI left out over the extraction results only`() {
        val job=job("failed")
        `when`(results.findAllByJobIdOrderByEpisode(job.id)).thenReturn(listOf(
            saved(job,"extraction",1,mapOf("extraction" to mapOf("skipped" to mapOf("INVALID_OR_AMBIGUOUS_QUOTE" to 2,"SEMANTIC_TYPE_CONFLICT" to 1)))),
            saved(job,"extraction",2,mapOf("extraction" to mapOf("skipped" to emptyMap<String,Int>()))),
            saved(job,"extraction",3,mapOf("extraction" to mapOf("number" to 3))),
            saved(job,"identity",0,mapOf("extraction" to mapOf("skipped" to mapOf("IGNORED" to 9))))))
        val response=service.status(job.id,owner)!!
        assertEquals(3,response.skippedItems)
        assertEquals(3,response.completedEpisodes)
    }

    @Test fun `completed status includes rejected identity links and relationships omitted from reserved steps`() {
        val token=UUID.randomUUID()
        val job=job("completed",token)
        val found=listOf(
            saved(job,"extraction",1,mapOf("extraction" to mapOf("skipped" to mapOf("INVALID_OR_AMBIGUOUS_QUOTE" to 3)))),
            saved(job,"identity",0,mapOf("skippedLinks" to 1)),
            saved(job,"payload",0,mapOf("relations" to List(5) { emptyMap<String,Any?>() })),
        )
        val reserved=listOf(1,2).map { count ->
            val step=ManuscriptBuildLoadStep(jobId=job.id,sequence=count,
                requestPayload=mapOf("relationships" to List(count) { emptyMap<String,Any?>() }),requestHash="a".repeat(64))
            step.status="applied"
            step.receipt=json(ManuscriptLoadReceipt(job.id,step.id,worldId,1,1,emptyList(),emptyList()))
            step
        }
        `when`(results.findAllByJobIdOrderByEpisode(job.id)).thenReturn(found)
        `when`(steps.findAllByJobIdOrderBySequence(job.id)).thenReturn(reserved)

        assertEquals(6,service.status(job.id,owner)!!.skippedItems)
        assertEquals(6,service.load(job.id,token).skippedItems)
    }

    @Test fun `status carries the request key so another browser can resume the same job`() {
        val job=job("queued")
        assertEquals("key-1",service.status(job.id,owner)!!.requestKey)
    }
    // ---- 업데이트 작업(발행 회차로 세계관 업데이트): 기준 초안은 claim 때 고정한다 ----

    private val basisCard=CardPayload(UUID.randomUUID(),"길동","원본","character","basic")
    private val updateBasis=emptyDraft.copy(draftRevision=5,cards=listOf(basisCard))
    private fun anyUuid():UUID=any(UUID::class.java) ?: UUID(0,0)
    private fun anyInstant():Instant=any(Instant::class.java) ?: Instant.EPOCH
    @Suppress("UNCHECKED_CAST") private fun anyWanted():(Int)->Boolean=any(Function1::class.java) as? ((Int)->Boolean) ?: { _:Int -> true }
    private fun claimedBy(token:UUID) { `when`(execution.claim(anyUuid(),anyUuid(),anyInstant(),anyInstant(),isNull())).thenReturn(token) }

    @Test fun `the execution lease covers extraction batches and sequential result callbacks`() {
        for ((count, expectedSeconds) in listOf(1 to 350L, 4 to 410L, 5 to 610L, 8 to 670L)) {
            val episodes = (1..count).map { number ->
                sources.first().copy(number = number, episodeId = "episode-$number", versionId = "version-$number")
            }
            val job = job("queued", episodeSources = episodes)
            val token = UUID.randomUUID()
            claimedBy(token)
            `when`(snapshot.read(workId, owner.toString())).thenReturn(ManuscriptBuildInput(episodes))
            val started = ArgumentCaptor.forClass(Instant::class.java)
            val deadline = ArgumentCaptor.forClass(Instant::class.java)

            assertEquals(token, service.claim(job.id, workId)["token"])

            verify(execution).claim(eq(job.id) ?: job.id, eq(owner) ?: owner,
                started.capture() ?: Instant.EPOCH, deadline.capture() ?: Instant.EPOCH, isNull())
            assertEquals(Duration.ofSeconds(expectedSeconds), Duration.between(started.value, deadline.value), "$count episodes")
        }
    }

    @Test fun `claiming an update job fixes the current draft as its basis`() {
        val job=job("queued",kind="update");val token=UUID.randomUUID();claimedBy(token)
        `when`(snapshot.readPublished(anyString(),anyWanted())).thenReturn(ManuscriptBuildInput(sources))
        `when`(studio.draft(worldId,owner)).thenReturn(updateBasis)

        val claimed=service.claim(job.id,workId)

        assertEquals(true,claimed["claimed"]);assertEquals(token,claimed["token"])
        assertEquals(json(updateBasis),job.basis,"접수가 아니라 claim 때의 초안이 기준이다")
        assertFalse(job.manifest.containsKey("basis"),"manifest는 접수 때 고정한 불변 입력이다")
    }
    @Test fun `an update job whose published episodes changed fails as SOURCE_CHANGED before fixing a basis`() {
        val job=job("queued",kind="update");val token=UUID.randomUUID();claimedBy(token)
        `when`(snapshot.readPublished(anyString(),anyWanted())).thenReturn(ManuscriptBuildInput(sources.dropLast(1)))
        assertThrows(WorldConflict::class.java) { service.claim(job.id,workId) }
        verify(execution).fail(job.id,owner,token,"SOURCE_CHANGED")
        verifyNoInteractions(studio)
        assertNull(job.basis)
    }
    @Test fun `an update job whose world cannot be read at claim fails as WORLD_CHANGED`() {
        val job=job("queued",kind="update");val token=UUID.randomUUID();claimedBy(token)
        `when`(snapshot.readPublished(anyString(),anyWanted())).thenReturn(ManuscriptBuildInput(sources))
        `when`(studio.draft(worldId,owner)).thenThrow(ai.storyfork.content.world.domain.WorldNotFound())
        assertThrows(WorldConflict::class.java) { service.claim(job.id,workId) }
        verify(execution).fail(job.id,owner,token,"WORLD_CHANGED")
        assertNull(job.basis)
    }
    @Test fun `claiming an initial job keeps its manifest basis and never reads the draft`() {
        val job=job("queued");val token=UUID.randomUUID();claimedBy(token)
        `when`(snapshot.read(workId,owner.toString())).thenReturn(ManuscriptBuildInput(sources))
        assertEquals(true,service.claim(job.id,workId)["claimed"])
        assertNull(job.basis)
        verifyNoInteractions(studio)
    }
    @Test fun `an update job loads against the basis fixed at claim and fails as WORLD_CHANGED when the world moved`() {
        val (job,token)=readyToLoad("update")
        val basis=ArgumentCaptor.forClass(WorldDraftResponse::class.java)
        doThrow(WorldConflict()).`when`(studio).prepareManuscript(eq(worldId) ?: worldId,eq(owner) ?: owner,basis.capture() ?: emptyDraft,
            any(Function0::class.java) as? (() -> Any) ?: { 0 })

        assertThrows(WorldConflict::class.java) { service.load(job.id,token) }

        assertEquals(updateBasis,basis.value,"적재의 기준 검사는 manifest가 아니라 claim 때 고정한 초안을 쓴다")
        verify(execution).fail(job.id,owner,token,"WORLD_CHANGED")
    }
    @Test fun `a load request the draft edit check refuses fails the job as CONTENT_REJECTED instead of leaving it running`() {
        val (job,token)=readyToLoad("update")
        doAnswer { (it.arguments[3] as () -> Any).invoke() }.`when`(studio).prepareManuscript(eq(worldId) ?: worldId,eq(owner) ?: owner,
            any(WorldDraftResponse::class.java) ?: emptyDraft,any(Function0::class.java) as? (() -> Any) ?: { 0 })
        doThrow(WorldMetadataInvalid("카드 ${basisCard.id}: semanticMetadata 키 'color'는 허용되지 않습니다.")).`when`(studio).validateEditRequest(
            any(EditWorldDraftRequest::class.java) ?: EditWorldDraftRequest(0,"x","",key="k"),anyList(),anyList())

        assertThrows(WorldConflict::class.java) { service.load(job.id,token) }

        verify(execution).fail(job.id,owner,token,"CONTENT_REJECTED")
        verify(steps,never()).saveAndFlush(any(ManuscriptBuildLoadStep::class.java))
        // 적재 전 검사는 이 작업이 고정한 기준 초안의 카드·관계를 '저장돼 있던 값'으로 본다(맞춘 기존 카드를 그대로 다시 보내는 업데이트가 옛 키 때문에 막히지 않게).
        val sent=mockingDetails(studio).invocations.first { it.method.name.startsWith("validateEditRequest") }.arguments
        assertEquals(updateBasis.cards,sent[1]);assertEquals(updateBasis.relationships,sent[2])
    }
    @Test fun `an update job whose published episodes changed during extraction fails as SOURCE_CHANGED`() {
        val (job,token)=readyToLoad("update")
        `when`(snapshot.readPublished(anyString(),anyWanted())).thenReturn(ManuscriptBuildInput(sources.dropLast(1)))
        assertThrows(WorldConflict::class.java) { service.load(job.id,token) }
        verify(execution).fail(job.id,owner,token,"SOURCE_CHANGED")
        verifyNoInteractions(studio)
    }

    // ---- 업데이트 접수 ----

    private fun linkedWork() {
        `when`(access.own(workId,owner.toString())).thenReturn(WorkAccessResult(workId,owner.toString(),"작품","",1,worldId.toString(),"private",false,false,null))
        `when`(works.findById(workId)).thenReturn(Optional.of(WorkEntity(id=workId,ownerId=owner.toString(),title="작품",worldStudioId=worldId)))
        `when`(worlds.findById(worldId)).thenReturn(Optional.of(StudioWorld(id=worldId,ownerSubject=owner)))
        `when`(studio.draft(worldId,owner)).thenReturn(updateBasis)
    }
    @Test fun `an update job is accepted on a world that already holds settings and keeps no basis in its manifest`() {
        linkedWork()
        doAnswer { (it.arguments[3] as () -> Any).invoke() }.`when`(studio).prepareManuscript(eq(worldId) ?: worldId,eq(owner) ?: owner,
            any(WorldDraftResponse::class.java) ?: emptyDraft,any(Function0::class.java) as? (() -> Any) ?: { 0 })

        service.prepareUpdate(UUID.randomUUID(),workId,owner,ManuscriptBuildRequest(worldId,"publish:ev-1",true),ManuscriptBuildInput(sources.takeLast(1)))

        val saved=ArgumentCaptor.forClass(ManuscriptBuildJob::class.java)
        verify(jobs).saveAndFlush(saved.capture() ?: ManuscriptBuildJob(workId=workId,worldId=worldId,ownerSubject=owner,requestKey="placeholder",requestHash="a".repeat(64),manifest=emptyMap()))
        assertEquals("update",saved.value.kind);assertEquals("publish:ev-1",saved.value.requestKey)
        assertFalse(saved.value.manifest.containsKey("basis"));assertNull(saved.value.basis)
        assertEquals(listOf(sources.last().number),(saved.value.manifest["episodes"] as List<*>).map { (it as Map<*,*>)["number"] })
        verifyNoInteractions(links)
    }
    @Test fun `an update job is refused when the work is not linked to the world`() {
        linkedWork()
        `when`(works.findById(workId)).thenReturn(Optional.of(WorkEntity(id=workId,ownerId=owner.toString(),title="작품")))
        assertThrows(WorldConflict::class.java) { service.prepareUpdate(UUID.randomUUID(),workId,owner,ManuscriptBuildRequest(worldId,"publish:ev-1",true),ManuscriptBuildInput(sources)) }
        verify(jobs,never()).saveAndFlush(any(ManuscriptBuildJob::class.java))
    }
    @Test fun `freezing an update skips the episodes the world already has and is refused while the feature is off`() {
        `when`(snapshot.readPublished(anyString(),anyWanted())).thenReturn(ManuscriptBuildInput(sources.takeLast(1)))
        assertEquals(ManuscriptBuildInput(sources.takeLast(1)),service.freezeUpdate(workId,setOf(1,2)))
        val wanted=ArgumentCaptor.forClass(Function1::class.java)
        verify(snapshot).readPublished(eq(workId) ?: workId,wanted.capture() as? ((Int)->Boolean) ?: { _:Int -> true })
        @Suppress("UNCHECKED_CAST") val pick=wanted.value as (Int)->Boolean
        assertEquals(listOf(false,false,true),listOf(1,2,6).map(pick))

        `when`(snapshot.readPublished(anyString(),anyWanted())).thenReturn(null)
        assertNull(service.freezeUpdate(workId,emptySet()))

        val disabled=ManuscriptBuildService(access,works,links,studio,snapshot,execution,resultStore,jobs,results,steps,worlds,manager,mapper,false)
        assertEquals(503,assertThrows(ContentFailure::class.java) { disabled.freezeUpdate(workId,emptySet()) }.status)
    }
    @Test fun `an update job the AI never received is failed through the execution`() {
        val id=UUID.randomUUID()
        service.failQueued(id,owner,"AI_INTAKE_FAILED")
        verify(execution).failQueued(id,owner,"AI_INTAKE_FAILED")
    }
}
