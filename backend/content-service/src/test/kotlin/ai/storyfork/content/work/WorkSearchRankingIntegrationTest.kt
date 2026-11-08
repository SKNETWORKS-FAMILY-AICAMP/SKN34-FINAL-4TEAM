package ai.storyfork.content.work

import ai.storyfork.content.auth.client.CoreAuthClient
import ai.storyfork.content.auth.client.VerifiedMemberResponse
import ai.storyfork.content.fixture.ContentTestConfig
import ai.storyfork.content.fixture.ContentTestDriver
import ai.storyfork.content.fixture.CsrfFixture
import ai.storyfork.content.fixture.DraftRequest
import ai.storyfork.content.fixture.PublishRequest
import ai.storyfork.content.work.service.WorkService
import ai.storyfork.content.work.service.dto.CreateWorkRequest
import java.net.URI
import java.net.URLEncoder
import java.net.http.HttpClient
import java.net.http.HttpRequest
import java.net.http.HttpResponse
import java.util.UUID
import javax.sql.DataSource
import org.junit.jupiter.api.Assertions.*
import org.junit.jupiter.api.Test
import org.junit.jupiter.api.condition.EnabledIfEnvironmentVariable
import org.mockito.Mockito.`when`
import org.springframework.beans.factory.annotation.Autowired
import org.springframework.beans.factory.annotation.Qualifier
import org.springframework.boot.test.context.SpringBootTest
import org.springframework.boot.test.web.server.LocalServerPort
import org.springframework.context.annotation.Import
import org.springframework.jdbc.core.JdbcTemplate
import org.springframework.test.context.bean.override.mockito.MockitoBean
import tools.jackson.databind.json.JsonMapper

/**
 * 공개 작품 검색·랭킹·조회 기록 HTTP 계약을 실제 PostgreSQL로 검증한다. TEST_CONTENT_DATABASE_URL이 있을 때만 실행한다.
 * DB는 다른 테스트의 작품과 공유하므로 각 테스트는 자신이 만든 작품 id만 골라 비교한다.
 */
@SpringBootTest(webEnvironment=SpringBootTest.WebEnvironment.RANDOM_PORT,properties=[
    "app.content.enabled=true","CONTENT_DATABASE_URL=\${TEST_CONTENT_DATABASE_URL}",
    "CONTENT_DATABASE_USER=content_test","CONTENT_DATABASE_PASSWORD=",
    "CONTENT_CORE_AUTH_TOKEN=content-test-service-credential-at-least-32",
])
@Import(ContentTestConfig::class)
@EnabledIfEnvironmentVariable(named="TEST_CONTENT_DATABASE_URL",matches=".+")
class WorkSearchRankingIntegrationTest {
    @LocalServerPort var port=0
    @MockitoBean lateinit var core: CoreAuthClient
    @Autowired lateinit var works: WorkService
    @Autowired lateinit var driver: ContentTestDriver
    @Autowired @Qualifier("contentDataSource") lateinit var source: DataSource
    @Autowired lateinit var json: JsonMapper
    private val jdbc get()=JdbcTemplate(source)
    private val client=HttpClient.newHttpClient()

    private fun actor(): UUID=UUID.randomUUID().also { id -> `when`(core.verify("Bearer $id")).thenReturn(VerifiedMemberResponse(id)) }
    private fun send(request: HttpRequest.Builder): HttpResponse<String> = client.send(request.build(),HttpResponse.BodyHandlers.ofString())
    private fun get(path: String)=send(HttpRequest.newBuilder(URI.create("http://127.0.0.1:$port$path")).header("Accept","application/json"))
    private fun recordView(work: String,number: Int,member: UUID?,csrf: Boolean=true): HttpResponse<String> {
        val request=HttpRequest.newBuilder(URI.create("http://127.0.0.1:$port/api/v1/works/$work/episodes/$number/views")).POST(HttpRequest.BodyPublishers.noBody())
        if(csrf) request.header("Cookie",CsrfFixture.cookie).header("X-CSRF-TOKEN",CsrfFixture.token())
        if(member!=null) request.header("Authorization","Bearer $member")
        return send(request)
    }
    private fun encoded(text: String)=URLEncoder.encode(text,Charsets.UTF_8)
    private fun items(path: String): List<tools.jackson.databind.JsonNode> {
        val response=get(path)
        assertEquals(200,response.statusCode(),response.body())
        return json.readTree(response.body()).toList()
    }
    private fun ids(path: String)=items(path).map {it.path("id").asText()}
    private fun count(work: String)=jdbc.queryForObject("SELECT count(*) FROM work_view WHERE work_id=?",Int::class.java,work)!!
    private fun work(title: String,genres: List<String> = listOf("판타지"),tags: List<String> = emptyList(),publish: Boolean = true): String {
        val id=works.create("author",CreateWorkRequest(title,"소개","ORIGINAL",genres,tags,true)).id
        if(publish) {
            val draft=driver.edit(id,"author",DraftRequest("1화","본문",0))
            driver.publish(id,"author",PublishRequest(draft.revision,true,true,true,driver.history(id,"author").versions.last().id))
        }
        return id
    }
    private fun seedViews(work: String,vararg hoursAgo: Int) = hoursAgo.forEachIndexed { index,hours ->
        jdbc.update("INSERT INTO work_view(work_id,episode_number,member_id,view_date,viewed_at) VALUES (?,1,?,current_date,now() - ? * interval '1 hour')",work,"seed-$index",hours)
    }

    @Test fun `search filters public works by title tag and genre and orders by recent views`() {
        val moon=work("달빛 정원",listOf("판타지"),listOf("회귀"))
        val star=work("별빛 서점",listOf("로맨스"),listOf("#달빛"))
        val hidden=work("달빛 비공개",publish=false)
        val mine=setOf(moon,star,hidden)
        fun found(query: String?)=ids("/api/v1/public/works"+(query?.let {"?$it"} ?: "")).filter {it in mine}

        assertEquals(listOf(star,moon),found(null))
        assertEquals(listOf(star,moon),found("q=${encoded("달빛")}"))
        assertEquals(listOf(star,moon),found("f=all&q=${encoded("달빛")}"))
        assertEquals(listOf(moon),found("f=title&q=${encoded("달빛")}"))
        assertEquals(listOf(star),found("f=tag&q=${encoded("#달빛")}"))
        assertEquals(listOf(star),found("f=genre&q=${encoded("로맨스")}"))
        assertEquals(emptyList<String>(),found("q=${encoded("없는검색어")}"))

        val readers=List(2) {actor()}
        readers.forEach {assertEquals(204,recordView(moon,1,it).statusCode())}
        assertEquals(204,recordView(star,1,readers[0]).statusCode())
        assertEquals(listOf(moon,star),found("sort=view"))
        assertEquals(listOf(star,moon),found("sort=latest"))
        val views=items("/api/v1/public/works?sort=view").associate {it.path("id").asText() to it.path("views").asLong()}
        assertEquals(2L,views[moon])
        assertEquals(1L,views[star])

        assertEquals(422,get("/api/v1/public/works?f=body").statusCode())
        assertEquals(422,get("/api/v1/public/works?sort=popular").statusCode())
    }

    @Test fun `ranking counts the last 24 hours against the 24 hours before`() {
        val surge=work("급상승 작품")
        val steady=work("꾸준한 작품")
        val fading=work("식어가는 작품")
        val idle=work("지난 작품")
        seedViews(surge,1,2,3)
        seedViews(steady,1,2,3,4,5,25,26,27,28,29)
        seedViews(fading,1,25,26,27,28,29,30)
        seedViews(idle,25,26,27,28,50)
        val mine=setOf(surge,steady,fading,idle)
        fun ranked(kind: String)=ids("/api/v1/public/works/ranking?kind=$kind").filter {it in mine}

        assertEquals(listOf(steady,surge,fading),ranked("top"))
        assertEquals(listOf(surge),ranked("rising"))
        assertTrue(ids("/api/v1/public/works/ranking?kind=top").size<=10)
        assertEquals(5L,items("/api/v1/public/works/ranking?kind=top").first {it.path("id").asText()==steady}.path("views").asLong())
        assertEquals(422,get("/api/v1/public/works/ranking?kind=daily").statusCode())
        assertEquals(400,get("/api/v1/public/works/ranking").statusCode())
    }

    @Test fun `view recording is once per member episode and day and only for public published episodes`() {
        val open=work("조회 기록 공개")
        val draftOnly=work("조회 기록 비공개",publish=false)
        val reader=actor()
        val other=actor()

        assertEquals(204,recordView(open,1,reader).statusCode())
        assertEquals(204,recordView(open,1,reader).statusCode())
        assertEquals(1,count(open))
        assertEquals(204,recordView(open,1,other).statusCode())
        assertEquals(2,count(open))

        val third=actor()
        jdbc.update("INSERT INTO work_view(work_id,episode_number,member_id,view_date,viewed_at) VALUES (?,1,?,date '2000-01-01',now() - interval '1 day')",open,third.toString())
        assertEquals(204,recordView(open,1,third).statusCode())
        assertEquals(4,count(open))

        assertEquals(404,recordView(open,2,reader).statusCode())
        assertEquals(404,recordView(open,0,reader).statusCode())
        assertEquals(404,recordView(draftOnly,1,reader).statusCode())
        assertEquals(404,recordView(UUID.randomUUID().toString(),1,reader).statusCode())
        assertEquals(401,recordView(open,1,null).statusCode())
        assertEquals(403,recordView(open,1,reader,csrf=false).statusCode())
        assertEquals(0,count(draftOnly))
        assertEquals(4,count(open))
    }
}
