package ai.storyfork.content.proposal.service

import ai.storyfork.content._common.exception.*
import ai.storyfork.content.proposal.domain.ProposalTextPolicy
import ai.storyfork.content._common.helper.*
import org.springframework.stereotype.Service
import org.springframework.transaction.annotation.Transactional
import org.springframework.beans.factory.annotation.Qualifier
import org.springframework.transaction.support.TransactionTemplate
import java.time.Instant
import ai.storyfork.content.episode.repository.*
import ai.storyfork.content.episode.service.dto.*
import ai.storyfork.content.episode_version.repository.*
import ai.storyfork.content.proposal.entity.*
import ai.storyfork.content.proposal.repository.*
import ai.storyfork.content.proposal.service.dto.*
import ai.storyfork.content.context.service.dto.*
import ai.storyfork.content.proposal.client.GenerationClient
import ai.storyfork.content.proposal.client.dto.*

@Service
class ProposalService(
    private val access: ai.storyfork.content.work.service.WorkAccessService,
    private val context: ai.storyfork.content.context.service.ContextService,
    private val publication: ai.storyfork.content.publication.service.PublicationService,
    private val savedVersions: ai.storyfork.content.episode_version.service.EpisodeVersionService,
    private val episodes: EpisodeRepository,
    private val drafts: EpisodeDraftRepository,
    private val versions: EpisodeVersionRepository,
    private val jobs: AiJobRepository,
    private val calls: AiModelCallRepository,
    private val inputs: AiInputSnapshotRepository,
    private val proposals: AiProposalRepository,
    private val evidence: AiEvidenceRepository,
    private val evidenceLinks: ProposalEvidenceRepository,
    private val decisions: ProposalDecisionRepository,
    private val applications: ProposalApplicationRepository,
    private val changes: ProposalEpisodeChangeRepository,
    private val ai: GenerationClient,
    private val mapper: tools.jackson.databind.json.JsonMapper,
    @Qualifier("contentTransactions") private val transaction: TransactionTemplate,
) {

    private data class Prepared(val jobId: String,val selected: StoryContextResponse,val body: String,val target: Int)

    @Transactional(transactionManager="contentTransactionManager", propagation=org.springframework.transaction.annotation.Propagation.NEVER)
    fun propose(id: String,owner: String,data: ProposalRequest): ProposalResponse {
        checkContent(data.consent,message="OpenAI 전송과 API 비용에 동의해 주세요.")
        checkContent(data.prompt.isNotBlank() && data.prompt.length<=2000 && data.character.length<=80,message="AI 요청 범위를 확인해 주세요.")
        val prepared=transaction.execute {
            val w=access.own(id,owner);access.requireRevision(w,data.revision)
            val target=publication.nextEpisodeNumber(id)
            val selected=context.read(id,owner,ContextRequest(data.episode ?: target,data.prompt,data.character))
            val row=episodes.findByWorkIdAndSequence(id,target) ?: throw ContentFailure(409,"작성 회차를 확인할 수 없어요.")
            val body=drafts.findById(row.id).orElseThrow().content
            val job=jobs.saveAndFlush(AiJobEntity(id=contentId(),requesterId=owner,workId=id,kind="continuation",status="running",requestText=data.prompt,startedAt=Instant.now().truncatedTo(java.time.temporal.ChronoUnit.MICROS)))
            calls.saveAndFlush(AiModelCallEntity(id=job.id,jobId=job.id,sequence=1,role="writer",provider="openai",status="running",usageStatus="unreported",startedAt=Instant.now().truncatedTo(java.time.temporal.ChronoUnit.MICROS)))
            Prepared(job.id,selected,body,target)
        }
        try {
            // The paid call has no database transaction or row locks held.
            val result=ai.generate(GenerationPayload(prepared.selected,data.prompt))
            transaction.executeWithoutResult {
                val call=calls.findFirstByJobIdOrderBySequence(prepared.jobId) ?: error("Missing AI call")
                call.status="completed";call.model=result.model;call.traceRef=result.providerResponseId
                call.usageStatus=if(result.usage==null) "unreported" else "reported"
                call.inputTokens=result.usage?.inputTokens;call.outputTokens=result.usage?.outputTokens;call.finishedAt=Instant.now().truncatedTo(java.time.temporal.ChronoUnit.MICROS)
            }
            return transaction.execute {
                val w=access.own(id,owner);access.requireRevision(w,data.revision)
                checkContent(publication.nextEpisodeNumber(id)==prepared.target,409,"생성 중 대상 회차가 변경됐어요.")
                checkContent(context.read(id,owner,ContextRequest(prepared.selected.basisEpisode,data.prompt,data.character))==prepared.selected,409,"생성 중 문맥이 변경됐어요. 원고에는 반영하지 않았어요.")
                val now=Instant.now().truncatedTo(java.time.temporal.ChronoUnit.MICROS);val inputId=contentKey("input",prepared.jobId)
                val row=episodes.findByWorkIdAndSequence(id,prepared.target) ?: throw ContentFailure(409,"작성 회차가 변경됐어요.")
                inputs.saveAndFlush(AiInputSnapshotEntity(id=inputId,jobId=prepared.jobId,episodeId=row.id,sourceKind="draft",contentSnapshot=prepared.body,draftRevision=data.revision,capturedAt=now))
                proposals.saveAndFlush(AiProposalEntity(id=prepared.jobId,jobId=prepared.jobId,kind="continuation",content=result.text,createdAt=now,inputSnapshotId=inputId,sequence=1))
                val evidenceId=contentKey("evidence",prepared.jobId)
                evidence.saveAndFlush(AiEvidenceEntity(id=evidenceId,kind="context",excerptSnapshot=mapper.writeValueAsString(prepared.selected),capturedAt=now))
                evidenceLinks.saveAndFlush(ProposalEvidenceEntity(proposalId=prepared.jobId,evidenceId=evidenceId))
                jobs.findById(prepared.jobId).orElseThrow().apply {status="completed";finishedAt=now}
                history(id,owner).items.single {it.id==prepared.jobId}
            }
        } catch(error: RuntimeException) {
            transaction.executeWithoutResult {
                val code=if(error is ContentFailure && error.status==409) "STALE_CONTEXT" else "GENERATION_OR_STORAGE_FAILED"
                jobs.findById(prepared.jobId).orElseThrow().apply {status="failed";failureReason=code;finishedAt=Instant.now().truncatedTo(java.time.temporal.ChronoUnit.MICROS)}
                calls.findFirstByJobIdOrderBySequence(prepared.jobId)?.takeIf {it.status=="running"}?.apply {status="failed";failureCode=code;finishedAt=Instant.now().truncatedTo(java.time.temporal.ChronoUnit.MICROS)}
            }
            throw error
        }
    }
    @Transactional(transactionManager="contentTransactionManager")
    fun history(id: String,owner: String): ProposalListResponse {
        access.own(id,owner)
        val workJobs=jobs.findAllByWorkIdOrderByCreatedAt(id).associateBy {it.id}
        return ProposalListResponse(proposals.findAllByJobIdInOrderByCreatedAt(workJobs.keys).map {p ->
            val job=workJobs.getValue(p.jobId)
            val call=calls.findFirstByJobIdOrderBySequence(p.jobId) ?: throw ContentFailure(409,"AI 호출 기록이 누락됐어요.")
            val input=p.inputSnapshotId?.let {inputs.findById(it).orElse(null)} ?: throw ContentFailure(409,"AI 기준 원고가 누락됐어요.")
            val contextEvidence=evidenceLinks.findAllByProposalId(p.id).mapNotNull {evidence.findById(it.evidenceId).orElse(null)}.firstOrNull {it.kind=="context"}
                ?: throw ContentFailure(409,"AI 근거 문맥이 누락됐어요.")
            val applied=decisions.findAllByProposalIdOrderBySequence(p.id).flatMap {d -> applications.findAllByDecisionIdOrderByAttemptNo(d.id)}.lastOrNull {it.outcome=="applied"}
            val resultVersion=applied?.let {changes.findAllByApplicationId(it.id).singleOrNull()?.resultVersionId}?.let {versions.findById(it).orElse(null)}
            val target=input.episodeId?.let {episodes.findById(it).orElse(null)?.sequence}
            ProposalResponse(p.id,p.content,call.model ?: throw ContentFailure(409,"AI 모델 기록이 누락됐어요."),input.draftRevision ?: throw ContentFailure(409,"AI 기준 revision이 누락됐어요."),
                if(applied==null) "pending" else "accepted",job.requestText,input.contentSnapshot,mapper.readValue(contextEvidence.excerptSnapshot,StoryContextResponse::class.java),call.traceRef,
                if(call.inputTokens==null || call.outputTokens==null) null else UsageResponse(call.inputTokens!!,call.outputTokens!!),p.createdAt.toString(),target,resultVersion?.contentVersionId)
        })
    }
    @Transactional(transactionManager="contentTransactionManager")
    fun accept(id: String,pid: String,owner: String,expected: Int): DraftResponse {
        val w=access.own(id,owner);access.requireRevision(w,expected)
        val p=history(id,owner).items.find {it.id==pid && it.status=="pending" && it.revision==expected}
            ?: throw ContentFailure(409,"만료되었거나 이미 적용한 제안이에요.")
        val target=publication.nextEpisodeNumber(id)
        checkContent(p.targetEpisode==target,409,"제안의 대상 회차가 변경됐어요. 다시 생성해 주세요.")
        checkContent(context.read(id,owner,ContextRequest(p.context.basisEpisode,p.prompt,p.context.character))==p.context,409,"설정 문맥이 변경됐어요. 최신 문맥으로 검토해 주세요.")
        val row=episodes.findByWorkIdAndSequence(id,target) ?: throw ContentFailure(409,"작성 회차를 확인할 수 없어요.")
        val draft=drafts.findById(row.id).orElseThrow()
        ProposalTextPolicy.validate(p.text)
        val body=(draft.content+"\n\n"+p.text).trim()
        checkContent(body.length<=40000,message="회차 원고는 40,000자까지 저장할 수 있어요.")
        val saved=savedVersions.saveCurrent(id,owner,DraftRequest(draft.title,body,expected))
        val decision=contentKey("proposal-decision",pid);val application=contentKey("proposal-application",pid)
        val at=Instant.parse(saved.version.savedAt)
        decisions.saveAndFlush(ProposalDecisionEntity(id=decision,proposalId=pid,sequence=1,actorId=owner,decision="accept",approvedContent=p.text,decidedAt=at))
        applications.saveAndFlush(ProposalApplicationEntity(id=application,decisionId=decision,attemptNo=1,outcome="applied",attemptedAt=at))
        changes.saveAndFlush(ProposalEpisodeChangeEntity(id=contentKey("proposal-result",pid),applicationId=application,episodeId=row.id,resultVersionId=episodeVersionId(id,target,saved.version.id),beforeContent=p.baseBody,afterContent=saved.draft.body,baseDraftRevision=p.revision,resultDraftRevision=saved.draft.revision))
        return saved.draft
    }

}
