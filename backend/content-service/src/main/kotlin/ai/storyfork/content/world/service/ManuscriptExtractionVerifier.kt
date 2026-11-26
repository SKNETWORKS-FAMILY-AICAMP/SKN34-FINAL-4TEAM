package ai.storyfork.content.world.service

import java.security.MessageDigest
import tools.jackson.databind.JsonNode
import tools.jackson.databind.json.JsonMapper

/** AI 반환 원문·근거·참조·의미를 고정 저장본과 대조한다. 의미적 사실성을 보증하지는 않는다. */
object ManuscriptExtractionVerifier {
    fun verify(source:ManuscriptBuildSource,node:JsonNode,mapper:JsonMapper):ManuscriptEpisodeResult {
        fun digest(text:String)=MessageDigest.getInstance("SHA-256").digest(text.toByteArray(Charsets.UTF_8)).joinToString("") { "%02x".format(it.toInt() and 255) }
        fun rows(name:String):List<JsonNode> {
            val array=node.path(name);require(array.isArray)
            return (0 until array.size()).map { array.get(it) }
        }
        fun refs(row:JsonNode,name:String):List<String> {
            val array=row.path(name);require(array.isArray)
            return (0 until array.size()).map { array.get(it).asString() }.also { require(it.distinct().size==it.size) }
        }
        require(node.path("schemaVersion").asString()=="manuscript-extraction.v1")
        require(node.path("number").asInt()==source.number && node.path("title").asString()==source.title && node.path("source").asString()==source.body)
        require(node.path("sourceHash").asString()==digest(mapper.writeValueAsString(sortedMapOf("number" to source.number,"title" to source.title,"body" to source.body))))
        val mentions=rows("mentions");val statements=rows("statements");val relations=rows("relationships")
        val all=mentions+statements+relations
        val ids=all.map { it.path("id").asString() }
        require(ids.distinct().size==ids.size && ids.all { it.matches(Regex("[a-zA-Z][a-zA-Z0-9_-]{0,63}")) })
        val entities=mentions.associateBy { it.path("id").asString() }
        mentions.forEach {
            require(it.path("kind").asString() in setOf("character","location","organization","object","rule"))
            require(it.path("name").asString().isNotBlank() && it.path("quote").asString().contains(it.path("name").asString()))
        }
        statements.forEach { row ->
            val kind=row.path("kind").asString();val quote=row.path("quote").asString()
            require(kind in setOf("event","description","rule","fact","conjecture","goal","plan"))
            val subjects=refs(row,"subjects");val knowers=refs(row,"knowers")
            require(subjects.isNotEmpty() && (subjects+knowers).all { it in entities })
            require(knowers.all { entities.getValue(it).path("kind").asString()=="character" && quote.contains(entities.getValue(it).path("name").asString()) })
            val expected=when(kind) { "goal","plan"->"intended";"conjecture"->"uncertain";else->"asserted" }
            require(row.path("certainty").asString()==expected)
            val occurred=row.path("occurredEpisode")
            require(occurred.isNull || (occurred.isIntegralNumber && occurred.asInt() in 0..source.number))
            if(kind in setOf("goal","plan","conjecture")) require(occurred.isNull)
            if(kind=="event") require(!occurred.isNull)
            val known=row.path("knownFromEpisode").asInt()
            require(known==source.number || (known==0 && kind=="fact" && row.path("document").asString()=="memory" &&
                occurred.isIntegralNumber && occurred.asInt()==0))
        }
        relations.forEach { row ->
            val from=row.path("source").asString();val to=row.path("target").asString()
            require(from in entities && to in entities && from!=to && row.path("label").asString().isNotBlank())
            require(row.path("fromEpisode").asInt()==source.number)
            require(row.path("change").asString()==if(row.path("ended").asBoolean()) "ended" else "started")
        }
        val evidence=rows("evidence").map { row ->
            val quote=row.path("quote").asString();val start=row.path("start").asInt();val end=row.path("end").asInt()
            source.requireQuote(start,end,quote)
            require(row.path("quoteHash").asString()==digest(quote))
            ManuscriptQuote(start,end,quote)
        }
        require(evidence.map { it.quote }.distinct().size==evidence.size)
        require(evidence.map { it.quote }.toSet()==all.map { it.path("quote").asString() }.toSet())
        @Suppress("UNCHECKED_CAST")
        val extraction=mapper.readValue(mapper.writeValueAsBytes(node),Map::class.java) as Map<String,Any?>
        return ManuscriptEpisodeResult(ManuscriptBuildResultBasis(source.number,source.versionId,source.hash),evidence,extraction)
    }
}
