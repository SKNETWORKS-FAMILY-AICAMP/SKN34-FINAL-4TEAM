package ai.storyfork.content.storage

import ai.storyfork.content.attachment.entity.ContentImage
import ai.storyfork.content.attachment.repository.ContentImageRepository
import ai.storyfork.content.auth.service.CoreNicknameService
import ai.storyfork.content.fixture.ContentTestConfig
import ai.storyfork.content.fixture.ContentTestDriver
import ai.storyfork.content.fixture.DraftRequest
import ai.storyfork.content.fixture.ForkRequest
import ai.storyfork.content.fixture.PublishRequest
import ai.storyfork.content.fixture.SettingRequest
import ai.storyfork.content.fixture.model.Setting
import ai.storyfork.content.proposal.client.GenerationClient
import ai.storyfork.content.storage.service.StorageUsageService
import ai.storyfork.content.work.service.WorkService
import ai.storyfork.content.work.service.dto.CreateWorkRequest
import java.util.UUID
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.Test
import org.junit.jupiter.api.condition.EnabledIfEnvironmentVariable
import org.springframework.beans.factory.annotation.Autowired
import org.springframework.boot.test.context.SpringBootTest
import org.springframework.context.annotation.Import
import org.springframework.test.context.bean.override.mockito.MockitoBean

/**
 * 저장 사용량 쿼리의 소유자 범위·초안 우선·제외 규칙을 실제 PostgreSQL에서 검증한다. TEST_CONTENT_DATABASE_URL이 있을 때만 실행한다.
 * DB는 다른 테스트와 공유하므로 회원마다 새 UUID를 쓴다.
 */
@EnabledIfEnvironmentVariable(named="TEST_CONTENT_DATABASE_URL",matches=".+")
@Import(ContentTestConfig::class)
@SpringBootTest(properties=["DATABASE_URL=\${TEST_CONTENT_DATABASE_URL}","DATABASE_USER=content_test","DATABASE_PASSWORD="])
class StorageUsagePostgresTest {
    @MockitoBean lateinit var nicknames: CoreNicknameService
    @MockitoBean lateinit var ai: GenerationClient
    @Autowired lateinit var works: WorkService
    @Autowired lateinit var driver: ContentTestDriver
    @Autowired lateinit var usage: StorageUsageService
    @Autowired lateinit var images: ContentImageRepository

    private fun summary(owner: UUID) = usage.read(owner).items.map { listOf(it.kind, it.title, it.parentTitle, it.bytes) }
    private fun write(work: String, owner: String, body: String, save: Boolean) =
        driver.writeEpisode(work, owner, 1, DraftRequest("시작", body, driver.writing(work, owner, 1).draft.revision), save)

    @Test fun `only the member's live content is counted and a draft wins over the saved version`() {
        val owner = UUID.randomUUID(); val me = owner.toString()
        val work = works.create(me, CreateWorkRequest("저장 사용량", "소개")).id
        write(work, me, "옛 저장 본문입니다", true)
        write(work, me, "가나다", false)
        images.saveAndFlush(ContentImage(workId=work, episodeNo=1, objectKey="storage-usage/$work/1", filename="map.png", mediaType="image/png", byteSize=500))
        images.saveAndFlush(ContentImage(workId=work, objectKey="storage-usage/$work/cover", filename="cover.png", mediaType="image/png", byteSize=700))
        var world = driver.world(work, me)
        world = driver.saveSetting(work, "new", me, SettingRequest(world.revision, Setting(name="옛 장소", content="비밀 통로"), world.sourceToken))
        val gone = works.create(me, CreateWorkRequest("삭제할 작품", "소개")).id
        write(gone, me, "삭제될 본문", false)
        works.delete(gone, me)
        val other = UUID.randomUUID()
        works.create(other.toString(), CreateWorkRequest("남의 작품", "소개"))

        assertEquals(listOf(
            listOf("manuscript_image", "map.png", "저장 사용량 · 1화", 500L),
            listOf("setting", "옛 장소", world.name, 13L),
            listOf("manuscript", "1화 · 시작", "저장 사용량", 9L),
        ), summary(owner))
        assertTrue(summary(other).none { it[2].toString().startsWith("저장 사용량") })
    }

    @Test fun `a fork does not count the episodes it inherits from the original`() {
        val author = UUID.randomUUID().toString(); val forker = UUID.randomUUID()
        val originalBody = "원작 본문"
        val original = works.create(author, CreateWorkRequest("저장 원작", "소개", "ORIGINAL", listOf("판타지"), emptyList(), true)).id
        val draft = driver.edit(original, author, DraftRequest("출발", originalBody, driver.read(original, author).draft!!.revision))
        driver.publish(original, author, PublishRequest(draft.revision, true, true, true, driver.history(original, author).versions.last().id))

        val forkOwner = forker.toString()
        val fork = driver.fork(original, forkOwner, ForkRequest(1, "저장 분기")).id
        val inherited = driver.writing(fork, forkOwner, 1)
        assertTrue(inherited.inherited)
        assertEquals(originalBody, inherited.draft.body)
        val forkBody = "분기 원고"
        val next = driver.writing(fork, forkOwner, 2)
        driver.writeEpisode(fork, forkOwner, 2, DraftRequest("다음 장면", forkBody, next.draft.revision), false)

        val originalEpisode = summary(UUID.fromString(author)).single { it[0] == "manuscript" && it[1] == "1화 · 출발" }
        assertEquals(listOf("manuscript", "1화 · 출발", "저장 원작", originalBody.encodeToByteArray().size.toLong()), originalEpisode)
        assertEquals(listOf(listOf("manuscript", "2화 · 다음 장면", "저장 분기", forkBody.encodeToByteArray().size.toLong())),
            summary(forker))
    }
}
