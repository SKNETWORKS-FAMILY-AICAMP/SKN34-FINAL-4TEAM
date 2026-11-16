package ai.storyfork.content.publication

import ai.storyfork.content._common.exception.ContentFailure
import ai.storyfork.content.fixture.*
import ai.storyfork.content.publication.service.PublicationService
import ai.storyfork.content.publication.service.dto.PublicationVisibilityRequest
import org.junit.jupiter.api.Assertions.*
import org.junit.jupiter.api.Test
import org.junit.jupiter.api.condition.EnabledIfEnvironmentVariable
import org.springframework.beans.factory.annotation.Autowired
import org.springframework.boot.test.context.SpringBootTest
import org.springframework.context.annotation.Import
import java.util.UUID
import ai.storyfork.content.auth.service.CoreNicknameService
import org.springframework.test.context.bean.override.mockito.MockitoBean

/** 실제 DB·Flyway와 고정 Fork 보존 검증은 CI integrationTest에서만 실행한다. */
@EnabledIfEnvironmentVariable(named="TEST_CONTENT_DATABASE_URL",matches=".+")
@Import(ContentTestConfig::class)
@SpringBootTest(properties=["DATABASE_URL=\${TEST_CONTENT_DATABASE_URL}","DATABASE_USER=content_test","DATABASE_PASSWORD="])
class PublicationVisibilityPostgresTest {
    @MockitoBean lateinit var nicknames: CoreNicknameService
    @Autowired lateinit var service: ContentTestDriver
    @Autowired lateinit var publication: PublicationService
    @Autowired lateinit var episodes: ai.storyfork.content.episode.service.EpisodeService

    @Test fun `suspension preserves numbering pinned forks and the exact republished version`() {
        val work=service.create("author",CreateWorkRequest("공개 상태 "+UUID.randomUUID()))
        repeat(3) { index ->
            val draft=service.edit(work.id,"author",DraftRequest("${index+1}화","원고 ${index+1}",service.read(work.id,"author").draft!!.revision))
            val version=service.history(work.id,"author").versions.last().id
            service.publish(work.id,"author",PublishRequest(draft.revision,true,true,true,version))
        }
        val beforeOwner="reader-before-"+UUID.randomUUID()
        val fork=service.fork(work.id,beforeOwner,ForkRequest(3,"기존 Fork"))
        val before=episodes.read(work.id,"author",2)
        val stopped=publication.visibility(work.id,"author",2,PublicationVisibilityRequest(before.draft.revision,false))
        assertEquals("suspended",stopped.publicationStatus)
        assertNull(stopped.publishedVersionId)
        assertEquals(before.checkpoints.map {it.copy(active=false)},stopped.checkpoints)
        assertEquals(listOf(1,3),service.publicRead(work.id).episodes.map {it.number})
        assertEquals(4,publication.nextEpisodeNumber(work.id))
        assertEquals(listOf(1,2,3),service.read(fork.id,beforeOwner).episodes.map {it.number})
        assertThrows(ContentFailure::class.java) { service.fork(work.id,"reader-blocked-"+UUID.randomUUID(),ForkRequest(2,"중단 기준")) }
        val afterOwner="reader-after-"+UUID.randomUUID()
        val after=service.fork(work.id,afterOwner,ForkRequest(3,"새 Fork"))
        assertEquals(listOf(1,3),after.episodes.map {it.number})
        assertEquals(4,publication.nextEpisodeNumber(after.id))
        val restored=publication.visibility(work.id,"author",2,PublicationVisibilityRequest(stopped.draft.revision,true,true))
        assertEquals(before.publishedVersionId,restored.publishedVersionId)
        assertEquals(before.checkpoints,restored.checkpoints)
        assertEquals(listOf(1,2,3),service.read(fork.id,beforeOwner).episodes.map {it.number})
        assertEquals(listOf(1,3),service.read(after.id,afterOwner).episodes.map {it.number})
        assertEquals(listOf(1,2,3),service.publicRead(work.id).episodes.map {it.number})
        assertEquals(listOf("publish","unpublish","republish"),publication.history(work.id).items.filter {it.episode==2}.map {it.action})
    }
}
