package ai.storyfork.content.world

import ai.storyfork.content.world.service.*
import ai.storyfork.content.world.service.dto.*
import org.junit.jupiter.api.Assertions.*
import org.junit.jupiter.api.Test
import tools.jackson.databind.json.JsonMapper
import tools.jackson.module.kotlin.KotlinModule

class ManuscriptStructureVerifierTest {
    private val mapper=JsonMapper.builder().addModule(KotlinModule.Builder().build()).build()
    private val fixture=mapper.readTree(checkNotNull(javaClass.getResourceAsStream("/initial-build/ai-result.json")))
    private val all=(0 until fixture.path("extractions").size()).map { i ->
        val node=fixture.path("extractions").get(i)
        ManuscriptExtractionVerifier.verify(ManuscriptBuildSource(node.path("number").asInt(),"episode-$i","version-$i",node.path("title").asString(),node.path("source").asString()),node,mapper)
    }
    private val payload=mapper.convertValue(fixture.path("payload"),ManuscriptLoadPayload::class.java)
    @Test fun `four episodes preserve identity documents knowledge and relation changes`() {
        ManuscriptStructureVerifier.verify(all,fixture.path("identity"),payload,mapper)
    }
    @Test fun `later goal in global document foreign memory and removed evidence are rejected`() {
        val hero=payload.cards.first { it.title=="길동" }
        fun changed(card:ManuscriptCard)=payload.copy(cards=payload.cards.map { if(it.key==hero.key) card else it })
        assertThrows(IllegalArgumentException::class.java) { ManuscriptStructureVerifier.verify(all,fixture.path("identity"),changed(hero.copy(characterDocs=hero.characterDocs!!.copy(goal="[goal] 길동은 이제 백성을 다스리고 싶어 했다."))),mapper) }
        assertThrows(IllegalArgumentException::class.java) { ManuscriptStructureVerifier.verify(all,fixture.path("identity"),changed(hero.copy(characterDocs=hero.characterDocs!!.copy(episodes=hero.characterDocs.episodes+("01" to "길동만이 비밀 지도를 보았다.")))),mapper) }
        assertThrows(IllegalArgumentException::class.java) { ManuscriptStructureVerifier.verify(all.dropLast(1),fixture.path("identity"),payload,mapper) }
    }
}
