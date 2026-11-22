package ai.storyfork.content.serial

import ai.storyfork.content._common.exception.ContentFailure
import ai.storyfork.content.attachment.repository.ContentImageRepository
import ai.storyfork.content.auth.service.CoreAuthVerificationService
import ai.storyfork.content.episode.entity.EpisodeCurrentEntity
import ai.storyfork.content.episode.entity.EpisodeDraftEntity
import ai.storyfork.content.episode.entity.EpisodeEntity
import ai.storyfork.content.episode.repository.EpisodeCurrentRepository
import ai.storyfork.content.episode.repository.EpisodeDraftRepository
import ai.storyfork.content.episode.repository.EpisodeRepository
import ai.storyfork.content.episode.service.EpisodeService
import ai.storyfork.content.episode.service.dto.CreateEpisodeRequest
import ai.storyfork.content.episode.service.dto.DraftRequest
import ai.storyfork.content.episode.service.dto.DraftResponse
import ai.storyfork.content.episode.service.dto.EpisodeResponse
import ai.storyfork.content.episode_version.repository.CheckpointEpisodeRepository
import ai.storyfork.content.episode_version.repository.CheckpointRepository
import ai.storyfork.content.episode_version.repository.CheckpointSettingRepository
import ai.storyfork.content.episode_version.repository.EpisodeVersionRepository
import ai.storyfork.content.episode_version.service.EpisodeVersionService
import ai.storyfork.content.episode_version.service.dto.RevertRequest
import ai.storyfork.content.fork.repository.ForkRepository
import ai.storyfork.content.interest.service.WorkInterestService
import ai.storyfork.content.publication.entity.PublicationScheduleEntity
import ai.storyfork.content.publication.repository.PublicationEventRepository
import ai.storyfork.content.publication.repository.PublicationScheduleRepository
import ai.storyfork.content.publication.repository.WorkPublicationHistoryRepository
import ai.storyfork.content.publication.repository.WorkRightsDeclarationRepository
import ai.storyfork.content.publication.service.PublicationScheduleService
import ai.storyfork.content.publication.service.PublicationService
import ai.storyfork.content.publication.service.dto.PublicationScheduleRequest
import ai.storyfork.content.publication.service.dto.PublicationVisibilityRequest
import ai.storyfork.content.publication.service.dto.PublishRequest
import ai.storyfork.content.serial.domain.SERIAL_LOCKED_MESSAGE
import ai.storyfork.content.serial.entity.AiSerialEntity
import ai.storyfork.content.serial.repository.AiSerialRepository
import ai.storyfork.content.work.entity.WorkEntity
import ai.storyfork.content.work.repository.ForkPolicyEpisodeRepository
import ai.storyfork.content.work.repository.ForkPolicyHistoryRepository
import ai.storyfork.content.work.repository.WorkRepository
import ai.storyfork.content.work.repository.WorkWorldHistoryRepository
import ai.storyfork.content.work.service.WorkAccessService
import ai.storyfork.content.world.service.WorldService
import ai.storyfork.content.world.service.dto.WorldSnapshotResult
import jakarta.persistence.EntityManager
import java.nio.file.Files
import java.nio.file.Path
import java.time.Instant
import java.time.LocalTime
import java.util.Optional
import org.junit.jupiter.api.Assertions.*
import org.junit.jupiter.api.Test
import org.mockito.ArgumentMatchers
import org.mockito.Mockito.*
import org.springframework.beans.factory.ObjectProvider
import org.springframework.transaction.PlatformTransactionManager
import org.springframework.transaction.support.TransactionTemplate

/**
 * AI 집필이 켜져 있는 동안 소유자의 원고 수정 잠금(계약 'AI 집필 중 원고 잠금')을 DB 없이 검증한다.
 * 판정은 WorkAccessService 한 함수([WorkAccessService.requireManuscriptWritable])이고, 원고를 바꾸는 서비스 진입점은 소유 확인 뒤에 그 함수를 부른다.
 * REST 컨트롤러·Content MCP 쓰기 도구·집필 AI의 반영(MCP episode_update_draft)·수정 제안 승인은 모두 같은 서비스를 거치므로 서비스에서 막으면 같이 막힌다.
 * 자율 연재 실행 자신의 저장만 별도 진입점(...ForSerial)으로 잠금을 건너뛰고, 그 진입점은 SerialService만 부른다.
 */
class SerialManuscriptLockTest {
    private val owner = "owner"
    private val t0 = Instant.parse("2026-11-23T12:10:00Z")
    private val lockedMessage = "AI 집필 중에는 원고를 수정할 수 없습니다. AI 집필을 끄면 수정할 수 있어요."

    // ---- 판정 규칙(실제 WorkAccessService)
    private val serials = mock(AiSerialRepository::class.java)
    private val rule = WorkAccessService(mock(WorkRepository::class.java), mock(WorkWorldHistoryRepository::class.java), mock(WorkPublicationHistoryRepository::class.java),
        mock(ForkPolicyHistoryRepository::class.java), mock(ForkPolicyEpisodeRepository::class.java), mock(ForkRepository::class.java), mock(CheckpointRepository::class.java),
        mock(EpisodeRepository::class.java), mock(EpisodeVersionRepository::class.java), serials, mock(EntityManager::class.java))

    private fun settings(enabled: Boolean) = AiSerialEntity("w", enabled, "MON", LocalTime.of(21, 0), "", null, t0)

    // ---- 진입점(서비스는 실제, 저장소는 대역). access는 잠금이 켜진 것처럼 거절한다.
    private val access = mock(WorkAccessService::class.java)
    private val works = mock(WorkRepository::class.java)
    private val episodes = mock(EpisodeRepository::class.java)
    private val drafts = mock(EpisodeDraftRepository::class.java)
    private val current = mock(EpisodeCurrentRepository::class.java)
    private val versions = mock(EpisodeVersionRepository::class.java)
    private val events = mock(PublicationEventRepository::class.java)
    private val visibilityRepo = mock(WorkPublicationHistoryRepository::class.java)
    private val rights = mock(WorkRightsDeclarationRepository::class.java)
    private val scheduleRepo = mock(PublicationScheduleRepository::class.java)
    private val scheduleEpisodes = mock(EpisodeRepository::class.java)
    private val world = mock(WorldService::class.java)
    private val versionEpisodes = mock(EpisodeRepository::class.java)
    // 버전·발행 서비스에는 대역 EpisodeService를 넣어, 그 서비스 자신의 첫 줄에서 막히는지(안쪽 EpisodeService에 기대지 않는지) 본다.
    private val episodeMock = mock(EpisodeService::class.java)

    @Suppress("UNCHECKED_CAST")
    private val imageProviders = mock(ObjectProvider::class.java) as ObjectProvider<ContentImageRepository>
    private val episodeService = EpisodeService(access, works, episodes, drafts, current, versions, imageProviders, mock(EntityManager::class.java),
        mock(ForkRepository::class.java), mock(CheckpointEpisodeRepository::class.java), events)
    private val episodeVersions = EpisodeVersionService(access, episodeMock, mock(PublicationService::class.java), world, versionEpisodes, drafts, versions,
        mock(CheckpointRepository::class.java), mock(CheckpointEpisodeRepository::class.java), mock(CheckpointSettingRepository::class.java), mock(EntityManager::class.java))
    private val publication = PublicationService(access, episodeMock, episodes, current, versions, events, visibilityRepo, rights, drafts, works,
        mock(ForkPolicyHistoryRepository::class.java), mock(ForkPolicyEpisodeRepository::class.java), mock(WorkInterestService::class.java), mock(EntityManager::class.java))
    private val schedules = PublicationScheduleService(access, scheduleEpisodes, episodeMock, scheduleRepo, publication, mock(CoreAuthVerificationService::class.java),
        TransactionTemplate(mock(PlatformTransactionManager::class.java)))

    private val draftRequest = DraftRequest("제목", "본문", 0)
    private val publishRequest = PublishRequest(0, true, versionId = "v")
    private val scheduleRequest = PublicationScheduleRequest("v", t0.plusSeconds(3600), true, 0)

    init {
        doThrow(ContentFailure(409, SERIAL_LOCKED_MESSAGE, "SERIAL_LOCKED")).`when`(access).requireManuscriptWritable("w")
        `when`(scheduleEpisodes.findByWorkIdAndSequence("w", 2)).thenReturn(EpisodeEntity("e2", "w", 2))
    }

    // 원고를 바꾸는 서비스 진입점 전부(REST·MCP가 부르는 그 메서드들). 실행 결과는 보지 않고 던지는 예외만 본다.
    private val entries: List<Pair<String, (String) -> Any?>> = listOf(
        "episode create" to { who: String -> episodeService.create("w", who, CreateEpisodeRequest("새 회차")) },
        "draft save" to { who: String -> episodeService.update("w", who, 1, draftRequest) },
        "draft delete" to { who: String -> episodeService.deleteDraft("w", who, 1, 0) },
        "episode delete" to { who: String -> episodeService.deleteEpisode("w", who, 1, 0) },
        "version save with episode" to { who: String -> episodeVersions.saveWithVersion("w", who, 1, draftRequest) },
        "version save" to { who: String -> episodeVersions.save("w", who, 1, draftRequest) },
        "version restore" to { who: String -> episodeVersions.restore("w", who, 1, RevertRequest(0, "v")) },
        "current draft save" to { who: String -> episodeVersions.saveCurrent("w", who, draftRequest) },
        "publish" to { who: String -> publication.publishEpisode("w", who, 1, publishRequest) },
        "publish current" to { who: String -> publication.publishCurrent("w", who, publishRequest) },
        "episode visibility" to { who: String -> publication.visibility("w", who, 1, PublicationVisibilityRequest(0, false)) },
        "schedule create" to { who: String -> schedules.create("w", who, 2, scheduleRequest) },
        "schedule update" to { who: String -> schedules.update("w", who, 2, "s1", scheduleRequest) },
    )

    private fun failure(block: () -> Unit) = assertThrows(ContentFailure::class.java, block)

    // ---- 판정

    @Test fun `AI writing that is on locks the manuscript with the fixed 409`() {
        `when`(serials.findById("w")).thenReturn(Optional.of(settings(true)))

        val failure = failure { rule.requireManuscriptWritable("w") }

        assertEquals(listOf<Any?>(409, "SERIAL_LOCKED", lockedMessage), listOf(failure.status, failure.code, failure.message))
    }

    @Test fun `AI writing that is off or was never set leaves the manuscript writable`() {
        `when`(serials.findById("w")).thenReturn(Optional.of(settings(false)))
        rule.requireManuscriptWritable("w")

        `when`(serials.findById("w")).thenReturn(Optional.empty())
        rule.requireManuscriptWritable("w")
    }

    // ---- 진입점

    @Test fun `every manuscript entry refuses the owner with the fixed 409 while AI writing is on`() {
        for ((name, call) in entries) {
            val failure = failure { call(owner) }
            assertEquals(listOf<Any?>(409, "SERIAL_LOCKED", lockedMessage), listOf(failure.status, failure.code, failure.message), name)
        }
        // 막힌 요청은 아무것도 읽지도 쓰지도 않는다.
        verifyNoInteractions(episodes, drafts, current, versions, works, events, visibilityRepo, rights, scheduleRepo, episodeMock, versionEpisodes, world)
    }

    @Test fun `a stranger still gets 404 before the lock is consulted`() {
        doThrow(ContentFailure(404, "작품을 찾을 수 없어요.")).`when`(access).own("w", "stranger")

        for ((name, call) in entries) assertEquals(404, failure { call("stranger") }.status, name)

        verify(access, never()).requireManuscriptWritable(ArgumentMatchers.anyString())
    }

    // ---- 막지 않는 경로

    private val episode = EpisodeEntity("e", "w", 1)
    private val draft = EpisodeDraftEntity("e", "title", "original", 4)
    private val row = EpisodeCurrentEntity("e", "w", 1)

    @Test fun `the serial run's own entries skip the lock and still write`() {
        `when`(current.findAllByWorkIdOrderBySequence("w")).thenReturn(listOf(row))
        `when`(episodes.findByWorkIdAndSequence("w", 1)).thenReturn(episode)
        `when`(episodes.findAllById(listOf("e"))).thenReturn(listOf(episode))
        `when`(current.findByWorkIdAndSequence("w", 1)).thenReturn(row)
        `when`(drafts.findAllById(listOf("e"))).thenReturn(listOf(draft))
        `when`(drafts.findById("e")).thenReturn(Optional.of(draft))
        `when`(works.findById("w")).thenReturn(Optional.of(WorkEntity(id = "w", revision = 5)))

        assertEquals(1, episodeService.createForSerial("w", owner, CreateEpisodeRequest("새 회차")).number)
        verify(drafts).save(ArgumentMatchers.any(EpisodeDraftEntity::class.java) ?: draft)
        assertEquals("AI 본문", episodeService.updateForSerial("w", owner, 1, DraftRequest("제목", "AI 본문", 4)).draft.body)
        assertEquals("AI 본문", draft.content)

        verify(access, never()).requireManuscriptWritable(ArgumentMatchers.anyString())
    }

    @Test fun `the serial run saves its version through its own entry`() {
        `when`(episodeMock.updateForSerial("w", owner, 4, draftRequest)).thenReturn(EpisodeResponse(4, DraftResponse("제목", "본문", 1), emptyList(), null, false, null))
        `when`(versionEpisodes.findByWorkIdAndSequence("w", 4)).thenReturn(EpisodeEntity("e4", "w", 4))
        `when`(world.snapshot("w", owner, 4)).thenReturn(WorldSnapshotResult("world", "history", emptyList()))

        assertEquals("본문", episodeVersions.saveWithVersionForSerial("w", owner, 4, draftRequest).body)

        verify(episodeMock, never()).update(ArgumentMatchers.anyString(), ArgumentMatchers.anyString(), ArgumentMatchers.anyInt(), ArgumentMatchers.any(DraftRequest::class.java) ?: draftRequest)
        verify(access, never()).requireManuscriptWritable(ArgumentMatchers.anyString())
    }

    @Test fun `a schedule registered earlier still publishes while AI writing is on`() {
        // 예약 실행(publishScheduled)은 켜기 전에 소유자가 등록한 것을 이행하는 경로라 잠그지 않는다: 잠금 자리를 지나 회차를 읽는 데까지 간다.
        `when`(episodeMock.read("w", owner, 2)).thenReturn(EpisodeResponse(2, DraftResponse("t", "b", 0), emptyList(), null, true, null))

        assertEquals(403, failure { publication.publishScheduled("w", owner, 2, "v") }.status)

        verify(episodeMock).read("w", owner, 2)
        verify(access, never()).requireManuscriptWritable(ArgumentMatchers.anyString())
    }

    @Test fun `listing and canceling a schedule stay possible while AI writing is on`() {
        val pending = PublicationScheduleEntity(id = "s1", workId = "w", episodeId = "e2", ownerId = owner, versionId = "v", scheduledAt = t0.plusSeconds(3600))
        `when`(scheduleRepo.findById("s1")).thenReturn(Optional.of(pending))
        `when`(scheduleRepo.findAllByEpisodeIdOrderByScheduledAtDescIdDesc("e2")).thenReturn(listOf(pending))

        assertEquals(1, schedules.list("w", owner, 2).size)
        schedules.cancel("w", owner, 2, "s1", 0)

        assertEquals("canceled", pending.status)
        verify(access, never()).requireManuscriptWritable(ArgumentMatchers.anyString())
    }

    // ---- 우회는 자율 연재 실행만

    @Test fun `only the serial run uses the entries that skip the lock`() {
        val main = Path.of("src/main/kotlin/ai/storyfork/content")
        val users = Files.walk(main).use { paths ->
            paths.filter { it.toString().endsWith(".kt") && Regex("ForSerial\\(").containsMatchIn(Files.readString(it)) }.map { main.relativize(it).toString() }.sorted().toList()
        }

        // 정의한 두 서비스와 SerialService뿐이다. 컨트롤러·MCP 도구 같은 공개 경로가 부르면 이 목록이 늘어 실패한다.
        assertEquals(listOf("episode/service/EpisodeService.kt", "episode_version/service/EpisodeVersionService.kt", "serial/service/SerialService.kt"), users)
    }
}
