package ai.storyfork.content.feedbackreport

import ai.storyfork.content.auth.client.CoreAuthClient
import ai.storyfork.content.auth.client.VerifiedMemberResponse
import ai.storyfork.content.auth.client.exception.CoreAuthException
import ai.storyfork.content.auth.service.CoreNicknameService
import ai.storyfork.content.fixture.ContentTestConfig
import ai.storyfork.content.fixture.ContentTestDriver
import ai.storyfork.content.fixture.CsrfFixture
import ai.storyfork.content.fixture.DraftRequest
import ai.storyfork.content.fixture.PublishRequest
import ai.storyfork.content.work.service.WorkService
import ai.storyfork.content.work.service.dto.CreateWorkRequest
import java.net.URI
import java.net.http.HttpClient
import java.net.http.HttpRequest
import java.net.http.HttpResponse
import java.time.Instant
import java.util.UUID
import java.util.concurrent.ConcurrentHashMap
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
 * 제보 관리 HTTP 계약(경로·Security·CSRF·상태 코드·Location)과 V28 저장을 실제 PostgreSQL로 검증한다.
 * 표시명의 정본은 Core 닉네임이라 Content에는 저장하지 않으며, Core는 [names]를 돌려주는 대역이다.
 * TEST_CONTENT_DATABASE_URL이 있을 때만 실행하며, DB는 다른 테스트와 공유하므로 각 테스트는 자신이 만든 작품의 행만 비교한다.
 */
@SpringBootTest(webEnvironment=SpringBootTest.WebEnvironment.RANDOM_PORT,properties=[
    "DATABASE_URL=\${TEST_CONTENT_DATABASE_URL}",
    "DATABASE_USER=content_test","DATABASE_PASSWORD=",
    "CONTENT_CORE_AUTH_TOKEN=content-test-service-credential-at-least-32",
])
@Import(ContentTestConfig::class)
@EnabledIfEnvironmentVariable(named="TEST_CONTENT_DATABASE_URL",matches=".+")
class FeedbackReportIntegrationTest {
    @LocalServerPort var port=0
    @MockitoBean lateinit var core: CoreAuthClient
    @MockitoBean lateinit var nicknames: CoreNicknameService
    @Autowired lateinit var works: WorkService
    @Autowired lateinit var driver: ContentTestDriver
    @Autowired @Qualifier("contentDataSource") lateinit var source: DataSource
    @Autowired lateinit var json: JsonMapper
    private val jdbc get()=JdbcTemplate(source)
    private val client=HttpClient.newHttpClient()
    /** Core 닉네임 대역이다. 회원 id → 최신 닉네임이며, 없는 회원은 Core에 없는(탈퇴한) 회원이다. */
    private val names: MutableMap<String,String> = ConcurrentHashMap()

    @BeforeEach fun coreNicknames() {
        `when`(nicknames.nicknames(ArgumentMatchers.anyCollection<String>())).thenAnswer {call ->
            (call.arguments[0] as Collection<*>).map {it as String}.filter {it in names}.associateWith {names.getValue(it)}
        }
    }

    /** Core가 확인해 주는 회원이다. 닉네임을 주면 Core 닉네임 대역에도 등록한다. */
    private fun member(nickname: String? = "닉네임"): UUID=UUID.randomUUID().also { id ->
        `when`(core.verify("Bearer $id")).thenReturn(VerifiedMemberResponse(id))
        if(nickname!=null) names[id.toString()]=nickname
    }
    private fun call(method: String,path: String,member: UUID? = null,body: String? = null,csrf: Boolean = true): HttpResponse<String> {
        val request=HttpRequest.newBuilder(URI.create("http://127.0.0.1:$port$path")).header("Accept","application/json")
            .method(method,if(body==null) HttpRequest.BodyPublishers.noBody() else HttpRequest.BodyPublishers.ofString(body))
        if(body!=null) request.header("Content-Type","application/json")
        if(method!="GET" && csrf) request.header("Cookie",CsrfFixture.cookie).header("X-CSRF-TOKEN",CsrfFixture.token())
        if(member!=null) request.header("Authorization","Bearer $member")
        return client.send(request.build(),HttpResponse.BodyHandlers.ofString())
    }
    private fun write(id: String,number: Int = 1)="/api/v1/works/$id/episodes/$number/feedback-reports"
    private fun read(id: String,number: Int = 1)="/api/v1/public/works/$id/episodes/$number/feedback-reports"
    private fun one(id: String,report: String,action: String)="/api/v1/works/$id/feedback-reports/$report/$action"
    private fun post(id: String,member: UUID?,body: String,number: Int = 1)=call("POST",write(id,number),member,body)
    private fun detail(id: String,report: String,member: UUID? = null)=call("GET","${read(id)}/$report",member)
    private fun list(id: String,member: UUID? = null)=call("GET",read(id),member)
    private fun node(response: HttpResponse<String>): JsonNode=json.readTree(response.body())
    private fun ids(response: HttpResponse<String>)=node(response).path("items").toList().map {it.path("id").asString()}
    private fun created(response: HttpResponse<String>): String {
        assertEquals(201,response.statusCode(),response.body())
        return node(response).path("id").asString()
    }
    private fun ok(response: HttpResponse<String>): JsonNode {
        assertEquals(200,response.statusCode(),response.body())
        return node(response)
    }
    private fun count(sql: String,vararg args: Any)=jdbc.queryForObject(sql,Int::class.java,*args)!!
    private fun publishedVersion(work: String)=jdbc.queryForObject("SELECT published_version_id FROM episode_current WHERE work_id=? AND sequence=1",String::class.java,work)!!

    private fun work(owner: String = "author",publish: Boolean = true): String {
        val id=works.create(owner,CreateWorkRequest("제보 테스트","소개","ORIGINAL",listOf("판타지"),emptyList(),true)).id
        if(publish) {
            val draft=driver.edit(id,owner,DraftRequest("1화","본문",0))
            driver.publish(id,owner,PublishRequest(draft.revision,true,true,true,driver.history(id,owner).versions.last().id))
        }
        return id
    }

    @Test fun `creating a report stores a fixed version and no names and answers 201 with Location`() {
        val owner=member("작가")
        val id=work(owner.toString())
        val reporter=member("독자")

        val response=post(id,reporter,"""{"kind":"typo","body":"  오탈자예요  ","quote":"선택한 문장"}""")
        val rid=created(response)
        assertEquals("${read(id)}/$rid",response.headers().firstValue("Location").orElse(null))
        val version=publishedVersion(id)
        val body=node(response)
        assertEquals(listOf<Any?>(id,"제보 테스트",1,version,"typo","오탈자예요","선택한 문장","private","unchecked","독자",true,false,false,false),
            listOf(body.path("workId").asString(),body.path("workTitle").asString(),body.path("episodeNumber").asInt(),body.path("publishedVersionId").asString(),
                body.path("kind").asString(),body.path("body").asString(),body.path("quote").asString(),body.path("visibility").asString(),body.path("status").asString(),
                body.path("reporterName").asString(),body.path("mine").asBoolean(),body.path("owner").asBoolean(),body.path("authorChecked").asBoolean(),body.path("withdrawn").asBoolean()))
        assertTrue(body.path("amendments").isEmpty && body.path("responses").isEmpty)
        Instant.parse(body.path("createdAt").asString())
        Instant.parse(body.path("updatedAt").asString())
        assertEquals(version,jdbc.queryForObject("SELECT published_version_id FROM feedback_report WHERE id=?",String::class.java,rid))
        // 제보자·작가 이름은 저장하지 않는다. 응답 때마다 Core 닉네임을 조회한다.
        assertEquals(0,count("SELECT count(*) FROM information_schema.columns WHERE table_schema=current_schema() AND table_name IN ('feedback_report','feedback_report_response') AND column_name IN ('reporter_name','author_name')"))
        // 공개 범위를 생략하면 비공개라 익명은 목록·상세에서 볼 수 없다.
        assertEquals(emptyList<String>(),ids(list(id)))
        assertEquals(404,detail(id,rid).statusCode())
        // 작품 소유자도 자기 작품에 제보할 수 있다.
        created(post(id,owner,"""{"kind":"question","body":"작가의 제보","visibility":"public"}"""))
    }

    @Test fun `visibility decides who reads the text and a public answer shows without the original`() {
        val owner=member("작가")
        val id=work(owner.toString())
        val reporter=member("독자")
        val stranger=member("낯선 독자")
        val privateId=created(post(id,reporter,"""{"kind":"story","body":"비공개 원문","quote":"비공개 인용"}"""))
        val publicId=created(post(id,reporter,"""{"kind":"suggestion","body":"공개 제안","visibility":"public"}"""))

        // 익명·낯선 사람은 공개 제보만 본다. 제보자는 자기 비공개 제보까지, 소유자는 모든 제보를 본다(최신순).
        assertEquals(listOf(publicId),ids(list(id)))
        assertEquals(listOf(publicId),ids(list(id,stranger)))
        assertEquals(listOf(publicId,privateId),ids(list(id,reporter)))
        assertEquals(listOf(publicId,privateId),ids(list(id,owner)))
        assertEquals(404,detail(id,privateId,stranger).statusCode())
        assertEquals("비공개 원문",node(detail(id,privateId,reporter)).path("body").asString())
        assertEquals("비공개 원문",node(detail(id,privateId,owner)).path("body").asString())
        assertEquals(false,node(detail(id,publicId)).path("mine").asBoolean())

        // 비공개 제보에 공개 답변을 달면 원문 없이 답변만 공개 목록에 나온다. 비공개 답변은 제보자·소유자에게만 보인다.
        ok(call("POST",one(id,privateId,"responses"),owner,"""{"body":"비공개 답변"}"""))
        assertEquals(listOf(publicId),ids(list(id)))
        val answered=ok(call("POST",one(id,privateId,"responses"),owner,"""{"body":"공개 답변","isPublic":true}"""))
        assertEquals(listOf(false,true),answered.path("responses").toList().map {it.path("isPublic").asBoolean()})
        assertEquals(listOf(publicId,privateId),ids(list(id)))
        val hidden=node(list(id)).path("items").toList().first {it.path("id").asString()==privateId}
        assertTrue(hidden.path("body").isNull && hidden.path("quote").isNull && hidden.path("reporterName").isNull && hidden.path("amendments").isEmpty)
        assertEquals(listOf("공개 답변"),hidden.path("responses").toList().map {it.path("body").asString()})
        assertEquals(listOf("작가"),hidden.path("responses").toList().map {it.path("authorName").asString()})
        assertEquals(200,detail(id,privateId).statusCode())
        assertTrue(node(detail(id,privateId)).path("body").isNull)
        assertEquals(2,node(detail(id,privateId,reporter)).path("responses").size())
        // 제보자는 공개 범위를 언제든 바꾼다.
        assertEquals("public",ok(call("PUT",one(id,privateId,"visibility"),reporter,"""{"visibility":"public"}""")).path("visibility").asString())
        assertEquals("비공개 원문",node(detail(id,privateId)).path("body").asString())
        assertEquals(listOf("공개 답변"),node(detail(id,privateId)).path("responses").toList().map {it.path("body").asString()})
    }

    @Test fun `the reporter corrects and withdraws and the author checks answers and sets the status`() {
        val owner=member("작가")
        val id=work(owner.toString())
        val reporter=member("독자")
        val other=member("다른 독자")
        val rid=created(post(id,reporter,"""{"kind":"typo","body":"처음 본문","quote":"인용","visibility":"public"}"""))

        val corrected=ok(call("POST",one(id,rid,"corrections"),reporter,"""{"body":"  정정 내용  "}"""))
        assertEquals(listOf("correct"),corrected.path("amendments").toList().map {it.path("action").asString()})
        assertEquals(listOf("정정 내용"),corrected.path("amendments").toList().map {it.path("body").asString()})
        assertEquals("처음 본문",corrected.path("body").asString())
        assertEquals("처음 본문",jdbc.queryForObject("SELECT body FROM feedback_report WHERE id=?",String::class.java,rid))

        // 작가 확인은 멱등이고 확인 전을 확인함으로 바꾼다.
        repeat(2) {
            val checked=ok(call("POST",one(id,rid,"check"),owner))
            assertEquals(listOf("checked",true,true),listOf(checked.path("status").asString(),checked.path("authorChecked").asBoolean(),checked.path("owner").asBoolean()))
        }
        val answered=ok(call("POST",one(id,rid,"responses"),owner,"""{"body":"  답변이에요  ","isPublic":true}"""))
        assertEquals("answered",answered.path("status").asString())
        assertEquals(listOf("답변이에요"),answered.path("responses").toList().map {it.path("body").asString()})
        assertEquals("resolved",ok(call("PUT",one(id,rid,"status"),owner,"""{"status":"resolved"}""")).path("status").asString())
        assertEquals(422,call("PUT",one(id,rid,"status"),owner,"""{"status":"unchecked"}""").statusCode())
        assertEquals("closed",ok(call("PUT",one(id,rid,"status"),owner,"""{"status":"closed"}""")).path("status").asString())

        // 권한: 남의 제보를 정정·철회하거나 작가가 아닌 사람이 처리하면 403이다.
        for((action,who) in listOf("corrections" to other,"withdrawal" to other,"corrections" to owner,"withdrawal" to owner)) {
            assertEquals(403,call("POST",one(id,rid,action),who,if(action=="corrections") """{"body":"가로채기"}""" else null).statusCode(),"$action by non-reporter")
        }
        for(action in listOf("check","responses")) {
            for(who in listOf(other,reporter)) assertEquals(403,call("POST",one(id,rid,action),who,if(action=="responses") """{"body":"가로채기"}""" else null).statusCode(),"$action by non-owner")
        }
        assertEquals(403,call("PUT",one(id,rid,"status"),reporter,"""{"status":"closed"}""").statusCode())
        assertEquals(403,call("PUT",one(id,rid,"visibility"),other,"""{"visibility":"private"}""").statusCode())

        // 철회: 한 번만, 상태와 원문은 그대로 두고 행도 지우지 않는다. 철회 뒤 정정은 409지만 공개 범위는 바꿀 수 있다.
        val withdrawn=ok(call("POST",one(id,rid,"withdrawal"),reporter))
        assertEquals(listOf(true,"closed","처음 본문"),listOf(withdrawn.path("withdrawn").asBoolean(),withdrawn.path("status").asString(),withdrawn.path("body").asString()))
        assertEquals(listOf("correct","withdraw"),withdrawn.path("amendments").toList().map {it.path("action").asString()})
        assertEquals(409,call("POST",one(id,rid,"withdrawal"),reporter).statusCode())
        assertEquals(409,call("POST",one(id,rid,"corrections"),reporter,"""{"body":"늦은 정정"}""").statusCode())
        assertEquals("private",ok(call("PUT",one(id,rid,"visibility"),reporter,"""{"visibility":"private"}""")).path("visibility").asString())
        assertEquals(1,count("SELECT count(*) FROM feedback_report WHERE id=? AND withdrawn_at IS NOT NULL",rid))
        assertEquals(2,count("SELECT count(*) FROM feedback_report_amendment WHERE report_id=?",rid))
    }

    @Test fun `mine and inbox list reports across works newest first and the literal paths win over the work id`() {
        val owner=member("작가")
        val first=work(owner.toString())
        val second=work(owner.toString())
        val elsewhere=work()
        val reporter=member("독자")
        val a=created(post(first,reporter,"""{"kind":"typo","body":"첫째"}"""))
        val b=created(post(second,reporter,"""{"kind":"question","body":"둘째","visibility":"public"}"""))
        created(post(elsewhere,reporter,"""{"kind":"typo","body":"남의 작품"}"""))
        val ownReport=created(post(first,owner,"""{"kind":"suggestion","body":"작가의 제보"}"""))

        val mine=call("GET","/api/v1/works/feedback-reports/mine",reporter)
        assertEquals(200,mine.statusCode(),mine.body())
        assertEquals(3,ids(mine).size)
        assertEquals(listOf(b,a),ids(mine).filter {it in listOf(a,b)})
        assertTrue(node(mine).path("items").toList().all {it.path("mine").asBoolean() && !it.path("owner").asBoolean()})
        assertEquals(listOf("제보 테스트"),node(mine).path("items").toList().map {it.path("workTitle").asString()}.distinct())

        val inbox=call("GET","/api/v1/works/feedback-reports/inbox",owner)
        assertEquals(200,inbox.statusCode(),inbox.body())
        assertEquals(listOf(ownReport,b,a),ids(inbox))
        assertTrue(node(inbox).path("items").toList().all {it.path("owner").asBoolean()})
        assertEquals(emptyList<String>(),ids(call("GET","/api/v1/works/feedback-reports/inbox",reporter)))
        assertEquals(401,call("GET","/api/v1/works/feedback-reports/mine").statusCode())
        assertEquals(401,call("GET","/api/v1/works/feedback-reports/inbox").statusCode())
    }

    @Test fun `the inbox work id filter lists only that work and anything that is not mine is an empty 200`() {
        val owner=member("작가")
        val first=work(owner.toString())
        val second=work(owner.toString())
        val elsewhere=work()
        val reporter=member("독자")
        val a=created(post(first,reporter,"""{"kind":"typo","body":"첫째"}"""))
        val b=created(post(second,reporter,"""{"kind":"question","body":"둘째","visibility":"public"}"""))
        created(post(elsewhere,reporter,"""{"kind":"typo","body":"남의 작품"}"""))

        val inbox="/api/v1/works/feedback-reports/inbox"
        assertEquals(listOf(a),ids(call("GET","$inbox?workId=$first",owner)))
        assertEquals(listOf(b),ids(call("GET","$inbox?workId=$second",owner)))
        assertEquals(listOf(b,a),ids(call("GET",inbox,owner)))
        // 빈 값(`workId=`)은 생략과 같다.
        assertEquals(listOf(b,a),ids(call("GET","$inbox?workId=",owner)))
        // 남의 작품·없는 작품·형식이 틀린 값은 존재 여부를 드러내지 않도록 모두 같은 빈 목록(200)이다.
        for(other in listOf(elsewhere,UUID.randomUUID().toString(),"not-a-uuid")) {
            val response=call("GET","$inbox?workId=$other",owner)
            assertEquals(200,response.statusCode(),response.body())
            assertEquals(emptyList<String>(),ids(response),other)
        }
        assertEquals(emptyList<String>(),ids(call("GET","$inbox?workId=$first",reporter)))
        assertEquals(401,call("GET","$inbox?workId=$first").statusCode())
    }

    @Test fun `invalid input is 422 or 400 and nothing is stored or changed`() {
        val owner=member()
        val id=work(owner.toString())
        val reporter=member()
        val tooLong="가".repeat(501)
        for(bad in listOf("""{}""","""{"kind":"typo"}""","""{"body":"본문"}""","""{"kind":"comment","body":"본문"}""","""{"kind":"typo","body":"   "}""","""{"kind":"typo","body":"$tooLong"}""",
            """{"kind":"typo","body":"본문\u0000"}""","""{"kind":"typo","body":"본문","quote":"$tooLong"}""","""{"kind":"typo","body":"본문","quote":"\u0000"}""",
            """{"kind":"typo","body":"본문","visibility":"friends"}""")) {
            assertEquals(422,post(id,reporter,bad).statusCode(),bad.take(60))
        }
        assertEquals(400,post(id,reporter,"{broken").statusCode())
        assertEquals(0,count("SELECT count(*) FROM feedback_report WHERE work_id=?",id))

        val rid=created(post(id,reporter,"""{"kind":"typo","body":"원래 글"}"""))
        for(bad in listOf("""{}""","""{"visibility":"friends"}""")) assertEquals(422,call("PUT",one(id,rid,"visibility"),reporter,bad).statusCode(),bad)
        for(bad in listOf("""{}""","""{"body":" "}""","""{"body":"$tooLong"}""","""{"body":"고침\u0000"}""")) assertEquals(422,call("POST",one(id,rid,"corrections"),reporter,bad).statusCode(),bad.take(40))
        for(bad in listOf("""{}""","""{"body":" "}""","""{"body":"${"가".repeat(2001)}"}""")) assertEquals(422,call("POST",one(id,rid,"responses"),owner,bad).statusCode(),bad.take(40))
        for(bad in listOf("""{}""","""{"status":"unchecked"}""","""{"status":"done"}""")) assertEquals(422,call("PUT",one(id,rid,"status"),owner,bad).statusCode(),bad)
        assertEquals(listOf<Any?>("원래 글","private","unchecked"),jdbc.queryForObject("SELECT body,visibility,status FROM feedback_report WHERE id=?",{rs,_ -> listOf<Any?>(rs.getString(1),rs.getString(2),rs.getString(3))},rid))
        assertEquals(0,count("SELECT count(*) FROM feedback_report_amendment WHERE report_id=?",rid))
        assertEquals(0,count("SELECT count(*) FROM feedback_report_response WHERE report_id=?",rid))
    }

    @Test fun `only published episodes of public works take reports and writing needs a verified member and csrf`() {
        val open=work()
        val hidden=work(publish=false)
        val reader=member()
        val rid=created(post(open,reader,"""{"kind":"typo","body":"공개 작품 제보"}"""))

        assertEquals(200,list(open).statusCode())
        assertEquals(401,post(open,null,"""{"kind":"typo","body":"익명"}""").statusCode())
        assertEquals(403,call("POST",write(open),reader,"""{"kind":"typo","body":"CSRF 없음"}""",csrf=false).statusCode())
        assertEquals(403,call("POST",one(open,rid,"withdrawal"),reader,csrf=false).statusCode())
        assertEquals(401,call("POST",one(open,rid,"withdrawal")).statusCode())
        for((target,number) in listOf(hidden to 1,open to 2,open to 0,UUID.randomUUID().toString() to 1)) {
            assertEquals(404,call("GET",read(target,number)).statusCode(),"read $target $number")
            assertEquals(404,post(target,reader,"""{"kind":"typo","body":"안 돼요"}""",number).statusCode(),"write $target $number")
        }
        // 경로의 작품·회차와 맞지 않는 제보는 404다.
        assertEquals(404,call("GET","${read(open,2)}/$rid").statusCode())
        assertEquals(404,call("GET","${read(open)}/${UUID.randomUUID()}").statusCode())
        assertEquals(404,call("POST",one(hidden,rid,"withdrawal"),reader).statusCode())
        assertEquals(404,call("POST",one(open,UUID.randomUUID().toString(),"withdrawal"),reader).statusCode())
        assertEquals(0,count("SELECT count(*) FROM feedback_report WHERE work_id=?",hidden))
        assertEquals(1,count("SELECT count(*) FROM feedback_report WHERE work_id=?",open))
    }

    @Test fun `a private report that a stranger cannot see is 404 for writes and not 403`() {
        val owner=member()
        val id=work(owner.toString())
        val reporter=member()
        val stranger=member()
        val rid=created(post(id,reporter,"""{"kind":"story","body":"비공개"}"""))

        assertEquals(404,call("POST",one(id,rid,"withdrawal"),stranger).statusCode())
        assertEquals(404,call("POST",one(id,rid,"check"),stranger).statusCode())
        assertEquals(404,call("PUT",one(id,rid,"status"),stranger,"""{"status":"closed"}""").statusCode())
        // 제보자는 작가 쪽 쓰기가, 작가는 제보자 쪽 쓰기가 403이다.
        assertEquals(403,call("POST",one(id,rid,"check"),reporter).statusCode())
        assertEquals(403,call("POST",one(id,rid,"withdrawal"),owner).statusCode())
        assertEquals(listOf<Any?>(null,null),jdbc.queryForObject("SELECT author_checked_at,withdrawn_at FROM feedback_report WHERE id=?",{rs,_ -> listOf<Any?>(rs.getObject(1),rs.getObject(2))},rid))
    }

    @Test fun `a Core failure is a 503 and never a made up name or a stored change`() {
        val owner=member()
        val id=work(owner.toString())
        val reporter=member()
        val first=created(post(id,reporter,"""{"kind":"typo","body":"저장된 제보","visibility":"public"}"""))
        `when`(nicknames.nicknames(ArgumentMatchers.anyCollection<String>()))
            .thenThrow(CoreAuthException(503,"CORE_MEMBER_UNAVAILABLE","회원 정보 서비스를 사용할 수 없습니다."))

        for(response in listOf(list(id),detail(id,first),call("GET","/api/v1/works/feedback-reports/mine",reporter),call("GET","/api/v1/works/feedback-reports/inbox",owner),
            post(id,reporter,"""{"kind":"typo","body":"저장되면 안 되는 제보"}"""),call("POST",one(id,first,"check"),owner))) {
            assertEquals(503,response.statusCode(),response.body())
            assertEquals("회원 정보 서비스를 사용할 수 없습니다.",node(response).path("detail").asString())
        }
        // 응답을 만들지 못한 쓰기는 같은 트랜잭션에서 되돌려진다.
        assertEquals(listOf("저장된 제보"),jdbc.queryForList("SELECT body FROM feedback_report WHERE work_id=?",String::class.java,id))
        assertEquals(1,count("SELECT count(*) FROM feedback_report WHERE id=? AND author_checked_at IS NULL AND status='unchecked'",first))
    }

    @Test fun `names follow the latest Core nickname and a member Core no longer knows is the withdrawn member`() {
        val owner=member("작가")
        val id=work(owner.toString())
        val reporter=member("처음 닉네임")
        val rid=created(post(id,reporter,"""{"kind":"typo","body":"이름이 바뀌는 독자","visibility":"public"}"""))
        ok(call("POST",one(id,rid,"responses"),owner,"""{"body":"공개 답변","isPublic":true}"""))

        names[reporter.toString()]="바꾼 닉네임"
        assertEquals("바꾼 닉네임",node(detail(id,rid)).path("reporterName").asString())
        names.remove(reporter.toString())
        names.remove(owner.toString())
        val shown=node(detail(id,rid))
        assertEquals("탈퇴한 회원",shown.path("reporterName").asString())
        assertEquals(listOf("탈퇴한 회원"),shown.path("responses").toList().map {it.path("authorName").asString()})
    }

    @Test fun `a later publication does not change the version an existing report was written against`() {
        val id=work()
        val reader=member()
        val first=created(post(id,reader,"""{"kind":"typo","body":"초판을 읽고","visibility":"public"}"""))
        val before=publishedVersion(id)

        val episode=driver.writing(id,"author",1)
        val saved=driver.writeEpisode(id,"author",1,DraftRequest("1화 개정","개정 본문",episode.draft.revision),true)
        driver.publishEpisode(id,"author",1,PublishRequest(saved.draft.revision,true,true,true,saved.versions.last().id))
        val after=publishedVersion(id)
        assertNotEquals(before,after)

        val second=created(post(id,reader,"""{"kind":"typo","body":"개정판을 읽고","visibility":"public"}"""))
        assertEquals(before,node(detail(id,first)).path("publishedVersionId").asString())
        assertEquals(after,node(detail(id,second)).path("publishedVersionId").asString())
        assertEquals(before,jdbc.queryForObject("SELECT published_version_id FROM feedback_report WHERE id=?",String::class.java,first))
    }
}
