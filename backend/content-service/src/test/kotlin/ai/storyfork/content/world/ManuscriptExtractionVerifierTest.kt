package ai.storyfork.content.world

import ai.storyfork.content.world.service.*
import org.junit.jupiter.api.Assertions.*
import org.junit.jupiter.api.Test
import tools.jackson.databind.JsonNode
import tools.jackson.databind.json.JsonMapper
import tools.jackson.module.kotlin.KotlinModule

class ManuscriptExtractionVerifierTest {
    private val mapper=JsonMapper.builder().addModule(KotlinModule.Builder().build()).build()
    private fun row()=mapper.readTree(checkNotNull(javaClass.getResourceAsStream("/initial-build/ai-result.json"))).path("extractions").get(0)
    private fun source()=row().let { ManuscriptBuildSource(1,"episode-1","version-1",it.path("title").asString(),it.path("source").asString()) }
    @Test fun `valid source evidence and IDs produce a version bound persisted envelope`() {
        val result=ManuscriptExtractionVerifier.verify(source(),row(),mapper)
        assertEquals(source().hash,result.basis.sourceHash)
        assertTrue(result.evidence.isNotEmpty())
    }
    @Test fun `altered original quote hash and entity references are rejected`() {
        assertThrows(IllegalArgumentException::class.java) { ManuscriptExtractionVerifier.verify(source().copy(body="다른 원고"),row(),mapper) }
        val raw=row().toString()
        assertThrows(IllegalArgumentException::class.java) { ManuscriptExtractionVerifier.verify(source(),mapper.readTree(raw.replace("\"m1\"","\"missing\"",ignoreCase=false).replace("\"id\":\"missing\"","\"id\":\"m1\"")),mapper) }
        val quoteHash=row().path("evidence").get(0).path("quoteHash").asString()
        assertThrows(IllegalArgumentException::class.java) { ManuscriptExtractionVerifier.verify(source(),mapper.readTree(raw.replace(quoteHash,"0".repeat(64))),mapper) }
    }

    // 실제 문체에서 나오는 문장으로 검증기의 문턱을 확인하려고 필요한 근거·해시를 같이 만든다.
    private fun digest(text:String)=java.security.MessageDigest.getInstance("SHA-256").digest(text.toByteArray(Charsets.UTF_8)).joinToString("") { "%02x".format(it.toInt() and 255) }
    private val body="도윤은 계획대로 뒷문을 열었다.\n서하는 어릴 때부터 열쇠를 기억하고 있었다.\n지도 모양의 낙서가 벽에 있었다.\n금기는 밤에 문을 열지 않는 것이다."
    private fun mention(id:String,kind:String,name:String,quote:String)=mapOf("id" to id,"kind" to kind,"name" to name,"quote" to quote)
    private fun statement(id:String,kind:String,subject:String,knower:String?,quote:String,known:Int,occurred:Int?)=mapOf("id" to id,"kind" to kind,
        "certainty" to when(kind) { "goal","plan"->"intended";"conjecture"->"uncertain";else->"asserted" },"subjects" to listOf(subject),
        "knowers" to listOfNotNull(knower),"document" to "memory","occurredEpisode" to occurred,"knownFromEpisode" to known,"quote" to quote)
    private fun natural(mentions:List<Map<String,Any?>>,statements:List<Map<String,Any?>>):JsonNode {
        val quotes=(mentions+statements).map { it["quote"] as String }.distinct()
        return mapper.valueToTree(mapOf("schemaVersion" to "manuscript-extraction.v1","number" to 1,"title" to "제목","source" to body,
            "sourceHash" to digest(mapper.writeValueAsString(sortedMapOf("number" to 1,"title" to "제목","body" to body))),
            "mentions" to mentions,"statements" to statements,"relationships" to emptyList<Any>(),
            "evidence" to quotes.map { q -> body.indexOf(q).let { mapOf("quote" to q,"start" to it,"end" to it+q.length,"quoteHash" to digest(q)) } }))
    }
    private val naturalSource=ManuscriptBuildSource(1,"episode-1","version-1","제목",body)
    private val doyun=mention("d","character","도윤","도윤은 계획대로 뒷문을 열었다.")
    private val seoha=mention("s","character","서하","서하는 어릴 때부터 열쇠를 기억하고 있었다.")

    @Test fun `words such as plan or map shape inside an asserted quote do not reject the episode`() {
        val result=ManuscriptExtractionVerifier.verify(naturalSource,natural(listOf(doyun),listOf(
            statement("s1","event","d","d","도윤은 계획대로 뒷문을 열었다.",1,1),
            statement("s2","description","d",null,"지도 모양의 낙서가 벽에 있었다.",1,null))),mapper)
        assertEquals(setOf("도윤은 계획대로 뒷문을 열었다.","지도 모양의 낙서가 벽에 있었다."),result.evidence.map { it.quote }.toSet())
    }
    @Test fun `a memory from before the story needs no fixed phrase in the quote`() {
        val prestory=statement("s1","fact","s","s","서하는 어릴 때부터 열쇠를 기억하고 있었다.",0,0)
        ManuscriptExtractionVerifier.verify(naturalSource,natural(listOf(seoha),listOf(prestory)),mapper)
        // 시작 전 기억은 memory 문서의 fact이면서 일어난 때가 0일 때만이다.
        assertThrows(IllegalArgumentException::class.java) { ManuscriptExtractionVerifier.verify(naturalSource,natural(listOf(seoha),listOf(prestory+("document" to "identity"))),mapper) }
        assertThrows(IllegalArgumentException::class.java) { ManuscriptExtractionVerifier.verify(naturalSource,natural(listOf(seoha),listOf(prestory+("occurredEpisode" to null))),mapper) }
        assertThrows(IllegalArgumentException::class.java) { ManuscriptExtractionVerifier.verify(naturalSource,natural(listOf(seoha),listOf(prestory+("occurredEpisode" to 1))),mapper) }
        assertThrows(IllegalArgumentException::class.java) { ManuscriptExtractionVerifier.verify(naturalSource,natural(listOf(seoha),listOf(prestory+("kind" to "description"))),mapper) }
    }
    @Test fun `a rule is a valid target kind and an unknown kind is still rejected`() {
        val rule=mention("r","rule","금기","금기는 밤에 문을 열지 않는 것이다.")
        ManuscriptExtractionVerifier.verify(naturalSource,natural(listOf(rule),emptyList()),mapper)
        assertThrows(IllegalArgumentException::class.java) { ManuscriptExtractionVerifier.verify(naturalSource,natural(listOf(rule+("kind" to "ability")),emptyList()),mapper) }
    }
}
