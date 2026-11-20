package ai.storyfork.content.world.service

import ai.storyfork.content._common.exception.ContentFailure
import ai.storyfork.content._common.exception.checkContent
import ai.storyfork.content.work.repository.WorkRepository
import ai.storyfork.content.work.service.WorkAccessService
import ai.storyfork.content.work.service.WorkWorldService
import ai.storyfork.content.world.domain.*
import ai.storyfork.content.world.service.dto.*
import ai.storyfork.content.world.studio.entity.*
import ai.storyfork.content.world.studio.repository.*
import java.security.MessageDigest
import java.time.Instant
import java.util.UUID
import org.springframework.beans.factory.annotation.Qualifier
import org.springframework.beans.factory.annotation.Value
import org.springframework.stereotype.Service
import org.springframework.transaction.PlatformTransactionManager
import org.springframework.transaction.support.TransactionTemplate
import tools.jackson.databind.json.JsonMapper

/** 최초 구축 전체 연결. 모델 호출은 DB transaction 밖이며 모든 성공 결과를 다음 호출 전에 기록한다. */
@Service
class ManuscriptBuildService(
    private val access:WorkAccessService,private val works:WorkRepository,private val links:WorkWorldService,
    private val studio:WorldStudioService,private val snapshot:ManuscriptBuildSnapshot,private val execution:ManuscriptBuildExecution,
    private val resultStore:ManuscriptBuildResultStore,
    private val jobs:ManuscriptBuildJobRepository,private val results:ManuscriptBuildResultRepository,
    private val steps:ManuscriptBuildLoadStepRepository,private val worlds:StudioWorldRepository,
    @Qualifier("worldStudioTransactionManager") manager:PlatformTransactionManager,private val mapper:JsonMapper,
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
        val expired=job.status in listOf("running","loading") && job.deadline?.isAfter(Instant.now())==false
        val saved=steps.findAllByJobIdOrderBySequence(job.id)
        check(job.status!="completed" || (saved.isNotEmpty() && saved.all { it.receipt!=null && it.status=="applied" }))
        val extractions=results.findAllByJobIdOrderByEpisode(job.id).filter { it.kind=="extraction" }
        return ManuscriptBuildResponse(job.id,job.worldId,if(expired) "unknown" else job.status,
            extractions.size,input(job).episodes.size,
            job.executionToken,if(expired && job.status=="running") "EXECUTION_EXPIRED" else job.failureCode,
            saved.mapNotNull { it.receipt?.let { receipt -> mapper.convertValue(receipt,ManuscriptLoadReceipt::class.java) } },
            extractions.sumOf { skippedItems(it.content) })
    }
    /** 추출 결과의 skipped(코드별 건수)를 더한다. 이 필드가 없던 옛 결과는 0이다. */
    private fun skippedItems(extraction:Map<String,Any?>)=(extraction["skipped"] as? Map<*,*>)?.values?.sumOf { (it as? Number)?.toInt() ?: 0 } ?: 0
    /** 지금 원고가 고정한 입력과 다르다. 회차가 지워지거나 미저장이 돼 고정할 수 없는 경우도 바뀐 것으로 본다. */
    private fun sourceChanged(work:String,owner:UUID,frozen:ManuscriptBuildInput)=
        try { snapshot.read(work,owner.toString())!=frozen } catch(_:ContentFailure) { true }
    /** 추출 중에 전제가 바뀌었다. 재개해도 같은 거절이 반복되니 사유를 남겨 실패로 끝내고 작가가 새로 시작하게 한다. */
    private fun stale(id:UUID,owner:UUID,token:UUID,code:String):Nothing {
        runCatching { execution.fail(id,owner,token,code) }
        throw WorldConflict()
    }
    fun matches(id:String,owner:UUID,request:ManuscriptBuildRequest):Boolean {
        val row=jobs.findById(UUID.fromString(id)).orElse(null) ?: return false
        if(row.ownerSubject!=owner || row.requestKey!=request.key) return false
        if(row.worldId!=request.worldId) throw WorldConflict()
        return true
    }
    fun status(id:UUID,owner:UUID):ManuscriptBuildResponse? =
        if(!jobs.existsById(id)) null else tx { response(owned(id,owner)) }

    fun freeze(workId:String,owner:String):ManuscriptBuildInput {
        if(!enabled) throw ContentFailure(503,"초기 세계관 구축은 아직 활성화되지 않았습니다.")
        return snapshot.read(workId,owner)
    }

    fun prepare(id:UUID,workId:String,owner:UUID,request:ManuscriptBuildRequest,sources:ManuscriptBuildInput) {
        require(request.consent && request.key.matches(Regex("[A-Za-z0-9:_-]{1,200}")))
        val work=access.own(workId,owner.toString())
        val requestHash=hash(listOf(workId,request.worldId.toString(),"initial-build.v1",request.consent))
        val linked=works.findById(workId).orElseThrow().worldStudioId
        if(linked!=null && linked!=request.worldId) throw WorldConflict()
        if(worlds.findById(request.worldId).isEmpty) studio.create(owner,CreateWorldRequest(id=request.worldId,name=work.title.take(100),description=""))
        val basis=studio.draft(request.worldId,owner)
        checkContent(basis.cards.isEmpty() && basis.relationships.isEmpty(),409,"이미 설정이 있는 세계관에는 원고에서 만든 설정을 더할 수 없어요. 설정이 없는 세계관으로 시작해 주세요.")
        if(linked==null) links.link(workId,owner.toString(),request.worldId)
        val manifest=mapOf("basis" to json(basis),"episodes" to sources.episodes.map { source -> mapOf(
            "number" to source.number,"episodeId" to source.episodeId,"versionId" to source.versionId,
            "title" to source.title,"body" to source.body,"sourceHash" to source.hash) })
        studio.prepareManuscript(request.worldId,owner,basis) {
            jobs.saveAndFlush(ManuscriptBuildJob(id=id,workId=workId,worldId=request.worldId,
                ownerSubject=owner,requestKey=request.key,requestHash=requestHash,manifest=manifest))
        }
    }
    private fun active(id:UUID,owner:UUID,token:UUID)=tx {
        owned(id,owner).also {
            if(it.status!="running" || it.executionToken!=token || it.deadline?.isAfter(Instant.now())!=true) throw WorldConflict()
        }
    }
    fun claim(id:UUID,work:String):Map<String,Any> {
        val job=jobs.findById(id).orElseThrow { WorldNotFound() }
        if(job.workId!=work) throw WorldConflict()
        val owner=job.ownerSubject
        if(job.status in listOf("loading","unknown")) return tx {
            val row=owned(id,owner)
            if(row.status!="unknown" && !(row.status=="loading" && row.deadline?.isAfter(Instant.now())==false))
                return@tx mapOf("claimed" to false)
            val token=UUID.randomUUID()
            row.status="loading";row.executionToken=token;row.deadline=Instant.now().plusSeconds(90)
            jobs.flush()
            mapOf("claimed" to true,"loading" to true,"token" to token)
        }
        if(job.status!="queued") return mapOf("claimed" to false)
        val frozen=input(job)
        val now=Instant.now()
        val token=execution.claim(id,owner,now,now.plusSeconds(90L*(frozen.episodes.size+1)))
        if(sourceChanged(work,owner,frozen)) stale(id,owner,token,"SOURCE_CHANGED")
        return mapOf("claimed" to true,"loading" to false,"token" to token,
            "missing" to frozen.missing(resultStore.read(id,owner)).map { mapOf("number" to it.number,"title" to it.title,"body" to it.body) })
    }

    private fun actor(id:UUID)=jobs.findById(id).orElseThrow { WorldNotFound() }.ownerSubject

    fun record(id:UUID,token:UUID,node:tools.jackson.databind.JsonNode) {
        val owner=actor(id)
        val job=active(id,owner,token)
        val source=input(job).episodes.single { it.number==node.path("number").asInt() }
        resultStore.record(id,owner,token,ManuscriptExtractionVerifier.verify(source,node,mapper))
    }

    fun structureInput(id:UUID,token:UUID):Map<String,Any> {
        val owner=actor(id)
        val job=active(id,owner,token)
        val all=resultStore.read(id,owner)
        input(job).requireResults(all)
        return mapOf("prepared" to (results.findByJobIdAndKindAndEpisode(id,"payload",0)!=null),
            "results" to all.map { it.extraction })
    }

    fun structure(id:UUID,token:UUID,structured:tools.jackson.databind.JsonNode) {
        val owner=actor(id)
        val job=active(id,owner,token)
        val frozen=input(job)
        val all=resultStore.read(id,owner);frozen.requireResults(all)
        require(structured.path("identity").isObject && structured.path("payload").isObject)
        val payload=mapper.convertValue(structured.path("payload"),ManuscriptLoadPayload::class.java)
        ManuscriptStructureVerifier.verify(all,structured.path("identity"),payload,mapper)
        val basis=mapper.convertValue(job.manifest["basis"],WorldDraftResponse::class.java)
        ManuscriptBuildMapper.build(id,basis,payload,emptyMap(),all)
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
    }

    fun load(id:UUID,token:UUID):ManuscriptBuildResponse {
        val owner=actor(id)
        val job=tx { owned(id,owner) }
        if(job.executionToken!=token) throw WorldConflict()
        if(job.status=="completed") return tx { response(owned(id,owner)) }
        if(job.status=="running") {
            active(id,owner,token)
            val frozen=input(job)
            val all=resultStore.read(id,owner);frozen.requireResults(all)
            val artifact=results.findByJobIdAndKindAndEpisode(id,"payload",0)
            if(sourceChanged(job.workId,owner,frozen)) stale(id,owner,token,"SOURCE_CHANGED")
            val basis=mapper.convertValue(job.manifest["basis"],WorldDraftResponse::class.java)
            if(works.findById(job.workId).orElseThrow().worldStudioId!=job.worldId) stale(id,owner,token,"WORLD_LINK_CHANGED")
            val payload=mapper.convertValue(checkNotNull(artifact).content,ManuscriptLoadPayload::class.java)
            val identity=results.findByJobIdAndKindAndEpisode(id,"identity",0) ?: throw WorldConflict()
            ManuscriptStructureVerifier.verify(all,mapper.valueToTree(identity.content),payload,mapper)
            val evidence=sourceEvidence(id,payload,all)
            val requests=ManuscriptBuildMapper.build(id,basis,payload,evidence,all)
            try {
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
            } catch(_:WorldConflict) {
                // 추출하는 동안 세계관이 고정한 입력의 기준에서 바뀌었다(실행권이 이미 없으면 stale의 실패 기록은 거절되고 409만 남는다).
                stale(id,owner,token,"WORLD_CHANGED")
            }
        }
        if(job.status!="running" && job.status !in listOf("loading","unknown")) throw WorldConflict()
        try {
            val pending=tx { val job=owned(id,owner);job.worldId to steps.findAllByJobIdOrderBySequence(id).map { it.id } }
            check(pending.second.isNotEmpty())
            pending.second.forEach { studio.editManuscriptAddition(pending.first,owner,it) }
        } catch(error:Exception) {
            // 적재 실패는 WorldStudio가 unknown으로 보존한다. 완료/unknown을 추출 failed로 덮어쓰지 않는다.
            runCatching { tx {
                val current=owned(id,owner)
                if(current.status=="loading" && current.executionToken==token) {
                    current.status="unknown";current.failureCode="LOAD_RESULT_UNCONFIRMED";jobs.flush()
                }
                true
            } }
            throw error
        }
        return tx { response(owned(id,owner)) }
    }

    fun failed(id:UUID,token:UUID,reason:String,episodes:List<Int>) {
        val owner=actor(id)
        val frozen=input(active(id,owner,token))
        val remaining=frozen.missing(resultStore.read(id,owner)).map { it.number }
        require(episodes.size==episodes.distinct().size && episodes.sorted()==remaining.sorted())
        execution.fail(id,owner,token,reason)
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
