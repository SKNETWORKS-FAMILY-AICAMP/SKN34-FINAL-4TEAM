package ai.storyfork.content.fork

import ai.storyfork.content._common.exception.ContentFailure
import ai.storyfork.content.episode_version.repository.*
import ai.storyfork.content.fork.entity.*
import ai.storyfork.content.fork.repository.*
import ai.storyfork.content.fork.service.ForkSeverService
import ai.storyfork.content.fork.service.dto.SourceResponse
import ai.storyfork.content.work.service.WorkAccessService
import ai.storyfork.content.work.service.dto.WorkAccessResult
import ai.storyfork.content.world.repository.*
import ai.storyfork.content.world.service.WorldService
import jakarta.persistence.EntityManager
import java.time.Instant
import java.util.Optional
import org.junit.jupiter.api.Assertions.*
import org.junit.jupiter.api.Test
import org.mockito.Mockito.*

/** Fork 분리가 원작 참조를 모두 비우고, 이미 분리된 Fork에는 아무것도 하지 않는지 저장소 mock으로 검증한다. */
class ForkSeverServiceTest {
    private val access = mock(WorkAccessService::class.java)
    private val world = mock(WorldService::class.java)
    private val forks = mock(ForkRepository::class.java)
    private val references = mock(ForkWorldReferenceRepository::class.java)
    private val sourceSettings = mock(ForkSourceSettingRepository::class.java)
    private val changes = mock(ForkSourceChangeRepository::class.java)
    private val decisions = mock(ForkChangeDecisionRepository::class.java)
    private val applications = mock(ForkChangeApplicationRepository::class.java)
    private val documents = mock(SettingDocumentRepository::class.java)
    private val origins = mock(SettingOriginRepository::class.java)
    private val checkpoints = mock(CheckpointRepository::class.java)
    private val checkpointEpisodes = mock(CheckpointEpisodeRepository::class.java)
    private val checkpointSettings = mock(CheckpointSettingRepository::class.java)
    private val em = mock(EntityManager::class.java)
    private val service = ForkSeverService(access, world, forks, references, sourceSettings, changes, decisions, applications,
        documents, origins, checkpoints, checkpointEpisodes, checkpointSettings, em)

    private fun fork() = ForkEntity(workId = "fork", sourceWorkId = "original", sourceCheckpointId = "basis", ownerId = "reader",
        confirmedPolicyHistoryId = "policy", sourceTitle = "원작", direction = "분기")
    private fun work() = WorkAccessResult("fork", "reader", "분기 작품", "", 0, "fork", "private", false, false, SourceResponse("original", "원작", 3, 2, "분기"))

    @Test fun `missing fork returns 404 without touching the world`() {
        `when`(forks.findById("none")).thenReturn(Optional.empty())

        assertEquals(404, assertThrows(ContentFailure::class.java) { service.sever("none") }.status)
        verifyNoInteractions(world, access)
    }

    @Test fun `an already severed fork is left untouched`() {
        val severed = fork().also { it.sourceDeletedAt = Instant.now(); it.sourceWorkId = null; it.sourceCheckpointId = null }
        `when`(forks.findById("fork")).thenReturn(Optional.of(severed))

        service.sever("fork")

        verifyNoInteractions(world, access, references, sourceSettings, changes, decisions, applications, origins, checkpoints, em)
    }

    @Test fun `sever keeps the Fork row but clears every reference to the source`() {
        val row = fork()
        val reference = ForkWorldReferenceEntity(forkWorkId = "fork", sourceWorldId = "source-world", referenceStatus = "following", lastFollowedCheckpointId = "basis")
        val change = ForkSourceChangeEntity(id = "change", forkWorkId = "fork", sourceChangeRef = "ref", beforeCheckpointId = "before", afterCheckpointId = "after")
        val decision = ForkChangeDecisionEntity(id = "decision", sourceChangeId = "change", actorId = "reader", decision = "apply")
        val application = ForkChangeApplicationEntity(id = "application", decisionId = "decision", resultCheckpointId = "result", outcome = "applied")
        val sourceSetting = ForkSourceSettingEntity(forkWorkId = "fork", settingDocumentId = "doc", settingVersionId = "version")
        `when`(forks.findById("fork")).thenReturn(Optional.of(row))
        `when`(access.get("fork")).thenReturn(work())
        `when`(references.findById("fork")).thenReturn(Optional.of(reference))
        `when`(sourceSettings.findAllByForkWorkId("fork")).thenReturn(listOf(sourceSetting))
        `when`(changes.findAllByForkWorkId("fork")).thenReturn(listOf(change))
        `when`(decisions.findAllBySourceChangeIdInOrderByDecidedAtAscIdAsc(listOf("change"))).thenReturn(listOf(decision))
        `when`(applications.findAllByDecisionIdIn(listOf("decision"))).thenReturn(listOf(application))

        service.sever("fork")

        val ordered = inOrder(world, sourceSettings, em, checkpoints)
        ordered.verify(world).detachForSourceDeletion("fork")
        ordered.verify(sourceSettings).deleteAll(listOf(sourceSetting))
        ordered.verify(em).flush()
        ordered.verify(checkpoints).deleteById("result")
        assertNull(row.sourceWorkId)
        assertNull(row.sourceCheckpointId)
        assertNull(row.confirmedPolicyHistoryId)
        assertNotNull(row.sourceDeletedAt)
        assertEquals(3, row.basisEpisode)
        assertEquals(2, row.basisVersion)
        assertEquals("원작", row.sourceTitle)
        assertNull(reference.sourceWorldId)
        assertNull(reference.lastFollowedCheckpointId)
        assertEquals("independent", reference.referenceStatus)
        assertNotNull(reference.detachedAt)
        assertNull(change.beforeCheckpointId)
        assertNull(change.afterCheckpointId)
        assertNull(application.resultCheckpointId)
    }

    @Test fun `severAll visits every Fork of the original`() {
        val severed = fork().also { it.sourceDeletedAt = Instant.now() }
        `when`(forks.findAllBySourceWorkId("original")).thenReturn(listOf(severed, severed))
        `when`(forks.findById("fork")).thenReturn(Optional.of(severed))

        service.severAll("original")

        verify(forks, times(2)).findById("fork")
    }
}
