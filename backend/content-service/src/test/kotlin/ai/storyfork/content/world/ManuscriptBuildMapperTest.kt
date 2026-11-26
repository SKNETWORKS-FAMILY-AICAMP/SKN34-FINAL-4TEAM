package ai.storyfork.content.world

import ai.storyfork.content.world.domain.requireCardMetadata
import ai.storyfork.content.world.domain.requireRelationshipMetadata
import ai.storyfork.content.world.service.*
import ai.storyfork.content.world.service.dto.*
import java.util.UUID
import org.junit.jupiter.api.Assertions.*
import org.junit.jupiter.api.Test

class ManuscriptBuildMapperTest {
    private val job=UUID.randomUUID()
    private val draft=WorldDraftResponse(UUID.randomUUID(),0,null,null,"원고 세계관","",emptyList(),emptyList())
    private val payload=ManuscriptLoadPayload(listOf(ManuscriptCard("hero","character","길동",listOf("홍길동"),"길동",1,
        ManuscriptCharacterDocs("정의롭다","백성을 돕는다",mapOf("01" to "산채를 보았다"))),
        ManuscriptCard("group","organization","활빈당",emptyList(),"활빈당",1)),
        listOf(ManuscriptRelation("hero","group","소속",1,false),ManuscriptRelation("hero","group","소속",4,true)))
    @Test fun `mapping is private keeps metadata and reserves stable relation lifecycle across steps`() {
        val requests=ManuscriptBuildMapper.build(job,draft,payload,mapOf("hero" to listOf(mapOf("sourceId" to "version-1","quote" to "길동"))))
        assertEquals(listOf(1,4),requests.map { it.episode })
        assertEquals(listOf(0L,1L),requests.map { it.expectedDraftRevision })
        assertEquals(requests.first().relationships.single().id,requests.last().relationships.single().id)
        assertEquals("removed",requests.last().relationships.single().lifecycle)
        assertTrue(requests.all { !it.replace })
        val hero=requests.first().cards.first { it.title=="길동" }
        assertEquals(setOf("01"),payload.cards.first().characterDocs!!.episodes.keys)
        assertEquals("private",hero.visibility)
        assertEquals(hero.aliases,(hero.semanticMetadata["studio"] as Map<*,*>)["aliases"])
        assertFalse(hero.semanticMetadata.containsKey("revealFromEpisode"))
        assertEquals(1,(hero.semanticMetadata["preprocessing"] as Map<*,*>)["firstEpisode"])
        assertEquals(mapOf("1" to "산채를 보았다"),(hero.semanticMetadata["characterDocs"] as Map<*,*>)["episodes"])
        assertTrue(hero.semanticMetadata.containsKey("studio"))
        assertEquals(requests,ManuscriptBuildMapper.build(job,draft,payload,mapOf("hero" to listOf(mapOf("sourceId" to "version-1","quote" to "길동")))))
    }
    @Test fun `every request the build makes passes the draft edit metadata check`() {
        // WorldStudioService.edit이 요청마다 이 검사를 먼저 돌리므로(#541) 원고 구축이 싣는 manuscriptBuild·studio·preprocessing·characterDocs가 걸리면 접수한 작업이 적재에서 막힌다.
        val built=ManuscriptBuildMapper.build(job,draft,payload,mapOf("hero" to listOf(mapOf("sourceId" to "version-1","quote" to "길동"))))
        val old=existing(heroId,"의적",episodes=mapOf("1" to "c"))
        val twin=existing(title="길동",episodes=mapOf("1" to "a"));val other=existing(title="홍길동",aliases=listOf("길동"),episodes=mapOf("1" to "b"))
        val matched=ManuscriptCard("matched","character","의적",emptyList(),"본문",12,ManuscriptCharacterDocs("","",mapOf("12" to "d")))
        val group=ManuscriptCard("group","organization","활빈당",emptyList(),"활빈당",12)
        val updated=update(basisOf(old,twin,other),listOf(hero(mapOf("11" to "11화")),matched,group),listOf(ManuscriptRelation("hero","group","소속",12,false)))

        val requests=built+updated
        assertTrue(requests.flatMap { it.cards }.any { review(it)==true },"확인 필요로 새로 더한 카드도 검사한다")
        assertTrue(requests.flatMap { it.cards }.any { it.id==heroId },"맞춘 기존 카드를 다시 보내는 요청도 검사한다")
        assertEquals(3,requests.sumOf { it.relationships.size },"시작·종료·업데이트 관계를 모두 검사한다")
        requests.forEach { request -> request.cards.forEach(::requireCardMetadata);request.relationships.forEach(::requireRelationshipMetadata) }
    }
    @Test fun `unknown endpoints duplicate keys and preexisting cards are blocked before reservation`() {
        assertThrows(IllegalArgumentException::class.java) { ManuscriptBuildMapper.build(job,draft,payload.copy(cards=payload.cards+payload.cards.first()),emptyMap()) }
        val ambiguous=payload.cards.first().copy(characterDocs=ManuscriptCharacterDocs("","",mapOf("01" to "가","001" to "나")))
        assertThrows(IllegalArgumentException::class.java) { ManuscriptBuildMapper.build(job,draft,payload.copy(cards=listOf(ambiguous,payload.cards.last())),emptyMap()) }
        assertThrows(IllegalArgumentException::class.java) { ManuscriptBuildMapper.build(job,draft,payload.copy(relations=listOf(ManuscriptRelation("absent","group","소속",1,false))),emptyMap()) }
        assertThrows(IllegalArgumentException::class.java) { ManuscriptBuildMapper.build(job,draft.copy(cards=listOf(CardPayload(UUID.randomUUID(),"기존","원문","character","basic"))),payload,emptyMap()) }
    }
    @Test fun `a restated start and an end without its start are left out instead of failing the whole load`() {
        val relations=listOf(ManuscriptRelation("hero","group","소속",1,false),ManuscriptRelation("hero","group","소속",2,false),
            ManuscriptRelation("group","hero","동맹",3,true),ManuscriptRelation("hero","group","소속",4,true),ManuscriptRelation("hero","group","소속",5,true))
        val requests=ManuscriptBuildMapper.build(job,draft,payload.copy(relations=relations),emptyMap())
        assertEquals(listOf(1 to "active",4 to "removed"),requests.flatMap { request -> request.relationships.map { request.episode to it.lifecycle } })
        assertEquals(listOf(1,4),requests.map { it.episode })
    }
    @Test fun `a relationship's description is its evidence quote and its label stays the relation name`() {
        val proof=mapOf("sourceId" to "version-1","quote" to "길동은 활빈당에 가입했다.")
        val requests=ManuscriptBuildMapper.build(job,draft,payload,mapOf("relation:4:hero:5:group:소속:1" to listOf(proof)))
        val start=requests.first().relationships.single()
        assertEquals("소속",start.label)
        assertEquals("길동은 활빈당에 가입했다.",start.body)
        val item=(start.semanticMetadata["studio"] as Map<*,*>)["item"] as Map<*,*>
        assertEquals("길동은 활빈당에 가입했다.",item["text"])
    }
    @Test fun `a rule card is an item of rule kind in the special area`() {
        val rule=ManuscriptCard("law","rule","금기",emptyList(),"[규칙] 밤에는 문을 열지 않는다.",2)
        val card=ManuscriptBuildMapper.build(job,draft,payload.copy(cards=payload.cards+rule),emptyMap()).first().cards.first { it.title=="금기" }
        assertEquals("rule",card.cardType)
        assertEquals("special",card.areaCode)
        val item=(card.semanticMetadata["studio"] as Map<*,*>)["item"] as Map<*,*>
        assertEquals("rule",item["kind"])
        assertNull(item["entityType"])
    }
    // ---- 업데이트(발행 회차 반영): 적재 요청의 카드를 기준 초안의 카드와 맞춘다 ----

    private val heroId=UUID.randomUUID()
    private fun existing(id:UUID=UUID.randomUUID(),title:String,type:String="character",aliases:List<String> = emptyList(),episodes:Map<String,String>?=null,lifecycle:String="active")=
        CardPayload(id,title,"원본 본문",type,"basic",aliases=aliases,visibility="public",lifecycle=lifecycle,
            semanticMetadata=if(episodes==null) emptyMap() else mapOf("revealFromEpisode" to 3,"characterDocs" to mapOf("soul" to "원본 SOUL","goal" to "원본 GOAL","episodes" to episodes)))
    private fun basisOf(vararg cards:CardPayload)=draft.copy(draftRevision=7,cards=cards.toList())
    private fun hero(episodes:Map<String,String>,first:Int=11,title:String="길동",aliases:List<String> = emptyList())=
        ManuscriptCard("hero","character",title,aliases,"새 본문",first,ManuscriptCharacterDocs("새 SOUL","새 GOAL",episodes))
    private fun update(basis:WorldDraftResponse,cards:List<ManuscriptCard>,relations:List<ManuscriptRelation> = emptyList())=
        ManuscriptBuildMapper.build(job,basis,ManuscriptLoadPayload(cards,relations),emptyMap(),update=true)
    private fun review(card:CardPayload)=(card.semanticMetadata["manuscriptBuild"] as Map<*,*>)["needsReview"]

    @Test fun `an existing card of the same type and name only gains the episode memories it lacks`() {
        val old=existing(heroId,"길동",aliases=listOf("홍길동"),episodes=mapOf("0" to "시작 전","1" to "산채","12" to "원본 12화"))
        val requests=update(basisOf(old),listOf(hero(mapOf("00" to "11화 기억","12" to "새 12화","13" to "13화 기억"))))

        val card=requests.single().cards.single()
        assertEquals(heroId,card.id)
        val docs=card.semanticMetadata["characterDocs"] as Map<*,*>
        assertEquals(mapOf("0" to "시작 전","1" to "산채","11" to "11화 기억","12" to "원본 12화","13" to "13화 기억"),docs["episodes"],
            "요청의 00 기억은 이 작업에서 처음 등장한 회차(11화)의 기억으로 옮기고 이미 있는 회차 키는 그대로 둔다")
        assertEquals("원본 SOUL",docs["soul"]);assertEquals("원본 GOAL",docs["goal"])
        assertEquals(old.copy(semanticMetadata=old.semanticMetadata+("characterDocs" to docs)),card,"본문·제목·별칭·공개 설정·그 밖의 메타데이터는 그대로다")
        assertEquals(7L,requests.single().expectedDraftRevision)
        assertFalse(requests.single().replace)
        assertEquals(requests,update(basisOf(old),listOf(hero(mapOf("00" to "11화 기억","12" to "새 12화","13" to "13화 기억")))))
    }
    @Test fun `an alias that equals an existing name matches too and the 00 memory goes to the first appearance`() {
        val old=existing(heroId,"김철수",episodes=mapOf("1" to "첫 만남"))
        val card=update(basisOf(old),listOf(hero(mapOf("00" to "비밀"),first=13,title="철수",aliases=listOf("김철수")))).single().cards.single()
        assertEquals(heroId,card.id)
        assertEquals(mapOf("1" to "첫 만남","13" to "비밀"),(card.semanticMetadata["characterDocs"] as Map<*,*>)["episodes"],
            "매니페스트의 첫 회차(11화)가 아니라 이 인물이 처음 나온 13화다. 앞 회차로 옮기면 독자에게 뒤 회차 내용이 먼저 보인다")
    }
    @Test fun `a card with no match is added as a new private card and another type or a removed card is no match`() {
        val others=basisOf(existing(title="길동",type="location"),existing(title="길동",lifecycle="removed"),existing(title="의적",episodes=mapOf("1" to "a")))
        val card=update(others,listOf(hero(mapOf("00" to "시작 전","11" to "11화")))).single().cards.single()
        assertTrue(card.id !in others.cards.map { it.id })
        assertEquals("private",card.visibility)
        assertNull(review(card))
        assertEquals(mapOf("0" to "시작 전","11" to "11화"),(card.semanticMetadata["characterDocs"] as Map<*,*>)["episodes"],"새 카드의 00 기억은 그대로 시작 전 기억이다")
        assertEquals("새 본문",card.body)
    }
    @Test fun `two matching cards make a new card that is flagged for review`() {
        val twins=basisOf(existing(title="길동",episodes=mapOf("1" to "a")),existing(title="홍길동",aliases=listOf("길동"),episodes=mapOf("1" to "b")))
        val card=update(twins,listOf(hero(mapOf("11" to "11화")))).single().cards.single()
        assertTrue(card.id !in twins.cards.map { it.id })
        assertEquals(true,review(card))
        assertEquals("private",card.visibility)
        assertEquals("manuscript_extraction",(card.semanticMetadata["manuscriptBuild"] as Map<*,*>)["provenance"])
    }
    @Test fun `two new cards that match the same existing card are both added as flagged new cards`() {
        val old=existing(heroId,"길동",episodes=mapOf("1" to "a"))
        val other=ManuscriptCard("other","character","의적",listOf("길동"),"본문",12,ManuscriptCharacterDocs("","",mapOf("12" to "b")))
        val cards=update(basisOf(old),listOf(hero(mapOf("11" to "a")),other)).single().cards
        assertEquals(2,cards.size)
        assertTrue(cards.none { it.id==heroId })
        assertTrue(cards.all { review(it)==true })
    }
    // ---- 호칭 변형(#848): 최초 구축의 같은 이름 병합(#839)과 같은 규칙(nameKey)으로 기존 카드를 맞춘다 ----

    @Test fun `a name variant of an existing card matches it instead of adding a new card`() {
        // 대표 사례는 기존 카드 '치삼'에 새 회차가 '치삼이'만 쓰는 경우다(반대 방향·조사 한 쌍 포함). 접미사·조사 전체 표는 nameKey 시험(ManuscriptStructureVerifierTest)이 맡는다.
        listOf("치삼" to "치삼이","치삼이" to "치삼","영희" to "영희는").forEach { (old,seen) ->
            val card=update(basisOf(existing(heroId,old,episodes=mapOf("1" to "첫 만남"))),listOf(hero(mapOf("12" to "12화"),title=seen))).single().cards.single()
            assertEquals(heroId,card.id,"$old ← $seen")
            assertEquals(old,card.title,"$old ← $seen")
            assertEquals(mapOf("1" to "첫 만남","12" to "12화"),(card.semanticMetadata["characterDocs"] as Map<*,*>)["episodes"],"$old ← $seen")
        }
    }
    @Test fun `a name that only looks like a variant stays a new card`() {
        // 받침 규칙에 어긋난 접미사(영희이), 뗀 뒤 한 글자만 남는 꼴(순이), 아는 접미사가 아닌 끝(치삼과)은 같은 이름이 아니다(#839의 가드 그대로).
        listOf("영희" to "영희이","순" to "순이","치삼" to "치삼과").forEach { (old,seen) ->
            val card=update(basisOf(existing(heroId,old,episodes=mapOf("1" to "첫 만남"))),listOf(hero(mapOf("12" to "12화"),title=seen))).single().cards.single()
            assertNotEquals(heroId,card.id,"$old ← $seen")
            assertNull(review(card),"$old ← $seen")
        }
    }
    @Test fun `an exact name is matched before a variant and two variant candidates are not merged`() {
        val plain=existing(heroId,"치삼",episodes=mapOf("1" to "a"));val suffixed=existing(title="치삼이",episodes=mapOf("1" to "b"))
        listOf("치삼" to heroId,"치삼이" to suffixed.id).forEach { (seen,id) ->
            assertEquals(id,update(basisOf(plain,suffixed),listOf(hero(mapOf("12" to "12화"),title=seen))).single().cards.single().id,"변형 카드가 있어도 이름이 같은 카드가 먼저다: $seen")
        }
        val twins=basisOf(existing(title="치삼이",episodes=mapOf("1" to "a")),existing(title="치삼아",episodes=mapOf("1" to "b")))
        val card=update(twins,listOf(hero(mapOf("12" to "12화"),title="치삼"))).single().cards.single()
        assertTrue(card.id !in twins.cards.map { it.id },"변형 후보가 둘이면 어느 쪽인지 알 수 없어 새 카드다")
        assertEquals(true,review(card))
        assertEquals("private",card.visibility)
    }
    @Test fun `a variant never takes a card that another new card names exactly and two new variants do not merge`() {
        // 같은 회차에 '치삼'과 '치삼이'가 따로 나오면(AI가 일부러 가른 것) 이름이 같은 쪽이 기존 카드를 맞추고 변형 쪽은 새 카드+확인 필요다(#839의 같은 회차 쌍둥이와 같다).
        val old=existing(heroId,"치삼",episodes=mapOf("1" to "a"))
        fun other(key:String,title:String)=ManuscriptCard(key,"character",title,emptyList(),"본문",12,ManuscriptCharacterDocs("","",mapOf("12" to "b")))
        val pair=update(basisOf(old),listOf(other("exact","치삼"),other("variant","치삼이"))).single().cards
        assertEquals(heroId,pair.first { it.title=="치삼" }.id)
        pair.first { it.title=="치삼이" }.let { assertNotEquals(heroId,it.id);assertEquals(true,review(it)) }
        val twins=update(basisOf(old),listOf(other("a","치삼이"),other("b","치삼아"))).single().cards
        assertTrue(twins.none { it.id==heroId },"변형이 둘이면 어느 쪽인지 알 수 없다")
        assertTrue(twins.all { review(it)==true })
    }
    @Test fun `a name variant also matches a card that is not a character`() {
        val group=existing(title="활빈당",type="organization")
        val variant=ManuscriptCard("group","organization","활빈당은",emptyList(),"새 본문",11)
        assertTrue(update(basisOf(group),listOf(variant)).single().cards.isEmpty(),"인물이 아닌 카드도 #839와 같은 규칙이라 새 카드가 생기지 않는다")
    }
    @Test fun `a title or an alias on either side takes part in the variant match`() {
        val old=existing(heroId,"의적",aliases=listOf("치삼"),episodes=mapOf("1" to "a"))
        assertEquals(heroId,update(basisOf(old),listOf(hero(mapOf("12" to "12화"),title="치삼이"))).single().cards.single().id,"기존 카드의 별칭")
        assertEquals(heroId,update(basisOf(old),listOf(hero(mapOf("12" to "12화"),aliases=listOf("치삼아")))).single().cards.single().id,"요청 카드의 별칭")
    }
    @Test fun `an event card is always new`() {
        val old=existing(title="11화 · 사건",type="event")
        val event=ManuscriptCard("event","event","11화 · 사건",emptyList(),"발생: 11화",11)
        val card=update(basisOf(old),listOf(event)).single().cards.single()
        assertTrue(card.id!=old.id)
        assertNull(review(card))
    }
    @Test fun `a matched card that gains nothing is left out and one without docs gets only the new memories`() {
        val place=existing(title="활빈당",type="organization")
        val group=ManuscriptCard("group","organization","활빈당",emptyList(),"새 본문",11)
        val bare=existing(heroId,"길동")
        val requests=update(basisOf(place,bare),listOf(group,hero(mapOf("11" to "11화"))))
        val card=requests.single().cards.single()
        assertEquals(heroId,card.id)
        assertEquals(mapOf("soul" to "","goal" to "","episodes" to mapOf("11" to "11화")),card.semanticMetadata["characterDocs"])
        assertEquals(bare.body,card.body)
        val untouched=update(basisOf(place),listOf(group))
        assertTrue(untouched.single().cards.isEmpty(),"바뀔 것이 없는 맞춘 카드는 요청에 싣지 않는다")
    }
    @Test fun `relations use the matched card id and are added at their own episode without touching existing ones`() {
        val old=existing(heroId,"길동",episodes=mapOf("1" to "산채"))
        val group=ManuscriptCard("group","organization","활빈당",emptyList(),"활빈당",12)
        val requests=update(basisOf(old),listOf(hero(mapOf("12" to "12화")),group),listOf(ManuscriptRelation("hero","group","소속",12,false)))

        assertEquals(listOf(1,12),requests.map { it.episode })
        assertEquals(listOf(7L,8L),requests.map { it.expectedDraftRevision })
        assertTrue(requests.none { it.replace })
        val relation=requests.last().relationships.single()
        assertEquals(heroId,relation.sourceCardId)
        assertEquals(requests.first().cards.single { it.title=="활빈당" }.id,relation.targetCardId)
        assertEquals("active",relation.lifecycle)
        assertTrue(requests.first().relationships.isEmpty(),"기준 초안의 관계를 다시 보내 교체하지 않는다")
    }
}
