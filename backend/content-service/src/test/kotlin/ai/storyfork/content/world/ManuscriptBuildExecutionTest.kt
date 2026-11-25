package ai.storyfork.content.world

import ai.storyfork.content.world.service.ManuscriptBuildExecution
import ai.storyfork.content.world.service.ManuscriptBuildFinished
import org.springframework.context.ApplicationEventPublisher
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

class ManuscriptBuildExecutionTest {
    private val jobs=mock(ManuscriptBuildJobRepository::class.java)
    private val worlds=mock(StudioWorldRepository::class.java)
    private val manager=mock(PlatformTransactionManager::class.java).also {
        `when`(it.getTransaction(any())).thenAnswer { SimpleTransactionStatus() }
    }
    private val owner=UUID.randomUUID()
    private val world=UUID.randomUUID()
    private val job=ManuscriptBuildJob(workId="work",worldId=world,ownerSubject=owner,
        requestKey="initial",requestHash="a".repeat(64),manifest=mapOf("episodes" to listOf(1)))
    private val events=mock(ApplicationEventPublisher::class.java)
    private val service=ManuscriptBuildExecution(jobs,worlds,manager,events)
    private val now=Instant.parse("2026-11-17T00:00:00Z")
    init {
        `when`(jobs.worldId(job.id)).thenReturn(world)
        `when`(jobs.findById(job.id)).thenReturn(Optional.of(job))
        `when`(jobs.lock(job.id)).thenReturn(job)
        `when`(worlds.lockOwned(world,owner)).thenReturn(StudioWorld(world,owner))
    }
    @Test fun `queued job grants one execution and duplicate delivery never grants another`() {
        val token=service.claim(job.id,owner,now,now.plusSeconds(60))
        assertEquals(token,job.executionToken)
        assertEquals("running",job.status)
        assertThrows(RuntimeException::class.java) { service.claim(job.id,owner,now,now.plusSeconds(60)) }
        assertEquals(token,job.executionToken)
    }
    @Test fun `expired execution requires explicit matching previous token and old worker cannot fail resumed work`() {
        val original=service.claim(job.id,owner,now,now.plusSeconds(60))
        val later=now.plusSeconds(61)
        assertThrows(RuntimeException::class.java) { service.claim(job.id,owner,later,later.plusSeconds(60)) }
        assertThrows(RuntimeException::class.java) { service.claim(job.id,owner,later,later.plusSeconds(60),UUID.randomUUID()) }
        val resumed=service.claim(job.id,owner,later,later.plusSeconds(60),original)
        assertNotEquals(original,resumed)
        assertThrows(RuntimeException::class.java) { service.fail(job.id,owner,original,"MODEL_TIMEOUT") }
        assertEquals("running",job.status)
        service.fail(job.id,owner,resumed,"MODEL_TIMEOUT")
        assertEquals("failed",job.status)
        assertEquals("MODEL_TIMEOUT",job.failureCode)
    }
    @Test fun `loading unknown completed and wrong owner never start extraction`() {
        for(status in listOf("loading","unknown","completed")) {
            job.status=status
            assertThrows(RuntimeException::class.java) { service.claim(job.id,owner,now,now.plusSeconds(60)) }
        }
        job.status="queued"
        assertThrows(RuntimeException::class.java) { service.claim(job.id,UUID.randomUUID(),now,now.plusSeconds(60)) }
        assertThrows(IllegalArgumentException::class.java) { service.claim(job.id,owner,now,now) }
    }
    @Test fun `only a real update failure emits an event for follow-up intake`() {
        val update=ManuscriptBuildJob(workId="work",worldId=world,ownerSubject=owner,
            requestKey="update",requestHash="a".repeat(64),manifest=emptyMap(),kind="update")
        `when`(jobs.worldId(update.id)).thenReturn(world)
        `when`(jobs.lock(update.id)).thenReturn(update)
        val token=service.claim(update.id,owner,now,now.plusSeconds(60))

        assertThrows(RuntimeException::class.java) { service.fail(update.id,owner,UUID.randomUUID(),"AI_TIMEOUT") }
        verifyNoInteractions(events)
        service.fail(update.id,owner,token,"AI_TIMEOUT")
        verify(events).publishEvent(ManuscriptBuildFinished(update.id,update.lockVersion,"work",world,owner))
        assertEquals("failed",update.status)
    }

    @Test fun `an accepted job the AI never received fails without a token and a started one is left alone`() {
        service.failQueued(job.id,owner,"AI_INTAKE_FAILED")
        assertEquals("failed",job.status)
        assertEquals("AI_INTAKE_FAILED",job.failureCode)
        assertNull(job.executionToken)
        verifyNoInteractions(events)

        job.status="queued";job.failureCode=null
        val token=service.claim(job.id,owner,now,now.plusSeconds(60))
        assertThrows(RuntimeException::class.java) { service.failQueued(job.id,owner,"AI_INTAKE_FAILED") }
        assertEquals("running",job.status)
        assertEquals(token,job.executionToken)

        job.status="queued";job.executionToken=null;job.deadline=null
        assertThrows(RuntimeException::class.java) { service.failQueued(job.id,UUID.randomUUID(),"AI_INTAKE_FAILED") }
        assertThrows(IllegalArgumentException::class.java) { service.failQueued(job.id,owner,"lower case") }
        assertEquals("queued",job.status)
    }
}
