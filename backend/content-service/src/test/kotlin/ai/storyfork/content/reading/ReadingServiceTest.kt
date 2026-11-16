package ai.storyfork.content.reading

import ai.storyfork.content._common.exception.ContentFailure
import ai.storyfork.content.episode.entity.EpisodeCurrentEntity
import ai.storyfork.content.episode.repository.EpisodeCurrentRepository
import ai.storyfork.content.reading.entity.ReadingEpisodeEntity
import ai.storyfork.content.reading.entity.ReadingRecordEntity
import ai.storyfork.content.reading.repository.ReadingEpisodeRepository
import ai.storyfork.content.reading.repository.ReadingRecordRepository
import ai.storyfork.content.reading.service.ReadingService
import ai.storyfork.content.reading.service.dto.ReadingListResponse
import ai.storyfork.content.reading.service.dto.ReadingRecordResponse
import ai.storyfork.content.work.service.WorkAccessService
import ai.storyfork.content.work.service.dto.WorkAccessResult
import java.time.Duration
import java.time.Instant
import org.junit.jupiter.api.Assertions.*
import org.junit.jupiter.api.Test
import org.junit.jupiter.api.extension.ExtendWith
import org.mockito.ArgumentCaptor
import org.mockito.ArgumentMatchers
import org.mockito.InjectMocks
import org.mockito.Mock
import org.mockito.Mockito.*
import org.mockito.junit.jupiter.MockitoExtension
import org.springframework.dao.DataIntegrityViolationException

@ExtendWith(MockitoExtension::class)
class ReadingServiceTest {
    @Mock lateinit var access: WorkAccessService
    @Mock lateinit var current: EpisodeCurrentRepository
    @Mock lateinit var records: ReadingRecordRepository
    @Mock lateinit var episodes: ReadingEpisodeRepository
    @InjectMocks lateinit var service: ReadingService

    private fun anyRecord() = ArgumentMatchers.any(ReadingRecordEntity::class.java) ?: ReadingRecordEntity()
    private fun anyEpisode() = ArgumentMatchers.any(ReadingEpisodeEntity::class.java) ?: ReadingEpisodeEntity()
    private fun anyEpisodeKey() = ArgumentMatchers.any(ReadingEpisodeEntity.Key::class.java) ?: ReadingEpisodeEntity.Key()
    private fun published(number: Int) {
        `when`(current.findByWorkIdAndSequence("work", number)).thenReturn(EpisodeCurrentEntity("episode-$number", "work", number, "version-$number"))
    }
    private fun work(id: String, visibility: String = "public", restricted: Boolean = false) =
        WorkAccessResult(id, "author", "제목", "소개", 0, "world", visibility, true, false, null, restricted)
    private fun failure(block: () -> Unit) = assertThrows(ContentFailure::class.java, block)

    @Test fun `opening a published episode stores it as the position and as a read episode`() {
        published(2)
        `when`(episodes.saveAndFlush(anyEpisode())).thenAnswer { it.arguments[0] }

        service.record("work", 2, "reader")

        val record = ArgumentCaptor.forClass(ReadingRecordEntity::class.java)
        verify(records).saveAndFlush(record.capture() ?: ReadingRecordEntity())
        assertEquals(listOf<Any>("reader", "work", 2), listOf(record.value.memberId, record.value.workId, record.value.lastEpisode))
        assertTrue(Duration.between(record.value.updatedAt, Instant.now()).abs() < Duration.ofMinutes(1))
        val read = ArgumentCaptor.forClass(ReadingEpisodeEntity::class.java)
        verify(episodes).saveAndFlush(read.capture() ?: ReadingEpisodeEntity())
        assertEquals(listOf<Any>("reader", "work", 2), listOf(read.value.memberId, read.value.workId, read.value.episodeNumber))
        verify(access).published("work")
    }

    @Test fun `reopening an episode already read only moves the position`() {
        published(1)
        `when`(episodes.existsById(ReadingEpisodeEntity.Key("reader", "work", 1))).thenReturn(true)

        service.record("work", 1, "reader")

        val record = ArgumentCaptor.forClass(ReadingRecordEntity::class.java)
        verify(records).saveAndFlush(record.capture() ?: ReadingRecordEntity())
        assertEquals(1, record.value.lastEpisode)
        verify(episodes, never()).saveAndFlush(anyEpisode())
    }

    @Test fun `private or missing work is 404 before any episode lookup`() {
        `when`(access.published("work")).thenThrow(ContentFailure(404, "공개 작품을 찾을 수 없어요."))

        assertEquals(404, failure { service.record("work", 1, "reader") }.status)

        verifyNoInteractions(current, records, episodes)
    }

    @Test fun `unpublished or unknown episode is 404 and stores nothing`() {
        `when`(current.findByWorkIdAndSequence("work", 2)).thenReturn(EpisodeCurrentEntity("episode-2", "work", 2, null))

        for (number in listOf(2, 3, 0, -1)) assertEquals(404, failure { service.record("work", number, "reader") }.status, "$number")

        verifyNoInteractions(records, episodes)
    }

    @Test fun `blank or oversized member is unauthenticated before any lookup`() {
        for (member in listOf(" ", "m".repeat(201))) {
            assertEquals(401, failure { service.record("work", 1, member) }.status)
            assertEquals(401, failure { service.list(member) }.status)
            assertEquals(401, failure { service.delete("work", member) }.status)
        }

        verifyNoInteractions(access, current, records, episodes)
    }

    @Test fun `a concurrent first position is retried once as an update`() {
        published(1)
        `when`(records.saveAndFlush(anyRecord())).thenThrow(DataIntegrityViolationException("duplicate key")).thenAnswer { it.arguments[0] }
        `when`(episodes.saveAndFlush(anyEpisode())).thenAnswer { it.arguments[0] }

        assertDoesNotThrow { service.record("work", 1, "reader") }

        verify(records, times(2)).saveAndFlush(anyRecord())
    }

    @Test fun `a position that fails again is not swallowed`() {
        published(1)
        `when`(records.saveAndFlush(anyRecord())).thenThrow(DataIntegrityViolationException("foreign key"))

        assertThrows(DataIntegrityViolationException::class.java) { service.record("work", 1, "reader") }

        verifyNoInteractions(episodes)
    }

    @Test fun `a concurrent duplicate read episode is ignored once the row exists`() {
        published(1)
        `when`(episodes.existsById(anyEpisodeKey())).thenReturn(false, true)
        `when`(episodes.saveAndFlush(anyEpisode())).thenThrow(DataIntegrityViolationException("duplicate key"))

        assertDoesNotThrow { service.record("work", 1, "reader") }

        verify(episodes, times(2)).existsById(anyEpisodeKey())
    }

    @Test fun `other read episode failures are not swallowed`() {
        published(1)
        `when`(episodes.saveAndFlush(anyEpisode())).thenThrow(DataIntegrityViolationException("foreign key"))

        assertThrows(DataIntegrityViolationException::class.java) { service.record("work", 1, "reader") }
    }

    @Test fun `list is newest first with ascending read episodes and drops works that are no longer public`() {
        val older = Instant.parse("2026-11-09T01:00:00Z")
        val newer = Instant.parse("2026-11-09T02:00:00Z")
        `when`(records.findAllByMemberIdOrderByUpdatedAtDescWorkIdAsc("reader")).thenReturn(listOf(
            ReadingRecordEntity("reader", "w2", 3, newer), ReadingRecordEntity("reader", "closed", 1, newer), ReadingRecordEntity("reader", "w1", 1, older),
            ReadingRecordEntity("reader", "restricted", 2, older),
        ))
        `when`(episodes.findAllByMemberId("reader")).thenReturn(listOf(
            ReadingEpisodeEntity("reader", "w1", 3, older), ReadingEpisodeEntity("reader", "w2", 2, newer), ReadingEpisodeEntity("reader", "w1", 1, older),
            ReadingEpisodeEntity("reader", "w2", 3, newer), ReadingEpisodeEntity("reader", "closed", 1, newer),
        ))
        `when`(access.get("w1")).thenReturn(work("w1"))
        `when`(access.get("w2")).thenReturn(work("w2"))
        `when`(access.get("closed")).thenReturn(work("closed", visibility = "private"))
        `when`(access.get("restricted")).thenReturn(work("restricted", restricted = true))

        assertEquals(ReadingListResponse(listOf(
            ReadingRecordResponse("w2", 3, listOf(2, 3), newer.toString()), ReadingRecordResponse("w1", 1, listOf(1, 3), older.toString()),
        )), service.list("reader"))
    }

    @Test fun `list without any record is empty`() {
        assertEquals(ReadingListResponse(emptyList()), service.list("reader"))

        verifyNoInteractions(access)
    }

    @Test fun `delete removes the position and the read episodes of that work only for the member`() {
        service.delete("work", "reader")

        verify(records).deleteAllByMemberIdAndWorkId("reader", "work")
        verify(episodes).deleteAllByMemberIdAndWorkId("reader", "work")
        verifyNoInteractions(access, current)
    }
}
