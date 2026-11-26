package ai.storyfork.content.world.service

import ai.storyfork.content.world.service.dto.*
import java.util.UUID

/**
 * 최초 구축은 빈 세계관에만 추가한다. 기존 대상의 자동 식별·병합과 후보 승인 이력은 만들지 않는다.
 * [build]의 update는 발행 회차를 세계관 초안에 더하는 작업(2026-11-22)이며 이때만 기존 카드와 [match]로 맞춘다: 같은 대상이면 인물 기억만 더하고 그 밖은 새 카드다.
 */
object ManuscriptBuildMapper {
    fun build(job:UUID,draft:WorldDraftResponse,payload:ManuscriptLoadPayload,
        evidence:Map<String,List<Map<String,Any?>>>,sources:List<ManuscriptEpisodeResult> = emptyList(),update:Boolean=false):List<EditWorldDraftRequest> {
        require(update || (draft.cards.isEmpty() && draft.relationships.isEmpty())) { "기존 설정과의 정체 확인이 필요합니다." }
        require(payload.cards.isNotEmpty() && payload.cards.size<=1000)
        require(payload.cards.map { it.key }.distinct().size==payload.cards.size)
        fun id(key:String)=UUID.nameUUIDFromBytes("manuscript:$job:$key".toByteArray(Charsets.UTF_8))
        val matching=if(update) match(draft,payload.cards) else Matching(emptyMap(),emptySet())
        val ids=payload.cards.associate { it.key to (matching.existing[it.key]?.id ?: id("card:${it.key}")) }
        fun metadata(key:String,id:UUID,title:String,text:String,kind:String,area:String,type:String?,first:Int,
            source:UUID?=null,target:UUID?=null,aliases:List<String> = emptyList(),review:Boolean=false):Map<String,Any?> {
            val proof=(if(kind=="relation") evidence["$key:$first"] else evidence[key]).orEmpty()
            return mapOf("manuscriptBuild" to (mapOf("jobId" to job.toString(),"key" to key,
                "provenance" to "manuscript_extraction","evidence" to proof)+if(review) mapOf("needsReview" to true) else emptyMap()),
                "studio" to mapOf("userCategory" to "","tags" to emptyList<String>(),"aliases" to aliases,
                    "item" to mapOf("id" to id.toString(),"kind" to kind,"title" to title,"text" to text,"category" to area,
                        "topics" to emptyList<String>(),"entityType" to type,"subjectId" to source?.toString(),"targetId" to target?.toString(),
                        "predicate" to if(kind=="relation") "custom_relation_directed" else null,"polarity" to "asserted",
                        "relatedIds" to emptyList<String>(),"condition" to "","timeText" to "","afterId" to null,
                        "orderEvidence" to emptyList<String>(),"evidence" to proof.map { mapOf("sourceId" to it["sourceId"],"quote" to it["quote"]) },
                        "origin" to "extraction","authorText" to null,"decision" to "approved")))
        }
        val byEpisode=sources.associateBy { it.basis.number }
        val cards=payload.cards.mapNotNull { c ->
            require(c.key.isNotBlank() && c.cardType in setOf("character","location","organization","object","rule","event"))
            require(c.firstEpisode>0 && c.title.isNotBlank() && c.title.length<=200 && c.body.length<=3000)
            require(c.aliases.distinct().size==c.aliases.size && c.aliases.all { it.isNotBlank() && it.length<=200 })
            c.characterDocs?.let { docs ->
                require(c.cardType=="character" && docs.soul.length<=3000 && docs.goal.length<=3000)
                require(docs.episodes.all { (k,v)->k.matches(Regex("[0-9]{2,}")) && v.length<=3000 })
                require(docs.episodes.keys.all { it.toIntOrNull()!=null })
                require(docs.episodes.keys.map { it.toInt() }.distinct().size==docs.episodes.size)
            }
            matching.existing[c.key]?.let { old -> return@mapNotNull remember(old,c) }
            val area=when(c.cardType) { "location"->"space";"organization"->"society";"event"->"history";"rule"->"special";else->"basic" }
            val kind=when(c.cardType) { "event"->"event";"rule"->"rule";else->"entity" }
            val meta=metadata(c.key,ids.getValue(c.key),c.title,c.body,kind,area,
                if(kind=="entity") c.cardType else null,c.firstEpisode,aliases=c.aliases,review=c.key in matching.review).toMutableMap()
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
        val updates=payload.relations.sortedBy { it.fromEpisode }.mapNotNull { r ->
            require(r.fromEpisode>0 && r.fromKey in ids && r.toKey in ids && r.fromKey!=r.toKey && r.label.isNotBlank() && r.label.length<=200)
            val key="relation:${r.fromKey.length}:${r.fromKey}:${r.toKey.length}:${r.toKey}:${r.label}"
            // 이미 이어진 관계의 재시작과 시작이 기록되지 않은 종료는 싣지 않는다. 다른 관계를 대신 끝내지도 않는다.
            if(!(if(r.ended) active.remove(key) else active.add(key))) return@mapNotNull null
            // 관계 설명(body)은 근거 인용 그대로이고 label은 관계명이다. 근거가 없으면(검증 전 시험 호출) 관계명으로 둔다.
            val quote=evidence["$key:${r.fromEpisode}"].orEmpty().firstNotNullOfOrNull { it["quote"] as? String } ?: r.label
            r.fromEpisode to RelationshipPayload(id(key),ids.getValue(r.fromKey),ids.getValue(r.toKey),"structural",quote,r.label,"directed","asserted",
                metadata(key,id(key),r.label,quote,"relation","basic",null,r.fromEpisode,ids.getValue(r.fromKey),ids.getValue(r.toKey)),
                if(r.ended) "removed" else "active")
        }
        require(updates.map { it.first to it.second.id }.distinct().size==updates.size)
        val episodes=(listOf(1)+updates.map { it.first }).distinct().sorted()
        return episodes.mapIndexed { index,episode ->
            EditWorldDraftRequest(Math.addExact(draft.draftRevision,index.toLong()),draft.name,draft.description,
                if(index==0) cards else emptyList(),updates.filter { it.first==episode }.map { it.second },"manuscript:$job:$episode",false,episode)
        }
    }

    /** [existing]은 같은 대상으로 맞춘 기존 카드(요청 카드 key별), [review]는 자동으로 맞추지 못해 새 카드로 더하며 확인 필요로 표시할 요청 카드 key다. */
    private class Matching(val existing:Map<String,CardPayload>,val review:Set<String>)

    /**
     * 종류가 같고 이름(제목·별칭)이 하나라도 같은 활성 카드가 **정확히 하나**일 때만 같은 대상이다(사건 카드는 늘 새 카드).
     * 이름이 같은 카드가 없는 요청 카드만 호칭 변형(치삼·치삼이)도 같은 이름으로 본다(#848): 최초 구축의 같은 이름 병합(#839)과 같은 [ManuscriptStructureVerifier.nameKey]다.
     * 둘 이상(변형 후보 포함)이거나 한 기존 카드를 요청 카드 여럿이 노리면 자동으로 합치지 않고 새 카드로 더하며 확인 필요로 표시한다.
     * 단 이름이 같은 요청 카드끼리만 겨루고, 변형으로 노리는 요청 카드는 같은 카드를 후보로 보는 다른 요청 카드가 있으면 물러난다(같은 회차의 '치삼'과 '치삼이'는 AI가 일부러 가른 것이다).
     */
    private fun match(draft:WorldDraftResponse,cards:List<ManuscriptCard>):Matching {
        fun names(title:String,aliases:List<String>)=(listOf(title)+aliases).map { it.trim() }.filter { it.isNotEmpty() }.toSet()
        val active=draft.cards.filter { it.lifecycle=="active" }
        fun candidates(c:ManuscriptCard,normalize:(String)->String):List<CardPayload> {
            val wanted=names(c.title,c.aliases).map(normalize)
            return active.filter { it.cardType==c.cardType && names(it.title,it.aliases).any { name -> normalize(name) in wanted } }
        }
        val requests=cards.filter { it.cardType!="event" }
        val exact=requests.associate { it.key to candidates(it) { name -> name } }
        val found=requests.associate { it.key to exact.getValue(it.key).ifEmpty { candidates(it,ManuscriptStructureVerifier::nameKey) } }
        val claimed=exact.values.mapNotNull { it.singleOrNull()?.id }.groupingBy { it }.eachCount()
        val seen=found.values.flatten().groupingBy { it.id }.eachCount()
        val unique=found.filter { (key,hits)->hits.size==1 && (if(exact.getValue(key).isEmpty()) seen else claimed).getValue(hits.single().id)==1 }
        return Matching(unique.mapValues { it.value.single() },found.filter { it.key !in unique && it.value.isNotEmpty() }.keys)
    }

    /**
     * 맞춘 기존 카드에 인물 기억(characterDocs.episodes)에서 아직 없는 회차 키만 더한다. 요청의 00(시작 전) 기억은 이 인물이 이 작업에서 처음 등장한 회차의 기억으로 옮긴다
     * (작업의 첫 회차로 옮기면 뒤 회차 내용이 앞 회차 독자에게 먼저 보인다). 본문·제목·별칭·SOUL·GOAL·공개 설정·그 밖의 메타데이터는 그대로이고 더할 키가 없으면 null이다.
     */
    private fun remember(old:CardPayload,c:ManuscriptCard):CardPayload? {
        val docs=c.characterDocs ?: return null
        val moved=docs.episodes.entries.groupBy({ (key,_)->key.toInt().let { if(it==0) c.firstEpisode else it }.toString() },{ it.value }).mapValues { it.value.joinToString("\n") }
        val current:Map<String,Any?> = (old.semanticMetadata["characterDocs"] as? Map<*,*>)?.entries?.associate { it.key.toString() to it.value } ?: emptyMap()
        val kept:Map<String,Any?> = (current["episodes"] as? Map<*,*>)?.entries?.associate { it.key.toString() to it.value } ?: emptyMap()
        val added=moved.filterKeys { it !in kept }
        if(added.isEmpty()) return null
        val base:Map<String,Any?> = mapOf("soul" to "","goal" to "")
        return old.copy(semanticMetadata=old.semanticMetadata+("characterDocs" to (base+current+("episodes" to (kept+added)))))
    }
}
