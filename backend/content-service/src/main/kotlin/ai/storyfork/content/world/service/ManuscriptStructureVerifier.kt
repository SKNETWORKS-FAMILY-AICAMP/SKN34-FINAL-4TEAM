package ai.storyfork.content.world.service

import ai.storyfork.content.world.service.dto.*
import java.security.MessageDigest
import tools.jackson.databind.JsonNode
import tools.jackson.databind.json.JsonMapper

/** 구조화 응답이 영속 추출의 정체·문서·기억·관계를 바꾸거나 미래 정보를 소급하지 않는지 검사한다. */
object ManuscriptStructureVerifier {
    fun verify(all:List<ManuscriptEpisodeResult>,identity:JsonNode,payload:ManuscriptLoadPayload,mapper:JsonMapper) {
        fun array(node:JsonNode)= (0 until node.size()).map { node.get(it) }
        fun ordered(value:Any?):Any?=when(value) {
            is Map<*,*> -> value.entries.associate { it.key.toString() to ordered(it.value) }.toSortedMap()
            is List<*> -> value.map(::ordered)
            else -> value
        }
        val rows=all.sortedBy { it.basis.number }.associate { it.basis.number to mapper.valueToTree<JsonNode>(it.extraction) }
        require(rows.size==all.size && rows.isNotEmpty())
        val hashes=mapper.convertValue(identity.path("inputHashes"),Map::class.java)
        require(hashes.size==rows.size)
        all.forEach { result ->
            val digest=MessageDigest.getInstance("SHA-256").digest(mapper.writeValueAsBytes(ordered(result.extraction))).joinToString("") { "%02x".format(it.toInt() and 255) }
            require(hashes[result.basis.number.toString()]==digest)
        }
        val mentions=rows.flatMap { (n,row)->array(row.path("mentions")).map { "$n:${it.path("id").asString()}" to it } }.toMap()
        val mapping=mapper.convertValue(identity.path("mapping"),Map::class.java).entries.associate { it.key.toString() to it.value.toString() }
        require(mapping.keys==mentions.keys && mapping.values.all { it.isNotBlank() })
        val parent=mentions.keys.associateWith { it }.toMutableMap()
        fun root(ref:String):String { var at=ref;while(parent.getValue(at)!=at) at=parent.getValue(at);return at }
        val candidates=linkedMapOf<Pair<String,String>,ManuscriptIdentityCandidate>()
        val distinct=mutableListOf<Pair<String,String>>()
        for(decision in array(identity.path("decisions"))) {
            val link=decision.path("link");val left=link.path("left").asString();val right=link.path("right").asString()
            require(left in mentions && right in mentions && left!=right)
            val n=link.path("evidenceEpisode").asInt();val quote=link.path("quote").asString()
            require(n in rows && n==link.path("confirmedAt").asInt() && n>=maxOf(left.substringBefore(':').toInt(),right.substringBefore(':').toInt()))
            val source=rows.getValue(n).path("source").asString();val start=source.indexOf(quote)
            require(quote.isNotEmpty() && start>=0 && source.indexOf(quote,start+1)<0)
            require(quote.contains(mentions.getValue(left).path("name").asString()) && quote.contains(mentions.getValue(right).path("name").asString()))
            require(mentions.getValue(left).path("kind")==mentions.getValue(right).path("kind"))
            when(decision.path("status").asString()) {
                "merged" -> {
                    require(link.path("basis").asString() in setOf("explicit_alias","explicit_coreference"))
                    require(mentions.getValue(left).path("name")==mentions.getValue(right).path("name"))
                    parent[root(right)]=root(left)
                }
                "distinct" -> { require(link.path("basis").asString()=="distinct");distinct+=left to right }
                "deferred" -> {
                    val basis=link.path("basis").asString()
                    if(basis in setOf("explicit_alias","explicit_coreference") && mentions.getValue(left).path("kind").asString()=="character") {
                        require(mentions.getValue(left).path("name")!=mentions.getValue(right).path("name"))
                        val from=mapping.getValue(right);val to=mapping.getValue(left)
                        require(from!=to && decision.path("reason").asString()=="AUTHOR_REVIEW_REQUIRED")
                        candidates.putIfAbsent(from to to,ManuscriptIdentityCandidate(from,to,n,quote))
                    }
                }
                else -> throw IllegalArgumentException("INVALID_IDENTITY_DECISION")
            }
        }
        require(payload.identityCandidates==candidates.values.toList())
        require(distinct.all { (a,b)->root(a)!=root(b) })
        require(parent.keys.groupBy(::root).values.map { it.toSet() }.toSet()==mapping.keys.groupBy { mapping.getValue(it) }.values.map { it.toSet() }.toSet())
        val cards=payload.cards.associateBy { it.key };require(cards.size==payload.cards.size)
        val grouped=mapping.keys.groupBy { mapping.getValue(it) }
        for((key,refs) in grouped) {
            val card=requireNotNull(cards[key]);val sorted=refs.sortedWith(compareBy<String> { it.substringBefore(':').toInt() }.thenBy { it.substringAfter(':') })
            val first=sorted.first().substringBefore(':').toInt();val original=mentions.getValue(sorted.first())
            require(card.firstEpisode==first && card.title==original.path("name").asString() && card.cardType==original.path("kind").asString())
            require(card.aliases==sorted.map { mentions.getValue(it).path("name").asString() }.distinct().filter { it!=card.title })
            val body=mutableListOf<String>();val soul=mutableListOf<String>();val goal=mutableListOf<String>();val memory=linkedMapOf<String,MutableList<String>>()
            for((n,row) in rows) for(statement in array(row.path("statements"))) {
                val line="[${statement.path("kind").asString()}] ${statement.path("quote").asString()}"
                val subject=array(statement.path("subjects")).any { mapping["$n:${it.asString()}"]==key }
                val document=statement.path("document").asString()
                if(n==first && subject && document in setOf("identity","soul","goal")) {
                    (if(document=="identity" || card.cardType!="character") body else if(document=="soul") soul else goal).add(line)
                }
                if(array(statement.path("knowers")).any { mapping["$n:${it.asString()}"]==key }) {
                    val known=statement.path("knownFromEpisode").asInt()
                    require(known!=0 || n==first)
                    memory.getOrPut(known.toString().padStart(2,'0')) { mutableListOf() }.apply { if(line !in this) add(line) }
                }
            }
            require(card.body==(body.distinct().joinToString("\n").ifEmpty { card.title }))
            if(card.cardType=="character") require(card.characterDocs==ManuscriptCharacterDocs(soul.distinct().joinToString("\n"),goal.distinct().joinToString("\n"),memory.mapValues { it.value.joinToString("\n") }))
            else require(card.characterDocs==null)
        }
        val events=rows.flatMap { (n,row)->array(row.path("statements")).filter { it.path("kind").asString()=="event" }.map { n to it } }
        val eventCards=payload.cards.filter { it.key !in grouped }
        require(eventCards.size==events.size)
        for((n,event) in events) {
            val title="${n}화 사건 ${event.path("id").asString()}"
            val card=eventCards.singleOrNull { it.title==title } ?: throw IllegalArgumentException("MISSING_EVENT")
            val names=array(event.path("subjects")).map { mapping.getValue("$n:${it.asString()}") }.distinct().sorted().joinToString(", ") { cards.getValue(it).title }
            require(card.cardType=="event" && card.firstEpisode==n && card.aliases.isEmpty() && card.characterDocs==null)
            require(card.body=="발생: ${event.path("occurredEpisode").asInt()}화 / 참여: $names\n[event] ${event.path("quote").asString()}")
        }
        val relations=rows.flatMap { (n,row)->array(row.path("relationships")).map { r -> ManuscriptRelation(mapping.getValue("$n:${r.path("source").asString()}"),mapping.getValue("$n:${r.path("target").asString()}"),r.path("label").asString(),r.path("fromEpisode").asInt(),r.path("ended").asBoolean()) } }
        require(relations.size==payload.relations.size && relations.toSet()==payload.relations.toSet())
    }
}
