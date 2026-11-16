package ai.storyfork.content.world.service

import ai.storyfork.content.world.domain.*
import ai.storyfork.content.world.service.dto.*
import ai.storyfork.content.world.studio.entity.*
import ai.storyfork.content.world.studio.repository.*
import java.security.MessageDigest
import java.util.UUID
import org.springframework.beans.factory.annotation.Qualifier
import org.springframework.stereotype.Service
import org.springframework.transaction.PlatformTransactionManager
import org.springframework.transaction.support.TransactionTemplate
import tools.jackson.databind.json.JsonMapper

/** 준비 기록은 불변이며 완료는 WorldStudioService의 마지막 PG transaction만 기록한다. */
@Service
class InitialWorldApplicationService(
    private val studio:WorldStudioService,private val reviews:InitialWorldAnalysisService,
    private val worlds:StudioWorldRepository,private val analyses:InitialWorldAnalysisRepository,
    private val candidates:InitialWorldCandidateRepository,private val applications:InitialWorldApplicationRepository,
    private val items:InitialWorldApplicationItemRepository,private val mapper:JsonMapper,
    @Qualifier("worldStudioTransactionManager") manager:PlatformTransactionManager,
) {
    private val transaction=TransactionTemplate(manager)
    private fun <T:Any> tx(action:()->T):T=transaction.execute { action() }
    private fun owned(world:UUID,actor:UUID) { if(worlds.lockOwned(world,actor)==null) throw WorldNotFound() }
    private fun analysis(world:UUID,id:UUID)=analyses.findById(id).orElseThrow { WorldNotFound() }.also { if(it.worldId!=world) throw WorldNotFound() }
    private fun receipt(row:InitialWorldApplication):InitialWorldApplicationResponse {
        val ids=items.findAllByApplicationId(row.id)
        fun generated(kind:String)=ids.filter { it.generatedKind==kind }.map { it.generatedId }.sortedBy { it.toString() }
        return InitialWorldApplicationResponse(row.id,row.status,row.baseDraftRevision,row.resultDraftRevision,generated("card"),generated("relationship"))
    }
    @Suppress("UNCHECKED_CAST")
    private fun json(value:Any)=mapper.readValue(mapper.writeValueAsBytes(value),Map::class.java) as Map<String,Any?>

    internal fun prepare(world:UUID,actor:UUID,analysisId:UUID,request:InitialWorldApplicationRequest):InitialWorldApplicationResponse {
        require(request.key.matches(Regex("[A-Za-z0-9:_-]{1,200}")))
        require(request.expectedDraftRevision in 0..9007199254740990L && request.candidates.isNotEmpty() && request.candidates.size<=1000)
        require(request.candidates.all { it.decisionSequence>0 } && request.candidates.map { it.candidateId }.distinct().size==request.candidates.size)
        val normalized=request.copy(candidates=request.candidates.sortedBy { it.candidateId.toString() })
        val hash=MessageDigest.getInstance("SHA-256").digest(mapper.writeValueAsBytes(listOf(world,analysisId,normalized)))
            .joinToString("") { "%02x".format(it.toInt() and 255) }
        fun previous():InitialWorldApplicationResponse?=applications.findByWorldIdAndRequestKey(world,request.key)?.let {
            if(it.analysisId!=analysisId || it.requestHash!=hash) throw WorldConflict()
            receipt(it)
        }
        val prior=transaction.execute { owned(world,actor);analysis(world,analysisId);previous() }
        if(prior!=null) return prior
        // Read Neo4j outside PG. The snapshot and graph revision are rechecked under the world lock below.
        val draft=studio.draft(world,actor)
        return tx {
            owned(world,actor);val analysis=analysis(world,analysisId)
            previous()?.let { return@tx it }
            if(applications.findFirstByWorldIdAndStatusIn(world,listOf("applying","unknown"))!=null) throw WorldConflict()
            if(analysis.executionStatus!="completed") throw InitialWorldReviewConflict("ANALYSIS_NOT_COMPLETED")
            val input=mapper.convertValue(analysis.inputSnapshot,InitialWorldInput::class.java)
            if(input.worldId!=world || input.analysisId!=analysisId || request.expectedDraftRevision!=analysis.draftRevision) throw WorldConflict()
            if(reviews.get(world,actor,analysisId).body.freshness!="current") throw InitialWorldReviewConflict("ANALYSIS_STALE")
            try { input.validateAgainst(draft) } catch(_:IllegalArgumentException) { throw InitialWorldReviewConflict("ANALYSIS_STALE") }
            studio.withInitialWorldInput(actor,input) {
                val history=reviews.get(world,actor,analysisId).body.decisions
                val selected=normalized.candidates.map { selection ->
                    val candidate=candidates.findById(selection.candidateId).orElseThrow { WorldNotFound() }
                    if(candidate.worldId!=world || candidate.analysisId!=analysisId) throw WorldNotFound()
                    val latest=history.filter { it.candidateId==candidate.id }.maxByOrNull { it.sequence } ?: throw WorldConflict()
                    if(latest.sequence!=selection.decisionSequence || latest.state!="approved" || items.existsByCandidateIdAndActiveTrue(candidate.id)) throw WorldConflict()
                    if(latest.candidateRef!=candidate.localRef || latest.content.localRef!=candidate.localRef) throw WorldConflict()
                    InitialWorldOutputValidation.candidate(input,latest.content)
                    latest
                }
                val id=UUID.randomUUID();val generated=selected.associate { it.candidateId to UUID.randomUUID() }
                val payload=InitialWorldAdditionMapper.build(analysisId,id,draft,selected,generated)
                studio.validateEditRequest(payload)
                val row=applications.saveAndFlush(InitialWorldApplication(id=id,worldId=world,analysisId=analysisId,
                    requestKey=request.key,requestHash=hash,baseDraftRevision=draft.draftRevision,
                    relationshipVersion=draft.relationshipVersion,additionPayload=json(payload)))
                items.saveAll(selected.map { InitialWorldApplicationItem(worldId=world,analysisId=analysisId,applicationId=id,
                    candidateId=it.candidateId,decisionSequence=it.sequence,generatedId=generated.getValue(it.candidateId),
                    generatedKind=if(it.content.type=="relation") "relationship" else "card") })
                items.flush();receipt(row)
            }
        }
    }

    fun apply(world:UUID,actor:UUID,analysisId:UUID,request:InitialWorldApplicationRequest):InitialWorldApplicationResponse {
        check(!org.springframework.transaction.support.TransactionSynchronizationManager.isActualTransactionActive()) { "Neo4j call must not join a PostgreSQL transaction" }
        val prepared=prepare(world,actor,analysisId,request)
        if(prepared.status in listOf("applied","failed")) return prepared
        val payload=tx {
            owned(world,actor)
            mapper.convertValue(applications.findById(prepared.applicationId).orElseThrow { WorldNotFound() }.additionPayload,EditWorldDraftRequest::class.java)
        }
        try { studio.editAddition(world,actor,payload,prepared.applicationId) }
        catch(_:RuntimeException) {
            // A commit acknowledgement may have been lost. Never overwrite an already applied receipt.
            return tx {
                owned(world,actor);val row=applications.findById(prepared.applicationId).orElseThrow { WorldNotFound() }
                if(row.status=="applying") row.status="unknown"
                applications.flush();receipt(row)
            }
        }
        return get(world,actor,analysisId,prepared.applicationId)
    }
    fun get(world:UUID,actor:UUID,analysisId:UUID,id:UUID):InitialWorldApplicationResponse=tx {
        owned(world,actor);analysis(world,analysisId)
        val row=applications.findById(id).orElseThrow { WorldNotFound() }
        if(row.worldId!=world || row.analysisId!=analysisId) throw WorldNotFound()
        receipt(row)
    }
}
