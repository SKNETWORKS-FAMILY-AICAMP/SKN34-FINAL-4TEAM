package ai.storyfork.content.proposal

import ai.storyfork.content._common.exception.ContentFailure
import ai.storyfork.content.context.service.ContextService
import ai.storyfork.content.context.service.dto.*
import ai.storyfork.content.proposal.client.*
import ai.storyfork.content.proposal.entity.*
import ai.storyfork.content.proposal.repository.*
import ai.storyfork.content.proposal.service.AiRunService
import ai.storyfork.content.proposal.service.dto.*
import ai.storyfork.content.work.service.WorkAccessService
import ai.storyfork.content.work.service.dto.WorkAccessResult
import org.junit.jupiter.api.Assertions.*
import org.junit.jupiter.api.BeforeEach
import org.junit.jupiter.api.Test
import org.mockito.Mockito.*
import org.springframework.transaction.PlatformTransactionManager
import org.springframework.transaction.support.SimpleTransactionStatus
import org.springframework.transaction.support.TransactionTemplate
import tools.jackson.module.kotlin.jacksonMapperBuilder
import java.util.Optional
import ai.storyfork.content.proposal.client.dto.AiRunDispatchRequest
import ai.storyfork.content.proposal.client.dto.*
import ai.storyfork.content.proposal.service.AiRunGrantService
import ai.storyfork.content.episode.repository.EpisodeRepository
import ai.storyfork.content.episode.entity.EpisodeEntity

internal fun dispatchFixture()=AiRunDispatchRequest("r","t","grant","ask",listOf(AiRunSourceRef("w","draft","e","0")),AiRunBudget(1),"w",null,1)

/** DB·HTTP 없이 공개 Run의 인가·멱등·dispatch 경계를 검증한다. */
class AiRunServiceTest {
    private val access=mock(WorkAccessService::class.java)
    private val context=mock(ContextService::class.java)
    private val runs=mock(AiRunRepository::class.java)
    private val threads=mock(AiThreadRepository::class.java)
    private val jobs=mock(AiJobRepository::class.java)
    private val client=mock(AiRunClient::class.java)
    private val manager=mock(PlatformTransactionManager::class.java)
    private val signer=AiRunGrantService("fixture-grant-secret-at-least-32-characters")
    private val episodes=mock(EpisodeRepository::class.java)
    private val service=AiRunService(access,context,runs,threads,jobs,client,
        TransactionTemplate(manager),jacksonMapperBuilder().build(),signer,episodes)
    private val rows=mutableMapOf<String,AiRunEntity>()
    private val conversations=mutableMapOf<String,AiThreadEntity>()
    private val jobRows=mutableMapOf<String,AiJobEntity>()
    private fun input()=AiRunRequest(operation="ask",prompt="질문",target=AiRunTarget(1,baseRevision=0),
        options=AiRunOptions(ModelConsent(listOf("openai"),"ask",1,"notice-v1")))
    private fun anyDispatch()=any(AiRunDispatchRequest::class.java) ?: dispatchFixture()

    @BeforeEach fun setup() {
        `when`(manager.getTransaction(any())).thenAnswer { SimpleTransactionStatus() }
        `when`(episodes.findByWorkIdAndSequence("w",1)).thenReturn(EpisodeEntity("episode","w",1))
        `when`(access.own("w","owner")).thenReturn(WorkAccessResult("w","owner","제목","",0,"world","private",false,false,null))
        `when`(context.read("w","owner",ContextRequest(1,"",""))).thenReturn(
            StoryContextResponse("제목","",1,"",emptyList(),"비밀 원고",emptyList(),SelectionResponse(0,0)))
        `when`(runs.saveAndFlush(any(AiRunEntity::class.java))).thenAnswer { invocation ->
            (invocation.arguments[0] as AiRunEntity).also { rows[it.id]=it }
        }
        `when`(runs.findById(anyString())).thenAnswer { Optional.ofNullable(rows[it.arguments[0]]) }
        `when`(runs.findByRequesterIdAndWorkIdAndOperationAndKeyHash(anyString(),anyString(),anyString(),anyString()))
            .thenAnswer { i -> rows.values.find { it.requesterId==i.arguments[0] && it.workId==i.arguments[1]
                && it.operation==i.arguments[2] && it.keyHash==i.arguments[3] } }
        `when`(threads.saveAndFlush(any(AiThreadEntity::class.java))).thenAnswer { i ->
            (i.arguments[0] as AiThreadEntity).also { conversations[it.id]=it }
        }
        `when`(threads.findById(anyString())).thenAnswer { Optional.ofNullable(conversations[it.arguments[0]]) }
        `when`(jobs.saveAndFlush(any(AiJobEntity::class.java))).thenAnswer { i ->
            (i.arguments[0] as AiJobEntity).also {jobRows[it.id]=it}
        }
        `when`(jobs.findById(anyString())).thenAnswer {Optional.ofNullable(jobRows[it.arguments[0]])}
        doThrow(AiRunDispatchException(AiRunFailure.AI_RUN_UNCONFIGURED)).`when`(client).dispatch(anyDispatch())
    }

    @Test fun `same key and body reuse one committed run and never dispatch twice`() {
        val first=service.create("w","owner","key",input())
        val second=service.create("w","owner","key",input())
        assertEquals(first,second)
        assertEquals("failed",second.status)
        assertEquals("AI_RUN_UNCONFIGURED",second.error?.code)
        assertEquals("blocked",rows.getValue(first.runId).dispatchStatus)
        verify(client,times(1)).dispatch(anyDispatch())
        val order=inOrder(manager,client)
        order.verify(manager).commit(any())
        order.verify(client).dispatch(anyDispatch())
        assertEquals("",jobRows.getValue(first.runId).requestText)
        assertEquals(64,rows.getValue(first.runId).requestHash.length)
    }

    @Test fun `changed payload conflicts without another dispatch`() {
        service.create("w","owner","key",input())
        assertEquals(409,assertThrows(ContentFailure::class.java) {
            service.create("w","owner","key",input().copy(prompt="다른 질문"))
        }.status)
        verify(client,times(1)).dispatch(anyDispatch())
    }

    @Test fun `ownership failure precedes context persistence and dispatch`() {
        doThrow(ContentFailure(404,"없음")).`when`(access).own("w","other")
        assertEquals(404,assertThrows(ContentFailure::class.java) { service.create("w","other","key",input()) }.status)
        verifyNoInteractions(context,runs,threads,jobs,client)
    }

    @Test fun `missing consent max calls key or unauthorized fork never dispatch`() {
        val bad=listOf(input().copy(options=AiRunOptions()),
            input().copy(options=AiRunOptions(ModelConsent(listOf("openai"),"ask",0,"v1"))),
            input().copy(options=AiRunOptions(ModelConsent(listOf("other"),"ask",1,"v1"))),
            input().copy(options=AiRunOptions(ModelConsent(listOf("openai"),"edit",1,"v1"))),
            input().copy(target=AiRunTarget(1,"foreign",baseRevision=0)),input().copy(target=AiRunTarget(0,baseRevision=0)))
        for (request in bad) assertEquals(422,assertThrows(ContentFailure::class.java) {
            service.create("w","owner","key",request)
        }.status)
        assertEquals(422,assertThrows(ContentFailure::class.java) { service.create("w","owner",null,input()) }.status)
        verifyNoInteractions(client,jobs)
    }

    @Test fun `another subjects or works thread is hidden before dispatch`() {
        conversations["foreign"]=AiThreadEntity(id="foreign",requesterId="other",workId="w")
        assertEquals(404,assertThrows(ContentFailure::class.java) {
            service.create("w","owner","key",input().copy(threadId="foreign"))
        }.status)
        verifyNoInteractions(client,jobs)
    }

    @Test fun `refusal and internal failures remain distinct safe terminal states`() {
        for ((failure,status) in listOf(AiRunFailure.AI_RUN_REFUSED to "denied",AiRunFailure.AI_RUN_TIMEOUT to "failed")) {
            doThrow(AiRunDispatchException(failure)).`when`(client).dispatch(anyDispatch())
            val result=service.create("w","owner",failure.name,input())
            assertEquals(status,result.status)
            assertEquals(failure.name,result.error?.code)
        }
        verify(context,times(4)).read("w","owner",ContextRequest(1,"",""))
    }

    @Test fun `run status always rechecks current owner and work binding`() {
        val first=service.create("w","owner","key",input())
        doThrow(ContentFailure(404,"없음")).`when`(access).own("w","other")
        assertEquals(404,assertThrows(ContentFailure::class.java) { service.read("w","other",first.runId) }.status)
        assertEquals(first,service.read("w","owner",first.runId))
    }

    @Test fun `default client cannot send actual manuscript or call a model`() {
        assertEquals(AiRunFailure.AI_RUN_UNCONFIGURED,assertThrows(AiRunDispatchException::class.java) {
            AiRunClient(org.springframework.web.client.RestClient.builder().build(),"").dispatch(dispatchFixture())
        }.failure)
    }

    @Test fun `valid grant verifies but substituted work budget and target fail before context lookup`() {
        val result=service.create("w","owner","key",input())
        val captor=org.mockito.ArgumentCaptor.forClass(AiRunDispatchRequest::class.java)
        verify(client).dispatch(captor.capture() ?: dispatchFixture())
        val payload=captor.value
        val before=mockingDetails(context).invocations.size
        for (changed in listOf(payload.copy(workId="foreign"),payload.copy(budget=AiRunBudget(20)),payload.copy(targetRefs=emptyList()))) {
            assertEquals(403,assertThrows(ContentFailure::class.java) {service.verifyGrant(result.runId,changed)}.status)
        }
        assertEquals(before,mockingDetails(context).invocations.size)
        assertEquals(rows.getValue(result.runId).scopeHash,service.verifyGrant(result.runId,payload).scopeRef)
        val encoded=jacksonMapperBuilder().build().writeValueAsString(payload)
        assertFalse(encoded.contains("비밀 원고"))
        assertTrue(encoded.contains("work_id"))
    }

    @Test fun `accepted real run polls status without dispatching again`() {
        doAnswer {i -> (i.arguments[0] as AiRunDispatchRequest).let {
            AiRunRemoteResponse(it.runId,it.threadRef,"pending",false)
        }}.`when`(client).dispatch(anyDispatch())
        val first=service.create("w","owner","key",input())
        assertEquals("pending",first.status)
        doAnswer {i -> (i.arguments[0] as AiRunDispatchRequest).let {
            AiRunRemoteResponse(it.runId,it.threadRef,"failed",false,AiRunRemoteError("dependency_unavailable"))
        }}.`when`(client).status(anyDispatch())
        val result=service.read("w","owner",first.runId)
        assertEquals("AI_RUN_EXECUTOR_UNAVAILABLE",result.error?.code)
        verify(client,times(1)).dispatch(anyDispatch())
        verify(client,times(1)).status(anyDispatch())
    }

    @Test fun `terminal state is not replaced by a late pending response`() {
        doAnswer {i -> (i.arguments[0] as AiRunDispatchRequest).let {
            AiRunRemoteResponse(it.runId,it.threadRef,"pending",false)
        }}.`when`(client).dispatch(anyDispatch())
        val first=service.create("w","owner","key",input())
        doAnswer {i -> (i.arguments[0] as AiRunDispatchRequest).let {
            rows.getValue(it.runId).apply {status="failed";errorCode="AI_RUN_EXECUTOR_UNAVAILABLE"}
            AiRunRemoteResponse(it.runId,it.threadRef,"pending",false)
        }}.`when`(client).status(anyDispatch())
        assertEquals("failed",service.read("w","owner",first.runId).status)
    }
}
