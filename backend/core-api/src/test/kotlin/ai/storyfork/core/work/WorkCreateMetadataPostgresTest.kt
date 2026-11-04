package ai.storyfork.core.work

import ai.storyfork.core._common.exception.ContentFailure
import ai.storyfork.core.content.fixture.ContentTestConfig
import ai.storyfork.core.content.fixture.ContentTestDriver
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

/** 작품 등록 메타데이터(유형·장르·해시태그·권리 확인)를 실제 PostgreSQL에서 검증한다. TEST_CONTENT_DATABASE_URL이 있을 때만 실행한다. */
@EnabledIfEnvironmentVariable(named="TEST_CONTENT_DATABASE_URL",matches=".+")
@Import(ContentTestConfig::class)
@SpringBootTest(properties=["app.content.enabled=true","CONTENT_DATABASE_URL=\${TEST_CONTENT_DATABASE_URL}","CONTENT_DATABASE_USER=content_test","CONTENT_DATABASE_PASSWORD="])
class WorkCreateMetadataPostgresTest {
    @Autowired lateinit var works: WorkService
    @Autowired lateinit var driver: ContentTestDriver
    @MockitoBean lateinit var ai: GenerationClient
    private val jdbc get() = JdbcTemplate(DriverManagerDataSource(System.getenv("TEST_CONTENT_DATABASE_URL"),"content_test",""))
    private fun count(sql: String, vararg args: Any) = jdbc.queryForObject(sql,Int::class.java,*args)!!
    private fun failure(block: () -> Unit) = assertThrows(ContentFailure::class.java) { block() }
    private fun register(
        owner: String = "author", type: String? = "ORIGINAL", genres: List<String> = listOf("판타지","SF"),
        tags: List<String> = listOf("회귀","먼치킨"), rights: Boolean? = true, title: String = "메타데이터 검증",
    ) = works.create(owner,CreateWorkRequest(title,"소개",type,genres,tags,rights))

    @Test fun `approved genre list is seeded with 30 rows`() = assertEquals(30,count("SELECT count(*) FROM genre"))

    @Test fun `registration saves type genres hashtags and rights confirmation and reads them back`() {
        val w=register(type="EXTERNAL_DERIVATIVE")
        val read=works.read(w.id,"author")
        assertEquals("EXTERNAL_DERIVATIVE",read.creationType)
        assertEquals(listOf("판타지","SF"),read.genres)
        assertEquals(listOf("회귀","먼치킨"),read.hashtags)
        assertEquals("private",read.visibility)
        assertEquals(1,count("SELECT count(*) FROM work_rights_declaration WHERE work_id=? AND member_id=?",w.id,"author"))
        assertEquals(2,count("SELECT count(*) FROM work_genre WHERE work_id=?",w.id))
        assertEquals(2,count("SELECT count(*) FROM work_hashtag WHERE work_id=?",w.id))
    }

    @Test fun `zero hashtags and ten hashtags are allowed`() {
        assertTrue(register(tags=emptyList()).hashtags.isEmpty())
        assertEquals(10,register(tags=(1..10).map {"태그$it"}).hashtags.size)
    }

    @Test fun `invalid registration creates nothing`() {
        val before=works.list("rejected-author").items.size
        val cases=listOf<() -> Unit>(
            { register(owner="rejected-author",type=null) },
            { register(owner="rejected-author",rights=null.let {false}) },
            { register(owner="rejected-author",genres=emptyList()) },
            { register(owner="rejected-author",genres=listOf("판타지","SF","무협")) },
            { register(owner="rejected-author",genres=listOf("없는장르")) },
            { register(owner="rejected-author",tags=(1..11).map {"태그$it"}) },
            { register(owner="rejected-author",tags=listOf("회귀","  ")) },
        )
        cases.forEach { assertEquals(422,failure(it).status) }
        assertEquals(before,works.list("rejected-author").items.size)
    }

    @Test fun `request without any metadata keeps the legacy title and summary creation`() {
        val w=works.create("legacy-author",CreateWorkRequest("기존 방식","소개"))
        val read=works.read(w.id,"legacy-author")
        assertEquals("ORIGINAL",read.creationType)
        assertTrue(read.genres.isEmpty() && read.hashtags.isEmpty())
    }

    @Test fun `deleting a registered work removes its genres hashtags and rights rows`() {
        val w=register()
        works.delete(w.id,"author")
        for(table in listOf("work_genre","work_hashtag","work_rights_declaration")) {
            assertEquals(0,count("SELECT count(*) FROM $table WHERE work_id=?",w.id),table)
        }
    }
}
