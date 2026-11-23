package ai.storyfork.content.world

import ai.storyfork.content._common.exception.ContentFailure
import ai.storyfork.content.episode.entity.EpisodeCurrentEntity
import ai.storyfork.content.episode.repository.EpisodeCurrentRepository
import ai.storyfork.content.episode.service.EpisodeService
import ai.storyfork.content.episode.service.dto.*
import ai.storyfork.content.episode_version.entity.EpisodeVersionEntity
import ai.storyfork.content.episode_version.repository.EpisodeVersionRepository
import ai.storyfork.content.episode_version.service.dto.VersionResponse
import ai.storyfork.content.world.service.ManuscriptBuildSnapshot
import org.junit.jupiter.api.Assertions.*
import org.junit.jupiter.api.Test
import org.mockito.Mockito.*
import org.springframework.transaction.PlatformTransactionManager
import org.springframework.transaction.support.SimpleTransactionStatus
import org.springframework.transaction.support.TransactionTemplate

class ManuscriptBuildSnapshotTest {
    private val episodes=mock(EpisodeService::class.java)
    private val current=mock(EpisodeCurrentRepository::class.java)
    private val versions=mock(EpisodeVersionRepository::class.java)
    private val manager=mock(PlatformTransactionManager::class.java).also { `when`(it.getTransaction(org.mockito.ArgumentMatchers.any())).thenAnswer { SimpleTransactionStatus() } }
    private val service=ManuscriptBuildSnapshot(episodes,current,versions,TransactionTemplate(manager))
    private fun row(number:Int)=EpisodeResponse(number,DraftResponse("미저장 제목","미저장 원문",4),
        listOf(VersionResponse("saved-$number","${number}화","저장된 원문 $number",3,number,"2026-11-17T00:00:00Z")),null,false,null)
    init { `when`(current.findAllByWorkIdOrderBySequence("work")).thenReturn((1..4).map { EpisodeCurrentEntity("episode-$it","work",it) }) }

    @Test fun `four unpublished saved episodes preserve original IDs and do not read unsaved draft`() {
        `when`(episodes.list("work","owner")).thenReturn(EpisodeListResponse((1..4).map(::row)))
        val input=service.read("work","owner")
        assertEquals((1..4).toList(),input.episodes.map { it.number })
        assertEquals("saved-1",input.episodes.first().versionId)
        assertEquals("episode-1",input.episodes.first().episodeId)
        assertEquals("저장된 원문 1",input.episodes.first().body)
        verify(episodes).list("work","owner")
    }
    @Test fun `the empty draft that publishing leaves after the last saved episode is not part of the snapshot`() {
        `when`(episodes.list("work","owner")).thenReturn(EpisodeListResponse((1..3).map(::row)+row(4).copy(versions=emptyList())))
        val input=service.read("work","owner")
        assertEquals((1..3).toList(),input.episodes.map { it.number })
    }
    @Test fun `an unsaved episode in the middle is 422 and names the episode`() {
        `when`(episodes.list("work","owner")).thenReturn(EpisodeListResponse(listOf(row(1),row(2).copy(versions=emptyList()),row(3))))
        val failure=assertThrows(ContentFailure::class.java) { service.read("work","owner") }
        assertEquals(422,failure.status)
        assertTrue(failure.message.contains("2화"),failure.message)
    }
    @Test fun `a work with nothing saved is 422 instead of an empty snapshot`() {
        `when`(episodes.list("work","owner")).thenReturn(EpisodeListResponse(listOf(row(1).copy(versions=emptyList()))))
        assertEquals(422,assertThrows(ContentFailure::class.java) { service.read("work","owner") }.status)
    }
    @Test fun `inherited episodes are not treated as this initial import and are 422`() {
        `when`(episodes.list("work","owner")).thenReturn(EpisodeListResponse(listOf(row(1).copy(inherited=true),row(2))))
        assertEquals(422,assertThrows(ContentFailure::class.java) { service.read("work","owner") }.status)
    }
    // ---- 발행 회차로 세계관을 업데이트하는 작업(2026-11-22)은 발행본만 읽는다 ----

    private fun published() {
        `when`(current.findAllByWorkIdOrderBySequence("work")).thenReturn(listOf(
            EpisodeCurrentEntity(id="episode-1",workId="work",sequence=1,publishedVersionId="pv-1"),
            EpisodeCurrentEntity(id="episode-2",workId="work",sequence=2),
            EpisodeCurrentEntity(id="episode-3",workId="work",sequence=3,publishedVersionId="pv-3",inherited=true),
            EpisodeCurrentEntity(id="episode-4",workId="work",sequence=4,publishedVersionId="pv-4"),
            EpisodeCurrentEntity(id="episode-5",workId="work",sequence=5,publishedVersionId="pv-5",publicationStatus="published")))
        `when`(versions.findAllById(listOf("pv-4","pv-5"))).thenReturn(listOf(
            EpisodeVersionEntity(id="pv-4",episodeId="episode-4",contentVersionId="saved-4",title="4화 발행",content="발행된 원문 4"),
            EpisodeVersionEntity(id="pv-5",episodeId="episode-5",contentVersionId="saved-5",title="5화 발행",content="발행된 원문 5")))
    }
    @Test fun `published reads the published version of the wanted episodes and skips unpublished and inherited ones`() {
        published()
        val input=service.readPublished("work") { it>=4 }!!
        assertEquals(listOf(4,5),input.episodes.map { it.number })
        assertEquals(listOf("episode-4","episode-5"),input.episodes.map { it.episodeId })
        assertEquals(listOf("saved-4","saved-5"),input.episodes.map { it.versionId })
        assertEquals(listOf("4화 발행","5화 발행"),input.episodes.map { it.title })
        assertEquals("발행된 원문 4",input.episodes.first().body)
        verifyNoInteractions(episodes)
    }
    @Test fun `the same published versions freeze to equal input and nothing wanted is null`() {
        published()
        assertEquals(service.readPublished("work") { it>=4 },service.readPublished("work") { it>=4 })
        assertNull(service.readPublished("work") { it==2 || it==3 || it==9 })
    }
}
