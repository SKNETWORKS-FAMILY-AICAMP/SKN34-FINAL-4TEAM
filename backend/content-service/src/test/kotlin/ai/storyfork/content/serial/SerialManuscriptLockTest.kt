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
 * AI 자율 집필(집필 방식 autonomous = ai_serial.enabled)이 켜져 있는 동안 소유자는 1화만 직접 쓴다(계약 'AI 자율 집필 = 집필 방식')를 DB 없이 검증한다.
 * 판정은 WorkAccessService의 두 함수다: [WorkAccessService.requireEpisodeWritable](회차 단위, 1화는 통과)와 [WorkAccessService.requireManuscriptWritable](회차를 가리지 않는 쓰기).
 * 원고를 바꾸는 서비스 진입점은 소유 확인 뒤에 자기 대상 회차 번호로 그 함수를 부른다. REST·Content MCP 쓰기 도구·집필 AI의 반영(MCP episode_update_draft)·수정 제안 승인이 모두 같은 서비스를 거친다.
 * 자율 연재 실행 자신의 저장만 별도 진입점(...ForSerial)으로 잠금을 건너뛰고, 그 진입점은 SerialService만 부른다.
 */
class SerialManuscriptLockTest {
    private val owner = "owner"
    private val t0 = Instant.parse("2026-11-23T12:10:00Z")
    private val lockedMessage = "AI 자율 집필 중에는 1화만 직접 쓸 수 있어요. 운영 설정 > 집필 방식을 바꾸면 모든 회차를 쓸 수 있어요."

    // ---- 판정 규칙(실제 WorkAccessService)
    private val serials = mock(AiSerialRepository::class.java)
    private val rule = WorkAccessService(mock(WorkRepository::class.java), mock(WorkWorldHistoryRepository::class.java), mock(WorkPublicationHistoryRepository::class.java),
        mock(ForkPolicyHistoryRepository::class.java), mock(ForkPolicyEpisodeRepository::class.java), mock(ForkRepository::class.java), mock(CheckpointRepository::class.java),
        mock(EpisodeRepository::class.java), mock(EpisodeVersionRepository::class.java), serials, mock(EntityManager::class.java))

    private fun settings(enabled: Boolean) = AiSerialEntity("w", enabled, "MON", LocalTime.of(21, 0), "", null, t0)

    // ---- 진입점(서비스는 실제, 저장소는 대역). access는 잠금이 켜진 것처럼 2화와 작품 단위 쓰기를 거절한다.
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
    private val versionPublication = mock(PublicationService::class.java)

    @Suppress("UNCHECKED_CAST")
    private val imageProviders = mock(ObjectProvider::class.java) as ObjectProvider<ContentImageRepository>
    private val episodeService = EpisodeService(access, works, episodes, drafts, current, versions, imageProviders, mock(EntityManager::class.java),
        mock(ForkRepository::class.java), mock(CheckpointEpisodeRepository::class.java), events)
    private val episodeVersions = EpisodeVersionService(access, episodeMock, versionPublication, world, versionEpisodes, drafts, versions,
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
        doThrow(ContentFailure(409, SERIAL_LOCKED_MESSAGE, "SERIAL_LOCKED")).`when`(access).requireEpisodeWritable("w", 2)
        `when`(scheduleEpisodes.findByWorkIdAndSequence("w", 1)).thenReturn(EpisodeEntity("e1", "w", 1))
        `when`(scheduleEpisodes.findByWorkIdAndSequence("w", 2)).thenReturn(EpisodeEntity("e2", "w", 2))
        // 1화가 이미 발행돼 있다: 새 회차는 2화이고, 작품 단위 저장·발행의 대상도 2화다.
        `when`(current.lastNumber("w")).thenReturn(1)
        `when`(current.findAllByWorkIdOrderBySequence("w")).thenReturn(listOf(EpisodeCurrentEntity("e1", "w", 1, "v1")))
        `when`(versionPublication.nextEpisodeNumber("w")).thenReturn(2)
    }

    // 회차 단위로 원고를 바꾸는 서비스 진입점(REST·MCP가 부르는 그 메서드들). 실행 결과는 보지 않고 던지는 예외만 본다.
    private val episodeEntries: List<Pair<String, (String, Int) -> Any?>> = listOf(
        "draft save" to { who: String, n: Int -> episodeService.update("w", who, n, draftRequest) },
        "draft delete" to { who: String, n: Int -> episodeService.deleteDraft("w", who, n, 0) },
        "episode delete" to { who: String, n: Int -> episodeService.deleteEpisode("w", who, n, 0) },
        "version save with episode" to { who: String, n: Int -> episodeVersions.saveWithVersion("w", who, n, draftRequest) },
        "version save" to { who: String, n: Int -> episodeVersions.save("w", who, n, draftRequest) },
        "version restore" to { who: String, n: Int -> episodeVersions.restore("w", who, n, RevertRequest(0, "v")) },
        "publish" to { who: String, n: Int -> publication.publishEpisode("w", who, n, publishRequest) },
        "episode visibility" to { who: String, n: Int -> publication.visibility("w", who, n, PublicationVisibilityRequest(0, false)) },
        "schedule create" to { who: String, n: Int -> schedules.create("w", who, n, scheduleRequest) },
        "schedule update" to { who: String, n: Int -> schedules.update("w", who, n, "s1", scheduleRequest) },
    )

    // 회차를 가리지 않는 진입점: 새 회차는 이미 회차가 있을 때, 작품 단위 저장·발행은 대상(마지막 발행+1)이 2화 이상일 때 잠긴다.
    private val workEntries: List<Pair<String, (String) -> Any?>> = listOf(
        "episode create" to { who: String -> episodeService.create("w", who, CreateEpisodeRequest("새 회차")) },
        "current draft save" to { who: String -> episodeVersions.saveCurrent("w", who, draftRequest) },
        "publish current" to { who: String -> publication.publishCurrent("w", who, publishRequest) },
    )

    private fun failure(block: () -> Unit) = assertThrows(ContentFailure::class.java, block)

    private fun assertLocked(name: String, block: () -> Unit) {
        val failure = failure(block)
        assertEquals(listOf<Any?>(409, "SERIAL_LOCKED", lockedMessage), listOf(failure.status, failure.code, failure.message), name)
    }

    // ---- 판정

    @Test fun `AI autonomous writing that is on locks work level writes with the fixed 409`() {
        `when`(serials.findById("w")).thenReturn(Optional.of(settings(true)))

        val failure = failure { rule.requireManuscriptWritable("w") }

        assertEquals(listOf<Any?>(409, "SERIAL_LOCKED", lockedMessage), listOf(failure.status, failure.code, failure.message))
    }

    @Test fun `AI autonomous writing that is off or was never set leaves the manuscript writable`() {
        `when`(serials.findById("w")).thenReturn(Optional.of(settings(false)))
        rule.requireManuscriptWritable("w")
        rule.requireEpisodeWritable("w", 2)

        `when`(serials.findById("w")).thenReturn(Optional.empty())
        rule.requireManuscriptWritable("w")
        rule.requireEpisodeWritable("w", 2)
    }

    @Test fun `episode one stays writable while it is on but later episodes are locked`() {
        `when`(serials.findById("w")).thenReturn(Optional.of(settings(true)))

        rule.requireEpisodeWritable("w", 1)
        for (number in listOf(2, 3, 10)) {
            val failure = failure { rule.requireEpisodeWritable("w", number) }
            assertEquals(listOf<Any?>(409, "SERIAL_LOCKED", lockedMessage), listOf(failure.status, failure.code, failure.message), "episode $number")
        }
    }

    // ---- 진입점

    @Test fun `every entry refuses the owner for episode 2 and for work level writes with the fixed 409`() {
        for ((name, call) in episodeEntries) assertLocked(name) { call(owner, 2) }
        for ((name, call) in workEntries) assertLocked(name) { call(owner) }

        // 막힌 요청은 아무것도 쓰지 않는다(읽기만 한다).
        verifyNoInteractions(episodes, drafts, versions, works, events, visibilityRepo, rights, scheduleRepo, episodeMock, versionEpisodes, world)
    }

    @Test fun `every episode entry asks the lock about its own episode number so episode 1 stays writable`() {
        for ((name, call) in episodeEntries) {
            val error = runCatching { call(owner, 1) }.exceptionOrNull()
            // 잠금은 통과한다: 이어지는 대역 때문에 다른 예외가 날 수 있어도 SERIAL_LOCKED는 아니다.
            assertFalse(error is ContentFailure && error.code == "SERIAL_LOCKED", name)
        }

        verify(access, times(episodeEntries.size)).requireEpisodeWritable("w", 1)
        verify(access, never()).requireManuscriptWritable(ArgumentMatchers.anyString())
    }

    @Test fun `a new episode is open when no episode exists and locked once one does`() {
        `when`(current.lastNumber("w")).thenReturn(0)
        `when`(episodes.saveAndFlush(ArgumentMatchers.any(EpisodeEntity::class.java) ?: EpisodeEntity("x", "w", 1))).thenAnswer { it.arguments[0] }
        `when`(works.findById("w")).thenReturn(Optional.of(WorkEntity(id = "w", revision = 5)))

        // 활성 회차가 하나도 없으면(1화 만들기) 잠그지 않는다: 가드를 부르지 않고 만들기까지 간다.
        runCatching { episodeService.create("w", owner, CreateEpisodeRequest("1화")) }

        verify(drafts).save(ArgumentMatchers.any(EpisodeDraftEntity::class.java) ?: EpisodeDraftEntity("x"))
        verify(access, never()).requireManuscriptWritable(ArgumentMatchers.anyString())
    }

    @Test fun `work level saves are open when the target is episode 1`() {
        // 발행된 회차가 없으면 작품 단위 저장·발행의 대상은 1화다.
        `when`(versionPublication.nextEpisodeNumber("w")).thenReturn(1)
        `when`(current.findAllByWorkIdOrderBySequence("w")).thenReturn(emptyList())

        runCatching { episodeVersions.saveCurrent("w", owner, draftRequest) }
        runCatching { publication.publishCurrent("w", owner, publishRequest) }

        verify(access, times(2)).requireEpisodeWritable("w", 1)
        verify(access, never()).requireManuscriptWritable(ArgumentMatchers.anyString())
    }

    @Test fun `a stranger still gets 404 before the lock is consulted`() {
        doThrow(ContentFailure(404, "작품을 찾을 수 없어요.")).`when`(access).own("w", "stranger")

        for ((name, call) in episodeEntries) assertEquals(404, failure { call("stranger", 2) }.status, name)
        for ((name, call) in workEntries) assertEquals(404, failure { call("stranger") }.status, name)

        verify(access, never()).requireManuscriptWritable(ArgumentMatchers.anyString())
        verify(access, never()).requireEpisodeWritable(ArgumentMatchers.anyString(), ArgumentMatchers.anyInt())
    }

    // ---- 막지 않는 경로

    private val episode = EpisodeEntity("e", "w", 1)
    private val draft = EpisodeDraftEntity("e", "title", "original", 4)
    private val row = EpisodeCurrentEntity("e", "w", 1)

    @Test fun `the serial run's own entries skip the lock and still write`() {
        `when`(current.lastNumber("w")).thenReturn(0)
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
        verify(access, never()).requireEpisodeWritable(ArgumentMatchers.anyString(), ArgumentMatchers.anyInt())
    }

    @Test fun `the serial run saves its version through its own entry`() {
        `when`(episodeMock.updateForSerial("w", owner, 4, draftRequest)).thenReturn(EpisodeResponse(4, DraftResponse("제목", "본문", 1), emptyList(), null, false, null))
        `when`(versionEpisodes.findByWorkIdAndSequence("w", 4)).thenReturn(EpisodeEntity("e4", "w", 4))
        `when`(world.snapshot("w", owner, 4)).thenReturn(WorldSnapshotResult("world", "history", emptyList()))

        assertEquals("본문", episodeVersions.saveWithVersionForSerial("w", owner, 4, draftRequest).body)

        verify(episodeMock, never()).update(ArgumentMatchers.anyString(), ArgumentMatchers.anyString(), ArgumentMatchers.anyInt(), ArgumentMatchers.any(DraftRequest::class.java) ?: draftRequest)
        verify(access, never()).requireManuscriptWritable(ArgumentMatchers.anyString())
        verify(access, never()).requireEpisodeWritable(ArgumentMatchers.anyString(), ArgumentMatchers.anyInt())
    }

    @Test fun `a schedule registered earlier still publishes while AI writing is on`() {
        // 예약 실행(publishScheduled)은 켜기 전에 소유자가 등록한 발행을 이행하는 경로라 잠그지 않는다: 잠금 자리를 지나 회차를 읽는 데까지 간다.
        `when`(episodeMock.read("w", owner, 2)).thenReturn(EpisodeResponse(2, DraftResponse("t", "b", 0), emptyList(), null, true, null))

        assertEquals(403, failure { publication.publishScheduled("w", owner, 2, "v") }.status)

        verify(episodeMock).read("w", owner, 2)
        verify(access, never()).requireManuscriptWritable(ArgumentMatchers.anyString())
        verify(access, never()).requireEpisodeWritable(ArgumentMatchers.anyString(), ArgumentMatchers.anyInt())
    }

    @Test fun `listing and canceling a schedule stay possible while AI writing is on`() {
        val pending = PublicationScheduleEntity(id = "s1", workId = "w", episodeId = "e2", ownerId = owner, versionId = "v", scheduledAt = t0.plusSeconds(3600))
        `when`(scheduleRepo.findById("s1")).thenReturn(Optional.of(pending))
        `when`(scheduleRepo.findAllByEpisodeIdOrderByScheduledAtDescIdDesc("e2")).thenReturn(listOf(pending))

        assertEquals(1, schedules.list("w", owner, 2).size)
        schedules.cancel("w", owner, 2, "s1", 0)

        assertEquals("canceled", pending.status)
        verify(access, never()).requireManuscriptWritable(ArgumentMatchers.anyString())
        verify(access, never()).requireEpisodeWritable(ArgumentMatchers.anyString(), ArgumentMatchers.anyInt())
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
