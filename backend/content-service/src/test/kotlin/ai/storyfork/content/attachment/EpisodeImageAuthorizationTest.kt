package ai.storyfork.content.attachment

import ai.storyfork.content._common.exception.ContentFailure
import ai.storyfork.content.attachment.client.AttachmentStorageClient
import ai.storyfork.content.attachment.client.dto.AttachmentObjectResult
import ai.storyfork.content.attachment.domain.AttachmentFailure
import ai.storyfork.content.attachment.entity.ContentImage
import ai.storyfork.content.attachment.repository.*
import ai.storyfork.content.attachment.service.AttachmentService
import ai.storyfork.content.episode.entity.*
import ai.storyfork.content.episode.repository.*
import ai.storyfork.content.episode.service.EpisodeService
import ai.storyfork.content.episode.service.dto.DraftRequest
import ai.storyfork.content.episode_version.entity.*
import ai.storyfork.content.episode_version.repository.*
import ai.storyfork.content.episode_version.service.EpisodeVersionService
import ai.storyfork.content.episode_version.service.dto.RevertRequest
import ai.storyfork.content.fork.entity.ForkEntity
import ai.storyfork.content.fork.repository.ForkRepository
import ai.storyfork.content.interest.service.WorkInterestService
import ai.storyfork.content.publication.repository.*
import ai.storyfork.content.publication.service.PublicationService
import ai.storyfork.content.publication.service.dto.PublishRequest
import ai.storyfork.content.publication.service.dto.PublishedEpisodeResponse
import ai.storyfork.content.work.entity.WorkEntity
import ai.storyfork.content.work.repository.*
import ai.storyfork.content.work.service.WorkAccessService
import ai.storyfork.content.work.service.WorkService
import ai.storyfork.content.work.service.dto.WorkAccessResult
import ai.storyfork.content.work.service.dto.WorkResponse
import ai.storyfork.content.world.service.WorldService
import jakarta.persistence.EntityManager
import java.util.Optional
import java.util.UUID
import org.junit.jupiter.api.Assertions.*
import org.junit.jupiter.api.BeforeEach
import org.junit.jupiter.api.Test
import org.mockito.ArgumentMatchers.any
import org.mockito.Mockito.*
import org.springframework.beans.factory.ObjectProvider
import org.springframework.transaction.PlatformTransactionManager
import org.springframework.transaction.support.SimpleTransactionStatus
import org.springframework.transaction.support.TransactionTemplate

class EpisodeImageAuthorizationTest {
    private val access = mock(WorkAccessService::class.java)
    private val works = mock(WorkRepository::class.java)
    private val episodes = mock(EpisodeRepository::class.java)
    private val drafts = mock(EpisodeDraftRepository::class.java)
    private val current = mock(EpisodeCurrentRepository::class.java)
    private val versions = mock(EpisodeVersionRepository::class.java)
    private val images = mock(ContentImageRepository::class.java)
    private val forks = mock(ForkRepository::class.java)
    private val checkpointEpisodes = mock(CheckpointEpisodeRepository::class.java)
    private val em = mock(EntityManager::class.java)
    @Suppress("UNCHECKED_CAST")
    private val imageProviders = mock(ObjectProvider::class.java) as ObjectProvider<ContentImageRepository>
    // 회차 응답용 발행 기록 저장소는 발행 서비스가 쓰는 events와 분리해, 발행 전 거절 검증이 events 무호출을 그대로 확인하게 한다.
    private val writing = EpisodeService(access, works, episodes, drafts, current, versions, imageProviders, em, forks, checkpointEpisodes,
        mock(PublicationEventRepository::class.java))
    private val events = mock(PublicationEventRepository::class.java)
    private val visibility = mock(WorkPublicationHistoryRepository::class.java)
    private val rights = mock(WorkRightsDeclarationRepository::class.java)
    private val policies = mock(ForkPolicyHistoryRepository::class.java)
    private val publication = PublicationService(access, writing, episodes, current, versions, events, visibility, rights, drafts, works, policies,
        mock(ForkPolicyEpisodeRepository::class.java), mock(WorkInterestService::class.java), em)
    private val world = mock(WorldService::class.java)
    private val checkpointRows = mock(CheckpointRepository::class.java)
    private val checkpointSettings = mock(CheckpointSettingRepository::class.java)
    private val savedVersions = EpisodeVersionService(access, writing, publication, world, episodes, drafts, versions,
        checkpointRows, checkpointEpisodes, checkpointSettings, em)
    private val content = mock(WorkService::class.java)
    private val storage = mock(AttachmentStorageClient::class.java)
    private val manager = mock(PlatformTransactionManager::class.java)
    private val attachments = AttachmentService(mock(AttachmentSettingRepository::class.java), mock(SettingAttachmentRepository::class.java),
        images, mock(ImageWorkRepository::class.java), content, writing, storage, TransactionTemplate(manager), mock(ImageEpisodeRepository::class.java))
    private val episode = EpisodeEntity("episode", "work", 1)
    private val draft = EpisodeDraftEntity("episode", "original title", "original body", 4)
    private val row = EpisodeCurrentEntity("episode", "work", 1)
    private val work = WorkEntity(id = "work", revision = 5)
    private val bytes = byteArrayOf(1, 2, 3)

    @BeforeEach fun setup() {
        `when`(imageProviders.getIfAvailable()).thenReturn(images)
        `when`(manager.getTransaction(any())).thenReturn(SimpleTransactionStatus())
        `when`(access.own("work", "owner")).thenReturn(WorkAccessResult("work", "owner", "title", "", 5, "world", "private", false, false, null))
        `when`(works.findById("work")).thenReturn(Optional.of(work))
        `when`(episodes.findByWorkIdAndSequence("work", 1)).thenReturn(episode)
        `when`(episodes.findByWorkIdAndSequence("work", 2)).thenReturn(EpisodeEntity("next", "work", 2))
        `when`(episodes.findAllById(listOf("episode"))).thenReturn(listOf(episode))
        `when`(current.findByWorkIdAndSequence("work", 1)).thenReturn(row)
        `when`(drafts.findAllById(listOf("episode"))).thenReturn(listOf(draft))
        `when`(drafts.findById("episode")).thenReturn(Optional.of(draft))
        `when`(world.snapshot("work", "owner", 1)).thenReturn(ai.storyfork.content.world.service.dto.WorldSnapshotResult("world", "world-history", emptyList()))
        `when`(versions.saveAndFlush(any(EpisodeVersionEntity::class.java) ?: EpisodeVersionEntity())).thenAnswer {
            val version = it.arguments[0] as EpisodeVersionEntity
            `when`(versions.findByEpisodeIdAndContentVersionId(version.episodeId, version.contentVersionId)).thenReturn(version)
            version
        }
    }

    private fun image(work: String = "work", number: Int = 1): ContentImage = ContentImage(
        id = UUID.randomUUID().toString(), workId = work, episodeNo = number, objectKey = "episode-images/${UUID.randomUUID()}", byteSize = bytes.size.toLong()
    ).also {
        `when`(images.findById(it.id)).thenReturn(Optional.of(it))
        `when`(storage.read(it.objectKey)).thenReturn(AttachmentObjectResult(bytes))
    }
    private fun marker(image: ContentImage) = "[[image:${image.id}]]"
    private fun version(body: String): EpisodeVersionEntity = EpisodeVersionEntity(
        id = "stored-version", episodeId = "episode", contentVersionId = "saved", revisionNo = 3, title = "saved title", content = body
    ).also {
        `when`(versions.findAllByEpisodeIdInOrderByCreatedAtAscIdAsc(listOf("episode"))).thenReturn(listOf(it))
        `when`(versions.findByEpisodeIdAndContentVersionId("episode", "saved")).thenReturn(it)
    }
    private fun published(body: String, inherited: Boolean = false) {
        `when`(content.publicRead("work")).thenReturn(WorkResponse("work", "title", "", "public", false, false, null,
            listOf(PublishedEpisodeResponse(1, 3, "published", "title", body, inherited)), null))
    }
    private fun inherited(image: ContentImage, pinnedBody: String = marker(image)) {
        row.inherited = true
        draft.content = marker(image)
        val source = EpisodeEntity("source-episode", "original", 1)
        val frozen = EpisodeVersionEntity(id = "frozen-version", episodeId = source.id, contentVersionId = "basis", content = pinnedBody)
        `when`(forks.findById("work")).thenReturn(Optional.of(ForkEntity(workId = "work", sourceWorkId = "original", sourceCheckpointId = "fork-basis")))
        `when`(episodes.findByWorkIdAndSequence("original", 1)).thenReturn(source)
        `when`(checkpointEpisodes.findById(CheckpointEpisodeEntity.Key("fork-basis", source.id)))
            .thenReturn(Optional.of(CheckpointEpisodeEntity("fork-basis", "original", source.id, frozen.id)))
        `when`(versions.findById(frozen.id)).thenReturn(Optional.of(frozen))
        published(marker(image), true)
    }
    private fun assertDraftPreserved() {
        assertEquals("original title", draft.title)
        assertEquals("original body", draft.content)
        assertEquals(4, draft.editRevision)
        assertEquals(5, work.revision)
        verify(drafts, never()).save(any(EpisodeDraftEntity::class.java))
    }

    @Test fun `draft rejects another work another episode a cover and missing images before any mutation`() {
        val invalid = listOf(image("private-work"), image(number = 2), image(number = 0))
        for (body in invalid.map(::marker) + "[[image:${UUID.randomUUID()}]]") {
            assertEquals(422, assertThrows(ContentFailure::class.java) {
                writing.update("work", "owner", 1, DraftRequest("changed", body, 4))
            }.status)
            assertDraftPreserved()
        }
    }

    @Test fun `own episode image may be saved with repeated references`() {
        val image = image()
        val body = "before ${marker(image)} after ${marker(image)}"
        assertEquals(body, writing.update("work", "owner", 1, DraftRequest("changed", body, 4)).draft.body)
        assertEquals(5, draft.editRevision)
        verify(drafts).save(draft)
    }

    @Test fun `disabled image metadata rejects references but still permits plain text`() {
        `when`(imageProviders.getIfAvailable()).thenReturn(null)
        assertEquals(422, assertThrows(ContentFailure::class.java) {
            writing.update("work", "owner", 1, DraftRequest("changed", "[[image:${UUID.randomUUID()}]]", 4))
        }.status)
        assertDraftPreserved()
        assertEquals("plain text", writing.update("work", "owner", 1, DraftRequest("changed", "plain text", 4)).draft.body)
    }

    @Test fun `version save and restore reject foreign markers without overwriting the current draft`() {
        val body = marker(image("private-work"))
        version(body)
        assertEquals(422, assertThrows(ContentFailure::class.java) {
            savedVersions.save("work", "owner", 1, DraftRequest("changed", body, 4))
        }.status)
        assertDraftPreserved()
        assertEquals(422, assertThrows(ContentFailure::class.java) {
            savedVersions.restore("work", "owner", 1, RevertRequest(4, "saved"))
        }.status)
        assertDraftPreserved()
        verifyNoInteractions(world)
        verify(versions, never()).saveAndFlush(any(EpisodeVersionEntity::class.java))
    }

    @Test fun `saving a version creates no checkpoint because only publication does`() {
        savedVersions.save("work", "owner", 1, DraftRequest("changed", "plain body", 4))
        verify(versions).saveAndFlush(any(EpisodeVersionEntity::class.java) ?: EpisodeVersionEntity())
        verifyNoInteractions(checkpointRows, checkpointEpisodes, checkpointSettings)
    }

    @Test fun `both publication entry points reject a previously saved foreign marker before publishing`() {
        version(marker(image("private-work")))
        assertEquals(422, assertThrows(ContentFailure::class.java) {
            publication.publishEpisode("work", "owner", 1, PublishRequest(4, true, versionId = "saved"))
        }.status)
        assertEquals(422, assertThrows(ContentFailure::class.java) {
            publication.publishCurrent("work", "owner", PublishRequest(5, true, versionId = "saved"))
        }.status)
        assertDraftPreserved()
        verifyNoInteractions(events, visibility, rights)
    }

    @Test fun `both publication entry points validate the selected saved body rather than the current draft`() {
        val body = marker(image())
        val v = version(body)
        draft.content = marker(image("unrelated-work"))
        publication.publishEpisode("work", "owner", 1, PublishRequest(4, true, versionId = "saved"))
        publication.publishCurrent("work", "owner", PublishRequest(5, true, versionId = "saved"))
        verify(events, times(2)).saveAndFlush(any(ai.storyfork.content.publication.entity.PublicationEventEntity::class.java))
        assertEquals(body, v.content)
    }

    @Test fun `public forged markers never expose another work another episode a cover or missing bytes`() {
        val invalid = listOf(image("private-work"), image(number = 2), image(number = 0))
        for (image in invalid) {
            published(marker(image))
            assertEquals("IMAGE_NOT_FOUND", assertThrows(AttachmentFailure::class.java) {
                attachments.downloadEpisodeImage("work", 1, image.id, null, true)
            }.code)
        }
        val missing = UUID.randomUUID().toString()
        published("[[image:$missing]]")
        assertEquals("IMAGE_NOT_FOUND", assertThrows(AttachmentFailure::class.java) {
            attachments.downloadEpisodeImage("work", 1, missing, null, true)
        }.code)
        verifyNoInteractions(storage)
    }

    @Test fun `own images require publication markers publicly but remain available to the author without a draft marker`() {
        val image = image()
        published("no marker")
        assertThrows(AttachmentFailure::class.java) { attachments.downloadEpisodeImage("work", 1, image.id, null, true) }
        assertArrayEquals(bytes, attachments.downloadEpisodeImage("work", 1, image.id, "owner", false).bytes)
        published(marker(image))
        assertArrayEquals(bytes, attachments.downloadEpisodeImage("work", 1, image.id, null, true).bytes)
    }

    @Test fun `inherited images remain readable from the pinned source after the original is republished`() {
        val image = image("original")
        inherited(image)
        // A later original publication must not replace the checkpoint's immutable version.
        `when`(current.findByWorkIdAndSequence("original", 1)).thenReturn(EpisodeCurrentEntity("source-episode", "original", 1, "new-version"))
        `when`(versions.findById("new-version")).thenReturn(Optional.of(EpisodeVersionEntity(id = "new-version", episodeId = "source-episode", content = "removed")))
        assertArrayEquals(bytes, attachments.downloadEpisodeImage("work", 1, image.id, "owner", false).bytes)
        assertArrayEquals(bytes, attachments.downloadEpisodeImage("work", 1, image.id, null, true).bytes)
    }

    @Test fun `inherited flags and forged bodies cannot authorize images absent from the frozen source`() {
        val image = image("original")
        inherited(image, "frozen body without this private image")
        assertEquals("IMAGE_NOT_FOUND", assertThrows(AttachmentFailure::class.java) {
            attachments.downloadEpisodeImage("work", 1, image.id, "owner", false)
        }.code)
        assertEquals("IMAGE_NOT_FOUND", assertThrows(AttachmentFailure::class.java) {
            attachments.downloadEpisodeImage("work", 1, image.id, null, true)
        }.code)
        verifyNoInteractions(storage)
    }

    @Test fun `inherited source markers cannot authorize a different work or episode`() {
        for (image in listOf(image("unrelated-work"), image("original", 2))) {
            inherited(image)
            assertThrows(AttachmentFailure::class.java) { attachments.downloadEpisodeImage("work", 1, image.id, "owner", false) }
            assertThrows(AttachmentFailure::class.java) { attachments.downloadEpisodeImage("work", 1, image.id, null, true) }
        }
        verifyNoInteractions(storage)
    }
}
