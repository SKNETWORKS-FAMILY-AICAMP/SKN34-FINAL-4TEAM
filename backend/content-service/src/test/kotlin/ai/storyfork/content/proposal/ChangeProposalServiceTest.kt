package ai.storyfork.content.proposal

import ai.storyfork.content._common.exception.ContentFailure
import ai.storyfork.content._common.helper.episodeId
import ai.storyfork.content.context.service.ContextService
import ai.storyfork.content.context.service.dto.*
import ai.storyfork.content.episode.repository.EpisodeRepository
import ai.storyfork.content.episode.service.EpisodeService
import ai.storyfork.content.episode.service.dto.*
import ai.storyfork.content.episode_version.service.EpisodeVersionService
import ai.storyfork.content.episode_version.service.dto.VersionResponse
import ai.storyfork.content.proposal.client.dto.AiRunSourceRef
import ai.storyfork.content.proposal.domain.ChangeSetPolicy
import ai.storyfork.content.proposal.entity.*
import ai.storyfork.content.proposal.repository.*
import ai.storyfork.content.proposal.service.ChangeProposalService
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

/** 실제 DB 없이 불변 판·멱등 결정·쓰기 전 재검증과 rollback 요청을 검사한다. */
class ChangeProposalServiceTest {
    private val access=mock(WorkAccessService::class.java)
    private val context=mock(ContextService::class.java)
    private val runs=mock(AiRunRepository::class.java)
    private val threads=mock(AiThreadRepository::class.java)
    private val proposals=mock(ChangeProposalVersionRepository::class.java)
    private val receipts=mock(ChangeProposalReceiptRepository::class.java)
    private val attempts=mock(ChangeDecisionAttemptRepository::class.java)
    private val episodes=mock(EpisodeService::class.java)
    private val episodeRows=mock(EpisodeRepository::class.java)
    private val saved=mock(EpisodeVersionService::class.java)
    private val manager=mock(PlatformTransactionManager::class.java)
    private val mapper=jacksonMapperBuilder().build()
    private val service=ChangeProposalService(access,context,runs,threads,proposals,receipts,attempts,episodes,episodeRows,saved,
        TransactionTemplate(manager),mapper)
    private val versions=mutableListOf<ChangeProposalVersionEntity>()
    private val decisions=mutableListOf<ChangeProposalReceiptEntity>()
    private val attemptRows=mutableListOf<ChangeDecisionAttemptEntity>()
    private val drafts=mutableMapOf(1 to DraftResponse("제목", "😀원고",0),2 to DraftResponse("두 번째","다음 원고",0))
    private var workRevision=0
    private lateinit var run: AiRunEntity
    private val selected=StoryContextResponse("제목","",1,"",emptyList(),"😀원고",emptyList(),SelectionResponse(0,0))
    private fun source(number: Int)=AiRunSourceRef("w","draft",episodeId("w",number),"0")
    private fun evidence()=ChangeEvidence("ev",source(1),ChangeSpan(0,2),ChangeSetPolicy.hash("😀"),false)
    private fun operation(number: Int=1)=ChangeOperation("replace_span",ChangeTarget("draft",episodeId("w",number),number,
        0,ChangeSetPolicy.documentHash(drafts.getValue(number).title,drafts.getValue(number).body)),
        span=ChangeSpan(0,if(number==1) 2 else 1),content="새",evidenceRefs=listOf("ev"))
    private fun request(operations: List<ChangeOperation> = listOf(operation()))=PrepareChangeSetRequest("run",null,0,operations,listOf(evidence()),false)
    private fun decision(proposal: ChangeSetResponse,action: String="approved")=
        ChangeDecisionRequest(proposal.changeSet.proposalVersion,proposal.proposalHash,action)
    private fun prepare(data: PrepareChangeSetRequest=request(),key: String="prepare")=service.prepare("w","owner",key,data)

    @BeforeEach fun setup() {
        `when`(manager.getTransaction(any())).thenAnswer { SimpleTransactionStatus() }
        `when`(access.own("w","owner")).thenAnswer {
            WorkAccessResult("w","owner","제목","",workRevision,"world","private",false,false,null)
        }
        `when`(context.read("w","owner",ContextRequest(1,"",""))).thenReturn(selected)
        run=AiRunEntity(id="run",threadId="thread",requesterId="owner",workId="w",operation="edit",baseRevision=0,
            targetRefsJson=mapper.writeValueAsString(listOf(source(1),source(2))),
            scopeHash=ChangeSetPolicy.hash("0:"+mapper.writeValueAsString(selected)))
        `when`(runs.findById("run")).thenReturn(Optional.of(run))
        `when`(threads.findById("thread")).thenReturn(Optional.of(AiThreadEntity("thread","owner","w")))
        `when`(proposals.findByRunIdAndKeyHash(anyString(),anyString())).thenAnswer {i ->
            versions.find {it.runId==i.arguments[0] && it.keyHash==i.arguments[1]}
        }
        `when`(proposals.findFirstByProposalIdOrderByProposalVersionDesc(anyString())).thenAnswer {i ->
            versions.filter {it.proposalId==i.arguments[0]}.maxByOrNull {it.proposalVersion}
        }
        `when`(proposals.findByProposalIdAndProposalVersion(anyString(),anyInt())).thenAnswer {i ->
            versions.find {it.proposalId==i.arguments[0] && it.proposalVersion==i.arguments[1]}
        }
        `when`(proposals.saveAndFlush(any(ChangeProposalVersionEntity::class.java))).thenAnswer {i ->
            (i.arguments[0] as ChangeProposalVersionEntity).also {versions.add(it)}
        }
        `when`(receipts.findByWorkIdAndActorIdAndKeyHash(anyString(),anyString(),anyString())).thenAnswer {i ->
            decisions.find {it.workId==i.arguments[0] && it.actorId==i.arguments[1] && it.keyHash==i.arguments[2]}
        }
        `when`(receipts.findByProposalIdAndProposalVersion(anyString(),anyInt())).thenAnswer {i ->
            decisions.find {it.proposalId==i.arguments[0] && it.proposalVersion==i.arguments[1]}
        }
        `when`(receipts.saveAndFlush(any(ChangeProposalReceiptEntity::class.java))).thenAnswer {i ->
            (i.arguments[0] as ChangeProposalReceiptEntity).also {decisions.add(it)}
        }
        `when`(attempts.findByWorkIdAndActorIdAndKeyHash(anyString(),anyString(),anyString())).thenAnswer {i ->
            attemptRows.find {it.workId==i.arguments[0] && it.actorId==i.arguments[1] && it.keyHash==i.arguments[2]}
        }
        `when`(attempts.saveAndFlush(any(ChangeDecisionAttemptEntity::class.java))).thenAnswer {i ->
            (i.arguments[0] as ChangeDecisionAttemptEntity).also {row -> if(attemptRows.none {it.id==row.id}) attemptRows.add(row)}
        }
        `when`(episodes.read((eq("w") ?: "w"),(eq("owner") ?: "owner"),anyInt())).thenAnswer {i ->
            val n=i.arguments[2] as Int
            EpisodeResponse(n,drafts.getValue(n),emptyList(),null,false,null)
        }
        `when`(saved.save((eq("w") ?: "w"),(eq("owner") ?: "owner"),anyInt(),any(DraftRequest::class.java) ?: DraftRequest("","",0)))
            .thenAnswer {i ->
                val n=i.arguments[2] as Int;val d=i.arguments[3] as DraftRequest
                drafts[n]=DraftResponse(d.title,d.body,d.revision+1);workRevision++
                EpisodeResponse(n,drafts.getValue(n),listOf(VersionResponse("version-$n",d.title,d.body,d.revision+1,n,"2026-11-10T00:00:00Z")),null,false,null)
            }
    }

    @Test fun `same preparation and approval key payload returns same version receipt and saves once`() {
        val first=prepare();assertEquals(first,prepare())
        assertEquals(listOf("title","body"),first.approvalFields)
        val receipt=service.decide("w",first.changeSet.proposalId,"owner","approve",decision(first))
        assertEquals(receipt,service.decide("w",first.changeSet.proposalId,"owner","approve",decision(first)))
        assertEquals("applied",receipt.outcome);assertEquals("새원고",drafts.getValue(1).body)
        assertEquals(1,receipt.resultVersions.single().after)
        verify(saved,times(1)).save((eq("w") ?: "w"),(eq("owner") ?: "owner"),eq(1),any(DraftRequest::class.java) ?: DraftRequest("","",0))
        assertEquals(1,versions.size);assertEquals(1,decisions.size)
    }

    @Test fun `explicit base versions are bound to idempotency and all frozen targets`() {
        val first=prepare()
        val data=decision(first).copy(baseVersions=listOf(ChangeBaseVersion(episodeId("w",1),0)))
        val receipt=service.decide("w",first.changeSet.proposalId,"owner","base-key",data)
        assertEquals(receipt,service.decide("w",first.changeSet.proposalId,"owner","base-key",data))
        assertEquals(409,assertThrows(ContentFailure::class.java) {
            service.decide("w",first.changeSet.proposalId,"owner","base-key",data.copy(baseVersions=listOf(ChangeBaseVersion(episodeId("w",1),1))))
        }.status)
        assertEquals(1,decisions.size)
        verify(saved,times(1)).save((eq("w") ?: "w"),(eq("owner") ?: "owner"),eq(1),any(DraftRequest::class.java) ?: DraftRequest("","",0))
    }

    @Test fun `missing duplicate changed or unknown base version never writes`() {
        val first=prepare()
        val correct=ChangeBaseVersion(episodeId("w",1),0)
        val bad=listOf(emptyList(),listOf(correct,correct),listOf(correct.copy(baseVersion=1)),listOf(correct.copy(targetId="other")))
        bad.forEachIndexed {index,refs ->
            assertEquals(409,assertThrows(ContentFailure::class.java) {
                service.decide("w",first.changeSet.proposalId,"owner","base-$index",decision(first).copy(baseVersions=refs))
            }.status)
        }
        verifyNoInteractions(saved)
    }

    @Test fun `legacy decision canonical JSON remains byte identical without explicit bases`() {
        assertEquals("""{"proposalVersion":1,"proposalHash":"${"a".repeat(64)}","decision":"approved"}""",
            mapper.writeValueAsString(ChangeDecisionRequest(1,"a".repeat(64),"approved")))
    }

    @Test fun `known proposal with nonexistent decision version is conflict and never writes`() {
        val first=prepare()
        assertEquals(409,assertThrows(ContentFailure::class.java) {
            service.decide("w",first.changeSet.proposalId,"owner","future",decision(first).copy(proposalVersion=2))
        }.status)
        assertEquals(409,assertThrows(ContentFailure::class.java) {
            service.decide("w",first.changeSet.proposalId,"owner","future",decision(first))
        }.status)
        verifyNoInteractions(saved)
    }

    @Test fun `changed preparation or decision payload with reused key conflicts`() {
        val first=prepare()
        assertEquals(409,assertThrows(ContentFailure::class.java) {
            prepare(request(listOf(operation().copy(content="다른"))))
        }.status)
        service.decide("w",first.changeSet.proposalId,"owner","decision",decision(first,"rejected"))
        assertEquals(409,assertThrows(ContentFailure::class.java) {
            service.decide("w",first.changeSet.proposalId,"owner","decision",decision(first))
        }.status)
        verifyNoInteractions(saved)
    }

    @Test fun `tampered version hash or payload never writes`() {
        val first=prepare()
        assertEquals(409,assertThrows(ContentFailure::class.java) {
            service.decide("w",first.changeSet.proposalId,"owner","bad",decision(first).copy(proposalHash="0".repeat(64)))
        }.status)
        val row=versions.single();versions[0]=ChangeProposalVersionEntity(id=row.id,proposalId=row.proposalId,
            proposalVersion=row.proposalVersion,workId=row.workId,runId=row.runId,manifestJson=row.manifestJson.replace("새", "변조"),
            proposalHash=row.proposalHash,keyHash=row.keyHash,requestHash=row.requestHash)
        assertEquals(409,assertThrows(ContentFailure::class.java) {
            service.decide("w",first.changeSet.proposalId,"owner","tamper",decision(first))
        }.status)
        verifyNoInteractions(saved)
    }

    @Test fun `new immutable version supersedes old one and exactly one final decision wins`() {
        val first=prepare()
        val next=prepare(request().copy(previous=ChangeVersionRef(first.changeSet.proposalId,1,first.proposalHash)),"revise")
        assertEquals(2,next.changeSet.proposalVersion);assertEquals(2,versions.size)
        assertEquals(409,assertThrows(ContentFailure::class.java) {
            service.decide("w",first.changeSet.proposalId,"owner","old",decision(first))
        }.status)
        service.decide("w",next.changeSet.proposalId,"owner","cancel",decision(next,"cancelled"))
        assertEquals(409,assertThrows(ContentFailure::class.java) {
            service.decide("w",next.changeSet.proposalId,"owner","late",decision(next))
        }.status)
        verifyNoInteractions(saved)
    }

    @Test fun `stale revision body hash evidence or permission rejects before first write`() {
        val first=prepare()
        drafts[2]=drafts.getValue(2).copy(revision=1)
        val second=prepare(request(listOf(operation(),operation(2).copy(target=operation(2).target.copy(baseVersion=1)))),"two")
        drafts[2]=drafts.getValue(2).copy(body="동시 변경")
        assertEquals(409,assertThrows(ContentFailure::class.java) {
            service.decide("w",second.changeSet.proposalId,"owner","stale",decision(second))
        }.status)
        doThrow(ContentFailure(404,"없음")).`when`(access).own("w","other")
        assertEquals(404,assertThrows(ContentFailure::class.java) {
            service.decide("w",first.changeSet.proposalId,"other","private",decision(first))
        }.status)
        verifyNoInteractions(saved)
    }

    @Test fun `mock evidence unsupported stores fields and surrogate split are refused`() {
        val unsupported=operation().copy(target=operation().target.copy(type="neo4j"))
        assertEquals("unsupported_atomic_scope",assertThrows(ContentFailure::class.java) {prepare(request(listOf(operation(),unsupported)))}.message)
        val invalid=listOf(operation().copy(span=ChangeSpan(1,2)),operation().copy(op="update_fields",span=null,content=null,
            fields=listOf(ChangeField("visibility","public"))))
        for (op in invalid) assertThrows(ContentFailure::class.java) {prepare(request(listOf(op)))}
        val mock=prepare(request().copy(isMock=true,evidence=listOf(evidence().copy(isMock=true))))
        assertThrows(ContentFailure::class.java) {service.decide("w",mock.changeSet.proposalId,"owner","mock",decision(mock))}
        verifyNoInteractions(saved)
    }

    @Test fun `second document save failure requests transaction rollback and no receipt`() {
        val first=prepare(request(listOf(operation(),operation(2))))
        doThrow(IllegalStateException("fixture failure")).`when`(saved).save((eq("w") ?: "w"),(eq("owner") ?: "owner"),eq(2),any(DraftRequest::class.java) ?: DraftRequest("","",0))
        assertEquals(503,assertThrows(ContentFailure::class.java) {service.decide("w",first.changeSet.proposalId,"owner","rollback",decision(first))}.status)
        verify(manager).rollback(any());assertTrue(decisions.isEmpty())
    }

    @Test fun `failed application key cannot be rebound to a different decision`() {
        val first=prepare()
        doThrow(IllegalStateException("private fixture detail")).`when`(saved).save((eq("w") ?: "w"),(eq("owner") ?: "owner"),eq(1),any(DraftRequest::class.java) ?: DraftRequest("","",0))
        assertThrows(RuntimeException::class.java) {service.decide("w",first.changeSet.proposalId,"owner","failed-key",decision(first))}
        assertEquals(409,assertThrows(ContentFailure::class.java) {
            service.decide("w",first.changeSet.proposalId,"owner","failed-key",decision(first,"rejected"))
        }.status)
        assertTrue(decisions.isEmpty())
        val failure=assertThrows(ContentFailure::class.java) {service.decide("w",first.changeSet.proposalId,"owner","failed-key",decision(first))}
        assertEquals(503,failure.status);assertFalse(failure.message.contains("private"))
        verify(saved,times(1)).save((eq("w") ?: "w"),(eq("owner") ?: "owner"),eq(1),any(DraftRequest::class.java) ?: DraftRequest("","",0))
        assertEquals("failed",attemptRows.single().status)
    }

    @Test fun `field update and server reserved creation save new episode versions`() {
        val fields=operation().copy(op="update_fields",span=null,content=null,
            fields=listOf(ChangeField("title","바꾼 제목"),ChangeField("body","바꾼 본문")))
        val first=prepare(request(listOf(fields)))
        service.decide("w",first.changeSet.proposalId,"owner","fields",decision(first))
        assertEquals("바꾼 제목",drafts.getValue(1).title);assertEquals("바꾼 본문",drafts.getValue(1).body)

        workRevision=0;drafts[1]=DraftResponse("제목","😀원고",0);run.operation="next_draft"
        `when`(episodes.list("w","owner")).thenReturn(EpisodeListResponse(drafts.map { (n,d) ->
            EpisodeResponse(n,d,emptyList(),null,false,null)
        }))
        `when`(episodes.create("w","owner",CreateEpisodeRequest("새 제목"))).thenAnswer {
            drafts[3]=DraftResponse("새 제목","",0)
            EpisodeResponse(3,drafts.getValue(3),emptyList(),null,false,null)
        }
        val create=ChangeOperation("create",ChangeTarget("draft",episodeId("w",3),3,null,null),
            content="새 회차",fields=listOf(ChangeField("title","새 제목")),evidenceRefs=listOf("ev"))
        val next=prepare(request(listOf(create)),"create")
        val result=service.decide("w",next.changeSet.proposalId,"owner","created",decision(next))
        assertNull(result.resultVersions.single().before)
        assertEquals("새 회차",drafts.getValue(3).body)
    }

    @Test fun `evidence version hash unapproved target and malformed operations never prepare or write`() {
        val ev=evidence()
        val invalid=listOf(request().copy(evidence=listOf(ev.copy(sourceHash="0".repeat(64)))),
            request().copy(evidence=listOf(ev.copy(source=ev.source.copy(revision="old")))),
            request().copy(forkId="other"),request(listOf(operation().copy(op="delete"))),
            request(listOf(operation().copy(content="\uD800"))),
            request(listOf(operation().copy(target=operation().target.copy(id=episodeId("w",3),episode=3)))))
        for(data in invalid) assertThrows(ContentFailure::class.java) {prepare(data)}
        assertTrue(versions.isEmpty());verifyNoInteractions(saved)
    }

    @Test fun `run scope and authority changes reject approval and receipt replay`() {
        val first=prepare()
        run.scopeHash="f".repeat(64)
        assertEquals(409,assertThrows(ContentFailure::class.java) {
            service.decide("w",first.changeSet.proposalId,"owner","scope",decision(first))
        }.status)
        verifyNoInteractions(saved)
        run.scopeHash=ChangeSetPolicy.hash("0:"+mapper.writeValueAsString(selected))
        service.decide("w",first.changeSet.proposalId,"owner","reject",decision(first,"rejected"))
        doThrow(ContentFailure(404,"없음")).`when`(access).own("w","owner")
        assertEquals(404,assertThrows(ContentFailure::class.java) {
            service.decide("w",first.changeSet.proposalId,"owner","reject",decision(first,"rejected"))
        }.status)
        assertEquals(404,assertThrows(ContentFailure::class.java) {service.receipt("w","owner",first.changeSet.proposalId,1)}.status)
    }

    @Test fun `revision requested keeps old immutable version and a new pending version`() {
        val first=prepare()
        service.decide("w",first.changeSet.proposalId,"owner","revise-request",decision(first,"revision_requested"))
        val next=prepare(request(listOf(operation().copy(content="다른"))).copy(
            previous=ChangeVersionRef(first.changeSet.proposalId,1,first.proposalHash)),"new-version")
        assertEquals("revision_requested",service.read("w","owner",first.changeSet.proposalId,1).status)
        assertEquals(first.changeSet,service.read("w","owner",first.changeSet.proposalId,1).changeSet)
        assertEquals("pending",next.status);assertEquals(2,next.changeSet.proposalVersion)
        assertEquals(1,decisions.size);verifyNoInteractions(saved)
    }
}
