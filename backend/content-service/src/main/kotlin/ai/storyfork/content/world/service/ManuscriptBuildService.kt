package ai.storyfork.content.world.service

import ai.storyfork.content._common.exception.ContentFailure
import ai.storyfork.content.work.repository.WorkRepository
import ai.storyfork.content.work.service.WorkAccessService
import ai.storyfork.content.work.service.WorkWorldService
import ai.storyfork.content.world.client.*
import ai.storyfork.content.world.domain.*
import ai.storyfork.content.world.service.dto.*
import ai.storyfork.content.world.studio.entity.*
import ai.storyfork.content.world.studio.repository.*
import java.security.MessageDigest
import java.time.Instant
import java.util.UUID
import org.springframework.beans.factory.annotation.Qualifier
import org.springframework.beans.factory.annotation.Value
import org.springframework.core.task.AsyncTaskExecutor
import org.springframework.stereotype.Service
import org.springframework.transaction.PlatformTransactionManager
import org.springframework.transaction.support.TransactionTemplate
import tools.jackson.databind.json.JsonMapper

/** 최초 구축 전체 연결. 모델 호출은 DB transaction 밖이며 모든 성공 결과를 다음 호출 전에 기록한다. */
@Service
class ManuscriptBuildService(
    private val access:WorkAccessService,private val works:WorkRepository,private val links:WorkWorldService,
    private val studio:WorldStudioService,private val snapshot:ManuscriptBuildSnapshot,private val execution:ManuscriptBuildExecution,
    private val resultStore:ManuscriptBuildResultStore,private val ai:ManuscriptBuildClient,
    private val jobs:ManuscriptBuildJobRepository,private val results:ManuscriptBuildResultRepository,
    private val steps:ManuscriptBuildLoadStepRepository,private val worlds:StudioWorldRepository,
    @Qualifier("worldStudioTransactionManager") manager:PlatformTransactionManager,private val mapper:JsonMapper,
    @Qualifier("applicationTaskExecutor") private val executor:AsyncTaskExecutor,
    @Value("\${app.manuscript-build.enabled:false}") private val enabled:Boolean,
) {
    private val transaction=TransactionTemplate(manager)
    private fun <T:Any> tx(action:()->T):T=transaction.execute { action() }
    @Suppress("UNCHECKED_CAST") private fun json(value:Any)=mapper.readValue(mapper.writeValueAsBytes(value),Map::class.java) as Map<String,Any?>
    private fun hash(value:Any)=MessageDigest.getInstance("SHA-256").digest(mapper.writeValueAsBytes(value)).joinToString("") { "%02x".format(it.toInt() and 255) }
    private fun owned(job:UUID,owner:UUID)=jobs.owned(job,owner,worlds)
    private fun input(job:ManuscriptBuildJob):ManuscriptBuildInput {
        val rows=job.manifest["episodes"] as? List<*> ?: throw WorldConflict()
        return ManuscriptBuildInput(rows.map {
            val row=it as Map<*,*>
            val source=mapper.convertValue(row.filterKeys { key->key!="sourceHash" },ManuscriptBuildSource::class.java)
            require(source.hash==row["sourceHash"]);source
        })
    }
    private fun response(job:ManuscriptBuildJob):ManuscriptBuildResponse {
        val expired=job.status=="running" && job.deadline?.isAfter(Instant.now())==false
        val saved=steps.findAllByJobIdOrderBySequence(job.id)
        check(job.status!="completed" || (saved.isNotEmpty() && saved.all { it.receipt!=null && it.status=="applied" }))
        return ManuscriptBuildResponse(job.id,job.worldId,if(expired) "unknown" else job.status,
            results.findAllByJobIdOrderByEpisode(job.id).count { it.kind=="extraction" },input(job).episodes.size,
            job.executionToken,if(expired) "EXECUTION_EXPIRED" else job.failureCode,
            saved.mapNotNull { it.receipt?.let { receipt -> mapper.convertValue(receipt,ManuscriptLoadReceipt::class.java) } })
    }
    fun read(workId:String,owner:UUID):ManuscriptBuildResponse {
        access.own(workId,owner.toString())
        val job=jobs.findByWorkId(workId) ?: throw WorldNotFound()
        return tx { response(owned(job.id,owner)) }
    }
    fun start(workId:String,owner:UUID,request:ManuscriptBuildRequest):ManuscriptBuildResponse {
        if(!enabled) throw ContentFailure(503,"초기 세계관 구축은 아직 활성화되지 않았습니다.")
        require(request.consent && request.key.matches(Regex("[A-Za-z0-9:_-]{1,200}")))
        val work=access.own(workId,owner.toString())
        val requestHash=hash(listOf(workId,request.worldId.toString(),"initial-build.v1",request.consent))
        var job=jobs.findByWorkId(workId)
        if(job==null) {
            require(request.resumeToken==null)
            val sources=snapshot.read(workId,owner.toString())
            val linked=works.findById(workId).orElseThrow().worldStudioId
            if(linked!=null && linked!=request.worldId) throw WorldConflict()
            if(worlds.findById(request.worldId).isEmpty) studio.create(owner,CreateWorldRequest(id=request.worldId,name=work.title,description=""))
            val basis=studio.draft(request.worldId,owner)
            require(basis.cards.isEmpty() && basis.relationships.isEmpty()) { "기존 설정과의 정체 확인이 필요합니다." }
            if(linked==null) links.link(workId,owner.toString(),request.worldId)
            val manifest=mapOf("basis" to json(basis),"episodes" to sources.episodes.map { source -> mapOf(
                "number" to source.number,"episodeId" to source.episodeId,"versionId" to source.versionId,
                "title" to source.title,"body" to source.body,"sourceHash" to source.hash) })
            job=studio.prepareManuscript(request.worldId,owner,basis) {
                jobs.findByWorkId(workId) ?: jobs.saveAndFlush(ManuscriptBuildJob(workId=workId,worldId=request.worldId,
                    ownerSubject=owner,requestKey=request.key,requestHash=requestHash,manifest=manifest))
            }
        }
        val selected=checkNotNull(job)
        val before=tx {
            val row=owned(selected.id,owner)
            if(row.requestKey!=request.key || row.requestHash!=requestHash || row.worldId!=request.worldId) throw WorldConflict()
            response(row)
        }
        if(before.status=="completed") return before
        val recover=selected.status in listOf("loading","unknown")
        if(!recover && before.status!="queued" && request.resumeToken==null) return before
        val now=Instant.now()
        val token=if(recover) null else execution.claim(selected.id,owner,now,now.plusSeconds(90L*(before.totalEpisodes+1)),request.resumeToken)
        val accepted=tx { response(owned(selected.id,owner)) }
        try { executor.execute { run(selected.id,owner,token) } }
        catch(_:RuntimeException) {
            if(token!=null) execution.fail(selected.id,owner,token,"EXECUTION_NOT_SCHEDULED")
            return read(workId,owner)
        }
        return accepted
    }
    private fun active(id:UUID,owner:UUID,token:UUID)=tx {
        owned(id,owner).also {
            if(it.status!="running" || it.executionToken!=token || it.deadline?.isAfter(Instant.now())!=true) throw WorldConflict()
        }
    }
    private fun run(id:UUID,owner:UUID,token:UUID?) {
        try {
            if(token!=null) {
                val job=active(id,owner,token)
                require(works.findById(job.workId).orElseThrow().worldStudioId==job.worldId) { "WORLD_LINK_CHANGED" }
                val frozen=input(job)
                require(snapshot.read(job.workId,owner.toString())==frozen) { "SOURCE_CHANGED" }
                for(source in frozen.missing(resultStore.read(id,owner))) {
                    active(id,owner,token)
                    val result=ManuscriptExtractionVerifier.verify(source,mapper.readTree(ai.extract(source)),mapper)
                    resultStore.record(id,owner,token,result)
                }
                val all=resultStore.read(id,owner);frozen.requireResults(all)
                var artifact=results.findByJobIdAndKindAndEpisode(id,"payload",0)
                if(artifact==null) {
                    active(id,owner,token)
                    val structured=mapper.readTree(ai.structure(all.map { it.extraction }))
                    require(structured.path("identity").isObject && structured.path("payload").isObject)
                    val payload=mapper.convertValue(structured.path("payload"),ManuscriptLoadPayload::class.java)
                    ManuscriptStructureVerifier.verify(all,structured.path("identity"),payload,mapper)
                    val basis=mapper.convertValue(job.manifest["basis"],WorldDraftResponse::class.java)
                    ManuscriptBuildMapper.build(id,basis,payload,emptyMap())
                    tx {
                        val current=owned(id,owner)
                        if(current.executionToken!=token || current.status!="running" || current.deadline?.isAfter(Instant.now())!=true) throw WorldConflict()
                        frozen.requireResults(resultStore.read(id,owner))
                        for(kind in listOf("identity","payload")) {
                            val body=json(structured.path(kind))
                            val previous=results.findByJobIdAndKindAndEpisode(id,kind,0)
                            if(previous!=null) { if(previous.contentHash!=hash(body)) throw WorldConflict() }
                            else results.saveAndFlush(ManuscriptBuildResult(jobId=id,kind=kind,episode=0,content=body,contentHash=hash(body)))
                        }
                    }
                    artifact=results.findByJobIdAndKindAndEpisode(id,"payload",0)
                }
                require(snapshot.read(job.workId,owner.toString())==frozen) { "SOURCE_CHANGED" }
                val basis=mapper.convertValue(job.manifest["basis"],WorldDraftResponse::class.java)
                require(works.findById(job.workId).orElseThrow().worldStudioId==job.worldId) { "WORLD_LINK_CHANGED" }
                val payload=mapper.convertValue(checkNotNull(artifact).content,ManuscriptLoadPayload::class.java)
                val identity=results.findByJobIdAndKindAndEpisode(id,"identity",0) ?: throw WorldConflict()
                ManuscriptStructureVerifier.verify(all,mapper.valueToTree(identity.content),payload,mapper)
                val evidence=sourceEvidence(id,payload,all)
                val requests=ManuscriptBuildMapper.build(id,basis,payload,evidence)
                studio.prepareManuscript(job.worldId,owner,basis) {
                    val current=owned(id,owner)
                    if(current.status!="running" || current.executionToken!=token || current.deadline?.isAfter(Instant.now())!=true) throw WorldConflict()
                    require(steps.findAllByJobIdOrderBySequence(id).isEmpty())
                    requests.forEachIndexed { index,request ->
                        studio.validateEditRequest(request)
                        steps.saveAndFlush(ManuscriptBuildLoadStep(jobId=id,sequence=index+1,requestPayload=json(request),requestHash=studio.manuscriptRequestHash(job.worldId,request)))
                    }
                    current.status="loading";jobs.flush();true
                }
            }
            val pending=tx { val job=owned(id,owner);job.worldId to steps.findAllByJobIdOrderBySequence(id).map { it.id } }
            check(pending.second.isNotEmpty())
            pending.second.forEach { studio.editManuscriptAddition(pending.first,owner,it) }
        } catch(error:Exception) {
            // 적재 실패는 WorldStudio가 unknown으로 보존한다. 완료/unknown을 추출 failed로 덮어쓰지 않는다.
            runCatching { tx {
                val current=owned(id,owner)
                if(current.status=="loading" && (token==null || current.executionToken==token)) {
                    current.status="unknown";current.failureCode="LOAD_RESULT_UNCONFIRMED";jobs.flush()
                }
                true
            } }
            if(token!=null) runCatching { execution.fail(id,owner,token,when(error) {
                is InitialWorldCallFailure -> error.code
                is IllegalArgumentException -> if(error.message in setOf("SOURCE_CHANGED","WORLD_LINK_CHANGED")) checkNotNull(error.message) else "INVALID_EXTRACTION_OR_PAYLOAD"
                else -> "BUILD_RESULT_UNCONFIRMED"
            }) }
        }
    }
    /** 표시 본문에 실제 포함된 인용만 연결하고, 모든 원본 결과는 별도로 보존한다. */
    private fun sourceEvidence(job:UUID,payload:ManuscriptLoadPayload,all:List<ManuscriptEpisodeResult>):Map<String,List<Map<String,Any?>>> {
        val identity=results.findByJobIdAndKindAndEpisode(job,"identity",0) ?: throw WorldConflict()
        val mapping=identity.content["mapping"] as? Map<*,*> ?: throw WorldConflict()
        fun evidence(text:String,key:String,relation:ManuscriptRelation?=null)=all.flatMap { result ->
            val row=results.findByJobIdAndKindAndEpisode(job,"extraction",result.basis.number) ?: throw WorldConflict()
            val tree:tools.jackson.databind.JsonNode=mapper.valueToTree(result.extraction)
            fun rows(name:String)=(0 until tree.path(name).size()).map { tree.path(name).get(it) }
            val mentionQuotes=rows("mentions").filter { mapping["${result.basis.number}:${it.path("id").asString()}"]==key }.map { it.path("quote").asString() }
            val relationQuotes=if(relation==null) emptyList() else rows("relationships").filter {
                result.basis.number==relation.fromEpisode && it.path("label").asString()==relation.label &&
                    mapping["${result.basis.number}:${it.path("source").asString()}"]==relation.fromKey &&
                    mapping["${result.basis.number}:${it.path("target").asString()}"]==relation.toKey && it.path("ended").asBoolean()==relation.ended
            }.map { it.path("quote").asString() }
            result.evidence.filter { text.contains(it.quote) || it.quote in mentionQuotes || it.quote in relationQuotes }.map { proof -> mapOf("sourceId" to result.basis.versionId,
                "episode" to result.basis.number,"resultId" to row.id.toString(),"sourceHash" to result.basis.sourceHash,
                "start" to proof.start,"end" to proof.end,"quote" to proof.quote,
                "quoteHash" to MessageDigest.getInstance("SHA-256").digest(proof.quote.toByteArray()).joinToString("") { "%02x".format(it.toInt() and 255) }) }
        }
        val cardEvidence=payload.cards.associate { c -> c.key to evidence(listOf(c.body,c.characterDocs?.soul,c.characterDocs?.goal,c.characterDocs?.episodes?.values?.joinToString("\n")).filterNotNull().joinToString("\n"),c.key).also { require(it.isNotEmpty()) } }
        val relationEvidence=payload.relations.associate { relation ->
            val key="relation:${relation.fromKey.length}:${relation.fromKey}:${relation.toKey.length}:${relation.toKey}:${relation.label}:${relation.fromEpisode}"
            key to evidence("",key,relation).also { require(it.isNotEmpty()) }
        }
        return cardEvidence+relationEvidence
    }
}
