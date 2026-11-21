package ai.storyfork.content.work

import ai.storyfork.content.auth.service.CoreNicknameService
import ai.storyfork.content.editsuggestion.service.EditSuggestionService
import ai.storyfork.content.editsuggestion.service.dto.CreateSuggestionRequest
import ai.storyfork.content.fixture.ContentTestConfig
import ai.storyfork.content.fixture.ContentTestDriver
import ai.storyfork.content.fixture.DraftRequest
import ai.storyfork.content.fixture.ForkRequest
import ai.storyfork.content.fixture.PublishRequest
import ai.storyfork.content.work.service.WorkService
import ai.storyfork.content.work.service.dto.CreateWorkRequest
import java.net.URI
import java.net.http.HttpClient
import java.net.http.HttpRequest
import java.net.http.HttpResponse
import java.sql.Date
import java.sql.Timestamp
import java.time.Instant
import java.util.UUID
import javax.sql.DataSource
import org.junit.jupiter.api.Assertions.*
import org.junit.jupiter.api.Test
import org.junit.jupiter.api.condition.EnabledIfEnvironmentVariable
import org.springframework.beans.factory.annotation.Autowired
import org.springframework.beans.factory.annotation.Qualifier
import org.springframework.boot.test.context.SpringBootTest
import org.springframework.boot.test.web.server.LocalServerPort
import org.springframework.context.annotation.Import
import org.springframework.jdbc.core.JdbcTemplate
import org.springframework.test.context.bean.override.mockito.MockitoBean
import tools.jackson.databind.JsonNode
import tools.jackson.databind.json.JsonMapper

/**
 * 운영 퍼널 지표 내부 API(DEC-57)를 실제 PostgreSQL과 서비스 토큰 체인으로 검증한다. TEST_CONTENT_DATABASE_URL이 있을 때만 실행한다.
 * 전체 기간을 세므로 DB를 공유하는 다른 테스트의 데이터가 섞인다. 그래서 모든 칸을 이 테스트가 만들기 전후의 증가분으로 비교하고
 * 중앙값은 전체 값이라 숫자로 나오는지만 본다(계산은 OperationsFunnelServiceTest, 쿼리 의미는 여기의 증가분이 확인한다).
 */
@SpringBootTest(webEnvironment=SpringBootTest.WebEnvironment.RANDOM_PORT,properties=[
    "DATABASE_URL=\${TEST_CONTENT_DATABASE_URL}","DATABASE_USER=content_test","DATABASE_PASSWORD=",
    "CONTENT_CORE_AUTH_TOKEN=content-test-service-credential-at-least-32",
    "OPERATIONS_SERVICE_TOKEN=operations-test-service-token-at-least-32",
])
@Import(ContentTestConfig::class)
@EnabledIfEnvironmentVariable(named="TEST_CONTENT_DATABASE_URL",matches=".+")
class InternalOperationsFunnelIntegrationTest {
    @LocalServerPort var port=0
    @MockitoBean lateinit var nicknames: CoreNicknameService
    @Autowired lateinit var works: WorkService
    @Autowired lateinit var driver: ContentTestDriver
    @Autowired lateinit var suggestions: EditSuggestionService
    @Autowired @Qualifier("contentDataSource") lateinit var source: DataSource
    @Autowired lateinit var json: JsonMapper
    private val jdbc get()=JdbcTemplate(source)
    private val client=HttpClient.newHttpClient()
    private val token="operations-test-service-token-at-least-32"
    private val wrongToken="wrong-service-token-wrong-service-token"
    private val tag=UUID.randomUUID().toString().take(8)
    private val author="ops-funnel-author-$tag"
    private val funnel="/internal/v1/operations/funnel"
    private val labels=listOf("1","2","3","4-5","6-10","11+")

    private fun call(serviceToken:String?=token):HttpResponse<String> {
        val request=HttpRequest.newBuilder(URI.create("http://127.0.0.1:$port$funnel")).header("Accept","application/json")
        if(serviceToken!=null) request.header("X-Operations-Service-Token",serviceToken)
        return client.send(request.GET().build(),HttpResponse.BodyHandlers.ofString())
    }
    private fun read():JsonNode {
        val response=call()
        assertEquals(200,response.statusCode(),response.body())
        return json.readTree(response.body())
    }
    private fun number(body:JsonNode,path:String):Long=path.split('.').fold(body) {node,key->node.path(key)}.asLong()
    private fun bucket(body:JsonNode,label:String):Long=body.path("forks").path("baseEpisodes").toList().first {it.path("bucket").asText()==label}.path("count").asLong()
    private fun member(name:String)="ops-funnel-$tag-$name"

    /** 공개 작품 하나다. 회차를 [episodes]개 발행하고(Fork를 허용) 마지막 발행 뒤에는 비어 있는 다음 초안이 남는다. */
    private fun work(name:String,episodes:Int=1):String {
        val id=works.create(author,CreateWorkRequest("운영 퍼널 $tag $name","소개","ORIGINAL",listOf("판타지"),emptyList(),true)).id
        repeat(episodes) {
            val draft=driver.edit(id,author,DraftRequest("${it+1}화","본문",driver.read(id,author).draft!!.revision))
            driver.publish(id,author,PublishRequest(draft.revision,true,true,true,driver.history(id,author).versions.last().id))
        }
        return id
    }
    private fun fork(original:String,owner:String,episode:Int=1)=driver.fork(original,member(owner),ForkRequest(episode,"운영 퍼널 분기 $tag $owner")).id
    /** Fork 작가가 자기 다음 회차를 저장 버전으로 남긴다. */
    private fun save(fork:String,owner:String)=driver.edit(fork,member(owner),DraftRequest("분기 회차","본문",driver.read(fork,member(owner)).draft!!.revision))
    private fun publish(fork:String,owner:String) {
        val draft=save(fork,owner)
        driver.publish(fork,member(owner),PublishRequest(draft.revision,true,true,true,driver.history(fork,member(owner)).versions.last().id))
    }
    private fun delete(workId:String)=jdbc.update("UPDATE work SET deleted_at=now() WHERE id=?",workId)
    private fun viewed(work:String,who:String,episode:Int,day:String)=jdbc.update("INSERT INTO work_view(work_id,episode_number,member_id,view_date) VALUES (?,?,?,?)",work,episode,member(who),Date.valueOf(day))
    private fun readEpisode(work:String,who:String,episode:Int)=jdbc.update("INSERT INTO reading_episode(member_id,work_id,episode_number) VALUES (?,?,?)",member(who),work,episode)
    private fun like(work:String,who:String)=jdbc.update("INSERT INTO work_like(work_id,member_id) VALUES (?,?)",work,member(who))
    private fun interest(work:String,who:String)=jdbc.update("INSERT INTO work_interest(work_id,member_id) VALUES (?,?)",work,member(who))
    /** 1화 댓글 한 건이다. 삭제·운영 숨김은 값을 직접 정한다(서비스 흐름 대신 상태를 고정한다). */
    private fun comment(work:String,deleted:Boolean=false,hidden:Boolean=false) {
        val version=jdbc.queryForObject("SELECT published_version_id FROM episode_current WHERE work_id=? AND sequence=1",String::class.java,work)
        jdbc.update("INSERT INTO episode_comment(id,work_id,episode_number,published_version_id,author_id,body,created_at,updated_at,deleted_at,hidden) VALUES (?,?,1,?,?,?,now(),now(),CASE WHEN ? THEN now() END,?)",
            UUID.randomUUID().toString(),work,version,member("commenter"),"댓글",deleted,hidden)
    }
    /** 한 시간 전에 생성된 AI 제안 한 건이고 [adopted]면 채택(accept) 결정도 남긴다(운영 통계 통합 테스트와 같은 직접 삽입이다). */
    private fun proposal(workId:String,adopted:Boolean) {
        val job=UUID.randomUUID().toString()
        val proposal=UUID.randomUUID().toString()
        val created=Timestamp.from(Instant.now().minusSeconds(3600))
        jdbc.update("INSERT INTO ai_job(id,requester_id,work_id,kind,status) VALUES (?,?,?,?,?)",job,author,workId,"continuation","completed")
        jdbc.update("INSERT INTO ai_proposal(id,job_id,kind,content,created_at) VALUES (?,?,?,?,?)",proposal,job,"continuation","제안 본문",created)
        if(adopted) jdbc.update("INSERT INTO proposal_decision(id,proposal_id,sequence,decision,approved_content,decided_at) VALUES (?,?,?,?,?,?)",
            UUID.randomUUID().toString(),proposal,1,"accept","제안 본문",created)
    }
    /** 수정 제안을 올리고 한 시간 전에 [status]로 판단한 것으로 고정한다. */
    private fun decided(workId:String,status:String) {
        val id=suggestions.create(workId,1,member("proposer"),CreateSuggestionRequest("본문","고친 본문 ${UUID.randomUUID()}")).id
        jdbc.update("UPDATE edit_suggestion SET status=?,decided_at=now() - interval '1 hour' WHERE id=?",status,id)
    }

    @Test fun `the funnel needs the service token and returns the contract shape`() {
        for(wrong in listOf(null,wrongToken)) assertEquals(403,call(wrong).statusCode())

        val body=read()
        assertEquals(setOf("readers","reactions","forks","writers","proposals","feedback"),body.propertyNames().toSet())
        assertEquals(setOf("viewed","readAny","readNext"),body.path("readers").propertyNames().toSet())
        assertEquals(setOf("publishedEpisodes","likes","interests","comments"),body.path("reactions").propertyNames().toSet())
        assertEquals(setOf("readers","readerForked","baseEpisodes"),body.path("forks").propertyNames().toSet())
        assertEquals(labels,body.path("forks").path("baseEpisodes").toList().map {it.path("bucket").asText()})
        assertEquals(setOf("forks","saved","published","medianHoursToPublish"),body.path("writers").propertyNames().toSet())
        assertEquals(setOf("adopted","total"),body.path("proposals").propertyNames().toSet())
        assertEquals(setOf("approved","decided"),body.path("feedback").propertyNames().toSet())
    }

    @Test fun `every cell counts its own population and leaves out deleted works and forks and hidden comments`() {
        val before=read()
        val orig=work("orig")
        val deep=work("deep",episodes=3)
        val gone=work("gone")

        // Fork: f1은 저장만, f2는 저장과 발행, f3은 손대지 않음, f5는 3화 기준, 삭제된 f4(세지 않는다).
        val f1=fork(orig,"forker1"); save(f1,"forker1")
        val f2=fork(orig,"forker2"); publish(f2,"forker2")
        fork(orig,"forker3")
        val f4=fork(orig,"forker4")
        fork(deep,"forker5",episode=3)
        // 조회: 같은 회원이 여러 회차·날짜를 봐도 한 명이다.
        viewed(orig,"viewer-a",1,"2026-11-01"); viewed(orig,"viewer-a",1,"2026-11-02"); viewed(orig,"viewer-b",1,"2026-11-01")
        // 독서: reader-a는 같은 작품의 두 회차(이어 읽기), reader-b·reader-d는 한 회차, reader-c는 두 작품에서 한 회차씩,
        // reader-d가 읽은 작품은 삭제돼도 독자는 센다. forker1·2·4는 읽었고(4의 Fork는 삭제됨) forker3은 안 읽었다.
        readEpisode(orig,"reader-a",1); readEpisode(orig,"reader-a",2); readEpisode(orig,"reader-b",1)
        readEpisode(orig,"reader-c",1); readEpisode(f1,"reader-c",1); readEpisode(gone,"reader-d",1)
        readEpisode(orig,"forker1",1); readEpisode(orig,"forker2",1); readEpisode(orig,"forker4",1)
        // 반응: 삭제된 작품의 좋아요·관심·댓글과 삭제·숨김 댓글은 뺀다.
        like(orig,"liker-a"); like(orig,"liker-b"); like(gone,"liker-a")
        interest(orig,"liker-a"); interest(gone,"liker-a"); interest(gone,"liker-b")
        comment(orig); comment(orig); comment(orig,deleted=true); comment(orig,hidden=true); comment(gone)
        // 통계(DEC-55)와 같은 정의의 전체 기간 값: AI 제안 둘(채택 하나), 수정 제안 승인·거절 하나씩.
        proposal(orig,adopted=true); proposal(orig,adopted=false)
        decided(orig,"approved"); decided(orig,"rejected")
        delete(f4); delete(gone)

        val after=read()
        // 발행된 회차: orig 1 + deep 3 + 물려받은 회차(f1·f2·f3 각 1, f5 3) + f2가 직접 발행한 1 = 11. 삭제된 gone·f4의 것은 뺀다.
        val expected=mapOf("readers.viewed" to 2L,"readers.readAny" to 7L,"readers.readNext" to 1L,
            "reactions.publishedEpisodes" to 11L,"reactions.likes" to 2L,"reactions.interests" to 1L,"reactions.comments" to 2L,
            "forks.readers" to 7L,"forks.readerForked" to 2L,
            "writers.forks" to 4L,"writers.saved" to 2L,"writers.published" to 1L,
            "proposals.adopted" to 1L,"proposals.total" to 2L,"feedback.approved" to 1L,"feedback.decided" to 2L)
        assertEquals(expected,expected.keys.associateWith {number(after,it)-number(before,it)})
        assertEquals(mapOf("1" to 3L,"2" to 0L,"3" to 1L,"4-5" to 0L,"6-10" to 0L,"11+" to 0L),labels.associateWith {bucket(after,it)-bucket(before,it)})
        // 발행한 Fork(f2)가 있으니 중앙값은 숫자다(전체 값이라 크기는 비교하지 않는다).
        assertTrue(after.path("writers").path("medianHoursToPublish").isNumber)
    }
}
