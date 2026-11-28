package ai.storyfork.content.context

import ai.storyfork.content.context.service.ContextService
import ai.storyfork.content.context.service.dto.ContextRequest
import ai.storyfork.content.episode.repository.EpisodeDraftRepository
import ai.storyfork.content.episode.repository.EpisodeRepository
import ai.storyfork.content.fork.service.dto.SourceResponse
import ai.storyfork.content.publication.service.PublicationService
import ai.storyfork.content.publication.service.dto.PublishedEpisodeListResponse
import ai.storyfork.content.publication.service.dto.PublishedEpisodeResponse
import ai.storyfork.content.work.service.WorkAccessService
import ai.storyfork.content.work.service.dto.WorkAccessResult
import ai.storyfork.content.world.service.WorldService
import ai.storyfork.content.world.service.dto.SettingListResponse
import ai.storyfork.content.world.service.dto.SettingPayload
import ai.storyfork.content._common.exception.ContentFailure
import org.junit.jupiter.api.Assertions.*
import org.junit.jupiter.api.Test
import org.mockito.Mockito.*

/** 원작이 삭제된 Fork의 독자 문맥에는 상속 회차 본문이 들어가지 않는다(독자 화면과 같은 규칙). */
class ContextServiceTest {
    private val access = mock(WorkAccessService::class.java)
    private val world = mock(WorldService::class.java)
    private val publication = mock(PublicationService::class.java)
    private val service = ContextService(access, world, publication, mock(EpisodeRepository::class.java),
        mock(EpisodeDraftRepository::class.java), tools.jackson.databind.json.JsonMapper.builder().build())

    private fun fork(sourceDeleted: Boolean) {
        `when`(access.published("fork")).thenReturn(WorkAccessResult("fork", "author", "포크", "", 0, "world", "public", false, false,
            SourceResponse("original", "원작", 1, 1, "", deleted = sourceDeleted)))
        `when`(publication.publishedEpisodes("fork")).thenReturn(PublishedEpisodeListResponse(listOf(
            PublishedEpisodeResponse(1, 1, "v1", "분기 전", "원작 본문", true),
            PublishedEpisodeResponse(2, 1, "v2", "내 회차", "내 본문", false))))
        `when`(world.historyForContext("fork")).thenReturn(SettingListResponse(emptyList()))
    }
    private fun excerptText() = service.read("fork", null, ContextRequest(episode = 2)).episodes.flatMap { it.excerpts }.joinToString { it.text }

    @Test fun `reader context leaves out inherited text when the original is deleted`() {
        fork(sourceDeleted = true)
        val text = excerptText()
        assertFalse(text.contains("원작 본문"))
        assertTrue(text.contains("내 본문"))
    }

    @Test fun `reader context keeps inherited text while the original exists`() {
        fork(sourceDeleted = false)
        assertTrue(excerptText().contains("원작 본문"))
    }

    @Test fun `fork draft reads only the pinned basis and keeps older writing targets unchanged`() {
        fork(sourceDeleted = false)
        val work = access.published("fork")
        `when`(access.own("fork", "author")).thenReturn(work.copy(source = work.source!!.copy(pinnedContentVersionId = "v1")))
        `when`(publication.nextEpisodeNumber("fork")).thenReturn(2)
        val request = ContextRequest(episode = 1, includeSettings = false)
        val result = service.readForDraft("fork", "author", request, 2, "v1")
        assertEquals("원작 본문", result.recentSource!!.text())
        assertEquals(listOf(1), result.episodes.map { it.number })
        assertNull(service.readForDraft("fork", "author", request, 1, "v1").recentSource)
        assertEquals(409, assertThrows(ContentFailure::class.java) {
            service.readForDraft("fork", "author", request, 2, "sibling")
        }.status)
    }
    // Writing은 옛 설정 문서를 버리므로(#523) 설정을 빼고 읽으면 그 길이가 예산을 깎지 않는다(#602).
    private fun ownerWithLargeSettings() {
        `when`(access.own("work", "author")).thenReturn(WorkAccessResult("work", "author", "작품", "", 0, "world", "public", false, false, null))
        `when`(publication.publishedEpisodes("work")).thenReturn(PublishedEpisodeListResponse(listOf(PublishedEpisodeResponse(1, 1, "v1", "1화", "1화 본문", false))))
        `when`(publication.nextEpisodeNumber("work")).thenReturn(2)
        `when`(world.historyForContext("work")).thenReturn(SettingListResponse(listOf(SettingPayload("s", "sv", "옛 설정", "가".repeat(50000)))))
    }

    @Test fun `owner context without settings ignores large old settings in the budget`() {
        ownerWithLargeSettings()
        val result = service.read("work", "author", ContextRequest(episode = 1, includeSettings = false))
        assertTrue(result.settings.isEmpty())
        assertTrue(result.episodes.single().excerpts.joinToString { it.text }.contains("1화 본문"))
        verify(world, never()).historyForContext("work")
    }

    @Test fun `owner context with settings still rejects old settings over the budget`() {
        ownerWithLargeSettings()
        assertEquals(422, assertThrows(ContentFailure::class.java) { service.read("work", "author", ContextRequest(episode = 1)) }.status)
    }
}
