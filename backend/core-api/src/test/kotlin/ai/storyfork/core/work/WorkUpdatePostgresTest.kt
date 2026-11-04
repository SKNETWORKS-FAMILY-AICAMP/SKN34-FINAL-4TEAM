package ai.storyfork.core.work

import ai.storyfork.core._common.exception.ContentFailure
import ai.storyfork.core.content.fixture.ContentTestConfig
import ai.storyfork.core.proposal.client.GenerationClient
import ai.storyfork.core.work.service.WorkService
import ai.storyfork.core.work.service.dto.CreateWorkRequest
import ai.storyfork.core.work.service.dto.UpdateWorkRequest
import org.junit.jupiter.api.Assertions.*
import org.junit.jupiter.api.Test
import org.junit.jupiter.api.condition.EnabledIfEnvironmentVariable
import org.springframework.beans.factory.annotation.Autowired
import org.springframework.boot.test.context.SpringBootTest
import org.springframework.context.annotation.Import
import org.springframework.jdbc.core.JdbcTemplate
import org.springframework.jdbc.datasource.DriverManagerDataSource
import org.springframework.test.context.bean.override.mockito.MockitoBean

/** 작품 수정을 실제 PostgreSQL에서 검증한다. TEST_CONTENT_DATABASE_URL이 있을 때만 실행한다. */
@EnabledIfEnvironmentVariable(named="TEST_CONTENT_DATABASE_URL",matches=".+")
@Import(ContentTestConfig::class)
@SpringBootTest(properties=["app.content.enabled=true","CONTENT_DATABASE_URL=\${TEST_CONTENT_DATABASE_URL}","CONTENT_DATABASE_USER=content_test","CONTENT_DATABASE_PASSWORD="])
class WorkUpdatePostgresTest {
    @Autowired lateinit var works: WorkService
    @MockitoBean lateinit var ai: GenerationClient
    private val jdbc get() = JdbcTemplate(DriverManagerDataSource(System.getenv("TEST_CONTENT_DATABASE_URL"),"content_test",""))
    private fun create(title: String = "수정삭제 검증") = works.create("author",CreateWorkRequest(title,"소개"))
    private fun failure(block: () -> Unit) = assertThrows(ContentFailure::class.java) { block() }

    @Test fun `owner updates title and summary and revision moves forward`() {
        val w=create()
        val revision=w.draft!!.revision
        val updated=works.update(w.id,"author",UpdateWorkRequest("  새 제목  ","새 소개",revision))
        assertEquals("새 제목",updated.title)
        assertEquals("새 소개",updated.summary)
        assertEquals(revision+1,updated.draft!!.revision)
        assertEquals("새 제목",works.read(w.id,"author").title)
    }
    @Test fun `stale revision is rejected with 409 and nothing changes`() {
        val w=create()
        assertEquals(409,failure { works.update(w.id,"author",UpdateWorkRequest("낡은 수정","소개",w.draft!!.revision+5)) }.status)
        assertEquals("수정삭제 검증",works.read(w.id,"author").title)
    }
    @Test fun `blank or too long input is rejected with 422`() {
        val w=create()
        assertEquals(422,failure { works.update(w.id,"author",UpdateWorkRequest("   ","소개",w.draft!!.revision)) }.status)
        assertEquals(422,failure { works.update(w.id,"author",UpdateWorkRequest("가".repeat(121),"소개",w.draft!!.revision)) }.status)
    }
    @Test fun `another user cannot update and sees 404`() {
        val w=create()
        assertEquals(404,failure { works.update(w.id,"intruder",UpdateWorkRequest("탈취","소개",w.draft!!.revision)) }.status)
        assertEquals("수정삭제 검증",works.read(w.id,"author").title)
    }
}
