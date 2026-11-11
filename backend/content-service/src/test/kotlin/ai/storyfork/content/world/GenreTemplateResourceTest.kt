package ai.storyfork.content.world

import ai.storyfork.content.world.service.GenreTemplateSeeder
import ai.storyfork.content.world.service.GenreTemplateRepair
import ai.storyfork.content.world.service.dto.EditWorldDraftRequest
import ai.storyfork.content.world.service.WorldStudioService
import org.junit.jupiter.api.Assertions.*
import org.junit.jupiter.api.Test
import org.mockito.Mockito.mock
import tools.jackson.databind.json.JsonMapper
import tools.jackson.module.kotlin.KotlinModule

/** genre-templates.json이 WorldStudioService의 입력 제한을 이미 만족하는지 확인한다. 어기면 서버 시작 때 장르 적재가 실패한다. */
class GenreTemplateResourceTest {
    private val templates = GenreTemplateSeeder(mock(WorldStudioService::class.java),
        JsonMapper.builder().addModule(KotlinModule.Builder().build()).build()).load()
    private val cards = templates.flatMap { it.cards }

    @Test fun `twenty five templates with 830 cards in the documented order`() {
        assertEquals(listOf("wuxia", "romance_fantasy", "modern_fantasy", "science_fiction", "alternate_history", "game_fantasy",
            "fusion_fantasy", "territory_management", "apocalypse", "sports_fantasy", "entertainment",
            "sumerian_mythology", "cthulhu_mythos", "norse_mythology", "greco_roman_mythology", "germanic_folklore", "chinese_folklore", "japanese_mythology", "korean_mythology_fables", "egyptian_mythology", "indian_mythology", "celtic_mythology", "slavic_mythology", "maya_mythology", "aztec_mythology"), templates.map { it.genre })
        assertEquals(830, cards.size)
    }

    @Test fun `world and card ids are globally unique`() {
        val ids = templates.map { it.worldId } + cards.map { it.id }
        assertEquals(ids.size, ids.toSet().size)
    }

    @Test fun `every world and card fits the WorldStudioService limits`() {
        templates.forEach { assertTrue(it.name.isNotBlank() && it.name.length <= 100 && it.description.length <= 20000, it.genre) }
        cards.forEach {
            assertTrue(it.title.isNotBlank() && it.title.length <= 200, it.id.toString())
            assertTrue(it.body.isNotBlank() && it.body.length <= 3000, it.title)
            assertTrue(it.cardType in setOf("character", "location", "organization", "ability", "object", "rule", "event", "other"), it.title)
        }
    }

    @Test fun `full text archive cards are not seeded`() {
        assertTrue(cards.none { it.title.contains("전체 원문") })
    }

    @Test fun `repair payloads fit the service and preserve canonical frontend fields`() {
        val mapper = JsonMapper.builder().addModule(KotlinModule.Builder().build()).build()
        templates.forEach { template ->
            val payload = GenreTemplateRepair.payloads(template)
            val request = EditWorldDraftRequest(2, template.name, template.description, payload, key = "genre-template-${template.genre}-repair-v2")
            assertTrue(mapper.writeValueAsBytes(request).size <= 2_000_000)
            payload.forEachIndexed { index, card ->
                val row = card.semanticMetadata["studio"] as Map<*, *>
                val item = row["item"] as Map<*, *>
                assertEquals(index, row["templateOrder"])
                assertEquals(card.id.toString(), item["id"])
                assertEquals(card.title, item["title"])
                assertEquals(card.body, item["text"])
                assertEquals(card.areaCode, item["category"])
                assertEquals(if (card.cardType == "event") "history" else "basic", card.areaCode)
                assertEquals("approved", item["decision"])
            }
        }
    }
}
