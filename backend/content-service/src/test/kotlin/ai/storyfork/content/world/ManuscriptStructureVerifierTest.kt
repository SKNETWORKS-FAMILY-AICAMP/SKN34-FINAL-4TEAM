package ai.storyfork.content.world

import ai.storyfork.content.world.service.*
import ai.storyfork.content.world.service.dto.*
import org.junit.jupiter.api.Assertions.*
import org.junit.jupiter.api.Test
import tools.jackson.databind.JsonNode
import tools.jackson.databind.json.JsonMapper
import tools.jackson.databind.node.ObjectNode
import tools.jackson.module.kotlin.KotlinModule

class ManuscriptStructureVerifierTest {
    private val mapper=JsonMapper.builder().addModule(KotlinModule.Builder().build()).build()
    private val fixture=mapper.readTree(checkNotNull(javaClass.getResourceAsStream("/initial-build/ai-result.json")))
    private fun extractionsOf(fixture:JsonNode)=(0 until fixture.path("extractions").size()).map { i ->
        val node=fixture.path("extractions").get(i)
        ManuscriptExtractionVerifier.verify(ManuscriptBuildSource(node.path("number").asInt(),"episode-$i","version-$i",node.path("title").asString(),node.path("source").asString()),node,mapper)
    }
    private val all=extractionsOf(fixture)
    private val payload=mapper.convertValue(fixture.path("payload"),ManuscriptLoadPayload::class.java)
    @Test fun `four episodes preserve identity documents knowledge and relation changes`() {
        ManuscriptStructureVerifier.verify(all,fixture.path("identity"),payload,mapper)
    }
    @Test fun `missing forged and repeated identity suggestions cannot be loaded`() {
        val original=payload.identityCandidates.single()
        for (candidates in listOf(emptyList(),listOf(original,original),listOf(original.copy(quote="근거 없음")),
            listOf(original.copy(episode=2)),listOf(original.copy(toKey=original.fromKey)))) {
            assertThrows(IllegalArgumentException::class.java) {
                ManuscriptStructureVerifier.verify(all,fixture.path("identity"),payload.copy(identityCandidates=candidates),mapper)
            }
        }
    }
    @Test fun `later goal in global document foreign memory and removed evidence are rejected`() {
        val hero=payload.cards.first { it.title=="길동" }
        fun changed(card:ManuscriptCard)=payload.copy(cards=payload.cards.map { if(it.key==hero.key) card else it })
        assertThrows(IllegalArgumentException::class.java) { ManuscriptStructureVerifier.verify(all,fixture.path("identity"),changed(hero.copy(characterDocs=hero.characterDocs!!.copy(goal="[goal] 길동은 이제 백성을 다스리고 싶어 했다."))),mapper) }
        assertThrows(IllegalArgumentException::class.java) { ManuscriptStructureVerifier.verify(all,fixture.path("identity"),changed(hero.copy(characterDocs=hero.characterDocs!!.copy(episodes=hero.characterDocs.episodes+("01" to "길동만이 비밀 지도를 보았다.")))),mapper) }
        assertThrows(IllegalArgumentException::class.java) { ManuscriptStructureVerifier.verify(all.dropLast(1),fixture.path("identity"),payload,mapper) }
    }

    @Test fun `an unchanged name in a later episode may be merged by the program as same_name`() {
        val identity=mapper.readTree(fixture.path("identity").toString())
        val merged=array(identity.path("decisions")).filter { it.path("status").asString()=="merged" }
        assertTrue(merged.isNotEmpty())
        merged.forEach { (it.path("link") as ObjectNode).put("basis","same_name") }
        ManuscriptStructureVerifier.verify(all,identity,payload,mapper)
        (merged.first().path("link") as ObjectNode).put("basis","name_only")
        assertThrows(IllegalArgumentException::class.java) { ManuscriptStructureVerifier.verify(all,identity,payload,mapper) }
    }
    @Test fun `a pre-story memory in a later episode is kept in that episode's memory instead of failing`() {
        val rows=array(fixture.path("extractions")).map { mapper.readTree(it.toString()) }
        val third=rows.first { it.path("number").asInt()==3 }
        (third.path("statements").get(2) as ObjectNode).put("knownFromEpisode",0).put("occurredEpisode",0)
        val identity=mapper.readTree(fixture.path("identity").toString())
        val results=rows.map { row ->
            val n=row.path("number").asInt()
            ManuscriptExtractionVerifier.verify(ManuscriptBuildSource(n,"episode-$n","version-$n",row.path("title").asString(),row.path("source").asString()),row,mapper)
        }
        results.forEach { (identity.path("inputHashes") as ObjectNode).put(it.basis.number.toString(),inputHash(it.extraction)) }
        ManuscriptStructureVerifier.verify(results,identity,payload,mapper)
        val hero=payload.cards.first { it.title=="길동" }
        assertTrue(hero.characterDocs!!.episodes.getValue("03").contains("길동만이 비밀 지도를 보았다."))
        assertFalse(hero.characterDocs.episodes.getValue("00").contains("길동만이 비밀 지도를 보았다."))
    }
    @Test fun `an event card title is the episode and the first 24 code points of its quote`() {
        assertEquals("3화 · 길동은 산을 넘었다.",ManuscriptStructureVerifier.eventTitle(3,"길동은 산을 넘었다."))
        assertEquals("12화 · "+"가".repeat(24),ManuscriptStructureVerifier.eventTitle(12,"가".repeat(30)))
        // UTF-16 단위로 자르면 이모지가 반으로 깨진다.
        assertEquals("1화 · "+"😀".repeat(24),ManuscriptStructureVerifier.eventTitle(1,"😀".repeat(30)))
    }
    // 호칭 변형·뒤 회차 SOUL·빈 인물 본문 시나리오(#839): 파이썬 service.organize가 만든 ai-result-variants.json이다(1화 '치삼이' → 2·3화 '치삼').
    private val scenario=mapper.readTree(checkNotNull(javaClass.getResourceAsStream("/initial-build/ai-result-variants.json")))
    private val scenarioAll=extractionsOf(scenario)
    private val scenarioPayload=mapper.convertValue(scenario.path("payload"),ManuscriptLoadPayload::class.java)
    private fun verifyScenario(payload:ManuscriptLoadPayload=scenarioPayload,identity:JsonNode=scenario.path("identity"))=ManuscriptStructureVerifier.verify(scenarioAll,identity,payload,mapper)

    @Test fun `a name variant is merged by the program while later soul accumulates and an identity-less character keeps an empty body`() {
        verifyScenario()
        val hero=scenarioPayload.cards.first { it.cardType=="character" }
        assertEquals(listOf("치삼이","치삼"),listOf(hero.title)+hero.aliases)
        assertEquals("",hero.body)
        assertEquals(3,hero.characterDocs!!.soul.lines().size)
        assertEquals("장터",scenarioPayload.cards.first { it.title=="장터" }.body)
    }
    @Test fun `a character body filled with its name, a blank place body and a soul that lacks or invents a line are rejected`() {
        val hero=scenarioPayload.cards.first { it.cardType=="character" }
        val market=scenarioPayload.cards.first { it.title=="장터" }
        val docs=hero.characterDocs!!
        val lines=docs.soul.lines()
        listOf(hero.copy(body=hero.title),market.copy(body=""),
            hero.copy(characterDocs=docs.copy(soul=lines.dropLast(1).joinToString("\n"))),hero.copy(characterDocs=docs.copy(soul=lines.first())),
            hero.copy(characterDocs=docs.copy(soul=docs.soul+"\n[묘사] 치삼은 없는 문장이다."))).forEach { card ->
            assertThrows(IllegalArgumentException::class.java) { verifyScenario(scenarioPayload.copy(cards=scenarioPayload.cards.map { if(it.key==card.key) card else it })) }
        }
    }
    @Test fun `only a same_name link may match a variant by its base name`() {
        val identity=mapper.readTree(scenario.path("identity").toString())
        (array(identity.path("decisions")).first().path("link") as ObjectNode).put("basis","explicit_coreference")
        assertThrows(IllegalArgumentException::class.java) { verifyScenario(identity=identity) }
    }
    @Test fun `a name key drops a suffix or particle only when the final consonant rule fits and two letters remain`() {
        mapOf("치삼이" to "치삼","치삼아" to "치삼","영희야" to "영희","치삼은" to "치삼","영희는" to "영희","치삼이가" to "치삼","치삼의" to "치삼","치삼" to "치삼","개똥이" to "개똥",
            "영희이" to "영희이","치삼야" to "치삼야","순이" to "순이","치삼과" to "치삼과").forEach { (name,key) -> assertEquals(key,ManuscriptStructureVerifier.nameKey(name)) }
    }
    @Test fun `accumulated document lines fit the limit by whole lines and repeat once`() {
        val lines=listOf("가","나","다").map { it.repeat(1410) }
        assertEquals(lines.take(2).joinToString("\n"),ManuscriptStructureVerifier.fit(lines))
        assertEquals("a\nb",ManuscriptStructureVerifier.fit(listOf("a","b","a")))
    }

    private fun array(node:JsonNode)=(0 until node.size()).map { node.get(it) }
    private fun inputHash(extraction:Map<String,Any?>):String {
        fun ordered(value:Any?):Any?=when(value) {
            is Map<*,*> -> value.entries.associate { it.key.toString() to ordered(it.value) }.toSortedMap()
            is List<*> -> value.map(::ordered)
            else -> value
        }
        return java.security.MessageDigest.getInstance("SHA-256").digest(mapper.writeValueAsBytes(ordered(extraction))).joinToString("") { "%02x".format(it.toInt() and 255) }
    }
}
