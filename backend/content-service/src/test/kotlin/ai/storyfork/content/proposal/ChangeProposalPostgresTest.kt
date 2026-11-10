package ai.storyfork.content.proposal

import ai.storyfork.content._common.exception.ContentFailure
import ai.storyfork.content._common.helper.*
import ai.storyfork.content.context.service.ContextService
import ai.storyfork.content.context.service.dto.ContextRequest
import ai.storyfork.content.episode.service.EpisodeService
import ai.storyfork.content.episode.service.dto.*
import ai.storyfork.content.episode_version.repository.EpisodeVersionRepository
import ai.storyfork.content.episode_version.service.EpisodeVersionService
import ai.storyfork.content.proposal.client.dto.AiRunSourceRef
import ai.storyfork.content.proposal.domain.ChangeSetPolicy
import ai.storyfork.content.proposal.entity.*
import ai.storyfork.content.proposal.repository.*
import ai.storyfork.content.proposal.service.ChangeProposalService
import ai.storyfork.content.proposal.service.AiRunService
import ai.storyfork.content.proposal.client.AiRunClient
import ai.storyfork.content.proposal.client.dto.AiRunDispatchRequest
import ai.storyfork.content.proposal.client.dto.AiRunRemoteResponse
import ai.storyfork.content.proposal.service.dto.*
import ai.storyfork.content.work.service.WorkAccessService
import ai.storyfork.content.work.service.WorkService
import ai.storyfork.content.work.service.dto.CreateWorkRequest
import org.junit.jupiter.api.Assertions.*
import org.junit.jupiter.api.Test
import org.junit.jupiter.api.condition.EnabledIfEnvironmentVariable
import org.junit.jupiter.params.ParameterizedTest
import org.junit.jupiter.params.provider.ValueSource
import org.mockito.Mockito.*
import org.springframework.beans.factory.annotation.Autowired
import org.springframework.beans.factory.annotation.Qualifier
import org.springframework.boot.test.context.SpringBootTest
import org.springframework.test.context.bean.override.mockito.MockitoBean
import org.springframework.test.context.bean.override.mockito.MockitoSpyBean
import org.springframework.transaction.support.TransactionTemplate
import tools.jackson.databind.json.JsonMapper
import java.util.concurrent.Callable
import java.util.concurrent.CountDownLatch
import java.util.concurrent.Executors
import java.util.concurrent.TimeUnit

/** CI 전용 격리 PG에서 실제 row lock·다중 대상 rollback·불변 판·영수증을 검증한다. */
@EnabledIfEnvironmentVariable(named="TEST_CONTENT_DATABASE_URL",matches=".+")
@SpringBootTest(properties=["DATABASE_URL=\${TEST_CONTENT_DATABASE_URL}","DATABASE_USER=\${TEST_CONTENT_DATABASE_USER:content_test}","DATABASE_PASSWORD=\${TEST_CONTENT_DATABASE_PASSWORD:}","AI_RUN_GRANT_SECRET=fixture-grant-secret-at-least-32-characters"])
class ChangeProposalPostgresTest {
    @MockitoBean lateinit var auth: ai.storyfork.content.auth.client.CoreAuthClient
    @MockitoBean lateinit var ai: ai.storyfork.content.proposal.client.GenerationClient
    @MockitoBean(name="relationshipDriver") lateinit var neo4j: org.neo4j.driver.Driver
    @Autowired lateinit var service: ChangeProposalService
    @Autowired lateinit var runService: AiRunService
    @Autowired lateinit var progressEvents: AiRunEventRepository
    @MockitoBean lateinit var runClient: AiRunClient
    @Autowired lateinit var works: WorkService
    @Autowired lateinit var access: WorkAccessService
    @Autowired lateinit var episodes: EpisodeService
    @MockitoSpyBean lateinit var saved: EpisodeVersionService
    @Autowired lateinit var versions: EpisodeVersionRepository
    @Autowired lateinit var context: ContextService
    @Autowired lateinit var runs: AiRunRepository
    @Autowired lateinit var threads: AiThreadRepository
    @Autowired lateinit var jobs: AiJobRepository
    @Autowired lateinit var attempts: ChangeDecisionAttemptRepository
    @Autowired lateinit var mapper: JsonMapper
    @Autowired @Qualifier("contentTransactions") lateinit var transaction: TransactionTemplate

    private data class Fixture(val work: String,val owner: String,val proposal: ChangeSetResponse)
    private fun fixture(two: Boolean=false): Fixture {
        val owner="change-owner-"+contentId()
        val work=works.create(owner,CreateWorkRequest("불변 제안 PG 회귀")).id
        episodes.update(work,owner,1,DraftRequest("1화","😀원고",0))
        episodes.create(work,owner,CreateEpisodeRequest("2화"))
        episodes.update(work,owner,2,DraftRequest("2화","둘째",0))
        val current=access.get(work)
        val selected=context.read(work,owner,ContextRequest(1,"",""))
        val refs=(1..2).map {n -> AiRunSourceRef(work,"draft",episodeId(work,n),episodes.read(work,owner,n).draft.revision.toString())}
        val run=transaction.execute {
            access.own(work,owner)
            val thread=threads.saveAndFlush(AiThreadEntity(id=contentId(),requesterId=owner,workId=work))
            val job=jobs.saveAndFlush(AiJobEntity(id=contentId(),requesterId=owner,workId=work,kind="run:edit",status="completed"))
            // 테스트 전용 Content scope: 공개 Run의 자동 다중 원고 조립을 구현했다는 뜻이 아니다.
            runs.saveAndFlush(AiRunEntity(id=job.id,threadId=thread.id,requesterId=owner,workId=work,operation="edit",
                keyHash=ChangeSetPolicy.hash(contentId()),requestHash=ChangeSetPolicy.hash("fixture"),
                scopeHash=ChangeSetPolicy.hash(current.revision.toString()+":"+mapper.writeValueAsString(selected)),
                baseRevision=current.revision,basisEpisode=1,targetRefsJson=mapper.writeValueAsString(refs),
                grantExpiresAt=java.time.Instant.now().plusSeconds(300),
                maxCalls=1,noticeVersion="fixture-v1",status="running"))
        }
        val ops=(if(two) 1..2 else 1..1).map {n ->
            val draft=episodes.read(work,owner,n).draft
            ChangeOperation("replace_span",ChangeTarget("draft",episodeId(work,n),n,draft.revision,
                ChangeSetPolicy.documentHash(draft.title,draft.body)),ChangeSpan(0,if(n==1) 2 else 1),"새",evidenceRefs=listOf("e"))
        }
        val data=PrepareChangeSetRequest(run.id,null,current.revision,ops,
            listOf(ChangeEvidence("e",refs[0],ChangeSpan(0,2),ChangeSetPolicy.hash("😀"),false)),false)
        return Fixture(work,owner,service.prepare(work,owner,"prepare",data))
    }
    private fun decision(f: Fixture,action: String="approved")=ChangeDecisionRequest(1,f.proposal.proposalHash,action)
    private fun count(f: Fixture)=versions.findAllByEpisodeIdInOrderByCreatedAtAscIdAsc(listOf(episodeId(f.work,1),episodeId(f.work,2))).size

    @Test fun `public run cancel and approval serialize into one durable winner`() {
        val f=fixture();val before=count(f);val runId=f.proposal.changeSet.runId
        doAnswer { i -> (i.arguments[0] as AiRunDispatchRequest).let {AiRunRemoteResponse(it.runId,it.threadRef,"cancelled",false)} }
            .`when`(runClient).cancel(any(AiRunDispatchRequest::class.java) ?: dispatchFixture())
        val start=CountDownLatch(1);val pool=Executors.newFixedThreadPool(2)
        try {
            val approval=pool.submit(Callable {start.await();runCatching {service.decide(f.work,f.proposal.changeSet.proposalId,f.owner,"approve",decision(f))}})
            val cancel=pool.submit(Callable {start.await();runCatching {runService.cancel(f.work,f.owner,runId)}})
            start.countDown()
            val results=listOf(approval.get(15,TimeUnit.SECONDS),cancel.get(15,TimeUnit.SECONDS))
            assertEquals(1,results.count {it.isSuccess},results.map {it.exceptionOrNull()?.message}.toString())
            assertEquals(409,(results.single {it.isFailure}.exceptionOrNull() as ContentFailure).status)
            val stored=runs.findById(runId).orElseThrow()
            val events=progressEvents.findAllByRunIdAndSeqGreaterThanOrderBySeqAsc(runId,0,org.springframework.data.domain.PageRequest.of(0,100))
            assertEquals((1L..stored.lastEventId).toList(),events.map {it.seq})
            if(stored.status=="applied") {
                assertEquals(before+1,count(f));assertEquals("APPLIED",events.last().code)
                assertNotNull(runService.read(f.work,f.owner,runId).result?.applicationId)
            } else {
                assertEquals("cancelled",stored.status);assertEquals(before,count(f));assertEquals("CANCELLED",events.last().code)
                assertEquals("cancelled",runService.cancel(f.work,f.owner,runId).status)
            }
        } finally {pool.shutdownNow()}
    }

    @ParameterizedTest @ValueSource(strings=["approved","cancelled","rejected","revision_requested"])
    fun `concurrent approvals cancellations and rejections have one durable winner`(other: String) {
        val f=fixture();val before=count(f)
        val start=CountDownLatch(1);val pool=Executors.newFixedThreadPool(2)
        try {
            val futures=listOf("approved",other).map {action -> pool.submit(Callable {
                start.await(5,TimeUnit.SECONDS)
                runCatching {service.decide(f.work,f.proposal.changeSet.proposalId,f.owner,action,decision(f,action))}
            })}
            start.countDown()
            val results=futures.map {it.get(30,TimeUnit.SECONDS)}
            if(other=="approved") assertEquals(results[0].getOrThrow(),results[1].getOrThrow())
            else {
                assertEquals(1,results.count {it.isSuccess})
                assertEquals(409,(results.single {it.isFailure}.exceptionOrNull() as ContentFailure).status)
            }
            val receipt=service.receipt(f.work,f.owner,f.proposal.changeSet.proposalId,1)
            assertEquals(before+if(receipt.outcome=="applied") 1 else 0,count(f))
            assertEquals(if(receipt.outcome=="applied") "새원고" else "😀원고",episodes.read(f.work,f.owner,1).draft.body)
        } finally {pool.shutdownNow()}
    }

    @Test fun `same key parallel approval replay returns one committed application and identical receipt`() {
        val f=fixture();val before=count(f)
        val data=decision(f).copy(baseVersions=f.proposal.changeSet.affectedDocuments.map {ChangeBaseVersion(it.id,it.baseVersion)})
        val start=CountDownLatch(1);val pool=Executors.newFixedThreadPool(2)
        try {
            val results=(1..2).map {pool.submit(Callable {
                start.await(5,TimeUnit.SECONDS)
                service.decide(f.work,f.proposal.changeSet.proposalId,f.owner,"same-key",data)
            })}
            start.countDown()
            val receipts=results.map {it.get(30,TimeUnit.SECONDS)}
            assertEquals(receipts[0],receipts[1]);assertNotNull(receipts[0].applicationId)
            assertEquals(before+1,count(f))
            assertEquals(409,assertThrows(ContentFailure::class.java) {
                service.decide(f.work,f.proposal.changeSet.proposalId,f.owner,"same-key",data.copy(decision="rejected"))
            }.status)
        } finally {pool.shutdownNow()}
    }

    @Test fun `version conflict is durable and its key cannot later approve another payload`() {
        val f=fixture();val before=count(f)
        assertEquals(409,assertThrows(ContentFailure::class.java) {
            service.decide(f.work,f.proposal.changeSet.proposalId,f.owner,"version-key",decision(f).copy(proposalVersion=2))
        }.status)
        assertEquals("failed",attempts.findByWorkIdAndActorIdAndKeyHash(f.work,f.owner,ChangeSetPolicy.hash("version-key"))!!.status)
        assertEquals(409,assertThrows(ContentFailure::class.java) {
            service.decide(f.work,f.proposal.changeSet.proposalId,f.owner,"version-key",decision(f))
        }.status)
        assertEquals(before,count(f));assertEquals("😀원고",episodes.read(f.work,f.owner,1).draft.body)
    }

    @Test fun `second PG target storage failure rolls back every manuscript version and final receipt`() {
        val f=fixture(true);val before=count(f)
        val runId=f.proposal.changeSet.runId
        val prior=runs.findById(runId).orElseThrow()
        val beforeEvents=prior.lastEventId
        val beforeResult=prior.resultJson
        val drafts=(1..2).map {episodes.read(f.work,f.owner,it)}
        val revision=access.get(f.work).revision
        doThrow(IllegalStateException("injected storage failure")).`when`(saved).save((eq(f.work) ?: f.work),
            (eq(f.owner) ?: f.owner),eq(2),any(DraftRequest::class.java) ?: DraftRequest("","",0))
        assertEquals(503,assertThrows(ContentFailure::class.java) {
            service.decide(f.work,f.proposal.changeSet.proposalId,f.owner,"rollback",decision(f))
        }.status)
        assertEquals(drafts,(1..2).map {episodes.read(f.work,f.owner,it)})
        assertEquals(before,count(f));assertEquals(revision,access.get(f.work).revision)
        val stored=runs.findById(runId).orElseThrow()
        assertEquals(beforeEvents,stored.lastEventId);assertEquals(beforeResult,stored.resultJson)
        assertEquals("awaiting_approval",stored.status)
        assertTrue(progressEvents.findAllByRunIdAndSeqGreaterThanOrderBySeqAsc(runId,beforeEvents,org.springframework.data.domain.PageRequest.of(0,100)).isEmpty())
        assertEquals("failed",attempts.findByWorkIdAndActorIdAndKeyHash(f.work,f.owner,ChangeSetPolicy.hash("rollback"))!!.status)
        assertEquals(404,assertThrows(ContentFailure::class.java) {service.receipt(f.work,f.owner,f.proposal.changeSet.proposalId,1)}.status)
    }

    @Test fun `concurrent editor and approval preserve one committed change without lost update`() {
        val f=fixture();val draft=episodes.read(f.work,f.owner,1).draft
        val start=CountDownLatch(1);val pool=Executors.newFixedThreadPool(2)
        try {
            val approve=pool.submit(Callable {
                start.await(5,TimeUnit.SECONDS)
                runCatching {service.decide(f.work,f.proposal.changeSet.proposalId,f.owner,"race",decision(f))}
            })
            val edit=pool.submit(Callable {
                start.await(5,TimeUnit.SECONDS)
                runCatching {episodes.update(f.work,f.owner,1,DraftRequest(draft.title,"사용자 편집",draft.revision))}
            })
            start.countDown()
            val a=approve.get(30,TimeUnit.SECONDS);val b=edit.get(30,TimeUnit.SECONDS)
            assertEquals(1,listOf(a.isSuccess,b.isSuccess).count {it})
            assertEquals(409,((a.exceptionOrNull() ?: b.exceptionOrNull()) as ContentFailure).status)
            assertEquals(if(a.isSuccess) "새원고" else "사용자 편집",episodes.read(f.work,f.owner,1).draft.body)
        } finally {pool.shutdownNow()}
    }
}
