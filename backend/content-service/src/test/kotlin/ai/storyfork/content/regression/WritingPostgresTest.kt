package ai.storyfork.content.regression

import ai.storyfork.content.auth.service.CoreNicknameService
import org.springframework.test.context.bean.override.mockito.MockitoBean
import ai.storyfork.content.fixture.*
import ai.storyfork.content.fixture.model.ContentFailure
import ai.storyfork.content.fixture.ContentTestDriver
import org.junit.jupiter.api.Assertions.*
import org.junit.jupiter.api.Test
import org.junit.jupiter.api.condition.EnabledIfEnvironmentVariable
import org.springframework.beans.factory.annotation.Autowired
import org.springframework.boot.test.context.SpringBootTest
import org.springframework.jdbc.core.JdbcTemplate
import org.springframework.jdbc.datasource.DriverManagerDataSource

@EnabledIfEnvironmentVariable(named="TEST_CONTENT_DATABASE_URL",matches=".+")
@org.springframework.context.annotation.Import(ai.storyfork.content.fixture.ContentTestConfig::class)
@SpringBootTest(properties=["DATABASE_URL=\${TEST_CONTENT_DATABASE_URL}","DATABASE_USER=content_test","DATABASE_PASSWORD="])
class WritingPostgresTest {
    // 작가명·작성자명은 Core 닉네임이다. 이 테스트는 이름을 보지 않으므로 Core 조회는 빈 결과를 돌려주는 대역이다.
    @MockitoBean lateinit var nicknames: CoreNicknameService
    @Autowired lateinit var service: ContentTestDriver
    private val jdbc get() = JdbcTemplate(DriverManagerDataSource(System.getenv("TEST_CONTENT_DATABASE_URL"),"content_test",""))

    @Test fun `independent episode drafts versions restore and publication survive reload`() {
        val w=service.create("writer",CreateWorkRequest("회차 저장 검증"))
        val second=service.createEpisode(w.id,"writer",CreateWorkRequest("2화"))
        assertEquals(2,second.number)
        val first=service.writing(w.id,"writer",1)
        val auto=service.writeEpisode(w.id,"writer",1,DraftRequest("1화","자동 저장",first.draft.revision),false)
        assertTrue(auto.versions.isEmpty())
        assertEquals(409,assertThrows(ContentFailure::class.java) { service.publish(w.id,"writer",PublishRequest(service.read(w.id,"writer").draft!!.revision,true)) }.status)
        val saved=service.writeEpisode(w.id,"writer",1,DraftRequest("1화","확정 원고",auto.draft.revision),true)
        val version=saved.versions.single()
        val published=service.publishEpisode(w.id,"writer",1,PublishRequest(saved.draft.revision,true,versionId=version.id))
        assertEquals(409,assertThrows(ContentFailure::class.java) { service.publishEpisode(w.id,"writer",1,PublishRequest(saved.draft.revision,true,versionId=version.id)) }.status)
        val edited=service.writeEpisode(w.id,"writer",1,DraftRequest("수정 제목","미공개 수정",published.draft.revision),false)
        val restored=service.restoreEpisode(w.id,"writer",1,RevertRequest(edited.draft.revision,version.id))
        assertEquals(2,restored.versions.size)
        assertEquals("확정 원고",restored.draft.body)
        assertNotEquals(version.id,restored.versions.last().id)
        assertEquals(version.id,restored.publishedVersionId)
        assertEquals("확정 원고",service.publicRead(w.id).episodes.single().body)
        assertEquals("2화",service.writing(w.id,"writer",2).draft.title)
        assertEquals(2,service.writingList(w.id,"writer").size)
        assertEquals(409,assertThrows(ContentFailure::class.java) { service.writeEpisode(w.id,"writer",1,DraftRequest("충돌","덮어쓰기",edited.draft.revision),false) }.status)
        assertEquals(restored.draft,service.writing(w.id,"writer",1).draft)
        assertEquals(404,assertThrows(ContentFailure::class.java) { service.writing(w.id,"other",1) }.status)
        assertEquals(404,assertThrows(ContentFailure::class.java) { service.createEpisode(w.id,"other",CreateWorkRequest("침입")) }.status)
        assertEquals(409,assertThrows(ContentFailure::class.java) { service.publishEpisode(w.id,"writer",2,PublishRequest(second.draft.revision,true,versionId=version.id)) }.status)
    }

    @Test fun `version insert failure rolls back draft and inherited fork episodes reject writes`() {
        val w=service.create("writer",CreateWorkRequest("실패 및 분기 검증"))
        val saved=service.writeEpisode(w.id,"writer",1,DraftRequest("원고","보존",0),true)
        val published=service.publishEpisode(w.id,"writer",1,PublishRequest(saved.draft.revision,true,versionId=saved.versions.single().id))
        val constraint="test_reject_"+java.util.UUID.randomUUID().toString().replace("-","")
        jdbc.execute("ALTER TABLE episode_version ADD CONSTRAINT $constraint CHECK(content <> '$constraint') NOT VALID")
        try {
            assertThrows(org.springframework.dao.DataIntegrityViolationException::class.java) {
                service.writeEpisode(w.id,"writer",1,DraftRequest("실패",constraint,published.draft.revision),true)
            }
            assertEquals(published.draft,service.writing(w.id,"writer",1).draft)
            assertEquals(saved.versions,service.writing(w.id,"writer",1).versions)
            assertEquals("보존",service.publicRead(w.id).episodes.single().body)
        } finally { jdbc.execute("ALTER TABLE episode_version DROP CONSTRAINT $constraint") }
        service.policy(w.id,"writer",PolicyRequest(service.read(w.id,"writer").draft!!.revision,true,true))
        assertEquals(1, jdbc.queryForObject("SELECT count(*) FROM publication_event p JOIN episode_version v ON v.id=p.episode_version_id JOIN episode e ON e.id=v.episode_id WHERE e.work_id=?", Int::class.java, w.id))
        val fork=service.fork(w.id,"reader",ForkRequest(1,"분기"))
        val inherited=service.writing(fork.id,"reader",1)
        assertTrue(inherited.inherited)
        assertEquals(403,assertThrows(ContentFailure::class.java) { service.writeEpisode(fork.id,"reader",1,DraftRequest("침범","원작 수정",inherited.draft.revision),true) }.status)
        assertEquals(saved.versions.single().id,inherited.publishedVersionId)
    }
}
