package ai.storyfork.content.world

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
}
