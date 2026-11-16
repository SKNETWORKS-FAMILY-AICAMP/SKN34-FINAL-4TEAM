package ai.storyfork.content.world.service

import ai.storyfork.content.world.client.*
import ai.storyfork.content.world.domain.WorldConflict
import ai.storyfork.content.world.domain.WorldNotFound
import ai.storyfork.content.world.service.dto.*
import ai.storyfork.content.world.studio.entity.*
import ai.storyfork.content.world.studio.repository.*
import java.security.MessageDigest
import java.time.Clock
import java.util.UUID
import org.springframework.beans.factory.annotation.Qualifier
import org.springframework.stereotype.Service
import org.springframework.transaction.PlatformTransactionManager
import org.springframework.transaction.support.TransactionTemplate
import org.springframework.transaction.support.TransactionSynchronizationManager
import tools.jackson.databind.json.JsonMapper

class InitialWorldReviewConflict(val code:String):RuntimeException(code)

data class InitialWorldAnalysisRead(val body:InitialWorldAnalysisResponse,val failureCode:String?)
class AnalysisStorageUnconfirmed(val worldId:UUID,val analysisId:UUID):RuntimeException("ANALYSIS_STORAGE_UNCONFIRMED")

@Service
class InitialWorldAnalysisService(
    private val studio:WorldStudioService,private val worlds:StudioWorldRepository,
    private val drafts:WorldDraftRepository,private val states:WorldRelationshipStateRepository,
    private val analyses:InitialWorldAnalysisRepository,private val candidates:InitialWorldCandidateRepository,
    private val ai:InitialWorldExtractionClient,private val mapper:JsonMapper,
    private val decisions:InitialWorldDecisionRepository,private val applicationItems:InitialWorldApplicationItemRepository,
    @Qualifier("worldStudioTransactionManager") manager:PlatformTransactionManager,
    @Qualifier("initialWorldAnalysisClock") private val clock:Clock,
) {
    private val transaction=TransactionTemplate(manager)
    private fun <T:Any> tx(action:()->T):T=transaction.execute { action() }
    private fun owned(world:UUID,actor:UUID)=worlds.lockOwned(world,actor) ?: throw WorldNotFound()
    private fun row(world:UUID,id:UUID)=analyses.findById(id).orElseThrow { WorldNotFound() }.also {
        if(it.worldId!=world) throw WorldNotFound()
    }
    @Suppress("UNCHECKED_CAST")
    // Match Hibernate jsonb deep-copy number types; convertValue preserves Long and can dirty terminal rows twice.
    private fun json(value:Any):Map<String,Any?> = mapper.readValue(mapper.writeValueAsBytes(value),Map::class.java) as Map<String,Any?>
    private fun snapshot(row:InitialWorldAnalysis):InitialWorldInput {
        val input=mapper.convertValue(row.inputSnapshot,InitialWorldInput::class.java)
        check(input.worldId==row.worldId && input.analysisId==row.id && input.basis.draftRevision==row.draftRevision &&
            input.basis.relationshipVersion==row.relationshipVersion && input.basis.currentRevisionId==row.currentRevisionId)
        return input
    }
    private fun expire(row:InitialWorldAnalysis) {
        if(row.executionStatus=="running" && !clock.instant().isBefore(row.deadline)) {
            row.executionStatus="unknown";row.failureCode="RUN_LEASE_EXPIRED"
        }
    }
    private fun read(row:InitialWorldAnalysis,world:StudioWorld):InitialWorldAnalysisRead {
        expire(row)
        val input=snapshot(row)
        val draft=drafts.findById(world.id).orElseThrow { WorldNotFound() }
        val state=states.findById(world.id).orElseThrow { WorldNotFound() }
        val current=draft.draftRevision==row.draftRevision && state.completed && state.graphVersion==row.relationshipVersion &&
            world.currentRevisionId==row.currentRevisionId
        val output=row.output?.let { mapper.convertValue(it,InitialWorldOutput::class.java) }
        val ids=if(row.executionStatus=="completed") candidates.findAllByWorldIdAndAnalysisIdOrderByLocalRef(world.id,row.id)
            .associate { it.localRef to it.id } else emptyMap()
        return InitialWorldAnalysisRead(InitialWorldAnalysisResponse(row.id,input.basis,row.executionStatus,
            if(current) "current" else "stale",output,ids,
            decisions.findAllByWorldIdAndAnalysisIdOrderByCandidateIdAscSequenceAsc(world.id,row.id).map(::decision)),row.failureCode)
    }

    /** 같은 키는 저장된 입력을 사용한다. 현재 원문을 다시 읽어 요청 의미를 바꾸지 않는다. */
    fun analyze(worldId:UUID,actor:UUID,request:InitialWorldAnalysisRequest):InitialWorldAnalysisRead {
        check(!TransactionSynchronizationManager.isActualTransactionActive()) { "AI call must not join a database transaction" }
        require(request.key.matches(Regex("[A-Za-z0-9:_-]{1,200}")))
        require(request.expectedDraftRevision in 0..9007199254740991L)
        val hash=MessageDigest.getInstance("SHA-256").digest("$worldId:${request.expectedDraftRevision}".toByteArray())
            .joinToString("") { "%02x".format(it.toInt() and 0xff) }
        fun existing(world:StudioWorld):InitialWorldAnalysisRead? = analyses.findByWorldIdAndRequestKey(worldId,request.key)?.let {
            if(it.requestHash!=hash) throw WorldConflict()
            read(it,world)
        }
        val prior=transaction.execute { val world=owned(worldId,actor); existing(world) }
        if(prior!=null) return prior
        val id=UUID.randomUUID()
        val input=studio.prepareInitialWorldInput(worldId,actor,id)
        if(input.basis.draftRevision!=request.expectedDraftRevision) throw WorldConflict()
        var token:UUID?=null
        val prepared=try {
            studio.withInitialWorldInput(actor,input) { safe ->
                val world=owned(worldId,actor)
                existing(world) ?: run {
                    val record=analyses.saveAndFlush(InitialWorldAnalysis(id=id,worldId=worldId,requestKey=request.key,
                        requestHash=hash,draftRevision=safe.basis.draftRevision,relationshipVersion=safe.basis.relationshipVersion,
                        currentRevisionId=safe.basis.currentRevisionId,inputSnapshot=json(safe),createdAt=clock.instant(),deadline=clock.instant().plusSeconds(90)))
                    token=record.executionToken
                    read(record,world)
                }
            }
        } catch(e:org.springframework.dao.DataAccessException) { throw AnalysisStorageUnconfirmed(worldId,id) }
          catch(e:org.springframework.transaction.TransactionException) { throw AnalysisStorageUnconfirmed(worldId,id) }
        if(token==null) return prepared

        // Preparation has committed. No world lock/transaction crosses the HTTP boundary.
        check(!TransactionSynchronizationManager.isActualTransactionActive())
        val output=try { InitialWorldOutputValidation.parse(input,ai.extract(input)) }
        catch(e:InitialWorldCallFailure) { return fail(worldId,actor,id,token,e.code,e.uncertain) }
        catch(_:IllegalArgumentException) { return fail(worldId,actor,id,token,"AI_OUTPUT_INVALID",false) }
        return try {
            tx {
                val world=owned(worldId,actor);val record=row(worldId,id);expire(record)
                check(snapshot(record)==input)
                if(record.executionStatus=="running" && record.executionToken==token) {
                    output.candidates.forEach { c -> candidates.save(InitialWorldCandidate(
                        worldId=worldId,analysisId=id,localRef=c.localRef,content=json(c))) }
                    record.output=json(output);record.executionStatus="completed"
                    // Both candidate inserts and completed status are committed by this transaction.
                    candidates.flush();analyses.flush()
                }
                read(record,world)
            }
        } catch(_:org.springframework.dao.DataAccessException) {
            fail(worldId,actor,id,token,"RESULT_COMMIT_UNCONFIRMED",true)
        } catch(_:org.springframework.transaction.TransactionException) {
            fail(worldId,actor,id,token,"RESULT_COMMIT_UNCONFIRMED",true)
        }
    }

    private fun fail(world:UUID,actor:UUID,id:UUID,token:UUID,code:String,unknown:Boolean):InitialWorldAnalysisRead = try {
        tx {
            val owner=owned(world,actor);val record=row(world,id);expire(record)
            if(record.executionStatus=="running" && record.executionToken==token) {
                record.executionStatus=if(unknown) "unknown" else "failed";record.failureCode=code
            }
            // A lost commit acknowledgement may already have persisted completed: never overwrite it.
            read(record,owner)
        }
    } catch(_:org.springframework.dao.DataAccessException) { throw AnalysisStorageUnconfirmed(world,id) }
      catch(_:org.springframework.transaction.TransactionException) { throw AnalysisStorageUnconfirmed(world,id) }

    private fun decision(row:InitialWorldDecision)=InitialWorldDecisionRecord(row.candidateId,
        row.content["localRef"] as String,row.sequence,row.state,mapper.convertValue(row.content,InitialWorldCandidateOutput::class.java))

    /** 같은 후보의 검토를 world 잠금 안에서 순서대로 누적한다. 승인만으로 정본을 변경하지 않는다. */
    fun decide(worldId:UUID,actor:UUID,analysisId:UUID,candidateId:UUID,request:InitialWorldDecisionRequest):InitialWorldDecisionRecord=tx {
        val world=owned(worldId,actor)
        val analysis=row(worldId,analysisId)
        val candidate=candidates.findById(candidateId).orElseThrow { WorldNotFound() }
        if(candidate.worldId!=worldId || candidate.analysisId!=analysisId) throw WorldNotFound()
        val hash=MessageDigest.getInstance("SHA-256").digest(mapper.writeValueAsBytes(request))
            .joinToString("") { "%02x".format(it.toInt() and 255) }
        val previous=decisions.findByCandidateIdAndRequestKey(candidateId,request.key)
        if(previous!=null) {
            if(previous.requestHash!=hash) throw WorldConflict()
            return@tx decision(previous)
        }
        if(applicationItems.hasPendingApplication(candidateId)) throw WorldConflict()
        if(analysis.executionStatus!="completed") throw InitialWorldReviewConflict("ANALYSIS_NOT_COMPLETED")
        if(read(analysis,world).body.freshness!="current") throw InitialWorldReviewConflict("ANALYSIS_STALE")
        val latest=decisions.findFirstByCandidateIdOrderBySequenceDesc(candidateId)
        if(request.expectedDecisionSequence!=(latest?.sequence ?: 0)) throw WorldConflict()
        val current=mapper.convertValue(latest?.content ?: candidate.content,InitialWorldCandidateOutput::class.java)
        val content=InitialWorldDecisionValidation.review(snapshot(analysis),current,request)
        decision(decisions.saveAndFlush(InitialWorldDecision(worldId=worldId,analysisId=analysisId,candidateId=candidateId,
            sequence=Math.incrementExact(request.expectedDecisionSequence),action=request.action,actorId=actor,
            content=json(content),requestKey=request.key,requestHash=hash,comment=request.comment)))
    }

    fun get(world:UUID,actor:UUID,id:UUID):InitialWorldAnalysisRead=tx { val owner=owned(world,actor);read(row(world,id),owner) }
    fun list(world:UUID,actor:UUID):List<InitialWorldAnalysisResponse> = tx {
        val owner=owned(world,actor);analyses.findAllByWorldIdOrderByCreatedAtDesc(world).map { read(it,owner).body }
    }
    fun candidates(world:UUID,actor:UUID,id:UUID):List<InitialWorldStoredCandidate> {
        val result=get(world,actor,id).body
        return result.output?.candidates?.map { InitialWorldStoredCandidate(result.candidateIds.getValue(it.localRef),it) } ?: emptyList()
    }
}
