package ai.storyfork.content.proposal

import ai.storyfork.content.proposal.client.*
import ai.storyfork.content.proposal.repository.*
import ai.storyfork.content.proposal.service.AiRunService
import ai.storyfork.content.proposal.service.dto.*
import ai.storyfork.content.work.service.WorkService
import ai.storyfork.content.work.service.dto.CreateWorkRequest
import org.junit.jupiter.api.Assertions.*
import org.junit.jupiter.api.Test
import org.junit.jupiter.api.condition.EnabledIfEnvironmentVariable
import org.mockito.Mockito.*
import org.springframework.beans.factory.annotation.Autowired
import org.springframework.boot.test.context.SpringBootTest
import org.springframework.test.context.bean.override.mockito.MockitoBean
import java.util.concurrent.Callable
import java.util.concurrent.CountDownLatch
import java.util.concurrent.Executors
import java.util.concurrent.TimeUnit

/** 격리된 CI PostgreSQL에서 실제 transaction·잠금·유일 제약·dispatch 의도 보존을 확인한다. */
@EnabledIfEnvironmentVariable(named="TEST_CONTENT_DATABASE_URL",matches=".+")
@SpringBootTest(properties=["DATABASE_URL=\${TEST_CONTENT_DATABASE_URL}","DATABASE_USER=\${TEST_CONTENT_DATABASE_USER:content_test}","DATABASE_PASSWORD=\${TEST_CONTENT_DATABASE_PASSWORD:}","AI_RUN_GRANT_SECRET=fixture-grant-secret-at-least-32-characters"])
class AiRunPostgresTest {
    @Autowired lateinit var works: WorkService
    @Autowired lateinit var service: AiRunService
    @Autowired lateinit var runs: AiRunRepository
    @MockitoBean lateinit var client: AiRunClient
    @MockitoBean lateinit var auth: ai.storyfork.content.auth.client.CoreAuthClient
    @MockitoBean lateinit var generation: ai.storyfork.content.proposal.client.GenerationClient

    @Test fun `concurrent identical keys create one durable run and one dispatch`() {
        val owner="run-owner"
        val work=works.create(owner,CreateWorkRequest("Run 멱등 통합"))
        val data=AiRunRequest(operation="ask",prompt="질문",target=AiRunTarget(1,baseRevision=0),
            options=AiRunOptions(ModelConsent(listOf("openai"),"ask",1,"notice-v1")))
        doAnswer { invocation ->
            val runId=(invocation.arguments[0] as ai.storyfork.content.proposal.client.dto.AiRunDispatchRequest).runId
            assertEquals("pending",runs.findById(runId).orElseThrow().dispatchStatus)
            throw AiRunDispatchException(AiRunFailure.AI_RUN_UNCONFIGURED)
        }.`when`(client).dispatch(any(ai.storyfork.content.proposal.client.dto.AiRunDispatchRequest::class.java)
            ?: dispatchFixture())
        val start=CountDownLatch(1)
        val pool=Executors.newFixedThreadPool(2)
        try {
            val futures=(1..2).map { pool.submit(Callable {
                start.await(5,TimeUnit.SECONDS)
                service.create(work.id,owner,"same-key",data)
            }) }
            start.countDown()
            val results=futures.map {it.get(15,TimeUnit.SECONDS)}
            assertEquals(1,results.map {it.runId}.distinct().size)
            val stored=runs.findById(results.first().runId).orElseThrow()
            assertEquals("blocked",stored.dispatchStatus)
            assertEquals("failed",stored.status)
            assertEquals("AI_RUN_UNCONFIGURED",stored.errorCode)
            verify(client,times(1)).dispatch(any(ai.storyfork.content.proposal.client.dto.AiRunDispatchRequest::class.java)
                ?: dispatchFixture())
            assertEquals(1,service.thread(work.id,owner,stored.threadId,0,20).runs.size)
            assertThrows(ai.storyfork.content._common.exception.ContentFailure::class.java) {
                service.create(work.id,owner,"same-key",data.copy(prompt="다른 요청"))
            }
            assertNull(works.read(work.id,owner).draft?.body?.takeIf {it.isNotEmpty()})
        } finally {pool.shutdownNow()}
    }
}
