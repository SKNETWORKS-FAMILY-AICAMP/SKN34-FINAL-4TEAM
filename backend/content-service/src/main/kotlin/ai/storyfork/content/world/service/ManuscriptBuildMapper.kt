package ai.storyfork.content.world.service

import ai.storyfork.content.world.service.dto.*
import java.util.UUID

/** 최초 빈 세계관에만 추가한다. 기존 대상의 자동 식별·병합과 후보 승인 이력은 만들지 않는다. */
object ManuscriptBuildMapper {
    fun build(job:UUID,draft:WorldDraftResponse,payload:ManuscriptLoadPayload,
        evidence:Map<String,List<Map<String,Any?>>>,sources:List<ManuscriptEpisodeResult> = emptyList()):List<EditWorldDraftRequest> {
        require(draft.cards.isEmpty() && draft.relationships.isEmpty()) { "기존 설정과의 정체 확인이 필요합니다." }
        require(payload.cards.isNotEmpty() && payload.cards.size<=1000)
        require(payload.cards.map { it.key }.distinct().size==payload.cards.size)
        fun id(key:String)=UUID.nameUUIDFromBytes("manuscript:$job:$key".toByteArray(Charsets.UTF_8))
        val ids=payload.cards.associate { it.key to id("card:${it.key}") }
        fun metadata(key:String,id:UUID,title:String,text:String,kind:String,area:String,type:String?,first:Int,
            source:UUID?=null,target:UUID?=null,aliases:List<String> = emptyList()):Map<String,Any?> {
            val proof=(if(kind=="relation") evidence["$key:$first"] else evidence[key]).orEmpty()
            return mapOf("manuscriptBuild" to mapOf("jobId" to job.toString(),"key" to key,
                "provenance" to "manuscript_extraction","evidence" to proof),
                "studio" to mapOf("userCategory" to "","tags" to emptyList<String>(),"aliases" to aliases,
                    "item" to mapOf("id" to id.toString(),"kind" to kind,"title" to title,"text" to text,"category" to area,
                        "topics" to emptyList<String>(),"entityType" to type,"subjectId" to source?.toString(),"targetId" to target?.toString(),
                        "predicate" to if(kind=="relation") "custom_relation_directed" else null,"polarity" to "asserted",
                        "relatedIds" to emptyList<String>(),"condition" to "","timeText" to "","afterId" to null,
                        "orderEvidence" to emptyList<String>(),"evidence" to proof.map { mapOf("sourceId" to it["sourceId"],"quote" to it["quote"]) },
                        "origin" to "extraction","authorText" to null,"decision" to "approved")))
        }
        val byEpisode=sources.associateBy { it.basis.number }
        val cards=payload.cards.map { c ->
            require(c.key.isNotBlank() && c.cardType in setOf("character","location","organization","object","event"))
            require(c.firstEpisode>0 && c.title.isNotBlank() && c.title.length<=200 && c.body.length<=3000)
            require(c.aliases.distinct().size==c.aliases.size && c.aliases.all { it.isNotBlank() && it.length<=200 })
            c.characterDocs?.let { docs ->
                require(c.cardType=="character" && docs.soul.length<=3000 && docs.goal.length<=3000)
                require(docs.episodes.all { (k,v)->k.matches(Regex("[0-9]{2,}")) && v.length<=3000 })
                require(docs.episodes.keys.all { it.toIntOrNull()!=null })
                require(docs.episodes.keys.map { it.toInt() }.distinct().size==docs.episodes.size)
            }
            val area=when(c.cardType) { "location"->"space";"organization"->"society";"event"->"history";else->"basic" }
            val meta=metadata(c.key,ids.getValue(c.key),c.title,c.body,if(c.cardType=="event") "event" else "entity",area,
                if(c.cardType=="event") null else c.cardType,c.firstEpisode,aliases=c.aliases).toMutableMap()
            val candidates=payload.identityCandidates.filter { it.fromKey==c.key }.map { candidate ->
                val result=byEpisode.getValue(candidate.episode)
                val text=result.extraction.getValue("source") as String
                val start=text.indexOf(candidate.quote)
                require(candidate.quote.isNotEmpty() && start>=0 && text.indexOf(candidate.quote,start+1)<0)
                mapOf("sourceId" to result.basis.versionId,"sourceHash" to result.basis.sourceHash,
                    "start" to start,"end" to start+candidate.quote.length,"fromCardId" to ids.getValue(c.key).toString(),"toCardId" to ids.getValue(candidate.toKey).toString(),
                    "episode" to candidate.episode,"quote" to candidate.quote)
            }
            meta["preprocessing"]=mapOf("firstEpisode" to c.firstEpisode,"identityCandidates" to candidates)
            c.characterDocs?.let { docs -> meta["characterDocs"]=mapOf("soul" to docs.soul,"goal" to docs.goal,
                "episodes" to docs.episodes.mapKeys { (number,_)->number.toInt().toString() }) }
            CardPayload(ids.getValue(c.key),c.title,c.body,c.cardType,area,aliases=c.aliases,semanticMetadata=meta)
        }
        val active=mutableSetOf<String>()
        val updates=payload.relations.sortedBy { it.fromEpisode }.map { r ->
            require(r.fromEpisode>0 && r.fromKey in ids && r.toKey in ids && r.fromKey!=r.toKey && r.label.isNotBlank() && r.label.length<=200)
            val key="relation:${r.fromKey.length}:${r.fromKey}:${r.toKey.length}:${r.toKey}:${r.label}"
            require(if(r.ended) active.remove(key) else active.add(key)) { "관계 시작·종료 순서가 올바르지 않습니다." }
            r.fromEpisode to RelationshipPayload(id(key),ids.getValue(r.fromKey),ids.getValue(r.toKey),"structural",r.label,r.label,"directed","asserted",
                metadata(key,id(key),r.label,r.label,"relation","basic",null,r.fromEpisode,ids.getValue(r.fromKey),ids.getValue(r.toKey)),
                if(r.ended) "removed" else "active")
        }
        require(updates.map { it.first to it.second.id }.distinct().size==updates.size)
        val episodes=(listOf(1)+updates.map { it.first }).distinct().sorted()
        return episodes.mapIndexed { index,episode ->
            EditWorldDraftRequest(Math.addExact(draft.draftRevision,index.toLong()),draft.name,draft.description,
                if(index==0) cards else emptyList(),updates.filter { it.first==episode }.map { it.second },"manuscript:$job:$episode",false,episode)
        }
    }
}
