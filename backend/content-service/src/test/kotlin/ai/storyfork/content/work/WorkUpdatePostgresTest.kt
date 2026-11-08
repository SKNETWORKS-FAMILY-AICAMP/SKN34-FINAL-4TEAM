package ai.storyfork.content.work

import ai.storyfork.content._common.exception.ContentFailure
import ai.storyfork.content.fixture.ContentTestConfig
import ai.storyfork.content.proposal.client.GenerationClient
import ai.storyfork.content.work.service.WorkService
import ai.storyfork.content.work.service.dto.CreateWorkRequest
import ai.storyfork.content.work.service.dto.UpdateWorkRequest
import org.junit.jupiter.api.Assertions.*
import org.junit.jupiter.api.Test
import org.junit.jupiter.api.condition.EnabledIfEnvironmentVariable
import org.springframework.beans.factory.annotation.Autowired
import org.springframework.boot.test.context.SpringBootTest
import org.springframework.context.annotation.Import
import org.springframework.test.context.bean.override.mockito.MockitoBean
import java.util.concurrent.*

/** 작품 수정을 실제 PostgreSQL에서 검증한다. TEST_CONTENT_DATABASE_URL이 있을 때만 실행한다. */
@EnabledIfEnvironmentVariable(named="TEST_CONTENT_DATABASE_URL",matches=".+")
@Import(ContentTestConfig::class)
@SpringBootTest(properties=["app.content.enabled=true","DATABASE_URL=\${TEST_CONTENT_DATABASE_URL}","DATABASE_USER=content_test","DATABASE_PASSWORD="])
class WorkUpdatePostgresTest {
    @Autowired lateinit var works: WorkService
    @MockitoBean lateinit var ai: GenerationClient
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
    @Test fun `summary longer than 2000 is rejected with 422 and nothing changes`() {
        val w=create()
        assertEquals(422,failure { works.update(w.id,"author",UpdateWorkRequest("변경되면 안 되는 제목","가".repeat(2001),w.draft!!.revision)) }.status)
        assertEquals(w,works.read(w.id,"author"))
    }
    @Test fun `reusing a revision after a successful update is rejected and preserves the winner`() {
        val w=create()
        val revision=w.draft!!.revision
        val updated=works.update(w.id,"author",UpdateWorkRequest("먼저 저장한 제목","먼저 저장한 소개",revision))
        assertEquals(409,failure { works.update(w.id,"author",UpdateWorkRequest("덮어쓸 제목","덮어쓸 소개",revision)) }.status)
        assertEquals(updated,works.read(w.id,"author"))
        assertEquals(revision+1,updated.draft!!.revision)
    }
    @Test fun `concurrent updates with the same revision have one winner without lost changes`() {
        val w=create()
        val revision=w.draft!!.revision
        val start=CountDownLatch(1)
        val pool=Executors.newFixedThreadPool(2)
        try {
            val tasks=(0..1).map { i -> pool.submit<Int> {
                assertTrue(start.await(5,TimeUnit.SECONDS))
                try { works.update(w.id,"author",UpdateWorkRequest("제목 $i","소개 $i",revision));200 }
                catch(error: ContentFailure) { error.status }
            } }
            start.countDown()
            val result=tasks.map { it.get(20,TimeUnit.SECONDS) }
            assertEquals(listOf(200,409),result.sorted())
            val winner=result.indexOf(200)
            val after=works.read(w.id,"author")
            assertEquals("제목 $winner",after.title)
            assertEquals("소개 $winner",after.summary)
            assertEquals(revision+1,after.draft!!.revision)
        } finally { pool.shutdownNow();assertTrue(pool.awaitTermination(5,TimeUnit.SECONDS)) }
    }
    @Test fun `another user cannot update and sees 404`() {
        val w=create()
        assertEquals(404,failure { works.update(w.id,"intruder",UpdateWorkRequest("탈취","소개",w.draft!!.revision)) }.status)
        assertEquals("수정삭제 검증",works.read(w.id,"author").title)
    }
}
