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
    @Test fun `identity skip count is optional and accepts only nonnegative integers`() {
        val identity=fixture.path("identity") as ObjectNode
        ManuscriptStructureVerifier.verify(all,identity.put("skippedLinks",2),payload,mapper)
        for (invalid in listOf("-1","1.5","2147483648","\"2\"","null")) {
            identity.set("skippedLinks",mapper.readTree(invalid))
            assertThrows(IllegalArgumentException::class.java) { ManuscriptStructureVerifier.verify(all,identity,payload,mapper) }
        }
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

    // ---- 업데이트: 새 회차의 인물을 기존 인물과 이은 AI 링크(#952). 근거·후보 수·같은 사건·관계 동시 등장을 검증해 요청 카드별 결정을 낸다 ----

    private fun updateEpisode(n:Int,source:String,mentions:List<Triple<String,String,String>>,events:List<List<String>> = emptyList(),relations:List<Pair<String,String>> = emptyList(),facts:List<List<String>> = emptyList())=
        ManuscriptEpisodeResult(ManuscriptBuildResultBasis(n,"version-$n","hash-$n"),emptyList(),mapOf("source" to source,
            "mentions" to mentions.map { (id,name,kind)->mapOf("id" to id,"name" to name,"kind" to kind,"quote" to source) },
            "statements" to events.mapIndexed { i,subjects->mapOf("id" to "s$i","kind" to "event","subjects" to subjects) }+facts.mapIndexed { i,subjects->mapOf("id" to "f$i","kind" to "fact","subjects" to subjects) },
            "relationships" to relations.mapIndexed { i,(from,to)->mapOf("id" to "r$i","source" to from,"target" to to) }))
    private fun knownLink(left:String,right:String,quote:String,basis:String="explicit_alias",confirmedAt:Int=2,evidenceEpisode:Int=confirmedAt)=
        mapOf("left" to left,"right" to right,"basis" to basis,"confirmedAt" to confirmedAt,"evidenceEpisode" to evidenceEpisode,"quote" to quote)
    private fun knownIdentity(mapping:Map<String,String>,vararg links:Map<String,Any>):JsonNode=mapper.valueToTree(mapOf("mapping" to mapping,"knownLinks" to links.toList()))
    private val knownNames=listOf(setOf("치삼","황 노인"),setOf("영희"))
    private fun judge(episodes:List<ManuscriptEpisodeResult>,identity:JsonNode,names:List<Set<String>> = knownNames)=ManuscriptStructureVerifier.knownMatches(episodes,identity,names,mapper)
    private val longName="김치삼은 장터로 나갔다."
    private val oneMention=listOf(Triple("m1","김치삼","character"))
    private val toCardA=mapOf("2:m1" to "card-a")

    @Test fun `the known links the AI service wrote are read back as the same decisions`() {
        // 파이썬 service.resolve·organize가 만든 ai-result-known.json이다(기존 인물 치삼·영희, 새 2화의 김치삼은 같은 인물, 박서방은 작가 확인).
        val update=mapper.readTree(checkNotNull(javaClass.getResourceAsStream("/initial-build/ai-result-known.json")))
        val episodes=extractionsOf(update)
        ManuscriptStructureVerifier.verify(episodes,update.path("identity"),mapper.convertValue(update.path("payload"),ManuscriptLoadPayload::class.java),mapper)
        val names=array(update.path("known")).map { known -> setOf(known.path("name").asString())+array(known.path("aliases")).map { it.asString() } }
        val mapping=update.path("identity").path("mapping")
        assertEquals(mapOf(mapping.path("2:m1").asString() to KnownMatch(0),mapping.path("2:m2").asString() to KnownMatch(null)),
            ManuscriptStructureVerifier.knownMatches(episodes,update.path("identity"),names,mapper))
    }
    @Test fun `a link whose quote holds the new name and a name of the existing character matches that character`() {
        // 두 이름이 인용에 각각 들어 있으면 근거가 선다. 성+이름('김치삼')과 기존 인물('치삼')은 짧은 이름이 긴 이름 밖에서도 나와야 한다. 기존 인물의 별칭 한 이름만 들어 있어도 된다.
        val both="김치삼, 곧 치삼은 장터로 나갔다."
        assertEquals(mapOf("card-a" to KnownMatch(0)),judge(listOf(updateEpisode(2,both,oneMention)),knownIdentity(toCardA,knownLink("0:k1","2:m1",both))))
        val alias="황 노인, 곧 박서방은 문을 열었다."
        assertEquals(mapOf("card-a" to KnownMatch(0)),judge(listOf(updateEpisode(2,alias,listOf(Triple("m1","박서방","character")))),knownIdentity(toCardA,knownLink("0:k1","2:m1",alias))))
    }
    @Test fun `a same-person link whose evidence does not hold is not matched but flagged for review`() {
        listOf(longName to knownLink("0:k1","2:m1","김치삼은 어디에도 없다."),                        // 인용이 원문에 없다
            longName to knownLink("0:k1","2:m1",longName),                                         // '치삼'이 '김치삼' 안에만 있어 두 호칭의 근거가 아니다
            "$longName $longName" to knownLink("0:k1","2:m1",longName),                            // 원문에 두 번 나온다
            "치삼은 장터로 나갔다." to knownLink("0:k1","2:m1","치삼은 장터로 나갔다."),              // 기존 인물의 이름만 있고 새 대상의 이름('김치삼')이 인용에 없다
            "김치삼은 시장으로 나갔다." to knownLink("0:k2","2:m1","김치삼은 시장으로 나갔다."),       // 기존 인물의 이름이 인용에 없다
            longName to knownLink("0:k1","2:m1",longName,confirmedAt=3,evidenceEpisode=2),         // confirmedAt이 근거 회차와 다르다
            longName to knownLink("0:k1","2:m1","")).forEach { (source,link) ->                    // 인용이 비었다
            assertEquals(mapOf("card-a" to KnownMatch(null)),judge(listOf(updateEpisode(2,source,oneMention)),knownIdentity(toCardA,link)),"$link")
        }
        val earlier=listOf(updateEpisode(1,"김치삼 이야기가 먼저 나왔다.",emptyList()),updateEpisode(2,longName,oneMention))  // 근거 회차가 대상 회차보다 앞선다
        assertEquals(mapOf("card-a" to KnownMatch(null)),judge(earlier,knownIdentity(toCardA,knownLink("0:k1","2:m1","김치삼 이야기가 먼저 나왔다.",confirmedAt=1))))
    }
    @Test fun `only an explicit same-person link to one candidate matches and every doubt is flagged`() {
        val source="김치삼, 곧 치삼은 영희와 장터로 나갔다."
        val episodes=listOf(updateEpisode(2,source,oneMention))
        fun verdict(vararg links:Map<String,Any>)=judge(episodes,knownIdentity(toCardA,*links))
        assertEquals(mapOf("card-a" to KnownMatch(null)),verdict(knownLink("0:k1","2:m1",source),knownLink("0:k2","2:m1",source)),"기존 인물 후보가 둘이면 어느 쪽인지 알 수 없다")
        assertEquals(mapOf("card-a" to KnownMatch(null)),verdict(knownLink("0:k1","2:m1",source,"uncertain")),"AI가 확신하지 못하면 작가가 확인한다")
        assertEquals(mapOf("card-a" to KnownMatch(null)),verdict(knownLink("0:k1","2:m1",source),knownLink("0:k2","2:m1",source,"uncertain")))
        assertEquals(mapOf("card-a" to KnownMatch(1)),verdict(knownLink("0:k1","2:m1",source,"distinct"),knownLink("0:k2","2:m1",source)),"다른 인물이라고 가른 쌍은 후보에서 뺀다")
        assertEquals(mapOf("card-a" to KnownMatch(null)),verdict(knownLink("0:k1","2:m1",source),knownLink("0:k2","2:m1",source),knownLink("0:k1","2:m1","원문에 없는 인용","distinct")),"근거 없는 distinct는 후보를 지우지 않는다")
        assertEquals(emptyMap<String,KnownMatch>(),verdict(knownLink("0:k1","2:m1",source,"distinct")),"다른 인물이라는 판단만 있으면 표시도 없다")
        assertEquals(emptyMap<String,KnownMatch>(),verdict(knownLink("0:k1","2:m1",source),knownLink("0:k1","2:m1",source,"distinct")))
    }
    @Test fun `a new character in the same event or relation as the existing character is another person`() {
        val source="김치삼은 치삼과 함께 장터로 나갔다."
        val mentions=listOf(Triple("m1","김치삼","character"),Triple("m2","치삼","character"))
        val link=knownLink("0:k1","2:m1",source)
        fun verdict(mapping:Map<String,String>,events:List<List<String>> = emptyList(),relations:List<Pair<String,String>> = emptyList(),named:List<Triple<String,String,String>> = mentions,facts:List<List<String>> = emptyList())=
            judge(listOf(updateEpisode(2,source,named,events,relations,facts)),knownIdentity(mapping,link))
        val apart=mapOf("2:m1" to "card-a","2:m2" to "card-b")
        assertEquals(mapOf("card-a" to KnownMatch(null)),verdict(apart,events=listOf(listOf("m1","m2"))),"같은 사건")
        assertEquals(mapOf("card-a" to KnownMatch(null)),verdict(apart,relations=listOf("m2" to "m1")),"같은 관계")
        assertEquals(mapOf("card-a" to KnownMatch(null)),verdict(apart+("2:m3" to "card-c"),events=listOf(listOf("m1","m3")),named=mentions+Triple("m3","치삼이","character")),"호칭 변형도 그 인물이다")
        assertEquals(mapOf("card-a" to KnownMatch(0)),verdict(apart,events=listOf(listOf("m1"),listOf("m2"))),"따로 나오면 맞춘다")
        assertEquals(mapOf("card-a" to KnownMatch(0)),verdict(apart,facts=listOf(listOf("m1","m2"))),"사건·관계가 아닌 진술에 함께 있는 것은 막지 않는다(두 호칭을 같은 사람으로 밝히는 문장일 수 있다)")
        assertEquals(mapOf("card-a" to KnownMatch(0)),verdict(mapOf("2:m1" to "card-a","2:m2" to "card-a"),events=listOf(listOf("m1","m2"))),"같은 카드의 대상끼리는 막지 않는다")
        assertEquals(mapOf("card-a" to KnownMatch(0)),verdict(apart+("2:m3" to "card-c"),events=listOf(listOf("m1","m3")),named=mentions+Triple("m3","영희","character")),"기존 인물의 이름과 맞지 않는 인물과는 함께 나와도 된다")
    }
    @Test fun `a link that is not about an existing character and a new character is refused`() {
        val episodes=listOf(updateEpisode(2,longName,listOf(Triple("m1","김치삼","character"),Triple("m2","장터","location"))))
        val mapping=mapOf("2:m1" to "card-a","2:m2" to "card-b")
        listOf(knownLink("0:k9","2:m1",longName),knownLink("0:k1","2:m9",longName),knownLink("0:k1","2:m2",longName),  // 목록에 없는 기존 인물, 없는 대상, 인물이 아닌 대상
            knownLink("0:k1","2:m1",longName,"same_name"),knownLink("1:m1","2:m1",longName)).forEach { link ->   // 쓰지 않는 basis, 기존 인물 ref가 아니다
            assertThrows(IllegalArgumentException::class.java,{ judge(episodes,knownIdentity(mapping,link)) },"$link")
        }
        assertThrows(IllegalArgumentException::class.java) { judge(episodes,knownIdentity(mapping,knownLink("0:k1","2:m1",longName)),emptyList()) }  // 최초 구축에는 기존 인물이 없다
        assertEquals(emptyMap<String,KnownMatch>(),judge(episodes,mapper.readTree("{\"mapping\":{}}")),"링크 필드가 없으면 비어 있다")
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
