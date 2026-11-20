package ai.storyfork.content.world

import ai.storyfork.content._common.exception.ContentFailure
import ai.storyfork.content.work.entity.WorkEntity
import ai.storyfork.content.work.repository.WorkRepository
import ai.storyfork.content.work.service.WorkAccessService
import ai.storyfork.content.work.service.WorkWorldService
import ai.storyfork.content.work.service.dto.WorkAccessResult
import ai.storyfork.content.world.domain.WorldConflict
import ai.storyfork.content.world.service.*
import ai.storyfork.content.world.service.dto.*
import ai.storyfork.content.world.studio.entity.ManuscriptBuildJob
import ai.storyfork.content.world.studio.entity.ManuscriptBuildResult
import ai.storyfork.content.world.studio.entity.StudioWorld
import ai.storyfork.content.world.studio.repository.*
import java.time.Instant
import java.util.Optional
import java.util.UUID
import org.junit.jupiter.api.Assertions.*
import org.junit.jupiter.api.Test
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
    private fun job(status:String,token:UUID?=null):ManuscriptBuildJob {
        val manifest=mapOf("basis" to json(emptyDraft),"episodes" to sources.map { mapOf("number" to it.number,"episodeId" to it.episodeId,
            "versionId" to it.versionId,"title" to it.title,"body" to it.body,"sourceHash" to it.hash) })
        return ManuscriptBuildJob(workId=workId,worldId=worldId,ownerSubject=owner,requestKey="key-1",requestHash="a".repeat(64),
            manifest=manifest,status=status,executionToken=token,deadline=token?.let { Instant.now().plusSeconds(60) }).also { job ->
            `when`(jobs.worldId(job.id)).thenReturn(worldId)
            `when`(worlds.lockOwned(worldId,owner)).thenReturn(StudioWorld(id=worldId,ownerSubject=owner))
            `when`(jobs.lock(job.id)).thenReturn(job)
            `when`(jobs.findById(job.id)).thenReturn(Optional.of(job))
            `when`(jobs.existsById(job.id)).thenReturn(true)
        }
    }
    private fun saved(job:ManuscriptBuildJob,kind:String,episode:Int,content:Map<String,Any?>)=ManuscriptBuildResult(jobId=job.id,kind=kind,episode=episode,content=content,contentHash="b".repeat(64))

    /** 추출·정체·구조화 결과가 모두 저장된 실행 중 작업이다. 각 시험은 적재 직전 전제 하나만 바꾼다. */
    private fun readyToLoad():Pair<ManuscriptBuildJob,UUID> {
        val token=UUID.randomUUID()
        val job=job("running",token)
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
            saved(job,"extraction",1,mapOf("skipped" to mapOf("INVALID_OR_AMBIGUOUS_QUOTE" to 2,"SEMANTIC_TYPE_CONFLICT" to 1))),
            saved(job,"extraction",2,mapOf("skipped" to emptyMap<String,Int>())),
            saved(job,"extraction",3,mapOf("number" to 3)),
            saved(job,"identity",0,mapOf("skipped" to mapOf("IGNORED" to 9)))))
        val response=service.status(job.id,owner)!!
        assertEquals(3,response.skippedItems)
        assertEquals(3,response.completedEpisodes)
    }
}
