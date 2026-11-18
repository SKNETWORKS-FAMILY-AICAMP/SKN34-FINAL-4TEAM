package ai.storyfork.content.world.service

import ai.storyfork.content.world.service.dto.EditWorldDraftRequest
import ai.storyfork.content.world.service.dto.RelationshipPayload
import ai.storyfork.content.world.service.dto.CreateWorldRequest
import ai.storyfork.content.world.service.dto.SaveWorldRequest
import ai.storyfork.content.world.helper.RelationshipInputHelper
import ai.storyfork.content.world.domain.WorldStudioFailure
import java.security.MessageDigest
import java.util.UUID
import org.slf4j.LoggerFactory
import org.springframework.beans.factory.annotation.Value
import org.springframework.boot.context.event.ApplicationReadyEvent
import org.springframework.context.event.EventListener
import org.springframework.core.annotation.Order
import org.springframework.core.io.ClassPathResource
import org.springframework.stereotype.Component
import tools.jackson.databind.json.JsonMapper
import tools.jackson.module.kotlin.KotlinModule

internal data class ExpandedWorld(val genre:String,val worldId:UUID,val name:String,val description:String,val chunks:List<String>)
internal data class ExpandedChunk(val cards:List<GenreTemplateCard>,val relationships:List<RelationshipPayload>)
internal data class ExpandedManifest(val worlds:List<ExpandedWorld>)
internal data class HistoricalCardFingerprint(val id:UUID,val payloadHash:String)
internal data class HistoricalFingerprint(val genre:String,val worldId:UUID,val createHash:String,val editHash:String,val saveHash:String,val cards:List<HistoricalCardFingerprint>)

internal fun historicalPayloadHash(payload:ai.storyfork.content.world.service.dto.CardPayload,mapper:JsonMapper):String {
    fun canonical(value:Any?):Any? = when(value) {
        is Map<*,*> -> value.entries.associate { (k,v) -> k.toString() to canonical(v) }.toSortedMap()
        is List<*> -> value.map(::canonical)
        else -> value
    }
    val value=mapper.convertValue(payload,Map::class.java)
    return MessageDigest.getInstance("SHA-256").digest(mapper.writeValueAsBytes(canonical(value)))
        .joinToString("") { "%02x".format(it) }
}

internal fun expandedRequests(world:ExpandedWorld,chunks:List<ExpandedChunk>,mapper:JsonMapper=JsonMapper.builder().addModule(KotlinModule.Builder().build()).build()):List<EditWorldDraftRequest> {
    require(chunks.size==world.chunks.size && chunks.all { it.cards.size<=500 && it.relationships.size<=500 })
    val allCards=chunks.flatMap { it.cards }
    require(allCards.size<=10000 && allCards.map { it.id }.distinct().size==allCards.size)
    val relations=chunks.flatMap { it.relationships }
    require(relations.size<=10000 && relations.map { it.id }.distinct().size==relations.size)
    RelationshipInputHelper.validateSnapshot(relations,allCards.map { it.id }.toSet())
    val payloads=GenreTemplateRepair.payloads(GenreTemplate(world.genre,world.worldId,world.name,world.description,allCards))
        .mapIndexed { index,card ->
            val soul=allCards[index].soul
            if(soul==null) card else {
                require(allCards[index].cardType=="character" && soul.isNotBlank() && soul.length<=3000)
                card.copy(semanticMetadata=card.semanticMetadata+("characterDocs" to mapOf("soul" to soul,"goal" to "","episodes" to emptyMap<String,String>())))
            }
        }
    var offset=0
    val batches=chunks.map { chunk -> payloads.subList(offset,offset+chunk.cards.size).also { offset+=chunk.cards.size } }
        .filter { it.isNotEmpty() }.map { it to emptyList<RelationshipPayload>() } +
        chunks.map { it.relationships }.filter { it.isNotEmpty() }.map { emptyList<ai.storyfork.content.world.service.dto.CardPayload>() to it }
    val requests=mutableListOf<EditWorldDraftRequest>()
    for((cards,relationsBatch) in batches) {
        val size=maxOf(cards.size,relationsBatch.size);var start=0
        while(start<size) {
            val index=requests.size
            fun request(end:Int)=EditWorldDraftRequest(index.toLong(),world.name,world.description,
                if(cards.isEmpty()) emptyList() else cards.subList(start,end),
                if(relationsBatch.isEmpty()) emptyList() else relationsBatch.subList(start,end),key="expanded-${world.worldId}-$index")
            var low=start+1;var high=size;var end=start
            while(low<=high) {
                val mid=(low+high)/2
                if(mapper.writeValueAsBytes(request(mid)).size<=1_999_900) { end=mid;low=mid+1 } else high=mid-1
            }
            require(end>start) { "확장 카드 또는 관계가 요청 크기를 초과합니다." }
            requests+=request(end);start=end
        }
    }
    return requests
}

/** Unreviewed research is inert unless explicitly enabled after #425 prerequisites are met. */
@Component
class ExpandedTemplateSeeder(private val service:WorldStudioService,private val mapper:JsonMapper,
    @Value("\${app.worldstudio.expanded-seed-enabled:false}") private val enabled:Boolean) {
    private val log=LoggerFactory.getLogger(javaClass)
    internal fun seedHistorical(world:ExpandedWorld,chunks:List<ExpandedChunk>,original:HistoricalFingerprint) =
        seedWorld(world,chunks,historical=original)

    @EventListener(ApplicationReadyEvent::class)
    @Order(1)
    fun seed() {
        val incomplete=try { service.incompleteExpandedWorldIds() }
            catch(e:Exception) { log.error("미완료 확장 적재 확인 실패",e);return }
        if(!enabled && incomplete.isEmpty()) return
        val manifest=try { ClassPathResource("sample-worlds-expanded/manifest.json").inputStream.use { mapper.readValue(it,ExpandedManifest::class.java) } }
        catch(e:Exception) { log.error("확장 샘플 manifest 읽기 실패",e);return }
        val frozen=try {
            val legacy=GenreTemplateSeeder(service,mapper)
            Triple(legacy.loadLegacy().associateBy { it.worldId },legacy.loadV2().associateBy { it.worldId },legacy.load().associateBy { it.worldId })
        } catch(e:Exception) { log.error("기존 템플릿 확인 실패; 확장 적재 보류",e);return }
        val known=frozen.first.keys+frozen.second.keys+frozen.third.keys
        val historical=try {
            ClassPathResource("genre-templates-history-fingerprints.json").inputStream.use { mapper.readValue(it,Array<HistoricalFingerprint>::class.java).associateBy { t -> t.worldId } }
        } catch(e:Exception) { log.error("옛 역사 동결 리소스 읽기 실패; 적재 보류",e);return }
        if(manifest.worlds.map { it.worldId }.distinct().size!=manifest.worlds.size) {
            log.error("확장 샘플 세계관 ID 중복; 적재 보류");return
        }
        val missing=incomplete-manifest.worlds.map { it.worldId }.toSet()
        if(missing.isNotEmpty()) log.error("미완료 확장 리소스 누락 world={}",missing)
        for(world in manifest.worlds.filter { enabled || it.worldId in incomplete }) {
            try {
                val chunks=world.chunks.map { name ->
                    require(name.matches(Regex("[a-z0-9_-]+\\.json")))
                    val bytes=ClassPathResource("sample-worlds-expanded/$name").inputStream.use { it.readBytes() }
                    require(bytes.size<2_000_000)
                    mapper.readValue(bytes,ExpandedChunk::class.java)
                }
                if(world.worldId in historical) seedHistorical(world,chunks,historical.getValue(world.worldId))
                else if(world.worldId in known) {
                    val legacy=frozen.first[world.worldId];val baseline=frozen.second[world.worldId];val current=frozen.third[world.worldId]
                    if(baseline==null || current==null) { log.warn("기존 확장 샘플 보류 world={}: 원본 누락",world.worldId);continue }
                    seedWorld(world,chunks,legacy,baseline,current)
                } else seedWorld(world,chunks)
            } catch(e:Exception) {
                if(world.worldId in historical && e is WorldStudioFailure && e.reason==WorldStudioFailure.Reason.INCOMPLETE)
                    log.error("역사 세계관 적재 보류 world={}: 미완료 요청의 원래 key/hash와 입력을 보존하고 복구 절차를 확인하세요",world.worldId)
                else log.error("확장 샘플 적재 보류 world={}: {}: {}",world.worldId,e.javaClass.simpleName,e.message)
            }
        }
    }

    internal fun seedWorld(world:ExpandedWorld,chunks:List<ExpandedChunk>,legacy:GenreTemplate?=null,baseline:GenreTemplate?=null,current:GenreTemplate?=null,historical:HistoricalFingerprint?=null) {
        if(historical!=null) {
            require(historical.worldId==world.worldId && historical.genre==world.genre)
            val originalIds=historical.cards.map { it.id }.toSet()
            require(chunks.flatMap { it.cards }.none { it.id in originalIds }) { "옛 역사 카드 ID와 후보 ID 충돌" }
            require(historical.cards.size+chunks.sumOf { it.cards.size }<=10000) { "기존 카드와 후보의 합이 한도를 넘습니다." }
        }
        if(legacy!=null || baseline!=null || current!=null) {
            require(baseline!=null && current!=null)
            val target=chunks.flatMap { it.cards }.associateBy { it.id }
            require(current.cards.all { target[it.id]?.cardType==it.cardType }) { "기존 카드 누락 또는 유형 변경" }
        }
        val requests=expandedRequests(world,chunks,mapper)
        require(requests.isNotEmpty())
        requests.forEach(service::validateEditRequest)
        val inputHash=MessageDigest.getInstance("SHA-256").digest(mapper.writeValueAsBytes(listOf(world,requests)))
            .joinToString("") { "%02x".format(it) }
        val start=if(historical!=null) service.startHistoricalExpanded(CreateWorldRequest(world.name,world.description,world.worldId),inputHash,historical)
            else if(baseline!=null || current!=null || legacy!=null) service.startPristineExpanded(inputHash,legacy,baseline,current)
            else service.startExpanded(CreateWorldRequest(world.name,world.description,world.worldId),inputHash)
        if(start==null) { log.warn("확장 샘플 보류 world={}: 기존 세계관",world.worldId);return }
        if(start<0) return
        require(start<=requests.size)
        val base=service.expandedBase(world.worldId,inputHash,start)
        val adjusted=requests.mapIndexed { index,request -> request.copy(expectedDraftRevision=Math.addExact(base,index.toLong())) }
        adjusted.forEach(service::validateEditRequest)
        for(index in start until adjusted.size) service.editExpanded(world.worldId,inputHash,index,adjusted[index])
        service.saveExpanded(world.worldId,inputHash,adjusted.size,SaveWorldRequest(Math.addExact(base,adjusted.size.toLong()),"expanded-${world.worldId}-save"))
    }
}
