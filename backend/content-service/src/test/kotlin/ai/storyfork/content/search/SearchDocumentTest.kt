package ai.storyfork.content.search

import ai.storyfork.content.search.domain.cardDocument
import ai.storyfork.content.search.domain.workDocument
import ai.storyfork.content.search.domain.worldDocument
import ai.storyfork.content.search.service.searchDocuments
import ai.storyfork.content.work.service.dto.WorkResponse
import ai.storyfork.content.world.service.dto.PublicWorldSearchCard
import ai.storyfork.content.world.service.dto.PublicWorldSearchEntry
import java.util.UUID
import org.junit.jupiter.api.Assertions.*
import org.junit.jupiter.api.Test

/** 색인 문서: 종류와 ID가 키이고, 해시가 같으면 내용이 같다(주기 대조가 바뀐 문서만 다시 쓴다). */
class SearchDocumentTest {
    private val worldId = UUID.fromString("00000000-0000-0000-0000-0000000000a1")
    private val cardId = UUID.fromString("00000000-0000-0000-0000-0000000000b2")

    @Test fun `a work document keys by kind and id and drops the leading hash of its tags`() {
        val doc = workDocument("w1", "달빛 마법사", "작가", listOf("#마법", "학원"), listOf("판타지"))
        assertEquals("work:w1", doc.key)
        assertEquals(mapOf("title" to "달빛 마법사", "author" to "작가", "tags" to listOf("마법", "학원"), "genres" to listOf("판타지")), doc.fields)
        // 저장값의 앞 #은 검색에서 무시한다(작품 검색 규칙): 있든 없든 같은 문서다.
        assertEquals(doc.hash, workDocument("w1", "달빛 마법사", "작가", listOf("마법", "학원"), listOf("판타지")).hash)
    }

    @Test fun `world and card documents carry only what the search matches, never a card body`() {
        assertEquals(mapOf("name" to "세계", "description" to "설명", "author" to "작가"), worldDocument(worldId, "세계", "설명", "작가").fields)
        val card = cardDocument(cardId, worldId, "인물", listOf("별칭"), listOf("태그"))
        assertEquals("card:$cardId", card.key)
        assertEquals(mapOf("world_id" to worldId.toString(), "title" to "인물", "aliases" to listOf("별칭"), "tags" to listOf("태그")), card.fields)
    }

    @Test fun `the hash changes with any searched value and with nothing else`() {
        val base = worldDocument(worldId, "세계", "설명", "작가")
        assertEquals(base.hash, worldDocument(worldId, "세계", "설명", "작가").hash)
        assertNotEquals(base.hash, worldDocument(worldId, "새 세계", "설명", "작가").hash)
        assertNotEquals(base.hash, worldDocument(worldId, "세계", "설명", "바뀐 닉네임").hash) // 작가 닉네임 변경은 다음 주기에 반영된다
        assertNotEquals(base.hash, worldDocument(UUID.randomUUID(), "세계", "설명", "작가").hash)
    }

    @Test fun `the indexed source adds kind and hash to the fields`() {
        val doc = worldDocument(worldId, "세계", "설명", "작가")
        assertEquals(mapOf("kind" to "world", "name" to "세계", "description" to "설명", "author" to "작가", "hash" to doc.hash), doc.source())
    }

    @Test fun `the feed turns public works, worlds and their shown cards into documents`() {
        val work = WorkResponse(id = "w1", title = "작품", summary = "", visibility = "public", allowFork = false, allowForkPublication = false, source = null,
            episodes = emptyList(), draft = null, genres = listOf("판타지"), hashtags = listOf("#태그"), authorName = "작가")
        val entry = PublicWorldSearchEntry(worldId, "세계", "설명", "작가", listOf(PublicWorldSearchCard(cardId, "인물", listOf("별칭"), listOf("태그"))))
        assertEquals(listOf(
            workDocument("w1", "작품", "작가", listOf("태그"), listOf("판타지")),
            worldDocument(worldId, "세계", "설명", "작가"),
            cardDocument(cardId, worldId, "인물", listOf("별칭"), listOf("태그")),
        ), searchDocuments(listOf(work), listOf(entry)))
    }
}
