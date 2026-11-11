package ai.storyfork.content.proposal.service

import ai.storyfork.content._common.exception.*
import ai.storyfork.content._common.helper.*
import ai.storyfork.content.context.service.ContextService
import ai.storyfork.content.context.service.dto.*
import ai.storyfork.content.episode.repository.EpisodeRepository
import ai.storyfork.content.episode.service.EpisodeService
import ai.storyfork.content.episode.service.dto.*
import ai.storyfork.content.episode_version.service.EpisodeVersionService
import ai.storyfork.content.proposal.client.dto.AiRunSourceRef
import ai.storyfork.content.proposal.domain.ChangeSetPolicy.hash
import ai.storyfork.content.proposal.domain.ChangeSetPolicy.documentHash
import ai.storyfork.content.proposal.domain.ChangeSetPolicy.quote
import ai.storyfork.content.proposal.entity.*
import ai.storyfork.content.proposal.repository.*
import ai.storyfork.content.proposal.service.dto.*
import ai.storyfork.content.work.service.WorkAccessService
import org.springframework.beans.factory.annotation.Qualifier
import org.springframework.stereotype.Service
import org.springframework.transaction.annotation.Propagation
import org.springframework.transaction.annotation.Transactional
import org.springframework.transaction.support.TransactionTemplate
import tools.jackson.databind.json.JsonMapper
import java.time.Instant

/** 기존 accept와 분리된 불변 제안 계약. 모든 결정과 PG 저장은 기존 작품 잠금 아래 한 transaction이다. */
@Service
@Transactional(transactionManager="contentTransactionManager",propagation=Propagation.NEVER)
class ChangeProposalService(
    private val access: WorkAccessService,
    private val context: ContextService,
    private val runs: AiRunRepository,
    private val threads: AiThreadRepository,
    private val proposals: ChangeProposalVersionRepository,
    private val receipts: ChangeProposalReceiptRepository,
    private val attempts: ChangeDecisionAttemptRepository,
    private val episodes: EpisodeService,
    private val episodeRows: EpisodeRepository,
    private val saved: EpisodeVersionService,
    @Qualifier("contentTransactions") private val transaction: TransactionTemplate,
    private val mapper: JsonMapper,
    private val progress: AiRunProgressService,
) {
    private val fields=listOf("title","body")

    /** 신뢰된 Content 호출자가 준비한다. AI·공개 요청이 직접 real 표시를 지정하는 경로는 없다. */
    fun prepare(workId: String,actor: String,key: String?,data: PrepareChangeSetRequest): ChangeSetResponse = transaction.execute {
        val work=access.own(workId,actor)
        validKey(key)
        val run=runs.findById(data.runId).orElse(null)
        checkContent(run!=null && run.workId==workId && run.requesterId==actor,404,"작업을 찾을 수 없어요.")
        checkContent(run!!.status!="cancelled",409,"취소한 작업에는 제안을 준비할 수 없어요.")
        val fork=if(work.source==null) null else workId
        checkContent(data.forkId==fork,message="작품과 Fork 범위를 확인해 주세요.")
        val requestHash=hash(mapper.writeValueAsString(data))
        val previous=proposals.findByRunIdAndKeyHash(data.runId,hash(key!!))
        if(previous!=null) {
            checkContent(previous.requestHash==requestHash,409,"같은 키에 다른 제안이 연결되어 있어요.")
            return@execute response(previous)
        }
        access.requireRevision(work,data.baseVersion)
        checkContent(work.revision<=Int.MAX_VALUE-40,409,"편집 번호 한도에 도달했어요.")
        val selected=scope(workId,actor,run,fork,data.baseVersion)
        validateEvidence(data.evidence,run,selected,workId,actor)
        planned(data.operations,data.evidence,run,workId,actor)
        val prior=data.previous?.let {ref ->
            val row=version(workId,ref.proposalId,ref.proposalVersion)
            checkContent(row.runId==run.id && row.proposalHash==ref.proposalHash && latest(row),409,"최신 제안 판을 확인해 주세요.")
            checkContent(receipts.findByProposalIdAndProposalVersion(row.proposalId,row.proposalVersion)?.decision
                in listOf(null,"revision_requested"),409,"이미 종료한 제안이에요.")
            row
        }
        val id=prior?.proposalId ?: contentId()
        checkContent(prior==null || prior.proposalVersion<Int.MAX_VALUE,409,"제안 판 한도에 도달했어요.")
        val manifest=ChangeSet(id,(prior?.proposalVersion ?: 0)+1,run.id,workId,fork,data.baseVersion,
            data.operations.map {it.target},data.operations,data.evidence,data.isMock,key)
        val json=mapper.writeValueAsString(manifest)
        val prepared=proposals.saveAndFlush(ChangeProposalVersionEntity(contentId(),id,manifest.proposalVersion,workId,
            run.id,json,hash(json),hash(key),requestHash))
        progress.state(run,"awaiting_approval",AiRunOutcome(proposalId=id,isMock=data.isMock))
        runs.saveAndFlush(run)
        response(prepared)
    }

    fun read(workId: String,actor: String,proposalId: String,proposalVersion: Int? = null): ChangeSetResponse = transaction.execute {
        access.own(workId,actor)
        val row=if(proposalVersion==null) proposals.findFirstByProposalIdOrderByProposalVersionDesc(proposalId)
            else proposals.findByProposalIdAndProposalVersion(proposalId,proposalVersion)
        checkContent(row!=null && row.workId==workId,404,"제안을 찾을 수 없어요.")
        response(row!!)
    }

    fun receipt(workId: String,actor: String,proposalId: String,proposalVersion: Int): ChangeReceipt = transaction.execute {
        access.own(workId,actor)
        version(workId,proposalId,proposalVersion)
        val receipt=receipts.findByProposalIdAndProposalVersion(proposalId,proposalVersion)
            ?: throw ContentFailure(404,"아직 결정한 제안이 아니에요.")
        mapper.readValue(receipt.receiptJson,ChangeReceipt::class.java)
    }

    /** 판·hash·결정과 선택 기준 판본만 받는다. 변경 payload와 허용 필드는 서버 저장 판으로 고정한다. */
    fun decide(workId: String,proposalId: String,actor: String,key: String?,data: ChangeDecisionRequest): ChangeReceipt {
        transaction.executeWithoutResult {
            access.own(workId,actor)
            validKey(key)
            checkContent(data.proposalVersion>0 && data.proposalHash.matches(Regex("[0-9a-f]{64}")) &&
                data.decision in listOf("approved","rejected","revision_requested","cancelled"),message="결정할 판·hash·상태를 확인해 주세요.")
            val known=proposals.findFirstByProposalIdOrderByProposalVersionDesc(proposalId)
            checkContent(known!=null && known.workId==workId,404,"제안을 찾을 수 없어요.")
            val requestHash=hash(proposalId+":"+mapper.writeValueAsString(data))
            val old=attempts.findByWorkIdAndActorIdAndKeyHash(workId,actor,hash(key!!))
            checkContent(old==null || old.requestHash==requestHash,409,"같은 키에 다른 결정이 연결되어 있어요.")
            if(old==null) attempts.saveAndFlush(ChangeDecisionAttemptEntity(contentId(),workId,actor,hash(key),requestHash))
        }
        return try { applyDecision(workId,proposalId,actor,key!!,data) }
        catch(error: RuntimeException) {
            // 실패한 원고 transaction은 이미 rollback됐다. 같은 키의 성공이 먼저 커밋됐으면 그 영수증으로 수렴한다.
            transaction.execute {
                access.own(workId,actor)
                val receipt=receipts.findByWorkIdAndActorIdAndKeyHash(workId,actor,hash(key!!))
                if(receipt!=null) return@execute Result.success(mapper.readValue(receipt.receiptJson,ChangeReceipt::class.java))
                val attempt=attempts.findByWorkIdAndActorIdAndKeyHash(workId,actor,hash(key))!!
                if(attempt.status!="failed") {
                    attempt.status="failed"
                    attempt.failureStatus=if(error is ContentFailure) error.status else 503
                    attempt.failureReason=if(error is ContentFailure) error.message else "변경 저장에 실패했어요. 원고는 반영하지 않았어요."
                    attempts.saveAndFlush(attempt)
                }
                Result.failure<ChangeReceipt>(ContentFailure(attempt.failureStatus!!,attempt.failureReason!!))
            }.getOrThrow()
        }
    }

    private fun applyDecision(workId: String,proposalId: String,actor: String,key: String,data: ChangeDecisionRequest): ChangeReceipt = transaction.execute {
        val work=access.own(workId,actor)
        val attempt=attempts.findByWorkIdAndActorIdAndKeyHash(workId,actor,hash(key))!!
        if(attempt.status=="failed") throw ContentFailure(attempt.failureStatus!!,attempt.failureReason!!)
        val requestHash=hash(proposalId+":"+mapper.writeValueAsString(data))
        val replay=receipts.findByWorkIdAndActorIdAndKeyHash(workId,actor,hash(key))
        if(replay!=null) {
            checkContent(replay.requestHash==requestHash,409,"같은 키에 다른 결정이 연결되어 있어요.")
            return@execute mapper.readValue(replay.receiptJson,ChangeReceipt::class.java)
        }
        val row=proposals.findByProposalIdAndProposalVersion(proposalId,data.proposalVersion)
            ?: throw ContentFailure(409,"최신 제안 판을 확인해 주세요.")
        checkContent(row.workId==workId,404,"제안을 찾을 수 없어요.")
        val manifest=manifest(row)
        checkContent(row.proposalHash==data.proposalHash && latest(row),409,"최신 제안 판과 hash를 확인해 주세요.")
        data.baseVersions?.let { bases ->
            checkContent(bases.size==manifest.affectedDocuments.size && bases.map {it.targetId}.distinct().size==bases.size &&
                bases.associate {it.targetId to it.baseVersion}==manifest.affectedDocuments.associate {it.id to it.baseVersion},
                409,"승인할 모든 대상의 기준 판본을 확인해 주세요.")
        }
        checkContent(manifest.forkId==if(work.source==null) null else workId,message="Fork 범위가 변경됐어요.")
        checkContent(receipts.findByProposalIdAndProposalVersion(proposalId,data.proposalVersion)==null,409,"이미 결정한 제안이에요.")
        val result=if(data.decision=="approved") {
            checkContent(!manifest.isMock && manifest.evidence.none {it.isMock},message="Mock 근거 제안은 실제 원고에 적용할 수 없어요.")
            access.requireRevision(work,manifest.baseVersion)
            checkContent(work.revision<=Int.MAX_VALUE-40,409,"편집 번호 한도에 도달했어요.")
            val run=runs.findById(manifest.runId).orElseThrow {ContentFailure(409,"작업을 확인할 수 없어요.")}
            val selected=scope(workId,actor,run,manifest.forkId,manifest.baseVersion)
            validateEvidence(manifest.evidence,run,selected,workId,actor)
            // 전 대상의 권한·판·hash·span·이미지 참조 검증을 끝낸 뒤 첫 쓰기를 시작한다.
            planned(manifest.operations,manifest.evidence,run,workId,actor).map { (op,change) ->
                val revision=if(op.op=="create") episodes.create(workId,actor,CreateEpisodeRequest(change.title)).draft.revision else change.revision
                val result=saved.save(workId,actor,op.target.episode,change.copy(revision=revision))
                val version=result.versions.singleOrNull {it.revision==result.draft.revision && it.body==change.body && it.title==change.title}
                    ?: throw ContentFailure(409,"저장한 결과 버전을 확인할 수 없어요.")
                checkContent(result.draft.revision==revision+1,409,"저장한 편집 번호를 확인할 수 없어요.")
                ChangeResultVersion(op.target.id,op.target.baseVersion,result.draft.revision,version.id)
            }
        } else emptyList()
        val receipt=ChangeReceipt(contentId(),proposalId,data.proposalVersion,data.proposalHash,actor,data.decision,
            if(data.decision=="approved") contentId() else null,if(data.decision=="approved") "applied" else data.decision,
            result,Instant.now().truncatedTo(java.time.temporal.ChronoUnit.MICROS).toString())
        receipts.saveAndFlush(ChangeProposalReceiptEntity(receipt.decisionId,proposalId,data.proposalVersion,workId,actor,
            data.decision,hash(key),requestHash,mapper.writeValueAsString(receipt)))
        attempt.status="succeeded"
        attempts.saveAndFlush(attempt)
        val run=runs.findById(manifest.runId).orElseThrow()
        if(run.status!="cancelled") {
            progress.state(run,receipt.outcome,AiRunOutcome(proposalId=proposalId,decisionId=receipt.decisionId,applicationId=receipt.applicationId,isMock=manifest.isMock))
            runs.saveAndFlush(run)
        }
        receipt
    }

    private fun scope(work: String,actor: String,run: AiRunEntity,fork: String?,base: Int): StoryContextResponse {
        val thread=threads.findById(run.threadId).orElse(null)
        checkContent(run.workId==work && run.requesterId==actor && run.baseRevision==base &&
            run.status !in listOf("failed","denied","cancelled") && thread!=null && thread.workId==work &&
            thread.requesterId==actor && thread.forkId==fork,409,"작업의 허용 범위가 변경됐어요.")
        val selected=context.read(work,actor,ContextRequest(run.basisEpisode,"",run.characterName))
        val episode=if(run.characterName.isEmpty()) episodeRows.findByWorkIdAndSequence(work,run.basisEpisode) else null
        checkContent(ai.storyfork.content.proposal.domain.ChangeSetPolicy.scopeHash(base,mapper.writeValueAsString(selected),episode)==run.scopeHash,409,"작업의 허용 문맥이 변경됐어요.")
        return selected
    }

    private fun validateEvidence(evidence: List<ChangeEvidence>,run: AiRunEntity,selected: StoryContextResponse,work: String,actor: String) {
        checkContent(evidence.size in 1..100 && evidence.map {it.id}.distinct().size==evidence.size,message="제안 근거를 확인해 주세요.")
        val allowed=mapper.readValue(run.targetRefsJson,Array<AiRunSourceRef>::class.java).toList()
        evidence.forEach { e ->
            checkContent(e.id.isNotBlank() && e.id.length<=200 && e.source.workId==work && e.source in allowed &&
                e.sourceHash.matches(Regex("[0-9a-f]{64}")) && e.span.end>e.span.start,409,"허용된 근거 판본·구간을 확인해 주세요.")
            val text=when(e.source.kind) {
                "draft" -> {
                    checkContent(run.characterName.isEmpty() && e.source.documentId==episodeId(work,run.basisEpisode),409,"원고 근거 범위를 확인해 주세요.")
                    val draft=episodes.read(work,actor,run.basisEpisode)
                    checkContent(draft.hasDraft && !draft.inherited && draft.draft.revision.toString()==e.source.revision &&
                        draft.draft.body==selected.draft,409,"근거 원고가 변경됐어요.")
                    quote(draft.draft.body,e.span)
                }
                "manuscript" -> {
                    val episode=selected.episodes.singleOrNull {episodeId(work,it.number)==e.source.documentId && it.versionId==e.source.revision}
                    val excerpt=episode?.excerpts?.firstOrNull {e.span.start>=it.start && e.span.end<=it.end}
                        ?: throw ContentFailure(409,"선택된 원문 근거 범위를 확인해 주세요.")
                    quote(excerpt.text,ChangeSpan(e.span.start-excerpt.start,e.span.end-excerpt.start))
                }
                else -> throw ContentFailure(422,"unsupported_evidence_scope")
            }
            checkContent(hash(text)==e.sourceHash,409,"근거 원문 hash가 변경됐어요.")
        }
    }

    private fun planned(operations: List<ChangeOperation>,evidence: List<ChangeEvidence>,run: AiRunEntity,work: String,actor: String): List<Pair<ChangeOperation,DraftRequest>> {
        checkContent(operations.all {it.target.type=="draft"},message="unsupported_atomic_scope")
        checkContent(operations.size in 1..20 && operations.map {it.target.id}.distinct().size==operations.size &&
            operations.count {it.op=="create"}<=1,message="변경 대상은 중복 없이 20개까지 선택해 주세요.")
        val refs=mapper.readValue(run.targetRefsJson,Array<AiRunSourceRef>::class.java).toList()
        return operations.map { op ->
            val target=op.target
            checkContent(target.episode>0 && target.id==episodeId(work,target.episode) && op.evidenceRefs.isNotEmpty() &&
                op.evidenceRefs.distinct().size==op.evidenceRefs.size && op.evidenceRefs.all {ref -> evidence.any {it.id==ref}},message="변경 대상과 근거를 확인해 주세요.")
            checkContent(op.fields.map {it.name}.distinct().size==op.fields.size && op.fields.all {it.name in fields},message="허용된 제목·본문 필드만 변경할 수 있어요.")
            val before=if(op.op=="create") {
                val last=episodes.list(work,actor).items.maxOfOrNull {it.number} ?: 0
                checkContent(run.operation in listOf("next_draft","expand_conti") && last<Int.MAX_VALUE && target.episode==last+1 &&
                    target.baseVersion==null && target.beforeHash==null && episodeRows.findByWorkIdAndSequence(work,target.episode)==null,
                    409,"예약한 새 회차가 이미 존재하거나 범위가 변경됐어요.")
                DraftResponse()
            } else {
                checkContent(refs.any {it.workId==work && it.documentId==target.id && it.kind in listOf("draft","manuscript")},409,"작업 대상 밖의 원고예요.")
                val current=episodes.read(work,actor,target.episode)
                checkContent(!current.inherited && current.hasDraft,403,"직접 편집 가능한 원고만 변경할 수 있어요.")
                checkContent(target.baseVersion!=null && target.baseVersion>=0 && target.baseVersion<Int.MAX_VALUE &&
                    current.draft.revision==target.baseVersion && documentHash(current.draft.title,current.draft.body)==target.beforeHash,
                    409,"기준 원고의 편집 번호 또는 hash가 변경됐어요.")
                current.draft
            }
            val values=op.fields.associate {it.name to it.value}
            val title=values["title"] ?: before.title
            val body=when(op.op) {
                "create" -> {
                    checkContent(op.span==null && op.content!=null && values.keys==setOf("title"),message="새 회차의 제목·본문을 확인해 주세요.")
                    op.content!!
                }
                "replace_span" -> {
                    checkContent(op.span!=null && op.content!=null && op.fields.isEmpty(),message="교체 구간·본문을 확인해 주세요.")
                    quote(before.body,op.span!!)
                    before.body.replaceRange(op.span.start,op.span.end,op.content!!)
                }
                "update_fields" -> {
                    checkContent(op.span==null && op.content==null && values.isNotEmpty(),message="변경할 필드를 확인해 주세요.")
                    values["body"] ?: before.body
                }
                else -> throw ContentFailure(422,"지원하지 않는 변경 연산이에요.")
            }
            checkContent(title.isNotBlank() && title.length<=120 && title==title.trim() && body.length<=40000 &&
                title.toByteArray(Charsets.UTF_8).toString(Charsets.UTF_8)==title && body.toByteArray(Charsets.UTF_8).toString(Charsets.UTF_8)==body,
                message="제목·본문 길이와 Unicode 문자를 확인해 주세요.")
            episodes.requireImageReferences(work,target.episode,body)
            op to DraftRequest(title,body,before.revision)
        }
    }

    private fun validKey(key: String?) = checkContent(key!=null && key.length in 1..200 && key.all {it.code in 33..126},message="Idempotency-Key를 확인해 주세요.")
    private fun latest(row: ChangeProposalVersionEntity) = proposals.findFirstByProposalIdOrderByProposalVersionDesc(row.proposalId)?.id==row.id
    private fun version(work: String,id: String,number: Int): ChangeProposalVersionEntity {
        val row=proposals.findByProposalIdAndProposalVersion(id,number)
        checkContent(row!=null && row.workId==work,404,"제안을 찾을 수 없어요.")
        manifest(row!!)
        return row
    }
    private fun manifest(row: ChangeProposalVersionEntity): ChangeSet {
        checkContent(hash(row.manifestJson)==row.proposalHash,409,"저장된 제안 hash를 확인할 수 없어요.")
        val manifest=mapper.readValue(row.manifestJson,ChangeSet::class.java)
        checkContent(manifest.schemaVersion==1 && manifest.proposalId==row.proposalId && manifest.proposalVersion==row.proposalVersion &&
            manifest.workId==row.workId && manifest.runId==row.runId && manifest.affectedDocuments==manifest.operations.map {it.target},409,"저장된 제안 판을 확인할 수 없어요.")
        return manifest
    }
    private fun response(row: ChangeProposalVersionEntity) = ChangeSetResponse(manifest(row),row.proposalHash,
        receipts.findByProposalIdAndProposalVersion(row.proposalId,row.proposalVersion)?.decision ?: if(latest(row)) "pending" else "superseded",fields)
}
