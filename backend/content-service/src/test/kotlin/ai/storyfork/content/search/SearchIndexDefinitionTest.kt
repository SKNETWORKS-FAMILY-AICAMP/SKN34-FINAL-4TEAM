package ai.storyfork.content.search

import ai.storyfork.content.search.client.SEARCH_WILDCARD_FIELDS
import ai.storyfork.content.search.domain.cardDocument
import ai.storyfork.content.search.domain.workDocument
import ai.storyfork.content.search.domain.worldDocument
import java.util.UUID
import org.junit.jupiter.api.Assertions.*
import org.junit.jupiter.api.Test
import org.springframework.core.io.ClassPathResource
import tools.jackson.databind.json.JsonMapper

/** 실제 Elasticsearch 없이 번들된 색인 정의를 지킨다: 매핑이 strict라 문서가 쓰는 필드가 정의에 없으면 색인 쓰기가 전부 거절된다. */
class SearchIndexDefinitionTest {
    private val definition = JsonMapper.builder().build().readTree(ClassPathResource("search/search-v1.json").getContentAsString(Charsets.UTF_8))
    private val properties = definition.path("mappings").path("properties")

    @Test fun `the bundled mapping is strict and every searched field is a built-in wildcard field`() {
        assertEquals("strict", definition.path("mappings").path("dynamic").asString())
        assertEquals("keyword", properties.path("kind").path("type").asString())
        SEARCH_WILDCARD_FIELDS.forEach { assertEquals("wildcard", properties.path(it).path("type").asString(), it) }
    }

    @Test fun `every field a document writes is mapped`() {
        val worldId = UUID.randomUUID()
        val written = listOf(
            workDocument("w1", "작품", "작가", listOf("#태그"), listOf("판타지")),
            worldDocument(worldId, "세계", "설명", "작가"),
            cardDocument(UUID.randomUUID(), worldId, "인물", listOf("별칭"), listOf("태그")),
        ).flatMap { it.source().keys }.toSet()
        written.forEach { assertTrue(properties.has(it), it) }
    }
}
