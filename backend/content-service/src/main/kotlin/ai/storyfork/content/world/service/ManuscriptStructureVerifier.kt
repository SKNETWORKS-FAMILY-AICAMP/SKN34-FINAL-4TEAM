package ai.storyfork.content.world.service

import ai.storyfork.content.world.service.dto.*
import java.security.MessageDigest
import tools.jackson.databind.JsonNode
import tools.jackson.databind.json.JsonMapper

/** 업데이트에서 AI 링크를 검증한 결과. [index]는 맞춘 기존 인물(AI에 준 목록의 위치)이고 null이면 새 카드 + 확인 필요다(#952). */
data class KnownMatch(val index:Int?)

/** 구조화 응답이 영속 추출의 정체·문서·기억·관계를 바꾸거나 미래 정보를 소급하지 않는지 검사한다. */
object ManuscriptStructureVerifier {
    /** 인용에 두 이름이 각각 들어 있다. 한 이름이 다른 이름의 일부이면(김치삼·치삼) 짧은 이름이 긴 이름 밖에서도 나와야 한다: '김치삼은 …'만으로는 '치삼'과 같은 사람이라는 근거가 아니다. */
    private fun both(quote:String,a:String,b:String):Boolean {
        val (long,short)=if(a.length>=b.length) a to b else b to a
        return quote.contains(long) && (if(long.contains(short)) quote.replace(long,"") else quote).contains(short)
    }

    /**
     * 업데이트에서 AI가 새 회차의 인물을 기존 인물과 이은 링크(identity.knownLinks)를 요청 카드(key)별 결정으로 검증한다(#952).
     * [known]은 AI에 준 기존 인물(ref "0:k1"부터 같은 순서)의 이름·별칭이다. 구조(기존 인물 ref·인물 대상·쓰는 basis)가 어긋나면 AI가 걸렀어야 할 오류라 거절하고,
     * 근거(인용이 원문에 한 번, 두 이름이 인용에 각각 글자 그대로)·후보 수·같은 사건·관계 동시 등장은 통과하지 못해도 거절하지 않고 새 카드 + 확인 필요(index=null)로 돌린다.
     * 근거를 통과한 distinct만 그 쌍을 후보에서 빼고(근거 없는 것은 기존 정체 정리처럼 없는 링크다) 다른 판단이 없으면 결정을 내지 않는다(표시 없는 새 카드).
     */
    internal fun knownMatches(all:List<ManuscriptEpisodeResult>,identity:JsonNode,known:List<Set<String>>,mapper:JsonMapper):Map<String,KnownMatch> {
        fun array(node:JsonNode)= (0 until node.size()).map { node.get(it) }
        val rows=all.sortedBy { it.basis.number }.associate { it.basis.number to mapper.valueToTree<JsonNode>(it.extraction) }
        val mentions=rows.flatMap { (n,row)->array(row.path("mentions")).map { "$n:${it.path("id").asString()}" to it } }.toMap()
        val mapping=mapper.convertValue(identity.path("mapping"),Map::class.java).entries.associate { it.key.toString() to it.value.toString() }
        class Claim(val index:Int,val basis:String,val right:String,val grounded:Boolean)
        val claims=array(identity.path("knownLinks")).map { link ->
            val left=link.path("left").asString();val right=link.path("right").asString();val basis=link.path("basis").asString()
            val index=Regex("0:k([0-9]+)").matchEntire(left)?.groupValues?.get(1)?.toInt()?.minus(1)
            require(index!=null && index in known.indices && right in mentions && mentions.getValue(right).path("kind").asString()=="character" &&
                basis in setOf("explicit_alias","explicit_coreference","uncertain","distinct") && right in mapping)
            val n=link.path("evidenceEpisode").asInt();val quote=link.path("quote").asString();val source=rows[n]?.path("source")?.asString()
            // 근거는 기존 정체 링크 검증과 같은 조건이다: 근거 회차에서 인용이 원문에 한 번, 새 대상의 이름과 기존 인물의 이름 하나가 인용에 글자 그대로 있다.
            Claim(index,basis,right,source!=null && n==link.path("confirmedAt").asInt() && n>=right.substringBefore(':').toInt() && quote.isNotEmpty() &&
                source.indexOf(quote).let { it>=0 && source.indexOf(quote,it+1)<0 } &&
                mentions.getValue(right).path("name").asString().let { name -> known[index].any { both(quote,name,it) } })
        }
        // 같은 사건(event 진술의 대상)·관계(양 끝)에 함께 나온 두 인물은 다른 사람이다. 한 사람이 같은 사건에 두 이름으로 따로 나오거나 자기 자신과 관계를 맺지 않는다.
        val groups=rows.flatMap { (n,row)->
            array(row.path("statements")).filter { it.path("kind").asString()=="event" }.map { s -> array(s.path("subjects")).map { "$n:${it.asString()}" } } +
                array(row.path("relationships")).map { r -> listOf("$n:${r.path("source").asString()}","$n:${r.path("target").asString()}") }
        }
        fun together(key:String,index:Int):Boolean {
            val own=mentions.keys.filter { mapping[it]==key }.toSet()
            fun alike(ref:String)=mentions.getValue(ref).let { m -> m.path("kind").asString()=="character" &&
                m.path("name").asString().let { name -> known[index].any { it==name || nameKey(it)==nameKey(name) } } }
            return groups.any { group -> group.any { it in own } && group.any { it !in own && it in mentions && alike(it) } }
        }
        return claims.groupBy { mapping.getValue(it.right) }.mapNotNull { (key,list) ->
            val apart=list.filter { it.basis=="distinct" && it.grounded }.map { it.index }.toSet()
            val named=list.filter { it.basis!="distinct" && it.index !in apart }
            if(named.isEmpty()) null
            else key to KnownMatch(named.map { it.index }.distinct().singleOrNull()?.takeIf { index -> named.any { it.grounded && it.basis!="uncertain" } && !together(key,index) })
        }.toMap()
    }

    /** 카드 본문·문서 줄의 표지(계약: kind → 한글). 파이썬 organize와 같은 글자여야 한다. */
    private val KIND_LABEL=mapOf("event" to "사건","description" to "묘사","fact" to "사실","rule" to "규칙","plan" to "계획","goal" to "목표","conjecture" to "추측")
    private fun marked(kind:String,quote:String)="[${KIND_LABEL.getValue(kind)}] $quote"

    /** 사건 카드 제목은 "N화 · 인용 앞 24 코드포인트"다. UTF-16 단위로 자르면 이모지가 깨져 코드포인트로 센다. */
    internal fun eventTitle(number:Int,quote:String):String {
        val head=quote.codePoints().limit(24).toArray()
        return "${number}화 · ${String(head,0,head.size)}"
    }
    /** 호칭 변형(치삼·치삼이·치삼아·치삼은)을 한 이름으로 보는 접미사·조사. 값은 앞 글자의 받침 조건(true 있음·false 없음·null 상관없음)이며 파이썬 `_SUFFIXES`와 같다. */
    private val SUFFIXES=mapOf('이' to true,'아' to true,'야' to false,'은' to true,'을' to true,'는' to false,'를' to false,'가' to false,'의' to null)

    /** 호칭 변형의 기본형: 끝의 접미사·조사를 떼되 두 글자 이상이 남을 때만 뗀다(순이는 그대로). 파이썬 `_base`와 글자까지 같아야 한다. 발행 회차 업데이트의 기존 카드 맞춤([ManuscriptBuildMapper])도 이 함수를 쓴다(#848). */
    internal fun nameKey(name:String):String {
        var base=name
        while(base.length>2 && base.last() in SUFFIXES && base[base.length-2] in '가'..'힣' &&
            SUFFIXES[base.last()].let { it==null || it==((base[base.length-2]-'가')%28>0) }) base=base.dropLast(1)
        return base
    }

    /** 같은 줄은 한 번만, 문서 한도(3,000자) 안에서 앞 회차부터 쌓고 줄은 자르지 않는다. 파이썬 `_fit`과 같다. */
    internal fun fit(lines:List<String>):String {
        var size=-1
        return lines.distinct().takeWhile { size+=it.codePointCount(0,it.length)+1;size<=3000 }.joinToString("\n")
    }

    fun verify(all:List<ManuscriptEpisodeResult>,identity:JsonNode,payload:ManuscriptLoadPayload,mapper:JsonMapper) {
        fun array(node:JsonNode)= (0 until node.size()).map { node.get(it) }
        fun ordered(value:Any?):Any?=when(value) {
            is Map<*,*> -> value.entries.associate { it.key.toString() to ordered(it.value) }.toSortedMap()
            is List<*> -> value.map(::ordered)
            else -> value
        }
        val rows=all.sortedBy { it.basis.number }.associate { it.basis.number to mapper.valueToTree<JsonNode>(it.extraction) }
        require(rows.size==all.size && rows.isNotEmpty())
        val skippedLinks=identity.path("skippedLinks")
        require(skippedLinks.isMissingNode || (skippedLinks.isIntegralNumber && skippedLinks.canConvertToInt() && skippedLinks.asInt()>=0))
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
            // 같은 이름 링크(same_name)는 호칭 변형이면 기본형이 인용에 있으면 된다. 그 밖의 링크는 두 이름이 인용에 글자 그대로 있어야 한다.
            fun shown(ref:String)=mentions.getValue(ref).path("name").asString().let { if(link.path("basis").asString()=="same_name") nameKey(it) else it }
            require(quote.contains(shown(left)) && quote.contains(shown(right)))
            require(mentions.getValue(left).path("kind")==mentions.getValue(right).path("kind"))
            when(decision.path("status").asString()) {
                "merged" -> {
                    require(link.path("basis").asString() in setOf("explicit_alias","explicit_coreference","same_name"))
                    require(nameKey(mentions.getValue(left).path("name").asString())==nameKey(mentions.getValue(right).path("name").asString()))
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
                val line=marked(statement.path("kind").asString(),statement.path("quote").asString())
                val subject=array(statement.path("subjects")).any { mapping["$n:${it.asString()}"]==key }
                val document=statement.path("document").asString()
                // IDENTITY(본문)·GOAL은 첫 등장 회차의 진술만, 인물의 SOUL은 뒤 회차의 soul 진술도 쌓는다(#839).
                if(subject && document in setOf("identity","soul","goal") && (n==first || (document=="soul" && card.cardType=="character"))) {
                    (if(document=="identity" || card.cardType!="character") body else if(document=="soul") soul else goal).add(line)
                }
                if(array(statement.path("knowers")).any { mapping["$n:${it.asString()}"]==key }) {
                    // 시작 전부터 아는 기억(0)은 인물의 첫 등장 회차에서만 00이다. 뒤 회차에서 밝혀진 것은 그 회차 기억이다(소급하지 않는다).
                    val known=if(statement.path("knownFromEpisode").asInt()==0 && n==first) 0 else n
                    memory.getOrPut(known.toString().padStart(2,'0')) { mutableListOf() }.apply { if(line !in this) add(line) }
                }
            }
            // 인물의 IDENTITY는 정체 진술이 없으면 비워 둔다(이름으로 채우면 필수 문서 검사가 빈 문서를 통과시킨다). 다른 카드는 확정 때 본문이 필수라 이름을 둔다.
            require(card.body==(body.distinct().joinToString("\n").ifEmpty { if(card.cardType=="character") "" else card.title }))
            if(card.cardType=="character") require(card.characterDocs==ManuscriptCharacterDocs(fit(soul),goal.distinct().joinToString("\n"),memory.mapValues { it.value.joinToString("\n") }))
            else require(card.characterDocs==null)
        }
        val events=rows.flatMap { (n,row)->array(row.path("statements")).filter { it.path("kind").asString()=="event" }.map { n to it } }
        val eventCards=payload.cards.filter { it.key !in grouped }
        // 제목에 id가 없어 한 회차에서 앞부분이 같은 사건은 제목이 같을 수 있다. (회차, 제목, 본문)의 개수로 대조한다.
        val expected=events.map { (n,event) ->
            val quote=event.path("quote").asString()
            val names=array(event.path("subjects")).map { mapping.getValue("$n:${it.asString()}") }.distinct().sorted().joinToString(", ") { cards.getValue(it).title }
            Triple(n,eventTitle(n,quote),"발생: ${event.path("occurredEpisode").asInt()}화 / 참여: $names\n${marked("event",quote)}")
        }
        require(eventCards.all { it.cardType=="event" && it.aliases.isEmpty() && it.characterDocs==null })
        require(expected.groupingBy { it }.eachCount()==eventCards.map { Triple(it.firstEpisode,it.title,it.body) }.groupingBy { it }.eachCount()) { "MISSING_EVENT" }
        val relations=rows.flatMap { (n,row)->array(row.path("relationships")).map { r -> ManuscriptRelation(mapping.getValue("$n:${r.path("source").asString()}"),mapping.getValue("$n:${r.path("target").asString()}"),r.path("label").asString(),r.path("fromEpisode").asInt(),r.path("ended").asBoolean()) } }
        require(relations.size==payload.relations.size && relations.toSet()==payload.relations.toSet())
    }
}
