package ai.storyfork.content.work

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
@SpringBootTest(properties=["app.content.enabled=true","DATABASE_URL=\${TEST_CONTENT_DATABASE_URL}","DATABASE_USER=content_test","DATABASE_PASSWORD="])
class WorkDeletePostgresTest {
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
    }
    @Test fun `owner deletes a fresh work and its default rows disappear`() {
        val w=create()
        works.delete(w.id,"author")
        assertEquals(404,failure { works.read(w.id,"author") }.status)
        assertTrue(works.list("author").items.none { it.id==w.id })
        for(table in listOf("work","world","episode","work_world_history","work_publication_history")) {
            val column=if(table=="work"||table=="world") "id" else "work_id"
            assertEquals(0,jdbc.queryForObject("SELECT count(*) FROM $table WHERE $column=?",Int::class.java,w.id),table)
        }
    }
    @ParameterizedTest
    @ValueSource(booleans=[false,true])
    fun `draft or committed settings block deletion and preserve persisted data`(committed: Boolean) {
        val w=works.create("author",CreateWorkRequest("설정 보존 검증","소개","ORIGINAL",listOf("판타지"),listOf("보존"),true))
        works.policy(w.id,"author",PolicyRequest(0,true,true))
        var world=driver.world(w.id,"author")
        world=driver.saveSetting(w.id,"new","author",SettingRequest(world.revision,
            Setting(name="보존할 규칙",content="비공개 설정 본문",tags=listOf("세계관"),knownBy=listOf("인물")),world.sourceToken))
        if(committed) world=driver.commitSetting(w.id,world.draft!!.id,"author",world.revision)
        val before=works.read(w.id,"author")
        val history=works.history(w.id,"author")
        val tables=listOf("work","world","episode","work_genre","work_hashtag","work_rights_declaration",
            "work_world_history","work_publication_history","fork_policy_history")
        fun rows() = tables.associateWith { table ->
            val column=if(table=="work"||table=="world") "id" else "work_id"
            jdbc.queryForList("SELECT * FROM $table WHERE $column=? ORDER BY 1",w.id)
        }
        val persisted=rows()
        val draftRows=jdbc.queryForList("SELECT * FROM episode_draft WHERE episode_id IN (SELECT id FROM episode WHERE work_id=?)",w.id)

        val rejected=failure { works.delete(w.id,"author") }

        assertEquals(409,rejected.status)
        assertTrue(rejected.message.contains("설정"))
        assertEquals(before,works.read(w.id,"author"))
        assertEquals(history,works.history(w.id,"author"))
        assertEquals(world,driver.world(w.id,"author"))
        assertEquals(persisted,rows())
        assertEquals(draftRows,jdbc.queryForList("SELECT * FROM episode_draft WHERE episode_id IN (SELECT id FROM episode WHERE work_id=?)",w.id))
    }
    @Test fun `work with a saved version cannot be deleted and stays intact`() {
        val w=create()
        driver.edit(w.id,"author",DraftRequest("1화","저장 이력이 생기는 원고",w.draft!!.revision))
        assertEquals(409,failure { works.delete(w.id,"author") }.status)
        assertEquals(w.id,works.read(w.id,"author").id)
        assertEquals(1,jdbc.queryForObject("SELECT count(*) FROM episode WHERE work_id=?",Int::class.java,w.id))
    }
}
