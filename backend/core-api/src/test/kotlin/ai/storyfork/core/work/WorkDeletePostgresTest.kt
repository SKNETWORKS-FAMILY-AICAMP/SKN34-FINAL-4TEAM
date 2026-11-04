package ai.storyfork.core.work

import ai.storyfork.core._common.exception.ContentFailure
import ai.storyfork.core.content.fixture.ContentTestConfig
import ai.storyfork.core.content.fixture.ContentTestDriver
import ai.storyfork.core.content.fixture.DraftRequest
import ai.storyfork.core.proposal.client.GenerationClient
import ai.storyfork.core.work.service.WorkService
import ai.storyfork.core.work.service.dto.CreateWorkRequest
import org.junit.jupiter.api.Assertions.*
import org.junit.jupiter.api.Test
import org.junit.jupiter.api.condition.EnabledIfEnvironmentVariable
import org.springframework.beans.factory.annotation.Autowired
import org.springframework.boot.test.context.SpringBootTest
import org.springframework.context.annotation.Import
import org.springframework.jdbc.core.JdbcTemplate
import org.springframework.jdbc.datasource.DriverManagerDataSource
import org.springframework.test.context.bean.override.mockito.MockitoBean

/** 작품 삭제를 실제 PostgreSQL에서 검증한다. TEST_CONTENT_DATABASE_URL이 있을 때만 실행한다. */
@EnabledIfEnvironmentVariable(named="TEST_CONTENT_DATABASE_URL",matches=".+")
@Import(ContentTestConfig::class)
@SpringBootTest(properties=["app.content.enabled=true","CONTENT_DATABASE_URL=\${TEST_CONTENT_DATABASE_URL}","CONTENT_DATABASE_USER=content_test","CONTENT_DATABASE_PASSWORD="])
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
    @Test fun `work with a saved version cannot be deleted and stays intact`() {
        val w=create()
        driver.edit(w.id,"author",DraftRequest("1화","저장 이력이 생기는 원고",w.draft!!.revision))
        assertEquals(409,failure { works.delete(w.id,"author") }.status)
        assertEquals(w.id,works.read(w.id,"author").id)
        assertEquals(1,jdbc.queryForObject("SELECT count(*) FROM episode WHERE work_id=?",Int::class.java,w.id))
    }
}
