package ai.storyfork.content.comment

import ai.storyfork.content.auth.service.CoreNicknameService
import ai.storyfork.content.comment.service.EpisodeCommentService
import ai.storyfork.content.comment.service.dto.CreateCommentRequest
import ai.storyfork.content.fixture.ContentTestConfig
import ai.storyfork.content.fixture.ContentTestDriver
import ai.storyfork.content.fixture.DraftRequest
import ai.storyfork.content.fixture.PublishRequest
import ai.storyfork.content.work.service.WorkService
import ai.storyfork.content.work.service.dto.CreateWorkRequest
import java.net.URI
import java.net.http.HttpClient
import java.net.http.HttpRequest
import java.net.http.HttpResponse
import java.sql.Timestamp
import java.time.Instant
import java.util.UUID
import javax.sql.DataSource
import org.junit.jupiter.api.Assertions.*
import org.junit.jupiter.api.BeforeEach
import org.junit.jupiter.api.Test
import org.junit.jupiter.api.condition.EnabledIfEnvironmentVariable
import org.mockito.ArgumentMatchers
import org.mockito.Mockito.`when`
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
 * 운영 댓글 내부 API(목록·숨김·게시 복구)를 실제 PostgreSQL과 서비스 토큰 체인으로 검증한다. TEST_CONTENT_DATABASE_URL이 있을 때만 실행한다.
 * DB는 다른 테스트와 공유하므로 각 테스트는 자신이 만든 작품의 댓글만 비교하고, 작성자명의 정본인 Core 닉네임은 [names]를 돌려주는 대역이다.
 */
@SpringBootTest(webEnvironment=SpringBootTest.WebEnvironment.RANDOM_PORT,properties=[
    "DATABASE_URL=\${TEST_CONTENT_DATABASE_URL}","DATABASE_USER=content_test","DATABASE_PASSWORD=",
    "CONTENT_CORE_AUTH_TOKEN=content-test-service-credential-at-least-32",
    "OPERATIONS_SERVICE_TOKEN=operations-test-service-token-at-least-32",
])
@Import(ContentTestConfig::class)
@EnabledIfEnvironmentVariable(named="TEST_CONTENT_DATABASE_URL",matches=".+")
class InternalCommentIntegrationTest {
    @LocalServerPort var port=0
    @MockitoBean lateinit var nicknames: CoreNicknameService
    @Autowired lateinit var works: WorkService
    @Autowired lateinit var driver: ContentTestDriver
    @Autowired lateinit var comments: EpisodeCommentService
    @Autowired @Qualifier("contentDataSource") lateinit var source: DataSource
    @Autowired lateinit var json: JsonMapper
    private val jdbc get()=JdbcTemplate(source)
    private val client=HttpClient.newHttpClient()
    private val token="operations-test-service-token-at-least-32"
    private val wrongToken="wrong-service-token-wrong-service-token"
    /** 공유 DB에서 이 테스트의 작품만 골라내기 위한 제목 접두사다. */
    private val tag=UUID.randomUUID().toString().take(8)
    private val names=mapOf("ops-u1" to "닉1","ops-u2" to "닉2")
    private val t0=Instant.parse("2030-01-01T00:00:00Z")

    @BeforeEach fun coreNicknames() {
        `when`(nicknames.nicknames(ArgumentMatchers.anyCollection<String>())).thenAnswer {call ->
            (call.arguments[0] as Collection<*>).map {it as String}.filter {it in names}.associateWith {names.getValue(it)}
        }
    }

    private fun call(method:String,path:String,serviceToken:String?=token):HttpResponse<String> {
        val request=HttpRequest.newBuilder(URI.create("http://127.0.0.1:$port$path")).header("Accept","application/json")
        if(serviceToken!=null) request.header("X-Operations-Service-Token",serviceToken)
        return client.send(request.method(method,HttpRequest.BodyPublishers.noBody()).build(),HttpResponse.BodyHandlers.ofString())
    }
    private fun node(response:HttpResponse<String>):JsonNode=json.readTree(response.body())
    private fun listed(vararg workIds:String):List<JsonNode> {
        val response=call("GET","/internal/v1/comments")
        assertEquals(200,response.statusCode(),response.body())
        return node(response).path("items").toList().filter {it.path("workId").asString() in workIds}
    }
    /** 댓글을 받을 수 있는 공개 작품(1회차 발행)이다. 댓글은 공개 작품에서만 써지므로 비공개·제한·삭제는 댓글을 쓴 뒤에 바꾼다. */
    private fun work(name:String):String {
        val owner="ops-comment-owner"
        val id=works.create(owner,CreateWorkRequest("운영 댓글 $tag $name","소개","ORIGINAL",listOf("판타지"),emptyList(),true)).id
        val draft=driver.edit(id,owner,DraftRequest("1화","본문",0))
        driver.publish(id,owner,PublishRequest(draft.revision,true,true,true,driver.history(id,owner).versions.last().id))
        return id
    }
    /** 댓글을 서비스로 쓰고, 정렬 검증이 결정적이도록 작성 시각을 [at]으로 고정한다(수정 시각도 같아 edited는 꺼져 있다). */
    private fun comment(workId:String,author:String,body:String,at:Instant):String {
        val id=comments.create(workId,1,author,CreateCommentRequest(body)).id
        jdbc.update("UPDATE episode_comment SET created_at=?,updated_at=? WHERE id=?",Timestamp.from(at),Timestamp.from(at),id)
        return id
    }
    private fun hiddenColumn(id:String)=jdbc.queryForObject("SELECT hidden FROM episode_comment WHERE id=?",Boolean::class.java,id)

    @Test fun `list needs the service token and returns every undeleted comment of undeleted works with hidden ones newest first and with title likes and Core names`() {
        for(wrong in listOf(null,wrongToken)) assertEquals(403,call("GET","/internal/v1/comments",wrong).statusCode())

        val open=work("open")
        val restricted=work("restricted")
        val gone=work("gone")
        val oldest=comment(open,"ops-u1","가장 오래된 글",t0)
        val toHide=comment(open,"ops-u2","숨길 글",t0.plusSeconds(10))
        val ofRestricted=comment(restricted,"ops-u3","제한 작품의 글",t0.plusSeconds(20))
        val tie1=comment(open,"ops-u1","같은 시각 1",t0.plusSeconds(30))
        val tie2=comment(open,"ops-u1","같은 시각 2",t0.plusSeconds(30))
        val deleted=comment(open,"ops-u1","삭제된 글",t0.plusSeconds(40))
        comment(gone,"ops-u1","삭제된 작품의 글",t0.plusSeconds(50))
        repeat(2) {comments.like(open,1,oldest,"ops-fan-$it")}
        comments.delete(open,1,deleted,"ops-u1")
        assertEquals(200,call("PUT","/internal/v1/comments/$toHide/hidden").statusCode())
        jdbc.update("UPDATE work SET restricted=true WHERE id=?",restricted)
        jdbc.update("UPDATE work SET deleted_at=now() WHERE id=?",gone)

        val items=listed(open,restricted,gone)
        // 작성 최신순이고 같은 시각은 id순이다(UUID는 소문자 16진수와 고정 위치 하이픈이라 DB collation과 Kotlin 정렬이 같다). 삭제된 댓글과 삭제된 작품의 댓글은 없다.
        assertEquals(listOf(tie1,tie2).sorted()+listOf(ofRestricted,toHide,oldest),items.map {it.path("commentId").asString()})
        val byId=items.associateBy {it.path("commentId").asString()}
        val first=byId.getValue(oldest)
        assertEquals(listOf<Any?>(open,"운영 댓글 $tag open",1,"ops-u1","닉1","가장 오래된 글",2,false),
            listOf(first.path("workId").asString(),first.path("workTitle").asString(),first.path("episodeNumber").asInt(),first.path("authorId").asString(),
                first.path("authorName").asString(),first.path("body").asString(),first.path("likeCount").asInt(),first.path("hidden").asBoolean()))
        assertEquals(10,first.size(),"계약의 필드만 노출한다")
        assertEquals(t0,Instant.parse(first.path("createdAt").asString()))
        val hiddenOne=byId.getValue(toHide)
        assertEquals(listOf<Any?>("숨길 글",true,0,"닉2"),listOf(hiddenOne.path("body").asString(),hiddenOne.path("hidden").asBoolean(),hiddenOne.path("likeCount").asInt(),hiddenOne.path("authorName").asString()),
            "숨긴 댓글도 원문 그대로 준다")
        val inRestricted=byId.getValue(ofRestricted)
        assertEquals(listOf<Any?>(restricted,"탈퇴한 회원"),listOf(inRestricted.path("workId").asString(),inRestricted.path("authorName").asString()),
            "운영 제한 작품의 댓글도 포함하고 Core에 없는 작성자는 탈퇴한 회원이다")
    }

    @Test fun `hide and restore are idempotent keep the original body and change only what readers see`() {
        val open=work("toggle")
        val cid=comment(open,"ops-u1","원문 본문",t0)
        val publicList="/api/v1/public/works/$open/episodes/1/comments"
        fun reader():JsonNode=node(call("GET",publicList,null)).path("items").toList().single()

        repeat(2) {
            val response=call("PUT","/internal/v1/comments/$cid/hidden")
            assertEquals(200,response.statusCode(),response.body())
            val body=node(response)
            assertEquals(listOf<Any?>(cid,true,"원문 본문","닉1"),listOf(body.path("commentId").asString(),body.path("hidden").asBoolean(),body.path("body").asString(),body.path("authorName").asString()))
        }
        assertEquals(true,hiddenColumn(cid))
        // 숨김은 수정이 아니라서 updated_at을 바꾸지 않는다(공개 응답의 edited가 켜지지 않는다).
        assertEquals(true,jdbc.queryForObject("SELECT updated_at=created_at FROM episode_comment WHERE id=?",Boolean::class.java,cid))
        reader().let {assertEquals(listOf<Any?>(true,"",true,false),listOf(it.path("hidden").asBoolean(),it.path("body").asString(),it.path("quote").isNull,it.path("edited").asBoolean()))}
        assertEquals("원문 본문",listed(open).single().path("body").asString())

        repeat(2) {
            val response=call("DELETE","/internal/v1/comments/$cid/hidden")
            assertEquals(200,response.statusCode(),response.body())
            assertFalse(node(response).path("hidden").asBoolean())
        }
        assertEquals(false,hiddenColumn(cid))
        reader().let {assertEquals(listOf<Any?>(false,"원문 본문"),listOf(it.path("hidden").asBoolean(),it.path("body").asString()))}

        for(method in listOf("PUT","DELETE")) for(wrong in listOf(null,wrongToken)) assertEquals(403,call(method,"/internal/v1/comments/$cid/hidden",wrong).statusCode(),"$method $wrong")
        assertEquals(false,hiddenColumn(cid))
    }

    @Test fun `hide and restore are 404 for an unknown comment a deleted comment and a comment of a deleted work and change nothing`() {
        val open=work("missing")
        val deleted=comment(open,"ops-u1","삭제될 글",t0)
        comments.delete(open,1,deleted,"ops-u1")
        val gone=work("missing-gone")
        val ofGone=comment(gone,"ops-u1","삭제된 작품의 글",t0)
        jdbc.update("UPDATE work SET deleted_at=now() WHERE id=?",gone)

        for(id in listOf(UUID.randomUUID().toString(),deleted,ofGone)) for(method in listOf("PUT","DELETE")) {
            assertEquals(404,call(method,"/internal/v1/comments/$id/hidden").statusCode(),"$method $id")
        }

        assertEquals(listOf(false,false),listOf(deleted,ofGone).map {hiddenColumn(it)})
    }
}
