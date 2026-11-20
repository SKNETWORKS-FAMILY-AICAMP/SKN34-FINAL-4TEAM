package ai.storyfork.content.world

import ai.storyfork.content.world.service.*
import ai.storyfork.content.world.studio.entity.*
import ai.storyfork.content.world.studio.repository.*
import java.time.Instant
import java.util.Optional
import java.util.UUID
import org.junit.jupiter.api.Assertions.*
import org.junit.jupiter.api.Test
import org.mockito.ArgumentMatchers.any
import org.mockito.Mockito.*
import org.springframework.transaction.PlatformTransactionManager
import org.springframework.transaction.support.SimpleTransactionStatus
import tools.jackson.databind.json.JsonMapper
import tools.jackson.module.kotlin.KotlinModule

class ManuscriptBuildResultStoreTest {
    private val jobs=mock(ManuscriptBuildJobRepository::class.java)
    private val results=mock(ManuscriptBuildResultRepository::class.java)
    private val worlds=mock(StudioWorldRepository::class.java)
    private val manager=mock(PlatformTransactionManager::class.java).also { `when`(it.getTransaction(any())).thenAnswer { SimpleTransactionStatus() } }
    private val mapper=JsonMapper.builder().addModule(KotlinModule.Builder().build()).build()
    private val actor=UUID.randomUUID()
    private val world=UUID.randomUUID()
    private val token=UUID.randomUUID()
    private val source=ManuscriptBuildSource(1,"episode","version","첫 만남","길동이 왔다.")
    private val job=ManuscriptBuildJob(workId="work",worldId=world,ownerSubject=actor,requestKey="first",requestHash="a".repeat(64),
        manifest=mapOf("episodes" to listOf(mapOf("number" to 1,"episodeId" to "episode","versionId" to "version","title" to source.title,"body" to source.body,"sourceHash" to source.hash))),
        status="running",executionToken=token,deadline=Instant.now().plusSeconds(600))
    private val store=ManuscriptBuildResultStore(jobs,results,worlds,manager,mapper)
    private val result=ManuscriptEpisodeResult(ManuscriptBuildResultBasis(1,"version",source.hash),listOf(ManuscriptQuote(0,source.body.length,source.body)),mapOf("deferred" to listOf("모호한 대상")))
    init {
        `when`(jobs.worldId(job.id)).thenReturn(world)
        `when`(jobs.findById(job.id)).thenReturn(Optional.of(job))
        `when`(jobs.lock(job.id)).thenReturn(job)
        `when`(worlds.lockOwned(world,actor)).thenReturn(StudioWorld(world,actor))
        `when`(results.saveAndFlush(any())).thenAnswer { it.arguments[0] }
    }
    @Test fun `same persisted result is returned without duplicate or overwriting original evidence`() {
        val saved=store.record(job.id,actor,token,result)
        `when`(results.findByJobIdAndKindAndEpisode(job.id,"extraction",1)).thenReturn(saved)
        assertEquals(saved.id,store.record(job.id,actor,token,result).id)
        verify(results,times(1)).saveAndFlush(any())
        assertThrows(RuntimeException::class.java) { store.record(job.id,actor,token,result.copy(extraction=mapOf("changed" to true))) }
    }
    @Test fun `wrong owner expired token and changed source never persist a result`() {
        assertThrows(RuntimeException::class.java) { store.record(job.id,UUID.randomUUID(),token,result) }
        assertThrows(RuntimeException::class.java) { store.record(job.id,actor,UUID.randomUUID(),result) }
        assertThrows(IllegalArgumentException::class.java) { store.record(job.id,actor,token,result.copy(basis=result.basis.copy(sourceHash="b".repeat(64)))) }
        job.deadline=Instant.EPOCH
        assertThrows(RuntimeException::class.java) { store.record(job.id,actor,token,result) }
        verify(results,never()).saveAndFlush(any())
    }
}
