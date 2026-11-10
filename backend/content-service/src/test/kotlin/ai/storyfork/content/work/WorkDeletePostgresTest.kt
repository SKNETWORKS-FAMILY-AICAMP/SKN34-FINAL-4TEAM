package ai.storyfork.content.work

import ai.storyfork.content.auth.service.CoreNicknameService
import ai.storyfork.content._common.exception.ContentFailure
import ai.storyfork.content.fixture.ContentTestConfig
import ai.storyfork.content.fixture.ContentTestDriver
import ai.storyfork.content.fixture.DraftRequest
import ai.storyfork.content.fixture.SettingRequest
import ai.storyfork.content.fixture.model.Setting
import ai.storyfork.content.proposal.client.GenerationClient
import ai.storyfork.content.work.service.WorkService
import ai.storyfork.content.work.service.dto.CreateWorkRequest
import ai.storyfork.content.work.service.dto.PolicyRequest
import org.junit.jupiter.api.Assertions.*
import org.junit.jupiter.api.Test
import org.junit.jupiter.api.condition.EnabledIfEnvironmentVariable
import org.junit.jupiter.params.ParameterizedTest
import org.junit.jupiter.params.provider.ValueSource
import org.springframework.beans.factory.annotation.Autowired
import org.springframework.boot.test.context.SpringBootTest
import org.springframework.context.annotation.Import
import org.springframework.jdbc.core.JdbcTemplate
import org.springframework.jdbc.datasource.DriverManagerDataSource
import org.springframework.test.context.bean.override.mockito.MockitoBean

/** 작품 삭제를 실제 PostgreSQL에서 검증한다. TEST_CONTENT_DATABASE_URL이 있을 때만 실행한다. */
@EnabledIfEnvironmentVariable(named="TEST_CONTENT_DATABASE_URL",matches=".+")
@Import(ContentTestConfig::class)
@SpringBootTest(properties=["DATABASE_URL=\${TEST_CONTENT_DATABASE_URL}","DATABASE_USER=content_test","DATABASE_PASSWORD="])
class WorkDeletePostgresTest {
    // 작가명·작성자명은 Core 닉네임이다. 이 테스트는 이름을 보지 않으므로 Core 조회는 빈 결과를 돌려주는 대역이다.
    @MockitoBean lateinit var nicknames: CoreNicknameService
    @Autowired lateinit var works: WorkService
    @Autowired lateinit var driver: ContentTestDriver
    @MockitoBean lateinit var ai: GenerationClient
    private val jdbc get() = JdbcTemplate(DriverManagerDataSource(System.getenv("TEST_CONTENT_DATABASE_URL"),"content_test",""))
    private fun create(title: String = "삭제 검증") = works.create("author",CreateWorkRequest(title,"소개"))
    private fun failure(block: () -> Unit) = assertThrows(ContentFailure::class.java) { block() }

    @Test fun `another user cannot delete and sees 404`() {
        val w=create()
        assertEquals(404,failure { works.delete(w.id,"intruder") }.status)
        assertEquals(w.id,works.read(w.id,"author").id)
        assertNull(deletedAt(w.id))
    }
    @Test fun `owner soft deletes a work and every row stays`() {
        val w=create()
        val before=rowCounts(w.id)

        works.delete(w.id,"author")

        assertNotNull(deletedAt(w.id))
        assertEquals(before,rowCounts(w.id))
        assertEquals(404,failure { works.read(w.id,"author") }.status)
        assertTrue(works.list("author").items.none { it.id==w.id })
    }
    @Test fun `a deleted work disappears from public lists and public reads`() {
        val w=create("공개 삭제 검증")
        works.delete(w.id,"author")

        assertTrue(works.publicList(null,null,null).items.none { it.id==w.id })
        assertEquals(404,failure { works.publicRead(w.id) }.status)
    }
    @ParameterizedTest
    @ValueSource(booleans=[false,true])
    fun `a work with draft or committed settings can be deleted and keeps its data`(committed: Boolean) {
        val w=works.create("author",CreateWorkRequest("설정 보존 검증","소개","ORIGINAL",listOf("판타지"),listOf("보존"),true))
        works.policy(w.id,"author",PolicyRequest(0,true,true))
        var world=driver.world(w.id,"author")
        world=driver.saveSetting(w.id,"new","author",SettingRequest(world.revision,
            Setting(name="보존할 규칙",content="비공개 설정 본문",tags=listOf("세계관"),knownBy=listOf("인물")),world.sourceToken))
        if(committed) world=driver.commitSetting(w.id,world.draft!!.id,"author",world.revision)
        val before=rowCounts(w.id)

        works.delete(w.id,"author")

        assertNotNull(deletedAt(w.id))
        assertEquals(before,rowCounts(w.id))
    }
    @Test fun `a work with a saved version can be deleted and keeps its episode`() {
        val w=create()
        driver.edit(w.id,"author",DraftRequest("1화","저장 이력이 생기는 원고",w.draft!!.revision))

        works.delete(w.id,"author")

        assertNotNull(deletedAt(w.id))
        assertEquals(1,jdbc.queryForObject("SELECT count(*) FROM episode WHERE work_id=?",Int::class.java,w.id))
    }
    private fun deletedAt(id: String) = jdbc.queryForList("SELECT deleted_at FROM work WHERE id=?",id).single()["deleted_at"]
    private fun rowCounts(id: String) = listOf("world","episode","work_genre","work_hashtag","work_rights_declaration",
        "work_world_history","work_publication_history","fork_policy_history").associateWith {
        jdbc.queryForObject("SELECT count(*) FROM $it WHERE work_id=?",Int::class.java,id)
    }
}
