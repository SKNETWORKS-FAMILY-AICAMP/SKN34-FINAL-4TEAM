package ai.storyfork.content.work

import ai.storyfork.content.auth.service.CoreNicknameService
import ai.storyfork.content._common.exception.ContentFailure
import ai.storyfork.content.fixture.ContentTestConfig
import ai.storyfork.content.proposal.client.GenerationClient
import ai.storyfork.content.work.service.WorkService
import ai.storyfork.content.work.service.dto.CreateWorkRequest
import ai.storyfork.content.work.service.dto.UpdateWorkRequest
import ai.storyfork.content.work.service.dto.WorkResponse
import org.junit.jupiter.api.Assertions.*
import org.junit.jupiter.api.Test
import org.junit.jupiter.api.condition.EnabledIfEnvironmentVariable
import org.springframework.beans.factory.annotation.Autowired
import org.springframework.boot.test.context.SpringBootTest
import org.springframework.context.annotation.Import
import org.springframework.jdbc.core.JdbcTemplate
import org.springframework.jdbc.datasource.DriverManagerDataSource
import org.springframework.test.context.bean.override.mockito.MockitoBean
import java.util.concurrent.*

/** 작품 수정을 실제 PostgreSQL에서 검증한다. TEST_CONTENT_DATABASE_URL이 있을 때만 실행한다. */
@EnabledIfEnvironmentVariable(named="TEST_CONTENT_DATABASE_URL",matches=".+")
@Import(ContentTestConfig::class)
@SpringBootTest(properties=["DATABASE_URL=\${TEST_CONTENT_DATABASE_URL}","DATABASE_USER=content_test","DATABASE_PASSWORD="])
class WorkUpdatePostgresTest {
    // 작가명·작성자명은 Core 닉네임이다. 이 테스트는 이름을 보지 않으므로 Core 조회는 빈 결과를 돌려주는 대역이다.
    @MockitoBean lateinit var nicknames: CoreNicknameService
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

    // ───── 장르·해시태그(선택 필드): 생략하면 유지, 보내면 등록과 같은 규칙으로 검증해 통째로 교체 ─────
    private val jdbc get()=JdbcTemplate(DriverManagerDataSource(System.getenv("TEST_CONTENT_DATABASE_URL"),"content_test",""))
    private fun count(sql: String,vararg args: Any)=jdbc.queryForObject(sql,Int::class.java,*args)!!
    private fun genreRows(work: String)=count("SELECT count(*) FROM work_genre WHERE work_id=?",work)
    private fun hashtagRows(work: String)=count("SELECT count(*) FROM work_hashtag WHERE work_id=?",work)
    private fun register(genres: List<String> = listOf("판타지","SF"),tags: List<String> = listOf("회귀","먼치킨"))=
        works.create("author",CreateWorkRequest("장르 수정 검증","소개","ORIGINAL",genres,tags,true))
    /** 지금 revision으로 제목·소개는 그대로 두고 장르·해시태그만 보낸다(null은 생략). */
    private fun change(w: WorkResponse,genres: List<String>? = null,tags: List<String>? = null)=
        works.update(w.id,"author",UpdateWorkRequest("장르 수정 검증","소개",works.read(w.id,"author").draft!!.revision,genres,tags))

    @Test fun `omitting genres and hashtags keeps the stored ones`() {
        val w=register()
        val updated=works.update(w.id,"author",UpdateWorkRequest("제목만 바꿈","소개",w.draft!!.revision))
        assertEquals("제목만 바꿈",updated.title)
        assertEquals(listOf("판타지","SF"),updated.genres)
        assertEquals(listOf("회귀","먼치킨"),updated.hashtags)
        assertEquals(2,genreRows(w.id))
        assertEquals(2,hashtagRows(w.id))
    }
    @Test fun `genres and hashtags are replaced and read back in the approved order and the given order`() {
        val w=register()
        val updated=change(w,genres=listOf("SF","무협"),tags=listOf("먼치킨","  새 태그 ","회귀"))
        assertEquals(listOf("무협","SF"),updated.genres)
        assertEquals(listOf("먼치킨","새 태그","회귀"),updated.hashtags)
        val read=works.read(w.id,"author")
        assertEquals(listOf("무협","SF"),read.genres)
        assertEquals(listOf("먼치킨","새 태그","회귀"),read.hashtags)
        assertEquals(2,genreRows(w.id))
        assertEquals(listOf("먼치킨","새 태그","회귀"),jdbc.queryForList("SELECT tag FROM work_hashtag WHERE work_id=? ORDER BY position",String::class.java,w.id))
    }
    @Test fun `the same genres and positions can be sent again after the old rows were deleted first`() {
        val w=register()
        // 같은 (작품, 장르)·(작품, 위치)·행 id를 다시 넣는다. 삭제가 insert보다 먼저 DB에 나가지 않으면 키 충돌로 실패한다.
        val again=change(w,genres=listOf("판타지","SF"),tags=listOf("회귀","먼치킨"))
        assertEquals(listOf("판타지","SF"),again.genres)
        assertEquals(listOf("회귀","먼치킨"),again.hashtags)
        assertEquals(1,change(w,tags=listOf("회귀")).hashtags.size)
        assertEquals(1,hashtagRows(w.id))
        assertEquals(10,change(w,tags=(1..10).map {"태그$it"}).hashtags.size)
        assertEquals(10,hashtagRows(w.id))
        assertEquals(2,genreRows(w.id))
    }
    @Test fun `an empty hashtag list clears them and genres keep at least one`() {
        val w=register()
        val cleared=change(w,tags=emptyList())
        assertTrue(cleared.hashtags.isEmpty())
        assertEquals(listOf("판타지","SF"),cleared.genres)
        assertEquals(0,hashtagRows(w.id))
        assertEquals(422,failure { change(w,genres=emptyList()) }.status)
        assertEquals(listOf("판타지","SF"),works.read(w.id,"author").genres)
    }
    @Test fun `invalid genres or hashtags change nothing not even the title`() {
        val w=register()
        val before=works.read(w.id,"author")
        val revision=before.draft!!.revision
        val cases=listOf(
            UpdateWorkRequest("바뀌면 안 되는 제목","소개",revision,genres=listOf("판타지","SF","무협")),
            UpdateWorkRequest("바뀌면 안 되는 제목","소개",revision,genres=listOf("없는장르")),
            UpdateWorkRequest("바뀌면 안 되는 제목","소개",revision,genres=listOf("판타지","판타지")),
            UpdateWorkRequest("바뀌면 안 되는 제목","소개",revision,genres=listOf("무협"),hashtags=listOf("회귀","  ")),
            UpdateWorkRequest("바뀌면 안 되는 제목","소개",revision,hashtags=(1..11).map {"태그$it"}),
        )
        cases.forEach { assertEquals(422,failure { works.update(w.id,"author",it) }.status) }
        assertEquals(before,works.read(w.id,"author"))
        assertEquals(2,genreRows(w.id))
        assertEquals(2,hashtagRows(w.id))
    }
    @Test fun `a stale revision or another user cannot change genres and hashtags`() {
        val w=register()
        val before=works.read(w.id,"author")
        val revision=before.draft!!.revision
        assertEquals(409,failure { works.update(w.id,"author",UpdateWorkRequest("낡은 수정","소개",revision+5,listOf("무협"),emptyList())) }.status)
        assertEquals(404,failure { works.update(w.id,"intruder",UpdateWorkRequest("탈취","소개",revision,listOf("무협"),emptyList())) }.status)
        assertEquals(before,works.read(w.id,"author"))
    }
}
