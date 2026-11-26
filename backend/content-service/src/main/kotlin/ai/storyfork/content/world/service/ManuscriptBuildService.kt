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

// AI worker의 EPISODE_CONCURRENCY와 함께 바꾼다(최초 구축 저장 계약 #840).
private const val EPISODES_PER_EXTRACTION_BATCH = 4L

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
        val artifacts=results.findAllByJobIdOrderByEpisode(job.id)
        val extractions=artifacts.filter { it.kind=="extraction" }
        val identity=artifacts.firstOrNull { it.kind=="identity" }
        val skippedLinks=(identity?.content?.get("skippedLinks") as? Number)?.toInt()?.coerceAtLeast(0) ?: 0
        // Mapper가 제외한 관계는 검증된 payload에는 있고 예약 요청에는 없다. 재개해도 같은 요청을 사용한다.
        val skippedRelations=if(job.status=="completed") {
            val payload=artifacts.firstOrNull { it.kind=="payload" }
            val proposed=(payload?.content?.get("relations") as? List<*>)?.size ?: 0
            val reserved=saved.sumOf { (it.requestPayload["relationships"] as? List<*>)?.size ?: 0 }
            (proposed-reserved).coerceAtLeast(0)
        } else 0
        return ManuscriptBuildResponse(job.id,job.worldId,if(expired) "unknown" else job.status,
            extractions.size,input(job).episodes.size,
            job.executionToken,if(expired && job.status=="running") "EXECUTION_EXPIRED" else job.failureCode,
            saved.mapNotNull { it.receipt?.let { receipt -> mapper.convertValue(receipt,ManuscriptLoadReceipt::class.java) } },
            extractions.sumOf { skippedItems(it.content) }+skippedLinks+skippedRelations,job.requestKey)
    }
    /** 저장된 추출 결과({basis,evidence,extraction})에서 extraction의 skipped(코드별 건수)를 더한다. 이 필드가 없던 옛 결과는 0이다. */
    private fun skippedItems(content:Map<String,Any?>)=((content["extraction"] as? Map<*,*>)?.get("skipped") as? Map<*,*>)?.values?.sumOf { (it as? Number)?.toInt() ?: 0 } ?: 0
    /**
     * 지금 원고가 고정한 입력과 다르다. 회차가 지워지거나 미저장이 돼 고정할 수 없는 경우도 바뀐 것으로 본다.
     * 업데이트 작업은 고정한 회차의 발행본만 보고(다른 회차의 새 발행은 다음 업데이트 몫이다) 발행이 중단되거나 다른 버전으로 바뀌어도 바뀐 것이다.
     */
    private fun sourceChanged(job:ManuscriptBuildJob,frozen:ManuscriptBuildInput)=
        try {
            if(job.kind=="update") snapshot.readPublished(job.workId) { number -> frozen.episodes.any { it.number==number } }!=frozen
            else snapshot.read(job.workId,job.ownerSubject.toString())!=frozen
        } catch(_:ContentFailure) { true }
    /** 적재의 기준 초안이다. 업데이트 작업은 claim 때 고정한 값이고 최초 구축은 접수 때 manifest에 둔 빈 세계관이다. */
    private fun basisOf(job:ManuscriptBuildJob):WorldDraftResponse=
        mapper.convertValue(job.basis ?: job.manifest["basis"] ?: throw WorldConflict(),WorldDraftResponse::class.java)
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

    private fun requireEnabled() { if(!enabled) throw ContentFailure(503,"초기 세계관 구축은 아직 활성화되지 않았습니다.") }

    fun freeze(workId:String,owner:String):ManuscriptBuildInput {
        requireEnabled()
        return snapshot.read(workId,owner)
    }

    /**
     * 발행본이 있는 회차(Fork 상속 제외) 중 [excluded](이미 반영됐거나 재실행을 기다리는 회차)에 없는 회차의 발행 버전을 고정한다(업데이트 작업, 2026-11-22).
     * 운영에서 발행본 변경에 대응하면 [only]로 기존 작업에 속한 회차만 고른다. 반영할 회차가 없으면 null이고 기능이 꺼져 있으면 503이다.
     */
    fun freezeUpdate(workId:String,excluded:Set<Int>,only:Set<Int>?=null):ManuscriptBuildInput? {
        requireEnabled()
        return snapshot.readPublished(workId) { it !in excluded && (only==null || it in only) }
    }

    /** 접수한 업데이트 작업을 AI가 받지 못했다. 실행권이 없는 queued 작업만 실패로 끝내고 운영 재실행을 기다린다. */
    fun failQueued(id:UUID,owner:UUID,code:String)=execution.failQueued(id,owner,code)

    fun prepare(id:UUID,workId:String,owner:UUID,request:ManuscriptBuildRequest,sources:ManuscriptBuildInput)=prepareJob(id,workId,owner,request,sources,"initial")

    /** 업데이트 작업을 접수한다. 이미 설정이 있는 세계관이 정상이고(409 없음) 기준 초안은 claim 때 고정하므로 manifest에 두지 않는다. 작품에 연결된 세계관이어야 한다. */
    fun prepareUpdate(id:UUID,workId:String,owner:UUID,request:ManuscriptBuildRequest,sources:ManuscriptBuildInput)=prepareJob(id,workId,owner,request,sources,"update")

    private fun prepareJob(id:UUID,workId:String,owner:UUID,request:ManuscriptBuildRequest,sources:ManuscriptBuildInput,kind:String) {
        require(request.consent && request.key.matches(Regex("[A-Za-z0-9:_-]{1,200}")))
        val update=kind=="update"
        val work=access.own(workId,owner.toString())
        val requestHash=hash(listOf(workId,request.worldId.toString(),"$kind-build.v1",request.consent))
        val linked=works.findById(workId).orElseThrow().worldStudioId
        if(linked!=null && linked!=request.worldId) throw WorldConflict()
        if(update && linked==null) throw WorldConflict()
        if(worlds.findById(request.worldId).isEmpty) {
            if(update) throw WorldConflict()
            studio.create(owner,CreateWorldRequest(id=request.worldId,name=work.title.take(100),description=""))
        }
        val basis=studio.draft(request.worldId,owner)
        if(!update) checkContent(basis.cards.isEmpty() && basis.relationships.isEmpty(),409,"이미 설정이 있는 세계관에는 원고에서 만든 설정을 더할 수 없어요. 설정이 없는 세계관으로 시작해 주세요.")
        if(linked==null) links.link(workId,owner.toString(),request.worldId)
        val episodes=sources.episodes.map { source -> mapOf(
            "number" to source.number,"episodeId" to source.episodeId,"versionId" to source.versionId,
            "title" to source.title,"body" to source.body,"sourceHash" to source.hash) }
        val manifest=if(update) mapOf("episodes" to episodes) else mapOf("basis" to json(basis),"episodes" to episodes)
        studio.prepareManuscript(request.worldId,owner,basis) {
            jobs.saveAndFlush(ManuscriptBuildJob(id=id,workId=workId,worldId=request.worldId,
                ownerSubject=owner,requestKey=request.key,requestHash=requestHash,manifest=manifest,kind=kind))
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
        val episodeCount = frozen.episodes.size.toLong()
        val batchCount = (episodeCount + EPISODES_PER_EXTRACTION_BATCH - 1) / EPISODES_PER_EXTRACTION_BATCH
        // 추출은 묶음별로, 결과 검증과 저장은 회차별로, 정체 정리와 적재는 작업당 한 번 예산을 잡는다.
        val leaseSeconds = 180L * batchCount + 20L * episodeCount + 150L
        val token=execution.claim(id,owner,now,now.plusSeconds(leaseSeconds))
        if(sourceChanged(job,frozen)) stale(id,owner,token,"SOURCE_CHANGED")
        if(job.kind=="update") freezeBasis(id,owner,job.worldId,token)
        return mapOf("claimed" to true,"loading" to false,"token" to token,
            "missing" to frozen.missing(resultStore.read(id,owner)).map { mapOf("number" to it.number,"title" to it.title,"body" to it.body) })
    }

    /**
     * 업데이트 작업의 기준 초안은 접수가 아니라 실행권을 받는 지금의 초안이다(큐에서 기다리는 동안의 작가 편집이 실패가 되지 않게 한다). 이 뒤 추출·적재 중에 초안이 바뀌면
     * 최초 구축과 같이 WORLD_CHANGED다. 초안을 읽을 수 없으면 바뀐 것과 같이 실패로 끝낸다.
     */
    private fun freezeBasis(id:UUID,owner:UUID,world:UUID,token:UUID) {
        val basis=try { json(studio.draft(world,owner)) } catch(_:RuntimeException) { stale(id,owner,token,"WORLD_CHANGED") }
        tx { owned(id,owner).basis=basis;jobs.flush();true }
    }

    private fun actor(id:UUID)=jobs.findById(id).orElseThrow { WorldNotFound() }.ownerSubject

    fun record(id:UUID,token:UUID,node:tools.jackson.databind.JsonNode) {
        val owner=actor(id)
        val job=active(id,owner,token)
        val source=input(job).episodes.single { it.number==node.path("number").asInt() }
        resultStore.record(id,owner,token,ManuscriptExtractionVerifier.verify(source,node,mapper))
    }

    /**
     * 정체 정리 입력이다. 업데이트 작업은 기준 초안의 활성 인물 카드의 이름·별칭만 `knownCharacters`로 더해(AI에 줄 ref는 "0:k1"부터) 정체 정리 호출이
     * 새 회차의 인물과 기존 인물이 같은 사람인지도 판단하게 한다. 본문·기억·UUID는 보내지 않는다(#952).
     */
    fun structureInput(id:UUID,token:UUID):Map<String,Any> {
        val owner=actor(id)
        val job=active(id,owner,token)
        val all=resultStore.read(id,owner)
        input(job).requireResults(all)
        val known=if(job.kind=="update") ManuscriptBuildMapper.knownCharacters(basisOf(job)).mapIndexed { i,card ->
            val title=card.title.trim()
            mapOf("ref" to "0:k${i+1}","name" to title,"aliases" to (ManuscriptBuildMapper.names(card.title,card.aliases)-title).toList())
        } else null
        return mapOf("prepared" to (results.findByJobIdAndKindAndEpisode(id,"payload",0)!=null),
            "results" to all.map { it.extraction })+(if(known!=null) mapOf("knownCharacters" to known) else emptyMap())
    }

    /** 업데이트 작업이면 AI의 기존 인물 링크를 검증한 요청 카드별 결정이다. 최초 구축에는 기존 인물이 없어 링크가 있으면 거절한다(#952). */
    private fun knownMatches(job:ManuscriptBuildJob,basis:WorldDraftResponse,all:List<ManuscriptEpisodeResult>,identity:tools.jackson.databind.JsonNode)=
        ManuscriptStructureVerifier.knownMatches(all,identity,
            if(job.kind=="update") ManuscriptBuildMapper.knownCharacters(basis).map { ManuscriptBuildMapper.names(it.title,it.aliases) } else emptyList(),mapper)

    fun structure(id:UUID,token:UUID,structured:tools.jackson.databind.JsonNode) {
        val owner=actor(id)
        val job=active(id,owner,token)
        val frozen=input(job)
        val all=resultStore.read(id,owner);frozen.requireResults(all)
        require(structured.path("identity").isObject && structured.path("payload").isObject)
        val payload=mapper.convertValue(structured.path("payload"),ManuscriptLoadPayload::class.java)
        ManuscriptStructureVerifier.verify(all,structured.path("identity"),payload,mapper)
        val basis=basisOf(job)
        ManuscriptBuildMapper.build(id,basis,payload,emptyMap(),all,update=job.kind=="update",known=knownMatches(job,basis,all,structured.path("identity")))
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
            if(sourceChanged(job,frozen)) stale(id,owner,token,"SOURCE_CHANGED")
            val basis=basisOf(job)
            if(works.findById(job.workId).orElseThrow().worldStudioId!=job.worldId) stale(id,owner,token,"WORLD_LINK_CHANGED")
            val payload=mapper.convertValue(checkNotNull(artifact).content,ManuscriptLoadPayload::class.java)
            val identity=results.findByJobIdAndKindAndEpisode(id,"identity",0) ?: throw WorldConflict()
            val identityNode:tools.jackson.databind.JsonNode=mapper.valueToTree(identity.content)
            ManuscriptStructureVerifier.verify(all,identityNode,payload,mapper)
            val evidence=sourceEvidence(id,payload,all)
            val requests=ManuscriptBuildMapper.build(id,basis,payload,evidence,all,update=job.kind=="update",known=knownMatches(job,basis,all,identityNode))
            val prepared=try {
                studio.prepareManuscript(job.worldId,owner,basis) {
                    val current=owned(id,owner)
                    if(current.status!="running" || current.executionToken!=token) throw WorldConflict()
                    if(current.deadline?.isAfter(Instant.now())!=true) return@prepareManuscript false
                    require(steps.findAllByJobIdOrderBySequence(id).isEmpty())
                    requests.forEachIndexed { index,request ->
                        studio.validateEditRequest(request,basis.cards,basis.relationships)
                        steps.saveAndFlush(ManuscriptBuildLoadStep(jobId=id,sequence=index+1,requestPayload=json(request),requestHash=studio.manuscriptRequestHash(job.worldId,request)))
                    }
                    current.status="loading";jobs.flush();true
                }
            } catch(_:WorldConflict) {
                // 추출하는 동안 세계관이 고정한 입력의 기준에서 바뀌었다(실행권이 이미 없으면 stale의 실패 기록은 거절되고 409만 남는다).
                stale(id,owner,token,"WORLD_CHANGED")
            } catch(_:IllegalArgumentException) {
                // 만든 적재 요청이 초안 편집 검사(허용 키·형식·한도)를 통과하지 못했다. 재개해도 같은 입력이라 같은 거절이니 사유를 남겨 실패로 끝낸다(running으로 남기지 않는다).
                stale(id,owner,token,"CONTENT_REJECTED")
            }
            if(!prepared) stale(id,owner,token,"EXECUTION_EXPIRED")
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
